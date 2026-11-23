import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/team-manager-dashboard-v2.css',import.meta.url),'utf8');
const start=app.indexOf('function LegacyManagerTeamsPage(');
const end=app.indexOf('function LegacyManagerMedicalPage(',start);
const managerTeams=app.slice(start,end);
test('V2 manager teams cards include province, quotas and authorized drilldown',()=>{
  assert.ok(start>=0&&end>start);
  for(const field of ['manager-v2-team-card-grid','manager-v2-team-detail-page',
    'تفاصيل الفريق والسايكل','الاختصاصات:','الأصناف:','المندوبون:','التغطية'])
    assert.ok(managerTeams.includes(field),'Missing '+field);
  assert.match(managerTeams,/item\.province\?\.name/);
  assert.match(managerTeams,/members\.length/);
  assert.match(managerTeams,/<DoctorCycleDetails/);
  assert.match(managerTeams,/teamCycleTargets/);
  assert.match(managerTeams,/aria-label="ملخص أداء الفريق"/);
  assert.match(managerTeams,/managerV2Styles\.kpis/);
  assert.match(managerTeams,/teamCycleSummary\.uniqueDoctors/);
  assert.match(css,/\.manager-legacy-shell \.manager-v2-team-card-grid/);
});
test('multi-team manager actions remain scoped after v2 cards change',()=>{
  assert.match(managerTeams,/post\('\/manager\/active-team',\{teamId\}\)/);
  assert.match(managerTeams,/chooseTeam\(item\.id,'edit'\)/);
  assert.match(managerTeams,/chooseTeam\(item\.id,'manage'\)/);
  assert.match(managerTeams,/chooseTeam\(item\.id,'detail'\)/);
  assert.match(managerTeams,/setEditing\(teamId\)/);
  assert.match(managerTeams,/setManaging\(teamId\)/);
  assert.match(managerTeams,/detailedTeamId&&assignments\?\.activeTeamId===detailedTeamId/);
  assert.match(managerTeams,/useCloseOnEscape/);
  assert.match(managerTeams,/\+ إضافة فريق/);
  assert.match(managerTeams,/<ManagerV2TeamEditor/);
  assert.match(managerTeams,/<ManagerV2TeamMembers/);
  assert.match(managerTeams,/post\('\/manager\/teams',payload\)/);
});

test('team cards appear directly on workspace background like the V2 cards grid',()=>{
  assert.match(managerTeams,/<section className="manager-v2-teams-panel" aria-label="فرقي">/);
  assert.doesNotMatch(managerTeams,/<h3>فرقي<\/h3>/);
  assert.match(css,/\.manager-legacy-shell \.manager-v2-teams-panel \{[\s\S]*?background:transparent;/);
  assert.match(css,/\.manager-v2-teams-panel \.manager-v2-team-card-grid/);
});

test('V2 teams create button and card title follow the original ManagerApp hierarchy',()=>{
  assert.match(managerTeams,/className=\{managerV2Styles\.editorActions\}/);
  assert.match(managerTeams,/onClick=\{\(\)=>setCreating\(true\)\}>\+ إضافة فريق/);
  assert.doesNotMatch(managerTeams,/الفريق المحدد/);
  assert.match(managerTeams,/<h3>\{item\.name\}<\/h3>/);
});
