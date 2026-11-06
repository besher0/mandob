'use strict';
const {prisma,companyId,HttpError}=require('./auth');
const {getFrequency}=require('./analytics-service');

const groupKey=(item)=>item.teamId?'team:'+item.teamId:
  item.representatives?.[0]?.id?'rep:'+item.representatives[0].id:null;
const countKey=(group,doctor,area)=>group+':'+doctor+':'+area;

// Each recorded VisitTarget contributes to exactly one area, the visit-time
// area chosen by the representative. Missing historic attribution stays unknown.
function computeAreaCoverage(frequency,doctors,repAreas,records,areaNames){
  const groupAreaIds=new Map(),groups=new Map();
  for(const item of frequency.items||[]){
    const key=groupKey(item);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,{
      key,teamId:item.teamId||null,teamName:item.teamName,
      repIds:new Set(),items:[]
    });
    const group=groups.get(key);
    group.items.push(item);
    for(const rep of item.representatives||[])group.repIds.add(rep.id);
  }
  const repAreaMap=new Map();
  for(const row of repAreas){
    if(!repAreaMap.has(row.repId))repAreaMap.set(row.repId,new Set());
    repAreaMap.get(row.repId).add(row.areaId);
  }
  for(const group of groups.values()){
    const ids=new Set();
    for(const repId of group.repIds)
      for(const areaId of repAreaMap.get(repId)||[])ids.add(areaId);
    groupAreaIds.set(group.key,ids);
  }

  const counts=new Map(),historicalAreas=new Map(),unattributed=new Map();
  for(const row of records){
    if(!row.doctorId)continue;
    const key=row.visit.teamIdAtVisit?'team:'+row.visit.teamIdAtVisit:
      'rep:'+row.visit.repId;
    if(!groups.has(key))continue;
    if(!row.areaIdAtVisit){
      unattributed.set(key,(unattributed.get(key)||0)+1);
      continue;
    }
    const pair=key+':'+row.doctorId;
    if(!historicalAreas.has(pair))historicalAreas.set(pair,new Set());
    historicalAreas.get(pair).add(row.areaIdAtVisit);
    const count=countKey(key,row.doctorId,row.areaIdAtVisit);
    counts.set(count,(counts.get(count)||0)+1);
  }

  const areaRows=new Map(),teamTotals=[];
  for(const group of groups.values()){
    const uniqueIds=new Set(),total={target:0,done:0};
    for(const item of group.items){
      if(uniqueIds.has(item.id))continue;
      uniqueIds.add(item.id);
      total.target+=item.target;
      total.done+=Math.min(item.done,item.target);
      const doctor=doctors.get(item.id);
      if(!doctor)continue;
      const linked=new Set([doctor.areaId,...doctor.doctorAreas.map(x=>x.areaId)]);
      const relevant=new Set([...linked].filter(id=>groupAreaIds.get(group.key)?.has(id)));
      for(const id of historicalAreas.get(group.key+':'+item.id)||[])relevant.add(id);
      for(const areaId of relevant){
        if(!areaNames.has(areaId))continue;
        const rowKey=group.key+':'+areaId;
        if(!areaRows.has(rowKey))areaRows.set(rowKey,{
          groupKey:group.key,teamId:group.teamId,teamName:group.teamName,
          areaId,areaName:areaNames.get(areaId),target:0,done:0,
          doctors:0,unvisited:0,gradeA:0
        });
        const row=areaRows.get(rowKey);
        const done=Math.min(counts.get(countKey(group.key,item.id,areaId))||0,item.target);
        row.target+=item.target;
        row.done+=done;
        row.doctors++;
        if(done===0)row.unvisited++;
        if(item.grade==='A')row.gradeA++;
      }
    }
    teamTotals.push({
      groupKey:group.key,teamId:group.teamId,teamName:group.teamName,
      doctors:uniqueIds.size,target:total.target,done:total.done,
      coverage:total.target?Math.round(total.done/total.target*100):0,
      unattributedHistoricalVisits:unattributed.get(group.key)||0
    });
  }
  const areas=[...areaRows.values()].map(x=>({
    ...x,coverage:x.target?Math.round(x.done/x.target*100):0,
    // Area row totals intentionally overlap for linked doctors. Never add them
    // together to get a team total; teamTotals de-duplicates doctor IDs.
  })).sort((a,b)=>a.teamName.localeCompare(b.teamName)||
    a.areaName.localeCompare(b.areaName));
  return {areas,teamTotals,
    unattributedHistoricalVisits:[...unattributed.values()].reduce((n,c)=>n+c,0)};
}

