const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hashPassword,verifyPassword,scope,validateLocation,asDate}=require('../src/auth');

test('passwords are salted and cannot be compared as plaintext',()=>{
  const a=hashPassword('ChangeMeWith12Chars!');
  assert.notEqual(a,hashPassword('ChangeMeWith12Chars!'));
  assert.equal(verifyPassword('ChangeMeWith12Chars!',a),true);
  assert.equal(verifyPassword('invalid',a),false);
});
test('role based filters are scoped to company and team',()=>{
  const rep={id:'r1',companyId:'c1',role:'REP',teamId:'t1'};
  assert.deepEqual(scope(rep),{companyId:'c1',repId:'r1'});
  const mgr={id:'m1',companyId:'c1',role:'TEAM_MANAGER',teamId:'t1'};
  assert.deepEqual(scope(mgr),{companyId:'c1',rep:{teamId:'t1'}});
});
test('GPS location is checked for freshness and accuracy',()=>{
  const now=new Date();
  assert.equal(validateLocation({latitude:36.2,longitude:37.1,accuracy:20,capturedAt:now.toISOString()},now).latitude,36.2);
  assert.throws(()=>validateLocation({latitude:999,longitude:10,accuracy:20,capturedAt:now.toISOString()},now));
  assert.throws(()=>validateLocation({latitude:36,longitude:37,accuracy:1000,capturedAt:now.toISOString()},now));
});
test('invalid date values are rejected',()=>{
  assert.throws(()=>asDate('2026-02-31'));
});
