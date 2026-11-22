'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('company replaces one manager per team without deleting unrelated assignments',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const suffix=randomUUID().slice(0,8),password='V2ManagerSwap!2026';
  const companies=[];
  async function call(path,method='GET',body,cookie){
    const response=await fetch(base+'/api'+path,{method,
      headers:{...(cookie?{Cookie:cookie}:{}),
        ...(method!=='GET'?{Origin:'http://localhost:5173',
          'Content-Type':'application/json'}:{})},
      body:method==='GET'?undefined:JSON.stringify(body??{})
    });
    return {status:response.status,data:await response.json().catch(()=>({})),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const ca=await prisma.company.create({data:{name:'Manager swap '+suffix}});
    const cb=await prisma.company.create({data:{name:'Foreign swap '+suffix}});
    companies.push(ca.id,cb.id);
    const t1=await prisma.team.create({data:{companyId:ca.id,name:'T1 '+suffix}});
    const t2=await prisma.team.create({data:{companyId:ca.id,name:'T2 '+suffix}});
    const foreignTeam=await prisma.team.create({data:{companyId:cb.id,name:'Foreign '+suffix}});
    const admin=await prisma.user.create({data:{companyId:ca.id,name:'Director',
      username:'swap-admin-'+suffix,role:'COMPANY_ADMIN',
      passwordHash:hashPassword(password)}});
    const managerA=await prisma.user.create({data:{companyId:ca.id,
      name:'Manager A',username:'swap-a-'+suffix,role:'TEAM_MANAGER',
      passwordHash:hashPassword(password),teamId:t1.id,
      managedTeams:{create:[{teamId:t1.id},{teamId:t2.id}]}}});
    const managerB=await prisma.user.create({data:{companyId:ca.id,
      name:'Manager B',username:'swap-b-'+suffix,role:'TEAM_MANAGER',
      passwordHash:hashPassword(password)}});
    const foreign=await prisma.user.create({data:{companyId:cb.id,
      name:'Foreign Manager',username:'swap-foreign-'+suffix,role:'TEAM_MANAGER',
      passwordHash:hashPassword(password),teamId:foreignTeam.id,
      managedTeams:{create:[{teamId:foreignTeam.id}]}}});
    const cookies={};
    for(const [name,user] of Object.entries({admin,managerA,managerB})){
      const login=await call('/login','POST',{username:user.username,password});
      assert.equal(login.status,200,name+JSON.stringify(login.data));
      cookies[name]=login.cookie;
    }
    assert.equal((await call('/manager/active-team','POST',{teamId:t1.id},
      cookies.managerA)).status,200);
    const initial=await call('/teams/'+t1.id+'/manager','PATCH',{
      managerId:managerB.id,expectedManagerIds:[managerA.id]},cookies.admin);
    assert.equal(initial.status,200,JSON.stringify(initial));
    assert.deepEqual(initial.data.previousManagerIds,[managerA.id]);
    assert.equal(initial.data.managerId,managerB.id);
    const assignments=await prisma.managerTeamAssignment.findMany({
      where:{managerId:{in:[managerA.id,managerB.id]}},
      select:{managerId:true,teamId:true}
    });
    assert.deepEqual(assignments.filter(x=>x.managerId===managerA.id).map(x=>x.teamId),[t2.id]);
    assert.deepEqual(assignments.filter(x=>x.managerId===managerB.id).map(x=>x.teamId),[t1.id]);
    const a=await prisma.user.findUnique({where:{id:managerA.id}});
    const b=await prisma.user.findUnique({where:{id:managerB.id}});
    assert.equal(a.teamId,t2.id,'old manager retains remaining team as primary');
    assert.equal(b.teamId,t1.id,'new manager gets team access without changing other users');
    const oldSession=await call('/manager/assigned-teams','GET',undefined,cookies.managerA);
    assert.equal(oldSession.status,200);
    assert.deepEqual(oldSession.data.teams.map(t=>t.id),[t2.id]);
    assert.equal(oldSession.data.activeTeamId,t2.id);
    assert.equal((await call('/manager/active-team','POST',{teamId:t1.id},
      cookies.managerA)).status,403);
    const auditsBeforeConflict=await prisma.auditLog.count({where:{
      actorId:admin.id,entity:'TEAM_MANAGER_ASSIGNMENT',action:'UPDATE'}});
    assert.equal((await call('/teams/'+t1.id+'/manager','PATCH',{
      managerId:managerA.id,expectedManagerIds:[managerA.id]},cookies.admin)).status,409,
      'a stale company form cannot overwrite the manager selected by another admin');
    assert.equal(await prisma.auditLog.count({where:{
      actorId:admin.id,entity:'TEAM_MANAGER_ASSIGNMENT',action:'UPDATE'}}),
      auditsBeforeConflict,'rejected stale writes must not record a successful assignment audit');
    assert.equal((await call('/teams/'+t1.id+'/manager','PATCH',{
      managerId:foreign.id,expectedManagerIds:[managerB.id]},cookies.admin)).status,404);
    assert.equal((await call('/teams/'+t1.id+'/manager','PATCH',{
      managerId:managerA.id,expectedManagerIds:[managerB.id]},cookies.managerA)).status,403);
    assert.equal((await call('/teams/'+t1.id+'/manager','PATCH',{
      managerId:managerA.id},cookies.admin)).status,400);
    const second=await call('/teams/'+t2.id+'/manager','PATCH',{
      managerId:managerB.id,expectedManagerIds:[managerA.id]},cookies.admin);
    assert.equal(second.status,200,JSON.stringify(second));
    const noTeams=await call('/manager/assigned-teams','GET',undefined,cookies.managerA);
    assert.deepEqual(noTeams.data.teams,[]);
    assert.equal(noTeams.data.activeTeamId,null);
    assert.equal((await prisma.user.findUnique({where:{id:managerA.id}})).teamId,null,
      'revoking the final assignment must also clear legacy primary-team fallback');
    const bTeams=await call('/manager/assigned-teams','GET',undefined,cookies.managerB);
    assert.deepEqual(bTeams.data.teams.map(t=>t.id).sort(),[t1.id,t2.id].sort());
    const repeat=await call('/teams/'+t2.id+'/manager','PATCH',{
      managerId:managerB.id,expectedManagerIds:[managerB.id]},cookies.admin);
    assert.equal(repeat.status,200,'same-manager save is idempotent');
    assert.equal(await prisma.managerTeamAssignment.count({where:{teamId:t2.id}}),1);
    assert.ok((await prisma.auditLog.count({where:{
      actorId:admin.id,entity:'TEAM_MANAGER_ASSIGNMENT',action:'UPDATE'}}))>=2);
  }finally{
    if(companies.length){
      await prisma.authSession.deleteMany({where:{user:{companyId:{in:companies}}}});
      await prisma.auditLog.deleteMany({where:{companyId:{in:companies}}});
      await prisma.user.deleteMany({where:{companyId:{in:companies}}});
      await prisma.team.deleteMany({where:{companyId:{in:companies}}});
      await prisma.company.deleteMany({where:{id:{in:companies}}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
