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

const {frequencyGroups,aggregateVisitsByTeam}=require('../src/analytics-service');
const {workingDaysWithin,remainingDays}=require('../src/domain');
const {canReviewLeave}=require('../src/leave-service');

test('team frequency aggregates visits of colleagues once per team and doctor',()=>{
  const reps=[
    {id:'r1',teamId:'t1',name:'Ahmed',team:{name:'A'}},
    {id:'r2',teamId:'t1',name:'Mohammed',team:{name:'A'}},
    {id:'r3',teamId:'t2',name:'Samer',team:{name:'B'}}
  ];
  const groups=frequencyGroups(reps);
  assert.equal(groups.size,2,'Two groups, not three representatives');
  const groupIds=new Map([...groups].flatMap(([key,value])=>value.repIds.map(id=>[id,key])));
  const visits=[
    {doctorId:'doc',visit:{repId:'r1'}},{doctorId:'doc',visit:{repId:'r1'}},
    {doctorId:'doc',visit:{repId:'r2'}},{doctorId:'doc',visit:{repId:'r3'}}
  ];
  const counts=aggregateVisitsByTeam(visits,groupIds);
  assert.equal(counts.get('team:t1:doc'),3,'Colleagues contribute to same frequency');
  assert.equal(counts.get('team:t2:doc'),1,'Different teams are isolated');
});
test('representatives without a team do not share frequency',()=>{
  const groups=frequencyGroups([
    {id:'a',teamId:null,name:'A'},{id:'b',teamId:null,name:'B'}]);
  assert.equal(groups.size,2);
  assert.ok(groups.has('rep:a') && groups.has('rep:b'));
});
test('annual leave respects configured working days and remaining balance',()=>{
  const workingDays=[1,2,3,4,5];
  const monday=new Date('2026-10-19T00:00:00.000Z');
  const tuesday=new Date('2026-10-20T00:00:00.000Z');
  const count=workingDaysWithin('2026-10-19','2026-10-20',workingDays);
  assert.equal(count.get(2026),2);
  const used=[{fromDate:monday,toDate:tuesday}];
  assert.equal(remainingDays(used,{fromDate:new Date('2026-10-21'),toDate:new Date('2026-10-22')},workingDays,3),false);
  assert.equal(remainingDays(used,{fromDate:new Date('2026-10-21'),toDate:new Date('2026-10-22')},workingDays,4),true);
});
test('team manager can review only own team and company',()=>{
  const mgr={role:'TEAM_MANAGER',companyId:'c1',teamId:'t1'};
  assert.equal(canReviewLeave(mgr,{role:'REP',companyId:'c1',teamId:'t1'}),true);
  assert.equal(canReviewLeave(mgr,{role:'REP',companyId:'c1',teamId:'t2'}),false);
  assert.equal(canReviewLeave(mgr,{role:'REP',companyId:'c2',teamId:'t1'}),false);
});

const {visitGroupKey}=require('../src/analytics-service');
const {visitScope}=require('../src/auth');

test('visit-time attribution is independent of representative current membership',()=>{
  const currentMembership=new Map([['rep1','teamNEW']]);
  const formerTour={repId:'rep1',teamIdAtVisit:'teamOLD'};
  const newTour={repId:'rep1',teamIdAtVisit:currentMembership.get('rep1')};
  assert.equal(visitGroupKey(formerTour),'team:teamOLD');
  assert.equal(visitGroupKey(newTour),'team:teamNEW');
});
test('team manager history scoping selects original visit team; leave scope stays unchanged',()=>{
  const user={id:'manager',role:'TEAM_MANAGER',companyId:'company',teamId:'teamOLD'};
  assert.deepEqual(visitScope(user),{companyId:'company',teamIdAtVisit:'teamOLD'});
  assert.deepEqual(scope(user),{companyId:'company',rep:{teamId:'teamOLD'}});
});
