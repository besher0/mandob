'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('company sales APIs are tenant-isolated, priced and reviewed once',
  {skip:process.env.RUN_DB_TESTS!=='1',timeout:90000},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const suffix=randomUUID().slice(0,8),password='TestingPassword!2026';
  const companies=[];
  async function call(path,method='GET',body,auth){
    const response=await fetch(base+'/api'+path,{method,
      headers:{...(body?{'Content-Type':'application/json'}:{}),
        ...(auth?{Cookie:auth}:{}),...(method!=='GET'?{Origin:'http://localhost:5173'}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json().catch(()=>({})),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const a=await prisma.company.create({data:{name:'Sales A '+suffix,settings:{create:{}}}});
    const b=await prisma.company.create({data:{name:'Sales B '+suffix,settings:{create:{}}}});
    companies.push(a.id,b.id);
    const [aAdmin,bAdmin,rep]=await Promise.all([
      prisma.user.create({data:{companyId:a.id,name:'Sales admin A',role:'COMPANY_ADMIN',
        username:'sale-a-'+suffix,passwordHash:hashPassword(password)}}),
      prisma.user.create({data:{companyId:b.id,name:'Sales admin B',role:'COMPANY_ADMIN',
        username:'sale-b-'+suffix,passwordHash:hashPassword(password)}}),
      prisma.user.create({data:{companyId:a.id,name:'Sales denied REP',role:'REP',
        username:'sale-rep-'+suffix,passwordHash:hashPassword(password)}})
    ]);
    const [ap,bp]=await Promise.all([
      prisma.province.create({data:{companyId:a.id,name:'A province '+suffix}}),
      prisma.province.create({data:{companyId:b.id,name:'B province '+suffix}})
    ]);
    const [aa,ba]=await Promise.all([
      prisma.area.create({data:{companyId:a.id,provinceId:ap.id,name:'A area '+suffix}}),
      prisma.area.create({data:{companyId:b.id,provinceId:bp.id,name:'B area '+suffix}})
    ]);
    const [pharmacyA,pharmacyB,productA,productB]=await Promise.all([
      prisma.pharmacy.create({data:{companyId:a.id,areaId:aa.id,name:'Sales pharmacy A'}}),
      prisma.pharmacy.create({data:{companyId:b.id,areaId:ba.id,name:'Sales pharmacy B'}}),
      prisma.product.create({data:{companyId:a.id,name:'Sales product A '+suffix}}),
      prisma.product.create({data:{companyId:b.id,name:'Sales product B '+suffix}})
    ]);
    const aLogin=await call('/login','POST',{username:aAdmin.username,password});
    const bLogin=await call('/login','POST',{username:bAdmin.username,password});
    const repLogin=await call('/login','POST',{username:rep.username,password});
    assert.equal(aLogin.status,200);assert.equal(bLogin.status,200);assert.equal(repLogin.status,200);
    const ca=aLogin.cookie,cb=bLogin.cookie,cr=repLogin.cookie;
    assert.equal((await call('/sales/options')).status,401);
    for(const endpoint of ['/sales/options','/sales/agents','/sales/orders','/sales/visits','/sales/summary'])
      assert.equal((await call(endpoint,'GET',undefined,cr)).status,403,'REP denied '+endpoint);
    const opts=await call('/sales/options','GET',undefined,ca);
    assert.equal(opts.status,200);
    assert.ok(opts.data.provinces.some(x=>x.id===ap.id));
    assert.ok(!opts.data.provinces.some(x=>x.id===bp.id));
    assert.ok(opts.data.products.some(x=>x.id===productA.id));
    assert.ok(!opts.data.products.some(x=>x.id===productB.id));
    assert.equal((await call('/sales/agents','POST',{provinceId:bp.id,name:'Wrong tenant'},ca)).status,400);
    const agent=await call('/sales/agents','POST',{provinceId:ap.id,name:'Sales agent '+suffix},ca);
    assert.equal(agent.status,201);
    const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const visitBody={clientRef:randomUUID(),provinceId:ap.id,targetType:'PHARMACY',
      targetId:pharmacyA.id,date,notes:'Sales call'};
    const badVisit=await call('/sales/visits','POST',{...visitBody,targetId:pharmacyB.id},ca);
    assert.equal(badVisit.status,400);
    assert.equal((await call('/sales/visits','POST',visitBody,cr)).status,403);
    const visit=await call('/sales/visits','POST',visitBody,ca);
    assert.equal(visit.status,201);
    const replayVisit=await call('/sales/visits','POST',visitBody,ca);
    assert.equal(replayVisit.status,200);
    assert.equal(replayVisit.data.id,visit.data.id);
    const orderBody={...visitBody,clientRef:randomUUID(),agentId:agent.data.id,
      visitId:visit.data.id,currency:'SYP',items:[{productId:productA.id,quantity:3,
        unitPrice:'100.00',offerType:'DISCOUNT',discountPercent:'10.00',bonusQuantity:0}]};
    const badProduct=await call('/sales/orders','POST',{...orderBody,items:[
      {...orderBody.items[0],productId:productB.id}]},ca);
    assert.equal(badProduct.status,400);
    const order=await call('/sales/orders','POST',orderBody,ca);
    assert.equal(order.status,201,JSON.stringify(order.data));
    assert.equal(String(order.data.total),'270');
    const summary=await call('/sales/summary','GET',undefined,ca);
    assert.equal(summary.status,200);
    assert.equal(summary.data.counts.PENDING,1);
    assert.equal(summary.data.visits,1);
    const listingB=await call('/sales/orders','GET',undefined,cb);
    assert.equal(listingB.status,200);
    assert.equal(listingB.data.total,0);
    const foreignReview=await call('/sales/orders/'+order.data.id+'/review','PATCH',
      {status:'APPROVED',note:''},cb);
    assert.equal(foreignReview.status,404);
    const approved=await call('/sales/orders/'+order.data.id+'/review','PATCH',
      {status:'APPROVED',note:'تم الاعتماد'},ca);
    assert.equal(approved.status,200);
    assert.equal(approved.data.status,'APPROVED');
    const doubleReview=await call('/sales/orders/'+order.data.id+'/review','PATCH',
      {status:'REJECTED',note:'duplicate'},ca);
    assert.equal(doubleReview.status,409);
    const conflictReplay=await call('/sales/orders','POST',{...orderBody,notes:'Different'},ca);
    assert.equal(conflictReplay.status,409);
    assert.equal(await prisma.visit.count({where:{companyId:a.id}}),0,
      'Sales visits are not medical REP Visit records');
  }finally{
    if(companies.length){
      const where={companyId:{in:companies}};
      await prisma.salesOrder.deleteMany({where});
      await prisma.salesVisit.deleteMany({where});
      await prisma.salesAgent.deleteMany({where});
      await prisma.auditLog.deleteMany({where});
      await prisma.pharmacy.deleteMany({where});
      await prisma.hospital.deleteMany({where});
      await prisma.product.deleteMany({where});
      await prisma.area.deleteMany({where});
      await prisma.province.deleteMany({where});
      await prisma.user.deleteMany({where});
      await prisma.company.deleteMany({where:{id:{in:companies}}});
    }
    await new Promise(resolve=>server.close(resolve));
  }
});
