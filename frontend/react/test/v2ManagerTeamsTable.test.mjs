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
  assert.match(managerTeams,/doctorProgressFilter/);
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
  assert.doesNotMatch(managerTeams,/setAddInfo|إضافة فريق جديد/);
});
