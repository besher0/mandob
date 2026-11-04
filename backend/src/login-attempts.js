'use strict';

// Bound login failure tracking without deleting still-active lockouts when the
// cache is full. A full cache fails closed for new identities until old entries
// expire; legitimate existing identities retain their own rate-limit state.
function createLoginAttemptLimiter({windowMs=15*60*1000,maxEntries=2500,maxFailures=5}={}){
  if(!Number.isSafeInteger(windowMs)||windowMs<=0||
     !Number.isSafeInteger(maxEntries)||maxEntries<=0||
     !Number.isSafeInteger(maxFailures)||maxFailures<=0)
    throw new RangeError('Invalid login limiter configuration');

  const entries=new Map();
  function pruneExpired(now){
    for(const [key,entry] of entries){
      if(entry.until<=now)entries.delete(key);
    }
  }
  function allowed(key,now=Date.now()){
    const current=entries.get(key);
    if(current&&current.until<=now)entries.delete(key);
    if(entries.size>=maxEntries)pruneExpired(now);
    const entry=entries.get(key);
    if(entry)return entry.failures<maxFailures;
    return entries.size<maxEntries;
  }
  function failed(key,now=Date.now()){
    if(!allowed(key,now))return false;
    const current=entries.get(key);
    entries.set(key,{failures:(current?.failures||0)+1,until:now+windowMs});
    return true;
  }
  function succeeded(key){entries.delete(key);}
  return {allowed,failed,succeeded};
}

module.exports={createLoginAttemptLimiter};
