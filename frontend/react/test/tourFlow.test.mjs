import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inArea,targetsForAreas,retainSelectedTargets} from '../src/tourFlow.mjs';

const doctors=[
  {id:'doctor-1',name:'Same name',areaId:'area-1',
    doctorAreas:[{areaId:'area-1'},{areaId:'area-2'}]},
  {id:'doctor-2',name:'Same name',areaId:'area-2',doctorAreas:[{areaId:'area-2'}]},
  {id:'doctor-3',name:'Private',areaId:'area-3',doctorAreas:[]}
];

test('doctors in two selected areas appear only once, identified by ID',()=>{
  assert.deepEqual(targetsForAreas(doctors,['area-1','area-2']).map(x=>x.id),
    ['doctor-1','doctor-2']);
});
test('same-name distinct doctors remain separate targets',()=>{
  const result=targetsForAreas(doctors,['area-1','area-2']);
  assert.equal(result.length,2);
  assert.equal(result[0].name,result[1].name);
  assert.notEqual(result[0].id,result[1].id);
});
test('multi-area doctor also selectable through its additional area only',()=>{
  assert.equal(inArea(doctors[0],'area-2'),true);
  assert.deepEqual(targetsForAreas(doctors,['area-2']).map(x=>x.id),
    ['doctor-1','doctor-2']);
});
test('medical entities with a single area honor selected areas',()=>{
  const entities=[
    {id:'pharmacy-1',areaId:'area-1'},
    {id:'hospital-2',area:{id:'area-2'}},
    {id:'hospital-3',areaId:'area-3'}
  ];
  assert.deepEqual(targetsForAreas(entities,['area-2']).map(x=>x.id),
    ['hospital-2']);
  assert.deepEqual(targetsForAreas(entities,[]),[]);
});
test('going back to change selected areas removes previously chosen out-of-area targets',()=>{
  const allowed=targetsForAreas(doctors,['area-2']);
  assert.deepEqual(retainSelectedTargets(['doctor-3','doctor-1','doctor-2'],allowed),
    ['doctor-1','doctor-2']);
  assert.deepEqual(retainSelectedTargets(['doctor-3'],allowed),[]);
});
