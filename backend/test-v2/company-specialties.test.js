'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('company specialty catalog persists additions without leaking across companies',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:90000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const seed=randomUUID().slice(0,8),password='CompanySpecialtiesTest!2026';
  const companies=[],users=[];
  async function call(path,method='GET',body=null,cookie=null){
    const response=await fetch(base+'/api'+path,{method,headers:{
      ...(cookie?{Cookie:cookie}:{}),
      ...(method!=='GET'?{'Content-Type':'application/json',
        Origin:'http://localhost:5173'}:{})},
      body:method==='GET'?undefined:JSON.stringify(body??{})});
    return {status:response.status,data:await response.json(),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const a=await prisma.company.create({data:{name:'Specialty A '+seed,
      settings:{create:{}}}});
    const b=await prisma.company.create({data:{name:'Specialty B '+seed,
      settings:{create:{}}}});
    companies.push(a.id,b.id);
    const roles=[
      ['admin',a.id,'COMPANY_ADMIN'],['rep',a.id,'REP'],
      ['foreign',b.id,'COMPANY_ADMIN']
    ];
    const cookies={};
    for(const [label,companyId,role] of roles){
      const user=await prisma.user.create({data:{companyId,role,name:label,
        username:'specialty-'+label+'-'+seed,passwordHash:hashPassword(password)}});
      users.push(user.id);
      const login=await call('/login','POST',{username:user.username,password});
      assert.equal(login.status,200);cookies[label]=login.cookie;
    }
    const name='طب الأسرة '+seed;
    assert.equal((await call('/specialties','POST',{name},cookies.rep)).status,403);
    assert.equal((await call('/specialties','POST',{},cookies.admin)).status,400);
    const add=await call('/specialties','POST',{name},cookies.admin);
    assert.equal(add.status,201,JSON.stringify(add.data));
    assert.equal(add.data.companyId,a.id);
    assert.equal((await call('/specialties','POST',{name},cookies.admin)).status,409);
    const own=await call('/specialties','GET',null,cookies.admin);
    assert.equal(own.status,200);
    assert.ok(own.data.includes(name));
    assert.ok(own.data.includes('قلبية'),'Default specialties must remain');
    assert.equal((await call('/specialties','GET',null,cookies.rep)).data.includes(name),true);
    const directory=await call('/specialties/catalog','GET',null,cookies.admin);
    assert.equal(directory.status,200);
    assert.equal(directory.data.items.find(item=>item.name===name)?.editable,true);
    assert.equal(directory.data.items.find(item=>item.name==='قلبية')?.editable,false);
    assert.equal((await call('/specialties/catalog','GET',null,cookies.rep)).status,403);
    assert.equal((await call('/specialties/'+add.data.id,'PATCH',
      {name:'خطأ'},cookies.rep)).status,403);
    const product=await prisma.product.create({data:{
      companyId:a.id,name:'صنف تجريبي '+seed,targetSpecialties:[name],
      activeIngredient:'المادة الأولى'
    }});
    const renamed=name+' جديد';
    const changed=await call('/specialties/'+add.data.id,'PATCH',
      {name:renamed},cookies.admin);
    assert.equal(changed.status,200,JSON.stringify(changed.data));
    assert.equal(changed.data.name,renamed);
    assert.ok((await call('/specialties','GET',null,cookies.admin)).data.includes(renamed));
    assert.equal((await call('/specialties','GET',null,cookies.admin)).data.includes(name),false);
    const updatedProduct=await prisma.product.findUnique({where:{id:product.id}});
    assert.deepEqual(updatedProduct.targetSpecialties,[renamed]);
    assert.equal((await call('/specialties/'+add.data.id,'PATCH',
      {name:'قلبية'},cookies.admin)).status,409);
    const editProduct=await call('/products/'+product.id,'PATCH',{
      name:'صنف محدّث '+seed,activeIngredient:'المادة الثانية',
      active:false,priority:'PRIMARY',targetSpecialties:[renamed]
    },cookies.admin);
    assert.equal(editProduct.status,200,JSON.stringify(editProduct.data));
    assert.equal(editProduct.data.name,'صنف محدّث '+seed);
    assert.equal(editProduct.data.activeIngredient,'المادة الثانية');
    assert.equal(editProduct.data.active,false);
    assert.equal(editProduct.data.priority,'PRIMARY');

    const other=await call('/specialties','GET',null,cookies.foreign);
    assert.equal(other.status,200);
    assert.equal(other.data.includes(name),false);
    assert.equal(await prisma.companySpecialty.count({where:{companyId:a.id}}),1);
    assert.equal(await prisma.companySpecialty.count({where:{companyId:b.id}}),0);
  }finally{
    if(users.length)await prisma.authSession.deleteMany({where:{userId:{in:users}}});
    if(companies.length){
      const where={in:companies};
      await prisma.auditLog.deleteMany({where:{companyId:where}});
      await prisma.user.deleteMany({where:{companyId:where}});
      await prisma.company.deleteMany({where:{id:where}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
