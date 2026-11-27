'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('company cycle directory lists real cycles and isolates tenant history',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const seed=randomUUID().slice(0,8),password='CycleHistoryTest!2026';
  let companyA=null,companyB=null;
  async function call(path,method='GET',body=null,cookie=null){
    const resp=await fetch(base+'/api'+path,{method,headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(method!=='GET'?{Origin:'http://localhost:5173','Content-Type':'application/json'}:{})},
      body:method==='GET'?undefined:JSON.stringify(body??{})});
    return {status:resp.status,data:await resp.json(),
      cookie:resp.headers.get('set-cookie')?.split(';')[0]};
  }
  const day=date=>new Date(date+'T00:00:00.000Z');
  try{
    const a=await prisma.company.create({data:{name:'Cycle-A-'+seed,
      settings:{create:{cycleStart:day('2026-11-01'),cycleEnd:day('2026-11-30')}}}});
    const b=await prisma.company.create({data:{name:'Cycle-B-'+seed,
      settings:{create:{cycleStart:day('2026-10-01'),cycleEnd:day('2026-10-31')}}}});
    companyA=a.id;companyB=b.id;
    await prisma.cycle.createMany({data:[
      {companyId:a.id,startDate:day('2026-10-01'),endDate:day('2026-10-31')},
      {companyId:b.id,startDate:day('2026-10-01'),endDate:day('2026-10-31')}
    ]});
    const users={};
    for(const [role,company] of [['admin',a],['rep',a],['foreign',b]]){
      users[role]=await prisma.user.create({data:{companyId:company.id,
        name:'Cycle '+role,username:'cycle-'+role+'-'+seed,
        role:role==='rep'?'REP':'COMPANY_ADMIN',passwordHash:hashPassword(password)}});
    }
    const auth={};
    for(const [role,user] of Object.entries(users)){
      const login=await call('/login','POST',{username:user.username,password});
      assert.equal(login.status,200);auth[role]=login.cookie;
    }
    assert.equal((await call('/company/cycles')).status,401);
    assert.equal((await call('/company/cycles','GET',null,auth.rep)).status,403);
    const first=await call('/company/cycles','GET',null,auth.admin);
    assert.equal(first.status,200,JSON.stringify(first.data));
    assert.equal(first.data.items.length,2);
    assert.equal(first.data.items[0].source,'SETTINGS');
    assert.equal(first.data.items[0].current,true);
    assert.equal(first.data.items[0].startDate,'2026-11-01');
    assert.equal(first.data.items[1].startDate,'2026-10-01');
    assert.equal(first.data.hasMore,false);
    assert.equal((await call('/company/cycles?limit=101','GET',null,auth.admin)).status,400);
    const foreign=await call('/company/cycles','GET',null,auth.foreign);
    assert.equal(foreign.status,200);
    assert.ok(foreign.data.items.every(x=>x.startDate!=='2026-11-01'));
    await prisma.cycle.create({data:{companyId:a.id,
      startDate:day('2026-11-01'),endDate:day('2026-11-30')}});
    const current=await call('/company/cycles','GET',null,auth.admin);
    assert.equal(current.status,200);
    assert.equal(current.data.items.length,2);
    assert.equal(current.data.items.filter(x=>x.current).length,1);
    assert.equal(current.data.items[0].source,undefined);
  }finally{
    for(const id of [companyA,companyB].filter(Boolean)){
      await prisma.authSession.deleteMany({where:{user:{companyId:id}}});
      await prisma.auditLog.deleteMany({where:{companyId:id}});
      await prisma.user.deleteMany({where:{companyId:id}});
      await prisma.company.delete({where:{id}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
