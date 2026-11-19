import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GPS_REQUIRED_ACCURACY_METERS,watchAccurateLocation} from '../src/locationFix.mjs';

function fakeGps(){
  let success, failure;
  const cleared = [];
  let options;
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

test('waits for a fresh fix at or below 50 meters instead of accepting the first reading',async()=>{
  const gps=fakeGps(), progress=[];
  const fix=watchAccurateLocation(gps,{onAccuracy:a=>progress.push(a)});
  let resolved=false;
  fix.promise.then(()=>{resolved=true;});
  gps.emit(500);
  gps.emit(120);
  await Promise.resolve();
  assert.equal(resolved,false);
  gps.emit(GPS_REQUIRED_ACCURACY_METERS);
  const position=await fix.promise;
  assert.equal(position.coords.accuracy,50);
  assert.deepEqual(progress,[500,120,50]);
  assert.equal(gps.options.enableHighAccuracy,true);
  assert.equal(gps.options.maximumAge,0);
  assert.deepEqual(gps.cleared,[17]);
});

test('skips stale and malformed readings',async()=>{
  const gps=fakeGps(), progress=[];
  const fix=watchAccurateLocation(gps,{onAccuracy:a=>progress.push(a)});
  gps.emit(9,{timestamp:Date.now()-120000});
  gps.emit(8,{latitude:999});
  gps.emit(10,{longitude:NaN});
  gps.emit(0);
  assert.deepEqual(progress,[]);
  gps.emit(20);
  assert.equal((await fix.promise).coords.accuracy,20);
  assert.deepEqual(progress,[20]);
});

test('retries transient GPS errors but cancels immediately on permission denial',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps);
  gps.fail(3);
  gps.fail(2);
  gps.emit(35);
  await fix.promise;
  assert.deepEqual(gps.cleared,[17]);

  const deniedGps=fakeGps();
  const denied=watchAccurateLocation(deniedGps);
  deniedGps.fail(1);
  await assert.rejects(denied.promise,error=>error.code===1);
  assert.deepEqual(deniedGps.cleared,[17]);
});

test('times out with an explanation and the best reported accuracy',async()=>{
  const gps=fakeGps();
  const fix=watchAccurateLocation(gps,{waitMs:30});
  gps.emit(500);
  gps.emit(180);
  await assert.rejects(fix.promise,/أفضل دقة وصلنا إليها ±180 متر/);
  assert.deepEqual(gps.cleared,[17]);
});

test('cancel stops GPS tracking, rejects pending request and ignores late callbacks',async()=>{
  const gps=fakeGps(), seen=[];
  const fix=watchAccurateLocation(gps,{onAccuracy:a=>seen.push(a)});
  fix.cancel();
  await assert.rejects(fix.promise,/تم إيقاف تحديد الموقع/);
  gps.emit(5);
  assert.deepEqual(seen,[]);
  assert.deepEqual(gps.cleared,[17]);
});
