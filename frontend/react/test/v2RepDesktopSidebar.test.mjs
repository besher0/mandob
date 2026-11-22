import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/reference-final-v2.css',import.meta.url),'utf8');
const browser=readFileSync(new URL('../scripts/v2-role-visual-smoke.mjs',import.meta.url),'utf8');
const start=app.indexOf('function PageLayout(');
const end=app.indexOf('\nfunction AuthenticatedRoutes(',start);
const layout=app.slice(start,end>=0?end:undefined);

test('REP desktop nav follows final V2 reference order and existing authorized routes',()=>{
  assert.ok(start>=0&&end>start);
  const entries=[
    ['dashboard','الرئيسية'],['plan-products','الخطة والأصناف'],
    ['areas','مناطقي'],['doctors','الأطباء'],['pharmacies','الصيدليات'],
    ['hospitals','المشافي'],['new-visit','جولة جديدة'],['visits','سجل الزيارات'],
    ['analytics','التحليل'],['reports','التقارير'],['leaves','الإجازات'],
    ['notifications','الإشعارات'],['profile','حسابي']
  ];
  const begin=layout.indexOf('const repReferenceMenu:');
  const finish=layout.indexOf('const visibleMenu=',begin);
  const menu=layout.slice(begin,finish);
  let last=-1;
  for(const [key,label] of entries){
    const token="['"+key+"','"+label+"']";
    const index=menu.indexOf(token);
    assert.ok(index>last,'Missing/misordered V2 REP sidebar entry: '+token);
    last=index;
  }
  assert.match(layout,/user\.role==='REP'\?repReferenceMenu/);
  assert.match(layout,/if\(user\.role==='REP'&&key==='notifications'\)/);
  assert.match(layout,/setRepAlertsOpen\(value=>!value\)/);
  assert.match(layout,/aria-label=\{user\.role==='REP'\?'التنقل الرئيسي للمندوب'/);
  assert.match(layout,/aria-expanded=\{user\.role==='REP'&&key==='notifications'\?repAlertsOpen/);
});

test('REP mobile still retains the four existing footer buttons',()=>{
  const footer=layout.slice(layout.indexOf('<nav className="rep-bottom-nav"'));
  assert.match(footer,/id:'dashboard',icon:'home',label:'الرئيسية'/);
  assert.match(footer,/id:'analytics',icon:'analytics',label:'التحليل'/);
  assert.match(footer,/id:'reports',icon:'reports',label:'التقارير'/);
  assert.match(footer,/id:'profile',icon:'account',label:'حسابي'/);
  assert.match(browser,/navExpected=\['الرئيسية','التحليل','التقارير','حسابي'\]/);
});

test('V2 REP sidebar visuals remain scoped and width-stable',()=>{
  assert.match(css,/\.rep-layout \.sidebar \{/);
  assert.match(css,/box-sizing:border-box;\s*padding:22px 15px;/);
  assert.match(css,/border-left:1px solid #d8e9df/);
  assert.match(css,/\.rep-layout \.sidebar nav button\.active/);
  assert.match(browser,/full 13-link V2 desktop sidebar/);
});
