// Company-admin-only area breakdown. The analytics API returns one row per
// (team/solo-representative, area), so counts here are assignments, not
// company-wide distinct doctors. Keep the de-duplicated company total from
// teamTotals separate from this per-area breakdown.
const count=value=>{
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:0;
};
const cityName=area=>String(area?.city||'غير محددة').trim()||'غير محددة';

export function buildCompanyAreaStats(areas=[],coverageRows=[],reps=[]){
  const byId=new Map();
  for(const area of areas){
    if(!area?.id)continue;
    byId.set(area.id,{
      areaId:area.id,areaName:String(area.name||'منطقة بلا اسم'),
      city:cityName(area),target:0,done:0,doctors:0,
      unvisited:0,gradeA:0,reps:0,groups:[]
    });
  }
  for(const row of coverageRows){
    if(!row?.areaId)continue;
    if(!byId.has(row.areaId))byId.set(row.areaId,{
      areaId:row.areaId,areaName:String(row.areaName||'منطقة تاريخية'),
      city:'غير محددة',target:0,done:0,doctors:0,
      unvisited:0,gradeA:0,reps:0,groups:[]
    });
    const area=byId.get(row.areaId);
    const target=count(row.target),done=Math.min(count(row.done),target);
    area.target+=target;
    area.done+=done;
    area.doctors+=count(row.doctors);
    area.unvisited+=count(row.unvisited);
    area.gradeA+=count(row.gradeA);
    area.groups.push({
      key:row.groupKey||'group:'+area.groups.length,
      name:row.teamName||'مندوب مستقل',
      target,done,remaining:Math.max(0,target-done),
      coverage:target?Math.min(100,Math.round(done/target*100)):null,
      doctors:count(row.doctors),unvisited:count(row.unvisited),
      gradeA:count(row.gradeA)
    });
  }
  for(const rep of reps){
    const uniqueAreas=new Set((rep.repAreas||[])
      .map(link=>link.areaId||link.area?.id).filter(Boolean));
    for(const areaId of uniqueAreas){
      const area=byId.get(areaId);
      if(area)area.reps++;
    }
  }
  return [...byId.values()].map(area=>({
    ...area,remaining:Math.max(0,area.target-area.done),
    coverage:area.target?Math.min(100,Math.round(area.done/area.target*100)):null,
    groupCount:area.groups.length
  })).sort((a,b)=>a.city.localeCompare(b.city,'ar')||
    a.areaName.localeCompare(b.areaName,'ar'));
}
