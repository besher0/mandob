'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, isAllowed } = require('../security');

test('new passwords are salted and verified, never stored in plaintext', () => {
  const password = 'Secure!TestPassword2026';
  const a = hashPassword(password);
  const b = hashPassword(password);
  assert.notEqual(a, password);
  assert.notEqual(a, b);
  assert.ok(verifyPassword(password, a));
  assert.equal(verifyPassword('wrong-password', a), false);
  assert.equal(verifyPassword(password, password), false);
  assert.throws(() => hashPassword('1234'));
});
test('representative can only fetch their own doctors and stats', () => {
  const rep = { id: 7, role: 'REP' };
  assert.equal(isAllowed(rep, 'GET', '/api/reps/7/doctors'), true);
  assert.equal(isAllowed(rep, 'GET', '/api/reps/8/doctors'), false);
  assert.equal(isAllowed(rep, 'GET', '/api/analytics/frequency', { rep_id: '8' }), false);
  assert.equal(isAllowed(rep, 'GET', '/api/weekly-visits-count', { rep_id: '7' }), true);
});
test('representative cannot use privileged mutations or global lists', () => {
  const rep = { id: 7, role: 'REP' };
  for (const [method, path] of [['PATCH','/api/leaves/1/status'], ['PUT','/api/teams/1'],
    ['DELETE','/api/doctors/bulk'], ['GET','/api/team/reps'], ['GET','/api/doctors']]) {
    assert.equal(isAllowed(rep, method, path), false, method + ' ' + path);
  }
  assert.equal(isAllowed(rep, 'POST', '/api/visits'), true);
  assert.equal(isAllowed(null, 'POST', '/api/visits'), false);
});
test('team managers fail closed until team ownership is modelled', () => {
  assert.equal(isAllowed({ id: 3, role: 'TEAM_MANAGER' }, 'GET', '/api/team/reps'), false);
});
test('company admins are allowed, unknown roles denied', () => {
  assert.equal(isAllowed({ id: 3, role: 'COMPANY_ADMIN' }, 'POST', '/api/teams'), true);
  assert.equal(isAllowed({ id: 3, role: 'UNKNOWN' }, 'GET', '/api/visits'), false);
});
