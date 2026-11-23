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
