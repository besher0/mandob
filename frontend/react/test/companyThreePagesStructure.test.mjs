import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const theme=readFileSync(new URL('../src/company-violet-theme.css',import.meta.url),'utf8');
const cycle=app.slice(app.indexOf('function CompanyCyclePage('),app.indexOf('function CompanySettingsPage('));
const settings=app.slice(app.indexOf('function CompanySettingsPage('),app.indexOf('function CompanyAccessPage('));
const access=app.slice(app.indexOf('function CompanyAccessPage('),app.indexOf('function CompanyAdminRoute('));

test('company admin retains precisely three distinct page routes',()=>{
  const routes=app.slice(app.indexOf('function CompanyAdminRoute('),app.indexOf('type RouteContext='));
  for(const route of ["cycles","settings","access"]) {
    assert.match(routes,new RegExp("case '"+route+"':"));
  }
  assert.match(access,/title="الأدوار والموظفون"/);
  assert.match(settings,/title="الإعدادات"/);
  assert.match(cycle,/title="السايكل"/);
});

test('cycle overview lists actual saved cycles and keeps editable settings separate',()=>{
  assert.match(cycle,/company-v2-cycle-list/);
  assert.match(cycle,/\/company\/cycles\?limit=20&offset=/);
  assert.match(cycle,/company-cycle-overview-table/);
  assert.match(cycle,/cycleHistory\.items\.map/);
  assert.match(cycle,/company-cycle-editor/);
  assert.match(cycle,/company-cycles-pagination/);
  assert.match(cycle,/await patch\('\/settings'/);
});

test('settings separate coverage, instructions and rep defaults without overwriting cycle settings',()=>{
  assert.match(settings,/id="company-cycle-coverage"/);
  assert.match(settings,/company-settings-v2-overview/);
  assert.match(settings,/company-settings-summary-table/);
  assert.match(settings,/company-settings-editor/);
  assert.match(settings,/id="company-general-instructions"/);
  assert.match(settings,/id="company-rep-defaults"/);
  assert.match(settings,/name="targetACoverage"/);
  assert.match(settings,/name="managerInstructions"/);
  assert.match(settings,/name="annualLeaveBalance"/);
  assert.doesNotMatch(settings,/frequencyA:Number/);
  assert.doesNotMatch(settings,/workingDays:fd\.getAll/);
});

test('company settings embeds specialty, product and stock transfer tabs, not separate menu pages',()=>{
  assert.match(settings,/\['specialties','الاختصاصات'\]/);
  assert.match(settings,/\['products','الأصناف'\]/);
  assert.match(settings,/\['stock','توزيع العينات'\]/);
  assert.match(settings,/tab==='specialties'&&<CompanySpecialtyCatalog/);
  assert.match(settings,/tab==='products'&&<Products/);
  assert.match(settings,/tab==='stock'&&<SampleStockPanel role="COMPANY_ADMIN"/);
  const companyRoute=app.slice(app.indexOf('function CompanyAdminRoute('),
    app.indexOf('type RouteContext='));
  assert.doesNotMatch(companyRoute,/case 'catalog'/);
  assert.match(app,/تعديل الصنف/);
  assert.match(app,/stockQuantity/);
  assert.match(app,/مخزون عينات الفرق وتوزيعه على المندوبين/);
});

test('company roles are tabular and employee editing is inline with real existing APIs',()=>{
  assert.match(access,/company-access-roles-table/);
  assert.match(access,/className="dashboard-card company-access-inline-editor"/);
  assert.match(access,/id="company-access-editor"/);
  assert.match(access,/company-access-table/);
  assert.match(access,/initialEditId=\{editingId\} editorOnly=\{true\}/);
  assert.doesNotMatch(access,/<CompanyModal open=\{editorOpen\}/);
  assert.doesNotMatch(access,/post\('\/company\/access\/roles'/);
  assert.match(theme,/\.company-legacy-shell \.company-access-inline-editor/);
  assert.match(theme,/\.company-legacy-shell \.company-cycle-overview/);
});
