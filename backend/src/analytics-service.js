'use strict';
const {prisma,HttpError,companyId}=require('./auth');
const {cycleBounds}=require('./doctor-goal-service');

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
  const {start,end}=cycleBounds(settings);

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
  const goals=await prisma.doctorVisitGoal.findMany({
    where:{companyId:c,cycleStart:start,cycleEnd:end,
      OR:[{scope:'TEAM',ownerId:{in:teamIds}},
          {scope:'REP',ownerId:{in:ids}}]},
    take:5001
  });
  if(goals.length>5000)throw new HttpError(413,'عدد الأهداف كبير جداً');
  const teamGoals=new Map(goals.filter(g=>g.scope==='TEAM')
    .map(g=>[g.ownerId+':'+g.doctorId,g]));
  const individualGoals=goals.filter(g=>g.scope==='REP');
  const individualRepIds=[...new Set(individualGoals.map(g=>g.ownerId))];
  // Solo tours have NULL teamIdAtVisit; expose only the owner's solo history.
  const soloIds=user.role==='COMPANY_ADMIN'?ids:
    user.role==='REP'&&!user.teamId?[user.id]:[];
  const filters=[];
  if(teamIds.length)filters.push({teamIdAtVisit:{in:teamIds}});
  if(soloIds.length)filters.push({teamIdAtVisit:null,repId:{in:soloIds}});
  // An individual's own visits count towards their personal quota even when
  // they have transferred teams. Team quotas still use teamIdAtVisit only.
  if(individualRepIds.length)filters.push({repId:{in:individualRepIds}});
  if(!filters.length)return {
    items:[],completed:0,total:0,personalItems:[],personalCompleted:0,personalTotal:0
  };

  // Load doctors by company, then use current assignments OR historical visits
  // to keep an old team's frequency after its representative transfers away.
  const doctors=await prisma.doctor.findMany({where:{companyId:c},
    include:{area:{select:{name:true}},doctorAreas:{select:{areaId:true,area:{select:{name:true}}}}},take:5001});
  if(doctors.length>5000)throw new HttpError(413,'عدد الأطباء كبير جداً؛ أضف فلترة');
  if(!doctors.length)return {
    items:[],completed:0,total:0,personalItems:[],personalCompleted:0,personalTotal:0
  };
  const doctorIds=doctors.map(d=>d.id),counts=new Map(),personalCounts=new Map();
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
    for(const vt of page){
      const key=vt.visit.repId+':'+vt.doctorId;
      personalCounts.set(key,(personalCounts.get(key)||0)+1);
    }
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
      const assigned=group.teamId?teamGoals.get(group.teamId+':'+d.id):null;
      if(!d.active && !seen)continue; // archived doctor with no visits in this cycle is not a new target
      if(!seen && !assigned && !group.areaIds.has(d.areaId) &&
         !d.doctorAreas.some(link=>group.areaIds.has(link.areaId)))continue;
      if(!seen && !assigned && allowed?.size && !allowed.has(d.specialty.trim()))continue;
      const target=assigned?.target??(d.grade==='A'?(settings?.frequencyA??4):
        d.grade==='B'?(settings?.frequencyB??2):(settings?.frequencyC??1));
      const done=counts.get(group.key+':'+d.id)||0;
      items.push({id:d.id,teamId:group.teamId,teamName:group.teamName,
        representatives:group.representatives,name:d.name,
        area:[...new Set([d.area.name,...d.doctorAreas.map(link=>link.area.name)])].join('، '),
        grade:d.grade,done,target,goalSource:assigned?'EXPLICIT':'GRADE',
        coverage:Math.min(100,Math.round(done/target*100))});
      if(items.length>25000)throw new HttpError(413,'عدد عناصر التقرير كبير جداً');
    }
  }
  const doctorById=new Map(doctors.map(d=>[d.id,d]));
  const repById=new Map(reps.map(r=>[r.id,r]));
  const personalItems=[];
  for(const goal of individualGoals){
    const doctor=doctorById.get(goal.doctorId),rep=repById.get(goal.ownerId);
    if(!doctor||!rep)continue;
    const done=personalCounts.get(rep.id+':'+doctor.id)||0;
    personalItems.push({
      id:doctor.id,repId:rep.id,repName:rep.name,teamId:rep.teamId,
      name:doctor.name,area:[...new Set([doctor.area.name,
        ...doctor.doctorAreas.map(link=>link.area.name)])].join('، '),
      grade:doctor.grade,done,target:goal.target,
      coverage:Math.min(100,Math.round(done/goal.target*100)),
      goalSource:'EXPLICIT'
    });
  }
  personalItems.sort((a,b)=>a.repName.localeCompare(b.repName)||a.name.localeCompare(b.name));
  return {items,completed:items.filter(r=>r.done>=r.target).length,total:items.length,
    personalItems,personalCompleted:personalItems.filter(r=>r.done>=r.target).length,
    personalTotal:personalItems.length,
    cycleStart:start.toISOString().slice(0,10),cycleEnd:end.toISOString().slice(0,10)};
}
module.exports={getFrequency,frequencyGroups,aggregateVisitsByTeam,visitGroupKey};
