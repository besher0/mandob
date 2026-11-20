// Pure legacy round-area selection rules, shared by the React tour wizard and tests.
// A multi-area doctor is one target ID even when assigned to two selected areas.
export function inArea(target,areaId){
  if(!target||!areaId)return false;
  return target.areaId===areaId||target.area?.id===areaId||
    (Array.isArray(target.doctorAreas)&&target.doctorAreas.some(link=>
      link.areaId===areaId||link.area?.id===areaId));
}
export function targetsForAreas(targets,selectedAreaIds){
  if(!Array.isArray(targets)||!Array.isArray(selectedAreaIds))return [];
  const areas=new Set(selectedAreaIds);
  if(!areas.size)return [];
  return targets.filter(target=>[...areas].some(areaId=>inArea(target,areaId)));
}
export function retainSelectedTargets(selectedIds,allowedTargets){
  const permitted=new Set(allowedTargets.map(item=>item.id));
  return selectedIds.filter(id=>permitted.has(id));
}


// All target lists must remain restricted to the areas selected in the
// preceding tour step. A doctor linked to more than one selected area is
// attributed explicitly, rather than guessed from a stale primary area.
export function matchingTourAreas(target,selectedAreaIds){
  if(!Array.isArray(selectedAreaIds))return [];
  return selectedAreaIds.filter(areaId=>inArea(target,areaId));
}
export function resolvedTourArea(target,selectedAreaIds,previousAreaId){
  const matching=matchingTourAreas(target,selectedAreaIds);
  if(previousAreaId&&matching.includes(previousAreaId))return previousAreaId;
  return matching.length===1?matching[0]:null;
}

// Mirror the old round filters without bypassing authorized area selection:
// OR within category/grade/specialties, AND across different filters.
// Unlike the legacy sample data, visitation status comes only from the
// authenticated representative's current-cycle API response.
export function filterTourTargets(targets,{
  type='DOCTOR',search='',grades=[],specialties=[],categories=[],
  unvisitedOnly=false,visitCounts=null,visitTargets=null
}={}){
  if(!Array.isArray(targets))return [];
  const term=String(search).trim().toLocaleLowerCase();
  const wantedGrades=new Set(grades);
  const wantedSpecialties=new Set(specialties);
  const wantedCategories=new Set(categories);
  return targets.filter(item=>{
    const fields=[item.name,item.specialty,item.grade,item.category,item.kind,
      item.area?.name,...(item.doctorAreas||[]).map(link=>link.area?.name)];
    if(term&&!fields.some(value=>String(value||'').toLocaleLowerCase().includes(term)))return false;
    if(type!=='HOSPITAL'&&wantedGrades.size&&!wantedGrades.has(item.grade))return false;
    if(type!=='PHARMACY'&&wantedSpecialties.size&&!wantedSpecialties.has(item.specialty))return false;
    if(type!=='DOCTOR'&&wantedCategories.size&&
      !wantedCategories.has(type==='PHARMACY'?item.kind:item.category))return false;
    if(unvisitedOnly){
      // Avoid presenting "not visited" for everything while the status API
      // is still loading or failed.
      if(!visitCounts||!visitTargets)return false;
      const completed=Number(visitCounts[item.id]||0);
      if(type==='HOSPITAL'){
        const target=Number(visitTargets[item.id]??item.target??1);
        if(completed>=target)return false;
      }else if(completed>0)return false;
    }
    return true;
  });
}


// Legacy filters survive navigating away and are independent per medical type.
// Defensive normalization also rejects stale/corrupt browser storage values.
export function normalizeTourFilters(raw,type='DOCTOR'){
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const strings=(items)=>Array.isArray(items)?[...new Set(items.filter(item=>
    typeof item==='string'&&item.trim().length&&item.length<=150).map(item=>item.trim()))]
    .slice(0,100):[];
  const grades=type==='HOSPITAL'?[]:strings(value.grades).filter(grade=>
    ['A','B','C'].includes(grade));
  const specialties=type==='PHARMACY'?[]:strings(value.specialties);
  const categories=type==='DOCTOR'?[]:strings(value.categories);
  return {grades,specialties,categories,unvisitedOnly:value.unvisitedOnly===true};
}
