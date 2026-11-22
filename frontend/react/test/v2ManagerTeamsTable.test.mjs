import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/reference-final-v2.css',import.meta.url),'utf8');

const start=app.indexOf('function LegacyManagerTeamsPage(');
const end=app.indexOf('function LegacyManagerMedicalPage(',start);
const managerTeams=app.slice(start,end);

test('v2 manager team list uses the reference summary table hierarchy',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(managerTeams,/className="v2-table manager-v2-team-table"/);
  for(const heading of ['الفريق','المحافظة','المندوبون','التغطية']){
    assert.ok(managerTeams.includes('>'+heading+'</th>'),
      'Missing reference table column: '+heading);
  }
  assert.match(managerTeams,/item\.province\?\.name/);
  assert.match(managerTeams,/members\.length/);
  assert.match(css,/\.manager-legacy-shell \.manager-v2-team-table-wrap/);
});

test('multi-team manager actions remain scoped after visual table change',()=>{
  assert.match(managerTeams,/post\('\/manager\/active-team',\{teamId\}\)/);
  assert.match(managerTeams,/chooseTeam\(item\.id,'edit'\)/);
  assert.match(managerTeams,/chooseTeam\(item\.id,'manage'\)/);
  assert.match(managerTeams,/setEditing\(teamId\)/);
  assert.match(managerTeams,/setManaging\(teamId\)/);
  assert.match(managerTeams,/useCloseOnEscape/);
});
