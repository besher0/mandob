import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/company-violet-theme.css',import.meta.url),'utf8');
const menus=app.slice(app.indexOf('const menus:'),app.indexOf('function LegacyApp('));
const companyMenu=menus.slice(menus.indexOf('COMPANY_ADMIN:['),menus.indexOf('TEAM_MANAGER:['));
const keys=[...companyMenu.matchAll(/\['([^']+)','[^']+'\]/g)].map(match=>match[1]);
test('company menu contains V2 navigation once, with no repeated medical tabs',()=>{
  assert.equal(keys.length,new Set(keys).size,'Every company key must be unique');
  for(const key of ['doctors','pharmacies','hospitals'])
    assert.equal(keys.filter(item=>item===key).length,1,key+' duplicated');
  const expected=['dashboard','governorates','teams','doctors','pharmacies',
    'hospitals','coverage','cycles','settings','access'];
  assert.deepEqual(keys.slice(0,expected.length),expected);
  assert.doesNotMatch(companyMenu,/\['reports','التقارير'\]/);
  assert.match(companyMenu,/\['cycles','السايكل'\]/);
  assert.match(companyMenu,/\['settings','الإعدادات'\]/);
  assert.match(companyMenu,/\['access','الأدوار والموظفون'\]/);
});
test('reports tab is hidden only for company administrators, not other roles',()=>{
  const managerMenu=menus.slice(menus.indexOf('TEAM_MANAGER:['),menus.indexOf('REP:['));
  const repMenu=menus.slice(menus.indexOf('REP:['));
  assert.doesNotMatch(companyMenu,/\['reports','التقارير'\]/);
  assert.match(managerMenu,/\['reports','التقارير'\]/);
  assert.match(repMenu,/\['reports','التقارير'\]/);
  const companyLayout=app.slice(app.indexOf('function PageLayout('),app.indexOf("if(user.role==='COMPANY_ADMIN'){",app.indexOf('function PageLayout(')));
  assert.match(companyLayout,/'coverage','cycles','settings','access'/);
  assert.doesNotMatch(companyLayout,/'coverage','reports','cycles'/);
  assert.match(app,/case 'reports':return <CompanyReportsPage/);
});
test('company cycle, settings and access are distinct routable pages',()=>{
  const from=app.indexOf('function CompanyAdminRoute(');
  const to=app.indexOf('function PageContent(',from);
  const route=app.slice(from,to);
  for(const key of ['cycles','settings','access'])
    assert.ok(route.includes("case '"+key+"':"),'Missing '+key+' route');
  assert.match(app,/function CompanyCyclePage/);
  assert.match(app,/function CompanyAccessPage/);
  assert.match(app,/company-mobile-nav" aria-label="تنقل مدير الشركة">\s*\{visibleMenu.map/);
  assert.match(css,/\.company-legacy-shell \.company-access-role-grid/);
});
test('cycle writes do not overwrite general settings and vice versa',()=>{
  const from=app.indexOf('function CompanyCyclePage(');
  const to=app.indexOf('function CompanySettingsPage(',from);
  const cycle=app.slice(from,to);
  const general=app.slice(to,app.indexOf('function CompanyAccessPage(',to));
  for(const field of ['cycleStart','cycleEnd','frequencyA','frequencyB','frequencyC','workingDays'])
    assert.ok(cycle.includes(field),'Missing cycle field '+field);
  for(const field of ['annualLeaveBalance','targetACoverage','managerInstructions'])
    assert.ok(general.includes(field),'Missing general setting '+field);
  assert.doesNotMatch(cycle,/annualLeaveBalance:Number\(val\(fd/);
  assert.doesNotMatch(general,/frequencyA:Number\(val\(fd/);
  assert.doesNotMatch(general,/workingDays:fd\.getAll/);
});
