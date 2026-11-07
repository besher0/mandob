'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

test('PostgreSQL preserves real area for each visit target and de-duplicates team goals',{
  skip:process.env.RUN_DB_TESTS!=='1',timeout:100000
},async()=>{
  const {app}=require('../src/app');
  const {prisma,hashPassword}=require('../src/auth');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const seed=randomUUID().slice(0,8);
  const ids=[],password='AreaCoverageSecurity!2026';
  async function call(path,method='GET',body=null,cookie){
    const response=await fetch(base+'/api'+path,{
      method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?
        {'Content-Type':'application/json',Origin:'http://localhost:5173'}:{})},
      body:method==='GET'?undefined:JSON.stringify(body??{})
    });
    return {status:response.status,data:await response.json().catch(()=>({})),
      cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    const company=await prisma.company.create({data:{name:'Area Test '+seed,settings:{create:{}}}});
    const foreign=await prisma.company.create({data:{name:'Area Foreign '+seed,settings:{create:{}}}});
    ids.push(company.id,foreign.id);
    const team=await prisma.team.create({data:{companyId:company.id,name:'North team',
      specialties:{create:{specialty:'Cardiology'}}}});
    const teamTwo=await prisma.team.create({data:{companyId:company.id,name:'Other team',
      specialties:{create:{specialty:'Cardiology'}}}});
    const [north,south,unrelated,otherCompany]=await Promise.all([
      prisma.area.create({data:{companyId:company.id,name:'North '+seed}}),
      prisma.area.create({data:{companyId:company.id,name:'South '+seed}}),
      prisma.area.create({data:{companyId:company.id,name:'Unrelated '+seed}}),
      prisma.area.create({data:{companyId:foreign.id,name:'Foreign '+seed}})
    ]);
    const doctor=await prisma.doctor.create({data:{companyId:company.id,
      areaId:north.id,name:'Shared physician',specialty:'Cardiology',grade:'A'}});
    await prisma.doctorArea.create({data:{doctorId:doctor.id,areaId:south.id}});
    // Each entity directory has different area visibility; the representative
    // must never be able to query an unrelated or foreign area by ID.
    const [northPharmacy,southPharmacy,northHospital,southHospital]=await Promise.all([
      prisma.pharmacy.create({data:{companyId:company.id,areaId:north.id,name:'North pharmacy'}}),
      prisma.pharmacy.create({data:{companyId:company.id,areaId:south.id,name:'South pharmacy'}}),
      prisma.hospital.create({data:{companyId:company.id,areaId:north.id,name:'North hospital'}}),
      prisma.hospital.create({data:{companyId:company.id,areaId:south.id,name:'South hospital'}})
    ]);
    const admin=await prisma.user.create({data:{companyId:company.id,
      username:'area-admin-'+seed,name:'Admin',role:'COMPANY_ADMIN',passwordHash:hashPassword(password)}});
    const manager=await prisma.user.create({data:{companyId:company.id,teamId:team.id,
      username:'area-manager-'+seed,name:'Manager',role:'TEAM_MANAGER',passwordHash:hashPassword(password)}});
    const rep=await prisma.user.create({data:{companyId:company.id,teamId:team.id,
      username:'area-rep-'+seed,name:'Representative',role:'REP',passwordHash:hashPassword(password)}});
    const otherManager=await prisma.user.create({data:{companyId:company.id,teamId:teamTwo.id,
      username:'area-manager-other-'+seed,name:'Other manager',
      role:'TEAM_MANAGER',passwordHash:hashPassword(password)}});
    await prisma.repArea.createMany({data:[
      {repId:rep.id,areaId:north.id},{repId:rep.id,areaId:south.id}]});
    const logins={};
    for(const [key,user] of Object.entries({admin,manager,rep,otherManager})){
      const login=await call('/login','POST',{username:user.username,password});
      assert.equal(login.status,200,key);
      logins[key]=login.cookie;
    }
    for(const [kind,northId,southId] of [
      ['pharmacies',northPharmacy.id,southPharmacy.id],
      ['hospitals',northHospital.id,southHospital.id]
    ]){
      const northPage=await call('/'+kind+'?areaId='+north.id+'&limit=1&offset=0',
        'GET',null,logins.rep);
      assert.equal(northPage.status,200,kind);
      assert.deepEqual(northPage.data.map(x=>x.id),[northId]);
      const southPage=await call('/'+kind+'?areaId='+south.id+'&limit=1&offset=0',
        'GET',null,logins.rep);
      assert.equal(southPage.status,200,kind);
      assert.deepEqual(southPage.data.map(x=>x.id),[southId]);
      for(const forbidden of [unrelated.id,otherCompany.id]){
        const result=await call('/'+kind+'?areaId='+forbidden,
          'GET',null,logins.rep);
        assert.equal(result.status,200);
        assert.deepEqual(result.data,[],'Area filter cannot broaden '+kind+' visibility');
      }
      assert.equal((await call('/'+kind+'?areaId=invalid-id','GET',
        null,logins.rep)).status,400);
    }
    const location={latitude:36.1,longitude:37.1,accuracy:22,
      capturedAt:new Date().toISOString()};
    const date=new Date().toISOString().slice(0,10);
    const payload=(areaId,clientVisitId=randomUUID())=>({
      clientVisitId,type:'DOCTOR',visitDate:date,
      targetIds:[doctor.id],areaByTarget:{[doctor.id]:areaId},location
    });
    assert.equal((await call('/analytics/area-coverage','GET')).status,401);
    const auditBefore=await prisma.auditLog.count({where:{companyId:company.id,entity:'VISIT'}});
    for(const malformed of [
      {...payload(north.id),areaByTarget:{[doctor.id]:otherCompany.id}},
      {...payload(north.id),areaByTarget:{[doctor.id]:unrelated.id}},
      {...payload(north.id),areaByTarget:{}},
      {...payload(north.id),areaByTarget:{[doctor.id]:north.id,[randomUUID()]:south.id}},
      {...payload(north.id),areaByTarget:{[doctor.id]:''}},
      {...payload(north.id),areaByTarget:[]}
    ]){
      const invalid=await call('/visits','POST',malformed,logins.rep);
      assert.ok([400,403].includes(invalid.status),JSON.stringify(invalid));
    }
    assert.equal((await call('/visits','POST',{
      ...payload(north.id),areaByTarget:undefined
    },logins.rep)).status,400,'Multiple permitted doctor areas need an explicit assignment');
    assert.equal(await prisma.visit.count({where:{companyId:company.id}}),0);
    assert.equal(await prisma.auditLog.count({where:{companyId:company.id,entity:'VISIT'}}),
      auditBefore,'Rejected allocations do not create audits');

    const visitNorth=payload(north.id);
    const createdNorth=await call('/visits','POST',visitNorth,logins.rep);
    assert.equal(createdNorth.status,201,JSON.stringify(createdNorth));
    assert.equal(createdNorth.data.targets[0].areaIdAtVisit,north.id);
    assert.equal((await call('/visits','POST',visitNorth,logins.rep)).data.duplicate,true);
    assert.equal((await call('/visits','POST',{
      ...visitNorth,areaByTarget:{[doctor.id]:south.id}
    },logins.rep)).status,409,'Same idempotency key cannot silently change area');

    const visitSouth=payload(south.id);
    const createdSouth=await call('/visits','POST',visitSouth,logins.rep);
    assert.equal(createdSouth.status,201,JSON.stringify(createdSouth));
    assert.equal(createdSouth.data.targets[0].areaIdAtVisit,south.id);
    // Visit report and Excel must retain the real area for EACH target instead
    // of inferring a single tour area from its final GPS point.
    const report=await call('/reports/visits?from='+date+'&to='+date,'GET',null,logins.admin);
    assert.equal(report.status,200,JSON.stringify(report));
    assert.deepEqual(report.data.rows.flatMap(v=>v.targetDetails.map(t=>t.areaIdAtVisit)).sort(),
      [north.id,south.id].sort());
    assert.equal(report.data.rows.every(v=>v.targetDetails.length===1),true);
    const exportResponse=await fetch(base+'/api/reports/visits.xlsx?from='+date+'&to='+date,
      {headers:{Cookie:logins.admin}});
    assert.equal(exportResponse.status,200);
    const book=new (require('exceljs')).Workbook();
    await book.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
    const sheet=book.worksheets[0];
    assert.equal(sheet.getRow(1).getCell(6).value,'Visited areas by target');
    const areaText=[sheet.getRow(2).getCell(6).value,sheet.getRow(3).getCell(6).value];
    assert.equal(areaText.some(value=>String(value).includes(north.name)),true);
    assert.equal(areaText.some(value=>String(value).includes(south.name)),true);
    const rows=await prisma.visitTarget.findMany({where:{visitId:{in:[
      createdNorth.data.id,createdSouth.data.id]}},select:{doctorId:true,areaIdAtVisit:true}});
    assert.deepEqual(rows.map(v=>v.areaIdAtVisit).sort(),[north.id,south.id].sort());
    assert.ok(rows.every(v=>v.doctorId===doctor.id),'Doctor remains a single DB identity');

    const coverage=await call('/analytics/area-coverage','GET',null,logins.rep);
    assert.equal(coverage.status,200,JSON.stringify(coverage.data));
    const teamRows=coverage.data.areas.filter(r=>r.teamId===team.id);
    assert.equal(teamRows.length,2);
    assert.deepEqual(teamRows.map(r=>[r.areaId,r.done,r.target,r.coverage])
      .sort((a,b)=>a[0].localeCompare(b[0])),
      [[north.id,1,4,25],[south.id,1,4,25]].sort((a,b)=>a[0].localeCompare(b[0])));
    const total=coverage.data.teamTotals.find(x=>x.teamId===team.id);
    assert.equal(total.doctors,1);
    assert.equal(total.target,4,'Doctor target counted once in total, not once per area');
    assert.equal(total.done,2);
    assert.equal(total.coverage,50);

    const managerCoverage=await call('/analytics/area-coverage','GET',null,logins.manager);
    assert.equal(managerCoverage.status,200);
    assert.equal(managerCoverage.data.teamTotals.length,1);
    assert.equal(managerCoverage.data.teamTotals[0].teamId,team.id);
    const otherCoverage=await call('/analytics/area-coverage','GET',null,logins.otherManager);
    assert.equal(otherCoverage.status,200);
    assert.ok(otherCoverage.data.teamTotals.every(x=>x.teamId!==team.id),
      'Team manager must not see another team coverage');
    const companyCoverage=await call('/analytics/area-coverage','GET',null,logins.admin);
    assert.equal(companyCoverage.status,200);
    assert.ok(companyCoverage.data.areas.some(x=>x.areaId===north.id));

    // Existing visits without a trusted area are never backfilled by the
    // doctor's present-day area associations or the tour-end GPS coordinates.
    await prisma.visit.create({data:{companyId:company.id,repId:rep.id,
      teamIdAtVisit:team.id,clientVisitId:randomUUID(),type:'DOCTOR',
      visitDate:new Date(date+'T00:00:00.000Z'),latitude:36.1,longitude:37.1,
      locationAccuracy:22,locationCapturedAt:new Date(),
      targets:{create:{doctorId:doctor.id}}}});
    const withHistorical=await call('/analytics/area-coverage','GET',null,logins.admin);
    assert.equal(withHistorical.status,200);
    assert.equal(withHistorical.data.unattributedHistoricalVisits,1);
    assert.deepEqual(withHistorical.data.areas.filter(x=>x.teamId===team.id)
      .map(x=>x.done).sort(),[1,1]);
    assert.equal(withHistorical.data.teamTotals.find(x=>x.teamId===team.id).done,3,
      'Historical visit still contributes to team Frequency but no area is guessed');
  }finally{
    if(ids.length){
      const inCompanies={in:ids};
      await prisma.visitTarget.deleteMany({where:{visit:{companyId:inCompanies}}});
      await prisma.visit.deleteMany({where:{companyId:inCompanies}});
      await prisma.auditLog.deleteMany({where:{companyId:inCompanies}});
      await prisma.authSession.deleteMany({where:{user:{companyId:inCompanies}}});
      await prisma.doctorVisitGoal.deleteMany({where:{companyId:inCompanies}});
      await prisma.repArea.deleteMany({where:{rep:{companyId:inCompanies}}});
      await prisma.doctorArea.deleteMany({where:{doctor:{companyId:inCompanies}}});
      await prisma.doctor.deleteMany({where:{companyId:inCompanies}});
      await prisma.pharmacy.deleteMany({where:{companyId:inCompanies}});
      await prisma.hospital.deleteMany({where:{companyId:inCompanies}});
      await prisma.area.deleteMany({where:{companyId:inCompanies}});
      await prisma.user.deleteMany({where:{companyId:inCompanies}});
      await prisma.team.deleteMany({where:{companyId:inCompanies}});
      await prisma.company.deleteMany({where:{id:{in:ids}}});
    }
    await new Promise(resolve=>server.close(resolve));
    await prisma.$disconnect();
  }
});
