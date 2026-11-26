import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/company-violet-theme.css',import.meta.url),'utf8');
const users=app.slice(app.indexOf('function Users('),app.indexOf('\nfunction ',app.indexOf('function Users(')+10));
const access=app.slice(app.indexOf('function CompanyAccessPage('),app.indexOf('function CompanyAdminRoute('));
const cycle=app.slice(app.indexOf('function CompanyCyclePage('),app.indexOf('function CompanySettingsPage('));

test('employee modal only renders its intended add/edit form',()=>{
  assert.match(users,/editorOnly=false/);
  assert.match(users,/\{!editorOnly&&<Section title="المستخدمون والمندوبون">/);
  assert.match(users,/\{canCreate&&\(!editorOnly\|\|!initialEditId\)&&<Section title="إضافة مستخدم">/);
  assert.match(users,/\{canCreate&&editing&&<Section title=/);
  assert.match(access,/initialEditId=\{editingId\} editorOnly=\{true\}/);
  assert.match(access,/className="company-embedded-v2 company-access-editor"/);
  assert.match(access,/done=\{\(\)=>\{setEditorOpen\(false\);setEditingId\(null\);done\(\);\}\}/);
});

test('employee search has bounded rows, role and status filters',()=>{
  assert.match(access,/const \[roleFilter,setRoleFilter\]=useState\('all'\)/);
  assert.match(access,/const \[statusFilter,setStatusFilter\]=useState\('all'\)/);
  assert.match(access,/const \[visibleCount,setVisibleCount\]=useState\(20\)/);
  assert.match(access,/const pageRows=rows\.slice\(0,visibleCount\)/);
  assert.match(access,/setVisibleCount\(20\)/);
  assert.match(access,/pageRows\.map\(\(employee:Any\)/);
  assert.match(access,/عرض المزيد/);
  assert.match(access,/employeeTeams\(employee\)/);
  assert.match(access,/company-staff-status/);
});

test('cycle remains separate and validates every frequency before saving',()=>{
  assert.match(cycle,/Number\.isInteger\(visits\)/);
  assert.match(cycle,/visits<1\|\|visits>30/);
  assert.match(cycle,/disabled=\{busy\|\|!data\}/);
  assert.match(cycle,/workingDays/);
  assert.match(cycle,/await patch\('\/settings'/);
  const settings=app.slice(app.indexOf('function CompanySettingsPage('),app.indexOf('function CompanyAccessPage('));
  assert.match(settings,/disabled=\{busy\|\|!data\}/);
  assert.match(settings,/annualLeaveBalance/);
  assert.doesNotMatch(settings,/frequencyA:Number/);
});

test('company styling stays scoped and supports mobile/accessibility',()=>{
  for(const selector of ['.company-access-filters','.company-access-pagination',
    '.company-staff-status','.company-settings-page .frequency-item',
    '.company-working-days label input:focus-visible+span'])
    assert.ok(css.includes(selector),'Missing company style '+selector);
  assert.match(css,/@media\(max-width:640px\)/);
  assert.match(css,/\.company-legacy-shell \.company-settings-page/);
});
