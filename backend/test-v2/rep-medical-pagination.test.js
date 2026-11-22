'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('representative doctor pages preserve specialty, area and tenant scoping',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const suffix=randomUUID().slice(0,8);
  const password='DirectoryPage!2026';
  const companyIds=[];
  async function call(path,cookie,method='GET',body){
    const response=await fetch(base+'/api'+path,{
      method,
      headers:{...(cookie?{Cookie:cookie}:{}),
        ...(method!=='GET'?{Origin:'http://localhost:5173',
          'Content-Type':'application/json'}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    return {status:response.status,data:await response.json().catch(()=>({})),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const company=await prisma.company.create({data:{name:'Paging '+suffix}});
    const foreign=await prisma.company.create({data:{name:'Paging Foreign '+suffix}});
    companyIds.push(company.id,foreign.id);
    const team=await prisma.team.create({data:{companyId:company.id,
      name:'Paging team '+suffix,specialties:{create:{specialty:'Cardiology'}}}});
    const [permitted,notAssigned,foreignArea]=await Promise.all([
      prisma.area.create({data:{companyId:company.id,name:'Assigned '+suffix}}),
      prisma.area.create({data:{companyId:company.id,name:'Unassigned '+suffix}}),
      prisma.area.create({data:{companyId:foreign.id,name:'Foreign '+suffix}})
    ]);
    const rep=await prisma.user.create({data:{companyId:company.id,teamId:team.id,
      name:'Paging representative',role:'REP',username:'page-rep-'+suffix,
      passwordHash:hashPassword(password)}});
    const other=await prisma.user.create({data:{companyId:foreign.id,
      name:'Foreign representative',role:'REP',username:'foreign-rep-'+suffix,
      passwordHash:hashPassword(password)}});
    await prisma.repArea.create({data:{repId:rep.id,areaId:permitted.id}});
    await prisma.doctor.createMany({data:[
      {companyId:company.id,areaId:permitted.id,name:'A Doctor '+suffix,
        specialty:'Cardiology',grade:'A'},
      {companyId:company.id,areaId:permitted.id,name:'B Doctor '+suffix,
        specialty:'Cardiology',grade:'B'},
      {companyId:company.id,areaId:permitted.id,name:'C Out of specialty '+suffix,
        specialty:'Dermatology',grade:'C'},
      {companyId:company.id,areaId:notAssigned.id,name:'D Out of area '+suffix,
        specialty:'Cardiology',grade:'A'},
      {companyId:foreign.id,areaId:foreignArea.id,name:'E Foreign '+suffix,
        specialty:'Cardiology',grade:'A'}
    ]});
    const login=await call('/login',null,'POST',{username:rep.username,password});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const session=login.cookie;
    const path='/reps/'+rep.id+'/doctors';
    const unpaged=await call(path,session);
    assert.equal(unpaged.status,200,JSON.stringify(unpaged));
    assert.equal(unpaged.data.length,2);
    const first=await call(path+'?limit=1&offset=0',session);
    const second=await call(path+'?limit=1&offset=1',session);
    const third=await call(path+'?limit=1&offset=2',session);
    assert.equal(first.status,200);
    assert.equal(second.status,200);
    assert.equal(third.status,200);
    assert.deepEqual([...first.data,...second.data].map(row=>row.id),
      unpaged.data.map(row=>row.id));
    assert.deepEqual(third.data,[]);
    // General directory, dashboard, report denominator and visit eligibility
    // must all use the very same TEAM/CUSTOM specialty restrictions.
    const general=await call('/doctors?limit=500&offset=0',session);
    assert.equal(general.status,200,JSON.stringify(general.data));
    assert.deepEqual(general.data.map(row=>row.id),unpaged.data.map(row=>row.id));
    const initialDashboard=await call('/dashboard',session);
    const initialWorkspace=await call('/rep-workspace-summary',session);
    assert.equal(initialDashboard.status,200);
    assert.equal(initialWorkspace.status,200);
    assert.equal(initialDashboard.data.doctors,2);
    assert.equal(initialWorkspace.data.doctors.total,2);
    await prisma.user.update({where:{id:rep.id},data:{
      specialtyMode:'CUSTOM',repSpecialties:{create:[{specialty:'Dermatology'}]}
    }});
    const changed=await call('/doctors',session);
    assert.equal(changed.status,200,JSON.stringify(changed.data));
    assert.equal(changed.data.length,1);
    assert.equal(changed.data[0].specialty,'Dermatology');
    assert.equal((await call(path+'?limit=500&offset=0',session)).data.length,1);
    assert.equal((await call('/dashboard',session)).data.doctors,1);
    assert.equal((await call('/rep-workspace-summary',session)).data.doctors.total,1);
    for(const invalid of ['limit=0','limit=501','offset=-1','offset=abc']){
      const response=await call(path+'?'+invalid,session);
      assert.equal(response.status,400,invalid);
    }
    assert.equal((await call('/reps/'+other.id+'/doctors?limit=1',session)).status,404,
      'Foreign representative must not be discoverable through pagination');
    assert.equal((await call(path+'?limit=1')).status,401,
      'Unauthenticated pagination must not leak doctor data');
  }finally{
    if(companyIds.length){
      const scope={in:companyIds};
      await prisma.authSession.deleteMany({where:{user:{companyId:scope}}});
      await prisma.auditLog.deleteMany({where:{companyId:scope}});
      await prisma.repArea.deleteMany({where:{rep:{companyId:scope}}});
      await prisma.doctorArea.deleteMany({where:{doctor:{companyId:scope}}});
      await prisma.doctor.deleteMany({where:{companyId:scope}});
      await prisma.user.deleteMany({where:{companyId:scope}});
      await prisma.team.deleteMany({where:{companyId:scope}});
      await prisma.area.deleteMany({where:{companyId:scope}});
      await prisma.company.deleteMany({where:{id:scope}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
