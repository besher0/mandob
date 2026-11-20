'use strict';

// Official default medical-specialty catalog. Keep spelling exactly as
// approved; existing user-defined specialties are kept alongside these labels.
// Do not auto-assign specialties to teams, representatives, or doctors.
const DEFAULT_MEDICAL_SPECIALTIES=Object.freeze([
  'أطفال',
  'أمراض كلية',
  'جراحة أوعية',
  'داخلية',
  'عصبية',
  'غدد صم',
  'قلبية',
  'نسائية',
  'نفسية',
  'هضمية'
]);

function medicalSpecialtyOptions(existing=[]){
  return [...new Set([...DEFAULT_MEDICAL_SPECIALTIES,...existing.filter(item=>
    typeof item==='string'&&item.trim()).map(item=>item.trim())])]
    .sort((a,b)=>a.localeCompare(b,'ar'));
}

module.exports={DEFAULT_MEDICAL_SPECIALTIES,medicalSpecialtyOptions};
