'use strict';
const { HttpError, asDate } = require('./auth');

function sameVisit(existing, requested) {
  if (!existing || !requested || !Array.isArray(requested.targetIds)) return false;
  const loc = requested.location || {};
  const expected = existing.targets.map(t => t.doctorId || t.pharmacyId || t.hospitalId).sort();
  const incoming = [...new Set(requested.targetIds)].sort();
  const captured = new Date(loc.capturedAt);
  const persisted = new Date(existing.locationCapturedAt);
  return existing.type === requested.type &&
    existing.visitDate.toISOString().slice(0,10) === requested.visitDate &&
    expected.length === incoming.length && expected.every((id,i) => id === incoming[i]) &&
    Number(loc.latitude) === existing.latitude &&
    Number(loc.longitude) === existing.longitude &&
    Number(loc.accuracy) === existing.locationAccuracy &&
    Number.isFinite(captured.getTime()) && captured.getTime() === persisted.getTime();
}

function workingDaysWithin(fromDate, toDate, workingDays) {
  const start = asDate(fromDate), end = asDate(toDate);
  if(end < start) throw new HttpError(400,'تاريخ انتهاء الإجازة قبل بدايتها');
  const duration = Math.round((end.getTime()-start.getTime())/86400000)+1;
  if(duration > 366) throw new HttpError(400,'الإجازة تتجاوز الحد المسموح (366 يوم)');
  if(!Array.isArray(workingDays) || !workingDays.length ||
     workingDays.some(d => !Number.isInteger(d) || d<0 || d>6)) {
    throw new HttpError(400,'أيام العمل غير مهيأة');
  }
  const days = new Set(workingDays), perYear = new Map();
  for(let time=start.getTime(); time<=end.getTime(); time+=86400000){
    const day = new Date(time);
    if(days.has(day.getUTCDay())){
      const year=day.getUTCFullYear();
      perYear.set(year,(perYear.get(year)||0)+1);
    }
  }
  return perYear;
}

function remainingDays(approvedLeaves, request, workingDays, annualLimit) {
  if(!Number.isInteger(annualLimit)||annualLimit<0)throw new HttpError(400,'رصيد الإجازات غير صحيح');
  const used = new Map();
  for(const leave of approvedLeaves){
    for(const [year,num] of workingDaysWithin(leave.fromDate.toISOString().slice(0,10),
      leave.toDate.toISOString().slice(0,10),workingDays)){
      used.set(year,(used.get(year)||0)+num);
    }
  }
  for(const [year,num] of workingDaysWithin(request.fromDate.toISOString().slice(0,10),
    request.toDate.toISOString().slice(0,10),workingDays)){
    if((used.get(year)||0)+num>annualLimit)return false;
  }
  return true;
}

module.exports={sameVisit,workingDaysWithin,remainingDays};
