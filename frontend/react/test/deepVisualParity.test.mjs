import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const entry=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const detail=readFileSync(new URL('../src/deep-parity-v2.css',import.meta.url),'utf8');

test('detail parity stylesheet loads after the existing functional styles',()=>{
  assert.match(entry,/import '\.\/style\.css';\s*import '\.\/visual-parity-v2\.css';\s*import '\.\/deep-parity-v2\.css';/);
  for(const role of ['rep-layout','manager-legacy-shell','company-legacy-shell','admin-v2-shell'])
    assert.ok(detail.includes('.'+role),'Missing visual role scope: '+role);
});
test('medical directories retain their filters and per-target area selection',()=>{
  for(const field of ['setGrades','setSpecialtiesSelected','setCategoriesSelected',
    'setUnvisitedOnly','lastVisitDates','doctorAreas','loadStoredTourFilters',
    'areaByTarget','matchingTourAreas'])
    assert.ok(app.includes(field),'Existing medical flow dropped: '+field);
  for(const selector of ['.rep-medical-card','.rep-filter-sheet','.rep-active-filters',
    '.tour-target-card','.rep-tour-ambiguous-area'])
    assert.ok(detail.includes(selector),'Missing component styling: '+selector);
});
test('team manager exposes working grade/category filters and reset',()=>{
  assert.match(app,/aria-label="التصنيف"\s+value=\{grade\}/);
  assert.match(app,/aria-label="نوع المنشأة"\s+value=\{category\}/);
  assert.match(app,/params\.set\('grade',grade\)/);
  assert.match(app,/params\.set\('category',category\)/);
  assert.match(app,/className="manager-active-filters"/);
  assert.match(app,/manager-reset-filters/);
  assert.match(detail,/\.manager-legacy-shell \.manager-active-filters/);
});
test('company data filters show chips, results and reset control',()=>{
  assert.match(app,/className="company-data-active-filters"/);
  assert.match(app,/company-data-reset/);
  assert.match(app,/className="company-data-results-count"/);
  assert.match(app,/aria-label="فلترة المحافظة"/);
  assert.match(app,/aria-label="فلترة المنطقة"/);
  assert.match(detail,/\.company-legacy-shell \.data-tabs/);
  assert.match(detail,/\.company-legacy-shell \.settings-card/);
});
test('company dialogs and representative filters close on Escape',()=>{
  assert.match(app,/function useCloseOnEscape\(open:boolean,onClose:\(\)=>void\)/);
  assert.match(app,/event\.key==='Escape'/);
  assert.match(app,/useCloseOnEscape\(open,onClose\)/);
  assert.match(app,/useCloseOnEscape\(filterOpen,\(\)=>setFilterOpen\(false\)\)/);
  assert.match(app,/role="dialog" aria-modal="true" aria-label=\{title\}/);
  assert.match(detail,/\.company-legacy-shell \.company-modal-backdrop/);
  assert.match(detail,/\.manager-legacy-shell \.manager-inline-modal \.modal/);
});
test('admin company creation keeps two secured backend writes',()=>{
  assert.match(app,/post\('\/companies',\{name:val\(fd,'name'\)\}\)/);
  assert.match(app,/post\('\/companies\/'\+val\(fd,'companyId'\)\+'\/admins'/);
  assert.match(detail,/\.admin-v2-shell \.admin-v2-form-step/);
});
test('details include consistent error/success, responsive and reduced-motion styles',()=>{
  assert.match(detail,/\.notice\.error/);
  assert.match(detail,/\.notice\.success/);
  assert.match(detail,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(detail,/@media\(max-width:520px\)/);
});


test('medical directory matches v2 as one panel while keeping real filter and visit data',()=>{
  const begin=app.indexOf('function RepMedicalDirectory(');
  const end=app.indexOf('\nfunction ',begin+10);
  const directory=app.slice(begin,end>=0?end:undefined);
  for(const part of ['className="rep-directory-v2-panel"',
    'className="rep-directory-v2-input-row"',
    'className="rep-directory-v2-unvisited"',
    'className="rep-legacy-filter-toolbar rep-directory-v2-filters"',
    'aria-haspopup="dialog"','linkedAreaNames(item)','lastVisit(item)','visitTarget(item)'])
    assert.ok(directory.includes(part),'Medical directory lost '+part);
  assert.doesNotMatch(directory,/className="rep-legacy-page-head"/);
  assert.doesNotMatch(directory,/className=\{'rep-medical-hero/);
  assert.doesNotMatch(directory,/className="rep-medical-stats rep-legacy-stats-row"/);
  assert.match(detail,/\.rep-layout \.rep-directory-v2-panel\{/);
});
