'use strict';
const {HttpError}=require('./auth');

// Used on existing PATCH endpoints. Keep the business validation and optional
// fields in each route; only reject malformed envelopes and unknown keys.
function checkedPatch(payload,allowed){
  if(!payload || typeof payload!=='object' || Array.isArray(payload) ||
      Object.getPrototypeOf(payload)!==Object.prototype)
    throw new HttpError(400,'بيانات التعديل يجب أن تكون كائناً JSON');
  const keys=Object.keys(payload);
  if(!keys.length)throw new HttpError(400,'لا توجد بيانات لتعديلها');
  const whitelist=new Set(allowed);
  const unknown=keys.find(key=>!whitelist.has(key));
  if(unknown)throw new HttpError(400,'الحقل غير مسموح بتعديله: '+unknown);
  return payload;
}
module.exports={checkedPatch};
