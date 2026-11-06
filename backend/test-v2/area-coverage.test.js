'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {computeAreaCoverage}=require('../src/area-coverage-service');

test("each doctor's completed visit affects only its recorded area",()=>{
  const frequency={items:[{
    id:'doctor-1',teamId:'team-A',teamName:'Team A',
    representatives:[{id:'rep-1'},{id:'rep-2'}],grade:'A',target:4,done:2
  }]};
  const doctors=new Map([['doctor-1',{
    areaId:'north',doctorAreas:[{areaId:'north'},{areaId:'south'}]
  }]]);
  const repAreas=[{repId:'rep-1',areaId:'north'},{repId:'rep-2',areaId:'south'}];
  const visit={teamIdAtVisit:'team-A',repId:'rep-1'};
  const records=[
    {doctorId:'doctor-1',areaIdAtVisit:'north',visit},
    {doctorId:'doctor-1',areaIdAtVisit:'north',visit}
  ];
  const result=computeAreaCoverage(frequency,doctors,repAreas,records,
    new Map([['north','North'],['south','South']]));
  assert.deepEqual(result.areas.map(x=>[x.areaId,x.done,x.target,x.coverage]),
    [['north',2,4,50],['south',0,4,0]]);
  assert.equal(result.teamTotals.length,1);
  assert.equal(result.teamTotals[0].doctors,1);
  assert.equal(result.teamTotals[0].target,4,
    'Team doctor target must not double when doctor belongs to two areas');
  assert.equal(result.teamTotals[0].done,2);
  assert.equal(result.teamTotals[0].coverage,50);
});

test('historical tours with no persisted visit area cannot be attributed by guesswork',()=>{
  const frequency={items:[{id:'d1',teamId:'t1',teamName:'Team',
    representatives:[{id:'r1'}],grade:'B',target:2,done:1}]};
  const doctors=new Map([['d1',{areaId:'a1',doctorAreas:[{areaId:'a2'}]}]]);
  const result=computeAreaCoverage(frequency,doctors,
    [{repId:'r1',areaId:'a1'},{repId:'r1',areaId:'a2'}],
    [{doctorId:'d1',areaIdAtVisit:null,visit:{teamIdAtVisit:'t1',repId:'r1'}}],
    new Map([['a1','A1'],['a2','A2']]));
  assert.equal(result.unattributedHistoricalVisits,1);
  assert.ok(result.areas.every(a=>a.done===0));
  assert.equal(result.teamTotals[0].done,1,
    'Existing team frequency still includes the historical visit');
});
test('team and individual group keys never share area counts',()=>{
  const frequency={items:[
    {id:'d1',teamId:'t1',teamName:'T1',representatives:[{id:'r1'}],
      grade:'A',target:4,done:1},
    {id:'d1',teamId:'t2',teamName:'T2',representatives:[{id:'r2'}],
      grade:'A',target:4,done:0}
  ]};
  const map=new Map([['d1',{areaId:'area',doctorAreas:[]}]]);
  const result=computeAreaCoverage(frequency,map,
    [{repId:'r1',areaId:'area'},{repId:'r2',areaId:'area'}],
    [{doctorId:'d1',areaIdAtVisit:'area',visit:{teamIdAtVisit:'t1',repId:'r1'}}],
    new Map([['area','Area']]));
  assert.deepEqual(result.areas.map(x=>[x.teamId,x.done]),[['t1',1],['t2',0]]);
});
