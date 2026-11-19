import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchAccurateLocation} from '../src/locationFix.mjs';

function fakeGps(){
  let success, failure, options;
  const cleared = [];
  return {
    cleared,
    get options(){return options;},
    watchPosition(onPosition,onError,config){
      success=onPosition; failure=onError; options=config;
      return 17;
    },
    clearWatch(id){cleared.push(id);},
    emit(accuracy,{latitude=36.22,longitude=37.11,timestamp=Date.now()}={}){
      success({coords:{latitude,longitude,accuracy},timestamp});
    },
    fail(code){failure({code,message:'Location error'});}
  };
}

test('uses the active server accuracy policy instead of a hardcoded 50m value',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:150});
  gps.emit(500);
  gps.emit(106);
  assert.equal((await fix.promise).coords.accuracy,106);
  assert.deepEqual(gps.cleared,[17]);
  assert.equal(gps.options.enableHighAccuracy,true);
  assert.equal(gps.options.maximumAge,0);
});

test('keeps waiting if the active server policy is 50m',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:50});
  let resolved=false;
  fix.promise.then(()=>{resolved=true;});
  gps.emit(106);
  await Promise.resolve();
  assert.equal(resolved,false);
  gps.emit(50);
  assert.equal((await fix.promise).coords.accuracy,50);
  assert.deepEqual(gps.cleared,[17]);
});

test('fails closed when the server accuracy policy is missing or invalid',async()=>{
  for(const requiredAccuracy of [undefined,NaN,0,-1,Infinity]){
    const gps=fakeGps();
    const fix=watchAccurateLocation(gps,{requiredAccuracy});
    await assert.rejects(fix.promise,/إعدادات دقة الموقع/);
    assert.deepEqual(gps.cleared,[]);
  }
});

test('skips stale and malformed readings',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:150});
  gps.emit(9,{timestamp:Date.now()-120000});
  gps.emit(8,{latitude:999});
  gps.emit(10,{longitude:NaN});
  gps.emit(0);
  gps.emit(90);
  assert.equal((await fix.promise).coords.accuracy,90);
});

test('retries transient GPS errors but cancels immediately on permission denial',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:150});
  gps.fail(3);
  gps.fail(2);
  gps.emit(105);
  await fix.promise;
  assert.deepEqual(gps.cleared,[17]);

  const deniedGps=fakeGps();
  const denied=watchAccurateLocation(deniedGps,{requiredAccuracy:150});
  deniedGps.fail(1);
  await assert.rejects(denied.promise,error=>error.code===1);
  assert.deepEqual(deniedGps.cleared,[17]);
});

test('times out without exposing GPS accuracy details in the message',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:150,waitMs:30});
  gps.emit(500);
  gps.emit(180);
  await assert.rejects(fix.promise,/تعذّر الحصول على موقع بدقة كافية/);
  assert.deepEqual(gps.cleared,[17]);
});

test('cancel stops GPS tracking and ignores late callbacks',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{requiredAccuracy:150});
  fix.cancel();
  await assert.rejects(fix.promise,/تم إيقاف تحديد الموقع/);
  gps.emit(5);
  assert.deepEqual(gps.cleared,[17]);
});
