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
