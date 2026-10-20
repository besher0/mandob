'use strict';
const {prisma,HttpError,companyId,asDate,validateLocation}=require('./auth');
const {sameVisit}=require('./domain');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES={DOCTOR:{model:'doctor',field:'doctorId'},PHARMACY:{model:'pharmacy',field:'pharmacyId'},
  HOSPITAL:{model:'hospital',field:'hospitalId'}};
const include={rep:{select:{id:true,name:true,teamId:true}},targets:{include:{
  doctor:{select:{id:true,name:true}},pharmacy:{select:{id:true,name:true}},hospital:{select:{id:true,name:true}}}}};
function dateString(date){return date.toISOString().slice(0,10);}
function listVisit(v){return {id:v.id,repId:v.repId,repName:v.rep?.name,teamIdAtVisit:v.teamIdAtVisit,
    type:v.type,visitDate:dateString(v.visitDate),
  createdAt:v.createdAt,location:{latitude:v.latitude,longitude:v.longitude,accuracy:v.locationAccuracy,
    capturedAt:v.locationCapturedAt},targets:v.targets.map(t=>({
      id:t.doctorId||t.pharmacyId||t.hospitalId,name:t.doctor?.name||t.pharmacy?.name||t.hospital?.name}))};}
async function submitVisit(user,input){
  if(user.role!=='REP')throw new HttpError(403,'لا يمكن تسجيل الجولة إلا من حساب مندوب');
  const company=companyId(user);
  const type=input?.type;
  if(!Object.hasOwn(TYPES,type))throw new HttpError(400,'نوع الجولة غير صحيح');
  const raw=input?.targetIds;
  if(!Array.isArray(raw)||raw.length===0||raw.length>100||raw.some(id=>typeof id!=='string'||!UUID.test(id)) ||
    new Set(raw).size!==raw.length)throw new HttpError(400,'قائمة الجهات تحتوي عناصر غير صحيحة أو مكررة');
  const visitDate=asDate(input?.visitDate);
  if(visitDate.getTime()>Date.now())throw new HttpError(400,'لا يمكن تسجيل جولة بتاريخ مستقبلي');
  if(typeof input?.clientVisitId!=='string'||!UUID.test(input.clientVisitId))
    throw new HttpError(400,'معرّف الجولة غير صحيح');
  const owner={companyId:company,repId:user.id};
  async function previous(){
    const old=await prisma.visit.findUnique({where:{clientVisitId:input.clientVisitId},include});
    if(!old)return null;
    if(old.companyId!==owner.companyId||old.repId!==owner.repId || !sameVisit(old,input))
      throw new HttpError(409,'رقم الجولة مستخدم لبيانات مختلفة');
    return {id:old.id,duplicate:true};
  }
  const existing=await previous();
  if(existing)return existing;
  const loc=validateLocation(input?.location);
  const {model,field}=TYPES[type];
  try {
    const result=await prisma.$transaction(async(tx)=>{
      // Read the team inside the same SERIALIZABLE transaction as visit creation.
      // A concurrent reassignment cannot silently attribute a tour to the new team.
      const rep=await tx.user.findFirst({where:{id:user.id,companyId:company,role:'REP',active:true},
        select:{id:true,teamId:true}});
      if(!rep)throw new HttpError(403,'حساب المندوب غير نشط أو لم يعد تابعاً للشركة');
      if(rep.teamId){
        const team=await tx.team.findFirst({where:{id:rep.teamId,companyId:company},select:{id:true}});
        if(!team)throw new HttpError(403,'فريق المندوب لا يتبع شركته');
      }
      const repAreaAccess={companyId:company,
        repAreas:{some:{repId:user.id,rep:{companyId:company,role:'REP',active:true}}}};
      const locationAccess=type==='DOCTOR'?
        {OR:[{area:repAreaAccess},{doctorAreas:{some:{area:repAreaAccess}}}]}:
        {area:repAreaAccess};
      const candidates=await tx[model].findMany({where:{
        companyId:company,id:{in:raw},active:true,...locationAccess
      },select:{id:true}});
      if(candidates.length!==raw.length)throw new HttpError(403,'جهة ليست ضمن مناطق المندوب أو الشركة');
      const created=await tx.visit.create({data:{...owner,
        teamIdAtVisit:rep.teamId,clientVisitId:input.clientVisitId,type,visitDate,
        latitude:loc.latitude,longitude:loc.longitude,locationAccuracy:loc.accuracy,
        locationCapturedAt:loc.capturedAt,targets:{create:raw.map(id=>({[field]:id}))}},include});
      await tx.auditLog.create({data:{companyId:company,actorId:user.id,action:'CREATE',
        entity:'VISIT',entityId:created.id}});
      return created;
    },{isolationLevel:'Serializable'});
    return listVisit(result);
  }catch(err){
    if(err.code==='P2002'){
      const found=await previous();
      if(found)return found;
    }
    if(err.code==='P2034')throw new HttpError(409,'تغيرت بيانات الفريق أثناء حفظ الجولة، أعد المحاولة');
    throw err;
  }
}
module.exports={submitVisit,listVisit,include};
