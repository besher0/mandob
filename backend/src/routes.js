'use strict';
const {prisma,HttpError,requireRole,companyId,scope,visitScope,asDate,requireString,safeInt,
  hashPassword,publicUser}=require('./auth');

const {submitVisit,listVisit,include:visitInclude}=require('./visit-service');
const {submitLeave,reviewLeave}=require('./leave-service');
const {getFrequency}=require('./analytics-service');
const {visitReport,exportVisitsXlsx}=require('./report-service');
const {previewDoctors,commitDoctors}=require('./doctor-import-service');
const express=require('express');

const ADMIN=['COMPANY_ADMIN'];
const MANAGEMENT=['COMPANY_ADMIN','TEAM_MANAGER'];
const GRADE=['A','B','C'];
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
// Reuse the same doctor-area visibility for lists and dashboard counts.
function doctorFilter(user){
  const c=companyId(user),where={companyId:c};
  const repScope=user.role==='REP'?{repId:user.id}:
    user.role==='TEAM_MANAGER'?{rep:{teamId:user.teamId||'__UNASSIGNED__'}}:null;
  if(repScope)where.OR=[
    {area:{repAreas:{some:repScope}}},
    {doctorAreas:{some:{area:{repAreas:{some:repScope}}}}}
  ];
  return where;
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
    const company=await auditWrite(req.user,'CREATE','COMPANY',v=>v.id,tx=>tx.company.create({
      data:{name,settings:{create:{}}}
    }));
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
    const u=await auditWrite(req.user,'CREATE','USER',v=>v.id,tx=>tx.user.create({
      data:{companyId:id,role:'COMPANY_ADMIN',username,name,passwordHash}
    }));
    res.status(201).json({user:publicUser(u)});
  });

  route('get','/api/dashboard',async(req,res)=>{
    const company= requireCompany(req), rwhere=repFilter(req.user), vwhere=visitScope(req.user), lwhere=scope(req.user);
    const [reps,doctors,pharmacies,hospitals,visits,leaves]=await Promise.all([
      prisma.user.count({where:rwhere}),
      prisma.doctor.count({where:doctorFilter(req.user)}),
      prisma.pharmacy.count({where:entityFilter(req.user)}),
      prisma.hospital.count({where:entityFilter(req.user)}),
      prisma.visit.count({where:vwhere}),
      prisma.leaveRequest.count({where:{...lwhere,status:'PENDING'}})
    ]);
    res.json({companyId:company,reps,doctors,pharmacies,hospitals,visits,pendingLeaves:leaves});
  });
  const teamRelations={
    _count:{select:{users:true}},
    specialties:{orderBy:{specialty:'asc'}},
    products:{include:{product:{select:{id:true,name:true}}}}
  };
  route('get','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,MANAGEMENT);
    const where=req.user.role==='TEAM_MANAGER'?{id:req.user.teamId||'__UNASSIGNED__',companyId:c}:{companyId:c};
    const teams=await prisma.team.findMany({where,include:teamRelations,orderBy:{name:'asc'}});
    res.json(teams);
  });
  route('post','/api/teams',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const name=requireString(req.body?.name,'team name');
    const specialties=normalizedStringList(req.body?.specialties??[]);
    const productIds=safeList(req.body?.productIds??[]);
    const team=await auditWrite(req.user,'CREATE','TEAM',v=>v.id,async(tx)=>{
      if(productIds.length!==await tx.product.count({where:{id:{in:productIds},companyId:c,active:true}}))
        throw new HttpError(400,'المنتج غير تابع للشركة أو غير نشط');
      return tx.team.create({data:{companyId:c,name,
        specialties:{create:specialties.map(specialty=>({specialty}))},
        products:{create:productIds.map(productId=>({productId}))}
      },include:teamRelations});
    });
    res.status(201).json(team);
  });
  // Restore the existing legacy team edit workflow without changing memberships or visit history.
  // Omitted fields are left intact; supplied product and specialty arrays replace those sets.
  route('patch','/api/teams/:id',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id),payload=req.body||{};
    const updates={};
    if(payload.name!==undefined)updates.name=requireString(payload.name,'team name');
    const specialties=payload.specialties===undefined?null:normalizedStringList(payload.specialties);
    const productIds=payload.productIds===undefined?null:safeList(payload.productIds);
    if(!Object.keys(updates).length&&specialties===null&&productIds===null)
      throw new HttpError(400,'لا توجد بيانات لتعديلها');
    const team=await auditWrite(req.user,'UPDATE','TEAM',id,async(tx)=>{
      const existing=await tx.team.findFirst({where:{id,companyId:c},select:{id:true}});
      if(!existing)throw new HttpError(404,'الفريق غير موجود');
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
    const user=await auditWrite(req.user,'CREATE','USER',v=>v.id,tx=>tx.user.create({
      data:{companyId:c,role,name,username,passwordHash,
        teamId:team?.id,repAreas:{create:areas.map(areaId=>({areaId}))}}
    }));
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
    const user=await auditWrite(req.user,'UPDATE','USER',id,async(tx)=>{
      const updated=await tx.user.update({where:{id},data});
      if(areaIds!==null){
        await tx.repArea.deleteMany({where:{repId:id}});
        if(areaIds.length)await tx.repArea.createMany({data:areaIds.map(areaId=>({repId:id,areaId}))});
      }
      if(payload.active===false)await tx.authSession.deleteMany({where:{userId:id}});
      return updated;
    },{isolationLevel:'Serializable'});
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
    const area=await auditWrite(req.user,'CREATE','AREA',v=>v.id,tx=>tx.area.create({
      data:{companyId:c,name:requireString(req.body?.name,'area'),
        city:typeof req.body?.city==='string'?req.body.city.trim():null}
    }));
    res.status(201).json(area);
  });
  route('get','/api/doctors',async(req,res)=>{
    requireCompany(req);
    const q=req.query||{},where=doctorFilter(req.user);
    if(q.includeArchived !== undefined && q.includeArchived !== 'true' && q.includeArchived !== 'false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true' && req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    if(q.areaId){const areaId=validId(q.areaId);
      where.AND=[{OR:[{areaId},{doctorAreas:{some:{areaId}}}]}];
    }
    const doctors=await prisma.doctor.findMany({where,take:500,
      include:{area:{select:{id:true,name:true}},
        doctorAreas:{include:{area:{select:{id:true,name:true}}}}},
      orderBy:{name:'asc'}});
    res.json(doctors);
  });
  route('post','/api/doctors',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const area=await prisma.area.findFirst({where:{id:validId(req.body?.areaId),companyId:c}});
    if(!area)throw new HttpError(400,'منطقة غير تابعة للشركة');
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
  // Archiving changes doctor status only; all existing VisitTarget references survive.
  route('patch','/api/doctors/:id/status',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),id=validId(req.params.id);
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
    if(q.includeArchived!==undefined && q.includeArchived!=='true' && q.includeArchived!=='false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true'&&req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    res.json(await prisma.pharmacy.findMany({where,take:500,include:{area:true},orderBy:{name:'asc'}}));
  });
  route('post','/api/pharmacies',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
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
    if(q.includeArchived!==undefined && q.includeArchived!=='true' && q.includeArchived!=='false')
      throw new HttpError(400,'قيمة includeArchived غير صحيحة');
    if(q.includeArchived==='true'&&req.user.role!=='COMPANY_ADMIN')
      throw new HttpError(403,'عرض السجلات المؤرشفة مسموح لمدير الشركة فقط');
    if(q.includeArchived!=='true')where.active=true;
    res.json(await prisma.hospital.findMany({where,take:500,include:{area:true},orderBy:{name:'asc'}}));
  });
  route('post','/api/hospitals',async(req,res)=>{
    const c=onlyCompany(req,ADMIN),areaId=validId(req.body?.areaId);
    if(!await prisma.area.findFirst({where:{id:areaId,companyId:c}}))throw new HttpError(400,'منطقة غير صحيحة');
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
    res.json(await prisma.product.findMany({where:{companyId:c},orderBy:{name:'asc'}}));
  });
  route('post','/api/products',async(req,res)=>{
    const c=onlyCompany(req,ADMIN);
    const p=await auditWrite(req.user,'CREATE','PRODUCT',v=>v.id,tx=>tx.product.create({
      data:{companyId:c,name:requireString(req.body?.name,'name'),
        activeIngredient:typeof req.body?.activeIngredient==='string'?req.body.activeIngredient.trim():null}
    }));
    res.status(201).json(p);
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
    const visits=await prisma.visit.findMany({
      where:visitScope(req.user),
      orderBy:[{visitDate:'desc'},{createdAt:'desc'},{id:'desc'}],
      skip:offset,take,include:visitInclude
    });
    res.json(visits.map(listVisit));
  });
  route('post','/api/visits',async(req,res)=>{
    const result=await submitVisit(req.user,req.body);
    res.status(result.duplicate?200:201).json(result);
  });
  route('get','/api/leaves',async(req,res)=>{
    requireCompany(req);
    const take=safeInt(req.query.limit??200,'limit',1,200);
    const offset=safeInt(req.query.offset??0,'offset',0,100000);
    const leaves=await prisma.leaveRequest.findMany({
      where:scope(req.user),skip:offset,take,
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      include:{rep:{select:{id:true,name:true,teamId:true}}}
    });
    res.json(leaves.map(l=>({...l,fromDate:formatDate(l.fromDate),toDate:formatDate(l.toDate)})));
  });
  route('post','/api/leaves',async(req,res)=>{
    const leave=await submitLeave(req.user,req.body);
    res.status(201).json({id:leave.id,status:leave.status});
  });
  route('patch','/api/leaves/:id/status',async(req,res)=>{
    const id=validId(req.params.id);
    const result=await reviewLeave(req.user,id,req.body?.status);
    res.json(result);
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
      return tx.companySettings.upsert({
        where:{companyId:c},update:data,create:{companyId:c,...data}
      });
    },{isolationLevel:'Serializable'});
    res.json(settings);
  });
  route('get','/api/analytics/frequency',async(req,res)=>{
    res.json(await getFrequency(req.user));
  });
}

module.exports={registerRoutes,repFilter,entityFilter,managerCanSeeRep,auditWrite};
