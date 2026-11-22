import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const entry=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const classic=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const last=readFileSync(new URL('../src/reference-final-v2.css',import.meta.url),'utf8');
const detail=readFileSync(new URL('../src/deep-parity-v2.css',import.meta.url),'utf8');
const parity=readFileSync(new URL('../src/visual-parity-v2.css',import.meta.url),'utf8');
const smoke=readFileSync(new URL('../scripts/v2-role-visual-smoke.mjs',import.meta.url),'utf8');

function section(name){
  const first=app.indexOf('function '+name+'(');
  assert.ok(first>=0,'Missing '+name);
  const end=app.indexOf('\nfunction ',first+10);
  return app.slice(first,end>=0?end:undefined);
}

test('original REP presentation is isolated from all three later V2 overrides',()=>{
  assert.match(entry,/import '\.\/style\.css';/);
  for(const stylesheet of [parity,detail,last]){
    assert.match(stylesheet,/\.rep-layout-v2-disabled/);
    assert.doesNotMatch(stylesheet,/\.rep-layout(?![-\w])/);
    assert.match(stylesheet,/\.manager-legacy-shell|\.company-legacy-shell/);
  }
  assert.match(classic,/\.rep-hub-card/);
  assert.match(classic,/\.rep-medical-card/);
});

test('REP dashboard has the original alerts, coverage and workspace cards',()=>{
  const home=section('RepHome');
  for(const piece of ['rep-dual-cycle-coverage','rep-alerts',
    'rep-hub-grid','rep-hub-card','rep-plan-header','rep-plan-metrics'])
    assert.ok(home.includes(piece),'Missing original home '+piece);
  assert.doesNotMatch(home,/className="rep-home v2-rep-home"/);
});

test('REP areas and directories render their original card layouts',()=>{
  const areas=section('RepAreas'),directory=section('RepMedicalDirectory');
  assert.match(areas,/className="rep-area-grid"/);
  assert.match(areas,/className="rep-area-card"/);
  assert.match(areas,/rep-legacy-area-detail-hero/);
  assert.match(directory,/className="rep-medical-list"/);
  assert.match(directory,/className="rep-medical-card"/);
  assert.match(directory,/rep-legacy-cycle-last/);
  assert.match(directory,/lastVisit\(item\)/);
  assert.match(directory,/className="rep-filter-toggle"/);
  assert.match(directory,/useCompleteMedicalDirectory/);
  assert.doesNotMatch(directory,/className="v2-table rep-directory-table"/);
});

test('REP reports retain original visuals and new cursor-paged history',()=>{
  const reports=section('RepReports');
  for(const piece of ['rep-legacy-tabs','rep-legacy-range',
    'rep-legacy-report-preview','rep-legacy-dual-actions',
    'loadOlderReports','nextCursor','printDetailed','sendReport'])
    assert.ok(reports.includes(piece),'Missing report flow '+piece);
  assert.match(reports,/\/rep-reports\?paginated=true/);
  assert.match(smoke,/Original report tabs were not restored/);
});

test('REP original header and four-tab mobile navigation stay in place',()=>{
  const layout=section('PageLayout');
  assert.match(layout,/className="topbar rep-classic-topbar"/);
  assert.match(layout,/className="rep-header-notifications"/);
  assert.match(layout,/className="rep-bottom-nav"/);
  assert.doesNotMatch(layout,/rep-desktop-page-heading/);
  assert.doesNotMatch(layout,/rep-header-refresh/);
  assert.match(smoke,/Original representative workspace cards are missing/);
});
