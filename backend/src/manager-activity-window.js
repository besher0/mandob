'use strict';
/**
 * "week": the legacy Saturday-Friday working week;
 * "last7": the exact rolling seven calendar days in mandob-v2 dashboard.
 * Date is UTC midnight, as produced by asDate() in the API.
 */
function managerActivityWindow(onDate,mode='week'){
  if(!(onDate instanceof Date)||Number.isNaN(onDate.valueOf()))
    throw new TypeError('Invalid activity date');
  if(!['week','last7'].includes(mode))throw new RangeError('Invalid window mode');
  const start=new Date(onDate);
  start.setUTCDate(start.getUTCDate()-(mode==='last7'?6:(start.getUTCDay()+1)%7));
  const end=new Date(start);
  end.setUTCDate(start.getUTCDate()+6);
  return {start,end};
}
module.exports={managerActivityWindow};
