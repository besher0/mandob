'use strict';
const {prisma,HttpError,requireRole,companyId,scope,asDate,requireString,safeInt,
  validateLocation,hashPassword,publicUser}=require('./auth');

const ADMIN=['COMPANY_ADMIN'];
const MANAGEMENT=['COMPANY_ADMIN','TEAM_MANAGER'];
const ALL_STAFF=['COMPANY_ADMIN','TEAM_MANAGER','REP'];
const GRADE=['A','B','C'];
const VISIT_TYPES={DOCTOR:'doctor',PHARMACY:'pharmacy',HOSPITAL:'hospital'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(value) { if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'معرّف غير صالح');return value; }
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
function audit(user,action,entity,entityId){
  return prisma.auditLog.create({data:{companyId:user.companyId,actorId:user.id,action,entity,entityId}});
}
function repFilter(user) {
  const c=companyId(user);
  if(user.role==='REP')return {companyId:c,id:user.id};
  if(user.role==='TEAM_MANAGER')return {companyId:c,teamId:user.teamId||'__UNASSIGNED__',role:'REP'};
  return {companyId:c,role:'REP'};
}
function entityFilter(user) {
  const companyIdValue=companyId(user);
  if(user.role==='REP')return {companyId:companyIdValue,area:{repAreas:{some:{repId:user.id}}}};
  if(user.role==='TEAM_MANAGER')return {companyId:companyIdValue,area:{repAreas:{some:{rep:{teamId:user.teamId||'__UNASSIGNED__'}}}}};
  return {companyId:companyIdValue};
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
function formatDate(date){return date instanceof Date?date.toISOString().slice(0,10):date;}
function listVisit(v){
  return {id:v.id,repId:v.repId,repName:v.rep?.name,type:v.type,visitDate:formatDate(v.visitDate),
    createdAt:v.createdAt,location:{latitude:v.latitude,longitude:v.longitude,accuracy:v.locationAccuracy,
      capturedAt:v.locationCapturedAt},targets:v.targets.map(t=>({
      id:t.doctorId||t.pharmacyId||t.hospitalId,name:t.doctor?.name||t.pharmacy?.name||t.hospital?.name}))};
}
const visitInclude={rep:{select:{id:true,name:true,teamId:true}},targets:{include:{
  doctor:{select:{id:true,name:true}},pharmacy:{select:{id:true,name:true}},hospital:{select:{id:true,name:true}}}}};

function registerRoutes(app,wrap) {
  const route=(method,url,fn)=>app[method](url,wrap(fn));
  // Super-admin can manage the directory of companies and provision isolated company administrators.
  route('get','/api/companies',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    const data=await prisma.company.findMany({include:{_count:{select:{users:true,teams:true,visits:true}}},orderBy:{createdAt:'desc'}});
    res.json(data);
  });
  route('post','/api/companies',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    const name=requireString(req.body?.name,'company name');
    const company=await prisma.company.create({data:{name,settings:{create:{}}}});
    res.status(201).json(company);
  });
  route('post','/api/companies/:id/admins',async(req,res)=>{
    requireRole(req.user,['SUPER_ADMIN']);
    const id=validId(req.params.id);
    const username=requireString(req.body?.username,'username',150);
    const name=requireString(req.body?.name,'name');
    const passwordHash=hashPassword(req.body?.password);
    const company=await prisma.company.findUnique({where:{id}});
    if(!company)throw new HttpError(404,'الشركة غير موجودة');
    const u=await prisma.user.create({data:{companyId:id,role:'COMPANY_ADMIN',username,name,passwordHash}});
    res.status(201).json({user:publicUser(u)});
  });

  route('get','/api/dashboard',async(req,res)=>{
    const company= requireCompany(req), rwhere=repFilter(req.user), vwhere=scope(req.user);
    const [reps,doctors,pharmacies,hospitals,visits,leaves]=await Promise.all([
      prisma.user.count({where:rwhere}),
      prisma.doctor.count({where:entityFilter(req.user)}),
      prisma.pharmacy.count({where:entityFilter(req.user)}),
      prisma.hospital.count({where:entityFilter(req.user)}),
      prisma.visit.count({where:vwhere}),
      prisma.leaveRequest.count({where:{...vwhere,status:'PENDING'}})
    ]);
    res.json({companyId:company,reps,doctors,pharmacies,hospitals,visits,pendingLeaves:leaves});
  });
  route('get','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    const where=req.user.role==='TEAM_MANAGER'?{id:req.user.teamId||'__UNASSIGNED__',companyId:c}:{companyId:c};
    const teams=await prisma.team.findMany({where,include:{_count:{select:{users:true}},specialties:true},orderBy:{name:'asc'}});
    res.json(teams);
  });
  route('post','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const name=requireString(req.body?.name,'team name');
    const specialties=normalizedStringList(req.body?.specialties||[]);
    const team=await prisma.team.create({data:{companyId:c,name,specialties:{create:specialties.map(specialty=>({specialty}))}}});
    await audit(req.user,'CREATE','TEAM',team.id);
    res.status(201).json(team);
  });
  route('get','/api/users',async(req,res)=>{
    onlyCompany(req,MANAGEMENT);
    const where=req.user.role==='TEAM_MANAGER'?
      {companyId:req.user.companyId,teamId:req.user.teamId||'__UNASSIGNED__'}:
      {companyId:req.user.companyId};
    const people=await prisma.user.findMany({where,select:{id:true,name:true,username:true,role:true,
      teamId:true,active:true,dailyTarget:true,annualLeaveBalance:true,repAreas:{include:{area:true}}},orderBy:{name:'asc'}});
    res.json(people);
  });
  route('post','/api/users',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const {role,teamId}=req.body||{};
    if(!['REP','TEAM_MANAGER'].includes(role))throw new HttpError(400,'دور غير مسموح');
    const name=requireString(req.body?.name,'name');
    const username=requireString(req.body?.username,'username',150);
    const passwordHash=hashPassword(req.body?.password);
    const areas=safeList(req.body?.areaIds||[]);
    const team=teamId?await prisma.team.findFirst({where:{id:validId(teamId),companyId:c}}):null;
    if(teamId&&!team)throw new HttpError(400,'الفريق غير تابع للشركة');
    const validAreas=await prisma.area.count({where:{companyId:c,id:{in:areas}}});
    if(validAreas!==areas.length)throw new HttpError(400,'منطقة غير تابعة للشركة');
    const user=await prisma.user.create({data:{companyId:c,role,name,username,passwordHash,
      teamId:team?.id,repAreas:{create:areas.map(areaId=>({areaId}))}}});
    await audit(req.user,'CREATE','USER',user.id);
    res.status(201).json({user:publicUser(user)});
  });
  route('patch','/api/users/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const id=validId(req.params.id);
    const existing=await prisma.user.findFirst({where:{id,companyId:c,role:{in:['REP','TEAM_MANAGER']}}});
    if(!existing)throw new HttpError(404,'المستخدم غير موجود');
    const payload=req.body||{};
    const data={};
    if(payload.name!==undefined)data.name=requireString(payload.name,'name');
    if(payload.dailyTarget!==undefined)data.dailyTarget=safeInt(payload.dailyTarget,'dailyTarget',1,100);
    if(payload.annualLeaveBalance!==undefined)data.annualLeaveBalance=safeInt(payload.annualLeaveBalance,'annualLeaveBalance',0,365);
    if(payload.active!==undefined){
      if(typeof payload.active!=='boolean')throw new HttpError(400,'active');
      data.active=payload.active;
    }
    if(payload.teamId!==undefined){
      if(payload.teamId===null)data.teamId=null;
      else {
        const team=await prisma.team.findFirst({where:{id:validId(payload.teamId),companyId:c}});
        if(!team)throw new HttpError(400,'الفريق غير موجود');
        data.teamId=team.id;
      }
    }
    const areaIds=payload.areaIds===undefined?null:safeList(payload.areaIds);
    if(areaIds){
      const validAreas=await prisma.area.count({where:{companyId:c,id:{in:areaIds}}});
      if(validAreas!==areaIds.length)throw new HttpError(400,'منطقة غير تابعة للشركة');
    }
    const user=await prisma.$transaction(async(tx)=>{
      const updated=await tx.user.update({where:{id},data});
      if(areaIds!==null){
        await tx.repArea.deleteMany({where:{repId:id}});
        if(areaIds.length)await tx.repArea.createMany({data:areaIds.map(areaId=>({repId:id,areaId}))});
      }
      if(payload.active===false)await tx.authSession.deleteMany({where:{userId:id}});
      return updated;
    });
    await audit(req.user,'UPDATE','USER',id);
    res.json({user:publicUser(user)});
  });
  route('get','/api/areas',async(req,res)=>{
    const c=requireCompany(req);
    const where=req.user.role==='REP'?{companyId:c,repAreas:{some:{repId:req.user.id}}}:
      req.user.role==='TEAM_MANAGER'?{companyId:c,repAreas:{some:{rep:{teamId:req.user.teamId||'__UNASSIGNED__'}}}}:{companyId:c};
    const areas=await prisma.area.findMany({where,orderBy:{name:'asc'}});
    res.json(areas);
  });
  route('post','/api/areas',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const area=await prisma.area.create({data:{companyId:c,name:requireString(req.body?.name,'area'),
      city:typeof req.body?.city==='string'?req.body.city.trim():null}});
    await audit(req.user,'CREATE','AREA',area.id);
    res.status(201).json(area);
  });
  route('get','/api/doctors',async(req,res)=>{
    const c=requireCompany(req), q=req.query||{}, where={...entityFilter(req.user)};
    if(q.areaId)where.areaId=validId(q.areaId);
    const doctors=await prisma.doctor.findMany({where,take:500,include:{area:{select:{id:true,name:true}}},
      orderBy:{name:'asc'}});
    res.json(doctors);
  });
  route('post','/api/doctors',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const area=await prisma.area.findFirst({where:{id:validId(req.body?.areaId),companyId:c}});
    if(!area)throw new HttpError(400,'منطقة غير تابعة للشركة');
    const d=await prisma.doctor.create({data:{companyId:c,areaId:area.id,name:requireString(req.body?.name,'name'),
      specialty:requireString(req.body?.specialty,'specialty'),grade:grade(req.body?.grade||'C'),
      city:typeof req.body?.city==='string'?req.body.city.trim():null}});
    await audit(req.user,'CREATE','DOCTOR',d.id);
    res.status(201).json(d);
  });
  route('get','/api/pharmacies',async(req,res)=>{
    requireCompany(req);
    res.json(await prisma.pharmacy.findMany({where:entityFilter(req.user),take:500,include:{area:true},orderBy:{name:'asc'}}));
  });
  route('post','/api/pharmacies',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
    const p=await prisma.pharmacy.create({data:{companyId:c,areaId,
      name:requireString(req.body?.name,'name'),grade:grade(req.body?.grade||'A'),
      target:safeInt(req.body?.target??4,'target',1,100),
      kind:typeof req.body?.kind==='string'?req.body.kind.trim():'مستقلة'}});
    await audit(req.user,'CREATE','PHARMACY',p.id);
    res.status(201).json(p);
  });
  route('get','/api/hospitals',async(req,res)=>{
    requireCompany(req);
    res.json(await prisma.hospital.findMany({where:entityFilter(req.user),take:500,include:{area:true},orderBy:{name:'asc'}}));
  });
  route('post','/api/hospitals',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
    const h=await prisma.hospital.create({data:{companyId:c,areaId,
      name:requireString(req.body?.name,'name'),
      category:requireString(req.body?.category||'خاص','category'),
      specialty:requireString(req.body?.specialty||'عام','specialty'),
      target:safeInt(req.body?.target??4,'target',1,100)}});
    await audit(req.user,'CREATE','HOSPITAL',h.id);
    res.status(201).json(h);
  });
  route('get','/api/products',async(req,res)=>{
    const c=requireCompany(req);
    res.json(await prisma.product.findMany({where:{companyId:c},orderBy:{name:'asc'}}));
  });
  route('post','/api/products',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const p=await prisma.product.create({data:{companyId:c,name:requireString(req.body?.name,'name'),
      activeIngredient:typeof req.body?.activeIngredient==='string'?req.body.activeIngredient.trim():null}});
    res.status(201).json(p);
  });
  route('get','/api/visits',async(req,res)=>{
    requireCompany(req);
    const take=safeInt(req.query.limit??100,'limit',1,200);
    const visits=await prisma.visit.findMany({where:scope(req.user),orderBy:[{visitDate:'desc'},{createdAt:'desc'}],
      take,include:visitInclude});
    res.json(visits.map(listVisit));
  });
  route('post','/api/visits',async(req,res)=>{
    requireRole(req.user,['REP']);
    const company=companyId(req.user);
    const type=req.body?.type;
    if(!Object.hasOwn(VISIT_TYPES,type))throw new HttpError(400,'نوع الجولة غير صحيح');
    const targetIds=safeList(req.body?.targetIds||[]);
    if(targetIds.length===0)throw new HttpError(400,'اختر جهة واحدة على الأقل');
    const visitDate=asDate(req.body?.visitDate);
    if(visitDate>new Date())throw new HttpError(400,'لا يمكن تسجيل جولة بتاريخ مستقبلي');
    const clientVisitId=validId(req.body?.clientVisitId);
    const existing=await prisma.visit.findUnique({where:{clientVisitId}});
    if(existing) {
      if(existing.repId!==req.user.id||existing.companyId!==company)throw new HttpError(409,'رقم العملية مستخدم');
      return res.json({id:existing.id,duplicate:true});
    }
    const pos=validateLocation(req.body?.location);
    const model=VISIT_TYPES[type], targetModel=prisma[model];
    const targets=await targetModel.findMany({where:{id:{in:targetIds},companyId:company,
      area:{repAreas:{some:{repId:req.user.id}}}},select:{id:true}});
    if(targets.length!==targetIds.length)throw new HttpError(403,'توجد جهة خارج مناطق المندوب أو شركته');
    const idField={DOCTOR:'doctorId',PHARMACY:'pharmacyId',HOSPITAL:'hospitalId'}[type];
    const visit=await prisma.visit.create({data:{companyId:company,repId:req.user.id,clientVisitId,type,visitDate,
      latitude:pos.latitude,longitude:pos.longitude,locationAccuracy:pos.accuracy,
      locationCapturedAt:pos.capturedAt,targets:{create:targetIds.map(id=>({[idField]:id}))}},
      include:visitInclude});
    res.status(201).json(listVisit(visit));
  });
  route('get','/api/leaves',async(req,res)=>{
    requireCompany(req);
    const leaves=await prisma.leaveRequest.findMany({where:scope(req.user),take:200,
      orderBy:{createdAt:'desc'},include:{rep:{select:{id:true,name:true,teamId:true}}}});
    res.json(leaves.map(l=>({...l,fromDate:formatDate(l.fromDate),toDate:formatDate(l.toDate)})));
  });
  route('post','/api/leaves',async(req,res)=>{
    requireRole(req.user,['REP']);
    const fromDate=asDate(req.body?.fromDate),toDate=asDate(req.body?.toDate);
    if(toDate<fromDate)throw new HttpError(400,'تاريخ النهاية قبل البداية');
    const leave=await prisma.leaveRequest.create({data:{repId:req.user.id,companyId:companyId(req.user),
      type:requireString(req.body?.type,'type',60),fromDate,toDate,
      reason:typeof req.body?.reason==='string'?req.body.reason.slice(0,1000):null}});
    res.status(201).json({id:leave.id,status:leave.status});
  });
  route('patch','/api/leaves/:id/status',async(req,res)=>{
    onlyCompany(req,MANAGEMENT);
    const id=validId(req.params.id), status=req.body?.status;
    if(!['APPROVED','REJECTED'].includes(status))throw new HttpError(400,'الحالة غير صحيحة');
    const leave=await prisma.leaveRequest.findFirst({where:{id,companyId:req.user.companyId},include:{rep:true}});
    if(!leave||!managerCanSeeRep(req.user,leave.rep))throw new HttpError(404,'الطلب غير موجود');
    if(leave.status!=='PENDING')throw new HttpError(409,'تمت مراجعة الطلب سابقاً');
    const updated=await prisma.leaveRequest.update({where:{id},data:{status,reviewedById:req.user.id,reviewedAt:new Date()}});
    await audit(req.user,'REVIEW','LEAVE',id);
    res.json({id:updated.id,status:updated.status});
  });
  route('get','/api/settings',async(req,res)=>{
    const c=requireCompany(req);
    res.json(await prisma.companySettings.findUnique({where:{companyId:c}}) || {
      companyId:c,frequencyA:4,frequencyB:2,frequencyC:1,annualLeaveBalance:12,workingDays:[0,1,2,3,4,6]});
  });
  route('patch','/api/settings',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),p=req.body||{},data={};
    for(const [key,label,max] of [['frequencyA','frequencyA',30],['frequencyB','frequencyB',30],
      ['frequencyC','frequencyC',30],['annualLeaveBalance','annualLeaveBalance',365]]) {
      if(p[key]!==undefined)data[key]=safeInt(p[key],label,key==='annualLeaveBalance'?0:1,max);
    }
    if(p.cycleStart!==undefined)data.cycleStart=p.cycleStart===null?null:asDate(p.cycleStart);
    if(p.cycleEnd!==undefined)data.cycleEnd=p.cycleEnd===null?null:asDate(p.cycleEnd);
    if(data.cycleStart&&data.cycleEnd&&data.cycleEnd<data.cycleStart)throw new HttpError(400,'نهاية الدورة قبل بدايتها');
    if(p.workingDays!==undefined){
      if(!Array.isArray(p.workingDays)||p.workingDays.some(d=>!Number.isInteger(d)||d<0||d>6))
        throw new HttpError(400,'أيام العمل غير صحيحة');
      data.workingDays=[...new Set(p.workingDays)];
    }
    const settings=await prisma.companySettings.upsert({where:{companyId:c},update:data,create:{companyId:c,...data}});
    await audit(req.user,'UPDATE','SETTINGS',c);
    res.json(settings);
  });
  route('get','/api/analytics/frequency',async(req,res)=>{
    const c=requireCompany(req);
    const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
    const start=settings?.cycleStart||new Date('2000-01-01'),end=settings?.cycleEnd||new Date('2100-01-01');
    const where={...scope(req.user),type:'DOCTOR',visitDate:{gte:start,lte:end}};
    const [doctors,visits]=await Promise.all([
      prisma.doctor.findMany({where:entityFilter(req.user),include:{area:{select:{name:true}}},take:1000}),
      prisma.visit.findMany({where,select:{targets:{select:{doctorId:true}},repId:true},take:10000})
    ]);
    const counts=new Map();
    for(const visit of visits)for(const t of visit.targets){
      if(t.doctorId)counts.set(t.doctorId,(counts.get(t.doctorId)||0)+1);
    }
    const rows=doctors.map(d=>{
      const target=d.grade==='A'?(settings?.frequencyA??4):d.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1);
      const done=counts.get(d.id)||0;
      return {id:d.id,name:d.name,area:d.area.name,grade:d.grade,done,target,coverage:Math.round(Math.min(1,done/target)*100)};
    });
    res.json({items:rows,completed:rows.filter(r=>r.done>=r.target).length,total:rows.length});
  });
}

module.exports={registerRoutes,repFilter,entityFilter,managerCanSeeRep};
