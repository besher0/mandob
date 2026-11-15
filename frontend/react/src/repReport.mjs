// Local calendar dates, independent of UTC offset and browser locale.
export function reportRange(today,mode){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today))throw Error('Invalid date');
  const date=new Date(today+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==today)throw Error('Invalid date');
  if(mode==='daily')return {from:today,to:today};
  if(mode==='weekly'){
    const offset=(date.getUTCDay()+1)%7; // Sat–Fri legacy weeks.
    date.setUTCDate(date.getUTCDate()-offset);
    const from=date.toISOString().slice(0,10);
    date.setUTCDate(date.getUTCDate()+6);
    return {from,to:date.toISOString().slice(0,10)};
  }
  if(mode==='monthly')return {from:today.slice(0,8)+'01',to:today};
  throw Error('Invalid report mode');
}
