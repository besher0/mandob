'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

// Maintain an explicit executable permission matrix for every active v2 route.
// New routes must be added here, otherwise this test fails before issuing requests.
const matrix=[
  ['GET','/api/companies','S'],
  ['POST','/api/companies','S'],
  ['POST','/api/companies/:id/admins','S'],
  ['GET','/api/dashboard','AMR'],
  ['GET','/api/specialties','AMR'],
  ['GET','/api/teams','AM'],
  ['PATCH','/api/manager/team','M'],
  ['POST','/api/manager/reps','M'],
  ['PATCH','/api/manager/reps/:id','M'],
  ['POST','/api/manager/areas','M'],
  ['PATCH','/api/manager/areas/:id','M'],
  ['GET','/api/manager/team-weekly-activity','M'],
  ['GET','/api/manager/reps/:id/detail','M'],
  ['GET','/api/manager/areas/:id/performance','M'],
  ['GET','/api/manager/medical-stats','M'],
  ['POST','/api/teams','A'],
  ['PATCH','/api/teams/:id','A'],
  ['PATCH','/api/teams/:id/instructions','AM'],
  ['GET','/api/users','AM'],
  ['POST','/api/users','A'],
  ['PATCH','/api/users/:id','A'],
  ['GET','/api/area-groups','AM'],
  ['POST','/api/area-groups','A'],
  ['GET','/api/reps/:repId/doctors','AMR'],
  ['GET','/api/weekly-visits-count','AMR'],
  ['GET','/api/areas','AMR'],
  ['POST','/api/areas','A'],
  ['PATCH','/api/areas/:id','A'],
  ['GET','/api/areas/:id/details','AM'],
  ['GET','/api/doctors','AMR'],
  ['POST','/api/doctors','AM'],
  ['POST','/api/doctors/import/preview','A'],
  ['POST','/api/doctors/import/commit','A'],
  ['PATCH','/api/doctors/:id','A'],
  ['PATCH','/api/doctors/:id/status','A'],
  ['GET','/api/pharmacies','AMR'],
  ['POST','/api/pharmacies','AM'],
  ['PATCH','/api/pharmacies/:id','A'],
  ['PATCH','/api/pharmacies/:id/status','A'],
  ['GET','/api/hospitals','AMR'],
  ['POST','/api/hospitals','AM'],
  ['PATCH','/api/hospitals/:id','A'],
  ['PATCH','/api/hospitals/:id/status','A'],
  ['GET','/api/products','AMR'],
  ['GET','/api/rep-plan','R'],
  ['GET','/api/rep-workspace-summary','R'],
  ['GET','/api/rep-report','R'],
  ['POST','/api/rep-reports','R'],
  ['GET','/api/rep-reports','AMR'],
  ['GET','/api/rep-reports/:id','AMR'],
  ['POST','/api/products','A'],
  ['PATCH','/api/products/:id','A'],
  ['GET','/api/reports/medical.xlsx','A'],
  ['GET','/api/reports/visits','AM'],
  ['GET','/api/reports/visits.xlsx','AM'],
  ['GET','/api/visits','AMR'],
  ['POST','/api/visits','R'],
  ['GET','/api/rep-leave-balance','R'],
  ['GET','/api/leaves','AMR'],
  ['POST','/api/leaves','R'],
  ['GET','/api/leaves/:id/attachment','AMR'],
  ['PATCH','/api/leaves/:id/status','AM'],
  ['GET','/api/settings','AMR'],
  ['PATCH','/api/settings','A'],
  ['GET','/api/doctor-goals','A'],
  ['PUT','/api/doctor-goals','A'],
  ['GET','/api/analytics/frequency.xlsx','AMR'],
  ['GET','/api/analytics/frequency','AMR'],
  ['GET','/api/analytics/area-coverage','AMR'],
  ['GET','/api/analytics/product-performance','R'],
  ['GET','/api/analytics/product-performance/:id','R'],
  ['GET','/api/analytics/cycles','R'],
  ['GET','/api/analytics/rep-overview','R']
];

