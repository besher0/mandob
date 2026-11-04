'use strict';
const {HttpError,safeInt}=require('./auth');
const {doctorTargetWhere}=require('./doctor-access');

const DEFAULT_START=new Date('2000-01-01T00:00:00.000Z');
const DEFAULT_END=new Date('2100-01-01T00:00:00.000Z');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cycleBounds(settings){
  const start=settings?.cycleStart||DEFAULT_START;
  const end=settings?.cycleEnd||DEFAULT_END;
  if(end<start)throw new HttpError(400,'تاريخ الدورة غير صحيح');
  return {start,end};
}
function validateGoalInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new HttpError(400,'بيانات الهدف غير صحيحة');
  const permitted=new Set(['scope','ownerId','doctorId','target']);
  if(Object.keys(input).some(k=>!permitted.has(k)))
    throw new HttpError(400,'حقل غير مسموح في بيانات الهدف');
  if(input.scope!=='TEAM'&&input.scope!=='REP')
    throw new HttpError(400,'نوع الهدف لازم يكون TEAM أو REP');
  if(typeof input.ownerId!=='string'||!UUID.test(input.ownerId)||
    typeof input.doctorId!=='string'||!UUID.test(input.doctorId))
    throw new HttpError(400,'معرّف الطبيب أو صاحب الهدف غير صالح');
  return {
    scope:input.scope,ownerId:input.ownerId,doctorId:input.doctorId,
    target:input.target===null?null:safeInt(input.target,'عدد الزيارات',1,3650)
  };
}
async function storeDoctorGoal(tx,companyId,raw){
  const input=validateGoalInput(raw);
  const settings=await tx.companySettings.findUnique({where:{companyId}});
  const {start,end}=cycleBounds(settings);
  const doctor=await tx.doctor.findFirst({
    where:{id:input.doctorId,companyId},
    select:{id:true,active:true}
  });
  if(!doctor)throw new HttpError(404,'الطبيب غير تابع للشركة');
  if(input.scope==='TEAM'){
    const team=await tx.team.findFirst({
      where:{id:input.ownerId,companyId},select:{id:true}
    });
    if(!team)throw new HttpError(404,'الفريق غير تابع للشركة');
  }else{
    const rep=await tx.user.findFirst({
      where:{id:input.ownerId,companyId,role:'REP'},
      include:{repSpecialties:true,team:{include:{specialties:true}}}
    });
    if(!rep)throw new HttpError(404,'المندوب غير تابع للشركة');
    if(input.target!==null){
      const where=doctorTargetWhere(rep,companyId);
      if(!where||!(await tx.doctor.findFirst({
        where:{id:input.doctorId,...where},select:{id:true}
      })))throw new HttpError(400,'الطبيب غير مسموح للمندوب حالياً؛ عدّل مناطقه أو اختصاصاته أولاً');
    }
  }
  if(input.target!==null&&!doctor.active)
    throw new HttpError(400,'لا يمكن تحديد هدف جديد لطبيب مؤرشف');

  const key={companyId,scope:input.scope,ownerId:input.ownerId,
    doctorId:input.doctorId,cycleStart:start,cycleEnd:end};
  const unique={companyId_scope_ownerId_doctorId_cycleStart_cycleEnd:key};
  if(input.target===null){
    const old=await tx.doctorVisitGoal.findUnique({where:unique});
    if(!old)throw new HttpError(404,'الهدف غير موجود في الدورة الحالية');
    await tx.doctorVisitGoal.delete({where:{id:old.id}});
    return {...old,deleted:true};
  }
  const result=await tx.doctorVisitGoal.upsert({
    where:unique,
    update:{target:input.target},
    create:{...key,target:input.target}
  });
  return {...result,deleted:false};
}
module.exports={cycleBounds,validateGoalInput,storeDoctorGoal};
