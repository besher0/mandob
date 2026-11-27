'use strict';
const {prisma,HttpError,requireRole,companyId,scope,visitScope,asDate,requireString,safeInt,
  hashPassword,publicUser}=require('./auth');

const {submitVisit,listVisit,include:visitInclude}=require('./visit-service');
const {managerActivityWindow}=require('./manager-activity-window');
const {submitLeave,reviewLeave}=require('./leave-service');
const {getFrequency,periodWindow}=require('./analytics-service');
const {getAreaCoverage}=require('./area-coverage-service');
const {cycleBounds,storeDoctorGoal}=require('./doctor-goal-service');
const {workingDaysWithin}=require('./domain');
const {visitReport,exportVisitsXlsx,exportFrequencyXlsx,medicalDirectoryExport}=require('./report-service');
const {previewDoctors,commitDoctors}=require('./doctor-import-service');
const {doctorTargetWhere}=require('./doctor-access');
const {medicalSpecialtyOptions}=require('./medical-specialties');
const {registerSalesRoutes}=require('./sales-service');
const {registerSampleStockRoutes}=require('./sample-stock-service');
const {checkedPatch,checkedInput}=require('./request-validation');
const express=require('express');
const {Prisma}=require('@prisma/client');

const ADMIN=['COMPANY_ADMIN'];
const MANAGEMENT=['COMPANY_ADMIN','TEAM_MANAGER'];
const GRADE=['A','B','C'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(value) { if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'معرّف غير صالح');return value; }
// Optional paging preserves existing all-record responses for older v2 callers,
// but allows newer clients to request bounded windows on management directories.
function optionalPage(query,max=500){
  if(query?.limit===undefined && query?.offset===undefined)return {};
  return {take:safeInt(query.limit??100,'limit',1,max),
    skip:safeInt(query.offset??0,'offset',0,100000)};
}
function grade(value) { if(!GRADE.includes(value))throw new HttpError(400,'تصنيف غير صالح');return value; }
function safeList(value,max=100) {
  if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!UUID.test(v)))
    throw new HttpError(400,'قائمة معرّفات غير صحيحة');
  return [...new Set(value)];
}
function requireCompany(req) {
  if(req.user.role==='SUPER_ADMIN')throw new HttpError(403,'اختر شركة من إدارة الشركات');
  return companyId(req.user);
}
function onlyCompany(req,allowed=MANAGEMENT){requireRole(req.user,allowed);return requireCompany(req);}
// Persist a database mutation and its audit event in a single transaction.
async function auditWrite(user,action,entity,entityId,work,options){
  return prisma.$transaction(async(tx)=>{
    const value=await work(tx);
    const resolvedId=typeof entityId==='function'?entityId(value):entityId;
    await tx.auditLog.create({data:{companyId:user.companyId||null,
      actorId:user.id,action,entity,entityId:resolvedId}});
    return value;
  },options);
}
function teamRepCriteria(user){
  return {companyId:companyId(user),role:'REP',teamId:user.teamId||'__UNASSIGNED__'};
}
function repFilter(user) {
  const c=companyId(user);
  if(user.role==='REP')return {companyId:c,id:user.id};
  if(user.role==='TEAM_MANAGER')return teamRepCriteria(user);
  return {companyId:c,role:'REP'};
}
function entityFilter(user) {
  const companyIdValue=companyId(user);
  if(user.role==='REP')return {companyId:companyIdValue,area:{repAreas:{some:{repId:user.id}}}};
  if(user.role==='TEAM_MANAGER')return {companyId:companyIdValue,area:{repAreas:{some:{rep:teamRepCriteria(user)}}}};
  return {companyId:companyIdValue};
}
// Reuse the same doctor-area visibility for lists and dashboard counts.
function doctorFilter(user){
  const c=companyId(user),where={companyId:c};
  const repScope=user.role==='REP'?{repId:user.id}:
    user.role==='TEAM_MANAGER'?{rep:teamRepCriteria(user)}:null;
  if(repScope)where.OR=[
    {area:{repAreas:{some:repScope}}},
    {doctorAreas:{some:{area:{repAreas:{some:repScope}}}}}
  ];
  return where;
}
// A REP must see the same eligible doctors in the directory, dashboards and
// reports as the visit transaction permits. Area-only filtering is insufficient:
// the TEAM/CUSTOM specialty policy is enforced by doctorTargetWhere.
async function scopedDoctorFilter(user){
  if(user.role!=='REP')return doctorFilter(user);
  const c=companyId(user);
  const rep=await prisma.user.findFirst({
    where:{id:user.id,companyId:c,role:'REP',active:true},
    include:{repSpecialties:true,team:{include:{specialties:true}}}
  });
  return doctorTargetWhere(rep,c)||{companyId:c,id:{in:[]}};
}
function managerCanSeeRep(user,rep) {
  if(rep.companyId!==user.companyId||rep.role!=='REP')return false;
  if(user.role==='REP')return rep.id===user.id;
  if(user.role==='TEAM_MANAGER')return Boolean(user.teamId)&&rep.teamId===user.teamId;
  return user.role==='COMPANY_ADMIN';
}
function normalizedStringList(items,max=40) {
  if(!Array.isArray(items)||items.length>max)throw new HttpError(400,'قائمة غير صحيحة');
  return [...new Set(items.map(x=>requireString(x,'name',120)))];
}
function parseRepOptions(payload,role,teamId){
  const keys=['specialtyMode','customSpecialties','customProductIds'];
  if(role!=='REP'){
    if(keys.some(k=>payload[k]!==undefined))
      throw new HttpError(400,'التخصيصات الفردية للمندوب فقط');
    return {mode:'TEAM',specialties:null,products:null};
  }
  const mode=payload.specialtyMode;
  if(mode!==undefined&&!['TEAM','CUSTOM'].includes(mode))
    throw new HttpError(400,'وضع الاختصاصات غير صحيح');
  const specialties=payload.customSpecialties===undefined?null:
    normalizedStringList(payload.customSpecialties);
  const products=payload.customProductIds===undefined?null:
    safeList(payload.customProductIds);
  if(mode==='TEAM'&&specialties?.length)
    throw new HttpError(400,'عند اتباع الفريق لا ترسل اختصاصات مخصصة');
  if(teamId&&products?.length)
    throw new HttpError(400,'منتجات المندوب المخصصة مسموحة فقط بدون فريق');
  return {mode,specialties,products};
}
function formatDate(date){return date instanceof Date?date.toISOString().slice(0,10):date;}

function canReadSubmittedReport(user,report){
  if(!user||!report||report.companyId!==user.companyId)return false;
  if(user.role==='REP')return report.repId===user.id;
  if(user.role==='COMPANY_ADMIN')return true;
  if(user.role==='TEAM_MANAGER')return Boolean(user.teamId)&&
    report.teamIdAtSubmission===user.teamId;
  return false;
}
// Values are always calculated on the server from saved visits and targets.
// Only the detailed snapshot is persisted/sent; summary preview stays lightweight.
async function calculateRepReport(user,query,includeRows=false){
  requireRole(user,['REP']);
  const from=asDate(query?.from),to=asDate(query?.to);
  if(from>to)throw new HttpError(400,'تاريخ نهاية التقرير قبل تاريخ البداية');
  const spanDays=Math.round((to.getTime()-from.getTime())/86400000)+1;
  if(spanDays>366)throw new HttpError(400,'الفترة المحددة للتقرير أطول من سنة');
  const c=companyId(user),where={companyId:c,repId:user.id,
    visitDate:{gte:from,lte:to}};
  const types=['DOCTOR','PHARMACY','HOSPITAL'];
  const [doctorWhere,tours, ...rest]=await Promise.all([
    scopedDoctorFilter(user),
    prisma.visit.count({where}),
    ...types.map(type=>prisma.visitTarget.count({where:{visit:{...where,type}}})),
    prisma.companySettings.findUnique({where:{companyId:c}}),
    includeRows?prisma.visit.findMany({
      where,orderBy:[{visitDate:'asc'},{createdAt:'asc'},{id:'asc'}],
      take:5001,select:{id:true,type:true,visitDate:true,note:true,
        targets:{select:{doctor:{select:{name:true}},pharmacy:{select:{name:true}},
          hospital:{select:{name:true}},areaAtVisit:{select:{name:true}}}}}
    }):Promise.resolve(null)
  ]);
  const counts=rest.slice(0,3),settings=rest[3],visits=rest[4];
  if(visits&&visits.length>5000)
    throw new HttpError(413,'عدد الجولات في التقرير كبير، اختر فترة أقصر');
  const activeWeekdays=new Set(Array.isArray(settings?.workingDays)?
    settings.workingDays:[0,1,2,3,4,6]);
  let workingDays=0;
  for(let day=new Date(from);day<=to;day.setUTCDate(day.getUTCDate()+1)){
    if(activeWeekdays.has(day.getUTCDay()))workingDays++;
  }
  const totalTargets=counts.reduce((sum,count)=>sum+count,0);
  // The original report preview shows current-cycle coverage, independent of
  // the selected reporting date window. Use the same per-rep, weighted target
  // calculation as the representative workspace, not the team's quota.
  const {start:cycleStart,end:cycleEnd}=cycleBounds(settings);
  const doctors=await prisma.doctor.findMany({where:{...doctorWhere,active:true},
    select:{id:true,grade:true}});
  const ids=doctors.map(doctor=>doctor.id);
  const [personalGoals,doctorCounts]=ids.length?await Promise.all([
    prisma.doctorVisitGoal.findMany({where:{companyId:c,scope:'REP',ownerId:user.id,
      cycleStart,cycleEnd,doctorId:{in:ids}},select:{doctorId:true,target:true}}),
    prisma.visitTarget.groupBy({by:['doctorId'],where:{doctorId:{in:ids},
      visit:{companyId:c,repId:user.id,type:'DOCTOR',
        visitDate:{gte:cycleStart,lte:cycleEnd}}},_count:{_all:true}})
  ]):[[],[]];
  const goalsById=new Map(personalGoals.map(goal=>[goal.doctorId,goal.target]));
  const countsById=new Map(doctorCounts.map(row=>[row.doctorId,row._count._all]));
  const goalFor=doctor=>goalsById.get(doctor.id)??
    (doctor.grade==='A'?(settings?.frequencyA??4):
      doctor.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1));
  const expected=doctors.reduce((n,doctor)=>n+goalFor(doctor),0);
  const achieved=doctors.reduce((n,doctor)=>
    n+Math.min(goalFor(doctor),countsById.get(doctor.id)||0),0);
  const cycleCoverage=expected?Math.round(achieved/expected*100):0;
  const result={from:formatDate(from),to:formatDate(to),tours,cycleCoverage,
    byType:Object.fromEntries(types.map((type,i)=>[type,counts[i]])),
    totalTargets,workingDays,
    averagePerWorkingDay:workingDays?Math.round(totalTargets/workingDays*10)/10:null};
  if(!includeRows)return result;
  return {...result,rows:visits.map(visit=>({
    id:visit.id,date:formatDate(visit.visitDate),type:visit.type,
    note:visit.note||null,
    targets:visit.targets.map(target=>({
      name:target.doctor?.name||target.pharmacy?.name||target.hospital?.name||'—',
      area:target.areaAtVisit?.name||'منطقة غير مسجلة'
    }))
  }))};
}

