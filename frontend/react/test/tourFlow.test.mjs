import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inArea,targetsForAreas,retainSelectedTargets,matchingTourAreas,
  resolvedTourArea,filterTourTargets,normalizeTourFilters} from '../src/tourFlow.mjs';

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


test('one selected tour area automatically resolves every matching doctor without second choice',()=>{
  assert.deepEqual(matchingTourAreas(doctors[0],['area-2']),['area-2']);
  assert.equal(resolvedTourArea(doctors[0],['area-2']), 'area-2');
  assert.equal(resolvedTourArea(doctors[2],['area-2']),null);
});
test('several chosen areas require an explicit selection only for shared doctors',()=>{
  assert.equal(resolvedTourArea(doctors[0],['area-1','area-2']),null);
  assert.equal(resolvedTourArea(doctors[0],['area-1','area-2'],'area-2'),'area-2');
  assert.equal(resolvedTourArea(doctors[0],['area-1','area-2'],'area-3'),null);
  assert.equal(resolvedTourArea(doctors[1],['area-1','area-2']),'area-2');
});
const statuses={
  d1:{id:'d1',name:'Dr A',grade:'A',specialty:'Cardiology',areaId:'area-1'},
  d2:{id:'d2',name:'Dr B',grade:'B',specialty:'Neurology',areaId:'area-1'},
  d3:{id:'d3',name:'Dr C',grade:'C',specialty:'Cardiology',areaId:'area-1'}
};
test('old doctor filters support multiple grades, multiple specialties and unvisited only',()=>{
  const rows=Object.values(statuses);
  assert.deepEqual(filterTourTargets(rows,{
    type:'DOCTOR',grades:['A','C'],specialties:['Cardiology','Neurology'],
    unvisitedOnly:true,visitCounts:{d2:2,d3:1},visitTargets:{d1:4,d2:2,d3:1}
  }).map(d=>d.id),['d1']);
  assert.deepEqual(filterTourTargets(rows,{
    type:'DOCTOR',grades:['A','B'],specialties:['Neurology']
  }).map(d=>d.id),['d2']);
});
test('old pharmacy filters combine grade, affiliation and zero-visit state',()=>{
  const rows=[
    {id:'p1',grade:'A',kind:'نقابية',name:'A pharmacy'},
    {id:'p2',grade:'B',kind:'مستقلة',name:'B pharmacy'},
    {id:'p3',grade:'C',kind:'حكومية',name:'C pharmacy'}
  ];
  assert.deepEqual(filterTourTargets(rows,{
    type:'PHARMACY',grades:['A','B'],categories:['نقابية','مستقلة'],
    unvisitedOnly:true,visitCounts:{p1:1},visitTargets:{p1:4,p2:4,p3:4}
  }).map(p=>p.id),['p2']);
});
test('old hospital filters combine multiple types, specialties and remaining cycle target',()=>{
  const rows=[
    {id:'h1',category:'خاص',specialty:'قلبية',target:2},
    {id:'h2',category:'حكومي',specialty:'عام',target:4},
    {id:'h3',category:'مركز طبي',specialty:'قلبية',target:2}
  ];
  assert.deepEqual(filterTourTargets(rows,{
    type:'HOSPITAL',categories:['خاص','حكومي'],specialties:['قلبية','عام'],
    unvisitedOnly:true,visitCounts:{h1:2,h2:1,h3:0},visitTargets:{h1:2,h2:4,h3:2}
  }).map(h=>h.id),['h2']);
});
test('status filter never invents unvisited entities before cycle data is available',()=>{
  const rows=[statuses.d1];
  assert.deepEqual(filterTourTargets(rows,{
    type:'DOCTOR',unvisitedOnly:true
  }),[]);
  assert.deepEqual(filterTourTargets(rows,{
    type:'DOCTOR',unvisitedOnly:true,visitCounts:{},visitTargets:{d1:4}
  }).map(d=>d.id),['d1']);
});


test('the original three medical filter groups retain all appropriate options',()=>{
  const stored={grades:['A','B','C'],categories:[
    'مستقلة','نقابية','مستوصف','مشفى','حكومية',
    'حكومي','خاص','تخصصي','مركز طبي'],
    specialties:['قلبية','داخلية','أطفال'],unvisitedOnly:true};
  const doctors=normalizeTourFilters(stored,'DOCTOR');
  assert.deepEqual(doctors.grades,['A','B','C']);
  assert.deepEqual(doctors.specialties,['قلبية','داخلية','أطفال']);
  assert.deepEqual(doctors.categories,[]);
  assert.equal(doctors.unvisitedOnly,true);
  const pharmacies=normalizeTourFilters(stored,'PHARMACY');
  assert.deepEqual(pharmacies.grades,['A','B','C']);
  assert.equal(pharmacies.categories.length,9);
  assert.deepEqual(pharmacies.specialties,[]);
  const hospitals=normalizeTourFilters(stored,'HOSPITAL');
  assert.deepEqual(hospitals.grades,[]);
  assert.deepEqual(hospitals.specialties,['قلبية','داخلية','أطفال']);
  assert.equal(hospitals.unvisitedOnly,true);
});
test('persisted filter state rejects malformed or corrupt browser values',()=>{
  assert.deepEqual(normalizeTourFilters(null,'DOCTOR'),{
    grades:[],specialties:[],categories:[],unvisitedOnly:false
  });
  assert.deepEqual(normalizeTourFilters({
    grades:['A','A','D',5,'B'],
    specialties:[' قلبية ','قلبية',null],
    categories:['مستقلة'],unvisitedOnly:'true'
  },'DOCTOR'),{
    grades:['A','B'],specialties:['قلبية'],categories:[],unvisitedOnly:false
  });
  assert.deepEqual(normalizeTourFilters(['A','B'],'PHARMACY'),{
    grades:[],specialties:[],categories:[],unvisitedOnly:false
  });
});
