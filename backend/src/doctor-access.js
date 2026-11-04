'use strict';

// Shared doctor eligibility for the targeted-doctor directory AND visit submission.
// No reliance on client-supplied doctor lists: the database always checks the current
// representative, their assigned areas and their current TEAM/CUSTOM specialties.
function allowedSpecialties(rep){
  const source=rep.specialtyMode==='CUSTOM'?
    (rep.repSpecialties||[]):
    (rep.team?.specialties||[]);
  return [...new Set(source.map(x=>typeof x==='string'?x.trim():
    typeof x?.specialty==='string'?x.specialty.trim():'').filter(Boolean))];
}
function doctorTargetWhere(rep,companyId){
  if(!rep||rep.role!=='REP'||rep.companyId!==companyId||!rep.active)return null;
  const specialties=allowedSpecialties(rep);
  if(!specialties.length)return null; // No team/custom specialty means no doctors.
  const scopedArea={companyId,repAreas:{some:{
    repId:rep.id,rep:{companyId,role:'REP',active:true}
  }}};
  return {
    companyId,active:true,specialty:{in:specialties},
    OR:[{area:scopedArea},{doctorAreas:{some:{area:scopedArea}}}]
  };
}
module.exports={allowedSpecialties,doctorTargetWhere};
