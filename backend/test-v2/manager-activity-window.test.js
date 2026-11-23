'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {managerActivityWindow}=require('../src/manager-activity-window');
const iso=value=>value.toISOString().slice(0,10);
test('legacy weekly range remains Saturday through Friday',()=>{
  const {start,end}=managerActivityWindow(new Date('2026-11-23T00:00:00Z'));
  assert.equal(iso(start),'2026-11-21');
  assert.equal(iso(end),'2026-11-27');
});
test('v2 dashboard shows rolling last seven calendar days',()=>{
  const {start,end}=managerActivityWindow(new Date('2026-11-23T00:00:00Z'),'last7');
  assert.equal(iso(start),'2026-11-17');
  assert.equal(iso(end),'2026-11-23');
  assert.equal(start.getTime()+6*86400000,end.getTime());
});
test('invalid activity windows do not silently broaden the query',()=>{
  assert.throws(()=>managerActivityWindow(new Date(),'all'),RangeError);
});
