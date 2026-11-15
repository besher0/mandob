import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportRange} from '../src/repReport.mjs';
test('daily report covers one local calendar day',()=>{
  assert.deepEqual(reportRange('2026-11-15','daily'),
    {from:'2026-11-15',to:'2026-11-15'});
});
test('Saturday through Friday week matches legacy dates',()=>{
  assert.deepEqual(reportRange('2026-11-15','weekly'),
    {from:'2026-11-14',to:'2026-11-20'});
  assert.deepEqual(reportRange('2026-11-14','weekly'),
    {from:'2026-11-14',to:'2026-11-20'});
  assert.deepEqual(reportRange('2026-11-20','weekly'),
    {from:'2026-11-14',to:'2026-11-20'});
});
test('week works across year boundary',()=>{
  assert.deepEqual(reportRange('2027-01-01','weekly'),
    {from:'2026-12-26',to:'2027-01-01'});
});
test('invalid and impossible dates are rejected',()=>{
  assert.throws(()=>reportRange('2026-02-30','weekly'),/Invalid date/);
  assert.throws(()=>reportRange('tomorrow','daily'),/Invalid date/);
});