test('v2 API route inventory and role/tenant authorization matrix',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:180000
},async()=>{
  const routes=fs.readFileSync(path.join(__dirname,'../src/routes.js'),'utf8');
  const registered=new Set([...routes.matchAll(/route\('(get|post|patch|put|delete)','(\/api\/[^']+)'/g)]
    .map(match=>match[1].toUpperCase()+' '+match[2]));
  for(const kind of ['doctors','pharmacies','hospitals'])
    registered.add('PATCH /api/'+kind+'/:id');
  registered.add('POST /api/doctors/import/preview');
  assert.deepEqual([...registered].sort(),
    matrix.map(([method,url])=>method+' '+url).sort(),
    'New/removed API routes require an explicit role-matrix review');

  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const seed=randomUUID().slice(0,8),password='RbacMatrixPassword!2026';
  const companyIds=[],globalUserIds=[];
  async function call(url,method='GET',body=null,cookie=null){
    const headers={};
    if(cookie)headers.Cookie=cookie;
    if(method!=='GET'){
      headers.Origin='http://localhost:5173';
      headers['Content-Type']='application/json';
    }
    const response=await fetch(base+url,{method,headers,
      body:method==='GET'?undefined:JSON.stringify(body??{})});
    const bytes=Buffer.from(await response.arrayBuffer());
    let data=null;
    if((response.headers.get('content-type')||'').includes('application/json'))
      data=JSON.parse(bytes.toString('utf8'));
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const [ca,cb]=await Promise.all([
      prisma.company.create({data:{name:'RBAC-A-'+seed,settings:{create:{}}}}),
      prisma.company.create({data:{name:'RBAC-B-'+seed,settings:{create:{}}}})
    ]);
    companyIds.push(ca.id,cb.id);
    const teamA=await prisma.team.create({data:{companyId:ca.id,
      name:'Visible team '+seed,specialties:{create:[{specialty:'Cardiology'}]}}});
    const teamOther=await prisma.team.create({data:{companyId:ca.id,name:'Other team '+seed}});
    const foreignTeam=await prisma.team.create({data:{companyId:cb.id,name:'Foreign team '+seed}});
    const shared=await prisma.areaGroup.create({data:{companyId:ca.id,name:'Shared '+seed}});
    const privateGroup=await prisma.areaGroup.create({data:{companyId:ca.id,name:'Private '+seed}});
    const foreignGroup=await prisma.areaGroup.create({data:{companyId:cb.id,name:'Foreign '+seed}});
    const a1=await prisma.area.create({data:{companyId:ca.id,groupId:shared.id,name:'Visible area '+seed}});
    const a2=await prisma.area.create({data:{companyId:ca.id,groupId:shared.id,name:'Other area '+seed}});
    const a3=await prisma.area.create({data:{companyId:ca.id,groupId:privateGroup.id,name:'Private area '+seed}});
    const b1=await prisma.area.create({data:{companyId:cb.id,groupId:foreignGroup.id,name:'Foreign area '+seed}});
    const doctor=await prisma.doctor.create({data:{companyId:ca.id,areaId:a1.id,
      name:'Visible doctor '+seed,specialty:'Cardiology'}});
    const otherDoctor=await prisma.doctor.create({data:{companyId:ca.id,areaId:a2.id,
      name:'Other doctor '+seed,specialty:'Cardiology'}});
    const foreignDoctor=await prisma.doctor.create({data:{companyId:cb.id,areaId:b1.id,
      name:'Foreign doctor '+seed,specialty:'Cardiology'}});
    const archivedDoctor=await prisma.doctor.create({data:{companyId:ca.id,areaId:a1.id,
      name:'Archived doctor '+seed,specialty:'Cardiology',active:false}});
    await prisma.pharmacy.create({data:{companyId:ca.id,areaId:a1.id,name:'Visible pharmacy '+seed}});
    const archivedPharmacy=await prisma.pharmacy.create({data:{companyId:ca.id,areaId:a1.id,
      name:'Archived pharmacy '+seed,active:false}});
    await prisma.pharmacy.create({data:{companyId:ca.id,areaId:a2.id,name:'Other pharmacy '+seed}});
    await prisma.hospital.create({data:{companyId:ca.id,areaId:a1.id,name:'Visible hospital '+seed}});
    const archivedHospital=await prisma.hospital.create({data:{companyId:ca.id,areaId:a1.id,
      name:'Archived hospital '+seed,active:false}});
    await prisma.hospital.create({data:{companyId:ca.id,areaId:a2.id,name:'Other hospital '+seed}});
    const root=await prisma.user.create({data:{name:'Root',role:'SUPER_ADMIN',
      username:'rbac-root-'+seed,passwordHash:hashPassword(password)}});
    globalUserIds.push(root.id);
    const admin=await prisma.user.create({data:{name:'Company admin',role:'COMPANY_ADMIN',
      companyId:ca.id,username:'rbac-admin-'+seed,passwordHash:hashPassword(password)}});
    const foreignAdmin=await prisma.user.create({data:{name:'Foreign admin',role:'COMPANY_ADMIN',
      companyId:cb.id,username:'rbac-foreign-'+seed,passwordHash:hashPassword(password)}});
    const manager=await prisma.user.create({data:{name:'Manager',role:'TEAM_MANAGER',
      companyId:ca.id,teamId:teamA.id,username:'rbac-manager-'+seed,passwordHash:hashPassword(password)}});
    const rep=await prisma.user.create({data:{name:'Representative',role:'REP',
      companyId:ca.id,teamId:teamA.id,username:'rbac-rep-'+seed,passwordHash:hashPassword(password)}});
    const otherRep=await prisma.user.create({data:{name:'Other representative',role:'REP',
      companyId:ca.id,teamId:teamOther.id,username:'rbac-other-'+seed,passwordHash:hashPassword(password)}});
    await prisma.repArea.createMany({data:[
      {repId:rep.id,areaId:a1.id},{repId:otherRep.id,areaId:a2.id},
      // A TEAM_MANAGER may have a legacy RepArea row: it must not grant
      // visibility that belongs only to assigned REP accounts.
      {repId:manager.id,areaId:a3.id}
    ]});
    const users={S:root,A:admin,M:manager,R:rep};
    const cookies={};
    for(const [role,user] of Object.entries(users)){
      const login=await call('/api/login','POST',{username:user.username,password});
      assert.equal(login.status,200,'Login failed for '+role);
      cookies[role]=login.cookie;
      assert.ok(cookies[role]);
    }
    const loginB=await call('/api/login','POST',{username:foreignAdmin.username,password});
    assert.equal(loginB.status,200);

    function resolveUrl(url){
      let result=url.replace('/companies/:id/', '/companies/'+ca.id+'/')
        .replace('/manager/reps/:id','/manager/reps/'+rep.id)
        .replace('/manager/areas/:id','/manager/areas/'+a1.id)
        .replace('/teams/:id','/teams/'+teamA.id)
        .replace('/users/:id','/users/'+rep.id)
        .replace('/areas/:id','/areas/'+a1.id)
        .replace('/doctors/:id','/doctors/'+doctor.id)
        .replace('/pharmacies/:id','/pharmacies/'+randomUUID())
        .replace('/hospitals/:id','/hospitals/'+randomUUID())
        .replace('/leaves/:id','/leaves/'+randomUUID())
        .replace('/rep-reports/:id','/rep-reports/'+randomUUID())
        .replace('/reps/:repId','/reps/'+rep.id);
      if(result==='/api/weekly-visits-count')result+='?repId='+rep.id;
      return result;
    }
    let checks=0;
    for(const [method,pattern,allowed] of matrix){
      const url=resolveUrl(pattern);
      const anonymous=await call(url,method);
      assert.equal(anonymous.status,401,
        'Unauthenticated '+method+' '+pattern+' returned '+anonymous.status);
      checks++;
      for(const role of ['S','A','M','R']){
        // Force validation failure for optional PATCH payloads so this matrix
        // stays read-only even for roles authorized to edit user/settings data.
        const payload=method==='PATCH'&&pattern==='/api/users/:id'?{name:null}:
          method==='PATCH'&&pattern==='/api/settings'?{frequencyA:null}:{};
        const result=await call(url,method,payload,cookies[role]);
        if(allowed.includes(role)) {
          assert.notEqual(result.status,403,
            role+' allowed by matrix but denied '+method+' '+pattern);
          assert.notEqual(result.status,401,
            role+' authenticated but rejected '+method+' '+pattern);
          assert.ok(result.status<500,
            role+' '+method+' '+pattern+' produced server error '+result.status);
        } else {
          assert.equal(result.status,403,
            role+' should be forbidden '+method+' '+pattern+
            ', actual '+result.status+': '+JSON.stringify(result.data));
        }
        checks++;
      }
    }
    assert.equal(checks,matrix.length*5);
    // Persist a server-calculated snapshot, then enforce company/team/rep access.
    const submission=await call('/api/rep-reports','POST',
      {from:'2026-11-01',to:'2026-11-17'},cookies.R);
    assert.equal(submission.status,201,JSON.stringify(submission.data));
    assert.ok(submission.data.id);
    const owned=await call('/api/rep-reports/'+submission.data.id,'GET',null,cookies.R);
    assert.equal(owned.status,200);
    assert.equal(owned.data.snapshot.tours,0);
    assert.equal(owned.data.snapshot.totalTargets,0);
    const repReportListing=await call('/api/rep-reports','GET',null,cookies.R);
    const reportItem=repReportListing.data.find(row=>row.id===submission.data.id);
    assert.ok(reportItem,'Submitted report is present in the representative list');
    assert.equal(reportItem.totalTargets,0);
    assert.equal(reportItem.tours,0);
    assert.equal((await call('/api/rep-reports','GET',null,cookies.M)).data
      .some(report=>report.id===submission.data.id),true);
    assert.equal((await call('/api/rep-reports/'+submission.data.id,'GET',null,cookies.M)).status,200);
    assert.equal((await call('/api/rep-reports/'+submission.data.id,'GET',null,cookies.A)).status,200);
    assert.equal((await call('/api/rep-reports/'+submission.data.id,'GET',null,loginB.cookie)).status,404);
    const otherLogin=await call('/api/login','POST',{username:otherRep.username,password});
    assert.equal(otherLogin.status,200);
    assert.equal((await call('/api/rep-reports/'+submission.data.id,'GET',null,otherLogin.cookie)).status,404);
    assert.equal((await call('/api/rep-reports','GET',null,otherLogin.cookie)).data.length,0);
    assert.equal((await call('/api/me','GET',null,cookies.R)).status,200);
    assert.equal((await call('/api/me')).status,401);


    // Live feature parity: manager notes and product priority must reach the
    // representative's read-only plan, without weakening company isolation.
    const teamNote='Follow assigned cardiologists first '+seed;
    const instructionUpdate=await call('/api/teams/'+teamA.id+'/instructions','PATCH',
      {managerInstructions:teamNote},cookies.M);
    assert.equal(instructionUpdate.status,200,JSON.stringify(instructionUpdate.data));
    assert.equal(instructionUpdate.data.managerInstructions,teamNote);
    assert.equal((await call('/api/teams/'+teamOther.id+'/instructions','PATCH',
      {managerInstructions:'unauthorized'},cookies.M)).status,403);
    assert.equal((await call('/api/teams/'+teamA.id+'/instructions','PATCH',
      {},cookies.M)).status,400,
      'Missing note field must not erase the existing note');
    const coverageSettings=await call('/api/settings','PATCH',
      {targetACoverage:85,managerInstructions:'Company fallback'},cookies.A);
    assert.equal(coverageSettings.status,200,JSON.stringify(coverageSettings.data));
    const newProduct=await call('/api/products','POST',{
      name:'Priority item '+seed,activeIngredient:'Active ingredient',
      priority:'PRIMARY',targetSpecialties:['Cardiology','Internal medicine']
    },cookies.A);
    assert.equal(newProduct.status,201,JSON.stringify(newProduct.data));
    await prisma.teamProduct.create({data:{teamId:teamA.id,productId:newProduct.data.id}});
    const planResponse=await call('/api/rep-plan','GET',null,cookies.R);
    assert.equal(planResponse.status,200,JSON.stringify(planResponse.data));
    assert.equal(planResponse.data.managerInstructions,teamNote);
    assert.equal(planResponse.data.targetACoverage,85);
    assert.deepEqual(planResponse.data.products.map(item=>[
      item.id,item.priority,item.targetSpecialties
    ]),[[newProduct.data.id,'PRIMARY',['Cardiology','Internal medicine']]]);
    assert.equal((await call('/api/products/'+newProduct.data.id,'PATCH',
      {priority:'SECONDARY'},cookies.R)).status,403);
    assert.equal((await call('/api/products/'+newProduct.data.id,'PATCH',
      {priority:'SECONDARY'},cookies.A)).status,200);

    // Leave attachments are private bytes and must be invisible to other
    // teams, tenants and unauthenticated visitors.
    const medicalPdf=Buffer.from('%PDF-1.7\\nMedical leave document\\n','utf8');
    const attachedLeave=await call('/api/leaves','POST',{
      type:'مرضية',fromDate:'2026-11-21',toDate:'2026-11-22',
      reason:'Medical appointment',
      attachment:{fileName:'doctor-note.pdf',mimeType:'application/pdf',
        base64:medicalPdf.toString('base64')}
    },cookies.R);
    assert.equal(attachedLeave.status,201,JSON.stringify(attachedLeave.data));
    const attachmentPath='/api/leaves/'+attachedLeave.data.id+'/attachment';
    const attachmentsList=await call('/api/leaves','GET',null,cookies.R);
    assert.equal(attachmentsList.status,200);
    assert.equal(attachmentsList.data.find(row=>row.id===attachedLeave.data.id)
      ?.attachment?.fileName,'doctor-note.pdf');
    for(const cookie of [cookies.R,cookies.M,cookies.A]){
      const response=await fetch(base+attachmentPath,{headers:{Cookie:cookie}});
      assert.equal(response.status,200,'Authorized role did not receive attachment');
      assert.equal(response.headers.get('content-type'),'application/pdf');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),medicalPdf);
    }
    assert.equal((await call(attachmentPath,'GET')).status,401);
    assert.equal((await call(attachmentPath,'GET',null,otherLogin.cookie)).status,404);
    assert.equal((await call(attachmentPath,'GET',null,loginB.cookie)).status,404);
    assert.equal((await call(attachmentPath,'GET',null,cookies.S)).status,403);

    const managerGroups=await call('/api/area-groups','GET',null,cookies.M);
    assert.equal(managerGroups.status,200);
    assert.deepEqual(managerGroups.data.map(g=>g.id),[shared.id]);
    assert.equal(managerGroups.data[0]._count.areas,1,
      'Team manager must see only their one assigned REP area, not 2 company areas');
    const adminGroups=await call('/api/area-groups','GET',null,cookies.A);
    assert.equal(adminGroups.status,200);
    assert.equal(adminGroups.data.find(g=>g.id===shared.id)._count.areas,2);
    assert.equal(adminGroups.data.some(g=>g.id===privateGroup.id),true);
    assert.equal(adminGroups.data.some(g=>g.id===foreignGroup.id),false);
    const foreignGroups=await call('/api/area-groups','GET',null,loginB.cookie);
    assert.deepEqual(foreignGroups.data.map(g=>g.id),[foreignGroup.id]);
    assert.equal((await call('/api/area-groups','GET',null,cookies.R)).status,403);

    const visibleAreas=await call('/api/areas','GET',null,cookies.M);
    assert.deepEqual(visibleAreas.data.map(area=>area.id),[a1.id]);
    const managerDoctors=await call('/api/doctors','GET',null,cookies.M);
    assert.deepEqual(managerDoctors.data.map(d=>d.id),[doctor.id]);
    const managerPharmacies=await call('/api/pharmacies','GET',null,cookies.M);
    assert.equal(managerPharmacies.data.length,1);
    const managerHospitals=await call('/api/hospitals','GET',null,cookies.M);
    assert.equal(managerHospitals.data.length,1);
    const managerDetails=await call('/api/areas/'+a1.id+'/details','GET',null,cookies.M);
    assert.equal(managerDetails.status,200);
    assert.equal(managerDetails.data.doctors.some(x=>x.id===archivedDoctor.id),false);
    assert.equal(managerDetails.data.pharmacies.some(x=>x.id===archivedPharmacy.id),false);
    assert.equal(managerDetails.data.hospitals.some(x=>x.id===archivedHospital.id),false);
    const adminDetails=await call('/api/areas/'+a1.id+'/details','GET',null,cookies.A);
    assert.equal(adminDetails.status,200);
    assert.ok(adminDetails.data.doctors.some(x=>x.id===archivedDoctor.id));
    assert.ok(adminDetails.data.pharmacies.some(x=>x.id===archivedPharmacy.id));
    assert.ok(adminDetails.data.hospitals.some(x=>x.id===archivedHospital.id));
    assert.equal((await call('/api/areas/'+a2.id+'/details','GET',null,cookies.M)).status,404);
    assert.equal((await call('/api/areas/'+a3.id+'/details','GET',null,cookies.M)).status,404);
    assert.equal((await call('/api/areas/'+b1.id+'/details','GET',null,cookies.A)).status,404);
    assert.equal((await call('/api/reps/'+otherRep.id+'/doctors','GET',null,cookies.M)).status,403);
    assert.equal((await call('/api/weekly-visits-count?repId='+otherRep.id,
      'GET',null,cookies.M)).status,403);
    assert.equal((await call('/api/doctors?includeArchived=true','GET',null,cookies.M)).status,403);
    assert.deepEqual((await call('/api/visits?repId='+otherRep.id,'GET',null,cookies.M)).data,[]);
    assert.deepEqual((await call('/api/leaves?repId='+otherRep.id,'GET',null,cookies.M)).data,[]);
    assert.equal((await call('/api/visits?repId='+otherRep.id,'GET',null,cookies.R)).status,403);
    assert.equal((await call('/api/leaves?repId='+otherRep.id,'GET',null,cookies.R)).status,403);

    // End-to-end legacy manager controls, after the initial read-isolation checks.
    // Mutations remain inside the currently assigned team and areas only.
    const managerRepCreate=await call('/api/manager/reps','POST',{
      name:'New managed rep '+seed,username:'managed-rep-'+seed,password,
      dailyTarget:7,areaIds:[a1.id],specialtyMode:'TEAM',customSpecialties:[]
    },cookies.M);
    assert.equal(managerRepCreate.status,201,JSON.stringify(managerRepCreate.data));
    const managedRepId=managerRepCreate.data.user.id;
    assert.equal((await prisma.user.findUnique({where:{id:managedRepId}})).teamId,teamA.id);
    const managerRepUpdate=await call('/api/manager/reps/'+managedRepId,'PATCH',{
      dailyTarget:9,annualLeaveBalance:15,areaIds:[a1.id]
    },cookies.M);
    assert.equal(managerRepUpdate.status,200,JSON.stringify(managerRepUpdate.data));
    assert.equal(managerRepUpdate.data.user.dailyTarget,9);
    assert.equal(managerRepUpdate.data.user.annualLeaveBalance,15);
    assert.equal((await call('/api/manager/reps/'+otherRep.id,'PATCH',
      {dailyTarget:12},cookies.M)).status,404);
    assert.equal((await call('/api/manager/reps/'+managedRepId,'PATCH',
      {areaIds:[a2.id]},cookies.M)).status,403);

    const teamEdit=await call('/api/manager/team','PATCH',{
      specialties:['Cardiology','Internal medicine'],
      productIds:[newProduct.data.id]
    },cookies.M);
    assert.equal(teamEdit.status,200,JSON.stringify(teamEdit.data));
    assert.deepEqual(teamEdit.data.specialties.map(x=>x.specialty).sort(),
      ['Cardiology','Internal medicine']);
    const areaCreate=await call('/api/manager/areas','POST',{
      name:'Managed area '+seed,city:'Aleppo',
      newGroupName:'Managed group '+seed,repIds:[rep.id]
    },cookies.M);
    assert.equal(areaCreate.status,201,JSON.stringify(areaCreate.data));
    const managedAreaId=areaCreate.data.id;
    const updatedArea=await call('/api/manager/areas/'+managedAreaId,'PATCH',
      {name:'Updated managed area '+seed},cookies.M);
    assert.equal(updatedArea.status,200,JSON.stringify(updatedArea.data));
    assert.equal((await call('/api/manager/areas/'+a2.id,'PATCH',
      {name:'Denied'},cookies.M)).status,404);
    assert.equal((await call('/api/manager/areas','POST',{
      name:'Forbidden area '+seed,repIds:[otherRep.id]
    },cookies.M)).status,403);
    const areaPerformance=await call('/api/manager/areas/'+managedAreaId+'/performance',
      'GET',null,cookies.M);
    assert.equal(areaPerformance.status,200,JSON.stringify(areaPerformance.data));
    assert.equal(areaPerformance.data.reps.length,1);

    const newManagedDoctor=await call('/api/doctors','POST',{
      areaId:a1.id,name:'Manager doctor '+seed,specialty:'Cardiology',grade:'A'
    },cookies.M);
    assert.equal(newManagedDoctor.status,201,JSON.stringify(newManagedDoctor.data));
    const newManagedPharmacy=await call('/api/pharmacies','POST',{
      areaId:a1.id,name:'Manager pharmacy '+seed,grade:'A',kind:'مستقلة',target:4
    },cookies.M);
    assert.equal(newManagedPharmacy.status,201,JSON.stringify(newManagedPharmacy.data));
    const newManagedHospital=await call('/api/hospitals','POST',{
      areaId:a1.id,name:'Manager hospital '+seed,category:'خاص',
      specialty:'عام',target:4
    },cookies.M);
    assert.equal(newManagedHospital.status,201,JSON.stringify(newManagedHospital.data));
    assert.equal((await call('/api/doctors','POST',{
      areaId:a2.id,name:'Outside area '+seed,specialty:'Cardiology'
    },cookies.M)).status,403);
    assert.equal((await call('/api/pharmacies','POST',{
      areaId:a2.id,name:'Outside pharmacy '+seed
    },cookies.M)).status,403);
    assert.equal((await call('/api/hospitals','POST',{
      areaId:a2.id,name:'Outside hospital '+seed
    },cookies.M)).status,403);
    const medicalStats=await call('/api/manager/medical-stats?kind=doctors',
      'GET',null,cookies.M);
    assert.equal(medicalStats.status,200,JSON.stringify(medicalStats.data));
    assert.ok(Array.isArray(medicalStats.data));
    assert.equal((await call('/api/manager/reps/'+managedRepId+
      '/detail?period=week&onDate=2026-11-20','GET',null,cookies.M)).status,200);
    const weekActivity=await call('/api/manager/team-weekly-activity?onDate=2026-11-20',
      'GET',null,cookies.M);
    assert.equal(weekActivity.status,200,JSON.stringify(weekActivity.data));
    assert.equal(weekActivity.data.days.length,7);
    assert.equal((await call('/api/manager/medical-stats?kind=doctors',
      'GET',null,cookies.A)).status,403);
    assert.equal((await call('/api/manager/areas/'+managedAreaId+'/performance',
      'GET',null,loginB.cookie)).status,403);

    // Denied cross-tenant writes must not mutate records or emit audit entries.
    const before=await prisma.auditLog.count({where:{companyId:ca.id}});
    assert.equal((await call('/api/doctors/'+foreignDoctor.id+'/status',
      'PATCH',{active:false},cookies.A)).status,404);
    assert.equal((await call('/api/doctor-goals','PUT',{
      scope:'TEAM',ownerId:teamA.id,doctorId:foreignDoctor.id,target:5
    },cookies.A)).status,404);
    assert.equal((await call('/api/users','POST',{
      role:'REP',name:'Invalid foreign assignment',username:'invalid-'+seed,
      password,teamId:foreignTeam.id
    },cookies.A)).status,400);
    assert.equal(await prisma.auditLog.count({where:{companyId:ca.id}}),before,
      'Denied cross-tenant mutations must have no audit records');
    assert.equal((await prisma.doctor.findUnique({where:{id:foreignDoctor.id}})).active,true);
    assert.equal(await prisma.user.count({where:{username:'invalid-'+seed}}),0);
    assert.equal(await prisma.doctorVisitGoal.count({where:{companyId:ca.id}}),0);
    assert.equal((await call('/api/doctors','GET',null,loginB.cookie)).data
      .some(d=>d.id===doctor.id||d.id===otherDoctor.id),false);
  }finally{
    const companies={in:companyIds};
    try{
      await prisma.authSession.deleteMany({where:{userId:{in:globalUserIds}}});
      await prisma.auditLog.deleteMany({where:{actorId:{in:globalUserIds}}});
      await prisma.authSession.deleteMany({where:{user:{companyId:companies}}});
      await prisma.auditLog.deleteMany({where:{companyId:companies}});
      await prisma.doctorVisitGoal.deleteMany({where:{companyId:companies}});
      await prisma.doctorImportBatch.deleteMany({where:{companyId:companies}});
      await prisma.leaveRequest.deleteMany({where:{companyId:companies}});
      await prisma.repReportSubmission.deleteMany({where:{companyId:companies}});
      await prisma.visitTarget.deleteMany({where:{visit:{companyId:companies}}});
      await prisma.visit.deleteMany({where:{companyId:companies}});
      await prisma.repArea.deleteMany({where:{rep:{companyId:companies}}});
      await prisma.user.deleteMany({where:{companyId:companies}});
      await prisma.doctor.deleteMany({where:{companyId:companies}});
      await prisma.pharmacy.deleteMany({where:{companyId:companies}});
      await prisma.hospital.deleteMany({where:{companyId:companies}});
      await prisma.product.deleteMany({where:{companyId:companies}});
      await prisma.areaGroup.deleteMany({where:{companyId:companies}});
      await prisma.area.deleteMany({where:{companyId:companies}});
      await prisma.team.deleteMany({where:{companyId:companies}});
      await prisma.company.deleteMany({where:{id:companies}});
      await prisma.user.deleteMany({where:{id:{in:globalUserIds}}});
    }finally{
      await new Promise(resolve=>server.close(resolve));
      await prisma.$disconnect();
    }
  }
});
