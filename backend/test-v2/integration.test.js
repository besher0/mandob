'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('PostgreSQL API isolation and GPS visits',{skip:process.env.RUN_DB_TESTS!=='1',timeout:90000},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const seed=randomUUID().slice(0,8);
  const password='TestingPassword!2026';
  const companyIds=[];
  const globalAdminIds=[];
  async function call(path,method='GET',body=null,cookie=null){
    const resp=await fetch(base+'/api'+path,{
      method,headers:{...(body?{'Content-Type':'application/json'}:{}),
        ...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:'http://localhost:5173'}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:resp.status,data:await resp.json().catch(()=>({})),
      cookie:resp.headers.get('set-cookie')?.split(';')[0]};
  }
  try {
    const ca=await prisma.company.create({data:{name:'Test A '+seed,settings:{create:{}}}});
    const cb=await prisma.company.create({data:{name:'Test B '+seed,settings:{create:{}}}});
    companyIds.push(ca.id,cb.id);
    const team=await prisma.team.create({data:{companyId:ca.id,name:'Team '+seed}});
    const admin=await prisma.user.create({data:{companyId:ca.id,name:'Admin',username:'adm-'+seed,
      role:'COMPANY_ADMIN',passwordHash:hashPassword(password)}});
    const rep=await prisma.user.create({data:{companyId:ca.id,name:'Rep',username:'rep-'+seed,
      role:'REP',teamId:team.id,passwordHash:hashPassword(password)}});
    const other=await prisma.user.create({data:{companyId:cb.id,name:'Other',username:'oth-'+seed,
      role:'REP',passwordHash:hashPassword(password)}});
    const aa=await prisma.area.create({data:{companyId:ca.id,name:'Area A '+seed}});
    const ab=await prisma.area.create({data:{companyId:cb.id,name:'Area B '+seed}});
    const foreignTeam=await prisma.team.create({data:{companyId:cb.id,name:'Foreign team '+seed}});
    await prisma.repArea.create({data:{repId:rep.id,areaId:aa.id}});
    const da=await prisma.doctor.create({data:{companyId:ca.id,areaId:aa.id,name:'Doctor A',specialty:'Cardiology',grade:'A'}});
    const db=await prisma.doctor.create({data:{companyId:cb.id,areaId:ab.id,name:'Doctor B',specialty:'Cardiology'}});
    assert.equal((await call('/visits')).status,401);
    const badJson=await fetch(base+'/api/login',{method:'POST',
      headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:'{bad'});
    assert.equal(badJson.status,400,'Malformed JSON must be reported as 400');
    assert.match(badJson.headers.get('content-type')||'',/application\/json/);
    assert.equal(badJson.headers.get('cache-control'),'no-store');
    const tooLarge=await fetch(base+'/api/login',{method:'POST',
      headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},
      body:JSON.stringify({filler:'x'.repeat(135000)})});
    assert.equal(tooLarge.status,413,'Oversize requests must be rejected clearly');
    assert.equal((await call('/login','POST',{username:'missing-'+seed,password})).status,401);
    assert.equal((await call('/login','POST',{username:rep.username,password:'wrong'})).status,401);
    const rl=await call('/login','POST',{username:rep.username,password});
    const al=await call('/login','POST',{username:admin.username,password});
    const ol=await call('/login','POST',{username:other.username,password});
    assert.equal(rl.status,200);
    assert.equal(al.status,200);
    assert.equal(ol.status,200);
    // A company administrator cannot assign a representative to another company.
    assert.equal((await call('/users/'+rep.id,'PATCH',{teamId:foreignTeam.id},al.cookie)).status,400);
    assert.equal((await call('/users/'+rep.id,'PATCH',{areaIds:[ab.id]},al.cookie)).status,400);
    assert.equal((await call('/users','POST',{
      role:'REP',name:'Invalid assignment',username:'invalid-team-'+seed,password,
      teamId:foreignTeam.id
    },al.cookie)).status,400);
    assert.equal((await call('/users','POST',{
      role:'REP',name:'Invalid assignment',username:'invalid-area-'+seed,password,
      areaIds:[ab.id]
    },al.cookie)).status,400);
    assert.equal(await prisma.user.count({where:{username:{in:['invalid-team-'+seed,'invalid-area-'+seed]}}}),0);
    const afterDenied=await prisma.user.findUnique({where:{id:rep.id}});
    assert.equal(afterDenied.teamId,team.id);
    assert.equal(await prisma.repArea.count({where:{repId:rep.id,areaId:aa.id}}),1);
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,entity:'USER',entityId:rep.id,action:'UPDATE'
    }}),0,'Rejected cross-company assignment must not create misleading audit entries');

    // Test the same business operations before and after atomic audit refactor.
    const areaCreated=await call('/areas','POST',{name:'Audited area '+seed},al.cookie);
    assert.equal(areaCreated.status,201,JSON.stringify(areaCreated.data));
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,action:'CREATE',entity:'AREA',entityId:areaCreated.data.id
    }}),1,'Successful write has an audit event');
    assert.equal((await call('/doctors','POST',{
      name:'Foreign doctor',areaId:ab.id,specialty:'Dermatology'
    },al.cookie)).status,400,'Company admin cannot write in another company area');
    assert.equal((await call('/areas','POST',{name:'Unauthorized area'},rl.cookie)).status,403);
    const createdTeam=await call('/teams','POST',{name:'Audited Team '+seed},al.cookie);
    assert.equal(createdTeam.status,201,JSON.stringify(createdTeam.data));
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      action:'CREATE',entity:'TEAM',entityId:createdTeam.data.id}}),1);
    const product=await call('/products','POST',{name:'Audited product '+seed},al.cookie);
    assert.equal(product.status,201,JSON.stringify(product.data));
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      action:'CREATE',entity:'PRODUCT',entityId:product.data.id}}),1);
    assert.equal((await call('/teams','POST',{name:'Unauthorized team'},ol.cookie)).status,403);
    // Simulate audit failure inside a transaction without changing user-facing business rules.
    const {auditWrite}=require('../src/routes');
    const rollbackName='Rollback area '+seed;
    await assert.rejects(()=>auditWrite({id:randomUUID(),companyId:ca.id},'CREATE','AREA',
      v=>v.id,tx=>tx.area.create({data:{companyId:ca.id,name:rollbackName}})),
      e=>e.code==='P2003','Invalid audit actor FK must abort whole write');
    assert.equal(await prisma.area.count({where:{companyId:ca.id,name:rollbackName}}),0,
      'Record creation rolled back when audit event failed');
    assert.equal((await call('/users','GET',null,rl.cookie)).status,403);
    // Browser Origin defense: an authenticated cookie cannot authorize foreign-origin mutations.
    const forged=await fetch(base+'/api/logout',{method:'POST',
      headers:{Origin:'https://untrusted.example',Cookie:rl.cookie}});
    assert.equal(forged.status,403);
    assert.equal((await call('/me','GET',null,rl.cookie)).status,200,
      'Cross-origin logout attempt did not revoke the valid session');
    const docs=await call('/doctors','GET',null,rl.cookie);
    assert.deepEqual(docs.data.map(d=>d.id),[da.id]);
    const body={clientVisitId:randomUUID(),type:'DOCTOR',visitDate:new Date().toISOString().slice(0,10),
      targetIds:[da.id],location:{latitude:36.2,longitude:37.1,accuracy:22,capturedAt:new Date().toISOString()}};
    const created=await call('/visits','POST',body,rl.cookie);
    assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal((await call('/visits','POST',body,rl.cookie)).data.duplicate,true);
    // Same idempotency key with different content must conflict.
    assert.equal((await call('/visits','POST',
      {...body,targetIds:[da.id],location:{...body.location,latitude:37.1}},rl.cookie)).status,409);
    const colleague=await prisma.user.create({data:{companyId:ca.id,name:'Colleague',username:'col-'+seed,
      role:'REP',teamId:team.id,passwordHash:hashPassword(password)}});
    const rivalTeam=await prisma.team.create({data:{companyId:ca.id,name:'Second '+seed}});
    const rival=await prisma.user.create({data:{companyId:ca.id,name:'Other Team',
      username:'rival-'+seed,role:'REP',teamId:rivalTeam.id,passwordHash:hashPassword(password)}});
    await prisma.repArea.createMany({data:[{repId:colleague.id,areaId:aa.id},
      {repId:rival.id,areaId:aa.id}]});
    const cl=await call('/login','POST',{username:colleague.username,password});
    const tl=await call('/login','POST',{username:rival.username,password});
    assert.equal(cl.status,200);
    assert.equal(tl.status,200);
    const colleagueVisit=await call('/visits','POST',{...body,clientVisitId:randomUUID()},cl.cookie);
    assert.equal(colleagueVisit.status,201,JSON.stringify(colleagueVisit.data));
    const combined=await call('/analytics/frequency','GET',null,rl.cookie);
    assert.equal(combined.status,200,JSON.stringify(combined.data));
    const ownDoctor=combined.data.items.find(x=>x.id===da.id);
    assert.equal(ownDoctor.done,2,'Two reps in the same team share doctor frequency');
    assert.equal(ownDoctor.target,4,'One target per doctor per team');
    assert.equal(combined.data.items.filter(x=>x.id===da.id).length,1,
      'Doctor appears once per team, not once per representative');
    const rivalView=await call('/analytics/frequency','GET',null,tl.cookie);
    assert.equal(rivalView.data.items.find(x=>x.id===da.id).done,0,
      'Different team does not inherit visits from another team');
    const rivalVisit=await call('/visits','POST',{...body,clientVisitId:randomUUID()},tl.cookie);
    assert.equal(rivalVisit.status,201);
    const adminView=await call('/analytics/frequency','GET',null,al.cookie);
    assert.equal(adminView.status,200);
    const rows=adminView.data.items.filter(x=>x.id===da.id);
    assert.equal(rows.length,2,'Company dashboard shows separate frequency per team');
    assert.deepEqual(rows.map(x=>x.done).sort((a,b)=>a-b),[1,2]);
    assert.equal((await call('/visits','GET',null,rl.cookie)).data.length,1);
    assert.equal((await call('/visits','GET',null,ol.cookie)).data.length,0);
    assert.equal((await call('/visits','POST',{...body,clientVisitId:randomUUID(),targetIds:[db.id]},rl.cookie)).status,403);
    assert.equal((await call('/visits','POST',{...body,clientVisitId:randomUUID()},al.cookie)).status,403);
    // Team transfer: previous visits remain with old team, new visits with new team.
    const moved=await call('/users/'+rep.id,'PATCH',{teamId:rivalTeam.id},al.cookie);
    assert.equal(moved.status,200,JSON.stringify(moved.data));
    const newVisit=await call('/visits','POST',{...body,clientVisitId:randomUUID()},rl.cookie);
    assert.equal(newVisit.status,201,JSON.stringify(newVisit.data));
    assert.equal(newVisit.data.teamIdAtVisit,rivalTeam.id,
      'New visit is attributed to the representative current team');
    assert.equal(created.data.teamIdAtVisit,team.id,
      'Original visit retains team attribution');
    const historical=await prisma.visit.findMany({
      where:{id:{in:[created.data.id,newVisit.data.id]}},orderBy:{createdAt:'asc'}});
    assert.equal(historical.find(x=>x.id===created.data.id).teamIdAtVisit,team.id);
    assert.equal(historical.find(x=>x.id===newVisit.data.id).teamIdAtVisit,rivalTeam.id);
    const oldTeamFrequency=await call('/analytics/frequency','GET',null,cl.cookie);
    assert.equal(oldTeamFrequency.status,200);
    assert.equal(oldTeamFrequency.data.items.find(x=>x.id===da.id).done,2,
      'Old team retains both visits despite transfer of one representative');
    const newTeamFrequency=await call('/analytics/frequency','GET',null,rl.cookie);
    assert.equal(newTeamFrequency.status,200);
    assert.equal(newTeamFrequency.data.items.find(x=>x.id===da.id).done,2,
      'New team counts prior rival-team visit and ONLY the transferred rep new visit');
    assert.equal((await call('/visits','POST',body,rl.cookie)).data.duplicate,true,
      'Replaying old visit after transfer does not transfer its attribution');
    const afterTransferAdmin=await call('/analytics/frequency','GET',null,al.cookie);
    assert.deepEqual(afterTransferAdmin.data.items.filter(x=>x.id===da.id)
      .map(x=>x.done).sort((a,b)=>a-b),[2,2]);
    // Archival is state change only: no doctor or existing VisitTarget is deleted.
    assert.equal((await call('/doctors/'+da.id+'/status','PATCH',{active:false},rl.cookie)).status,403,
      'Only company admin may archive doctors');
    assert.equal((await call('/doctors/'+da.id+'/status','PATCH',{active:false},ol.cookie)).status,403,
      'A different company cannot change doctor state');
    assert.equal((await call('/doctors/'+da.id+'/status','PATCH',{active:'false'},al.cookie)).status,400,
      'Archive state must be a JSON boolean');
    const archived=await call('/doctors/'+da.id+'/status','PATCH',{active:false},al.cookie);
    assert.equal(archived.status,200,JSON.stringify(archived.data));
    assert.equal(archived.data.active,false);
    assert.equal(await prisma.doctor.count({where:{id:da.id}}),1,
      'Archived doctor record is kept in PostgreSQL');
    assert.equal((await call('/doctors','GET',null,rl.cookie)).data.some(x=>x.id===da.id),false,
      'Archived doctor disappears from new-visit selection');
    assert.equal((await call('/doctors?includeArchived=true','GET',null,rl.cookie)).status,403,
      'Representative cannot list inactive doctors by adding a query parameter');
    const includingArchived=await call('/doctors?includeArchived=true','GET',null,al.cookie);
    assert.equal(includingArchived.status,200);
    assert.equal(includingArchived.data.find(x=>x.id===da.id).active,false);
    assert.equal((await call('/visits','POST',{...body,clientVisitId:randomUUID()},rl.cookie)).status,403,
      'Cannot create a new visit for an archived doctor');
    const archivedVisits=await call('/visits','GET',null,rl.cookie);
    assert.equal(archivedVisits.status,200);
    assert.ok(archivedVisits.data.some(x=>x.id===created.data.id),
      'Past visit records are preserved after archiving');
    const archivedFrequency=await call('/analytics/frequency','GET',null,al.cookie);
    assert.equal(archivedFrequency.status,200);
    assert.deepEqual(archivedFrequency.data.items.filter(x=>x.id===da.id)
      .map(x=>x.done).sort((a,b)=>a-b),[2,2],
      'Historical frequency remains visible with original counts');
    assert.equal(await prisma.visitTarget.count({where:{doctorId:da.id}}),4,
      'Archiving does not delete historical visit targets');
    const restored=await call('/doctors/'+da.id+'/status','PATCH',{active:true},al.cookie);
    assert.equal(restored.status,200);
    assert.equal(restored.data.active,true);
    assert.equal((await call('/doctors','GET',null,rl.cookie)).data.some(x=>x.id===da.id),true);
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      entity:'DOCTOR',entityId:da.id,action:'ARCHIVE'}}),1);
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      entity:'DOCTOR',entityId:da.id,action:'RESTORE'}}),1);
    const unvisited=await call('/doctors','POST',{areaId:aa.id,name:'Unused doctor '+seed,
      specialty:'Cardiology',grade:'C'},al.cookie);
    assert.equal(unvisited.status,201);
    assert.equal((await call('/doctors/'+unvisited.data.id+'/status','PATCH',
      {active:false},al.cookie)).status,200);
    const afterUnusedArchive=await call('/analytics/frequency','GET',null,al.cookie);
    assert.ok(!afterUnusedArchive.data.items.some(x=>x.id===unvisited.data.id),
      'Archived doctors with no visits are not counted as unmet frequency targets');
    // Pharmacy and hospital soft-archival retains original VisitTarget records.
    for(const kind of [
      {resource:'pharmacies',type:'PHARMACY',model:'pharmacy',fk:'pharmacyId'},
      {resource:'hospitals',type:'HOSPITAL',model:'hospital',fk:'hospitalId'}
    ]){
      const url='/'+kind.resource;
      const createdEntity=await call(url,'POST',{
        name:kind.type+' target '+seed,areaId:aa.id
      },al.cookie);
      assert.equal(createdEntity.status,201,JSON.stringify(createdEntity.data));
      const medicalId=createdEntity.data.id;
      assert.equal(createdEntity.data.active,true,'New entities are active by default');
      const tour={...body,clientVisitId:randomUUID(),type:kind.type,targetIds:[medicalId]};
      const pastTour=await call('/visits','POST',tour,rl.cookie);
      assert.equal(pastTour.status,201,JSON.stringify(pastTour.data));
      assert.equal((await call(url+'/'+medicalId+'/status','PATCH',{active:false},rl.cookie)).status,403,
        'Representative cannot archive medical targets');
      assert.equal((await call(url+'/'+medicalId+'/status','PATCH',{active:false},ol.cookie)).status,403,
        'Cross-company representative cannot archive targets');
      assert.equal((await call(url+'/'+medicalId+'/status','PATCH',{active:0},al.cookie)).status,400,
        'Soft-archive payload must be a JSON boolean');
      assert.equal((await call(url+'?includeArchived=true','GET',null,rl.cookie)).status,403,
        'A representative cannot request archived targets');
      assert.equal((await call(url+'?includeArchived=invalid','GET',null,al.cookie)).status,400,
        'Malformed archive-list filters must be rejected');
      const archived=await call(url+'/'+medicalId+'/status','PATCH',{active:false},al.cookie);
      assert.equal(archived.status,200,JSON.stringify(archived.data));
      assert.equal(archived.data.active,false);
      assert.equal(await prisma[kind.model].count({where:{id:medicalId,companyId:ca.id}}),1,
        'Archive action must preserve original target entity');
      assert.equal((await call(url,'GET',null,rl.cookie)).data.some(x=>x.id===medicalId),false,
        'Archived target must be hidden from fresh-tour list');
      const adminList=await call(url+'?includeArchived=true','GET',null,al.cookie);
      assert.equal(adminList.status,200);
      assert.equal(adminList.data.find(x=>x.id===medicalId).active,false);
      assert.equal((await call('/visits','POST',{...tour,clientVisitId:randomUUID()},rl.cookie)).status,403,
        'Archived target cannot be visited with a manually supplied ID');
      const originalHistory=await call('/visits','GET',null,rl.cookie);
      assert.ok(originalHistory.data.some(v=>v.id===pastTour.data.id),
        'Past tour remains accessible after target archive');
      assert.equal(await prisma.visitTarget.count({where:{[kind.fk]:medicalId}}),1,
        'Archival never removes a historical visit target');
      assert.equal((await call('/visits','POST',tour,rl.cookie)).data.duplicate,true,
        'Identical retry of historical tour remains idempotent after archiving');
      assert.equal(await prisma.auditLog.count({where:{
        companyId:ca.id,actorId:admin.id,entity:kind.type,entityId:medicalId,action:'ARCHIVE'
      }}),1);
      const restored=await call(url+'/'+medicalId+'/status','PATCH',{active:true},al.cookie);
      assert.equal(restored.status,200,JSON.stringify(restored.data));
      assert.equal(restored.data.active,true);
      assert.equal((await call(url,'GET',null,rl.cookie)).data.some(x=>x.id===medicalId),true);
      assert.equal(await prisma.auditLog.count({where:{
        companyId:ca.id,actorId:admin.id,entity:kind.type,entityId:medicalId,action:'RESTORE'
      }}),1);
      const again=await call('/visits','POST',{...tour,clientVisitId:randomUUID()},rl.cookie);
      assert.equal(again.status,201,'Restored target can be visited again');
    }
    const oldTeamManager=await prisma.user.create({data:{companyId:ca.id,
      name:'Old team manager',username:'old-mgr-'+seed,
      role:'TEAM_MANAGER',teamId:team.id,passwordHash:hashPassword(password)}});
    const oldManagerSession=await call('/login','POST',{username:oldTeamManager.username,password});
    assert.equal(oldManagerSession.status,200);
    const oldTeamHistory=await call('/visits','GET',null,oldManagerSession.cookie);
    assert.equal(oldTeamHistory.status,200);
    assert.equal(oldTeamHistory.data.find(v=>v.id===created.data.id)?.teamIdAtVisit,team.id,
      'Visit history exposes the same immutable team snapshot as visit creation');
    assert.ok(oldTeamHistory.data.some(v=>v.id===created.data.id),
      'Old team manager sees the former member historical visit');
    assert.ok(!oldTeamHistory.data.some(v=>v.id===newVisit.data.id),
      'Old team manager cannot see the moved representative new-team visits');
    const leave=await call('/leaves','POST',{type:'سنوية',fromDate:'2027-02-01',toDate:'2027-02-02'},rl.cookie);
    assert.equal(leave.status,201);
    assert.equal((await call('/leaves','GET',null,ol.cookie)).data.length,0);
    // The same representative may not create overlapping active leave requests.
    const overlapping=await call('/leaves','POST',
      {type:'سنوية',fromDate:'2027-02-02',toDate:'2027-02-04'},rl.cookie);
    assert.equal(overlapping.status,409);
    const teammateLeave=await call('/leaves','POST',
      {type:'سنوية',fromDate:'2027-03-01',toDate:'2027-03-02'},cl.cookie);
    assert.equal(teammateLeave.status,201);
    assert.equal((await call('/leaves/'+leave.data.id+'/status','PATCH',{status:'APPROVED'},al.cookie)).status,200);
    assert.equal((await call('/leaves/'+leave.data.id+'/status','PATCH',{status:'APPROVED'},al.cookie)).status,409,
      'Leave approval can only occur once');
    // Team manager can review own team leaves but not another team's.
    const manager=await prisma.user.create({data:{companyId:ca.id,name:'Team manager',
      username:'mgr-'+seed,role:'TEAM_MANAGER',teamId:rivalTeam.id,passwordHash:hashPassword(password)}});
    const ml=await call('/login','POST',{username:manager.username,password});
    assert.equal(ml.status,200);
    assert.equal((await call('/leaves/'+teammateLeave.data.id+'/status','PATCH',
      {status:'APPROVED'},ml.cookie)).status,404);
    assert.equal((await call('/settings','PATCH',{frequencyA:5},ml.cookie)).status,403,
      'Team manager cannot modify company settings');
    assert.equal((await call('/users/'+other.id,'PATCH',{active:false},al.cookie)).status,404,
      'Company administrator cannot modify users in another company');
    // Even if every representative leaves the old team, its historical doctor
    // frequency and manager's visit history must remain intact.
    const moveLast=await call('/users/'+colleague.id,'PATCH',{teamId:rivalTeam.id},al.cookie);
    assert.equal(moveLast.status,200,JSON.stringify(moveLast.data));
    const emptyTeamFrequency=await call('/analytics/frequency','GET',null,oldManagerSession.cookie);
    assert.equal(emptyTeamFrequency.status,200,JSON.stringify(emptyTeamFrequency.data));
    assert.equal(emptyTeamFrequency.data.items.find(x=>x.id===da.id).done,2,
      'Old team retains historical frequency even with no current representatives');
    const oldDashboard=await call('/dashboard','GET',null,oldManagerSession.cookie);
    assert.equal(oldDashboard.status,200);
    assert.equal(oldDashboard.data.visits,2,'Historical team dashboard counts original tours');
    const oldTeamAudit=await call('/visits','GET',null,oldManagerSession.cookie);
    assert.deepEqual(oldTeamAudit.data.map(v=>v.id).sort(),
      [created.data.id,colleagueVisit.data.id].sort(),
      'Old team sees only tours recorded while representatives belonged to it');

    const ownTeam=await call('/teams','GET',null,ml.cookie);
    assert.equal(ownTeam.status,200);
    assert.deepEqual(ownTeam.data.map(x=>x.id),[rivalTeam.id]);
    const priorChanges=await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,action:'UPDATE',entity:'USER',entityId:colleague.id
    }});
    assert.equal((await call('/users/'+colleague.id,'PATCH',{active:false},al.cookie)).status,200,
      'Company administrator can deactivate a company representative');
    assert.equal((await call('/me','GET',null,cl.cookie)).status,401,
      'Old session becomes invalid when representative is deactivated');
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,action:'UPDATE',entity:'USER',entityId:colleague.id
    }}),priorChanges+1,'Disabling an account creates exactly one additional audit entry');
    // Partial PATCH must validate the effective saved visit-cycle interval.
    const cycleSet=await call('/settings','PATCH',
      {cycleStart:'2026-10-01',cycleEnd:'2026-11-30'},al.cookie);
    assert.equal(cycleSet.status,200,JSON.stringify(cycleSet.data));
    const auditCount=await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,action:'UPDATE',entity:'SETTINGS'
    }});
    const invalidEnd=await call('/settings','PATCH',{cycleEnd:'2026-09-30'},al.cookie);
    assert.equal(invalidEnd.status,400,'A partial end-date update must check the saved start date');
    const invalidStart=await call('/settings','PATCH',{cycleStart:'2026-12-01'},al.cookie);
    assert.equal(invalidStart.status,400,'A partial start-date update must check the saved end date');
    const cycleAfter=await call('/settings','GET',null,al.cookie);
    assert.equal(cycleAfter.status,200);
    assert.equal(cycleAfter.data.cycleStart.slice(0,10),'2026-10-01');
    assert.equal(cycleAfter.data.cycleEnd.slice(0,10),'2026-11-30');
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,action:'UPDATE',entity:'SETTINGS'
    }}),auditCount,'Invalid partial settings edits must not create audit events');
    const validPartial=await call('/settings','PATCH',{cycleStart:'2026-10-15'},al.cookie);
    assert.equal(validPartial.status,200,JSON.stringify(validPartial.data));
    assert.equal(validPartial.data.cycleEnd.slice(0,10),'2026-11-30');
    // Global super admin provisions companies/admins; company staff cannot use these endpoints.
    const root=await prisma.user.create({data:{name:'Global admin',username:'root-'+seed,
      role:'SUPER_ADMIN',passwordHash:hashPassword(password)}});
    globalAdminIds.push(root.id);
    const gl=await call('/login','POST',{username:root.username,password});
    assert.equal(gl.status,200);
    assert.equal((await call('/companies','GET',null,al.cookie)).status,403);
    const companyCreated=await call('/companies','POST',{name:'Provisioned '+seed},gl.cookie);
    assert.equal(companyCreated.status,201,JSON.stringify(companyCreated.data));
    companyIds.push(companyCreated.data.id);
    const provisioned=await call('/companies/'+companyCreated.data.id+'/admins','POST',{
      username:'new-admin-'+seed,name:'New admin',password
    },gl.cookie);
    assert.equal(provisioned.status,201,JSON.stringify(provisioned.data));
    assert.equal(provisioned.data.user.companyId,companyCreated.data.id);
    assert.equal(await prisma.auditLog.count({where:{actorId:root.id,
      entity:'COMPANY',entityId:companyCreated.data.id}}),1);
    assert.equal(await prisma.auditLog.count({where:{actorId:root.id,
      entity:'USER',entityId:provisioned.data.user.id}}),1);
    assert.equal((await call('/logout','POST',{},rl.cookie)).status,200);
    assert.equal((await call('/me','GET',null,rl.cookie)).status,401);
  } finally {
    const companies={in:companyIds};
    await prisma.authSession.deleteMany({where:{userId:{in:globalAdminIds}}});
    await prisma.auditLog.deleteMany({where:{actorId:{in:globalAdminIds}}});
    await prisma.authSession.deleteMany({where:{user:{companyId:companies}}});
    await prisma.auditLog.deleteMany({where:{companyId:companies}});
    await prisma.leaveRequest.deleteMany({where:{companyId:companies}});
    await prisma.visitTarget.deleteMany({where:{visit:{companyId:companies}}});
    await prisma.visit.deleteMany({where:{companyId:companies}});
    await prisma.repArea.deleteMany({where:{rep:{companyId:companies}}});
    await prisma.user.deleteMany({where:{companyId:companies}});
    await prisma.doctor.deleteMany({where:{companyId:companies}});
    await prisma.pharmacy.deleteMany({where:{companyId:companies}});
    await prisma.hospital.deleteMany({where:{companyId:companies}});
    await prisma.product.deleteMany({where:{companyId:companies}});
    await prisma.area.deleteMany({where:{companyId:companies}});
    await prisma.team.deleteMany({where:{companyId:companies}});
    await prisma.company.deleteMany({where:{id:companies}});
    await prisma.user.deleteMany({where:{id:{in:globalAdminIds}}});
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
