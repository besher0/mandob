'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('company-assigned multi-team manager is isolated on every request', {
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const suffix=randomUUID().slice(0,8),password='ManagerScopeTest!2026';
  const companies=[];
  async function call(path,method='GET',body,session){
    const response=await fetch(base+'/api'+path,{method,headers:{
      ...(body!==undefined?{'Content-Type':'application/json'}:{}),
      ...(session?{Cookie:session}:{}),
      ...(method!=='GET'?{Origin:'http://localhost:5173'}:{})
    },body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    return {status:response.status,data,
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const ca=await prisma.company.create({data:{name:'Manager scope A '+suffix}});
    const cb=await prisma.company.create({data:{name:'Manager scope B '+suffix}});
    companies.push(ca.id,cb.id);
    const t1=await prisma.team.create({data:{companyId:ca.id,name:'RX1 '+suffix}});
    const t2=await prisma.team.create({data:{companyId:ca.id,name:'RX2 '+suffix}});
    const foreign=await prisma.team.create({data:{companyId:cb.id,name:'Foreign '+suffix}});
    const admin=await prisma.user.create({data:{companyId:ca.id,name:'Admin',username:'s-admin-'+suffix,
      passwordHash:hashPassword(password),role:'COMPANY_ADMIN'}});
    const manager=await prisma.user.create({data:{companyId:ca.id,name:'Manager',username:'s-manager-'+suffix,
      passwordHash:hashPassword(password),role:'TEAM_MANAGER',teamId:t1.id,
      managedTeams:{create:[{teamId:t1.id}]}}});
    const rep1=await prisma.user.create({data:{companyId:ca.id,name:'First rep',
      username:'s-rep1-'+suffix,passwordHash:hashPassword(password),role:'REP',teamId:t1.id}});
    const rep2=await prisma.user.create({data:{companyId:ca.id,name:'Second rep',
      username:'s-rep2-'+suffix,passwordHash:hashPassword(password),role:'REP',teamId:t2.id}});
    const a1=await prisma.area.create({data:{companyId:ca.id,name:'First area '+suffix,city:'حلب'}});
    const a2=await prisma.area.create({data:{companyId:ca.id,name:'Second area '+suffix,city:'دمشق'}});
    const d1=await prisma.doctor.create({data:{companyId:ca.id,areaId:a1.id,
      name:'First doctor '+suffix,specialty:'قلبية',grade:'A'}});
    const d2=await prisma.doctor.create({data:{companyId:ca.id,areaId:a2.id,
      name:'Second doctor '+suffix,specialty:'قلبية',grade:'A'}});
    await prisma.repArea.createMany({data:[
      {repId:rep1.id,areaId:a1.id},{repId:rep2.id,areaId:a2.id}]});
    const makeVisit=(rep,teamId,doctorId,areaId)=>prisma.visit.create({data:{
      companyId:ca.id,repId:rep.id,teamIdAtVisit:teamId,clientVisitId:randomUUID(),
      type:'DOCTOR',visitDate:new Date('2026-11-20T00:00:00.000Z'),
      latitude:36.2,longitude:37.1,locationAccuracy:15,
      locationCapturedAt:new Date('2026-11-20T12:00:00.000Z'),
      targets:{create:{doctorId,areaIdAtVisit:areaId}}
    }});
    await makeVisit(rep1,t1.id,d1.id,a1.id);
    await makeVisit(rep2,t2.id,d2.id);
    const al=await call('/login','POST',{username:admin.username,password});
    const ml=await call('/login','POST',{username:manager.username,password});
    assert.equal(al.status,200);assert.equal(ml.status,200);
    const before=await call('/users','GET',undefined,ml.cookie);
    assert.equal(before.status,200);
    assert.deepEqual(before.data.filter(row=>row.role==='REP').map(row=>row.id),[rep1.id]);
    assert.equal((await call('/manager/active-team','POST',{teamId:t2.id},ml.cookie)).status,403);
    const foreignAttempt=await call('/users/'+manager.id+'/manager-teams','PATCH',{
      teamIds:[t1.id,foreign.id]},al.cookie);
    assert.equal(foreignAttempt.status,403);
    assert.equal(await prisma.managerTeamAssignment.count({where:{managerId:manager.id}}),1);
    const assigned=await call('/users/'+manager.id+'/manager-teams','PATCH',{
      teamIds:[t1.id,t2.id]},al.cookie);
    assert.equal(assigned.status,200);
    const list=await call('/manager/assigned-teams','GET',undefined,ml.cookie);
    assert.equal(list.status,200);
    assert.deepEqual(list.data.teams.map(team=>team.id).sort(),[t1.id,t2.id].sort());
    const byTeam=new Map(list.data.teams.map(team=>[team.id,team]));
    assert.deepEqual(byTeam.get(t1.id).provinceNames,['حلب']);
    assert.deepEqual(byTeam.get(t2.id).provinceNames,['دمشق']);
    assert.deepEqual([byTeam.get(t1.id).coverage,byTeam.get(t2.id).coverage],[25,25]);
    assert.deepEqual([byTeam.get(t1.id).coverageTarget,byTeam.get(t2.id).coverageTarget],[4,4]);
    assert.deepEqual([byTeam.get(t1.id).coverageDone,byTeam.get(t2.id).coverageDone],[1,1]);
    assert.ok(byTeam.get(t2.id).areas.some(area=>area.id===a2.id));
    const createPayload={name:'Transfer test',username:'s-transfer-'+suffix,password,teamId:t2.id,areaIds:[a2.id]};
    assert.equal((await call('/manager/reps','POST',{...createPayload,teamId:foreign.id},ml.cookie)).status,403);
    const created=await call('/manager/reps','POST',createPayload,ml.cookie);
    assert.equal(created.status,201);
    assert.equal(created.data.user.teamId,t2.id);
    assert.equal((await call('/manager/reps/'+rep1.id,'PATCH',{teamId:foreign.id},ml.cookie)).status,403);
    assert.equal((await call('/manager/reps/'+rep1.id,'PATCH',{teamId:t2.id,areaIds:[a1.id,a2.id]},ml.cookie)).status,200);
    assert.equal((await prisma.user.findUnique({where:{id:rep1.id}})).teamId,t2.id);
    assert.equal((await prisma.visit.findFirst({where:{repId:rep1.id}})).teamIdAtVisit,t1.id);
    assert.equal((await call('/manager/active-team','POST',{teamId:t2.id},ml.cookie)).status,200);
    assert.equal((await call('/manager/reps/'+rep1.id,'PATCH',{teamId:t1.id,areaIds:[a1.id]},ml.cookie)).status,200);
    await prisma.repArea.deleteMany({where:{repId:created.data.user.id}});
    await prisma.auditLog.deleteMany({where:{entityId:created.data.user.id}});
    await prisma.user.delete({where:{id:created.data.user.id}});
    assert.equal((await call('/manager/active-team','POST',{teamId:t1.id},ml.cookie)).status,200);
    const activeFrequency=await call('/analytics/frequency','GET',undefined,ml.cookie);
    assert.equal(activeFrequency.status,200);
    assert.ok(activeFrequency.data.items.every(item=>item.teamId===t1.id),
      'Public frequency remains active-team-only');
    assert.equal((await call('/manager/active-team','POST',{teamId:t2.id},ml.cookie)).status,200);
    const second=await call('/users','GET',undefined,ml.cookie);
    assert.deepEqual(second.data.filter(row=>row.role==='REP').map(row=>row.id),[rep2.id]);
    const visits=await call('/visits','GET',undefined,ml.cookie);
    assert.equal(visits.status,200);
    assert.ok(visits.data.some(row=>row.teamIdAtVisit===t2.id));
    assert.ok(visits.data.every(row=>row.teamIdAtVisit===t2.id));
    assert.equal((await call('/manager/active-team','POST',{teamId:foreign.id},ml.cookie)).status,403);
    assert.equal((await call('/users/'+manager.id+'/manager-teams','PATCH',{
      teamIds:[t1.id]},al.cookie)).status,200);
    const after=await call('/manager/assigned-teams','GET',undefined,ml.cookie);
    assert.deepEqual(after.data.teams.map(team=>team.id),[t1.id]);
    assert.equal(after.data.teams[0].coverage,25);
    assert.deepEqual(after.data.teams[0].provinceNames,['حلب']);
    assert.equal(after.data.activeTeamId,t1.id);
    assert.deepEqual((await call('/users','GET',undefined,ml.cookie)).data
      .filter(row=>row.role==='REP').map(row=>row.id),[rep1.id]);
    const snapshot=await prisma.visit.findFirst({where:{repId:rep2.id}});
    assert.equal(snapshot.teamIdAtVisit,t2.id,'revoking manager access never rewrites historical attribution');
    assert.ok(await prisma.auditLog.count({where:{
      actorId:admin.id,entity:'MANAGER_TEAMS',action:'UPDATE'}})>=2);
  }finally{
    if(companies.length){
      await prisma.authSession.deleteMany({where:{user:{companyId:{in:companies}}}});
      await prisma.visitTarget.deleteMany({where:{visit:{companyId:{in:companies}}}});
      await prisma.visit.deleteMany({where:{companyId:{in:companies}}});
      await prisma.auditLog.deleteMany({where:{companyId:{in:companies}}});
      await prisma.repArea.deleteMany({where:{rep:{companyId:{in:companies}}}});
      await prisma.doctor.deleteMany({where:{companyId:{in:companies}}});
      await prisma.area.deleteMany({where:{companyId:{in:companies}}});
      await prisma.user.deleteMany({where:{companyId:{in:companies}}});
      await prisma.team.deleteMany({where:{companyId:{in:companies}}});
      await prisma.company.deleteMany({where:{id:{in:companies}}});
    }
    await new Promise(resolve=>server.close(resolve));
  }
});
