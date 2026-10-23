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
    // Logout revokes the specific token without revoking independent sessions.
    const extraSession=await call('/login','POST',{username:rep.username,password});
    assert.equal(extraSession.status,200);
    assert.equal((await call('/me','GET',null,extraSession.cookie)).status,200);
    assert.equal((await call('/logout','POST',{},extraSession.cookie)).status,200);
    assert.equal((await call('/me','GET',null,extraSession.cookie)).status,401);
    assert.equal((await call('/me','GET',null,rl.cookie)).status,200);
    // Existing but expired sessions must not authenticate.
    const {createHash,randomBytes}=require('node:crypto');
    const expiredToken=randomBytes(32).toString('hex');
    await prisma.authSession.create({data:{userId:rep.id,
      tokenHash:createHash('sha256').update(expiredToken).digest('hex'),
      expiresAt:new Date(Date.now()-3600000)}});
    assert.equal((await call('/me','GET',null,'mandob_session='+expiredToken)).status,401);

    const pagingIndexes=await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'
        AND tablename IN ('Visit','LeaveRequest')
    `;
    const pagingNames=new Set(pagingIndexes.map(x=>x.indexname));
    for(const index of [
      'Visit_companyId_visitDate_createdAt_id_idx',
      'Visit_repId_visitDate_createdAt_id_idx',
      'Visit_companyId_teamIdAtVisit_visitDate_createdAt_id_idx',
      'LeaveRequest_companyId_createdAt_id_idx',
      'LeaveRequest_repId_createdAt_id_idx'
    ]){
      assert.ok(pagingNames.has(index),'Missing paginated history index '+index);
    }
    // Role matrix: authentication is mandatory across every company API read.
    const protectedReads=[
      '/dashboard','/teams','/users','/areas','/doctors','/pharmacies',
      '/hospitals','/products','/visits','/leaves','/settings','/analytics/frequency'
    ];
    for(const path of protectedReads){
      assert.equal((await call(path)).status,401,'Unauthenticated read allowed on '+path);
    }
    // Representatives cannot create company-managed records or change settings.
    const adminWrites=[
      ['/teams',{name:'Forbidden team'}],['/users',{role:'REP',name:'Forbidden'}],
      ['/areas',{name:'Forbidden area'}],['/doctors',{name:'Forbidden doctor'}],
      ['/pharmacies',{name:'Forbidden pharmacy'}],['/hospitals',{name:'Forbidden hospital'}],
      ['/products',{name:'Forbidden product'}]
    ];
    for(const [path,body] of adminWrites){
      assert.equal((await call(path,'POST',body,rl.cookie)).status,403,
        'Representative unexpectedly has permission to create '+path);
    }
    assert.equal((await call('/settings','PATCH',{frequencyA:20},rl.cookie)).status,403);
    // Company B administrator cannot mutate or list archived resources of company A.
    const foreignAdmin=await prisma.user.create({data:{
      companyId:cb.id,name:'Foreign company administrator',username:'admB-'+seed,
      role:'COMPANY_ADMIN',passwordHash:hashPassword(password)
    }});
    const foreignLogin=await call('/login','POST',{username:foreignAdmin.username,password});
    assert.equal(foreignLogin.status,200);
    assert.equal((await call('/users/'+rep.id,'PATCH',{name:'Malicious rename'},foreignLogin.cookie)).status,404);
    assert.equal((await call('/doctors/'+da.id+'/status','PATCH',{active:false},foreignLogin.cookie)).status,404);
    assert.equal((await call('/doctors?includeArchived=true','GET',null,foreignLogin.cookie)).data
      .some(item=>item.id===da.id),false);
    assert.equal((await call('/companies','GET',null,foreignLogin.cookie)).status,403);
    assert.equal((await call('/companies','POST',{name:'Forbidden co'},foreignLogin.cookie)).status,403);

    // The React edit panel uses only already-authorized PATCH /users fields.
    assert.equal((await call('/users/'+rep.id,'PATCH',{dailyTarget:null},al.cookie)).status,400);
    assert.equal((await call('/users/'+rep.id,'PATCH',{annualLeaveBalance:''},al.cookie)).status,400);
    const editedRep=await call('/users/'+rep.id,'PATCH',{
      name:'Updated representative',dailyTarget:9,annualLeaveBalance:18,
      areaIds:[aa.id],teamId:team.id,active:true
    },al.cookie);
    assert.equal(editedRep.status,200,JSON.stringify(editedRep.data));
    assert.equal(editedRep.data.user.name,'Updated representative');
    assert.equal(editedRep.data.user.dailyTarget,9);
    assert.equal(editedRep.data.user.annualLeaveBalance,18);
    const checkedRep=await prisma.user.findUnique({where:{id:rep.id}});
    assert.equal(checkedRep.teamId,team.id);
    assert.equal(checkedRep.dailyTarget,9);
    assert.equal(await prisma.repArea.count({where:{repId:rep.id,areaId:aa.id}}),1);
    const editable=await call('/users','GET',null,al.cookie);
    assert.equal(editable.status,200);
    assert.ok(editable.data.some(u=>u.id===rep.id&&u.dailyTarget===9&&u.annualLeaveBalance===18));
    assert.equal((await call('/users/'+rep.id,'PATCH',{dailyTarget:10},rl.cookie)).status,403,
      'Representative cannot edit their own dashboard account');

    const auditBeforeDenied=await prisma.auditLog.count({where:{
      companyId:ca.id,actorId:admin.id,entity:'USER',entityId:rep.id,action:'UPDATE'
    }});
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
    }}),auditBeforeDenied,'Rejected cross-company assignment must not create misleading audit entries');

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
    // Legacy area grouping and area details, without any archive/delete workflow.
    const grouping=await call('/area-groups','POST',{name:'District '+seed},al.cookie);
    assert.equal(grouping.status,201,JSON.stringify(grouping.data));
    assert.equal((await call('/area-groups','POST',{name:'District '+seed},al.cookie)).status,409);
    assert.equal((await call('/area-groups','POST',{name:'Unauthorized'},rl.cookie)).status,403);
    assert.equal((await call('/area-groups','GET',null,rl.cookie)).status,403);
    const otherGroup=await prisma.areaGroup.create({data:{
      companyId:cb.id,name:'Other district '+seed,sortOrder:1
    }});
    assert.equal((await call('/areas/'+areaCreated.data.id,'PATCH',{
      groupId:otherGroup.id
    },al.cookie)).status,400);
    assert.equal((await call('/areas/'+ab.id,'PATCH',{name:'Foreign edit'},al.cookie)).status,404);
    assert.equal((await call('/areas/'+areaCreated.data.id,'PATCH',{name:'No'},rl.cookie)).status,403);
    const groupedArea=await call('/areas/'+areaCreated.data.id,'PATCH',{
      name:'Updated area '+seed,city:'Aleppo',groupId:grouping.data.id
    },al.cookie);
    assert.equal(groupedArea.status,200,JSON.stringify(groupedArea.data));
    assert.equal(groupedArea.data.groupId,grouping.data.id);
    const groupedAreas=await call('/areas','GET',null,al.cookie);
    assert.equal(groupedAreas.data.find(x=>x.id===areaCreated.data.id).group.name,
      'District '+seed);
    const listingGroups=await call('/area-groups','GET',null,al.cookie);
    assert.equal(listingGroups.status,200);
    assert.equal(listingGroups.data.find(g=>g.id===grouping.data.id)._count.areas,1);
    assert.equal(listingGroups.data.some(g=>g.id===otherGroup.id),false);
    const areaDetails=await call('/areas/'+aa.id+'/details','GET',null,al.cookie);
    assert.equal(areaDetails.status,200,JSON.stringify(areaDetails.data));
    assert.equal(areaDetails.data.totals.doctors,1);
    assert.equal(areaDetails.data.totals.reps,1);
    assert.equal(areaDetails.data.doctors[0].id,da.id);
    assert.equal((await call('/areas/'+aa.id+'/details','GET',null,foreignLogin.cookie)).status,404);
    assert.equal((await call('/areas/'+aa.id+'/details','GET',null,rl.cookie)).status,403);
    const createdTeam=await call('/teams','POST',{name:'Audited Team '+seed},al.cookie);
    assert.equal(createdTeam.status,201,JSON.stringify(createdTeam.data));
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      action:'CREATE',entity:'TEAM',entityId:createdTeam.data.id}}),1);
    const product=await call('/products','POST',{name:'Audited product '+seed},al.cookie);
    assert.equal(product.status,201,JSON.stringify(product.data));
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id,actorId:admin.id,
      action:'CREATE',entity:'PRODUCT',entityId:product.data.id}}),1);
    // Team editing and product assignment are existing legacy operations.
    // Validate these against real PostgreSQL tenant ownership and atomic audit writes.
    const foreignProduct=await prisma.product.create({data:{
      companyId:cb.id,name:'Foreign product '+seed
    }});
    // Legacy representative specialties: TEAM inheritance, explicit CUSTOM, and solo products.
    const customRepResponse=await call('/users','POST',{
      role:'REP',name:'Custom specialist '+seed,username:'custom-'+seed,password,
      teamId:null,areaIds:[aa.id],specialtyMode:'CUSTOM',
      customSpecialties:['Dermatology','Dermatology','Neurology'],
      customProductIds:[product.data.id]
    },al.cookie);
    assert.equal(customRepResponse.status,201,JSON.stringify(customRepResponse.data));
    const customId=customRepResponse.data.user.id;
    assert.equal(await prisma.repSpecialty.count({where:{repId:customId}}),2);
    assert.equal(await prisma.repProduct.count({where:{repId:customId}}),1);
    const customListing=await call('/users','GET',null,al.cookie);
    assert.equal(customListing.status,200);
    const customListed=customListing.data.find(x=>x.id===customId);
    assert.equal(customListed.specialtyMode,'CUSTOM');
    assert.equal(customListed.repProducts[0].product.name,product.data.name);
    assert.equal(customListed.repSpecialties.length,2);
    assert.equal((await call('/users','POST',{
      role:'REP',name:'Foreign custom',username:'bad-custom-'+seed,password,
      specialtyMode:'CUSTOM',customSpecialties:['X'],customProductIds:[foreignProduct.id]
    },al.cookie)).status,400);
    assert.equal(await prisma.user.count({where:{username:'bad-custom-'+seed}}),0);
    assert.equal((await call('/users/'+customId,'PATCH',{
      customProductIds:[foreignProduct.id]
    },al.cookie)).status,400);
    assert.equal(await prisma.repProduct.count({where:{repId:customId}}),1);
    assert.equal((await call('/users/'+customId,'PATCH',{
      specialtyMode:'TEAM',customSpecialties:['Unauthorized combo']
    },al.cookie)).status,400);
    assert.equal((await call('/users/'+customId,'PATCH',{
      customSpecialties:['Hidden custom without CUSTOM mode']
    },foreignLogin.cookie)).status,404);
    assert.equal((await call('/users/'+customId,'PATCH',{
      customSpecialties:['Forbidden']
    },rl.cookie)).status,403);
    const inheritTeam=await call('/users/'+customId,'PATCH',{
      specialtyMode:'TEAM',customSpecialties:[],teamId:team.id,
      customProductIds:[]
    },al.cookie);
    assert.equal(inheritTeam.status,200,JSON.stringify(inheritTeam.data));
    assert.equal(await prisma.repSpecialty.count({where:{repId:customId}}),0);
    assert.equal(await prisma.repProduct.count({where:{repId:customId}}),0);
    assert.equal((await prisma.user.findUnique({where:{id:customId}})).teamId,team.id);
    // Converting a team manager to custom REP preferences is forbidden.
    assert.equal((await call('/users','POST',{
      role:'TEAM_MANAGER',name:'Invalid manager',username:'manager-'+seed,password,
      specialtyMode:'CUSTOM',customSpecialties:['X']
    },al.cookie)).status,400);
    assert.equal(await prisma.user.count({where:{username:'manager-'+seed}}),0);
    const teamWithoutProducts=await call('/teams','POST',{
      name:'Team without product '+seed,specialties:['Cardiology'],
      productIds:[foreignProduct.id]
    },al.cookie);
    assert.equal(teamWithoutProducts.status,400,'Foreign product cannot be assigned to our team');
    assert.equal(await prisma.team.count({
      where:{companyId:ca.id,name:'Team without product '+seed}
    }),0,'Rejected product assignment rolls back team creation');
    const withProduct=await call('/teams','POST',{
      name:'Assigned products '+seed,specialties:['Cardiology','Cardiology'],
      productIds:[product.data.id,product.data.id]
    },al.cookie);
    assert.equal(withProduct.status,201,JSON.stringify(withProduct.data));
    assert.deepEqual(withProduct.data.products.map(x=>x.productId),[product.data.id],
      'Duplicate product IDs are deduplicated on creation');
    assert.deepEqual(withProduct.data.specialties.map(x=>x.specialty),['Cardiology']);
    const teamId=createdTeam.data.id;
    assert.equal((await call('/teams/'+teamId,'PATCH',{name:'No access'},rl.cookie)).status,403);
    assert.equal((await call('/teams/'+teamId,'PATCH',{name:'Wrong company'},foreignLogin.cookie)).status,404);
    assert.equal((await call('/teams/'+foreignTeam.id,'PATCH',{name:'Wrong company'},al.cookie)).status,404);
    assert.equal((await call('/teams/'+teamId,'PATCH',{productIds:[foreignProduct.id]},al.cookie)).status,400);
    assert.equal((await call('/teams/'+teamId,'PATCH',{productIds:['invalid-id']},al.cookie)).status,400);
    assert.equal((await call('/teams/'+teamId,'PATCH',{},al.cookie)).status,400);
    const changedTeam=await call('/teams/'+teamId,'PATCH',{
      name:'Updated Team '+seed,specialties:['Cardiology','Neurology'],
      productIds:[product.data.id]
    },al.cookie);
    assert.equal(changedTeam.status,200,JSON.stringify(changedTeam.data));
    assert.equal(changedTeam.data.name,'Updated Team '+seed);
    assert.deepEqual(changedTeam.data.specialties.map(x=>x.specialty),
      ['Cardiology','Neurology']);
    assert.deepEqual(changedTeam.data.products.map(x=>x.productId),[product.data.id]);
    const partialTeam=await call('/teams/'+teamId,'PATCH',{name:'Final Team '+seed},al.cookie);
    assert.equal(partialTeam.status,200,JSON.stringify(partialTeam.data));
    assert.deepEqual(partialTeam.data.specialties.map(x=>x.specialty),
      ['Cardiology','Neurology'],'Omitted specialties must not be cleared');
    assert.deepEqual(partialTeam.data.products.map(x=>x.productId),[product.data.id],
      'Omitted products must not be cleared');
    const auditTeamBeforeRejected=await prisma.auditLog.count({where:{
      companyId:ca.id,entity:'TEAM',entityId:teamId,action:'UPDATE'
    }});
    assert.equal((await call('/teams/'+teamId,'PATCH',{
      name:'Must not persist',productIds:[foreignProduct.id]
    },al.cookie)).status,400);
    const savedTeam=await prisma.team.findUnique({
      where:{id:teamId},include:{specialties:true,products:true}
    });
    assert.equal(savedTeam.name,'Final Team '+seed);
    assert.equal(savedTeam.products.length,1);
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,entity:'TEAM',entityId:teamId,action:'UPDATE'
    }}),auditTeamBeforeRejected,'A failed patch must not add audit log');
    const clearedSpecialties=await call('/teams/'+teamId,'PATCH',{specialties:[]},al.cookie);
    assert.equal(clearedSpecialties.status,200);
    assert.deepEqual(clearedSpecialties.data.specialties,[]);
    assert.equal(clearedSpecialties.data.products.length,1,
      'Replacing specialties should preserve team products');
    const viewedTeams=await call('/teams','GET',null,al.cookie);
    assert.equal(viewedTeams.status,200);
    assert.equal(viewedTeams.data.find(x=>x.id===teamId).products[0].product.name,
      product.data.name,'Team list shows linked product names');
    assert.equal((await call('/products','GET',null,al.cookie)).data.some(
      x=>x.id===foreignProduct.id),false,'Company product directory cannot show another tenant products');

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
    // Omitted browser GPS coordinates must not become 0,0 via Number(null).
    for(const missing of [{latitude:null},{longitude:null},{latitude:''},{longitude:false}]){
      const invalidId=randomUUID();
      const bad=await call('/visits','POST',{...body,clientVisitId:invalidId,
        location:{...body.location,...missing}},rl.cookie);
      assert.equal(bad.status,400,JSON.stringify({missing,data:bad.data}));
      assert.equal(await prisma.visit.count({where:{clientVisitId:invalidId}}),0);
    }
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
    // Paging through visit history retains company and representative scoping.
    const firstVisitPage=await call('/visits?limit=1&offset=0','GET',null,al.cookie);
    const secondVisitPage=await call('/visits?limit=1&offset=1','GET',null,al.cookie);
    assert.equal(firstVisitPage.status,200);
    assert.equal(secondVisitPage.status,200);
    assert.equal(firstVisitPage.data.length,1);
    assert.equal(secondVisitPage.data.length,1);
    assert.notEqual(firstVisitPage.data[0].id,secondVisitPage.data[0].id);
    assert.deepEqual([firstVisitPage.data[0].id,secondVisitPage.data[0].id].sort(),
      [created.data.id,colleagueVisit.data.id].sort());
    assert.equal((await call('/visits?limit=1&offset=1','GET',null,rl.cookie)).data.length,0,
      'Representative paging cannot reveal another representative visits');
    assert.equal((await call('/visits?limit=1&offset=1','GET',null,ol.cookie)).data.length,0,
      'Another company cannot see visit history');
    for(const q of ['limit=0','limit=201','offset=-1','offset=abc','offset=100001','limit=null']){
      assert.equal((await call('/visits?'+q,'GET',null,al.cookie)).status,400,'visits '+q);
    }

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
    const oldTeamPage1=await call('/visits?limit=1&offset=0','GET',null,oldManagerSession.cookie);
    const oldTeamPage2=await call('/visits?limit=1&offset=1','GET',null,oldManagerSession.cookie);
    assert.equal(oldTeamPage1.status,200);
    assert.equal(oldTeamPage2.status,200);
    assert.notEqual(oldTeamPage1.data[0].id,oldTeamPage2.data[0].id);
    assert.deepEqual([oldTeamPage1.data[0].id,oldTeamPage2.data[0].id].sort(),
      [created.data.id,colleagueVisit.data.id].sort(),
      'Team history pagination keeps the original visit-time team, not the current team');
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
    // Leave requests use the same optional offset paging with unchanged role isolation.
    const firstLeavePage=await call('/leaves?limit=1&offset=0','GET',null,al.cookie);
    const secondLeavePage=await call('/leaves?limit=1&offset=1','GET',null,al.cookie);
    assert.equal(firstLeavePage.status,200);
    assert.equal(secondLeavePage.status,200);
    assert.equal(firstLeavePage.data.length,1);
    assert.equal(secondLeavePage.data.length,1);
    assert.notEqual(firstLeavePage.data[0].id,secondLeavePage.data[0].id);
    assert.deepEqual([firstLeavePage.data[0].id,secondLeavePage.data[0].id].sort(),
      [leave.data.id,teammateLeave.data.id].sort());
    assert.equal((await call('/leaves?limit=1&offset=1','GET',null,rl.cookie)).data.length,0);
    assert.equal((await call('/leaves?limit=1&offset=1','GET',null,ol.cookie)).data.length,0);
    for(const q of ['limit=0','limit=201','offset=-1','offset=abc']){
      assert.equal((await call('/leaves?'+q,'GET',null,al.cookie)).status,400,'leaves '+q);
    }

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
    // Medical editing changes descriptive fields only; ownership and history are preserved.
    const doctorOriginal=await prisma.doctor.findUnique({where:{id:da.id}});
    const updateDoctor=await call('/doctors/'+da.id,'PATCH',{
      name:'Doctor A edited',specialty:'Dermatology',grade:'B',city:'Damascus'
    },al.cookie);
    assert.equal(updateDoctor.status,200,JSON.stringify(updateDoctor.data));
    assert.equal(updateDoctor.data.id,da.id);
    assert.equal(updateDoctor.data.areaId,aa.id);
    assert.equal(updateDoctor.data.specialty,'Dermatology');
    assert.equal((await call('/doctors/'+da.id,'PATCH',{areaId:ab.id},al.cookie)).status,400);
    assert.equal((await call('/doctors/'+da.id,'PATCH',{active:false},al.cookie)).status,400);
    assert.equal((await call('/doctors/'+da.id,'PATCH',{grade:'Z'},al.cookie)).status,400);
    assert.equal((await call('/doctors/'+da.id,'PATCH',{name:'Cross'},foreignLogin.cookie)).status,404);
    assert.equal((await call('/doctors/'+da.id,'PATCH',{name:'Rep'},rl.cookie)).status,403);
    assert.equal((await call('/doctors/'+db.id,'PATCH',{name:'Foreign'},al.cookie)).status,404);
    assert.equal(await prisma.visitTarget.count({where:{doctorId:da.id}}),4,
      'Editing doctor details cannot delete or move past visits');
    const afterEdit=await prisma.doctor.findUnique({where:{id:da.id}});
    assert.equal(afterEdit.areaId,doctorOriginal.areaId);
    assert.equal(await prisma.auditLog.count({where:{
      companyId:ca.id,entity:'DOCTOR',entityId:da.id,action:'UPDATE'
    }}),1);
    // Restore old description so remaining report expectations compare same target grade.
    const restoredDoctor=await call('/doctors/'+da.id,'PATCH',{
      name:'Doctor A',specialty:'Cardiology',grade:'A',city:null
    },al.cookie);
    assert.equal(restoredDoctor.status,200);
    const editablePharmacy=await prisma.pharmacy.create({data:{
      companyId:ca.id,areaId:aa.id,name:'Editable pharmacy '+seed,
      kind:'مستقلة',target:4,grade:'A'
    }});
    const pharmacyChanged=await call('/pharmacies/'+editablePharmacy.id,'PATCH',{
      name:'Updated pharmacy '+seed,kind:'سلسلة',grade:'B',target:6
    },al.cookie);
    assert.equal(pharmacyChanged.status,200,JSON.stringify(pharmacyChanged.data));
    assert.equal(pharmacyChanged.data.target,6);
    assert.equal(pharmacyChanged.data.areaId,aa.id);
    assert.equal((await call('/pharmacies/'+editablePharmacy.id,'PATCH',{target:0},al.cookie)).status,400);
    assert.equal((await call('/pharmacies/'+editablePharmacy.id,'PATCH',{name:'Other'},foreignLogin.cookie)).status,404);
    assert.equal((await call('/pharmacies/'+editablePharmacy.id,'PATCH',{name:'Rep'},rl.cookie)).status,403);
    const editableHospital=await prisma.hospital.create({data:{
      companyId:ca.id,areaId:aa.id,name:'Editable hospital '+seed
    }});
    const hospitalChanged=await call('/hospitals/'+editableHospital.id,'PATCH',{
      name:'Updated hospital '+seed,category:'عام',specialty:'Cardiology',target:7
    },al.cookie);
    assert.equal(hospitalChanged.status,200,JSON.stringify(hospitalChanged.data));
    assert.equal(hospitalChanged.data.target,7);
    assert.equal(hospitalChanged.data.areaId,aa.id);
    assert.equal((await call('/hospitals/'+editableHospital.id,'PATCH',{areaId:ab.id},al.cookie)).status,400);
    assert.equal((await call('/hospitals/'+editableHospital.id,'PATCH',{target:-1},al.cookie)).status,400);
    assert.equal((await call('/hospitals/'+editableHospital.id,'PATCH',{name:'Other'},foreignLogin.cookie)).status,404);
    assert.equal((await call('/hospitals/'+editableHospital.id,'PATCH',{name:'Rep'},rl.cookie)).status,403);

    // Real XLSX import: review exact-name collisions, then choose same / different / skip.
    const ExcelJS=require('exceljs');
    const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Doctors');
    sheet.addRow(['Name','City','Specailist','classification','Doctor geo name']);
    sheet.addRow(['Doctor A','New City','Other Specialty','B','Extra Imported Area']);
    sheet.addRow(['Doctor Brand New','New City','Neurology','C','Extra Imported Area']);
    sheet.addRow(['Doctor Brand New','New City','Neurology','A','Second Imported Area']);
    sheet.addRow(['Doctor A','New City','Changed Specialty','B','Ignored Area']);
    sheet.addRow(['Doctor A','New City','Separate doctor specialty','C','Different Doctor Area']);
    sheet.addRow(['','City','Cardiology','A','Invalid imported Area']);
    const binary=Buffer.from(await wb.xlsx.writeBuffer());
    async function previewWorkbook(cookie){
      const r=await fetch(base+'/api/doctors/import/preview',{
        method:'POST',
        headers:{Cookie:cookie,Origin:'http://localhost:5173',
          'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
        body:binary
      });
      return {status:r.status,data:await r.json()};
    }
    const doctorCountBefore=await prisma.doctor.count({where:{companyId:ca.id}});
    const areaCountBefore=await prisma.area.count({where:{companyId:ca.id}});
    assert.equal((await previewWorkbook(rl.cookie)).status,403,
      'Only the company admin can preview a workbook');
    const preview=await previewWorkbook(al.cookie);
    assert.equal(preview.status,200,JSON.stringify(preview.data));
    assert.equal(preview.data.reviewCount,4,'Existing and within-file duplicates require an explicit choice');
    assert.equal(preview.data.newCount,1);
    assert.equal(preview.data.invalidCount,1);
    assert.equal(preview.data.rows[0].candidates.some(x=>x.id===da.id),true);
    assert.equal(preview.data.rows[2].candidates.some(x=>x.sourceRow===3),true);
    assert.equal(await prisma.doctor.count({where:{companyId:ca.id}}),doctorCountBefore,
      'Preview must not create or update any doctor');
    assert.equal(await prisma.area.count({where:{companyId:ca.id}}),areaCountBefore,
      'Preview must not create areas');
    const importedRows=preview.data.rows.filter(x=>x.status!=='invalid').map(x=>({
      row:x.row,name:x.name,areaName:x.areaName,specialty:x.specialty,
      grade:x.grade,city:x.city,
      ...(x.row===2?{action:'same',doctorId:da.id}:
        x.row===3?{action:'create'}:
        x.row===4?{action:'same',sourceRow:3}:
        x.row===5?{action:'skip'}:{action:'different'})
    }));
    const clientImportId=randomUUID();
    assert.equal((await call('/doctors/import/commit','POST',
      {clientImportId,rows:importedRows},rl.cookie)).status,403);
    assert.equal((await call('/doctors/import/commit','POST',{
      clientImportId:randomUUID(),
      rows:importedRows.map(x=>x.row===2?{...x,doctorId:db.id}:x)
    },al.cookie)).status,409,'Cannot link to a doctor from another company');
    assert.equal(await prisma.doctor.count({where:{companyId:ca.id}}),doctorCountBefore,
      'Failed import must rollback every row');
    const committed=await call('/doctors/import/commit','POST',
      {clientImportId,rows:importedRows},al.cookie);
    assert.equal(committed.status,200,JSON.stringify(committed.data));
    assert.deepEqual([
      committed.data.created,committed.data.linked,committed.data.skipped
    ],[2,2,1]);
    const doctorsAfterImport=await prisma.doctor.count({where:{companyId:ca.id}});
    const sameRequest=await call('/doctors/import/commit','POST',
      {clientImportId,rows:importedRows},al.cookie);
    assert.equal(sameRequest.status,200,JSON.stringify(sameRequest.data));
    assert.equal(sameRequest.data.duplicate,true,
      'Retry of an already-applied import must return its saved result');
    assert.equal(await prisma.doctor.count({where:{companyId:ca.id}}),doctorsAfterImport,
      'Same import request cannot create doctors twice');
    assert.equal((await call('/doctors/import/commit','POST',{
      clientImportId,rows:importedRows.map(x=>x.row===5?{...x,action:'different'}:x)
    },al.cookie)).status,409,
      'Reusing an import ID with different choices is forbidden');
    const savedOriginal=await prisma.doctor.findUnique({where:{id:da.id}});
    assert.equal(savedOriginal.areaId,aa.id);
    assert.equal(savedOriginal.grade,'A','Same-doctor decision must not overwrite grade');
    assert.equal(savedOriginal.specialty,'Cardiology','Same-doctor decision must not overwrite specialty');
    assert.equal(await prisma.doctorArea.count({where:{doctorId:da.id}}),2);
    const importArea=await prisma.area.findUnique({
      where:{companyId_name:{companyId:ca.id,name:'Extra Imported Area'}}
    });
    assert.ok(importArea);
    assert.equal(await prisma.doctorArea.count({
      where:{doctorId:da.id,areaId:importArea.id}
    }),1);
    assert.equal(await prisma.area.count({
      where:{companyId:ca.id,name:'Ignored Area'}
    }),0,'Skip decision must not even create a new area');
    assert.equal(await prisma.doctor.count({
      where:{companyId:ca.id,name:'Doctor A'}
    }),2,'Different doctor must have a distinct ID');
    const importedDoctor=await prisma.doctor.findFirst({
      where:{companyId:ca.id,name:'Doctor Brand New'}
    });
    assert.ok(importedDoctor);
    assert.equal(await prisma.doctorArea.count({where:{doctorId:importedDoctor.id}}),2,
      'Within-file same doctor decision should link two areas to a single ID');
    const extraRep=await prisma.user.create({data:{
      companyId:ca.id,name:'New area rep',username:'extra-'+seed,role:'REP',
      teamId:rivalTeam.id,passwordHash:hashPassword(password)
    }});
    await prisma.repArea.create({data:{repId:extraRep.id,areaId:importArea.id}});
    const extraLogin=await call('/login','POST',{username:extraRep.username,password});
    assert.equal(extraLogin.status,200);
    const extraDocs=await call('/doctors','GET',null,extraLogin.cookie);
    assert.equal(extraDocs.status,200);
    assert.ok(extraDocs.data.some(d=>d.id===da.id),
      'Rep assigned only to secondary area sees the same Doctor ID');
    assert.equal((await call('/doctors?areaId='+importArea.id,'GET',null,al.cookie))
      .data.some(d=>d.id===da.id),true);
    const beforeImportedTour=await call('/analytics/frequency','GET',null,extraLogin.cookie);
    const initialFrequency=beforeImportedTour.data.items.find(x=>x.id===da.id);
    const extraTour=await call('/visits','POST',{
      ...body,clientVisitId:randomUUID(),targetIds:[da.id]
    },extraLogin.cookie);
    assert.equal(extraTour.status,201,JSON.stringify(extraTour.data));
    assert.equal(extraTour.data.targets[0].id,da.id);
    const afterImportedTour=await call('/analytics/frequency','GET',null,extraLogin.cookie);
    const frequencyRows=afterImportedTour.data.items.filter(x=>x.id===da.id);
    assert.equal(frequencyRows.length,1,'One doctor in two regions has one target per team');
    assert.equal(frequencyRows[0].done,initialFrequency.done+1,
      'Tour in new area counts toward same team-doctor frequency');

    // Visit reports use the immutable team snapshot and share /visits RBAC scope.
    const reportDate=body.visitDate;
    const url='/reports/visits?from='+reportDate+'&to='+reportDate;
    assert.equal((await call(url)).status,401);
    assert.equal((await call(url,'GET',null,rl.cookie)).status,403,
      'Representative must not access manager-only detailed reports');
    assert.equal((await call('/reports/visits?from=2026-01-05&to=2026-01-04',
      'GET',null,al.cookie)).status,400);
    assert.equal((await call('/reports/visits?from=2020-01-01&to=2026-10-23',
      'GET',null,al.cookie)).status,400);
    assert.equal((await call('/reports/visits?from=incorrect&to='+reportDate,
      'GET',null,al.cookie)).status,400);
    const companyReport=await call(url,'GET',null,al.cookie);
    assert.equal(companyReport.status,200,JSON.stringify(companyReport.data));
    const expectedTours=await prisma.visit.count({
      where:{companyId:ca.id,visitDate:new Date(reportDate+'T00:00:00.000Z')}
    });
    assert.equal(companyReport.data.total,expectedTours);
    assert.equal(companyReport.data.rows.length,expectedTours);
    assert.equal(companyReport.data.byRepresentative.reduce((n,x)=>n+x.total,0),expectedTours);
    assert.equal(companyReport.data.byTeam.reduce((n,x)=>n+x.total,0),expectedTours);
    assert.equal(companyReport.data.byType.DOCTOR+companyReport.data.byType.PHARMACY+
      companyReport.data.byType.HOSPITAL,expectedTours);
    assert.ok(companyReport.data.rows.some(x=>x.teamIdAtVisit===team.id),
      'Original team attribution preserved in report');
    assert.ok(companyReport.data.rows.some(x=>x.teamIdAtVisit===rivalTeam.id),
      'New team attribution visible independently');
    const oldTeamReport=await call(url,'GET',null,oldManagerSession.cookie);
    assert.equal(oldTeamReport.status,200);
    assert.ok(oldTeamReport.data.rows.length>0);
    assert.ok(oldTeamReport.data.rows.every(x=>x.teamIdAtVisit===team.id),
      'Team manager can access historic visits of their team, not other teams');
    const foreignCompanyReport=await call(url,'GET',null,foreignLogin.cookie);
    assert.equal(foreignCompanyReport.status,200);
    assert.equal(foreignCompanyReport.data.total,0,
      'No foreign-company visit history may leak to another company');
    const excelUrl='/api/reports/visits.xlsx?from='+reportDate+'&to='+reportDate;
    const unauthorizedExport=await fetch(base+excelUrl,{
      headers:{Cookie:rl.cookie}
    });
    assert.equal(unauthorizedExport.status,403);
    const workbookResponse=await fetch(base+excelUrl,{headers:{Cookie:al.cookie}});
    assert.equal(workbookResponse.status,200);
    assert.match(workbookResponse.headers.get('content-type')||'',/spreadsheetml/);
    const exportedBuffer=Buffer.from(await workbookResponse.arrayBuffer());
    const downloaded=new (require('exceljs')).Workbook();
    await downloaded.xlsx.load(exportedBuffer);
    assert.equal(downloaded.worksheets[0].rowCount,expectedTours+1,
      'Excel export has one header plus one row per scoped tour');
    assert.equal(downloaded.worksheets[0].getRow(2).getCell(3).value.length>0,true);

    // Legacy specialty list remains company-scoped and frequency can be exported.
    await prisma.doctor.create({data:{
      companyId:cb.id,areaId:ab.id,name:'Private specialization doctor '+seed,
      specialty:'Private specialty '+seed
    }});
    const companySpecialties=await call('/specialties','GET',null,al.cookie);
    assert.equal(companySpecialties.status,200);
    assert.ok(companySpecialties.data.includes('Cardiology'));
    assert.equal(companySpecialties.data.includes('Private specialty '+seed),false);
    const otherSpecialties=await call('/specialties','GET',null,foreignLogin.cookie);
    assert.equal(otherSpecialties.status,200);
    assert.ok(otherSpecialties.data.includes('Private specialty '+seed));
    assert.equal((await call('/specialties')).status,401);
    await prisma.doctor.create({data:{
      companyId:ca.id,areaId:aa.id,name:'=10+20',
      specialty:'Cardiology',grade:'C'
    }});
    const currentFrequency=await call('/analytics/frequency','GET',null,al.cookie);
    assert.equal(currentFrequency.status,200);
    const frequencyXlsx=await fetch(base+'/api/analytics/frequency.xlsx',{
      headers:{Cookie:al.cookie}
    });
    assert.equal(frequencyXlsx.status,200);
    assert.match(frequencyXlsx.headers.get('content-type')||'',/spreadsheetml/);
    const frequencyWorkbook=new (require('exceljs')).Workbook();
    await frequencyWorkbook.xlsx.load(Buffer.from(await frequencyXlsx.arrayBuffer()));
    const frequencySheet=frequencyWorkbook.worksheets[0];
    assert.equal(frequencySheet.rowCount,currentFrequency.data.total+1);
    const formulaRow=frequencySheet.getRows(2,frequencySheet.rowCount-1)
      .find(row=>row.getCell(2).value==="'=10+20");
    assert.ok(formulaRow,'Doctor name is exported as inert text, not an Excel formula');
    const frequencyForbidden=await fetch(base+'/api/analytics/frequency.xlsx',{
      headers:{Cookie:foreignLogin.cookie}
    });
    assert.equal(frequencyForbidden.status,200,
      'Other company admin may export their own report, not global report');
    const foreignFrequencyBook=new (require('exceljs')).Workbook();
    await foreignFrequencyBook.xlsx.load(Buffer.from(await frequencyForbidden.arrayBuffer()));
    const foreignDoctorNames=foreignFrequencyBook.worksheets[0].getColumn(2).values;
    assert.equal(foreignDoctorNames.includes("'=10+20"),false,'Cross company isolation in Excel');

    // Read-only doctor targeting preserves legacy TEAM/CUSTOM lists without changing visit writes.
    await prisma.teamSpecialty.upsert({
      where:{teamId_specialty:{teamId:team.id,specialty:'Cardiology'}},
      update:{},create:{teamId:team.id,specialty:'Cardiology'}
    });
    const teamDoctors=await call('/reps/'+customId+'/doctors','GET',null,al.cookie);
    assert.equal(teamDoctors.status,200,JSON.stringify(teamDoctors.data));
    assert.ok(teamDoctors.data.some(d=>d.id===da.id));
    assert.equal((await call('/reps/'+customId+'/doctors','GET',null,ol.cookie)).status,404);
    assert.equal((await call('/reps/'+customId+'/doctors','GET',null,rl.cookie)).status,403);
    const customChanged=await call('/users/'+customId,'PATCH',{
      specialtyMode:'CUSTOM',customSpecialties:['Other field']
    },al.cookie);
    assert.equal(customChanged.status,200);
    const customDoctorList=await call('/reps/'+customId+'/doctors','GET',null,al.cookie);
    assert.deepEqual(customDoctorList.data,[],
      'CUSTOM doctor targets must not silently fall back to team specialties');
    const legacySaturdayCheck=await call('/weekly-visits-count?repId='+rep.id+
      '&onDate='+body.visitDate,'GET',null,al.cookie);
    assert.equal(legacySaturdayCheck.status,200);
    assert.equal(new Date(legacySaturdayCheck.data.start+'T00:00:00Z').getUTCDay(),6);
    assert.equal(new Date(legacySaturdayCheck.data.end+'T00:00:00Z').getUTCDay(),5);
    assert.ok(legacySaturdayCheck.data.count>=legacySaturdayCheck.data.visits);
    assert.equal(legacySaturdayCheck.data.repId,rep.id);
    assert.equal((await call('/weekly-visits-count?repId='+rep.id+
      '&onDate='+body.visitDate,'GET',null,rl.cookie)).status,200);
    assert.equal((await call('/weekly-visits-count?repId='+rep.id+
      '&onDate=not-a-date','GET',null,al.cookie)).status,400);
    assert.equal((await call('/weekly-visits-count?repId='+rep.id,
      'GET',null,foreignLogin.cookie)).status,404);
    assert.equal((await call('/weekly-visits-count?repId='+customId,
      'GET',null,rl.cookie)).status,403);
    const companyBWeekly=await call('/weekly-visits-count?repId='+other.id+
      '&onDate='+body.visitDate,'GET',null,foreignLogin.cookie);
    assert.equal(companyBWeekly.status,200);
    assert.equal(companyBWeekly.data.count,0);
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
