'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('keyset report history reaches old snapshots without leaking other teams or tenants',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const salt=randomUUID().slice(0,8),password='ReportHistory!2026';
  const companies=[];
  async function call(path,cookie){
    const response=await fetch(base+'/api'+path,{
      headers:cookie?{Cookie:cookie}:{}
    });
    return {status:response.status,data:await response.json().catch(()=>({}))};
  }
  try{
    const company=await prisma.company.create({data:{name:'Reports paging '+salt}});
    const foreign=await prisma.company.create({data:{name:'Reports foreign '+salt}});
    companies.push(company.id,foreign.id);
    const team=await prisma.team.create({data:{companyId:company.id,name:'Primary '+salt}});
    const team2=await prisma.team.create({data:{companyId:company.id,name:'Secondary '+salt}});
    const hashed=hashPassword(password);
    const admin=await prisma.user.create({data:{
      companyId:company.id,name:'Director',username:'rpt-admin-'+salt,
      role:'COMPANY_ADMIN',passwordHash:hashed}});
    const manager=await prisma.user.create({data:{
      companyId:company.id,name:'Manager',username:'rpt-manager-'+salt,
      role:'TEAM_MANAGER',teamId:team.id,passwordHash:hashed,
      managedTeams:{create:[{teamId:team.id}]}}});
    const rep=await prisma.user.create({data:{
      companyId:company.id,name:'Representative',username:'rpt-rep-'+salt,
      role:'REP',teamId:team.id,passwordHash:hashed}});
    const secondRep=await prisma.user.create({data:{
      companyId:company.id,name:'Other rep',username:'rpt-other-'+salt,
      role:'REP',teamId:team2.id,passwordHash:hashed}});
    const outside=await prisma.user.create({data:{
      companyId:foreign.id,name:'Foreign rep',username:'rpt-foreign-'+salt,
      role:'REP',passwordHash:hashed}});
    const date=new Date('2026-11-01T00:00:00.000Z');
    const timestamp=new Date('2026-11-10T12:00:00.000Z');
    const rows=Array.from({length:55},(_,index)=>({
      id:randomUUID(),companyId:company.id,repId:rep.id,
      teamIdAtSubmission:team.id,fromDate:date,toDate:date,
      createdAt:timestamp,snapshot:{totalTargets:index+1,tours:index%4}
    }));
    const foreignId=randomUUID(),otherTeamId=randomUUID();
    await prisma.repReportSubmission.createMany({data:[
      ...rows,
      {id:foreignId,companyId:foreign.id,repId:outside.id,
        teamIdAtSubmission:null,fromDate:date,toDate:date,
        createdAt:timestamp,snapshot:{totalTargets:999,tours:9}},
      {id:otherTeamId,companyId:company.id,repId:secondRep.id,
        teamIdAtSubmission:team2.id,fromDate:date,toDate:date,
        createdAt:timestamp,snapshot:{totalTargets:888,tours:8}}
    ]});
    const sessions={};
    for(const [name,user] of Object.entries({admin,manager,rep})){
      const response=await fetch(base+'/api/login',{method:'POST',
        headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},
        body:JSON.stringify({username:user.username,password})});
      assert.equal(response.status,200,name+' login');
      sessions[name]=response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(sessions[name],name+' session');
    }
    const expected=(await prisma.repReportSubmission.findMany({
      where:{companyId:company.id,repId:rep.id},
      orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true}
    })).map(x=>x.id);
    const legacy=await call('/rep-reports',sessions.rep);
    assert.equal(legacy.status,200);
    assert.ok(Array.isArray(legacy.data),'legacy callers still get a flat array');
    assert.deepEqual(legacy.data.map(row=>row.id),expected.slice(0,50));
    const first=await call('/rep-reports?paginated=true',sessions.rep);
    assert.equal(first.status,200);
    assert.deepEqual(first.data.items.map(row=>row.id),expected.slice(0,50));
    assert.equal(first.data.nextCursor,expected[49]);
    assert.equal(first.data.items[0].totalTargets,
      rows.find(row=>row.id===expected[0]).snapshot.totalTargets);
    // A concurrent append must not change the subsequent cursor position.
    await prisma.repReportSubmission.create({data:{
      companyId:company.id,repId:rep.id,teamIdAtSubmission:team.id,
      fromDate:date,toDate:date,createdAt:new Date('2026-11-20T12:00:00Z'),
      snapshot:{totalTargets:500,tours:1}
    }});
    const second=await call('/rep-reports?paginated=true&cursor='+first.data.nextCursor,sessions.rep);
    assert.equal(second.status,200);
    assert.deepEqual(second.data.items.map(row=>row.id),expected.slice(50));
    assert.equal(second.data.nextCursor,null);
    const all=[...first.data.items,...second.data.items].map(x=>x.id);
    assert.equal(new Set(all).size,55,'concurrent inserts cannot duplicate or skip old snapshots');
    assert.equal((await call('/rep-reports?paginated=true&cursor='+foreignId,sessions.rep)).status,404);
    assert.equal((await call('/rep-reports?paginated=true&cursor='+otherTeamId,sessions.rep)).status,404);
    assert.equal((await call('/rep-reports?paginated=true&cursor=bad',sessions.rep)).status,400);
    assert.equal((await call('/rep-reports?paginated=true&limit=51',sessions.rep)).status,400);
    assert.equal((await call('/rep-reports?paginated=no',sessions.rep)).status,400);
    const managerList=await call('/rep-reports?paginated=true',sessions.manager);
    assert.equal(managerList.status,200);
    assert.equal(managerList.data.items.length,50);
    assert.ok(managerList.data.items.every(row=>row.teamIdAtSubmission===team.id));
    assert.equal((await call('/rep-reports?paginated=true&cursor='+otherTeamId,
      sessions.manager)).status,404);
    const adminList=await call('/rep-reports?paginated=true',sessions.admin);
    assert.equal(adminList.status,200);
    assert.equal(adminList.data.items.length,50);
    assert.equal((await call('/rep-reports?paginated=true&cursor='+foreignId,
      sessions.admin)).status,404);
    assert.equal((await call('/rep-reports?paginated=true&limit=1',
      sessions.admin)).data.items.length,1);
  }finally{
    if(companies.length){
      await prisma.authSession.deleteMany({where:{user:{companyId:{in:companies}}}});
      await prisma.repReportSubmission.deleteMany({where:{companyId:{in:companies}}});
      await prisma.auditLog.deleteMany({where:{companyId:{in:companies}}});
      await prisma.user.deleteMany({where:{companyId:{in:companies}}});
      await prisma.team.deleteMany({where:{companyId:{in:companies}}});
      await prisma.company.deleteMany({where:{id:{in:companies}}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
