'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');

test('synthetic PostgreSQL visit, leave and frequency performance smoke',{
  skip:process.env.RUN_PERF_TESTS!=='1',timeout:180000
},async()=>{
  const {prisma}=require('../src/auth');
  const {getFrequency}=require('../src/analytics-service');
  const seed=randomUUID().slice(0,10),stats={};
  let company=null;
  const measure=async(label,fn)=>{
    const start=performance.now();
    const value=await fn();
    stats[label]=Number((performance.now()-start).toFixed(1));
    return value;
  };
  try{
    company=await prisma.company.create({data:{name:'Perf fixture '+seed,
      settings:{create:{cycleStart:new Date('2026-01-01T00:00:00.000Z'),
        cycleEnd:new Date('2026-12-31T00:00:00.000Z')}}}});
    const team=await prisma.team.create({data:{companyId:company.id,name:'Perf team',
      specialties:{create:[{specialty:'Cardiology'}]}}});
    const area=await prisma.area.create({data:{companyId:company.id,name:'Perf area'}});
    const rep=await prisma.user.create({data:{companyId:company.id,name:'Perf rep',
      username:'perf-rep-'+seed,role:'REP',passwordHash:'BENCHMARK_NO_LOGIN',
      teamId:team.id,repAreas:{create:{areaId:area.id}}}});
    const admin=await prisma.user.create({data:{companyId:company.id,name:'Perf admin',
      username:'perf-admin-'+seed,role:'COMPANY_ADMIN',passwordHash:'BENCHMARK_NO_LOGIN'}});
    const doctors=Array.from({length:800},(_,i)=>({
      id:randomUUID(),companyId:company.id,areaId:area.id,
      name:'Benchmark Doctor '+i,specialty:'Cardiology',grade:'A',active:true
    }));
    await measure('seedDoctorsMs',()=>prisma.doctor.createMany({data:doctors}));
    const referenceDate=new Date('2026-10-01T00:00:00.000Z');
    const visits=Array.from({length:2400},(_,i)=>({
      id:randomUUID(),clientVisitId:randomUUID(),companyId:company.id,
      repId:rep.id,teamIdAtVisit:team.id,type:'DOCTOR',visitDate:referenceDate,
      latitude:36.2,longitude:37.1,locationAccuracy:20,
      locationCapturedAt:referenceDate,
      createdAt:new Date(referenceDate.getTime()+i*1000)
    }));
    await measure('seedVisitsMs',()=>prisma.visit.createMany({data:visits}));
    await measure('seedTargetsMs',()=>prisma.visitTarget.createMany({
      data:visits.map((v,i)=>({visitId:v.id,doctorId:doctors[i%doctors.length].id}))
    }));
    const statuses=['REJECTED','PENDING','APPROVED'];
    const leaves=Array.from({length:1500},(_,i)=>{
      const date=new Date(Date.UTC(2026,0,1+(i%320)));
      return {id:randomUUID(),companyId:company.id,repId:rep.id,
        type:'اختبار أداء',fromDate:date,toDate:date,status:statuses[i%3]}
    });
    await measure('seedLeavesMs',()=>prisma.leaveRequest.createMany({data:leaves}));
    const history=await measure('visitHistoryMs',()=>prisma.visit.findMany({
      where:{companyId:company.id,teamIdAtVisit:team.id},
      orderBy:[{visitDate:'desc'},{createdAt:'desc'},{id:'desc'}],take:100
    }));
    assert.equal(history.length,100);
    const leaveHistory=await measure('leaveHistoryMs',()=>prisma.leaveRequest.findMany({
      where:{companyId:company.id,repId:rep.id},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:200
    }));
    assert.equal(leaveHistory.length,200);
    const overlap=await measure('leaveOverlapMs',()=>prisma.leaveRequest.findFirst({
      where:{repId:rep.id,status:{in:['PENDING','APPROVED']},
        fromDate:{lte:new Date('2026-08-01T00:00:00.000Z')},
        toDate:{gte:new Date('2026-08-01T00:00:00.000Z')}},
      select:{id:true}
    }));
    assert.ok(overlap,'Expected an active leave overlap in seeded records');
    const frequency=await measure('frequencyMs',()=>getFrequency(admin));
    assert.equal(frequency.items.length,doctors.length);
    assert.equal(frequency.items.reduce((n,x)=>n+x.done,0),visits.length);
    // Observational timings, not flaky time-based pass/fail assertions.
    console.log('MANDOB_PERF_SMOKE '+JSON.stringify({
      rows:{doctors:doctors.length,visits:visits.length,leaves:leaves.length},
      timingsMs:stats
    }));
  } finally{
    if(company){
      const where={companyId:company.id};
      await prisma.visitTarget.deleteMany({where:{visit:where}});
      await prisma.visit.deleteMany({where});
      await prisma.leaveRequest.deleteMany({where});
      await prisma.doctorVisitGoal.deleteMany({where});
      await prisma.repArea.deleteMany({where:{rep:{companyId:company.id}}});
      await prisma.user.deleteMany({where});
      await prisma.doctor.deleteMany({where});
      await prisma.pharmacy.deleteMany({where});
      await prisma.hospital.deleteMany({where});
      await prisma.area.deleteMany({where});
      await prisma.team.deleteMany({where});
      await prisma.auditLog.deleteMany({where});
      await prisma.company.delete({where:{id:company.id}});
    }
    await prisma.$disconnect();
  }
});
