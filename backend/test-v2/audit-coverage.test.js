'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=(name)=>fs.readFileSync(path.join(__dirname,'../src/',name),'utf8');

// A static safety net for the runtime audit tests: changing a mutation route
// or delegating a handler to a new service requires an explicit audit review.
const mechanisms=new Map([
  ['POST /api/companies','auditWrite('],
  ['POST /api/companies/:id/admins','auditWrite('],
  ['POST /api/teams','auditWrite('],
  ['PATCH /api/teams/:id','auditWrite('],
  ['POST /api/users','auditWrite('],
  ['PATCH /api/users/:id','auditWrite('],
  ['POST /api/area-groups','auditWrite('],
  ['POST /api/areas','auditWrite('],
  ['PATCH /api/areas/:id','auditWrite('],
  ['POST /api/doctors','auditWrite('],
  ['POST /api/doctors/import/commit','commitDoctors('],
  ['PATCH /api/doctors/:id/status','auditWrite('],
  ['POST /api/pharmacies','auditWrite('],
  ['PATCH /api/pharmacies/:id/status','auditWrite('],
  ['POST /api/hospitals','auditWrite('],
  ['PATCH /api/hospitals/:id/status','auditWrite('],
  ['POST /api/products','auditWrite('],
  ['POST /api/visits','submitVisit('],
  ['POST /api/leaves','submitLeave('],
  ['PATCH /api/leaves/:id/status','reviewLeave('],
  ['PATCH /api/settings','auditWrite('],
  ['PUT /api/doctor-goals','auditWrite(']
]);

test('all registered JSON mutation routes have an explicit audit mechanism',()=>{
  const source=read('routes.js');
  const matches=[...source.matchAll(/route\('(post|patch|put|delete)','(\/api\/[^']+)'/g)];
  const discovered=matches.map(x=>x[1].toUpperCase()+' '+x[2]);
  assert.deepEqual(discovered.slice().sort(),[...mechanisms.keys()].sort(),
    'A route was introduced or removed without updating the audit inventory');
  for(let i=0;i<matches.length;i++){
    const current=matches[i],next=matches[i+1];
    const chunk=source.slice(current.index,next?.index??source.length);
    const signature=discovered[i];
    assert.ok(chunk.includes(mechanisms.get(signature)),
      'Missing expected audit mechanism for '+signature);
  }
  // Medical descriptive PATCH endpoints are generated from a single loop.
  const dynamic="route('patch','/api/'+kind+'/:id'";
  const dynamicStart=source.indexOf(dynamic);
  assert.ok(dynamicStart>=0,'Dynamic medical edit PATCH registration missing');
  const dynamicChunk=source.slice(dynamicStart,source.indexOf("route('patch','/api/doctors/:id/status'",dynamicStart));
  assert.ok(dynamicChunk.includes('auditWrite('),'Medical edit mutations must be audited');

  // XLSX preview is intentionally read-only; final import is audited.
  const preview=source.indexOf("app.post('/api/doctors/import/preview'");
  assert.ok(preview>=0 && preview<source.indexOf("route('post','/api/doctors/import/commit'"));
  assert.ok(source.includes("const {checkedPatch,checkedInput}=require('./request-validation')"));
});

test('every mutation delegation records an audit inside its write transaction',()=>{
  const serviceChecks={
    'routes.js':['async function auditWrite(', 'prisma.$transaction(', 'tx.auditLog.create('],
    'visit-service.js':['async function submitVisit(', 'prisma.$transaction(', 'tx.auditLog.create('],
    'leave-service.js':['async function submitLeave(', 'async function reviewLeave(', 'prisma.$transaction(', 'tx.auditLog.create('],
    'doctor-import-service.js':['async function commitDoctors(', 'prisma.$transaction(', 'tx.auditLog.create('],
    'auth.js':['async function login(', 'async function logout(', 'prisma.$transaction(', 'tx.auditLog.create(']
  };
  for(const [file,required] of Object.entries(serviceChecks)){
    const source=read(file);
    for(const marker of required)
      assert.ok(source.includes(marker),file+' lacks expected transactional audit marker '+marker);
  }
});
