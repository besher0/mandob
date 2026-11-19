import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestLocationPermission} from '../src/locationPermission.mjs';

function gps({error,position={coords:{latitude:35,longitude:37,accuracy:500}},throwError=false}={}) {
  const calls=[];
  return {calls,getCurrentPosition(success,failure,options) {
    calls.push(options);
    if (throwError) throw Error('Blocked by browser');
    if (error) failure(error);
    else success(position);
  }};
}

test('checks for a fresh position when entering, even if permission was previously granted',async()=>{
  const geo=gps();
  assert.equal(await requestLocationPermission(geo),'granted');
  assert.deepEqual(geo.calls,[{enableHighAccuracy:true,maximumAge:0,timeout:15000}]);
});
test('does not accept a permissions API grant in place of working location services',async()=>{
  const geo=gps({error:{code:2}});
  assert.equal(await requestLocationPermission(geo),'unavailable');
});
test('allows an explicit retry after a denied attempt',async()=>{
  let denied=true;
  const geo={getCurrentPosition(success,failure){
    if(denied)failure({code:1});
    else success({coords:{latitude:35,longitude:37}});
  }};
  assert.equal(await requestLocationPermission(geo),'denied');
  denied=false;
  assert.equal(await requestLocationPermission(geo),'granted');
});
test('returns denied when browser refuses location access',async()=>{
  assert.equal(await requestLocationPermission(gps({error:{code:1}})),'denied');
});
test('does not unlock the app when location service times out or is unavailable',async()=>{
  assert.equal(await requestLocationPermission(gps({error:{code:2}})),'unavailable');
  assert.equal(await requestLocationPermission(gps({error:{code:3}})),'unavailable');
});
test('rejects invalid coordinates rather than using them',async()=>{
  assert.equal(await requestLocationPermission(gps({position:{coords:{latitude:120,longitude:37}}})),'unavailable');
  assert.equal(await requestLocationPermission(gps({position:{coords:{latitude:35,longitude:Infinity}}})),'unavailable');
  assert.equal(await requestLocationPermission(gps({position:null})),'unavailable');
});
test('handles unavailable or blocked geolocation API',async()=>{
  assert.equal(await requestLocationPermission(undefined),'unavailable');
  assert.equal(await requestLocationPermission(gps({throwError:true})),'unavailable');
});