function registerRoutes(app,wrap) {
  const route=(method,url,fn)=>app[method](url,wrap(fn));
  registerSalesRoutes(app,wrap);
  registerSampleStockRoutes(route);
  // Super-admin can manage the directory of companies and provision isolated company administrators.
  route('get','/api/companies',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    const data=await prisma.company.findMany({include:{_count:{select:{users:true,teams:true,visits:true}}},orderBy:{createdAt:'desc'}});
    res.json(data);
  });
  route('post','/api/companies',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    checkedInput(req.body,['name']);
    const name=requireString(req.body?.name,'company name');
    const company=await auditWrite(req.user,'CREATE','COMPANY',v=>v.id,tx=>tx.company.create({
      data:{name,settings:{create:{}}}
    }));
    res.status(201).json(company);
  });
  route('post','/api/companies/:id/admins',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    checkedInput(req.body,['name','username','password']);
    const id=validId(req.params.id);
    const username=requireString(req.body?.username,'username',150);
    const name=requireString(req.body?.name,'name');
    const passwordHash=hashPassword(req.body?.password);
    const company=await prisma.company.findUnique({where:{id}});
    if(!company)throw new HttpError(404,'الشركة غير موجودة');
    const u=await auditWrite(req.user,'CREATE','USER',v=>v.id,tx=>tx.user.create({
      data:{companyId:id,role:'COMPANY_ADMIN',username,name,passwordHash}
    }));
    res.status(201).json({user:publicUser(u)});
  });

  route('get','/api/dashboard',async(req,res)=>{
    const company= requireCompany(req), rwhere=repFilter(req.user), vwhere=visitScope(req.user), lwhere=scope(req.user);
    const doctorWhere=await scopedDoctorFilter(req.user);
    const reportWhere={companyId:company};
    if(req.user.role==='TEAM_MANAGER')
      reportWhere.teamIdAtSubmission=req.user.teamId||'__UNASSIGNED__';
    if(req.user.role==='REP')reportWhere.repId=req.user.id;
    const [reps,doctors,pharmacies,hospitals,visits,leaves,reports]=await Promise.all([
      prisma.user.count({where:rwhere}),
      // Dashboard totals match the default active medical directories.
      // Archived records remain available to company admins via includeArchived.
      prisma.doctor.count({where:{...doctorWhere,active:true}}),
      prisma.pharmacy.count({where:{...entityFilter(req.user),active:true}}),
      prisma.hospital.count({where:{...entityFilter(req.user),active:true}}),
      prisma.visit.count({where:vwhere}),
      prisma.leaveRequest.count({where:{...lwhere,status:'PENDING'}}),
      prisma.repReportSubmission.count({where:reportWhere})
    ]);
    res.json({companyId:company,reps,doctors,pharmacies,hospitals,visits,
      pendingLeaves:leaves,reports});
  });
  const teamRelations={
    province:{select:{id:true,name:true}},
    _count:{select:{users:true}},
    specialties:{orderBy:{specialty:'asc'}},
    products:{include:{product:{select:{id:true,name:true,priority:true,targetSpecialties:true}}}}
  };
  // Official defaults plus tenant-specific labels already stored in active doctors,
  // team specialties and representative custom assignments. Never auto-assign a
  // default specialty: clinical visibility still follows explicit permissions.
  route('get','/api/specialties',async(req,res)=>{
    const c=requireCompany(req);
    const [doctors,teams,reps]=await Promise.all([
      prisma.doctor.findMany({where:{companyId:c,active:true},
        distinct:['specialty'],select:{specialty:true},take:501}),
      prisma.teamSpecialty.findMany({where:{team:{companyId:c}},
        distinct:['specialty'],select:{specialty:true},take:501}),
      prisma.repSpecialty.findMany({where:{rep:{companyId:c}},
        distinct:['specialty'],select:{specialty:true},take:501})
    ]);
    if([doctors,teams,reps].some(rows=>rows.length>500))
      throw new HttpError(413,'عدد الاختصاصات كبير جداً');
    res.json(medicalSpecialtyOptions([
      ...doctors.map(x=>x.specialty),...teams.map(x=>x.specialty),
      ...reps.map(x=>x.specialty)
    ]));
  });
  route('get','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    const where=req.user.role==='TEAM_MANAGER'?{id:req.user.teamId||'__UNASSIGNED__',companyId:c}:{companyId:c};
    const teams=await prisma.team.findMany({where,include:teamRelations,
      orderBy:[{name:'asc'},{id:'asc'}],...optionalPage(req.query)});
    res.json(teams);
  });
  // Legacy manager 'teams' page: the company admin assigns membership, not
  // the team manager. This endpoint never exposes another company's teams.
  route('get','/api/manager/assigned-teams',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),ids=req.user.managedTeamIds||[];
    if(!ids.length)return res.json({teams:[],activeTeamId:null});
    const [teams,frequency,repAreas]=await Promise.all([
      prisma.team.findMany({
        where:{companyId:c,id:{in:ids}},
        include:{...teamRelations,users:{
          where:{companyId:c,role:'REP'},
          select:{id:true,name:true}
        }},orderBy:[{name:'asc'},{id:'asc'}]}),
      // Reuse the exact same doctor quotas and historical team attribution as
      // the team's frequency report. Never average percentages across areas.
      getFrequency(req.user,{teamIds:ids}),
      prisma.repArea.findMany({
        where:{rep:{companyId:c,role:'REP',teamId:{in:ids}}},
        select:{rep:{select:{teamId:true}},
          area:{select:{city:true}}}
      })
    ]);
    const totals=new Map(ids.map(id=>[id,{target:0,done:0,doctorIds:new Set()}]));
    for(const item of frequency.items||[]){
      const total=totals.get(item.teamId);
      if(!total||total.doctorIds.has(item.id))continue;
      total.doctorIds.add(item.id);
      const goal=Number(item.target)||0;
      total.target+=goal;
      total.done+=Math.min(Number(item.done)||0,goal);
    }
    // Team has no official provinceId in the legacy schema. Show only actual
    // cities recorded on CURRENT representative area assignments; when no
    // city is recorded, leave province unknown rather than fabricating one.
    const places=new Map(ids.map(id=>[id,new Set()]));
    for(const row of repAreas){
      const name=row.area?.city?.trim();
      const teamId=row.rep?.teamId;
      if(name&&places.has(teamId))places.get(teamId).add(name);
    }
    res.json({teams:teams.map(team=>{
      const total=totals.get(team.id);
      return {...team,
        coverage:total?.target?Math.round(total.done/total.target*100):0,
        coverageDone:total?.done||0,coverageTarget:total?.target||0,
        provinceNames:[...(places.get(team.id)||[])].sort((a,b)=>a.localeCompare(b,'ar'))};
    }),activeTeamId:req.user.teamId});
  });
  // V2 parity: a manager may create a new team in their own company, but
  // is assigned to that team automatically and receives no access to others.
  // Historic visits and all existing team assignments remain untouched.
  route('post','/api/manager/teams',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user);
    checkedInput(req.body,['name','specialties','productIds']);
    const name=requireString(req.body?.name,'اسم الفريق',120);
    const specialties=normalizedStringList(req.body?.specialties??[]);
    const productIds=safeList(req.body?.productIds??[]);
    const team=await auditWrite(req.user,'CREATE','TEAM',value=>value.id,async tx=>{
      const manager=await tx.user.findFirst({where:{
        id:req.user.id,companyId:c,role:'TEAM_MANAGER',active:true
      },select:{id:true,teamId:true,managedTeams:{select:{teamId:true}}}});
      if(!manager)throw new HttpError(403,'مدير الفريق غير نشط');
      // Legacy accounts sometimes have a valid primary teamId but have not
      // yet received their join-table backfill. The first new assignment must
      // not cause that existing team to disappear from the manager session.
      // Only preserve this legacy fallback if there are NO join assignments:
      // a previously revoked team must never be silently granted again.
      if(!manager.managedTeams.length&&manager.teamId){
        const legacyTeam=await tx.team.findFirst({
          where:{id:manager.teamId,companyId:c},select:{id:true}
        });
        if(legacyTeam)await tx.managerTeamAssignment.createMany({
          data:[{managerId:manager.id,teamId:legacyTeam.id}],
          skipDuplicates:true
        });
      }
      if(productIds.length!==await tx.product.count({
        where:{id:{in:productIds},companyId:c,active:true}
      }))throw new HttpError(400,'الأصناف غير متاحة في شركتك');
      return tx.team.create({data:{companyId:c,name,
        managerAssignments:{create:{managerId:req.user.id}},
        specialties:{create:specialties.map(specialty=>({specialty}))},
        products:{create:productIds.map(productId=>({productId}))}
      },include:teamRelations});
    },{isolationLevel:'Serializable'});
    res.status(201).json(team);
  });
  // Switching teams changes only this authenticated session. Every later
  // request recomputes the authorized teams from the database.
  route('post','/api/manager/active-team',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    checkedInput(req.body,['teamId']);
    const teamId=validId(req.body?.teamId);
    if(!(req.user.managedTeamIds||[]).includes(teamId))
      throw new HttpError(403,'الفريق غير معين لهذا المدير');
    await auditWrite(req.user,'UPDATE','MANAGER_ACTIVE_TEAM',teamId,async tx=>{
      return tx.authSession.update({where:{tokenHash:req.sessionHash},
        data:{activeManagerTeamId:teamId}});
    });
    res.json({activeTeamId:teamId});
  });
  route('post','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['name','specialties','productIds','provinceId']);
    const name=requireString(req.body?.name,'team name');
    const provinceId=req.body?.provinceId?validId(req.body.provinceId):null;
    const specialties=normalizedStringList(req.body?.specialties??[]);
    const productIds=safeList(req.body?.productIds??[]);
    const team=await auditWrite(req.user,'CREATE','TEAM',v=>v.id,async(tx)=>{
      if(productIds.length!==await tx.product.count({where:{id:{in:productIds},companyId:c,active:true}}))
        throw new HttpError(400,'المنتج غير تابع للشركة أو غير نشط');
      if(provinceId&&!await tx.province.findFirst({where:{id:provinceId,companyId:c}}))
        throw new HttpError(400,'المحافظة غير تابعة للشركة');
      return tx.team.create({data:{companyId:c,name,provinceId,
        specialties:{create:specialties.map(specialty=>({specialty}))},
        products:{create:productIds.map(productId=>({productId}))}
      },include:teamRelations});
    });
    res.status(201).json(team);
  });
  // Restore the existing legacy team edit workflow without changing memberships or visit history.
  // Omitted fields are left intact; supplied product and specialty arrays replace those sets.
  route('patch','/api/teams/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    const payload=checkedPatch(req.body,['name','specialties','productIds','provinceId']);
    const updates={};
    if(payload.provinceId!==undefined)updates.provinceId=payload.provinceId?
      validId(payload.provinceId):null;
    if(payload.name!==undefined)updates.name=requireString(payload.name,'team name');
    const specialties=payload.specialties===undefined?null:normalizedStringList(payload.specialties);
    const productIds=payload.productIds===undefined?null:safeList(payload.productIds);
    if(!Object.keys(updates).length&&specialties===null&&productIds===null)
      throw new HttpError(400,'لا توجد بيانات لتعديلها');
    const team=await auditWrite(req.user,'UPDATE','TEAM',id,async(tx)=>{
      const existing=await tx.team.findFirst({where:{id,companyId:c},select:{id:true}});
      if(!existing)throw new HttpError(404,'الفريق غير موجود');
      if(updates.provinceId&&!await tx.province.findFirst({where:{id:updates.provinceId,companyId:c}}))
        throw new HttpError(400,'المحافظة غير تابعة للشركة');
      if(productIds!==null){
        if(productIds.length!==await tx.product.count({where:{id:{in:productIds},companyId:c,active:true}}))
          throw new HttpError(400,'المنتج غير تابع للشركة أو غير نشط');
      }
      await tx.team.update({where:{id},data:updates});
      if(specialties!==null){
        await tx.teamSpecialty.deleteMany({where:{teamId:id}});
        if(specialties.length)await tx.teamSpecialty.createMany({
          data:specialties.map(specialty=>({teamId:id,specialty}))
        });
      }
      if(productIds!==null){
        await tx.teamProduct.deleteMany({where:{teamId:id}});
        if(productIds.length)await tx.teamProduct.createMany({
          data:productIds.map(productId=>({teamId:id,productId}))
        });
      }
      return tx.team.findUnique({where:{id},include:teamRelations});
    },{isolationLevel:'Serializable'});
    res.json(team);
  });
  // Replace the ONE team's manager, as in mandob-v2. Never overwrite the
  // old/new manager's assignments on unrelated teams. The expected manager
  // list protects against a stale browser silently clobbering another admin.
  route('patch','/api/teams/:id/manager',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),teamId=validId(req.params.id);
    checkedInput(req.body,['managerId','expectedManagerIds']);
    const managerId=validId(req.body?.managerId);
    const expectedManagerIds=safeList(req.body?.expectedManagerIds).sort();
    let result;
    try{
      result=await auditWrite(req.user,'UPDATE','TEAM_MANAGER_ASSIGNMENT',teamId,async tx=>{
        const team=await tx.team.findFirst({where:{id:teamId,companyId:c},select:{id:true}});
        if(!team)throw new HttpError(404,'الفريق غير موجود ضمن الشركة');
        const selected=await tx.user.findFirst({where:{
          id:managerId,companyId:c,role:'TEAM_MANAGER',active:true
        },select:{id:true,teamId:true}});
        if(!selected)throw new HttpError(404,'مدير الفريق غير موجود أو غير نشط');
        const existing=await tx.managerTeamAssignment.findMany({
          where:{teamId},select:{managerId:true}
        });
        const currentIds=existing.map(row=>row.managerId).sort();
        if(JSON.stringify(currentIds)!==JSON.stringify(expectedManagerIds))
          throw new HttpError(409,'تم تغيير مدير الفريق من جلسة أخرى؛ حدّث البيانات قبل الحفظ');
        for(const previousId of currentIds){
          if(previousId===managerId)continue;
          const previous=await tx.user.findFirst({where:{
            id:previousId,companyId:c,role:'TEAM_MANAGER'
          },select:{id:true,teamId:true}});
          if(!previous)
            throw new HttpError(409,'تعيين مدير قديم غير متسق مع الشركة');
          await tx.managerTeamAssignment.deleteMany({
            where:{teamId,managerId:previousId}
          });
          const remaining=await tx.managerTeamAssignment.findMany({
            where:{managerId:previousId},select:{teamId:true},
            orderBy:{teamId:'asc'}
          });
          const primary=remaining.some(row=>row.teamId===previous.teamId)?
            previous.teamId:remaining[0]?.teamId||null;
          if(primary!==previous.teamId)
            await tx.user.update({where:{id:previousId},data:{teamId:primary}});
          // Active-team selection from a removed team cannot survive a session.
          await tx.authSession.updateMany({
            where:{userId:previousId,activeManagerTeamId:teamId},
            data:{activeManagerTeamId:null}
          });
        }
        if(!currentIds.includes(managerId))
          await tx.managerTeamAssignment.create({data:{teamId,managerId}});
        const ownTeams=await tx.managerTeamAssignment.findMany({
          where:{managerId},select:{teamId:true},orderBy:{teamId:'asc'}
        });
        const newPrimary=ownTeams.some(row=>row.teamId===selected.teamId)?
          selected.teamId:teamId;
        if(newPrimary!==selected.teamId)
          await tx.user.update({where:{id:managerId},data:{teamId:newPrimary}});
        return {teamId,managerId,previousManagerIds:currentIds,
          primaryTeamId:newPrimary};
      },{isolationLevel:'Serializable',maxWait:10000,timeout:20000});
    }catch(error){
      if(error?.code==='P2034')
        throw new HttpError(409,'تزامن تغيير تعيين المدير مع طلب آخر؛ حدّث البيانات وأعد المحاولة');
      throw error;
    }
    res.json(result);
  });
  // The team manager edits instructions for their team, without changing team
  // membership or previous visits. Company admins may edit any of their teams.
  route('patch','/api/teams/:id/instructions',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT),id=validId(req.params.id);
    checkedInput(req.body,['managerInstructions']);
    if(!Object.prototype.hasOwnProperty.call(req.body||{},'managerInstructions'))
      throw new HttpError(400,'يجب إرسال حقل تعليمات المدير');
    if(req.user.role==='TEAM_MANAGER'&&id!==req.user.teamId)
      throw new HttpError(403,'يمكنك تعديل تعليمات فريقك فقط');
    const value=req.body.managerInstructions;
    if(value!==null&&(typeof value!=='string'||value.length>1000))
      throw new HttpError(400,'تعليمات المدير طويلة جداً');
    const team=await auditWrite(req.user,'UPDATE','TEAM_INSTRUCTIONS',id,async(tx)=>{
      const exists=await tx.team.findFirst({where:{id,companyId:c},select:{id:true}});
      if(!exists)throw new HttpError(404,'الفريق غير موجود');
      return tx.team.update({where:{id},data:{managerInstructions:value?.trim()||null},
        select:{id:true,managerInstructions:true}});
    });
    res.json(team);
  });
  // Bounded company-admin-only representative directory. Search and province
  // filters run inside PostgreSQL before paging to reduce payload and DB reads.
  route('get','/api/company/reps',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const limit=safeInt(req.query.limit??20,'limit',1,50);
    const offset=safeInt(req.query.offset??0,'offset',0,100000);
    if(req.query.q!==undefined&&typeof req.query.q!=='string')
      throw new HttpError(400,'البحث غير صالح');
    const q=String(req.query.q||'').trim();
    if(q.length>120)throw new HttpError(400,'البحث طويل جداً');
    const provinceId=req.query.provinceId?validId(req.query.provinceId):null;
    if(provinceId&&!await prisma.province.findFirst({where:{id:provinceId,companyId:c},select:{id:true}}))
      throw new HttpError(400,'المحافظة غير تابعة للشركة');
    const where={companyId:c,role:'REP',
      ...(q?{OR:[{name:{contains:q,mode:'insensitive'}},
        {username:{contains:q,mode:'insensitive'}}]}:{}),
      ...(provinceId?{AND:[{OR:[
        {team:{provinceId}},
        {repAreas:{some:{area:{provinceId}}}}
      ]}]}:{})};
    const [total,items]=await Promise.all([
      prisma.user.count({where}),
      prisma.user.findMany({where,select:{
        id:true,name:true,username:true,active:true,teamId:true,
        team:{select:{id:true,name:true,province:{select:{id:true,name:true}}}},
        repAreas:{select:{area:{select:{id:true,name:true,
          province:{select:{id:true,name:true}},city:true}}}}
      },orderBy:[{name:'asc'},{id:'asc'}],take:limit,skip:offset})
    ]);
    res.json({items,total,limit,offset,hasMore:offset+items.length<total});
  });
  route('get','/api/users',async(req,res)=>{
    onlyCompany(req,MANAGEMENT);
    const where=req.user.role==='TEAM_MANAGER'?
      {companyId:req.user.companyId,teamId:req.user.teamId||'__UNASSIGNED__'}:
      {companyId:req.user.companyId};
    const people=await prisma.user.findMany({where,select:{id:true,name:true,username:true,role:true,
      teamId:true,managedTeams:{select:{teamId:true}},active:true,dailyTarget:true,annualLeaveBalance:true,
      specialtyMode:true,repSpecialties:true,
      repProducts:{include:{product:{select:{id:true,name:true}}}},
      team:{select:{specialties:true,products:{include:{product:{select:{id:true,name:true}}}}}},
      repAreas:{include:{area:true}}},orderBy:[{name:'asc'},{id:'asc'}],
      ...optionalPage(req.query)});
    res.json(people);
  });
  route('post','/api/users',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['role','teamId','teamIds','name','username','password','areaIds',
      'specialtyMode','customSpecialties','customProductIds','provinceId']);
    const {role,teamId}=req.body||{};
    // Legacy company-manager forms may submit a province with the manager.
    // Managers belong to teams (possibly in different provinces); never create
    // an independent manager-province assignment from this optional field.
    const provinceId=req.body?.provinceId?validId(req.body.provinceId):null;
    if(req.body?.provinceId!==undefined&&role!=='TEAM_MANAGER')
      throw new HttpError(400,'المحافظة في هذا الطلب مخصصة لمدير الفريق');
    if(!['REP','TEAM_MANAGER'].includes(role))throw new HttpError(400,'دور غير مسموح');
    const name=requireString(req.body?.name,'name');
    const username=requireString(req.body?.username,'username',150);
    const passwordHash=hashPassword(req.body?.password);
    const areas=safeList(req.body?.areaIds||[]);
    if(role==='REP' && req.body?.teamIds!==undefined)
      throw new HttpError(400,'قائمة الفرق مخصصة لمدير الفريق');
    const managerTeamIds=role==='TEAM_MANAGER'?
      (req.body?.teamIds!==undefined?safeList(req.body.teamIds):
        teamId?[validId(teamId)]:[]):[];
    if(role==='TEAM_MANAGER'&&teamId&&managerTeamIds.length&&
      !managerTeamIds.includes(teamId))
      throw new HttpError(400,'الفريق الأساسي ليس ضمن الفرق المعينة');
    const team=teamId?await prisma.team.findFirst({where:{id:validId(teamId),companyId:c}}):null;
    if(teamId&&!team)throw new HttpError(400,'الفريق غير تابع للشركة');
    if(provinceId&&!await prisma.province.findFirst({where:{id:provinceId,companyId:c}}))
      throw new HttpError(400,'المحافظة غير تابعة للشركة');
    const validAreas=await prisma.area.count({where:{companyId:c,id:{in:areas}}});
    if(validAreas!==areas.length)throw new HttpError(400,'منطقة غير تابعة للشركة');
    const options=parseRepOptions(req.body||{},role,team?.id||null);
    const user=await auditWrite(req.user,'CREATE','USER',v=>v.id,async tx=>{
      if(managerTeamIds.length){
        const count=await tx.team.count({where:{companyId:c,id:{in:managerTeamIds}}});
        if(count!==managerTeamIds.length)throw new HttpError(403,'فريق خارج الشركة');
        if(provinceId){
          const matches=await tx.team.count({where:{
            companyId:c,id:{in:managerTeamIds},provinceId
          }});
          if(matches!==managerTeamIds.length)
            throw new HttpError(400,'المحافظة المحددة لا تطابق محافظة الفرق المختارة');
        }
        const assigned=await tx.managerTeamAssignment.count({where:{
          teamId:{in:managerTeamIds}}});
        if(assigned)throw new HttpError(409,'يوجد مدير آخر معين لأحد الفرق المختارة');
      }
      if(options.products?.length &&
        await tx.product.count({where:{companyId:c,active:true,id:{in:options.products}}})!==options.products.length)
        throw new HttpError(400,'منتج مخصص خارج الشركة أو غير نشط');
      return tx.user.create({data:{companyId:c,role,name,username,passwordHash,
        teamId:role==='TEAM_MANAGER'?(managerTeamIds[0]||null):team?.id,
        managedTeams:role==='TEAM_MANAGER'&&managerTeamIds.length?
          {create:managerTeamIds.map(teamId=>({team:{connect:{id:teamId}}}))}:undefined,
        specialtyMode:options.mode||'TEAM',
        repAreas:{create:areas.map(areaId=>({areaId}))},
        repSpecialties:{create:(options.mode==='CUSTOM'?options.specialties||[]:[]).map(specialty=>({specialty}))},
        repProducts:{create:(options.products||[]).map(productId=>({productId}))}
      }});
    },{isolationLevel:'Serializable'});
    res.status(201).json({user:publicUser(user)});
  });
  // Company-owned assignment replaces the full manager scope atomically.
  // The manager cannot grant themselves access by calling this endpoint.
  route('patch','/api/users/:id/manager-teams',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    checkedInput(req.body,['teamIds']);
    const teamIds=safeList(req.body?.teamIds);
    const result=await auditWrite(req.user,'UPDATE','MANAGER_TEAMS',id,async tx=>{
      const manager=await tx.user.findFirst({where:{id,companyId:c,role:'TEAM_MANAGER'}});
      if(!manager)throw new HttpError(404,'مدير الفريق غير موجود');
      if(teamIds.length!==await tx.team.count({where:{companyId:c,id:{in:teamIds}}}))
        throw new HttpError(403,'تعيين فريق من شركة أخرى غير مسموح');
      if(await tx.managerTeamAssignment.count({where:{
        teamId:{in:teamIds},managerId:{not:id}}}))
        throw new HttpError(409,'يوجد مدير آخر معين لأحد الفرق المختارة');
      await tx.managerTeamAssignment.deleteMany({where:{managerId:id}});
      if(teamIds.length)await tx.managerTeamAssignment.createMany({
        data:teamIds.map(teamId=>({managerId:id,teamId}))});
      const primary=teamIds.includes(manager.teamId)?manager.teamId:teamIds[0]||null;
      await tx.user.update({where:{id},data:{teamId:primary}});
      // A removed assignment is never retained in any logged-in session.
      await tx.authSession.updateMany({where:{userId:id},data:{activeManagerTeamId:null}});
      return {teamIds,primaryTeamId:primary};
    },{isolationLevel:'Serializable'});
    res.json(result);
  });
  route('patch','/api/users/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const id=validId(req.params.id);
    const payload=checkedPatch(req.body,['name','dailyTarget','annualLeaveBalance',
      'active','teamId','teamIds','areaIds','specialtyMode','customSpecialties','customProductIds']);
    const existing=await prisma.user.findFirst({where:{id,companyId:c,role:{in:['REP','TEAM_MANAGER']}}});
    if(!existing)throw new HttpError(404,'المستخدم غير موجود');
    const data={};
    const managerTeamIds=payload.teamIds===undefined?null:safeList(payload.teamIds);
    if(managerTeamIds!==null&&existing.role!=='TEAM_MANAGER')
      throw new HttpError(400,'قائمة فرق المدير ليست للمندوب');
    if(managerTeamIds!==null){
      const count=await prisma.team.count({where:{companyId:c,id:{in:managerTeamIds}}});
      if(count!==managerTeamIds.length)
        throw new HttpError(403,'فريق خارج الشركة');
      data.teamId=managerTeamIds.includes(existing.teamId)?
        existing.teamId:managerTeamIds[0]||null;
    }
    if(payload.name!==undefined)data.name=requireString(payload.name,'name');
    if(payload.dailyTarget!==undefined)data.dailyTarget=safeInt(payload.dailyTarget,'dailyTarget',1,100);
    if(payload.annualLeaveBalance!==undefined)data.annualLeaveBalance=safeInt(payload.annualLeaveBalance,'annualLeaveBalance',0,365);
    if(payload.active!==undefined){
      if(typeof payload.active!=='boolean')throw new HttpError(400,'active');
      data.active=payload.active;
    }
    if(payload.teamId!==undefined){
      if(existing.role==='TEAM_MANAGER')
        throw new HttpError(400,'استخدم تعيين الفرق من مدير الشركة لتعديل فرق المدير');
      if(payload.teamId===null)data.teamId=null;
      else {
        const team=await prisma.team.findFirst({where:{id:validId(payload.teamId),companyId:c}});
        if(!team)throw new HttpError(400,'الفريق غير موجود');
        data.teamId=team.id;
      }
    }
    const teamAfter=data.teamId===undefined?existing.teamId:data.teamId;
    const options=parseRepOptions(payload,existing.role,teamAfter);
    const effectiveMode=options.mode||existing.specialtyMode||'TEAM';
    if(effectiveMode==='TEAM' && options.specialties?.length)
      throw new HttpError(400,'الاختصاصات المخصصة تتطلب وضع CUSTOM');
    if(options.mode!==undefined)data.specialtyMode=options.mode;
    const areaIds=payload.areaIds===undefined?null:safeList(payload.areaIds);
    if(areaIds){
      const validAreas=await prisma.area.count({where:{companyId:c,id:{in:areaIds}}});
      if(validAreas!==areaIds.length)throw new HttpError(400,'منطقة غير تابعة للشركة');
    }
    const user=await auditWrite(req.user,'UPDATE','USER',id,async(tx)=>{
      const updated=await tx.user.update({where:{id},data});
      if(managerTeamIds!==null){
        if(await tx.managerTeamAssignment.count({where:{
          teamId:{in:managerTeamIds},managerId:{not:id}}}))
          throw new HttpError(409,'يوجد مدير آخر معين لأحد الفرق المختارة');
        // Only COMPANY_ADMIN can change an assigned team list, in one audit
        // transaction with user settings. No partial privilege updates.
        await tx.managerTeamAssignment.deleteMany({where:{managerId:id}});
        if(managerTeamIds.length)await tx.managerTeamAssignment.createMany({
          data:managerTeamIds.map(teamId=>({managerId:id,teamId}))});
        await tx.authSession.updateMany({where:{userId:id},data:{activeManagerTeamId:null}});
      }
      if(areaIds!==null){
        await tx.repArea.deleteMany({where:{repId:id}});
        if(areaIds.length)await tx.repArea.createMany({data:areaIds.map(areaId=>({repId:id,areaId}))});
      }
      if(existing.role==='REP'){
        // The legacy team-mode uses team products, while unassigned reps may choose their own.
        if(options.products!==null){
          if(options.products.length!==await tx.product.count({
            where:{companyId:c,active:true,id:{in:options.products}}
          }))throw new HttpError(400,'منتج مخصص خارج الشركة أو غير نشط');
          await tx.repProduct.deleteMany({where:{repId:id}});
          if(options.products.length)await tx.repProduct.createMany({
            data:options.products.map(productId=>({repId:id,productId}))
          });
        }else if(teamAfter && payload.teamId!==undefined){
          await tx.repProduct.deleteMany({where:{repId:id}});
        }
        if(options.mode==='TEAM'||options.specialties!==null){
          await tx.repSpecialty.deleteMany({where:{repId:id}});
          if(options.mode!=='TEAM'&&options.specialties?.length)await tx.repSpecialty.createMany({
            data:options.specialties.map(specialty=>({repId:id,specialty}))
          });
        }
      }
      if(payload.active===false)await tx.authSession.deleteMany({where:{userId:id}});
      return updated;
    },{isolationLevel:'Serializable'});
    res.json({user:publicUser(user)});
  });
  route('get','/api/area-groups',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    // A team manager must not see unrelated area groups or their full tenant counts.
    const teamAreas={repAreas:{some:{rep:teamRepCriteria(req.user)}}};
    const isManager=req.user.role==='TEAM_MANAGER';
    const groups=await prisma.areaGroup.findMany({
      where:{companyId:c,...(isManager?{areas:{some:teamAreas}}:{})},
      include:{_count:{select:{areas:isManager?{where:teamAreas}:true}}},
      orderBy:[{sortOrder:'asc'},{name:'asc'}]
    });
    res.json(groups);
  });
  route('post','/api/area-groups',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['name','provinceId']);
    const name=requireString(req.body?.name,'group name',120);
    const provinceId=req.body?.provinceId?validId(req.body.provinceId):null;
    const group=await auditWrite(req.user,'CREATE','AREA_GROUP',v=>v.id,async tx=>{
      if(provinceId&&!await tx.province.findFirst({where:{id:provinceId,companyId:c}}))
        throw new HttpError(400,'المحافظة غير تابعة للشركة');
      const last=await tx.areaGroup.findFirst({
        where:{companyId:c},orderBy:{sortOrder:'desc'},select:{sortOrder:true}
      });
      return tx.areaGroup.create({data:{companyId:c,name,provinceId,
        sortOrder:(last?.sortOrder||0)+1}});
    });
    res.status(201).json(group);
  });
  // Legacy representative-targeted directory, read-only and scoped to role/company.
  // This does not change the existing tour submission contract.
  route('get','/api/reps/:repId/doctors',async(req,res)=>{
    const c=requireCompany(req),id=validId(req.params.repId);
    const rep=await prisma.user.findFirst({
      where:{id,companyId:c,role:'REP'},
      include:{repSpecialties:true,team:{include:{specialties:true}}}
    });
    if(!rep)throw new HttpError(404,'المندوب غير موجود');
    if(!managerCanSeeRep(req.user,rep))throw new HttpError(403,'غير مسموح بعرض أطباء المندوب');
    const where=doctorTargetWhere(rep,c);
    if(!where)return res.json([]);
    // Opt-in paging keeps the old no-query response contract for existing clients.
    const q=req.query||{},paged=q.limit!==undefined||q.offset!==undefined;
    const take=paged?safeInt(q.limit??500,'limit',1,500):1001;
    const skip=paged?safeInt(q.offset??0,'offset',0,100000):0;
    const doctors=await prisma.doctor.findMany({where,
      include:{area:{select:{id:true,name:true}},
        doctorAreas:{include:{area:{select:{id:true,name:true}}}}},
      orderBy:[{name:'asc'},{id:'asc'}],take,skip});
    if(!paged&&doctors.length>1000)
      throw new HttpError(413,'عدد الأطباء كبير، يلزم تقسيم القائمة');
    res.json(doctors);
  });
  // The old weekly counter counted targets, not number of submitted tours.
  // Saturdays begin the week, as in the legacy app. Use a calendar reference date
  // so browser timezone cannot silently change the requested week.
  route('get','/api/weekly-visits-count',async(req,res)=>{
    const c=requireCompany(req);
    const requested=req.query?.repId||(req.user.role==='REP'?req.user.id:null);
    const repId=validId(requested);
    const rep=await prisma.user.findFirst({where:{id:repId,companyId:c,role:'REP'},
      select:{id:true,companyId:true,role:true,teamId:true}});
    if(!rep)throw new HttpError(404,'المندوب غير موجود');
    if(!managerCanSeeRep(req.user,rep))throw new HttpError(403,'غير مسموح بعرض زيارات المندوب');
    const date=asDate(req.query?.onDate||new Date().toISOString().slice(0,10));
    const start=new Date(date);
    start.setUTCDate(date.getUTCDate()-((date.getUTCDay()+1)%7));
    const end=new Date(start);
    end.setUTCDate(start.getUTCDate()+6);
    const where={companyId:c,repId,visitDate:{gte:start,lte:end}};
    const [visits,count]=await Promise.all([
      prisma.visit.count({where}),
      prisma.visitTarget.count({where:{visit:where}})
    ]);
    res.json({repId,start:formatDate(start),end:formatDate(end),visits,count});
  });
  // Restored manager dashboard: precise calendar-week activity, rather than
  // counting every historical visit that happened on the same weekday.
  // Restore the legacy manager's *own team* member controls. A manager cannot
  // create a company-level team, move people to another team, or assign
  // unrelated company areas. All changes are audited transactionally.
  route('post','/api/manager/reps',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),teamId=req.user.teamId;
    if(!teamId)throw new HttpError(403,'ليس لديك فريق معين');
    checkedInput(req.body,['name','username','password','dailyTarget','areaIds',
      'specialtyMode','customSpecialties']);
    const name=requireString(req.body?.name,'اسم المندوب');
    const username=requireString(req.body?.username,'اسم المستخدم',150);
    const passwordHash=hashPassword(req.body?.password);
    const dailyTarget=safeInt(req.body?.dailyTarget??8,'الهدف اليومي',1,100);
    const areaIds=safeList(req.body?.areaIds??[]);
    const options=parseRepOptions(req.body,'REP',teamId);
    if(options.mode==='TEAM'&&options.specialties?.length)
      throw new HttpError(400,'الاختصاصات المخصصة تتطلب CUSTOM');
    const created=await auditWrite(req.user,'CREATE','USER',row=>row.id,async tx=>{
      const team=await tx.team.findFirst({where:{id:teamId,companyId:c}});
      if(!team)throw new HttpError(403,'الفريق غير موجود');
      if(areaIds.length){
        const available=await tx.area.count({where:{id:{in:areaIds},companyId:c,
          repAreas:{some:{rep:teamRepCriteria(req.user)}}}});
        if(available!==areaIds.length)
          throw new HttpError(403,'يمكنك استخدام المناطق الموزعة لفريقك فقط');
      }
      return tx.user.create({data:{companyId:c,teamId,role:'REP',name,username,
        passwordHash,dailyTarget,
        specialtyMode:options.mode||'TEAM',
        ...(areaIds.length?{repAreas:{create:areaIds.map(areaId=>({areaId}))}}:{}),
        ...(options.specialties?.length?{
          repSpecialties:{create:options.specialties.map(specialty=>({specialty}))}}:{})
      }});
    },{isolationLevel:'Serializable'});
    res.status(201).json({user:publicUser(created)});
  });
  route('patch','/api/manager/reps/:id',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=validId(req.params.id);
    const p=checkedPatch(req.body,['name','dailyTarget','annualLeaveBalance',
      'areaIds','specialtyMode','customSpecialties']);
    const data={};
    if(p.name!==undefined)data.name=requireString(p.name,'اسم المندوب');
    if(p.dailyTarget!==undefined)data.dailyTarget=safeInt(p.dailyTarget,'الهدف اليومي',1,100);
    if(p.annualLeaveBalance!==undefined)data.annualLeaveBalance=
      safeInt(p.annualLeaveBalance,'رصيد الإجازة',0,365);
    const ids=p.areaIds===undefined?null:safeList(p.areaIds);
    const options=parseRepOptions(p,'REP',req.user.teamId);
    if(options.mode!==undefined)data.specialtyMode=options.mode;
    if(!Object.keys(data).length&&ids===null&&
      options.specialties===null)throw new HttpError(400,'لا توجد تغييرات');
    const updated=await auditWrite(req.user,'UPDATE','USER',id,async tx=>{
      const rep=await tx.user.findFirst({
        where:{id,...teamRepCriteria(req.user)},
        select:{id:true,specialtyMode:true}});
      if(!rep)throw new HttpError(404,'المندوب غير موجود بفريقك');
      const mode=options.mode||rep.specialtyMode;
      if(mode==='TEAM'&&options.specialties?.length)
        throw new HttpError(400,'الاختصاصات المخصصة تتطلب CUSTOM');
      if(ids!==null && ids.length){
        const existing=await tx.area.count({where:{id:{in:ids},companyId:c,
          repAreas:{some:{rep:teamRepCriteria(req.user)}}}});
        if(existing!==ids.length)
          throw new HttpError(403,'المناطق يجب أن تكون ضمن مناطق الفريق');
      }
      const result=await tx.user.update({where:{id},data});
      if(ids!==null){
        await tx.repArea.deleteMany({where:{repId:id}});
        if(ids.length)await tx.repArea.createMany({data:ids.map(areaId=>({repId:id,areaId}))});
      }
      if(options.mode==='TEAM'||options.specialties!==null){
        await tx.repSpecialty.deleteMany({where:{repId:id}});
        if(options.mode!=='TEAM'&&options.specialties?.length)
          await tx.repSpecialty.createMany({data:options.specialties.map(specialty=>({
            repId:id,specialty}))});
      }
      return result;
    },{isolationLevel:'Serializable'});
    res.json({user:publicUser(updated)});
  });
  route('patch','/api/manager/team',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=req.user.teamId;
    if(!id)throw new HttpError(403,'ليس لديك فريق معين');
    const p=checkedPatch(req.body,['name','specialties','productIds']);
    const changes={};
    if(p.name!==undefined)changes.name=requireString(p.name,'اسم الفريق');
    const specialties=p.specialties===undefined?null:normalizedStringList(p.specialties);
    const productIds=p.productIds===undefined?null:safeList(p.productIds);
    if(!Object.keys(changes).length&&specialties===null&&productIds===null)
      throw new HttpError(400,'لا توجد تغييرات');
    const team=await auditWrite(req.user,'UPDATE','TEAM',id,async tx=>{
      const owned=await tx.team.findFirst({where:{id,companyId:c}});
      if(!owned)throw new HttpError(404,'الفريق غير موجود');
      if(productIds!==null){
        const count=await tx.product.count({where:{companyId:c,active:true,id:{in:productIds}}});
        if(count!==productIds.length)throw new HttpError(400,'أصناف غير صالحة');
      }
      await tx.team.update({where:{id},data:changes});
      if(specialties!==null){
        await tx.teamSpecialty.deleteMany({where:{teamId:id}});
        if(specialties.length)await tx.teamSpecialty.createMany({
          data:specialties.map(specialty=>({teamId:id,specialty}))});
      }
      if(productIds!==null){
        await tx.teamProduct.deleteMany({where:{teamId:id}});
        if(productIds.length)await tx.teamProduct.createMany({
          data:productIds.map(productId=>({teamId:id,productId}))});
      }
      return tx.team.findUnique({where:{id},include:teamRelations});
    },{isolationLevel:'Serializable'});
    res.json(team);
  });

  // Create team-linked areas and optional new area group together, so the
  // manager never creates a detached global area or an invisible empty group.
  route('post','/api/manager/areas',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user);
    if(!req.user.teamId)throw new HttpError(403,'فريق المدير غير محدد');
    checkedInput(req.body,['name','city','groupId','newGroupName','repIds']);
    const name=requireString(req.body?.name,'اسم المنطقة');
    const city=req.body?.city?requireString(req.body.city,'المحافظة',120):null;
    const repIds=safeList(req.body?.repIds||[]);
    if(!repIds.length)throw new HttpError(400,'اختر مندوباً واحداً على الأقل');
    if(req.body?.groupId&&req.body?.newGroupName)
      throw new HttpError(400,'اختر مجموعة موجودة أو جديدة فقط');
    const groupId=req.body?.groupId?validId(req.body.groupId):null;
    const newGroupName=req.body?.newGroupName?
      requireString(req.body.newGroupName,'اسم المجموعة',120):null;
    const created=await auditWrite(req.user,'CREATE','AREA',row=>row.id,async tx=>{
      const owned=await tx.user.count({where:{id:{in:repIds},...teamRepCriteria(req.user)}});
      if(owned!==repIds.length)throw new HttpError(403,'المندوبون يجب أن يكونوا ضمن فريقك');
      if(groupId){
        const available=await tx.areaGroup.findFirst({
          where:{id:groupId,companyId:c,areas:{
            some:{repAreas:{some:{rep:teamRepCriteria(req.user)}}}}}});
        if(!available)throw new HttpError(403,'المجموعة غير متاحة لفريقك');
      }
      const group=newGroupName?await tx.areaGroup.create({
        data:{companyId:c,name:newGroupName}}):null;
      return tx.area.create({data:{companyId:c,name,city,
        groupId:group?.id||groupId,
        repAreas:{create:repIds.map(repId=>({repId}))}},
        include:{group:true,repAreas:true}});
    },{isolationLevel:'Serializable'});
    res.status(201).json(created);
  });
  route('patch','/api/manager/areas/:id',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=validId(req.params.id);
    const p=checkedPatch(req.body,['name','city','groupId']);
    const changes={};
    if(p.name!==undefined)changes.name=requireString(p.name,'اسم المنطقة');
    if(p.city!==undefined)changes.city=
      p.city===null||p.city===''?null:requireString(p.city,'المحافظة',120);
    if(p.groupId!==undefined)changes.groupId=
      p.groupId===null||p.groupId===''?null:validId(p.groupId);
    if(!Object.keys(changes).length)throw new HttpError(400,'لا توجد تغييرات');
    const area=await auditWrite(req.user,'UPDATE','AREA',id,async tx=>{
      const existing=await tx.area.findFirst({where:{id,companyId:c,
        repAreas:{some:{rep:teamRepCriteria(req.user)}}},
        select:{id:true}});
      if(!existing)throw new HttpError(404,'المنطقة غير موجودة ضمن فريقك');
      // A shared area may be assigned to another team. Its metadata is
      // company-wide and therefore not editable by one of the managers.
      const otherTeam=await tx.repArea.count({where:{areaId:id,
        rep:{companyId:c,role:'REP',OR:[
          {teamId:null},{teamId:{not:req.user.teamId}}]}}});
      if(otherTeam)throw new HttpError(403,
        'هذه المنطقة مشتركة مع فريق آخر، يجب تعديلها من مدير الشركة');
      if(changes.groupId){
        const group=await tx.areaGroup.findFirst({where:{id:changes.groupId,
          companyId:c,areas:{some:{repAreas:{some:{
            rep:teamRepCriteria(req.user)}}}}},select:{id:true}});
        if(!group)throw new HttpError(403,'المجموعة خارج مناطق الفريق');
      }
      return tx.area.update({where:{id},data:changes});
    },{isolationLevel:'Serializable'});
    res.json(area);
  });

  // Per-representative area performance follows the recorded area of each
  // visit target. Moving a doctor/rep later never rewrites old attribution.
  route('get','/api/manager/areas/:id/performance',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=validId(req.params.id);
    const area=await prisma.area.findFirst({where:{id,companyId:c,
      repAreas:{some:{rep:teamRepCriteria(req.user)}}},
      select:{id:true,name:true,group:{select:{name:true}}}});
    if(!area)throw new HttpError(404,'المنطقة غير موجودة بفريقك');
    const [reps,doctors,settings]=await Promise.all([
      prisma.user.findMany({where:{...teamRepCriteria(req.user),
        repAreas:{some:{areaId:id}}},select:{
        id:true,name:true,team:{select:{name:true}}},orderBy:{name:'asc'}}),
      prisma.doctor.findMany({where:{companyId:c,active:true,OR:[
        {areaId:id},{doctorAreas:{some:{areaId:id}}}]},
        select:{id:true,grade:true}}),
      prisma.companySettings.findUnique({where:{companyId:c}})
    ]);
    const {start,end}=cycleBounds(settings);
    const doctorIds=doctors.map(row=>row.id),repIds=reps.map(row=>row.id);
    const [records,goals,teamGoals]=await Promise.all([
      repIds.length&&doctorIds.length?prisma.visitTarget.findMany({
        where:{areaIdAtVisit:id,doctorId:{in:doctorIds},
          visit:{companyId:c,teamIdAtVisit:req.user.teamId,
            repId:{in:repIds},type:'DOCTOR',visitDate:{gte:start,lte:end}}},
        select:{doctorId:true,visit:{select:{repId:true}}},take:5001}):[],
      repIds.length&&doctorIds.length?prisma.doctorVisitGoal.findMany({
        where:{companyId:c,scope:'REP',ownerId:{in:repIds},
          doctorId:{in:doctorIds},cycleStart:start,cycleEnd:end},
        select:{ownerId:true,doctorId:true,target:true}}):[],
      doctorIds.length?prisma.doctorVisitGoal.findMany({
        where:{companyId:c,scope:'TEAM',ownerId:req.user.teamId,
          doctorId:{in:doctorIds},cycleStart:start,cycleEnd:end},
        select:{doctorId:true,target:true}}):[]
    ]);
    if(records.length>5000)throw new HttpError(413,
      'الزيارات كثيرة جداً لعرض التفاصيل مرة واحدة');
    const done=new Map(),goalMap=new Map(goals.map(goal=>[
      goal.ownerId+':'+goal.doctorId,goal.target]));
    const teamGoalMap=new Map(teamGoals.map(goal=>[goal.doctorId,goal.target]));
    for(const row of records){
      const key=row.visit.repId+':'+row.doctorId;
      done.set(key,(done.get(key)||0)+1);
    }
    const defaultGoal=doctor=>doctor.grade==='A'?settings?.frequencyA??4:
      doctor.grade==='B'?settings?.frequencyB??2:settings?.frequencyC??1;
    const details=reps.map(rep=>{
      const goalFor=doctor=>goalMap.get(rep.id+':'+doctor.id)??
        teamGoalMap.get(doctor.id)??defaultGoal(doctor);
      const target=doctors.reduce((n,doctor)=>n+goalFor(doctor),0);
      const covered=doctors.reduce((n,doctor)=>n+
        Math.min(goalFor(doctor),done.get(rep.id+':'+doctor.id)||0),0);
      const completedVisits=doctors.reduce((n,doctor)=>n+
        (done.get(rep.id+':'+doctor.id)||0),0);
      const visitedDoctors=doctors.filter(doctor=>done.get(rep.id+':'+doctor.id)>0).length;
      return {id:rep.id,name:rep.name,teamName:rep.team?.name||'فريقك',
        coverage:target?Math.round(covered/target*100):0,
        visitedDoctors,doctorsCount:doctors.length,
        completedVisits,requiredVisits:target};
    });
    res.json({area,cycle:{start:formatDate(start),end:formatDate(end),
      frequency:{A:settings?.frequencyA??4,B:settings?.frequencyB??2,
        C:settings?.frequencyC??1}},reps:details});
  });

  // Exact medical history across all visits; the old UI's last-200-visit
  // approximation can incorrectly say "never visited" after pagination.
  // Accurate manager analytics for the requested cycle/week/month, without
  // relying on just the first 200 historical tour records.
  route('get','/api/manager/visit-distribution',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),teamId=req.user.teamId;
    if(!teamId)throw new HttpError(403,'لم يتم تحديد فريق');
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start,end}=cycleBounds(settings);
    const period=req.query?.period||'cycle';
    const {start:from,end:to}=periodWindow(start,end,period,req.query?.onDate);
    const where={companyId:c,teamIdAtVisit:teamId,visitDate:{gte:from,lte:to}};
    const [byType,byRep,roster,productPromotions]=await Promise.all([
      prisma.visit.groupBy({by:['type'],where,_count:{_all:true}}),
      prisma.$queryRaw`SELECT v."repId" AS "repId", COUNT(t."id")::integer AS "count"
        FROM "Visit" v INNER JOIN "VisitTarget" t ON t."visitId"=v."id"
        WHERE v."companyId"=${c} AND v."teamIdAtVisit"=${teamId}
          AND v."visitDate">=${from} AND v."visitDate"<=${to}
        GROUP BY v."repId"`,
      prisma.user.findMany({where:teamRepCriteria(req.user),
        select:{id:true,name:true,dailyTarget:true},orderBy:{name:'asc'}}),
      prisma.visitProduct.groupBy({
        by:['productId'],where:{visit:where},
        _count:{_all:true},_sum:{quantity:true}
      })
    ]);
    const promotedProducts=productPromotions.length?
      await prisma.product.findMany({
        where:{companyId:c,id:{in:productPromotions.map(row=>row.productId)}},
        select:{id:true,name:true}
      }):[];
    const productNames=new Map(promotedProducts.map(product=>[product.id,product.name]));
    const byProduct=productPromotions.map(row=>({
      id:row.productId,name:productNames.get(row.productId)||'صنف غير معروف',
      promotions:row._count._all,quantity:row._sum.quantity||0
    })).sort((a,b)=>b.promotions-a.promotions||a.name.localeCompare(b.name,'ar'));
    const repCounts=new Map(byRep.map(item=>[item.repId,item.count]));
    const workdaySet=new Set(Array.isArray(settings?.workingDays)?
      settings.workingDays:[0,1,2,3,4,6]);
    const todayUtc=asDate(new Date().toISOString().slice(0,10));
    let elapsedWorkingDays=0;
    const totalSpan=Math.round((to-from)/86400000);
    if(totalSpan>=0&&totalSpan<=366){
      for(let time=from.getTime();time<=Math.min(to.getTime(),todayUtc.getTime());
        time+=86400000){
        if(workdaySet.has(new Date(time).getUTCDay()))elapsedWorkingDays++;
      }
    }
    res.json({period,from:formatDate(from),to:formatDate(to),
      byType:Object.fromEntries(['DOCTOR','PHARMACY','HOSPITAL'].map(type=>[
        type,byType.find(item=>item.type===type)?._count._all||0])),
      byRep:roster.map(rep=>{
        const done=repCounts.get(rep.id)||0,target=elapsedWorkingDays*rep.dailyTarget;
        return {id:rep.id,name:rep.name,done,target,
          coverage:target?Math.min(100,Math.round(done/target*100)):null};
      }),byProduct,elapsedWorkingDays});
  });
  route('get','/api/manager/medical-stats',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const kind=req.query?.kind;
    const fields={doctors:{model:'doctor',column:'doctorId'},
      pharmacies:{model:'pharmacy',column:'pharmacyId'},
      hospitals:{model:'hospital',column:'hospitalId'}};
    if(!Object.prototype.hasOwnProperty.call(fields,kind))
      throw new HttpError(400,'نوع الجهة غير صالح');
    const c=companyId(req.user),info=fields[kind];
    const where={...(kind==='doctors'?doctorFilter(req.user):entityFilter(req.user)),
      active:true};
    const entities=await prisma[info.model].findMany({where,
      select:{id:true},take:2001});
    if(entities.length>2000)throw new HttpError(413,'عدد الجهات كبير جداً');
    if(!entities.length)return res.json([]);
    const ids=entities.map(item=>item.id);
    const column=Prisma.raw('t."'+info.column+'"');
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start,end}=cycleBounds(settings);
    const stats=await prisma.$queryRaw(Prisma.sql`
      SELECT ${column} AS "entityId",
        MAX(v."visitDate") AS "lastDate",
        COUNT(*)::integer AS "total",
        COUNT(*) FILTER (WHERE v."visitDate">=${start}
          AND v."visitDate"<=${end})::integer AS "cycleCount"
      FROM "VisitTarget" t
      INNER JOIN "Visit" v ON v."id"=t."visitId"
      WHERE ${column} IN (${Prisma.join(ids)})
        AND v."companyId"=${c} AND v."teamIdAtVisit"=${req.user.teamId}
      GROUP BY ${column}`);
    res.json(stats.map(row=>({
      id:row.entityId,lastVisit:formatDate(row.lastDate),
      total:row.total,cycleCount:row.cycleCount
    })));
  });

  route('get','/api/manager/team-weekly-activity',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user);
    if(!req.user.teamId)throw new HttpError(403,'لم يتم ربط المدير بفريق');
    const onDate=asDate(req.query?.onDate||new Date().toISOString().slice(0,10));
    const windowMode=req.query?.window||'week';
    if(!['week','last7'].includes(windowMode))
      throw new HttpError(400,'نافذة الإحصاءات غير صالحة');
    const {start,end}=managerActivityWindow(onDate,windowMode);
    // The new rolling window is opt-in: old weekly cards retain Saturday-Friday.
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start:cycleStart,end:cycleEnd}=cycleBounds(settings);
    const [byDay,byRep,lastActivity,cycleByRep]=await Promise.all([
      // Counts are target visits, not tours. Filter in PostgreSQL before grouping.
      prisma.$queryRaw`SELECT v."visitDate" AS "visitDate", COUNT(t."id")::integer AS "count"
        FROM "Visit" v INNER JOIN "VisitTarget" t ON t."visitId"=v."id"
        WHERE v."companyId"=${c} AND v."teamIdAtVisit"=${req.user.teamId}
          AND v."visitDate">=${start} AND v."visitDate"<=${end}
        GROUP BY v."visitDate"`,
      prisma.$queryRaw`SELECT v."repId" AS "repId", COUNT(t."id")::integer AS "count"
        FROM "Visit" v INNER JOIN "VisitTarget" t ON t."visitId"=v."id"
        WHERE v."companyId"=${c} AND v."teamIdAtVisit"=${req.user.teamId}
          AND v."visitDate">=${start} AND v."visitDate"<=${end}
        GROUP BY v."repId"`,
      prisma.visit.groupBy({by:['repId'],where:{companyId:c,teamIdAtVisit:req.user.teamId},
        _max:{visitDate:true}}),
      // Active-cycle representative target visits, not the seven-day chart.
      // Historical attribution stays with the team that received each visit.
      prisma.$queryRaw`SELECT v."repId" AS "repId",
          COUNT(t."id")::integer AS "count",
          MAX(v."visitDate") AS "lastVisit"
        FROM "Visit" v INNER JOIN "VisitTarget" t ON t."visitId"=v."id"
        WHERE v."companyId"=${c} AND v."teamIdAtVisit"=${req.user.teamId}
          AND v."visitDate">=${cycleStart} AND v."visitDate"<=${cycleEnd}
        GROUP BY v."repId"`
    ]);
    const countsByDate=new Map(byDay.map(row=>[formatDate(row.visitDate),row.count]));
    const days=Array.from({length:7},(_,i)=>{
      const day=new Date(start);
      day.setUTCDate(start.getUTCDate()+i);
      return {date:formatDate(day),weekday:day.getUTCDay(),
        count:countsByDate.get(formatDate(day))||0};
    });
    res.json({start:formatDate(start),end:formatDate(end),days,
      perRep:byRep.map(row=>({repId:row.repId,count:row.count})),
      lastByRep:lastActivity.map(row=>({repId:row.repId,lastVisit:formatDate(row._max.visitDate)})),
      cycleByRep:cycleByRep.map(row=>({
        repId:row.repId,count:row.count,lastVisit:formatDate(row.lastVisit)
      }))});
  });
  // Manager-only complete detail view of one *currently assigned* representative.
  // Target totals are counted in PostgreSQL; only 100 recent tours are shipped.
  // The V2 representative detail uses the *same* allowed doctor directory
  // as visit submission. The rep's current team, permitted specialties and
  // assigned areas determine eligible entities. Visit counts are credited only
  // to this manager's active team at visit time, never another team.
  route('get','/api/manager/reps/:id/v2-targets',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=validId(req.params.id);
    const rep=await prisma.user.findFirst({
      where:{id,...teamRepCriteria(req.user)},
      include:{repAreas:{select:{areaId:true,area:{select:{id:true,name:true}}}},
        repSpecialties:true,team:{include:{specialties:true}}}
    });
    if(!rep)throw new HttpError(404,'المندوب غير موجود ضمن فريقك');
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start,end}=cycleBounds(settings);
    const areaIds=[...new Set(rep.repAreas.map(link=>link.areaId))];
    const whereDoctors=doctorTargetWhere(rep,c);
    const [doctors,pharmacies,hospitals]=await Promise.all([
      whereDoctors?prisma.doctor.findMany({
        where:whereDoctors,
        include:{area:{select:{id:true,name:true}},
          doctorAreas:{include:{area:{select:{id:true,name:true}}}}},
        orderBy:[{name:'asc'},{id:'asc'}],take:1001
      }):Promise.resolve([]),
      areaIds.length?prisma.pharmacy.findMany({
        where:{companyId:c,active:true,areaId:{in:areaIds}},
        include:{area:{select:{id:true,name:true}}},
        orderBy:[{name:'asc'},{id:'asc'}],take:1001
      }):Promise.resolve([]),
      areaIds.length?prisma.hospital.findMany({
        where:{companyId:c,active:true,areaId:{in:areaIds}},
        include:{area:{select:{id:true,name:true}}},
        orderBy:[{name:'asc'},{id:'asc'}],take:1001
      }):Promise.resolve([])
    ]);
    if([doctors,pharmacies,hospitals].some(rows=>rows.length>1000))
      throw new HttpError(413,'عدد الجهات كبير جداً؛ يلزم تقسيم القائمة');
    const doctorIds=doctors.map(d=>d.id);
    const goals=doctorIds.length?await prisma.doctorVisitGoal.findMany({
      where:{companyId:c,cycleStart:start,cycleEnd:end,doctorId:{in:doctorIds},
        OR:[{scope:'REP',ownerId:id},{scope:'TEAM',ownerId:req.user.teamId}]},
      select:{scope:true,ownerId:true,doctorId:true,target:true}
    }):[];
    const byGoal=new Map(goals.map(goal=>[
      goal.scope+':'+goal.ownerId+':'+goal.doctorId,goal.target
    ]));
    const completed=new Map(),lastVisited=new Map();
    let cursor,loaded=0;
    for(;;){
      const page=await prisma.visitTarget.findMany({
        where:{visit:{companyId:c,repId:id,teamIdAtVisit:req.user.teamId,
          visitDate:{gte:start,lte:end}}},
        select:{id:true,doctorId:true,pharmacyId:true,hospitalId:true,
          visit:{select:{visitDate:true}}},
        orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})
      });
      loaded+=page.length;
      if(loaded>100000)throw new HttpError(413,'عدد الزيارات كبير جداً؛ يلزم تقسيم التقرير');
      for(const row of page){
        const type=row.doctorId?'DOCTOR':row.pharmacyId?'PHARMACY':
          row.hospitalId?'HOSPITAL':null;
        const targetId=row.doctorId||row.pharmacyId||row.hospitalId;
        if(!type||!targetId)continue;
        const key=type+':'+targetId;
        completed.set(key,(completed.get(key)||0)+1);
        const date=formatDate(row.visit.visitDate);
        if(date>(lastVisited.get(key)||''))lastVisited.set(key,date);
      }
      if(page.length<500)break;
      cursor=page[page.length-1].id;
    }
    const build=(row,type,required,areas,classCode,specialties)=>{
      const key=type+':'+row.id;
      const done=completed.get(key)||0;
      const goal=Math.max(0,Number(required)||0);
      const progress=done===0?'UNVISITED':done>=goal?'COMPLETE':'INCOMPLETE';
      const named=[...new Map(areas.filter(Boolean).map(a=>[a.id,a])).values()];
      return {key,id:row.id,type,name:row.name,repId:id,repName:rep.name,
        teamId:req.user.teamId,teamName:rep.team?.name||'—',
        classCode:String(classCode||'—'),specialtyId:specialties[0]||null,
        specialties,areas:named,
        requiredVisits:goal,completedVisits:done,
        remainingVisits:Math.max(0,goal-done),lastVisit:lastVisited.get(key)||null,
        coverage:goal?Math.min(100,Math.round(done/goal*100)):0,
        progressStatus:progress};
    };
    const doctorTargets=doctors.map(d=>{
      const target=byGoal.get('REP:'+id+':'+d.id)??
        byGoal.get('TEAM:'+req.user.teamId+':'+d.id)??
        (d.grade==='A'?settings?.frequencyA??4:
          d.grade==='B'?settings?.frequencyB??2:settings?.frequencyC??1);
      return build(d,'DOCTOR',target,
        [d.area,...d.doctorAreas.map(link=>link.area)],d.grade,[d.specialty]);
    });
    const otherTargets=[
      ...pharmacies.map(p=>build(p,'PHARMACY',p.target,[p.area],p.grade,
        [p.kind||'صيدلية'])),
      ...hospitals.map(h=>build(h,'HOSPITAL',h.target,[h.area],h.category,
        [h.specialty||'مشفى']))
    ];
    const targets=[...doctorTargets,...otherTargets];
    const required=targets.reduce((sum,t)=>sum+t.requiredVisits,0);
    const done=targets.reduce((sum,t)=>sum+
      Math.min(t.completedVisits,t.requiredVisits),0);
    const doctorProgress={
      uniqueDoctors:new Set(doctorTargets.map(t=>t.id)).size,
      assignments:doctorTargets.length,
      unvisited:doctorTargets.filter(t=>t.progressStatus==='UNVISITED').length,
      incomplete:doctorTargets.filter(t=>t.progressStatus==='INCOMPLETE').length,
      complete:doctorTargets.filter(t=>t.progressStatus==='COMPLETE').length
    };
    res.json({cycle:{start:formatDate(start),end:formatDate(end)},
      teamName:rep.team?.name||'—',doctorProgress,doctorTargets,otherTargets,
      totals:{completedVisits:loaded,requiredVisits:required,
        coverage:required?Math.round(done/required*100):0}});
  });

  route('get','/api/manager/reps/:id/detail',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),id=validId(req.params.id);
    const rep=await prisma.user.findFirst({where:{id,...teamRepCriteria(req.user)},
      select:{id:true,name:true,username:true,active:true,teamId:true,dailyTarget:true,
        annualLeaveBalance:true,repAreas:{include:{area:{select:{id:true,name:true,city:true}}}},
        repSpecialties:true}});
    if(!rep)throw new HttpError(404,'المندوب غير موجود ضمن فريقك');
    const period=req.query?.period||'cycle';
    if(!['cycle','week','month','all'].includes(period))
      throw new HttpError(400,'فترة الزيارات غير صحيحة');
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const cycle=cycleBounds(settings);
    const year=new Date().getUTCFullYear();
    const leaveYearStart=new Date(Date.UTC(year,0,1));
    const leaveYearEnd=new Date(Date.UTC(year,11,31));
    const bounds=period==='all'?null:periodWindow(
      cycle.start,cycle.end,period,req.query?.onDate);
    // Only tours attributed to this team at visit time belong in the manager
    // drilldown, even if the representative previously worked for another team.
    const where={companyId:c,repId:id,teamIdAtVisit:req.user.teamId,
      ...(bounds?{visitDate:{gte:bounds.start,lte:bounds.end}}:{})};
    const [tours,types,targets,latest,lastRows,approvedAnnualLeaves]=await Promise.all([
      prisma.visit.count({where}),
      prisma.visit.groupBy({by:['type'],where,_count:{_all:true}}),
      Promise.all(['DOCTOR','PHARMACY','HOSPITAL'].map(type=>
        prisma.visitTarget.count({where:{visit:{...where,type}}}))),
      prisma.visit.findFirst({where:{companyId:c,repId:id,
        teamIdAtVisit:req.user.teamId},orderBy:[
        {visitDate:'desc'},{createdAt:'desc'}],select:{visitDate:true}}),
      prisma.visit.findMany({
        where,
        take:100,
        orderBy:[{visitDate:'desc'},{createdAt:'desc'}],
        select:{
          id:true,type:true,visitDate:true,createdAt:true,note:true,
          targets:{select:{
            id:true,
            doctor:{select:{name:true}},
            pharmacy:{select:{name:true}},
            hospital:{select:{name:true}},
            areaAtVisit:{select:{name:true}}
          }}
        }
      }),
      prisma.leaveRequest.findMany({
        where:{companyId:c,repId:id,type:'سنوية',status:'APPROVED',
          fromDate:{lte:leaveYearEnd},toDate:{gte:leaveYearStart}},
        select:{fromDate:true,toDate:true}
      })
    ]);
    const workingDays=settings?.workingDays||[0,1,2,3,4,6];
    const approvedDays=approvedAnnualLeaves.reduce((sum,leave)=>sum+
      (workingDaysWithin(formatDate(leave.fromDate),
        formatDate(leave.toDate),workingDays).get(year)||0),0);
    // Legacy Mandob has no carryover/adjustment ledger yet. Zero here means
    // neither category can be recorded, not that a ledger was audited.
    const leaveBalance={year,allocatedDays:rep.annualLeaveBalance,
      remainingDays:Math.max(0,rep.annualLeaveBalance-approvedDays),
      carriedDays:0,adjustmentDays:0,accountingMode:'LEGACY_NO_LEDGER'};
    const tourCounts=Object.fromEntries(types.map(row=>[row.type,row._count._all]));
    const targetCounts=Object.fromEntries(['DOCTOR','PHARMACY','HOSPITAL']
      .map((type,i)=>[type,targets[i]]));
    res.json({rep,leaveBalance,period,periodStart:bounds?formatDate(bounds.start):null,
      periodEnd:bounds?formatDate(bounds.end):null,tours,
      tourCounts,targetCounts,lastVisit:latest?formatDate(latest.visitDate):null,
      visits:lastRows.map(visit=>({id:visit.id,type:visit.type,
        date:formatDate(visit.visitDate),createdAt:visit.createdAt,
        note:visit.note,targets:visit.targets.map(target=>({
          id:target.id,name:target.doctor?.name||target.pharmacy?.name||
            target.hospital?.name||'—',area:target.areaAtVisit?.name||'—'}))}))});
  });

  route('get','/api/provinces',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const rows=await prisma.province.findMany({where:{companyId:c},
      include:{_count:{select:{areas:true}}},
      orderBy:[{name:'asc'},{id:'asc'}]});
    res.json(rows);
  });
  route('post','/api/provinces',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['name']);
    const name=requireString(req.body?.name,'اسم المحافظة',120).trim();
    const existing=await prisma.province.findUnique({
      where:{companyId_name:{companyId:c,name}},select:{id:true}});
    if(existing)throw new HttpError(409,'المحافظة موجودة بالفعل');
    const province=await auditWrite(req.user,'CREATE','PROVINCE',v=>v.id,
      tx=>tx.province.create({data:{companyId:c,name}}));
    res.status(201).json(province);
  });
  route('get','/api/areas',async(req,res)=>{
    const c=requireCompany(req);
    const where=req.user.role==='REP'?{companyId:c,repAreas:{some:{repId:req.user.id}}}:
      req.user.role==='TEAM_MANAGER'?{companyId:c,repAreas:{some:{rep:teamRepCriteria(req.user)}}}:{companyId:c};
    const areas=await prisma.area.findMany({where,include:{province:{select:{id:true,name:true}},group:{select:{id:true,name:true,sortOrder:true}}},
      orderBy:[{name:'asc'},{id:'asc'}],...optionalPage(req.query)});
    res.json(areas);
  });
  route('post','/api/areas',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['name','city','provinceId','groupId']);
    const provinceId=req.body?.provinceId?validId(req.body.provinceId):null;
    const groupId=req.body?.groupId===undefined||req.body?.groupId===null||req.body?.groupId===''?
      null:validId(req.body.groupId);
    const area=await auditWrite(req.user,'CREATE','AREA',v=>v.id,async tx=>{
      const group=groupId?await tx.areaGroup.findFirst({
        where:{id:groupId,companyId:c},select:{provinceId:true}}):null;
      if(groupId&&!group)throw new HttpError(400,'مجموعة المنطقة غير تابعة للشركة');
      const city=typeof req.body?.city==='string'?req.body.city.trim():null;
      const province=provinceId?await tx.province.findFirst({where:{id:provinceId,companyId:c}}):
        city?await tx.province.upsert({
          where:{companyId_name:{companyId:c,name:city}},
          create:{companyId:c,name:city},update:{}}):null;
      if(provinceId&&!province)throw new HttpError(400,'المحافظة غير تابعة للشركة');
      if(provinceId&&city&&city!==province.name)
        throw new HttpError(400,'اسم المحافظة لا يطابق المحافظة المختارة');
      if(group?.provinceId&&group.provinceId!==province?.id)
        throw new HttpError(400,'مجموعة المناطق مرتبطة بمحافظة أخرى');
      return tx.area.create({data:{companyId:c,name:requireString(req.body?.name,'area'),
        city:province?.name||city,provinceId:province?.id||null,groupId}});
    });
    res.status(201).json(area);
  });
  route('patch','/api/areas/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    const p=checkedPatch(req.body,['name','city','provinceId','groupId']);
    const data={};
    if(p.name!==undefined)data.name=requireString(p.name,'area name');
    if(p.city!==undefined){
      data.city=p.city===null||p.city===''?null:requireString(p.city,'city',120);
    }
    if(p.groupId!==undefined)
      data.groupId=p.groupId===null||p.groupId===''?null:validId(p.groupId);
    if(p.provinceId!==undefined)data.provinceId=
      p.provinceId===null||p.provinceId===''?null:validId(p.provinceId);
    if(!Object.keys(data).length)throw new HttpError(400,'لا توجد بيانات لتعديلها');
    const area=await auditWrite(req.user,'UPDATE','AREA',id,async tx=>{
      const exists=await tx.area.findFirst({where:{id,companyId:c},
        select:{id:true,provinceId:true,groupId:true}});
      if(!exists)throw new HttpError(404,'المنطقة غير موجودة');
      const finalGroupId=data.groupId!==undefined?data.groupId:exists.groupId;
      const group=finalGroupId?await tx.areaGroup.findFirst({
        where:{id:finalGroupId,companyId:c},select:{provinceId:true}}):null;
      if(finalGroupId&&!group)throw new HttpError(400,'مجموعة المنطقة غير تابعة للشركة');
      if(data.provinceId!==undefined){
        const province=data.provinceId?await tx.province.findFirst({
          where:{id:data.provinceId,companyId:c}}):null;
        if(data.provinceId&&!province)throw new HttpError(400,'المحافظة غير تابعة للشركة');
        data.city=province?.name||null;
      }else if(data.city!==undefined){
        const province=data.city?await tx.province.upsert({
          where:{companyId_name:{companyId:c,name:data.city}},
          create:{companyId:c,name:data.city},update:{}}):null;
        data.provinceId=province?.id||null;
      }
      if(group?.provinceId&&group.provinceId!==(data.provinceId!==undefined?
        data.provinceId:exists.provinceId))
        throw new HttpError(400,'مجموعة المناطق مرتبطة بمحافظة أخرى');
      return tx.area.update({where:{id},data});
    },{isolationLevel:'Serializable'});
    res.json(area);
  });
  route('get','/api/areas/:id/details',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT),id=validId(req.params.id);
    const areaWhere={id,companyId:c};
    if(req.user.role==='TEAM_MANAGER')
      areaWhere.repAreas={some:{rep:teamRepCriteria(req.user)}};
    const area=await prisma.area.findFirst({
      where:areaWhere,include:{group:{select:{id:true,name:true}}}
    });
    if(!area)throw new HttpError(404,'المنطقة غير موجودة');
    const assigned={companyId:c,role:'REP',repAreas:{some:{areaId:id}}};
    if(req.user.role==='TEAM_MANAGER')assigned.teamId=teamRepCriteria(req.user).teamId;
    // Archived medical entities are visible here only to the company admin,
    // consistently with the main medical lists and the documented role matrix.
    const medicalVisibility=req.user.role==='TEAM_MANAGER'?{active:true}:{};
    const [reps,doctors,pharmacies,hospitals]=await Promise.all([
      prisma.user.findMany({where:assigned,
        select:{id:true,name:true,username:true,teamId:true,team:{select:{name:true}}},
        orderBy:{name:'asc'},take:501}),
      prisma.doctor.findMany({where:{companyId:c,...medicalVisibility,OR:[
        {areaId:id},{doctorAreas:{some:{areaId:id}}}]},
        select:{id:true,name:true,specialty:true,grade:true,active:true},
        orderBy:{name:'asc'},take:501}),
      prisma.pharmacy.findMany({where:{companyId:c,areaId:id,...medicalVisibility},
        select:{id:true,name:true,target:true,grade:true,active:true},
        orderBy:{name:'asc'},take:501}),
      prisma.hospital.findMany({where:{companyId:c,areaId:id,...medicalVisibility},
        select:{id:true,name:true,category:true,specialty:true,target:true,active:true},
        orderBy:{name:'asc'},take:501})
    ]);
    if([reps,doctors,pharmacies,hospitals].some(rows=>rows.length>500))
      throw new HttpError(413,'بيانات المنطقة كبيرة، يلزم تقسيم القائمة');
    res.json({area,reps,doctors,pharmacies,hospitals,
      totals:{reps:reps.length,doctors:doctors.length,
        pharmacies:pharmacies.length,hospitals:hospitals.length}});
  });

  // Server-side legacy follow-up filter, applied before pagination. The
  // medical directories must not filter only the current 100 visible rows.
  // For doctors prefer explicit team goals, otherwise cycle A/B/C defaults.
  async function applyManagerMedicalAttention(req,kind,where){
    const status=req.query?.attention;
    if(status===undefined||status==='false')return;
    if(status!=='true')throw new HttpError(400,'فلتر المتابعة غير صحيح');
    requireRole(req.user,['TEAM_MANAGER']);
    if(!req.user.teamId)throw new HttpError(403,'ليس لديك فريق معين');
    const c=companyId(req.user);
    const model=kind==='doctors'?'doctor':kind==='pharmacies'?'pharmacy':'hospital';
    const field=kind==='doctors'?'doctorId':kind==='pharmacies'?'pharmacyId':'hospitalId';
    const select=kind==='doctors'?{id:true,grade:true}:{id:true,target:true};
    const records=await prisma[model].findMany({where,select,take:2001});
    if(records.length>2000)
      throw new HttpError(413,'قائمة الجهات كبيرة جداً، يرجى اختيار منطقة أو البحث أولاً');
    if(!records.length){where.id={in:[]};return}
    const ids=records.map(row=>row.id);
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start,end}=cycleBounds(settings);
    const [counts,goals]=await Promise.all([
      prisma.visitTarget.groupBy({by:[field],where:{
        [field]:{in:ids},
        visit:{companyId:c,teamIdAtVisit:req.user.teamId,
          visitDate:{gte:start,lte:end}}
      },_count:{_all:true}}),
      kind==='doctors'?prisma.doctorVisitGoal.findMany({
        where:{companyId:c,scope:'TEAM',ownerId:req.user.teamId,
          doctorId:{in:ids},cycleStart:start,cycleEnd:end},
        select:{doctorId:true,target:true}}):[]
    ]);
    const visitCounts=new Map(counts.map(row=>[row[field],row._count._all]));
    const teamGoals=new Map(goals.map(goal=>[goal.doctorId,goal.target]));
    where.id={in:records.filter(row=>{
      const goal=kind==='doctors'?teamGoals.get(row.id)??(
        row.grade==='A'?settings?.frequencyA??4:
        row.grade==='B'?settings?.frequencyB??2:settings?.frequencyC??1
      ):row.target;
      const completed=visitCounts.get(row.id)||0;
      return goal>0&&completed/goal<0.5;
    }).map(row=>row.id)};
  }

  route('get','/api/doctors',async(req,res)=>{
    requireCompany(req);
    const q=req.query||{},where=await scopedDoctorFilter(req.user);
    if(q.includeArchived !== undefined && q.includeArchived !== 'true' && q.includeArchived !== 'false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true' && req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    if(q.grade!==undefined)where.grade=grade(q.grade);
    if(q.specialty!==undefined)where.specialty=requireString(q.specialty,'specialty',120);
    if(q.areaId){const areaId=validId(q.areaId);
      where.AND=[{OR:[{areaId},{doctorAreas:{some:{areaId}}}]}];
    }
    if(q.search!==undefined){
      const search=requireString(q.search,'search',100);
      const match={contains:search,mode:'insensitive'};
      where.AND=[...(where.AND||[]),{OR:[
        {name:match},{specialty:match},{city:match},
        {area:{name:match}},
        {doctorAreas:{some:{area:{name:match}}}}
      ]}];
    }
    await applyManagerMedicalAttention(req,'doctors',where);
    const take=safeInt(q.limit??500,'limit',1,500);
    const skip=safeInt(q.offset??0,'offset',0,100000);
    const doctors=await prisma.doctor.findMany({where,take,skip,
      include:{area:{select:{id:true,name:true}},
        doctorAreas:{include:{area:{select:{id:true,name:true}}}}},
      orderBy:[{name:'asc'},{id:'asc'}]});
    res.json(doctors);
  });
  route('post','/api/doctors',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    checkedInput(req.body,['areaId','name','specialty','grade','city']);
    const area=await prisma.area.findFirst({where:{id:validId(req.body?.areaId),companyId:c}});
    if(!area)throw new HttpError(400,'منطقة غير تابعة للشركة');
    if(req.user.role==='TEAM_MANAGER'&&!(await prisma.area.findFirst({
      where:{id:area.id,companyId:c,
        repAreas:{some:{rep:teamRepCriteria(req.user)}}},select:{id:true}})))
      throw new HttpError(403,'إضافة الأطباء متاحة ضمن مناطق فريقك فقط');
    const d=await auditWrite(req.user,'CREATE','DOCTOR',v=>v.id,tx=>tx.doctor.create({
      data:{companyId:c,areaId:area.id,name:requireString(req.body?.name,'name'),
        specialty:requireString(req.body?.specialty,'specialty'),grade:grade(req.body?.grade||'C'),
        city:typeof req.body?.city==='string'?req.body.city.trim():null,
        doctorAreas:{create:{areaId:area.id}}}
    }));
    res.status(201).json(d);
  });
  // XLSX preview is read-only. Only an explicit administrator decision commits rows.
  app.post('/api/doctors/import/preview',
    express.raw({type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',limit:'5mb'}),
    wrap(async(req,res)=>{
      const c=onlyCompany(req,ADMIN);
      res.json(await previewDoctors(c,req.body));
    }));
  route('post','/api/doctors/import/commit',async(req,res)=>{
    onlyCompany(req,ADMIN);
    checkedInput(req.body,['clientImportId','rows']);
    res.json(await commitDoctors(req.user,req.body));
  });
  // Edit descriptive medical fields only. Never change area membership, archive status or identity here.
  // Old visits keep their linked Doctor/Pharmacy/Hospital IDs and immutable tour metadata.
  const editableMedical={
    doctors:{model:'doctor',entity:'DOCTOR',fields:['name','specialty','grade','city']},
    pharmacies:{model:'pharmacy',entity:'PHARMACY',fields:['name','grade','target','kind']},
    hospitals:{model:'hospital',entity:'HOSPITAL',fields:['name','category','specialty','target']}
  };
  function medicalChanges(kind,payload){
    const spec=editableMedical[kind],data={};
    if(!payload||typeof payload!=='object'||Array.isArray(payload))
      throw new HttpError(400,'بيانات التعديل غير صحيحة');
    for(const key of Object.keys(payload)){
      if(!spec.fields.includes(key))throw new HttpError(400,'الحقل غير مسموح بتعديله: '+key);
      if(key==='grade')data.grade=grade(payload.grade);
      else if(key==='target')data.target=safeInt(payload.target,'target',1,100);
      else if(key==='city'){
        if(payload.city===null||payload.city==='')data.city=null;
        else data.city=requireString(payload.city,'city',120);
      }
      else data[key]=requireString(payload[key],key,200);
    }
    if(!Object.keys(data).length)throw new HttpError(400,'لا توجد بيانات لتعديلها');
    return data;
  }
  for(const [kind,spec] of Object.entries(editableMedical)){
    route('patch','/api/'+kind+'/:id',async(req,res)=>{
      const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
      const changes=medicalChanges(kind,req.body);
      const updated=await auditWrite(req.user,'UPDATE',spec.entity,id,async tx=>{
        const current=await tx[spec.model].findFirst({where:{id,companyId:c},select:{id:true}});
        if(!current)throw new HttpError(404,'السجل الطبي غير موجود');
        return tx[spec.model].update({where:{id},data:changes});
      },{isolationLevel:'Serializable'});
      res.json(updated);
    });
  }
  // Legacy team manager edit controls: descriptive fields only, and only
  // entities exclusively visible in areas assigned to the manager's own team.
  // A record shared with other teams must be edited centrally by company admin.
  route('patch','/api/manager/medical/:kind/:id',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    const c=companyId(req.user),kind=req.params.kind,id=validId(req.params.id);
    if(!Object.prototype.hasOwnProperty.call(editableMedical,kind))
      throw new HttpError(400,'نوع الجهة غير معروف');
    const spec=editableMedical[kind],changes=medicalChanges(kind,req.body);
    const record=await auditWrite(req.user,'UPDATE',spec.entity,id,async tx=>{
      const current=await tx[spec.model].findFirst({
        where:{id,companyId:c,active:true},
        select:kind==='doctors'?{id:true,areaId:true,
          doctorAreas:{select:{areaId:true}}}:{id:true,areaId:true}
      });
      if(!current)throw new HttpError(404,'الجهة غير موجودة');
      const areaIds=[...new Set([current.areaId,
        ...(current.doctorAreas||[]).map(link=>link.areaId)])];
      const members=await tx.repArea.findMany({where:{
        areaId:{in:areaIds},rep:{companyId:c,role:'REP'}
      },select:{areaId:true,rep:{select:{teamId:true}}}});
      const ownTeam=req.user.teamId;
      if(!ownTeam||areaIds.some(areaId=>
        !members.some(link=>link.areaId===areaId&&link.rep.teamId===ownTeam)||
        members.some(link=>link.areaId===areaId&&link.rep.teamId!==ownTeam)))
        throw new HttpError(403,
          'هذه الجهة موجودة في مناطق مشتركة أو خارج فريقك؛ تعديلها من مدير الشركة');
      return tx[spec.model].update({where:{id},data:changes});
    },{isolationLevel:'Serializable'});
    res.json(record);
  });
  // Archiving changes doctor status only; all existing VisitTarget references survive.
  route('patch','/api/doctors/:id/status',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    checkedPatch(req.body,['active']);
    const active=req.body?.active;
    if(typeof active!=='boolean')throw new HttpError(400,'active يجب أن تكون true أو false');
    const doctor=await auditWrite(req.user,active?'RESTORE':'ARCHIVE','DOCTOR',id,async(tx)=>{
      const found=await tx.doctor.findFirst({where:{id,companyId:c},select:{id:true,active:true}});
      if(!found)throw new HttpError(404,'الطبيب غير موجود');
      if(found.active===active)return null;
      return tx.doctor.update({where:{id},data:{active}});
    },{isolationLevel:'Serializable'});
    // On no-op, the audit trail still captures the explicitly requested action.
    const result=doctor||await prisma.doctor.findFirst({where:{id,companyId:c}});
    res.json(result);
  });
  route('get','/api/pharmacies',async(req,res)=>{
    requireCompany(req);
    const q=req.query||{},where={...entityFilter(req.user)};
    // Tighten the already-authorized scope to one area for the legacy area
    // detail tabs. Never replace the existing company/rep visibility filters.
    if(q.areaId!==undefined)where.areaId=validId(q.areaId);
    if(q.includeArchived!==undefined && q.includeArchived!=='true' && q.includeArchived!=='false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true'&&req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    if(q.grade!==undefined)where.grade=grade(q.grade);
    if(q.search!==undefined){
      const match={contains:requireString(q.search,'search',100),mode:'insensitive'};
      where.AND=[{OR:[{name:match},{kind:match},{area:{name:match}}]}];
    }
    await applyManagerMedicalAttention(req,'pharmacies',where);
    const take=safeInt(q.limit??500,'limit',1,500);
    const skip=safeInt(q.offset??0,'offset',0,100000);
    res.json(await prisma.pharmacy.findMany({where,take,skip,include:{area:true},
      orderBy:[{name:'asc'},{id:'asc'}]}));
  });
  route('post','/api/pharmacies',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    checkedInput(req.body,['areaId','name','grade','target','kind']);
    const areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
    if(req.user.role==='TEAM_MANAGER'&&!(await prisma.area.findFirst({
      where:{id:areaId,companyId:c,repAreas:{some:{rep:teamRepCriteria(req.user)}}},
      select:{id:true}})))
      throw new HttpError(403,'إضافة الصيدليات متاحة ضمن مناطق فريقك فقط');
    const p=await auditWrite(req.user,'CREATE','PHARMACY',v=>v.id,tx=>tx.pharmacy.create({
      data:{companyId:c,areaId,
        name:requireString(req.body?.name,'name'),grade:grade(req.body?.grade||'A'),
        target:safeInt(req.body?.target??4,'target',1,100),
        kind:typeof req.body?.kind==='string'?req.body.kind.trim():'مستقلة'}
    }));
    res.status(201).json(p);
  });
  route('patch','/api/pharmacies/:id/status',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    checkedPatch(req.body,['active']);
    const active=req.body?.active;
    if(typeof active!=='boolean')throw new HttpError(400,'active يجب أن تكون true أو false');
    const record=await auditWrite(req.user,active?'RESTORE':'ARCHIVE','PHARMACY',id,async(tx)=>{
      const found=await tx.pharmacy.findFirst({where:{id,companyId:c},select:{id:true,active:true}});
      if(!found)throw new HttpError(404,'السجل غير موجود');
      if(found.active===active)return null;
      return tx.pharmacy.update({where:{id},data:{active}});
    },{isolationLevel:'Serializable'});
    res.json(record||await prisma.pharmacy.findFirst({where:{id,companyId:c}}));
  });
  route('get','/api/hospitals',async(req,res)=>{
    requireCompany(req);
    const q=req.query||{},where={...entityFilter(req.user)};
    // Tighten the already-authorized scope to one area for the legacy area
    // detail tabs. Never replace the existing company/rep visibility filters.
    if(q.areaId!==undefined)where.areaId=validId(q.areaId);
    if(q.includeArchived!==undefined && q.includeArchived!=='true' && q.includeArchived!=='false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true'&&req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    if(q.category!==undefined)where.category=requireString(q.category,'category',120);
    if(q.search!==undefined){
      const match={contains:requireString(q.search,'search',100),mode:'insensitive'};
      where.AND=[{OR:[
        {name:match},{category:match},{specialty:match},{area:{name:match}}
      ]}];
    }
    await applyManagerMedicalAttention(req,'hospitals',where);
    const take=safeInt(q.limit??500,'limit',1,500);
    const skip=safeInt(q.offset??0,'offset',0,100000);
    res.json(await prisma.hospital.findMany({where,take,skip,include:{area:true},
      orderBy:[{name:'asc'},{id:'asc'}]}));
  });
  route('post','/api/hospitals',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    checkedInput(req.body,['areaId','name','category','specialty','target']);
    const areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
    if(req.user.role==='TEAM_MANAGER'&&!(await prisma.area.findFirst({
      where:{id:areaId,companyId:c,repAreas:{some:{rep:teamRepCriteria(req.user)}}},
      select:{id:true}})))
      throw new HttpError(403,'إضافة المشافي متاحة ضمن مناطق فريقك فقط');
    const h=await auditWrite(req.user,'CREATE','HOSPITAL',v=>v.id,tx=>tx.hospital.create({
      data:{companyId:c,areaId,
        name:requireString(req.body?.name,'name'),
        category:requireString(req.body?.category||'خاص','category'),
        specialty:requireString(req.body?.specialty||'عام','specialty'),
        target:safeInt(req.body?.target??4,'target',1,100)}
    }));
    res.status(201).json(h);
  });
  route('patch','/api/hospitals/:id/status',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    checkedPatch(req.body,['active']);
    const active=req.body?.active;
    if(typeof active!=='boolean')throw new HttpError(400,'active يجب أن تكون true أو false');
    const record=await auditWrite(req.user,active?'RESTORE':'ARCHIVE','HOSPITAL',id,async(tx)=>{
      const found=await tx.hospital.findFirst({where:{id,companyId:c},select:{id:true,active:true}});
      if(!found)throw new HttpError(404,'السجل غير موجود');
      if(found.active===active)return null;
      return tx.hospital.update({where:{id},data:{active}});
    },{isolationLevel:'Serializable'});
    res.json(record||await prisma.hospital.findFirst({where:{id,companyId:c}}));
  });
  route('get','/api/products',async(req,res)=>{
    const c=requireCompany(req);
    res.json(await prisma.product.findMany({where:{companyId:c},
      orderBy:[{name:'asc'},{id:'asc'}],...optionalPage(req.query)}));
  });
  // Representative home counts are based on assigned, active medical entities.
  // Unvisited is specific to this rep's visits in the configured cycle, never
  // inferred from obsolete legacy status fields or another representative's visits.
  route('get','/api/rep-workspace-summary',async(req,res)=>{
    requireRole(req.user,['REP']);
    const c=companyId(req.user);
    const [settings,doctorWhere]=await Promise.all([
      prisma.companySettings.findUnique({where:{companyId:c}}),
      scopedDoctorFilter(req.user)
    ]);
    const {start,end}=cycleBounds(settings);
    const {start:queryStart,end:queryEnd}=periodWindow(
      start,end,req.query?.period||'cycle',req.query?.onDate);
    const [doctors,pharmacies,hospitals]=await Promise.all([
      prisma.doctor.findMany({
        where:{...doctorWhere,active:true},select:{id:true,grade:true,
          area:{select:{id:true,name:true}},
          doctorAreas:{select:{area:{select:{id:true,name:true}}}}}
      }),
      prisma.pharmacy.findMany({
        where:{...entityFilter(req.user),active:true},select:{id:true,grade:true,target:true}
      }),
      prisma.hospital.findMany({
        where:{...entityFilter(req.user),active:true},select:{id:true,target:true,category:true}
      })
    ]);
    const doctorIds=doctors.map(d=>d.id);
    const pharmacyIds=pharmacies.map(p=>p.id);
    const hospitalIds=hospitals.map(h=>h.id);
    // One grouped database scan supplies both visit counts and last dates.
    // Each predicate keeps the existing company, representative, cycle,
    // entity-type and authorized-directory scope.
    const entityFilters=[
      ...(doctorIds.length?[Prisma.sql`(v."type"='DOCTOR' AND t."doctorId" IN (${Prisma.join(doctorIds)}))`]:[]),
      ...(pharmacyIds.length?[Prisma.sql`(v."type"='PHARMACY' AND t."pharmacyId" IN (${Prisma.join(pharmacyIds)}))`]:[]),
      ...(hospitalIds.length?[Prisma.sql`(v."type"='HOSPITAL' AND t."hospitalId" IN (${Prisma.join(hospitalIds)}))`]:[])
    ];
    const [stats,personalGoals]=await Promise.all([
      entityFilters.length?prisma.$queryRaw(Prisma.sql`
        WITH selected AS (
          SELECT v."type",v."visitDate",
            CASE v."type"
              WHEN 'DOCTOR' THEN t."doctorId"
              WHEN 'PHARMACY' THEN t."pharmacyId"
              ELSE t."hospitalId"
            END AS "entityId"
          FROM "VisitTarget" t
          INNER JOIN "Visit" v ON v."id"=t."visitId"
          WHERE v."companyId"=${c} AND v."repId"=${req.user.id}
            AND v."visitDate">=${queryStart} AND v."visitDate"<=${queryEnd}
            AND (${Prisma.join(entityFilters,' OR ')})
        )
        SELECT "type","entityId",COUNT(*)::integer AS "count",
          MAX("visitDate") AS "lastVisitDate"
        FROM selected
        GROUP BY "type","entityId"
      `):Promise.resolve([]),
      prisma.doctorVisitGoal.findMany({
        where:{companyId:c,scope:'REP',ownerId:req.user.id,cycleStart:start,cycleEnd:end,
          doctorId:{in:doctorIds}},select:{doctorId:true,target:true}
      })
    ]);
    const doctorVisits=new Map(),pharmacyVisits=new Map(),hospitalVisits=new Map();
    const doctorLastVisits={},pharmacyLastVisits={},hospitalLastVisits={};
    const buckets={
      DOCTOR:{counts:doctorVisits,last:doctorLastVisits},
      PHARMACY:{counts:pharmacyVisits,last:pharmacyLastVisits},
      HOSPITAL:{counts:hospitalVisits,last:hospitalLastVisits}
    };
    for(const row of stats){
      const bucket=buckets[row.type];
      if(!bucket||!row.entityId)continue;
      bucket.counts.set(row.entityId,Number(row.count));
      bucket.last[row.entityId]=formatDate(row.lastVisitDate);
    }
    const personalTargets=new Map(personalGoals.map(goal=>[goal.doctorId,goal.target]));
    const doctorGoal=doctor=>personalTargets.get(doctor.id)??
      (doctor.grade==='A'?(settings?.frequencyA??4):
        doctor.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1));
    const doctorTargetTotal=doctors.reduce((sum,doctor)=>sum+doctorGoal(doctor),0);
    const doctorCompleted=doctors.reduce((sum,doctor)=>
      sum+Math.min(doctorVisits.get(doctor.id)||0,doctorGoal(doctor)),0);
    // The legacy A-doctor warning also lists the regions involved. Return
    // unique area IDs so the client can show only the rep's assigned regions.
    // Include secondary doctor-area links without double-counting doctors.
    const unvisitedADoctors=doctors.filter(doctor=>
      doctor.grade==='A'&&!doctorVisits.has(doctor.id));
    const unvisitedAAreas=[...new Map(unvisitedADoctors.flatMap(doctor=>
      [doctor.area,...doctor.doctorAreas.map(link=>link.area)])
      .filter(Boolean).map(area=>[area.id,{id:area.id,name:area.name}])).values()]
      .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    res.json({
      doctors:{total:doctors.length,gradeA:doctors.filter(d=>d.grade==='A').length,
        unvisited:doctors.filter(d=>!doctorVisits.has(d.id)).length,
        unvisitedA:unvisitedADoctors.length,unvisitedAAreas,
        target:doctorTargetTotal,done:doctorCompleted,
        coverage:doctorTargetTotal?Math.round(doctorCompleted/doctorTargetTotal*100):0,
        remainingVisits:Math.max(0,doctorTargetTotal-doctorCompleted)},
      visitCounts:{doctors:Object.fromEntries(doctorVisits),
        pharmacies:Object.fromEntries(pharmacyVisits),hospitals:Object.fromEntries(hospitalVisits)},
      lastVisitDates:{doctors:doctorLastVisits,
        pharmacies:pharmacyLastVisits,hospitals:hospitalLastVisits},
      visitTargets:{
        doctors:Object.fromEntries(doctors.map(doctor=>[doctor.id,doctorGoal(doctor)])),
        pharmacies:Object.fromEntries(pharmacies.map(pharmacy=>[pharmacy.id,pharmacy.target])),
        hospitals:Object.fromEntries(hospitals.map(hospital=>[hospital.id,hospital.target]))
      },
      pharmacies:{total:pharmacies.length,
        gradeA:pharmacies.filter(p=>p.grade==='A').length,
        unvisited:pharmacies.filter(p=>!pharmacyVisits.has(p.id)).length},
      hospitals:{total:hospitals.length,
        privateCount:hospitals.filter(h=>h.category==='خاص').length,
        needsVisit:hospitals.filter(h=>(hospitalVisits.get(h.id)||0)<h.target).length}
    });
  });

  // Read-only plan scoped to the authenticated representative's assigned products.
  route('get','/api/rep-plan',async(req,res)=>{
    requireRole(req.user,['REP']);
    const c=companyId(req.user);
    const productFields={id:true,name:true,activeIngredient:true,active:true,
      priority:true,targetSpecialties:true};
    const [settings,rep]=await Promise.all([
      prisma.companySettings.findUnique({where:{companyId:c},
        select:{targetACoverage:true,managerInstructions:true}}),
      prisma.user.findFirst({
      where:{id:req.user.id,companyId:c,role:'REP',active:true},
      select:{dailyTarget:true,teamId:true,
        team:{select:{name:true,managerInstructions:true,
          products:{include:{product:{select:productFields}}}}},
        repProducts:{include:{product:{select:productFields}}}
      }
    })]);
    if(!rep)throw new HttpError(403,'حساب المندوب غير نشط');
    const links=rep.teamId?(rep.team?.products||[]):rep.repProducts;
    const priorityOrder={PRIMARY:0,SECONDARY:1,SUPPORT:2};
    const stock=await prisma.sampleStock.findMany({where:{companyId:c,holderType:'REP',
      holderId:req.user.id},select:{productId:true,quantity:true}});
    const balanceByProduct=new Map(stock.map(item=>[item.productId,item.quantity]));
    const products=links.map(link=>link.product).filter(p=>p&&p.active)
      .sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority]||
        a.name.localeCompare(b.name,'ar'))
      .map(product=>({...product,stockQuantity:balanceByProduct.get(product.id)||0}));
    res.json({dailyTarget:rep.dailyTarget,teamName:rep.team?.name||null,
      source:rep.teamId?'TEAM':'CUSTOM',products,
      targetACoverage:settings?.targetACoverage??80,
      managerInstructions:rep.team?.managerInstructions||settings?.managerInstructions||null});
  });
  route('post','/api/products',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    checkedInput(req.body,['name','activeIngredient','priority','targetSpecialties']);
    const priorities=['PRIMARY','SECONDARY','SUPPORT'];
    if(req.body?.priority!==undefined&&!priorities.includes(req.body.priority))
      throw new HttpError(400,'أولوية الصنف غير صالحة');
    const targetSpecialties=normalizedStringList(req.body?.targetSpecialties??[]);
    const p=await auditWrite(req.user,'CREATE','PRODUCT',v=>v.id,tx=>tx.product.create({
      data:{companyId:c,name:requireString(req.body?.name,'name'),
        activeIngredient:typeof req.body?.activeIngredient==='string'?req.body.activeIngredient.trim():null,
        priority:req.body?.priority||'SUPPORT',targetSpecialties}
    }));
    res.status(201).json(p);
  });
  route('patch','/api/products/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
    const p=checkedPatch(req.body,['priority','targetSpecialties']);
    const changes={};
    if(p.priority!==undefined){
      if(!['PRIMARY','SECONDARY','SUPPORT'].includes(p.priority))
        throw new HttpError(400,'أولوية الصنف غير صالحة');
      changes.priority=p.priority;
    }
    if(p.targetSpecialties!==undefined)
      changes.targetSpecialties=normalizedStringList(p.targetSpecialties);
    if(!Object.keys(changes).length)throw new HttpError(400,'لا توجد تغييرات');
    const updated=await auditWrite(req.user,'UPDATE','PRODUCT',id,async(tx)=>{
      const exists=await tx.product.findFirst({where:{id,companyId:c},select:{id:true}});
      if(!exists)throw new HttpError(404,'الصنف غير موجود');
      return tx.product.update({where:{id},data:changes});
    });
    res.json(updated);
  });
  route('get','/api/reports/medical.xlsx',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const kind=req.query?.kind;
    if(!['doctors','pharmacies','hospitals'].includes(kind))
      throw new HttpError(400,'نوع السجل غير صالح');
    const archived=req.query?.includeArchived;
    if(archived!==undefined&&archived!=='true'&&archived!=='false')
      throw new HttpError(400,'قيمة الأرشفة غير صالحة');
    const workbook=await medicalDirectoryExport(c,kind,archived==='true');
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="mandob-'+kind+'.xlsx"');
    res.send(Buffer.from(workbook));
  });
  // Dedicated report preview, detail and persisted submissions. The client
  // cannot supply or modify calculated report totals.
  route('get','/api/rep-report',async(req,res)=>{
    res.json(await calculateRepReport(req.user,req.query,req.query?.details==='true'));
  });
  route('post','/api/rep-reports',async(req,res)=>{
    requireRole(req.user,['REP']);
    checkedInput(req.body,['from','to']);
    const snapshot=await calculateRepReport(req.user,req.body,true);
    const saved=await auditWrite(req.user,'SUBMIT','REP_REPORT',row=>row.id,tx=>
      tx.repReportSubmission.create({data:{
        companyId:companyId(req.user),repId:req.user.id,
        teamIdAtSubmission:req.user.teamId||null,
        fromDate:asDate(snapshot.from),toDate:asDate(snapshot.to),snapshot
      }}));
    res.status(201).json({id:saved.id,createdAt:saved.createdAt});
  });
  route('get','/api/rep-reports',async(req,res)=>{
    requireRole(req.user,['REP','TEAM_MANAGER','COMPANY_ADMIN']);
    const where={companyId:companyId(req.user)};
    if(req.user.role==='REP')where.repId=req.user.id;
    if(req.user.role==='TEAM_MANAGER')
      where.teamIdAtSubmission=req.user.teamId||'__UNASSIGNED__';

    // Preserve the old array response for existing company/manager screens.
    // The REP history opts in to a stable keyset cursor (createdAt,id) so
    // newly submitted reports cannot shift pages and skip/duplicate rows.
    const paginated=req.query.paginated==='true';
    if(req.query.paginated!==undefined&&!paginated)
      throw new HttpError(400,'صيغة تصفح التقارير غير صحيحة');
    if(!paginated&&(req.query.cursor!==undefined||req.query.limit!==undefined))
      throw new HttpError(400,'حدد نمط التصفح للانتقال بين صفحات التقارير');
    const limit=paginated?safeInt(req.query.limit??50,'limit',1,50):50;
    let anchor=null;
    if(req.query.cursor!==undefined){
      const id=validId(req.query.cursor);
      anchor=await prisma.repReportSubmission.findFirst({
        where:{...where,id},select:{id:true,createdAt:true}
      });
      if(!anchor)throw new HttpError(404,'مؤشر التقرير غير موجود ضمن صلاحياتك');
    }
    const scopedWhere=anchor?{...where,OR:[
      {createdAt:{lt:anchor.createdAt}},
      {createdAt:anchor.createdAt,id:{lt:anchor.id}}
    ]}:where;
    const found=await prisma.repReportSubmission.findMany({
      where:scopedWhere,orderBy:[{createdAt:'desc'},{id:'desc'}],
      take:paginated?limit+1:50,
      select:{id:true,fromDate:true,toDate:true,createdAt:true,
        rep:{select:{name:true}},teamIdAtSubmission:true}
    });
    const more=paginated&&found.length>limit;
    const submissions=more?found.slice(0,limit):found;
    // The persisted snapshot may contain thousands of visit rows. Read only
    // two numeric JSON fields for the cards, never the entire snapshot.
    const totals=submissions.length?await prisma.$queryRaw`
      SELECT "id",
        COALESCE((snapshot->>'totalTargets')::integer,0) AS "totalTargets",
        COALESCE((snapshot->>'tours')::integer,0) AS "tours"
      FROM "RepReportSubmission"
      WHERE "id" IN (${Prisma.join(submissions.map(row=>row.id))})
        AND "companyId" = ${companyId(req.user)}
    `:[];
    const totalsById=new Map(totals.map(row=>[row.id,row]));
    const items=submissions.map(row=>({
      id:row.id,from:formatDate(row.fromDate),to:formatDate(row.toDate),
      createdAt:row.createdAt,repName:row.rep.name,
      teamIdAtSubmission:row.teamIdAtSubmission,
      totalTargets:totalsById.get(row.id)?.totalTargets??0,
      tours:totalsById.get(row.id)?.tours??0
    }));
    res.json(paginated?{items,nextCursor:more?submissions.at(-1).id:null}:items);
  });
  route('get','/api/rep-reports/:id',async(req,res)=>{
    requireRole(req.user,['REP','TEAM_MANAGER','COMPANY_ADMIN']);
    const id=validId(req.params.id);
    const submitted=await prisma.repReportSubmission.findFirst({
      where:{id,companyId:companyId(req.user)},
      include:{rep:{select:{name:true}}}
    });
    if(!canReadSubmittedReport(req.user,submitted))
      throw new HttpError(404,'التقرير غير موجود');
    res.json({id:submitted.id,createdAt:submitted.createdAt,
      repName:submitted.rep.name,snapshot:submitted.snapshot});
  });

  route('get','/api/reports/visits',async(req,res)=>{
    res.json(await visitReport(req.user,req.query));
  });
  route('get','/api/reports/visits.xlsx',async(req,res)=>{
    const report=await visitReport(req.user,req.query);
    const data=await exportVisitsXlsx(report);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      'attachment; filename="mandob-visits-'+report.from+'-to-'+report.to+'.xlsx"');
    res.send(Buffer.from(data));
  });
  route('get','/api/visits',async(req,res)=>{
    requireCompany(req);
    const take=safeInt(req.query.limit??100,'limit',1,200);
    const offset=safeInt(req.query.offset??0,'offset',0,100000);
    const where=visitScope(req.user),q=req.query||{};
    if(q.type!==undefined){
      if(!['DOCTOR','PHARMACY','HOSPITAL'].includes(q.type))
        throw new HttpError(400,'نوع الجولة غير صحيح');
      where.type=q.type;
    }
    if(q.repId!==undefined){
      const id=validId(q.repId);
      if(req.user.role==='REP'&&id!==req.user.id)
        throw new HttpError(403,'لا يمكنك عرض جولات مندوب آخر');
      where.repId=id;
    }
    if(q.areaId!==undefined)
      where.targets={some:{areaIdAtVisit:validId(q.areaId)}};
    if(q.search!==undefined){
      const query=requireString(q.search,'search',100);
      const match={contains:query,mode:'insensitive'};
      where.AND=[{OR:[
        {rep:{name:match}},
        {targets:{some:{doctor:{name:match}}}},
        {targets:{some:{pharmacy:{name:match}}}},
        {targets:{some:{hospital:{name:match}}}},
        {targets:{some:{areaAtVisit:{name:match}}}}
      ]}];
    }
    if(q.from!==undefined||q.to!==undefined){
      const from=q.from===undefined?null:asDate(q.from);
      const to=q.to===undefined?null:asDate(q.to);
      if(from&&to&&from>to)throw new HttpError(400,'فترة الجولة غير صحيحة');
      where.visitDate={...(from?{gte:from}:{}),...(to?{lte:to}:{})};
    }
    const visits=await prisma.visit.findMany({
      where,
      orderBy:[{visitDate:'desc'},{createdAt:'desc'},{id:'desc'}],
      skip:offset,take,include:visitInclude
    });
    res.json(visits.map(listVisit));
  });
  route('post','/api/visits',async(req,res)=>{
    requireRole(req.user,['REP']);
    checkedInput(req.body,['clientVisitId','type','visitDate','targetIds','areaByTarget','products','note','location']);
    const result=await submitVisit(req.user,req.body);
    res.status(result.duplicate?200:201).json(result);
  });
  // Current-year annual leave balance mirrors the approval rules: only
  // approved annual requests, counted in configured working days and for the
  // signed-in representative. Never infer the balance from the first list page.
  route('get','/api/rep-leave-balance',async(req,res)=>{
    requireRole(req.user,['REP']);
    const company=companyId(req.user);
    const year=new Date().getUTCFullYear();
    const start=new Date(Date.UTC(year,0,1));
    const end=new Date(Date.UTC(year,11,31));
    const [rep,settings,approved]=await Promise.all([
      prisma.user.findFirst({where:{id:req.user.id,companyId:company,role:'REP',active:true},
        select:{annualLeaveBalance:true}}),
      prisma.companySettings.findUnique({where:{companyId:company},
        select:{workingDays:true}}),
      prisma.leaveRequest.findMany({
        where:{companyId:company,repId:req.user.id,type:'سنوية',status:'APPROVED',
          fromDate:{lte:end},toDate:{gte:start}},
        select:{fromDate:true,toDate:true}
      })
    ]);
    if(!rep)throw new HttpError(403,'حساب المندوب غير نشط');
    const days=settings?.workingDays||[0,1,2,3,4,6];
    const used=approved.reduce((sum,leave)=>sum+
      (workingDaysWithin(formatDate(leave.fromDate),formatDate(leave.toDate),days).get(year)||0),0);
    res.json({year,annual:rep.annualLeaveBalance,used,
      remaining:Math.max(0,rep.annualLeaveBalance-used)});
  });
  route('get','/api/leaves',async(req,res)=>{
    requireCompany(req);
    const take=safeInt(req.query.limit??200,'limit',1,200);
    const offset=safeInt(req.query.offset??0,'offset',0,100000);
    const where=scope(req.user),q=req.query||{};
    if(q.status!==undefined){
      if(!['PENDING','APPROVED','REJECTED'].includes(q.status))
        throw new HttpError(400,'حالة الإجازة غير صحيحة');
      where.status=q.status;
    }
    if(q.repId!==undefined){
      const id=validId(q.repId);
      if(req.user.role==='REP'&&id!==req.user.id)
        throw new HttpError(403,'لا يمكنك عرض إجازات مندوب آخر');
      where.repId=id;
    }
    if(q.search!==undefined){
      const name=requireString(q.search,'اسم المندوب',100);
      where.AND=[{rep:{name:{contains:name,mode:'insensitive'}}}];
    }
    if(q.from!==undefined||q.to!==undefined){
      const from=q.from===undefined?null:asDate(q.from);
      const to=q.to===undefined?null:asDate(q.to);
      if(from&&to&&from>to)throw new HttpError(400,'فترة الإجازة غير صحيحة');
      // Include requests whose leave interval intersects the selected window.
      if(from)where.toDate={gte:from};
      if(to)where.fromDate={lte:to};
    }
    const leaves=await prisma.leaveRequest.findMany({
      where,skip:offset,take,
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      include:{rep:{select:{id:true,name:true,teamId:true}},
        attachment:{select:{fileName:true,mimeType:true,byteLength:true}}}
    });
    res.json(leaves.map(l=>({...l,repName:l.rep?.name||'—',
      fromDate:formatDate(l.fromDate),toDate:formatDate(l.toDate)})));
  });
  route('post','/api/leaves',async(req,res)=>{
    requireRole(req.user,['REP']);
    checkedInput(req.body,['type','fromDate','toDate','reason','attachment']);
    const leave=await submitLeave(req.user,req.body);
    res.status(201).json({id:leave.id,status:leave.status});
  });
  route('get','/api/leaves/:id/attachment',async(req,res)=>{
    requireRole(req.user,['REP','TEAM_MANAGER','COMPANY_ADMIN']);
    const id=validId(req.params.id);
    const row=await prisma.leaveRequest.findFirst({
      where:{...scope(req.user),id},select:{
        attachment:{select:{fileName:true,mimeType:true,byteLength:true,data:true}}
      }
    });
    if(!row?.attachment)throw new HttpError(404,'المرفق غير موجود');
    res.setHeader('Content-Type',row.attachment.mimeType);
    res.setHeader('Content-Length',row.attachment.byteLength);
    res.setHeader('Content-Disposition',
      'attachment; filename="leave-attachment"; filename*=UTF-8\'\''+
      encodeURIComponent(row.attachment.fileName));
    res.setHeader('X-Content-Type-Options','nosniff');
    res.send(Buffer.from(row.attachment.data));
  });
  route('patch','/api/leaves/:id/status',async(req,res)=>{
    requireRole(req.user,MANAGEMENT);
    checkedPatch(req.body,['status']);
    const id=validId(req.params.id);
    const result=await reviewLeave(req.user,id,req.body?.status);
    res.json(result);
  });
  // Real persisted cycle history for the company-admin V2 cycles table.
  // The configured cycle is shown separately only when it has not yet been
  // recorded in the history table (older imported company settings).
  route('get','/api/company/cycles',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const limit=safeInt(req.query?.limit??30,'limit',1,100);
    const offset=safeInt(req.query?.offset??0,'offset',0,100000);
    const [settings,rows]=await Promise.all([
      prisma.companySettings.findUnique({where:{companyId:c},
        select:{cycleStart:true,cycleEnd:true}}),
      prisma.cycle.findMany({where:{companyId:c},
        orderBy:[{startDate:'desc'},{endDate:'desc'},{id:'desc'}],
        take:limit+1,skip:offset,select:{id:true,startDate:true,endDate:true}}
      )
    ]);
    const current=settings?.cycleStart&&settings?.cycleEnd?{
      startDate:formatDate(settings.cycleStart),endDate:formatDate(settings.cycleEnd)}:null;
    // The configured cycle may exist on a later page. Check the entire
    // company history before adding a settings-only row to page one.
    const savedCurrent=current&&offset===0?await prisma.cycle.findFirst({
      where:{companyId:c,startDate:settings.cycleStart,endDate:settings.cycleEnd},
      select:{id:true}
    }):null;
    const todayUtc=new Date().toISOString().slice(0,10);
    const items=rows.slice(0,limit).map(row=>{
      const startDate=formatDate(row.startDate),endDate=formatDate(row.endDate);
      const active=Boolean(current&&current.startDate===startDate&&
        current.endDate===endDate);
      return {id:row.id,name:'سايكل '+startDate,
        startDate,endDate,current:active,status:active?'الحالي':
          todayUtc<startDate?'قادم':'منتهي'};
    });
    const configuredCurrent=current&&!savedCurrent&&offset===0?{
      id:null,name:'السايكل الحالي',...current,current:true,status:'الحالي',
      source:'SETTINGS'}:null;
    res.json({items:configuredCurrent?[configuredCurrent,...items]:items,
      hasMore:rows.length>limit,offset,limit});
  });

  route('get','/api/settings',async(req,res)=>{
    const c=requireCompany(req);
    res.json(await prisma.companySettings.findUnique({where:{companyId:c}}) || {
      companyId:c,frequencyA:4,frequencyB:2,frequencyC:1,annualLeaveBalance:12,workingDays:[0,1,2,3,4,6]});
  });
  route('patch','/api/settings',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),p=checkedPatch(req.body,[
      'frequencyA','frequencyB','frequencyC','annualLeaveBalance',
      'cycleStart','cycleEnd','workingDays','targetACoverage','managerInstructions'
    ]),data={};
    for(const [key,label,max] of [['frequencyA','frequencyA',30],['frequencyB','frequencyB',30],
      ['frequencyC','frequencyC',30],['annualLeaveBalance','annualLeaveBalance',365]]) {
      if(p[key]!==undefined)data[key]=safeInt(p[key],label,key==='annualLeaveBalance'?0:1,max);
    }
    if(p.targetACoverage!==undefined)
      data.targetACoverage=safeInt(p.targetACoverage,'targetACoverage',0,100);
    if(p.managerInstructions!==undefined){
      if(p.managerInstructions!==null&&
        (typeof p.managerInstructions!=='string'||p.managerInstructions.length>1000))
        throw new HttpError(400,'تعليمات المدير طويلة جداً');
      data.managerInstructions=p.managerInstructions?.trim()||null;
    }
    if(p.cycleStart!==undefined)data.cycleStart=p.cycleStart===null?null:asDate(p.cycleStart);
    if(p.cycleEnd!==undefined)data.cycleEnd=p.cycleEnd===null?null:asDate(p.cycleEnd);
    if(p.workingDays!==undefined){
      if(!Array.isArray(p.workingDays)||p.workingDays.some(d=>!Number.isInteger(d)||d<0||d>6))
        throw new HttpError(400,'أيام العمل غير صحيحة');
      data.workingDays=[...new Set(p.workingDays)];
    }
    const settings=await auditWrite(req.user,'UPDATE','SETTINGS',c,async(tx)=>{
      // Validate the resulting persisted date interval, not only dates sent in this PATCH.
      const current=await tx.companySettings.findUnique({where:{companyId:c}});
      const start=data.cycleStart!==undefined?data.cycleStart:current?.cycleStart;
      const end=data.cycleEnd!==undefined?data.cycleEnd:current?.cycleEnd;
      if(start&&end&&end<start)throw new HttpError(400,'نهاية الدورة قبل بدايتها');
      if(current?.cycleStart&&current?.cycleEnd)await tx.cycle.upsert({
        where:{companyId_startDate_endDate:{
          companyId:c,startDate:current.cycleStart,endDate:current.cycleEnd
        }},
        update:{},create:{companyId:c,startDate:current.cycleStart,endDate:current.cycleEnd}
      });
      if(start&&end)await tx.cycle.upsert({
        where:{companyId_startDate_endDate:{companyId:c,startDate:start,endDate:end}},
        update:{},create:{companyId:c,startDate:start,endDate:end}
      });
      return tx.companySettings.upsert({
        where:{companyId:c},update:data,create:{companyId:c,...data}
      });
    },{isolationLevel:'Serializable'});
    res.json(settings);
  });
  // Goals are owned by either the team or the representative, per doctor and
  // configured cycle. No write touches Visit, VisitTarget, or historical team IDs.
  route('get','/api/doctor-goals',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const {start,end}=cycleBounds(settings);
    const goals=await prisma.doctorVisitGoal.findMany({
      where:{companyId:c,cycleStart:start,cycleEnd:end},
      include:{doctor:{select:{id:true,name:true,specialty:true,active:true}}},
      orderBy:[{scope:'asc'},{ownerId:'asc'},{doctorId:'asc'}],take:5001
    });
    if(goals.length>5000)throw new HttpError(413,'عدد الأهداف كبير جداً');
    res.json({cycleStart:start.toISOString().slice(0,10),
      cycleEnd:end.toISOString().slice(0,10),goals});
  });
  route('put','/api/doctor-goals',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const result=await auditWrite(req.user,
      req.body?.target===null?'DELETE':'UPSERT','DOCTOR_GOAL',
      v=>v.id,tx=>storeDoctorGoal(tx,c,req.body),
      {isolationLevel:'Serializable'});
    res.json(result);
  });
  route('get','/api/analytics/frequency.xlsx',async(req,res)=>{
    const data=await getFrequency(req.user,{
      period:req.query?.period||'cycle',onDate:req.query?.onDate});
    const output=await exportFrequencyXlsx(data);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="mandob-frequency.xlsx"');
    res.send(Buffer.from(output));
  });
  route('get','/api/analytics/frequency',async(req,res)=>{
    res.json(await getFrequency(req.user,{
      period:req.query?.period||'cycle',onDate:req.query?.onDate}));
  });
  // One computation for clients that display frequency and area coverage together.
  route('get','/api/analytics/summary',async(req,res)=>{
    const frequency=await getFrequency(req.user,{
      period:req.query?.period||'cycle',onDate:req.query?.onDate});
    const coverage=await getAreaCoverage(req.user,frequency);
    res.json({frequency,coverage});
  });
  route('get','/api/analytics/area-coverage',async(req,res)=>{
    const frequency=await getFrequency(req.user,{
      period:req.query?.period||'cycle',onDate:req.query?.onDate});
    res.json(await getAreaCoverage(req.user,frequency));
  });
  route('get','/api/analytics/product-performance',async(req,res)=>{
    requireRole(req.user,['REP']);
    const c=companyId(req.user);
    const frequency=await getFrequency(req.user);
    const start=asDate(frequency.cycleStart),end=asDate(frequency.cycleEnd);
    const {start:queryStart,end:queryEnd}=periodWindow(start,end,
      req.query?.period||'cycle',req.query?.onDate);
    const rep=await prisma.user.findFirst({
      where:{id:req.user.id,companyId:c,role:'REP',active:true},
      select:{teamId:true,
        team:{select:{products:{include:{product:{select:{id:true,name:true,active:true}}}}}},
        repProducts:{include:{product:{select:{id:true,name:true,active:true}}}}}
    });
    if(!rep)throw new HttpError(403,'حساب المندوب غير نشط');
    const assigned=(rep.teamId?(rep.team?.products||[]):rep.repProducts)
      .map(link=>link.product).filter(product=>product?.active)
      .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    const rows=await prisma.visitProduct.findMany({
      where:{visit:{companyId:c,repId:req.user.id,visitDate:{gte:queryStart,lte:queryEnd}}},
      select:{productId:true,quantity:true,product:{select:{name:true}},
        visit:{select:{visitDate:true}}}
    });
    const stats=new Map(assigned.map(product=>[product.id,{
      id:product.id,name:product.name,assigned:true,promotions:0,quantity:0,lastPromotedAt:null
    }]));
    for(const row of rows){
      if(!stats.has(row.productId))stats.set(row.productId,{
        id:row.productId,name:row.product.name,assigned:false,promotions:0,quantity:0,lastPromotedAt:null
      });
      const item=stats.get(row.productId);
      item.promotions++;
      item.quantity+=row.quantity;
      const date=row.visit.visitDate.toISOString().slice(0,10);
      if(!item.lastPromotedAt||date>item.lastPromotedAt)item.lastPromotedAt=date;
    }
    const items=[...stats.values()].sort((a,b)=>Number(b.assigned)-Number(a.assigned)||
      a.name.localeCompare(b.name,'ar'));
    res.json({
      cycleStart:frequency.cycleStart,cycleEnd:frequency.cycleEnd,
      periodStart:formatDate(queryStart),periodEnd:formatDate(queryEnd),
      totalPromotions:items.reduce((sum,item)=>sum+item.promotions,0),
      totalQuantity:items.reduce((sum,item)=>sum+item.quantity,0),
      items
    });
  });

  route('get','/api/analytics/product-performance/:id',async(req,res)=>{
    requireRole(req.user,['REP']);
    const c=companyId(req.user),productId=validId(req.params.id);
    const product=await prisma.product.findFirst({
      where:{id:productId,companyId:c},select:{id:true,name:true,active:true}
    });
    if(!product)throw new HttpError(404,'الصنف غير موجود');
    const frequency=await getFrequency(req.user);
    const start=asDate(frequency.cycleStart),end=asDate(frequency.cycleEnd);
    const {start:queryStart,end:queryEnd}=periodWindow(start,end,
      req.query?.period||'cycle',req.query?.onDate);
    const rows=await prisma.visitProduct.findMany({
      where:{productId,visit:{companyId:c,repId:req.user.id,visitDate:{gte:queryStart,lte:queryEnd}}},
      orderBy:[{visit:{visitDate:'desc'}},{createdAt:'desc'}],
      select:{quantity:true,createdAt:true,visit:{
        select:{id:true,type:true,visitDate:true,locationAccuracy:true,
          targets:{select:{
            doctor:{select:{name:true}},pharmacy:{select:{name:true}},
            hospital:{select:{name:true}},areaAtVisit:{select:{name:true}}
          }}
        }
      }}
    });
    res.json({
      id:product.id,name:product.name,cycleStart:frequency.cycleStart,cycleEnd:frequency.cycleEnd,
      promotions:rows.length,quantity:rows.reduce((sum,row)=>sum+row.quantity,0),
      rows:rows.map(row=>({
        visitId:row.visit.id,type:row.visit.type,
        visitDate:row.visit.visitDate.toISOString().slice(0,10),
        quantity:row.quantity,locationAccuracy:row.visit.locationAccuracy,
        targets:row.visit.targets.map(target=>({
          name:target.doctor?.name||target.pharmacy?.name||target.hospital?.name||'—',
          areaName:target.areaAtVisit?.name||null
        }))
      }))
    });
  });

  route('get','/api/analytics/cycles',async(req,res)=>{
    requireRole(req.user,['REP']);
    const c=companyId(req.user);
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const stored=await prisma.cycle.findMany({
      where:{companyId:c},orderBy:[{startDate:'desc'},{endDate:'desc'}],take:24
    });
    const goalPeriods=await prisma.doctorVisitGoal.findMany({
      where:{companyId:c},
      distinct:['cycleStart','cycleEnd'],
      select:{cycleStart:true,cycleEnd:true},
      orderBy:{cycleStart:'desc'},take:24
    });
    const periods=new Map();
    function addPeriod(start,end){
      if(!start||!end)return;
      const a=new Date(start),b=new Date(end);
      const key=a.toISOString().slice(0,10)+'|'+b.toISOString().slice(0,10);
      periods.set(key,{start:a,end:b});
    }
    if(settings?.cycleStart&&settings?.cycleEnd)addPeriod(settings.cycleStart,settings.cycleEnd);
    for(const cycle of stored)addPeriod(cycle.startDate,cycle.endDate);
    for(const goal of goalPeriods)addPeriod(goal.cycleStart,goal.cycleEnd);
    const sorted=[...periods.values()].sort((a,b)=>b.start.getTime()-a.start.getTime()).slice(0,12);
    const currentStart=settings?.cycleStart?.toISOString().slice(0,10)||null;
    const currentEnd=settings?.cycleEnd?.toISOString().slice(0,10)||null;
    const readPeriod=async(period)=>{
      const whereVisit={companyId:c,repId:req.user.id,
        visitDate:{gte:period.start,lte:period.end}};
      const [visits,targets,productStats]=await Promise.all([
        prisma.visit.count({where:whereVisit}),
        prisma.visitTarget.findMany({
          where:{visit:whereVisit},
          select:{doctorId:true,areaIdAtVisit:true}
        }),
        prisma.visitProduct.aggregate({
          where:{visit:whereVisit},_count:{_all:true},_sum:{quantity:true}
        })
      ]);
      const doctors=new Set(targets.map(row=>row.doctorId).filter(Boolean));
      const areas=new Set(targets.map(row=>row.areaIdAtVisit).filter(Boolean));
      const startDate=period.start.toISOString().slice(0,10);
      const endDate=period.end.toISOString().slice(0,10);
      return {
        startDate,endDate,current:startDate===currentStart&&endDate===currentEnd,
        visits,targets:targets.length,uniqueDoctors:doctors.size,areas:areas.size,
        productPromotions:productStats._count._all,
        quantity:productStats._sum.quantity||0
      };
    };
    // Bound concurrency to two periods (up to six reads) to avoid pool spikes.
    const items=[];
    for(let i=0;i<sorted.length;i+=2){
      items.push(...await Promise.all(sorted.slice(i,i+2).map(readPeriod)));
    }
    res.json({items});
  });

  route('get','/api/analytics/rep-overview',async(req,res)=>{
    requireRole(req.user,['REP']);
    const frequency=await getFrequency(req.user,{
      period:req.query?.period||'cycle',onDate:req.query?.onDate});
    const coverage=await getAreaCoverage(req.user,frequency);
    res.json({frequency,coverage});
  });
}

module.exports={registerRoutes,repFilter,entityFilter,managerCanSeeRep,auditWrite,canReadSubmittedReport,calculateRepReport};
