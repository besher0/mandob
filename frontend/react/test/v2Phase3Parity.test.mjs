import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const style=readFileSync(new URL('../src/deep-parity-v2.css',import.meta.url),'utf8');
const browser=readFileSync(new URL('../scripts/v2-role-visual-smoke.mjs',import.meta.url),'utf8');

function getFunction(name){
  const start=app.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing '+name);
  const next=app.indexOf('\nfunction ',start+10);
  return app.slice(start,next>=0?next:app.length);
}

test('dialog keyboard manager traps Tab and restores focus to opener',()=>{
  const c=getFunction('useCloseOnEscape');
  assert.match(c,/dialogs\.reverse\(\)\.find/);
  assert.match(c,/event\.key!=='Tab'/);
  assert.match(c,/event\.shiftKey/);
  assert.match(c,/firstItem\.focus\(\)/);
  assert.match(c,/lastItem\.focus\(\)/);
  assert.match(c,/previouslyFocused\.focus\(\)/);
  assert.match(browser,/Representative sheet did not trap Shift\+Tab/);
});
test('restored original report controls retain secure printing, sending and pagination',()=>{
  const c=getFunction('RepReports');
  for(const cls of ['rep-report-tabs rep-legacy-tabs','rep-legacy-range',
    'rep-legacy-report-preview','rep-legacy-dual-actions',
    'rep-legacy-report-history'])
    assert.ok(c.includes(cls),'Original report component missing: '+cls);
  assert.match(c,/onClick=\{printDetailed\}/);
  assert.match(c,/onClick=\{sendReport\}/);
  assert.match(c,/historyMode\?'\/rep-reports\?paginated=true'/);
  assert.match(c,/const nextCursor=historyMode/);
  assert.match(c,/onClick=\{loadOlderReports\}/);
  assert.match(c,/عرض تقارير أقدم/);
});
test('analytics summary uses original personal/team metrics with v2 card hierarchy',()=>{
  const c=getFunction('RepAnalytics');
  assert.match(c,/rep-analytics-hero/);
  assert.match(c,/تغطية السايكل للمندوب/);
  assert.match(c,/الفريق:/);
  assert.match(c,/analysis-detail/);
  assert.match(style,/\.rep-layout-v2-disabled \.rep-analytics-page \.rep-analytics-hero/);
  assert.match(browser,/Original representative analysis counters are missing/);
});
test('company cycle quick links lead to real form fields only',()=>{
  const c=getFunction('CompanySettingsPage');
  for(const anchor of ['company-cycle-period','company-cycle-frequency',
    'company-cycle-coverage','company-cycle-working-days']){
    assert.match(c,new RegExp('href="#'+anchor+'"'));
    assert.match(c,new RegExp('id="'+anchor+'"'));
  }
  assert.match(c,/await patch\('\/settings'/);
  assert.match(style,/\.company-legacy-shell \.company-cycle-quick-nav/);
});
test('all four existing role shells and secured admin onboarding remain intact',()=>{
  assert.match(app,/function Companies\(/);
  assert.match(app,/function CompanyTeamsPage\(/);
  assert.match(app,/function LegacyManagerTeamsPage\(/);
  assert.match(app,/function NewVisit\(/);
  assert.match(app,/post\('\/companies',\{name:val\(fd,'name'\)\}\)/);
  assert.match(app,/\/manager\/active-team/);
  for(const role of ['rep-layout','manager-legacy-shell','company-legacy-shell','admin-v2-shell'])
    assert.ok(style.includes('.'+role));
});
