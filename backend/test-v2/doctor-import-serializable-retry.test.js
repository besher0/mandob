'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {retrySerializableImport}=require('../src/doctor-import-service');

function dbConflict(code='P2034'){
  const error=new Error('database concurrency abort');error.code=code;return error;
}

test('rolled-back Serializable import retries only P2034 and succeeds on second attempt',async()=>{
  let attempts=0,replayCalls=0;
  const result=await retrySerializableImport(async()=>{
    attempts++;
    if(attempts===1)throw dbConflict();
    return {success:true,created:2};
  },async()=>{replayCalls++;return null});
  assert.deepEqual(result,{success:true,created:2});
  assert.equal(attempts,2);
  assert.equal(replayCalls,1);
});

test('commit receipt wins over retry when another request has completed same import',async()=>{
  let attempts=0;
  const prior={success:true,created:1,duplicate:true};
  const result=await retrySerializableImport(async()=>{
    attempts++;throw dbConflict();
  },async()=>prior);
  assert.deepEqual(result,prior);
  assert.equal(attempts,1,'no duplicate write transaction after replay');
});

test('idempotency-key unique violation can resolve to a committed prior receipt',async()=>{
  let attempts=0;
  const result=await retrySerializableImport(async()=>{
    attempts++;throw dbConflict('P2002');
  },async()=>({success:true,duplicate:true}));
  assert.equal(result.duplicate,true);
  assert.equal(attempts,1);
});

test('bounded retrier exits with clear 409 after 3 serialization conflicts',async()=>{
  let attempts=0,replays=0;
  await assert.rejects(()=>retrySerializableImport(async()=>{
    attempts++;throw dbConflict();
  },async()=>{replays++;return null}),error=>
    error.status===409||error.statusCode===409||error.code===409);
  assert.equal(attempts,3);
  assert.equal(replays,3);
});

test('business rule 409, invalid data, connection failure and unrelated unique constraints are never retried',async()=>{
  for(const failure of [
    Object.assign(new Error('doctor changed'),{status:409}),
    Object.assign(new Error('invalid row'),{status:400}),
    dbConflict('P1001'),
    dbConflict('P2002')
  ]){
    let attempts=0;
    await assert.rejects(()=>retrySerializableImport(async()=>{
      attempts++;throw failure;
    },async()=>null),failure);
    assert.equal(attempts,1);
  }
});
