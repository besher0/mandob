import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homePath,routePath} from '../src/routing.mjs';

test('representative pages have stable direct URLs',()=>{
  assert.equal(routePath('REP','dashboard'),'/rep/dashboard');
  assert.equal(routePath('REP','doctors'),'/rep/doctors');
  assert.equal(routePath('REP','new-visit',{type:'DOCTOR',areaId:'area-1'}),
    '/rep/new-visit?type=DOCTOR&areaId=area-1');
});

test('each role gets an isolated home namespace',()=>{
  assert.equal(homePath('SUPER_ADMIN'),'/super-admin/companies');
  assert.equal(homePath('COMPANY_ADMIN'),'/company/dashboard');
  assert.equal(homePath('TEAM_MANAGER'),'/manager/dashboard');
  assert.equal(homePath('REP'),'/rep/dashboard');
});

test('query values are encoded for direct tour links',()=>{
  assert.equal(routePath('REP','new-visit',{type:'DOCTOR',areaId:'area/with space'}),
    '/rep/new-visit?type=DOCTOR&areaId=area%2Fwith+space');
});


test('legacy representative home destinations have dedicated bookmarkable URLs',()=>{
  assert.equal(routePath('REP','analytics'),'/rep/analytics');
  assert.equal(routePath('REP','plan-products'),'/rep/plan-products');
  assert.equal(routePath('REP','reports'),'/rep/reports');
  assert.equal(routePath('REP','profile'),'/rep/profile');
  assert.equal(routePath('REP','pharmacies'),'/rep/pharmacies');
  assert.equal(routePath('REP','hospitals'),'/rep/hospitals');
  assert.equal(routePath('REP','areas'),'/rep/areas');
});

test('area-scoped pharmacy and doctor tour links preserve the actual area',()=>{
  assert.equal(routePath('REP','new-visit',{type:'PHARMACY',areaId:'area-42'}),
    '/rep/new-visit?type=PHARMACY&areaId=area-42');
  assert.equal(routePath('REP','new-visit',{type:'DOCTOR',areaId:'area-42'}),
    '/rep/new-visit?type=DOCTOR&areaId=area-42');
});