async function getAreaCoverage(user){
  const c=companyId(user);
  const frequency=await getFrequency(user);
  if(!frequency.items?.length)return {
    cycleStart:frequency.cycleStart||null,cycleEnd:frequency.cycleEnd||null,
    areas:[],teamTotals:[],unattributedHistoricalVisits:0
  };
  const ids=[...new Set(frequency.items.map(x=>x.id))];
  const doctors=new Map((await prisma.doctor.findMany({
    where:{companyId:c,id:{in:ids}},
    select:{id:true,areaId:true,doctorAreas:{select:{areaId:true}}}
  })).map(x=>[x.id,x]));
  const repIds=[...new Set(frequency.items.flatMap(x=>
    (x.representatives||[]).map(rep=>rep.id)))];
  const repAreas=repIds.length?await prisma.repArea.findMany({
    where:{repId:{in:repIds},rep:{companyId:c,role:'REP'}},
    select:{repId:true,areaId:true}
  }):[];

  const keys=[...new Set(frequency.items.map(groupKey).filter(Boolean))];
  const teamIds=keys.filter(k=>k.startsWith('team:')).map(k=>k.slice(5));
  const soloIds=keys.filter(k=>k.startsWith('rep:')).map(k=>k.slice(4));
  const visibility=[];
  if(teamIds.length)visibility.push({teamIdAtVisit:{in:teamIds}});
  if(soloIds.length)visibility.push({teamIdAtVisit:null,repId:{in:soloIds}});
  const records=[];
  let cursor;
  if(visibility.length){
    for(;;){
      const page=await prisma.visitTarget.findMany({
        where:{doctorId:{in:ids},visit:{companyId:c,type:'DOCTOR',
          visitDate:{gte:new Date(frequency.cycleStart),lte:new Date(frequency.cycleEnd)},
          OR:visibility}},
        select:{id:true,doctorId:true,areaIdAtVisit:true,
          visit:{select:{repId:true,teamIdAtVisit:true}}},
        orderBy:{id:'asc'},take:500,
        ...(cursor?{cursor:{id:cursor},skip:1}:{})
      });
      records.push(...page);
      if(records.length>100000)
        throw new HttpError(413,'تقرير تغطية المناطق كبير؛ يلزم فلترة إضافية');
      if(page.length<500)break;
      cursor=page[page.length-1].id;
    }
  }
  const idsForAreas=new Set(repAreas.map(x=>x.areaId));
  for(const doctor of doctors.values()){
    idsForAreas.add(doctor.areaId);
    for(const link of doctor.doctorAreas)idsForAreas.add(link.areaId);
  }
  for(const record of records)if(record.areaIdAtVisit)idsForAreas.add(record.areaIdAtVisit);
  const areas=await prisma.area.findMany({where:{companyId:c,id:{in:[...idsForAreas]}},
    select:{id:true,name:true}});
  return {
    cycleStart:frequency.cycleStart,cycleEnd:frequency.cycleEnd,
    ...computeAreaCoverage(frequency,doctors,repAreas,records,
      new Map(areas.map(area=>[area.id,area.name])))
  };
}

module.exports={getAreaCoverage,computeAreaCoverage};
