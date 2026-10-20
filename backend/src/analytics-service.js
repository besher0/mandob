'use strict';
const {prisma,HttpError,companyId}=require('./auth');

// Frequency is counted ONCE for each (team, doctor, cycle), not per representative.
// A visit by any rep belonging to the same team contributes to that team's count.
// Representatives without a team form their own isolated group.
function frequencyGroups(reps) {
  const groups=new Map();
  for(const rep of reps) {
    const key=rep.teamId ? 'team:'+rep.teamId : 'rep:'+rep.id;
    if(!groups.has(key))groups.set(key,{
      key,teamId:rep.teamId||null,teamName:rep.team?.name||'بدون فريق',repIds:[],
      areaIds:new Set(),representatives:[]
    });
    const group=groups.get(key);
    group.repIds.push(rep.id);
    group.representatives.push({id:rep.id,name:rep.name});
  }
  return groups;
}

function aggregateVisitsByTeam(visitTargets, repToGroup) {
  const counts=new Map();
  for(const t of visitTargets) {
    const groupKey=repToGroup.get(t.visit.repId);
    if(!groupKey || !t.doctorId)continue;
    const key=groupKey+':'+t.doctorId;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}

async function getFrequency(user) {
  const c=companyId(user);
  if(!['REP','TEAM_MANAGER','COMPANY_ADMIN'].includes(user.role))
    throw new HttpError(403,'ليس لديك صلاحية عرض التقرير');
  const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
  const start=settings?.cycleStart||new Date('2000-01-01T00:00:00Z');
  const end=settings?.cycleEnd||new Date('2100-01-01T00:00:00Z');
  if(end<start)throw new HttpError(400,'تاريخ الدورة غير صحيح');

  // The representative sees the shared frequency of their own team.
  // Team managers see their own team only; company administrators see all teams separately.
  const where={companyId:c,role:'REP'};
  if(user.role==='TEAM_MANAGER') {
    if(!user.teamId)return {items:[],completed:0,total:0};
    where.teamId=user.teamId;
  }
  if(user.role==='REP') {
    if(user.teamId)where.teamId=user.teamId;
    else where.id=user.id;
  }
  const reps=await prisma.user.findMany({where,select:{
    id:true,name:true,teamId:true,team:{select:{name:true}}
  },take:301});
  if(reps.length>300)throw new HttpError(413,'حدد مجموعة أصغر من المندوبين');
  if(!reps.length)return {items:[],completed:0,total:0};

  const groups=frequencyGroups(reps);
  const repToGroup=new Map();
  for(const group of groups.values())for(const id of group.repIds)repToGroup.set(id,group.key);

  const ids=reps.map(r=>r.id);
  const [areas,specialties]=await Promise.all([
    prisma.repArea.findMany({where:{repId:{in:ids}},select:{repId:true,areaId:true}}),
    prisma.teamSpecialty.findMany({where:{teamId:{in:reps.map(r=>r.teamId).filter(Boolean)}}})
  ]);
  for(const row of areas) {
    const group=groups.get(repToGroup.get(row.repId));
    if(group)group.areaIds.add(row.areaId);
  }
  const teamSpec=new Map();
  for(const row of specialties) {
    if(!teamSpec.has(row.teamId))teamSpec.set(row.teamId,new Set());
    teamSpec.get(row.teamId).add(row.specialty.trim());
  }

  const areaIds=[...new Set(areas.map(a=>a.areaId))];
  if(!areaIds.length)return {items:[],completed:0,total:0};
  const doctors=await prisma.doctor.findMany({
    where:{companyId:c,areaId:{in:areaIds}},
    include:{area:{select:{name:true}}},take:5001
  });
  if(doctors.length>5000)throw new HttpError(413,'عدد الأطباء كبير جداً؛ أضف فلترة');
  if(!doctors.length)return {items:[],completed:0,total:0};
  const counts=new Map();
  const doctorIds=doctors.map(d=>d.id);
  let cursor;
  for(;;) {
    const page=await prisma.visitTarget.findMany({
      where:{doctorId:{in:doctorIds},visit:{companyId:c,repId:{in:ids},
        type:'DOCTOR',visitDate:{gte:start,lte:end}}},
      select:{id:true,doctorId:true,visit:{select:{repId:true}}},
      orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})
    });
    const partial=aggregateVisitsByTeam(page,repToGroup);
    for(const [key,n] of partial)counts.set(key,(counts.get(key)||0)+n);
    if(page.length<500)break;
    cursor=page[page.length-1].id;
  }

  const items=[];
  for(const group of groups.values()) {
    const allowed=group.teamId?teamSpec.get(group.teamId):null;
    for(const d of doctors) {
      if(!group.areaIds.has(d.areaId))continue;
      if(allowed?.size && !allowed.has(d.specialty.trim()))continue;
      const target=d.grade==='A'?(settings?.frequencyA??4):
        d.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1);
      const done=counts.get(group.key+':'+d.id)||0;
      items.push({
        id:d.id,teamId:group.teamId,teamName:group.teamName,
        representatives:group.representatives,name:d.name,
        area:d.area.name,grade:d.grade,done,target,
        coverage:Math.min(100,Math.round(done/target*100))
      });
      if(items.length>25000)throw new HttpError(413,'عدد عناصر التقرير كبير جداً');
    }
  }
  return {items,completed:items.filter(r=>r.done>=r.target).length,total:items.length};
}

module.exports={getFrequency,frequencyGroups,aggregateVisitsByTeam};
