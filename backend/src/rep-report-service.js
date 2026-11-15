'use strict';
const {prisma,HttpError,companyId,asDate}=require('./auth');

function reportWindow(query){
  const from=asDate(query?.from),to=asDate(query?.to);
  if(to<from)throw new HttpError(400,'تاريخ نهاية التقرير قبل تاريخ البداية');
  const days=Math.round((to.getTime()-from.getTime())/86400000)+1;
  if(days>366)throw new HttpError(400,'الفترة المحددة للتقرير أطول من سنة');
  return {from,to,days};
}
const formatDate=date=>date.toISOString().slice(0,10);

// Only the authenticated REP is allowed here. Do not accept a repId from
// callers: a report must never contain another person's medical visit history.
async function detailedRepReport(user,query){
  if(user.role!=='REP')throw new HttpError(403,'تقرير المندوب لصاحب الحساب فقط');
  const c=companyId(user),{from,to,days}=reportWindow(query);
  const where={companyId:c,repId:user.id,visitDate:{gte:from,lte:to}};
  const visits=await prisma.visit.findMany({where,
    orderBy:[{visitDate:'asc'},{createdAt:'asc'},{id:'asc'}],
    take:1001,
    select:{id:true,type:true,visitDate:true,
      targets:{select:{
        doctor:{select:{name:true}},pharmacy:{select:{name:true}},
        hospital:{select:{name:true}},
        areaAtVisit:{select:{name:true}}
      }}
    }
  });
  if(visits.length>1000)throw new HttpError(413,'التقرير كبير جداً؛ اختر فترة أقصر');
  const byType={DOCTOR:0,PHARMACY:0,HOSPITAL:0};
  const rows=visits.map(visit=>{
    const targets=visit.targets.map(t=>({
      name:t.doctor?.name||t.pharmacy?.name||t.hospital?.name||'جهة طبية',
      area:t.areaAtVisit?.name||'منطقة غير مسجلة'
    }));
    byType[visit.type]+=targets.length;
    return {id:visit.id,type:visit.type,
      date:visit.visitDate.toISOString().slice(0,10),targets};
  });
  const settings=await prisma.companySettings.findUnique({where:{companyId:c},
    select:{workingDays:true}});
  const active=new Set(Array.isArray(settings?.workingDays)?
    settings.workingDays:[0,1,2,3,4,6]);
  let workingDays=0;
  for(let day=new Date(from);day<=to;day.setUTCDate(day.getUTCDate()+1))
    if(active.has(day.getUTCDay()))workingDays++;
  const totalTargets=Object.values(byType).reduce((sum,n)=>sum+n,0);
  return {from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10),
    tours:rows.length,totalTargets,byType,workingDays,
    averagePerWorkingDay:workingDays?Math.round(totalTargets/workingDays*10)/10:null,
    rows};
}

function reportScope(user){
  const c=companyId(user);
  if(user.role==='REP')return {companyId:c,repId:user.id};
  if(user.role==='TEAM_MANAGER')return {companyId:c,teamIdAtSubmission:user.teamId||'__NO_TEAM__'};
  if(user.role==='COMPANY_ADMIN')return {companyId:c};
  throw new HttpError(403,'غير مسموح بعرض التقارير');
}
async function listSubmittedReports(user,limit=30){
  const reports=await prisma.submittedReport.findMany({
    where:reportScope(user),orderBy:[{createdAt:'desc'},{id:'desc'}],
    take:limit,select:{id:true,fromDate:true,toDate:true,period:true,
      createdAt:true,teamIdAtSubmission:true,
      rep:{select:{id:true,name:true}},
      // The summary is stored server-side in the immutable report snapshot.
      snapshot:true}
  });
  return reports.map(row=>({
    id:row.id,from:row.fromDate.toISOString().slice(0,10),
    to:row.toDate.toISOString().slice(0,10),period:row.period,
    submittedAt:row.createdAt.toISOString(),repName:row.rep.name,
    repId:row.rep.id,
    teamIdAtSubmission:row.teamIdAtSubmission,
    totalTargets:row.snapshot.totalTargets,byType:row.snapshot.byType,
    tours:row.snapshot.tours
  }));
}
async function getSubmittedReport(user,id){
  return prisma.submittedReport.findFirst({
    where:{...reportScope(user),id},include:{rep:{select:{name:true}}}
  });
}
async function submitReport(user,input){
  if(user.role!=='REP')throw new HttpError(403,'إرسال التقارير للمندوب فقط');
  const c=companyId(user);
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>!['clientReportId','from','to','period'].includes(k)))
    throw new HttpError(400,'بيانات التقرير غير صحيحة');
  const id=input.clientReportId;
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new HttpError(400,'رقم التقرير غير صحيح');
  if(!['weekly','daily','custom'].includes(input.period))
    throw new HttpError(400,'نوع التقرير غير صالح');
  const {from,to}=reportWindow(input);
  const same=row=>row&&row.companyId===c&&row.repId===user.id&&
    row.period===input.period&&row.fromDate.getTime()===from.getTime()&&
    row.toDate.getTime()===to.getTime();
  const old=await prisma.submittedReport.findUnique({where:{id}});
  if(old){
    if(!same(old))throw new HttpError(409,'رقم التقرير مستخدم لبيانات مختلفة');
    return {id:old.id,duplicate:true};
  }
  const snapshot=await detailedRepReport(user,input);
  try{
    const row=await prisma.$transaction(async tx=>{
      const saved=await tx.submittedReport.create({data:{
        id,companyId:c,repId:user.id,teamIdAtSubmission:user.teamId||null,
        fromDate:from,toDate:to,period:input.period,snapshot
      }});
      await tx.auditLog.create({data:{companyId:c,actorId:user.id,
        action:'SUBMIT',entity:'SUBMITTED_REPORT',entityId:saved.id}});
      return saved;
    },{maxWait:10000,timeout:20000,isolationLevel:'Serializable'});
    return {id:row.id,duplicate:false};
  }catch(err){
    if(err.code==='P2002'){
      const found=await prisma.submittedReport.findUnique({where:{id}});
      if(same(found))return {id:found.id,duplicate:true};
      if(found)throw new HttpError(409,'رقم التقرير مستخدم لبيانات مختلفة');
    }
    throw err;
  }
}
module.exports={detailedRepReport,listSubmittedReports,getSubmittedReport,submitReport,reportWindow};
