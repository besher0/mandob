import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const cards=readFileSync(new URL('../src/RepAnalysisV2Cards.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/rep-analysis-reference.css',import.meta.url),'utf8');
const entry=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const section=name=>{
  const i=app.indexOf('function '+name+'(');
  assert.ok(i>=0,'Missing '+name);
  const j=app.indexOf('\nfunction ',i+10);
  return app.slice(i,j<0?undefined:j);
};

test('all six original analysis tabs use the reference selection card structure',()=>{
  const overview=section('RepAnalytics');
  for(const kind of ['frequency','unvisited','coverage','aDoctors','products','cycles'])
    assert.ok(overview.includes("kind:'"+kind+"'"),'Missing '+kind);
  assert.match(overview,/className="rep-analysis-actions analysis-grid"/);
  assert.match(overview,/className="rep-analysis-card action-card"/);
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/min-height:150px/);
});

test('all six detailed views match the shared v2 main card components',()=>{
  const detail=section('RepAnalysisDetail');
  const products=section('RepProductAnalysis');
  const cycles=section('RepCycleComparison');
  for(const block of [detail,products,cycles]){
    assert.match(block,/className="rep-home rep-analysis-detail rep-analysis-v2-ref"/);
    assert.match(block,/<RefAnalysisHead /);
    assert.match(block,/<RefAnalysisKpis /);
  }
  for(const element of ['RefDoctorAnalysisCard','RefAreaAnalysisCard','RefDistribution'])
    assert.ok(detail.includes('<'+element),'Missing '+element);
  assert.match(detail,/kind==='unvisited'/);
  assert.match(detail,/kind==='aDoctors'/);
  assert.match(products,/<RefProductAnalysisCard /);
  assert.match(cycles,/<RefCyclesTable /);
  assert.match(cards,/className="list-card ref-analysis-list-card ref-analysis-doctor"/);
  assert.match(cards,/className="list-card ref-analysis-list-card ref-analysis-area"/);
  assert.match(cards,/className="list-card ref-analysis-list-card ref-analysis-product"/);
  assert.match(cards,/className="analysis-table"/);
});

test('reference doctor cards preserve period visits, status, class and actual last visit',()=>{
  for(const text of ['آخر زيارة ضمن الفترة','زيارات الفترة','ref-grade-',
    'row.done','row.target','row.last','<progress max={100}'])
    assert.ok(cards.includes(text),'Missing doctor detail: '+text);
  assert.match(cards,/const percentage=row.target>0/);
  assert.match(cards,/row.done===0\?'غير مزار'/);
  assert.match(cards,/ref-analysis-badge red|red/);
});

test('A-doctors cannot switch to team data or lose PDF filtering',()=>{
  const detail=section('RepAnalysisDetail');
  assert.match(detail,/kind==='aDoctors'\?personalRows:allDoctors/);
  assert.match(detail,/useCompleteMedicalDirectory\(/);
  assert.match(detail,/kind==='aDoctors'\?'\/rep-workspace-summary'\+periodQuery:null/);
  assert.match(detail,/kind==='aDoctors'\?'\/reps\/'\+encodeURIComponent\(user.id\)\+'\/doctors':null/);
  assert.doesNotMatch(detail,/aDoctorScope|setADoctorScope|أطباء A للفريق/);
  assert.match(detail,/disabled=\{kind==='aDoctors'\?!personalWorkspace\|\|!personalDoctors:/);
  assert.match(detail,/const bodyRows=kind==='coverage'/);
  assert.match(detail,/doctors.map\(\(row:Any,index:number\)/);
});

test('scope v2 styling to REP analytics, never replace global four-role CSS',()=>{
  assert.match(entry,/import '\.\/rep-analysis-reference\.css';/);
  assert.match(css,/\.rep-layout \.rep-analysis-v2-ref/);
  assert.match(css,/\.rep-layout \.rep-analytics-page \.analysis-grid/);
  assert.doesNotMatch(css,/\.manager-legacy-shell|\.company-legacy-shell|\.admin-v2-shell/);
  for(const cls of ['ref-analysis-stats','ref-analysis-filter','ref-analysis-badge',
    'ref-analysis-list-card','analysis-table','ref-analysis-product'])
    assert.ok(css.includes(cls),'Missing reference class '+cls);
  assert.match(css,/@media\(max-width:520px\)/);
});
