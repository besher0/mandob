'use strict';
const {prisma,HttpError,companyId,asDate,requireString} = require('./auth');
const {workingDaysWithin,remainingDays} = require('./domain');

function canReviewLeave(manager,rep) {
  if (!manager || !rep || rep.role !== 'REP' || rep.companyId !== manager.companyId) return false;
  if(manager.role==='COMPANY_ADMIN')return true;
  return manager.role==='TEAM_MANAGER' && Boolean(manager.teamId) && rep.teamId===manager.teamId;
}
function activeOverlap(repId,fromDate,toDate,excludeId){
  return {repId,status:{in:['PENDING','APPROVED']},fromDate:{lte:toDate},toDate:{gte:fromDate},
    ...(excludeId?{id:{not:excludeId}}:{})};
}
function checkRange(fromDate,toDate){
  if(toDate<fromDate)throw new HttpError(400,'تاريخ انتهاء الإجازة قبل بدايتها');
  if((toDate-fromDate)/86400000>365)throw new HttpError(400,'الإجازة تتجاوز سنة كاملة');
}
function handleConcurrency(err){
  if(err.code==='P2034')throw new HttpError(409,'حصل تعارض أثناء معالجة الإجازة، أعد المحاولة');
  throw err;
}
async function submitLeave(user,payload){
  if(user.role!=='REP')throw new HttpError(403,'خاص بالمندوبين');
  const c=companyId(user);
  const type=requireString(payload?.type,'type',60);
  const fromDate=asDate(payload?.fromDate),toDate=asDate(payload?.toDate);
  checkRange(fromDate,toDate);
  const reason=payload?.reason;
  if(reason!==undefined && reason!==null && (typeof reason!=='string'||reason.length>1000))
    throw new HttpError(400,'السبب طويل جداً');
  try{
    return await prisma.$transaction(async(tx)=>{
      const conflict=await tx.leaveRequest.findFirst({where:activeOverlap(user.id,fromDate,toDate),select:{id:true}});
      if(conflict)throw new HttpError(409,'يوجد طلب إجازة متداخل مع هذه الفترة');
      const settings=await tx.companySettings.findUnique({where:{companyId:c}});
      const workingDays=settings?.workingDays||[0,1,2,3,4,6];
      if(workingDaysWithin(payload.fromDate,payload.toDate,workingDays).size===0)
        throw new HttpError(400,'إجازة بدون أيام عمل');
      if(type==='سنوية'){
        const existing=await tx.leaveRequest.findMany({where:{repId:user.id,type:'سنوية',status:'APPROVED'}});
        const current=await tx.user.findUnique({where:{id:user.id},select:{annualLeaveBalance:true}});
        if(!remainingDays(existing,{fromDate,toDate},workingDays,current.annualLeaveBalance))
          throw new HttpError(409,'الرصيد السنوي غير كافٍ');
      }
      const leave=await tx.leaveRequest.create({data:{repId:user.id,companyId:c,type,fromDate,toDate,reason:reason||null}});
      await tx.auditLog.create({data:{companyId:c,actorId:user.id,action:'REQUEST',entity:'LEAVE',entityId:leave.id}});
      return leave;
    },{isolationLevel:'Serializable'});
  }catch(err){handleConcurrency(err);}
}
async function reviewLeave(user,id,status){
  if(!['TEAM_MANAGER','COMPANY_ADMIN'].includes(user.role))throw new HttpError(403,'ليس لديك صلاحية');
  if(!['APPROVED','REJECTED'].includes(status))throw new HttpError(400,'الحالة غير صحيحة');
  try{
    return await prisma.$transaction(async(tx)=>{
      const leave=await tx.leaveRequest.findFirst({where:{id,companyId:companyId(user)},include:{rep:true}});
      if(!leave||!canReviewLeave(user,leave.rep))throw new HttpError(404,'الطلب غير موجود');
      if(leave.status!=='PENDING')throw new HttpError(409,'تمت مراجعة الطلب سابقاً');
      if(status==='APPROVED' && leave.type==='سنوية'){
        const settings=await tx.companySettings.findUnique({where:{companyId:user.companyId}});
        const workingDays=settings?.workingDays||[0,1,2,3,4,6];
        const approved=await tx.leaveRequest.findMany({where:{repId:leave.repId,type:'سنوية',status:'APPROVED'}});
        if(!remainingDays(approved,leave,workingDays,leave.rep.annualLeaveBalance))
          throw new HttpError(409,'الرصيد السنوي غير كافٍ لاعتماد الإجازة');
      }
      const result=await tx.leaveRequest.updateMany({where:{id,status:'PENDING',companyId:user.companyId},
        data:{status,reviewedById:user.id,reviewedAt:new Date()}});
      if(result.count!==1)throw new HttpError(409,'تمت مراجعة الطلب سابقاً');
      await tx.auditLog.create({data:{companyId:user.companyId,actorId:user.id,action:'REVIEW',entity:'LEAVE',entityId:id}});
      return {id,status};
    },{isolationLevel:'Serializable'});
  }catch(err){handleConcurrency(err);}
}
module.exports={canReviewLeave,submitLeave,reviewLeave};
