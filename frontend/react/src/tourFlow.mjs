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
