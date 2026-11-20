'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {periodWindow}=require('../src/analytics-service');
const {validateLeaveAttachment,MAX_LEAVE_FILE_BYTES}=require('../src/leave-service');

const day=d=>d.toISOString().slice(0,10);
const cycleStart=new Date('2026-11-01T00:00:00Z');
const cycleEnd=new Date('2026-11-30T00:00:00Z');

test('legacy period choices retain the cycle interval and use the selected actual visit window',()=>{
  let window=periodWindow(cycleStart,cycleEnd,'cycle','2026-11-20');
  assert.deepEqual([day(window.start),day(window.end)],['2026-11-01','2026-11-30']);
  window=periodWindow(cycleStart,cycleEnd,'week','2026-11-20');
  assert.deepEqual([day(window.start),day(window.end)],['2026-11-14','2026-11-20']);
  window=periodWindow(cycleStart,cycleEnd,'month','2026-11-20');
  assert.deepEqual([day(window.start),day(window.end)],['2026-11-01','2026-11-30']);
});
test('week and month are clamped to the configured cycle without moving the goal dates',()=>{
  const from=new Date('2026-11-18T00:00:00Z');
  const to=new Date('2026-12-05T00:00:00Z');
  const week=periodWindow(from,to,'week','2026-11-20');
  assert.deepEqual([day(week.start),day(week.end)],['2026-11-18','2026-11-20']);
  const month=periodWindow(from,to,'month','2026-11-20');
  assert.deepEqual([day(month.start),day(month.end)],['2026-11-18','2026-11-30']);
  assert.throws(()=>periodWindow(cycleStart,cycleEnd,'invalid','2026-11-20'),/فترة التحليل/);
});
test('private leave attachment validates actual PDF bytes and rejects non-PDF disguises',()=>{
  const bytes=Buffer.from('%PDF-1.7\n1 0 obj\n','ascii');
  const valid=validateLeaveAttachment({fileName:'تقرير طبي.pdf',
    mimeType:'application/pdf',base64:bytes.toString('base64')});
  assert.equal(valid.fileName,'تقرير طبي.pdf');
  assert.equal(valid.byteLength,bytes.length);
  assert.ok(valid.data.equals(bytes));
  assert.throws(()=>validateLeaveAttachment({
    fileName:'fake.pdf',mimeType:'application/pdf',
    base64:Buffer.from('not really a pdf').toString('base64')
  }),/محتوى الملف/);
  assert.throws(()=>validateLeaveAttachment({
    fileName:'file.exe',mimeType:'application/pdf',base64:bytes.toString('base64')
  }),/المرفق يجب/);
  assert.throws(()=>validateLeaveAttachment({
    fileName:'../document.pdf',mimeType:'application/pdf',base64:bytes.toString('base64')
  }),/اسم المرفق/);
});
test('leave files reject oversized data, malformed encoding and invalid extensions',()=>{
  assert.equal(MAX_LEAVE_FILE_BYTES,2*1024*1024);
  assert.equal(validateLeaveAttachment(undefined),null);
  assert.throws(()=>validateLeaveAttachment({fileName:'paper.pdf',
    mimeType:'application/pdf',base64:'!!!='}),/ترميز المرفق/);
  assert.throws(()=>validateLeaveAttachment({fileName:'paper.pdf',
    mimeType:'application/pdf',base64:Buffer.alloc(MAX_LEAVE_FILE_BYTES+1).toString('base64')}),
    /ترميز المرفق|الملف كبير/);
});
