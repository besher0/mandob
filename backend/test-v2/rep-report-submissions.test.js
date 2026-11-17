const {test}=require('node:test');
const assert=require('node:assert/strict');
const {canReadSubmittedReport}=require('../src/routes');

test('representatives see only their own submitted reports in their company',()=>{
  const report={companyId:'a',repId:'rep-1',teamIdAtSubmission:'team-1'};
  assert.equal(canReadSubmittedReport({companyId:'a',id:'rep-1',role:'REP'},report),true);
  assert.equal(canReadSubmittedReport({companyId:'a',id:'rep-2',role:'REP'},report),false);
  assert.equal(canReadSubmittedReport({companyId:'b',id:'rep-1',role:'REP'},report),false);
});
test('managers see reports only from their team at submission, admins see their company',()=>{
  const report={companyId:'a',repId:'rep-1',teamIdAtSubmission:'team-1'};
  assert.equal(canReadSubmittedReport({companyId:'a',role:'TEAM_MANAGER',teamId:'team-1'},report),true);
  assert.equal(canReadSubmittedReport({companyId:'a',role:'TEAM_MANAGER',teamId:'team-2'},report),false);
  assert.equal(canReadSubmittedReport({companyId:'a',role:'TEAM_MANAGER'},report),false);
  assert.equal(canReadSubmittedReport({companyId:'a',role:'COMPANY_ADMIN'},report),true);
  assert.equal(canReadSubmittedReport({companyId:'b',role:'COMPANY_ADMIN'},report),false);
  assert.equal(canReadSubmittedReport({companyId:'a',role:'SUPER_ADMIN'},report),false);
  assert.equal(canReadSubmittedReport({companyId:'a',role:'COMPANY_ADMIN'},null),false);
});
