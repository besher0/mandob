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
    await prisma.repArea.create({data:{repId:rep.id,areaId:aa.id}});
    const da=await prisma.doctor.create({data:{companyId:ca.id,areaId:aa.id,name:'Doctor A',specialty:'Cardiology'}});
    const db=await prisma.doctor.create({data:{companyId:cb.id,areaId:ab.id,name:'Doctor B',specialty:'Cardiology'}});
    assert.equal((await call('/visits')).status,401);
    assert.equal((await call('/login','POST',{username:rep.username,password:'wrong'})).status,401);
    const rl=await call('/login','POST',{username:rep.username,password});
    const al=await call('/login','POST',{username:admin.username,password});
    const ol=await call('/login','POST',{username:other.username,password});
    assert.equal(rl.status,200);
    assert.equal(al.status,200);
    assert.equal(ol.status,200);
    assert.equal((await call('/users','GET',null,rl.cookie)).status,403);
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
    assert.equal((await call('/logout','POST',{},rl.cookie)).status,200);
    assert.equal((await call('/me','GET',null,rl.cookie)).status,401);
  } finally {
    const companies={in:companyIds};
    await prisma.authSession.deleteMany({where:{user:{companyId:companies}}});
    await prisma.auditLog.deleteMany({where:{companyId:companies}});
    await prisma.leaveRequest.deleteMany({where:{companyId:companies}});
    await prisma.visitTarget.deleteMany({where:{visit:{companyId:companies}}});
    await prisma.visit.deleteMany({where:{companyId:companies}});
    await prisma.repArea.deleteMany({where:{rep:{companyId:companies}}});
    await prisma.user.deleteMany({where:{companyId:companies}});
    await prisma.doctor.deleteMany({where:{companyId:companies}});
    await prisma.area.deleteMany({where:{companyId:companies}});
    await prisma.team.deleteMany({where:{companyId:companies}});
    await prisma.company.deleteMany({where:{id:companies}});
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
