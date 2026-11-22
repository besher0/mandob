import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/reference-final-v2.css',import.meta.url),'utf8');
const start=app.indexOf('function CompanyTeamsPage(');
const end=app.indexOf('function CompanyCoveragePage(',start);
const source=app.slice(start,end);

test('company team screen renders the v2 manager assignment table',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(source,/className="v2-table company-v2-team-table"/);
  for(const label of ['الفريق','المحافظة','المدير الحالي','المندوبون','تغيير المدير']){
    assert.ok(source.includes('>'+label+'</th>'), 'Missing v2 heading '+label);
  }
  assert.match(css,/\.company-legacy-shell \.company-v2-team-table-wrap/);
});

test('company keeps multi-team manager assignment authorization and detail flow',()=>{
  assert.match(source,/manager\.managedTeams/);
  assert.match(source,/replaceTeamManager\(team\.id\)/);
  assert.match(source,/patch\('\/teams\/'\+teamId\+'\/manager'/);
  assert.match(source,/expectedManagerIds:managersFor\(teamId\)/);
  assert.match(source,/aria-label=\{'تغيير مدير '\+team\.name\}/);
  assert.match(source,/setSelectedTeamId\(team\.id\)/);
  assert.match(source,/patch\('\/users\/'\+existingManagerId\+'\/manager-teams'/);
  assert.match(source,/post\('\/users'/);
  assert.match(source,/managerTeamIds/);
  assert.match(source,/teamCoverage\(team\.id\)/);
});

test('company filter includes every current representative city, not only first',()=>{
  assert.match(source,/const teamCities=\(teamId:string\):string\[\]/);
  assert.match(source,/teamCities\(team\.id\)\.includes\(cityFilter\)/);
  assert.match(source,/teamCities\(team\.id\)\.includes\(managerCity\)/);
  assert.match(source,/teamCities\(teamId\)\.join\('، '\)/);
  assert.doesNotMatch(source,/return values\[0\]/);
});
