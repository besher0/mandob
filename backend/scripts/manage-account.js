'use strict';
const db = require('../database');
const { hashPassword } = require('../security');

const action = process.argv[2];
const username = String(process.env.ACCOUNT_USERNAME || '').trim();
const password = process.env.ACCOUNT_PASSWORD;
if (!username || username.length > 150 || typeof password !== 'string') {
  console.error('Set ACCOUNT_USERNAME and ACCOUNT_PASSWORD (12+ characters) in a secure environment.');
  process.exit(1);
}
let hashed;
try { hashed = hashPassword(password); }
catch (error) { console.error(error.message); process.exit(1); }
const matches = db.prepare('SELECT id FROM users WHERE username = ?').all(username);
if (matches.length > 1) {
  console.error('Duplicate username: resolve duplicates before changing credentials.');
  process.exit(1);
}
if (action === 'reset' && matches.length === 1) {
  db.transaction(() => {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, matches[0].id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(matches[0].id);
  })();
  console.log('Password changed; previous sessions revoked for', username);
} else if (action === 'create-admin' && matches.length === 0) {
  const name = String(process.env.ACCOUNT_NAME || '').trim();
  if (!name) { console.error('ACCOUNT_NAME required'); process.exit(1); }
  db.prepare('INSERT INTO users (name, role, username, password) VALUES (?, ?, ?, ?)').run(name, 'COMPANY_ADMIN', username, hashed);
  console.log('Company admin created:', username);
} else {
  console.error('Use "reset" for an existing username or "create-admin" for a new username.');
  process.exit(1);
}
