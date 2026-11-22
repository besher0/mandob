import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const entry=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/visual-parity-v2.css',import.meta.url),'utf8');
const classic=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');

test('reference v2 theme is imported after the existing functional styles',()=>{
  assert.match(entry,/import '\.\/style\.css';\s*import '\.\/visual-parity-v2\.css';/);
  for(const token of ['#f3f7f8','#173b38','#1b8061','#e9f7ef','#e0e8e5']){
    assert.ok(css.includes(token),`Missing v2 design token: ${token}`);
  }
  assert.match(css,/width:270px;min-width:270px/);
});

test('all four authenticated roles have an isolated v2 shell',()=>{
  for(const cls of ['rep-layout','manager-legacy-shell','company-legacy-shell','admin-v2-shell']){
    assert.ok(css.includes('.'+cls),`Missing stylesheet coverage for ${cls}`);
  }
  assert.match(app,/className="company-legacy-shell"/);
  assert.match(app,/className="layout manager-layout manager-legacy-shell"/);
  assert.match(app,/\?'layout rep-layout'/);
  assert.match(app,/'layout admin-v2-shell'/);
});

test('v2 representative navigation uses the four reference icon tabs and a separate round action',()=>{
  for(const entry of [
    "{id:'dashboard',icon:'home',label:'الرئيسية'}",
    "{id:'analytics',icon:'analytics',label:'التحليل'}",
    "{id:'reports',icon:'reports',label:'التقارير'}",
    "{id:'profile',icon:'account',label:'حسابي'}"
  ])assert.ok(app.includes(entry),`Missing mobile destination: ${entry}`);
  assert.match(app,/className="rep-tour-fab"/);
  assert.match(app,/onClick=\{\(\)=>navigateTo\('new-visit'/);
  assert.match(app,/src=\{'\/icons\/'\+item.icon\+'\.svg'\}/);
  assert.match(app,/<strong>MedREP<\/strong>/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(classic,/\.rep-tour-fab/);
  assert.match(classic,/\.rep-header-bell/);
});

test('the team manager and company manager preserve their functional workspace',()=>{
  assert.match(app,/user\.role==='TEAM_MANAGER'\?'\/manager\/assigned-teams':null/);
  assert.match(app,/activeTeamId/);
  assert.match(app,/onClick=\{\(\)=>navigateTo\(key\)\}/);
  assert.match(app,/companyGovernorate/);
  assert.match(css,/\.manager-legacy-shell \.sidebar \.menu button/);
  assert.match(css,/\.company-legacy-shell \.company-sidebar \.nav-item/);
});

test('mobile layouts keep every management navigation item available',()=>{
  assert.match(css,/@media\(max-width:950px\)/);
  assert.match(css,/\.company-legacy-shell \.company-sidebar,\.manager-legacy-shell \.sidebar/);
  assert.match(css,/display:flex!important/);
  assert.match(css,/\.manager-legacy-shell \.mobile-nav,\.company-legacy-shell \.company-mobile-nav\{display:none!important\}/);
});
