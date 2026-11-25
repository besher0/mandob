import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/company-violet-theme.css',import.meta.url),'utf8');
test('company reps uses bounded server paging and search without altering other roles',()=>{
  const view=app.slice(app.indexOf('function CompanyRepresentativesTable('),
    app.indexOf('function CompanyTeamsPage('));
  assert.match(view,/api\('\/company\/reps\?/);
  assert.match(view,/offset:String\(page\*pageSize\)/);
  assert.match(view,/limit:String\(pageSize\)/);
  assert.match(view,/setTimeout\(\(\)=>setDebounced/);
  assert.match(view,/عرض المزيد/);
  assert.match(view,/السابق/);
  assert.match(view,/التالي/);
  assert.match(view,/البحث عن المندوبين/);
});
test('all governorates resets details and manager team select remains scoped',()=>{
  const gov=app.slice(app.indexOf('function CompanyGovernoratesPage('),
    app.indexOf('function CompanyRepresentativesTable('));
  assert.match(gov,/governorate==='all'\?null:governorate/);
  assert.match(app,/className="manager-form-grid company-manager-assignment-form"/);
  assert.match(css,/\.company-legacy-shell \.company-manager-assignment-form/);
});
