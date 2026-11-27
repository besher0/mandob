import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../scripts/v2-side-by-side.mjs',import.meta.url),'utf8');
test('company cycle route compares to V2 cycles; settings remain unpaired',()=>{
  assert.match(script,/\['cycles','company-cycles'\]/);
  assert.match(script,/COMPANY_ADMIN\/settings/);
  assert.doesNotMatch(script,/\['settings','company-cycles'\]/);
  assert.doesNotMatch(script,/\['settings','company-access'\]/);
});
test('company medical data is not misrepresented as V2 province catalog',()=>{
  assert.match(script,/\['governorates','company-catalog'\]/);
  assert.doesNotMatch(script,/\['data','company-catalog'\]/);
  assert.match(script,/partialComparisons/);
  assert.match(script,/COMPANY_ADMIN\/data/);
});
test('manager target type is selected before comparisons of pharmacy and hospital',()=>{
  assert.match(script,/\['pharmacies','manager-targets'\]/);
  assert.match(script,/\['hospitals','manager-targets'\]/);
  assert.match(script,/selectOption\(oldPage==='pharmacies'\?'PHARMACY':'HOSPITAL'\)/);
});
test('representative combined v2 leave page covers both distinct Mandob routes',()=>{
  assert.match(script,/\['leaves','leaves'\]/);
  assert.match(script,/\['new-leave','leaves'\]/);
});
test('visual audit saves browser computed CSS values alongside screenshots',()=>{
  for(const key of ['fontFamily','fontSize','fontWeight','backgroundColor',
    'borderRadius','borderColor','padding','boxShadow','primaryButton','counts'])
    assert.ok(script.includes(key),'Missing style audit field: '+key);
  assert.match(script,/current\.styles=\{mandob:mandobStyles,v2:v2Styles\}/);
});
test('the audit labels fixture screenshots as nonproduction data',()=>{
  assert.match(script,/blank API fixtures/);
  assert.match(script,/not production data or end-to-end business behavior/);
});
