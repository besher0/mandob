'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLoginAttemptLimiter}=require('../src/login-attempts');

test('five bad attempts keep the same identity locked until its window expires',()=>{
  const limiter=createLoginAttemptLimiter({windowMs:1000,maxEntries:3,maxFailures:5});
  for(let i=0;i<5;i++)assert.equal(limiter.failed('ip:rep',100+i),true);
  assert.equal(limiter.allowed('ip:rep',105),false);
  assert.equal(limiter.failed('ip:rep',105),false);
  assert.equal(limiter.allowed('ip:rep',1103),false,'the most recent failure extends the window');
  assert.equal(limiter.allowed('ip:rep',1104),true);
  assert.equal(limiter.failed('ip:rep',1104),true);
  assert.equal(limiter.allowed('ip:rep',1105),true);
});

test('capacity never deletes still-active lockouts or admits extra identities',()=>{
  const limiter=createLoginAttemptLimiter({windowMs:1000,maxEntries:3,maxFailures:2});
  assert.equal(limiter.failed('ip:target',0),true);
  assert.equal(limiter.failed('ip:target',1),true);
  assert.equal(limiter.failed('ip:other-a',2),true);
  assert.equal(limiter.failed('ip:other-b',3),true);
  assert.equal(limiter.allowed('ip:new',4),false,'full cache rejects a new key');
  assert.equal(limiter.allowed('ip:target',4),false,'full cache must not clear a locked key');
  assert.equal(limiter.allowed('ip:other-a',4),true,'existing nonlocked identity is unaffected');
  assert.equal(limiter.allowed('ip:new',1001),true,'expired entries free space');
});

test('successful login clears only that identity, not unrelated lockouts',()=>{
  const limiter=createLoginAttemptLimiter({windowMs:1000,maxEntries:4,maxFailures:2});
  limiter.failed('ip:alice',10);
  limiter.failed('ip:alice',11);
  limiter.failed('ip:bob',10);
  limiter.failed('ip:bob',11);
  limiter.succeeded('ip:alice');
  assert.equal(limiter.allowed('ip:alice',12),true);
  assert.equal(limiter.allowed('ip:bob',12),false);
});

test('source-based limiter blocks username rotation without changing per-account limits',()=>{
  const source=createLoginAttemptLimiter({windowMs:1000,maxEntries:5,maxFailures:3});
  const identity=createLoginAttemptLimiter({windowMs:1000,maxEntries:10,maxFailures:5});
  for(const username of ['alice','bob','carol']){
    assert.equal(source.failed('192.0.2.10',10),true);
    assert.equal(identity.failed('192.0.2.10:'+username,10),true);
  }
  assert.equal(source.allowed('192.0.2.10',11),false);
  assert.equal(identity.allowed('192.0.2.10:david',11),true);
  assert.equal(source.allowed('192.0.2.11',11),true);
});

test('invalid limiter configuration is rejected',()=>{
  for(const options of [{maxEntries:0},{maxFailures:0},{windowMs:0},{maxEntries:1.5}]){
    assert.throws(()=>createLoginAttemptLimiter(options),RangeError);
  }
});
