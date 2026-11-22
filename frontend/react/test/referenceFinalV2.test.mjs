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

test('analytics excludes important alerts while dashboard keeps its own alerts',()=>{
  const analytics=section('RepAnalytics');
  const dashboard=section('RepHome');
  assert.doesNotMatch(analytics,/title="تنبيهات مهمة"/);
  assert.doesNotMatch(analytics,/className="rep-alerts"/);
  assert.match(analytics,/اختر نوع التحليل/);
  assert.match(analytics,/rep-analysis-actions/);
  assert.match(dashboard,/className="rep-alerts"/);
});

test('A-doctor analysis has only authenticated REP metrics and no team toggle',()=>{
  const detail=section('RepAnalysisDetail');
  assert.match(detail,/kind==='aDoctors'\?'\/rep-workspace-summary'\+periodQuery:null/);
  assert.match(detail,/useCompleteMedicalDirectory\(/);
  assert.match(detail,/kind==='aDoctors'\?'\/reps\/'\+encodeURIComponent\(user\.id\)\+'\/doctors':null/);
  assert.match(detail,/const rows=\(kind==='aDoctors'\?personalRows:allDoctors\)/);
  assert.match(detail,/const done=doctors\.filter/);
  assert.match(detail,/const personalReady=Boolean\(personalWorkspace&&personalDoctors\)/);
  assert.match(detail,/kind==='aDoctors'\?!personalWorkspace\|\|!personalDoctors:/);
  assert.match(detail,/areaIds:\[\.\.\.new Set\(doctorAreaIds\)\]/);
  assert.doesNotMatch(detail,/setADoctorScope|aDoctorScope|rep-analysis-scope-toggle|أطباء A للفريق/);
  assert.match(detail,/kind!=='coverage'&&kind!=='aDoctors'&&/);
  assert.doesNotMatch(detail,/rows=\(kind==='aDoctors'&&/);
  assert.match(section('RepAnalytics'),/kind:'aDoctors'/);
  assert.match(section('RepAnalytics'),/أطباء A غير مزارين/);
  assert.doesNotMatch(section('RepAnalytics'),/const unvisitedA=unvisited\.filter/);
});

test('REP home A-doctor alert is keyboard-clickable and routes to personal analysis',()=>{
  const home=section('RepHome');
  assert.match(home,/className="rep-alert"\s*onClick=\{\(\)=>navigate\('analysis-detail',\{kind:'aDoctors'\}\)\}/);
  assert.match(home,/<button type="button" className="rep-alert"/);
  assert.match(home,/أطباء A غير مزارين/);
  assert.doesNotMatch(home,/rep-alert-static/);
  const detail=section('RepAnalysisDetail');
  assert.match(detail,/kind==='aDoctors'\?personalRows:allDoctors/);
  assert.doesNotMatch(detail,/aDoctorScope|setADoctorScope/);
});


test('only the two hero values follow mandob-v2 personal data semantics',()=>{
  const home=section('RepHome'),analytics=section('RepAnalytics');
  assert.match(home,/className="rep-hero rep-v2-hero"/);
  assert.match(analytics,/className="rep-hero rep-analytics-hero rep-v2-hero"/);
  for(const label of ['تغطية السايكل','متبقي للنهاية','زيارات الأسبوع','زيارة متبقية'])
    assert.ok(home.includes(label),'Home V2 label missing: '+label);
  assert.match(home,/صباح الخير، \{user\.name\}/);
  assert.match(home,/rollingStart\.setUTCDate\(rollingStart\.getUTCDate\(\)-6\)/);
  assert.match(home,/\/rep-report\?from='\+rollingFrom\+/);
  assert.match(home,/cycleStart&&cycleStart>lastSevenFrom\?cycleStart:lastSevenFrom/);
  assert.match(home,/rollingWeek\.totalTargets\+' \/ '\+weeklyTarget/);
  assert.match(home,/workspace\?workspace\.doctors\.coverage/);
  assert.match(home,/v2RemainingDays\+' أيام'/);
  assert.match(home,/Math\.ceil\(\(Date\.parse\(cycleEnd/);
  for(const label of ['التزام Frequency','طبيب غير مزار','تغطية المناطق',
    'أطباء A غير مزارين'])
    assert.ok(analytics.includes(label),'Analytics V2 label missing: '+label);
  assert.match(analytics,/useCompleteMedicalDirectory\(/);
  assert.match(analytics,/personalCounts=workspace\?\.visitCounts\?\.doctors/);
  assert.match(analytics,/personalTargets=workspace\?\.visitTargets\?\.doctors/);
  assert.match(analytics,/personalRows\.reduce/);
  assert.match(analytics,/v2Compliance/);
  assert.match(analytics,/v2AreaCoverage/);
  assert.match(analytics,/personalReady&&assignedAreas\?v2AreaCoverage/);
  assert.match(analytics,/workspace\?workspace\.doctors\.unvisited/);
  assert.doesNotMatch(analytics,/الفريق: \{team\?/);
  assert.doesNotMatch(home,/الفريق: \{team\?/);
});
