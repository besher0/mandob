import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/reference-final-v2.css',import.meta.url),'utf8');
const smoke=readFileSync(new URL('../scripts/v2-role-visual-smoke.mjs',import.meta.url),'utf8');

test('v2 final reference CSS follows all legacy and parity styles',()=>{
  assert.match(main,/import '\.\/style\.css';\s*import '\.\/visual-parity-v2\.css';\s*import '\.\/deep-parity-v2\.css';\s*import '\.\/reference-final-v2\.css';/);
  assert.match(css,/\.rep-layout \{/);
  for(const token of ['#f6f8f7','#17211c','#167c5a','max-width: 1050px',
    'min-height: 70px','padding: 13px 16px','font-size: 19px'])
    assert.ok(css.includes(token),'Missing v2 REP reference token: '+token);
  assert.match(smoke,/reason:'REP v2 reference tokens'/);
  assert.match(smoke,/contentMaxWidth/);
});

test('REP areas provide direct v2 round action without sacrificing details',()=>{
  const start=app.indexOf('function RepAreas(');
  const end=app.indexOf('\nfunction Records(',start);
  assert.ok(start>=0&&end>start,'REP areas function not found');
  const areas=app.slice(start,end);
  assert.match(areas,/className="rep-area-card mini-card rep-v2-area-card"/);
  assert.match(areas,/onClick=\{\(\)=>onBeginAreaTour\(area\.id,'DOCTOR'\)\}/);
  assert.match(areas,/>جولة من المنطقة<\/button>/);
  assert.match(areas,/setSelected\(area\.id\);setEntityType\('DOCTOR'\)/);
  assert.match(areas,/تفاصيل المنطقة/);
  assert.match(css,/\.rep-layout \.rep-v2-area-card/);
});

test('rep home shows actual team name when the authenticated user includes one',()=>{
  const start=app.indexOf('function RepHome(');
  const end=app.indexOf('\nfunction RepAnalytics(',start);
  const home=app.slice(start,end);
  assert.match(home,/user\.teams/);
  assert.match(home,/teamNames\.join\('، '\)/);
  assert.match(home,/user\.team\?\.name/);
  assert.match(home,/\{displayTeam\}/);
});

test('last reference layer keeps all roles separately scoped',()=>{
  for(const role of ['rep-layout','manager-legacy-shell','company-legacy-shell','admin-v2-shell'])
    assert.ok(css.includes('.'+role),'Missing role: '+role);
  assert.doesNotMatch(css,/(?:^|\n)\s*button\s*\{/,'No global button overrides');
});

test('REP medical directory matches v2 six-column table while retaining filters',()=>{
  const start=app.indexOf('function RepMedicalDirectory(');
  const end=app.indexOf('\\nfunction TeamManager',start);
  assert.ok(start>=0,'Missing representative directory');
  const directory=app.slice(start,end<0?undefined:end);
  for(const heading of ['الاسم','التصنيف','المنطقة','الزيارات','آخر زيارة','الحالة'])
    assert.ok(directory.includes('>'+heading+'</th>'),'Missing reference table column: '+heading);
  for(const control of ['rep-directory-v2-input-row','rep-filter-sheet',
    'rep-active-filters','setUnvisitedOnly','linkedAreaNames(item)',
    'lastVisit(item)','visitTarget(item)','visitedCount(item)'])
    assert.ok(directory.includes(control),'Directory lost functional control: '+control);
  assert.match(directory,/className="v2-table rep-directory-table"/);
  assert.match(css,/\\.rep-layout \\.rep-directory-table th/);
  assert.match(smoke,/v2 directory table columns or nonempty fixture rows differ/);
});
