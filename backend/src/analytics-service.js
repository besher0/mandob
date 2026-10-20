'use strict';
const {prisma,HttpError,companyId}=require('./auth');

// The team-doctor frequency target belongs to the TEAM, not the representative.
// A tour retains the team of its creator at submission time (Visit.teamIdAtVisit).
function frequencyGroups(reps) {
  const groups=new Map();
  for(const rep of reps){
    const key=rep.teamId?'team:'+rep.teamId:'rep:'+rep.id;
    if(!groups.has(key))groups.set(key,{
      key,teamId:rep.teamId||null,teamName:rep.team?.name||'بدون فريق',
      repIds:[],areaIds:new Set(),representatives:[],historicalDoctorIds:new Set()
    });
    const group=groups.get(key);
    group.repIds.push(rep.id);
    group.representatives.push({id:rep.id,name:rep.name});
  }
  return groups;
}

function visitGroupKey(visit,legacyRepToGroup=new Map()){
  if(Object.prototype.hasOwnProperty.call(visit,'teamIdAtVisit')) {
    return visit.teamIdAtVisit?'team:'+visit.teamIdAtVisit:'rep:'+visit.repId;
  }
  // Used only for in-memory tests of objects without the new snapshot property.
  return legacyRepToGroup.get(visit.repId);
}
function aggregateVisitsByTeam(visitTargets,legacyRepToGroup=new Map()) {
  const counts=new Map();
  for(const t of visitTargets){
    const groupKey=visitGroupKey(t.visit,legacyRepToGroup);
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
  if(user.role==='TEAM_MANAGER'&&!user.teamId)return {items:[],completed:0,total:0};
  const settings=await prisma.companySettings.findUnique({where:{companyId:c}});
  const start=settings?.cycleStart||new Date('2000-01-01T00:00:00Z');
  const end=settings?.cycleEnd||new Date('2100-01-01T00:00:00Z');
  if(end<start)throw new HttpError(400,'تاريخ الدورة غير صحيح');

  const repWhere={companyId:c,role:'REP'};
  if(user.role==='REP'){
    if(user.teamId)repWhere.teamId=user.teamId;
    else repWhere.id=user.id;
  }
  if(user.role==='TEAM_MANAGER')repWhere.teamId=user.teamId;
  const reps=await prisma.user.findMany({where:repWhere,
    select:{id:true,name:true,teamId:true,team:{select:{name:true}}},take:301});
  if(reps.length>300)throw new HttpError(413,'عدد المندوبين كبير جداً؛ استخدم فلترة');

  const teamWhere={companyId:c};
  if(user.role==='TEAM_MANAGER')teamWhere.id=user.teamId;
  if(user.role==='REP')teamWhere.id=user.teamId||'__NO_TEAM__';
  const teams=await prisma.team.findMany({where:teamWhere,select:{id:true,name:true},take:301});
  if(teams.length>300)throw new HttpError(413,'عدد الفرق كبير جداً؛ استخدم فلترة');

  const groups=frequencyGroups(reps);
  for(const team of teams){
    const key='team:'+team.id;
    if(!groups.has(key))groups.set(key,{
      key,teamId:team.id,teamName:team.name,repIds:[],areaIds:new Set(),
      representatives:[],historicalDoctorIds:new Set()
    });
  }
  const repToCurrentGroup=new Map();
  for(const group of groups.values())for(const id of group.repIds)repToCurrentGroup.set(id,group.key);
  const ids=reps.map(r=>r.id);
  const areas=ids.length?await prisma.repArea.findMany({
    where:{repId:{in:ids}},select:{repId:true,areaId:true}}):[];
  for(const row of areas)groups.get(repToCurrentGroup.get(row.repId))?.areaIds.add(row.areaId);

  const teamIds=teams.map(t=>t.id);
  // Solo tours have NULL teamIdAtVisit; expose only the owner's solo history.
  const soloIds=user.role==='COMPANY_ADMIN'?ids:
    user.role==='REP'&&!user.teamId?[user.id]:[];
  const filters=[];
  if(teamIds.length)filters.push({teamIdAtVisit:{in:teamIds}});
  if(soloIds.length)filters.push({teamIdAtVisit:null,repId:{in:soloIds}});
  if(!filters.length)return {items:[],completed:0,total:0};

  // Load doctors by company, then use current assignments OR historical visits
  // to keep an old team's frequency after its representative transfers away.
  const doctors=await prisma.doctor.findMany({where:{companyId:c},
    include:{area:{select:{name:true}}},take:5001});
  if(doctors.length>5000)throw new HttpError(413,'عدد الأطباء كبير جداً؛ أضف فلترة');
  if(!doctors.length)return {items:[],completed:0,total:0};
  const doctorIds=doctors.map(d=>d.id),counts=new Map();
  let cursor;
  for(;;) {
    const page=await prisma.visitTarget.findMany({
      where:{doctorId:{in:doctorIds},visit:{companyId:c,type:'DOCTOR',
        visitDate:{gte:start,lte:end},OR:filters}},
      select:{id:true,doctorId:true,
        visit:{select:{repId:true,teamIdAtVisit:true}}},
      orderBy:{id:'asc'},take:500,...(cursor?{cursor:{id:cursor},skip:1}:{})
    });
    const partial=aggregateVisitsByTeam(page);
    for(const [key,count] of partial)counts.set(key,(counts.get(key)||0)+count);
    for(const visitTarget of page){
      const groupKey=visitGroupKey(visitTarget.visit);
      if(!groups.has(groupKey)&&user.role==='COMPANY_ADMIN'&&groupKey.startsWith('rep:')){
        const rep=reps.find(r=>'rep:'+r.id===groupKey);
        if(rep)groups.set(groupKey,{key:groupKey,teamId:null,teamName:'بدون فريق',
          repIds:[rep.id],areaIds:new Set(),representatives:[{id:rep.id,name:rep.name}],
          historicalDoctorIds:new Set()});
      }
      groups.get(groupKey)?.historicalDoctorIds.add(visitTarget.doctorId);
    }
    if(page.length<500)break;
    cursor=page[page.length-1].id;
  }
  const specialtyIds=teams.map(t=>t.id);
  const specialties=specialtyIds.length?await prisma.teamSpecialty.findMany({
    where:{teamId:{in:specialtyIds}}}):[];
  const specialtyMap=new Map();
  for(const row of specialties){
    if(!specialtyMap.has(row.teamId))specialtyMap.set(row.teamId,new Set());
    specialtyMap.get(row.teamId).add(row.specialty.trim());
  }

  const items=[];
  for(const group of groups.values()){
    const allowed=group.teamId?specialtyMap.get(group.teamId):null;
    for(const d of doctors){
      const seen=group.historicalDoctorIds.has(d.id);
      if(!d.active && !seen)continue; // archived doctor with no visits in this cycle is not a new target
      if(!seen && !group.areaIds.has(d.areaId))continue;
      if(!seen && allowed?.size && !allowed.has(d.specialty.trim()))continue;
      const target=d.grade==='A'?(settings?.frequencyA??4):
        d.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1);
      const done=counts.get(group.key+':'+d.id)||0;
      items.push({id:d.id,teamId:group.teamId,teamName:group.teamName,
        representatives:group.representatives,name:d.name,area:d.area.name,
        grade:d.grade,done,target,coverage:Math.min(100,Math.round(done/target*100))});
      if(items.length>25000)throw new HttpError(413,'عدد عناصر التقرير كبير جداً');
    }
  }
  return {items,completed:items.filter(r=>r.done>=r.target).length,total:items.length};
}
module.exports={getFrequency,frequencyGroups,aggregateVisitsByTeam,visitGroupKey};
