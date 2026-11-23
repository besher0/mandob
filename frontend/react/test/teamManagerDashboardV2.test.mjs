import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/team-manager-dashboard-v2.css',import.meta.url),'utf8');
const start=app.indexOf('function TeamManagerHome(');
const end=app.indexOf('\nfunction RepHome(',start);
const home=app.slice(start,end);
const teamStart=app.indexOf('function LegacyManagerTeamPage(');
const teamEnd=app.indexOf('\nfunction LegacyManagerTeamsPage(',teamStart);
const roster=app.slice(teamStart,teamEnd);
test('team manager mounts the actual V2 dashboard and keeps the active team scope',()=>{
  const source=readFileSync(new URL('../src/ManagerDashboardV2.tsx',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../src/ManagerDashboardV2.module.css',import.meta.url),'utf8');
  const theme=readFileSync(new URL('../src/ManagerDashboardThemeIcon.tsx',import.meta.url),'utf8');
  assert.match(home,/return <ManagerDashboardV2 data=\{model\}/);
  assert.match(home,/r\.groupKey==='team:'\+user\.teamId/);
  assert.match(home,/r\.teamId===user\.teamId/);
  for(const section of ['s.hero','s.heroStatus','s.kpis','s.chart','s.performance','s.miniGrid'])
    assert.ok(source.includes(section),section);
  for(const label of ['الزيارات المنجزة','زيارات متأخرة',
    'أداء أعضاء الفريق','أداء الفريق خلال الأسبوع','طلبات تحتاج قرارك'])
    assert.ok(source.includes(label),label);
  assert.match(source,/data\.rounds\.slice\(0, 5\)/);
  assert.match(source,/data\.week\.map/);
  assert.match(source,/className=\{s\.dashboardScope\}/);
  assert.match(styles,/\.hero\s*\{/);
  assert.match(theme,/aliases/);
});
test('TEAM_MANAGER roster uses V2 search and filter disclosure with previous filters',()=>{
  assert.ok(teamStart>=0&&teamEnd>teamStart);
  assert.match(roster,/manager-v2-roster-toolbar/);
  assert.match(roster,/<details className="manager-v2-roster-more">/);
  assert.match(roster,/setStatusFilter/);
  assert.match(roster,/setAreaFilter/);
  assert.match(roster,/تحقيق الخطة/);
  assert.match(roster,/عرض التفاصيل/);
});

test('doctors in manager catalog group only current authorized paginated results',()=>{
  const a=app.indexOf('function LegacyManagerMedicalPage(');
  const b=app.indexOf('\nfunction LegacyManagerAreasPage(',a);
  const component=app.slice(a,b);
  assert.ok(a>=0&&b>a);
  for(const required of ['const shown=data||[]','if(kind===\'doctors\')for(const item of shown)',
    'manager-medical-specialty-heading','aria-expanded={!collapsedSpecialties.includes(specialty)}',
    'renderMedicalRow(item)','setPage(0)']){
    assert.ok(component.includes(required),required);
  }
  assert.match(css,/\.manager-legacy-shell \.manager-medical-specialty-heading/);
});

test('dashboard rep drilldown retains original V2 detail hierarchy and operational area management',()=>{
  const rep=readFileSync(new URL('../src/ManagerRepDetailsV2.tsx',import.meta.url),'utf8');
  const row=readFileSync(new URL('../src/ManagerDashboardRepTable.tsx',import.meta.url),'utf8');
  const moduleStyles=readFileSync(new URL('../src/ManagerDashboardV2.module.css',import.meta.url),'utf8');
  assert.match(home,/navigate\('users',\{repId:id,from:'dashboard'\}\)/);
  assert.match(roster,/const fromDashboard=urlParams\.get\('from'\)==='dashboard'/);
  assert.match(roster,/fromDashboard\?\s*navigate\(routePath\('TEAM_MANAGER','dashboard'\)\):selectRep\(null\)/);
  assert.match(roster,/<ManagerRepDetailsV2/);
  assert.match(roster,/\[visitPeriod,setVisitPeriod\]=useState\('cycle'\)/);
  assert.match(roster,/setVisitPeriod\('cycle'\);setVisitType\('all'\)/);
  assert.match(roster,/\{areaIds:chooseAreaIds\(fd\)\}/);
  assert.match(roster,/setAreasOpen\(false\);done\(\)/);
  assert.match(roster,/scopedAreaCheckboxes/);
  for(const label of ['المناطق المسندة','+ إضافة / إزالة منطقة',
    'متابعة أطباء السايكل','باقي الجهات المرتبطة ضمن فرقك','الجولات',
    'الزيارات المطلوبة','اختيار المجموعات وترتيبها','طي الكل','ناقص التكرار'])
    assert.ok(rep.includes(label),label);
  assert.match(rep,/onManageAreas/);
  assert.match(rep,/doctorTargets/);
  assert.match(rep,/otherTargets/);
  assert.match(rep,/detail\.visits/);
  assert.match(rep,/className=\{\`\$\{s\.detailIdentity\} manager-rep-v2-identity\`\}/);
  assert.match(row,/className=\{s\.statusCell\}/);
  assert.match(moduleStyles,/\.repStatusInactive/);
  assert.match(css,/\.manager-legacy-shell \.manager-rep-v2-source/);
});


test('manager annual leave breakdown is read from the authorized server response',()=>{
  const details=readFileSync(new URL('../src/ManagerRepDetailsV2.tsx',import.meta.url),'utf8');
  const backend=readFileSync(new URL('../../../backend/src/routes.js',import.meta.url),'utf8');
  assert.match(backend,/approvedAnnualLeaves/);
  assert.match(backend,/workingDaysWithin\(formatDate\(leave\.fromDate\)/);
  assert.match(backend,/remainingDays:Math\.max\(0,rep\.annualLeaveBalance-approvedDays\)/);
  assert.match(backend,/accountingMode:'LEGACY_NO_LEDGER'/);
  assert.match(details,/detail\?\.leaveBalance\?\.remainingDays/);
  assert.match(details,/detail\?\.leaveBalance\?\.carriedDays/);
  assert.match(details,/detail\?\.leaveBalance\?\.adjustmentDays/);
  assert.match(details,/الرصيد المتبقي:/);
  assert.match(details,/المرحّل:/);
  assert.match(details,/التسويات:/);
  assert.match(details,/onManageAreas/);
});
test('manager roster status and other targets layout are isolated from generic badges',()=>{
  const details=readFileSync(new URL('../src/ManagerRepDetailsV2.tsx',import.meta.url),'utf8');
  const modCss=readFileSync(new URL('../src/ManagerDashboardV2.module.css',import.meta.url),'utf8');
  assert.match(roster,/manager-v2-roster-table/);
  assert.match(roster,/manager-roster-status-cell/);
  assert.match(roster,/manager-roster-status-active/);
  assert.match(roster,/manager-roster-status-inactive/);
  assert.match(css,/\.manager-legacy-shell \.manager-v2-roster-table td\.manager-roster-status-cell/);
  assert.match(css,/\.manager-v2-roster-table \.manager-card-actions/);
  assert.match(details,/s\.repOtherTargets/);
  assert.match(details,/targets\.otherTargets\.length/);
  assert.match(modCss,/\.dashboardScope \.repOtherTargets \.tableCard \.table/);
});

test('manager V2 editors are used for both create and edit with team details parity',()=>{
  const editors=readFileSync(new URL('../src/ManagerV2Editors.tsx',import.meta.url),'utf8');
  const teamStart=app.indexOf('function LegacyManagerTeamsPage(');
  const teamEnd=app.indexOf('function LegacyManagerMedicalPage(',teamStart);
  const teams=app.slice(teamStart,teamEnd);
  assert.match(roster,/<ManagerV2RepEditor/);
  assert.match(roster,/onManageAreas=\{\(\)=>setAreasOpen\(true\)\}/);
  assert.match(teams,/\+ إضافة فريق/);
  assert.match(teams,/post\('\/manager\/teams',payload\)/);
  assert.match(teams,/<DoctorCycleDetails/);
  assert.match(teams,/<ManagerV2TeamMembers/);
  assert.match(editors,/اسم المندوب/);
  assert.match(editors,/اسم المستخدم/);
  assert.match(editors,/كلمة المرور/);
  assert.match(editors,/اختصاصات المندوب/);
  assert.match(editors,/الأصناف الخاصة بالمندوب/);
  assert.match(editors,/المناطق/);
  assert.match(editors,/aria-label=\{title\}/);
  assert.match(editors,/\$\{s\.dialog\} \$\{s\.editorDialog\}/);
  assert.match(editors,/\$\{s\.editorOptions\}/);
  assert.match(editors,/\$\{s\.dialogFooter\}/);
  assert.match(editors,/onCancel=/);
});
