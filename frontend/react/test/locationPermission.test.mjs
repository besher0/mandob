import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestLocationPermission} from '../src/locationPermission.mjs';

function gps({error,throwError=false}={}){
  const calls=[];
  return {calls,getCurrentPosition(success,failure,options){
    calls.push(options);
    if(throwError)throw Error('Blocked by browser');
    if(error)failure(error);
    else success({coords:{latitude:35,longitude:37,accuracy:500}});
  }};
}

test('granted permission does not activate GPS or collect a new position',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo,{query:async()=>({state:'granted'})}),'granted');
  assert.equal(geo.calls.length,0);
});
test('denied permission cannot be re-prompted automatically',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo,{query:async()=>({state:'denied'})}),'denied');
  assert.equal(geo.calls.length,0);
});
test('prompts once when permission is not yet decided, without caching coordinates',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo,{query:async()=>({state:'prompt'})}),'granted');
  assert.deepEqual(geo.calls,[{enableHighAccuracy:false,maximumAge:0,timeout:12000}]);
});
test('falls back when Permissions API is unsupported',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo,undefined),'granted');
  assert.equal(geo.calls.length,1);
});
test('falls back when Permissions API query fails',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo,{query:async()=>{throw Error('unsupported')}}),'granted');
  assert.equal(geo.calls.length,1);
});
test('returns denied on user rejection',async()=>{
  const geo=gps({error:{code:1}});
  assert.equal(await requestLocationPermission(geo,{query:async()=>({state:'prompt'})}),'denied');
});
test('handles location unavailable or blocked by the browser gracefully',async()=>{
  assert.equal(await requestLocationPermission(undefined,undefined),'unavailable');
  assert.equal(await requestLocationPermission(gps({error:{code:2}}),undefined),'unavailable');
  assert.equal(await requestLocationPermission(gps({throwError:true}),undefined),'unavailable');
});
