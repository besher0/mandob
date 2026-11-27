'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

// Real DB regression: custody, cross-role transfer policy, and idempotent visit deductions.
test('sample stock transfers and tour consumption stay transactional',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const token=randomUUID().slice(0,8),password='StockIntegrationPassword!2026';
  let companyId=null;
  const call=async(path,method='GET',body=null,cookie=null)=>{
    const res=await fetch(base+'/api'+path,{method,headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(method!=='GET'?{'Content-Type':'application/json',Origin:'http://localhost:5173'}:{})},
      body:method==='GET'?undefined:JSON.stringify(body??{})});
    return {status:res.status,data:await res.json(),
      cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const company=await prisma.company.create({data:{name:'Stock '+token,
      settings:{create:{}}}});companyId=company.id;
    const team=await prisma.team.create({data:{companyId,name:'Stock Team '+token,
      specialties:{create:{specialty:'Cardiology'}}}});
    const area=await prisma.area.create({data:{companyId,name:'Stock Area '+token}});
    const doctor=await prisma.doctor.create({data:{companyId,areaId:area.id,
      name:'Stock Doctor',specialty:'Cardiology'}});
    const product=await prisma.product.create({data:{companyId,name:'Stock Item '+token}});
    await prisma.teamProduct.create({data:{teamId:team.id,productId:product.id}});
    const admin=await prisma.user.create({data:{companyId,role:'COMPANY_ADMIN',
      name:'Stock Admin',username:'st-adm-'+token,passwordHash:hashPassword(password)}});
    const manager=await prisma.user.create({data:{companyId,role:'TEAM_MANAGER',teamId:team.id,
      name:'Stock Manager',username:'st-mgr-'+token,passwordHash:hashPassword(password)}});
    const rep=await prisma.user.create({data:{companyId,role:'REP',teamId:team.id,
      name:'Stock Rep',username:'st-rep-'+token,passwordHash:hashPassword(password)}});
    await prisma.managerTeamAssignment.create({data:{managerId:manager.id,teamId:team.id}});
    await prisma.repArea.create({data:{repId:rep.id,areaId:area.id}});
    const cookies={};
    for(const [label,user] of Object.entries({admin,manager,rep})){
      const login=await call('/login','POST',{username:user.username,password});
      assert.equal(login.status,200);cookies[label]=login.cookie;
    }
    const quantity=async(type,holderId)=>{
      const stock=await prisma.sampleStock.findFirst({where:{companyId,
        productId:product.id,holderType:type,holderId}});
      return stock?.quantity||0;
    };
    assert.equal((await call('/sample-stock/receive','POST',
      {productId:product.id,quantity:20},cookies.manager)).status,403);
    const received=await call('/sample-stock/receive','POST',
      {productId:product.id,quantity:20},cookies.admin);
    assert.equal(received.status,201,JSON.stringify(received.data));
    assert.equal(await quantity('COMPANY',companyId),20);
    assert.equal((await call('/sample-stock/to-team','POST',
      {productId:product.id,teamId:team.id,quantity:21},cookies.admin)).status,409);
    assert.equal((await call('/sample-stock/to-team','POST',
      {productId:product.id,teamId:team.id,quantity:12},cookies.admin)).status,201);
    assert.equal(await quantity('COMPANY',companyId),8);
    assert.equal(await quantity('TEAM',team.id),12);
    assert.equal((await call('/sample-stock/to-rep','POST',
      {productId:product.id,teamId:team.id,repId:rep.id,quantity:13},cookies.manager)).status,409);
    assert.equal((await call('/sample-stock/to-rep','POST',
      {productId:product.id,teamId:team.id,repId:rep.id,quantity:9},cookies.manager)).status,201);
    assert.equal(await quantity('TEAM',team.id),3);
    assert.equal(await quantity('REP',rep.id),9);
    assert.equal((await call('/sample-stock','GET',null,cookies.rep)).data
      .balances.find(x=>x.productId===product.id)?.quantity,9);
    assert.equal((await call('/rep-plan','GET',null,cookies.rep)).data
      .products.find(x=>x.id===product.id)?.stockQuantity,9);
    const tour={clientVisitId:randomUUID(),type:'DOCTOR',
      visitDate:new Date().toISOString().slice(0,10),targetIds:[doctor.id],
      products:[{productId:product.id,quantity:4}],
      location:{latitude:36.2075,longitude:37.1207,accuracy:10,
        capturedAt:new Date().toISOString()}};
    const first=await call('/visits','POST',tour,cookies.rep);
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(await quantity('REP',rep.id),5);
    const retry=await call('/visits','POST',tour,cookies.rep);
    assert.equal(retry.status,200,JSON.stringify(retry.data));
    assert.equal(retry.data.duplicate,true);
    assert.equal(await quantity('REP',rep.id),5,'Retry may not consume stock twice');
    const declined=await call('/visits','POST',{...tour,clientVisitId:randomUUID(),
      products:[{productId:product.id,quantity:6}]},cookies.rep);
    assert.equal(declined.status,409,JSON.stringify(declined.data));
    assert.equal(await prisma.visit.count({where:{companyId}}),1,
      'Overdraw must roll back the entire new tour');
    assert.equal(await quantity('REP',rep.id),5);
    assert.equal(await prisma.sampleMovement.count({where:{companyId,
      movementType:'VISIT_CONSUMPTION'}}),1);
    assert.equal((await call('/sample-stock/to-team','POST',
      {productId:product.id,teamId:team.id,quantity:1},cookies.rep)).status,403);
  }finally{
    if(companyId){
      const where={companyId};
      await prisma.authSession.deleteMany({where:{user:{companyId}}});
      await prisma.auditLog.deleteMany({where});
      await prisma.sampleMovement.deleteMany({where});
      await prisma.sampleStock.deleteMany({where});
      await prisma.visitTarget.deleteMany({where:{visit:{companyId}}});
      await prisma.visit.deleteMany({where});
      await prisma.repArea.deleteMany({where:{rep:{companyId}}});
      await prisma.user.deleteMany({where});
      await prisma.doctor.deleteMany({where});
      await prisma.product.deleteMany({where});
      await prisma.area.deleteMany({where});
      await prisma.team.deleteMany({where});
      await prisma.company.delete({where:{id:companyId}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
