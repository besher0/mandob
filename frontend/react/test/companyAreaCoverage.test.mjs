import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompanyAreaStats} from '../src/companyAreaCoverage.mjs';

const areas=[
  {id:'a',name:'المدينة',city:'حلب'},
  {id:'b',name:'الريف',city:'حلب'},
  {id:'c',name:'بلا تكليف',city:'دمشق'}
];
const reps=[
  {id:'rep-1',repAreas:[{areaId:'a'},{areaId:'a'},{areaId:'b'}]},
  {id:'rep-2',repAreas:[{area:{id:'a'}}]}
];

test('one area shows all assigned doctor and A-doctor counters with capped goals',()=>{
  const rows=buildCompanyAreaStats(areas,[
    {areaId:'a',groupKey:'team:one',teamName:'الأول',target:6,done:3,
      doctors:2,unvisited:1,gradeA:1},
    {areaId:'a',groupKey:'team:two',teamName:'الثاني',target:4,done:9,
      doctors:1,unvisited:0,gradeA:1}
  ],reps);
  const city=rows.find(row=>row.areaId==='a');
  assert.equal(city.areaName,'المدينة');
  assert.equal(city.city,'حلب');
  assert.equal(city.reps,2,'a rep linked twice to the same area counts once');
  assert.equal(city.groupCount,2);
  assert.equal(city.doctors,3,'team-area assignments, not unique company doctors');
  assert.equal(city.gradeA,2);
  assert.equal(city.unvisited,1);
  assert.equal(city.target,10);
  assert.equal(city.done,7,'one group cannot exceed its own required visits');
  assert.equal(city.remaining,3);
  assert.equal(city.coverage,70);
  assert.deepEqual(city.groups.map(group=>group.done),[3,4]);
});

test('zero-goal areas stay visible without misleading 0% coverage',()=>{
  const rows=buildCompanyAreaStats(areas,[],reps);
  assert.equal(rows.length,3);
  assert.equal(rows.find(row=>row.areaId==='c').coverage,null);
  assert.equal(rows.find(row=>row.areaId==='c').remaining,0);
  assert.equal(rows.find(row=>row.areaId==='a').reps,2);
});

test('historical area not in current catalog stays visible without invented city',()=>{
  const rows=buildCompanyAreaStats([],[
    {areaId:'old',areaName:'منطقة سابقة',target:2,done:1,
      doctors:1,unvisited:0,gradeA:1}
  ]);
  assert.equal(rows[0].city,'غير محددة');
  assert.equal(rows[0].coverage,50);
  assert.equal(rows[0].areaName,'منطقة سابقة');
});

test('no target, negative and non-numeric metrics cannot create negative remaining',()=>{
  const rows=buildCompanyAreaStats(areas,[
    {areaId:'a',target:0,done:12,doctors:-5,gradeA:'junk'},
    {areaId:'b',target:4,done:-9,doctors:2}
  ]);
  assert.equal(rows.find(row=>row.areaId==='a').coverage,null);
  assert.equal(rows.find(row=>row.areaId==='a').done,0);
  assert.equal(rows.find(row=>row.areaId==='a').doctors,0);
  assert.equal(rows.find(row=>row.areaId==='b').remaining,4);
});
