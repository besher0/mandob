import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const routes=readFileSync(new URL('../../../backend/src/routes.js',import.meta.url),'utf8');
const view=app.slice(app.indexOf('function CompanyDataPage('),
  app.indexOf('function companyEscape('));
test('company medical tabs list every province by default and support multi-area doctors',()=>{
  assert.match(view,/governorate!=='all'\?governorate:'all'/);
  assert.match(view,/city==='all'\|\|companyCity\(area\)===city/);
  assert.match(view,/row\.doctorAreas\|\|\[\]/);
  assert.match(view,/medicalAreas\(row\)/);
  assert.match(view,/city!=='all'&&/);
  assert.doesNotMatch(view,/if\(!city\|\|rowCity!==city\)/);
});
test('company doctor specialty filter works with search, province and area filters',()=>{
  assert.match(view,/const \[specialtyFilter,setSpecialtyFilter\]=useState\(''\)/);
  assert.match(view,/aria-label="فلترة اختصاص الطبيب"/);
  assert.match(view,/<option value="">كل الاختصاصات<\/option>/);
  assert.match(view,/doctorSpecialties\.map/);
  assert.match(view,/tab==='doctors'&&specialtyFilter&&String\(row\.specialty\|\|''\)\.trim\(\)!==specialtyFilter/);
  assert.match(view,/setSpecialtyFilter\(''\)/);
  assert.match(view,/اختصاص: \{specialtyFilter\}/);
});
test('company creation buttons work without selecting a province first',()=>{
  assert.match(view,/onClick=\{\(\)=>\{setSelected\(null\);setModal\('add'\)\}\}/);
  assert.doesNotMatch(view,/disabled=\{!city\|\|!cityAreas\.length\}/);
  for(const kind of ['doctors','pharmacies','hospitals']){
    assert.match(view,new RegExp("post\\('/'\\+tab,body\\)"));
    assert.match(routes,new RegExp("route\\('post','/api/"+kind+"'"));
    assert.match(routes,new RegExp("route\\('get','/api/"+kind+"'"));
  }
  assert.match(view,/body\.areaId=val\(fd,'areaId'\)/);
  assert.match(view,/if\(!body\.areaId\)throw Error/);
});

test('company lists medical records without waiting for the unrelated area request',()=>{
  const page=app.slice(app.indexOf('function CompanyDataPage('),
    app.indexOf('function companyEscape('));
  assert.match(page,/currentMedicalData=tab==='doctors'/);
  assert.match(page,/medicalLoading=currentMedicalData===null/);
  assert.match(page,/directById\.get\(id\)/);
  assert.match(page,/if\(city!=='all'/);
  assert.match(page,/لم يرجع السيرفر أي سجلات/);
  assert.match(page,/عرض كل \{currentLabel\}/);
  assert.doesNotMatch(page,/\(!areas\|\|!allRows\.length\)/);
});
