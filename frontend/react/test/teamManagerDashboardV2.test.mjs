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
test('TEAM_MANAGER dashboard follows v2 section hierarchy',()=>{
  assert.ok(start>=0&&end>start);
  for(const section of ['tm-dashboard-hero','tm-dashboard-kpis',
    'tm-dashboard-chart-grid','tm-dashboard-performance','tm-dashboard-mini-grid']){
    assert.ok(home.includes(section),section);
    assert.ok(css.includes('.'+section),section+' styles');
  }
  for(const label of ['أداء الفريق خلال الأسبوع','النشاط المباشر',
    'أداء أعضاء الفريق','تغطية المناطق','طلبات تحتاج قرارك'])
    assert.ok(home.includes(label),label);
  assert.match(home,/navigate\('users',\{repId:rep\.id\}\)/);
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
