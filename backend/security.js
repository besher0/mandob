'use strict';
const crypto = require('node:crypto');

const COOKIE_NAME = 'medrep_sid';
const SESSION_MS = 8 * 60 * 60 * 1000;
const KDF = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ADMIN_ROLES = new Set(['COMPANY_ADMIN', 'SUPER_ADMIN']);
const rateBuckets = new Map();

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Password must contain between 12 and 256 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, KDF);
  return 'scrypt$16384$8$1$' + salt + '$' + hash.toString('hex');
}

function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' ||
      parts[2] !== '8' || parts[3] !== '1' ||
      !/^[0-9a-f]{32}$/.test(parts[4]) || !/^[0-9a-f]{128}$/.test(parts[5])) return false;
  try {
    const actual = crypto.scryptSync(password, Buffer.from(parts[4], 'hex'), 64, KDF);
    return crypto.timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
  } catch (_) {
    return false;
  }
}

function getCookie(header, name) {
  const item = String(header || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return item ? item.slice(name.length + 1) : null;
}

function isAllowed(user, method, requestPath, query = {}) {
  if (!user) return false;
  if (ADMIN_ROLES.has(user.role)) return true;
  // The legacy database has no authenticated team-manager-to-team relationship.
  // TEAM_MANAGER is deliberately denied until team-scoped authorization is implemented.
  if (user.role !== 'REP') return false;
  const own = id => Number.isSafeInteger(Number(id)) && Number(id) === Number(user.id);
  if (method === 'GET' && /^\/api\/reps\/\d+\/doctors$/.test(requestPath)) {
    return own(requestPath.split('/')[3]);
  }
  if (method === 'GET' && ['/api/analytics/frequency','/api/weekly-visits-count'].includes(requestPath)) {
    return own(query.rep_id);
  }
  const readable = ['/api/visits','/api/leaves','/api/pharmacies','/api/hospitals','/api/cycle-settings'];
  if (method === 'GET' && readable.includes(requestPath)) return true;
  if (method === 'POST' && ['/api/visits','/api/leaves'].includes(requestPath)) return true;
  return false;
}

function userProfile(db, id) {
  return db.prepare("SELECT u.id, u.name, u.role, u.username, COALESCE((SELECT group_concat(a.name, '، ') FROM rep_areas ra JOIN areas a ON a.id = ra.area_id WHERE ra.rep_id = u.id), '') AS areas FROM users u WHERE u.id = ?").get(id);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients still require authenticated sessions.
  try {
    const expected = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin :
      (req.protocol + '://' + req.get('host'));
    return new URL(origin).origin === expected;
  } catch (_) {
    return false;
  }
}

function rateLimit(ip, username) {
  const now = Date.now();
  if (rateBuckets.size > 2000) {
    for (const [key, value] of rateBuckets) if (value.until <= now) rateBuckets.delete(key);
    if (rateBuckets.size > 2000) rateBuckets.clear();
  }
  const key = String(ip) + ':' + String(username).toLowerCase();
  const bucket = rateBuckets.get(key);
  if (bucket && bucket.until > now && bucket.failures >= 5) return false;
  if (!bucket || bucket.until <= now) rateBuckets.set(key, { failures: 0, until: now + 15 * 60 * 1000 });
  return true;
}

function noteFailure(ip, username) {
  const key = String(ip) + ':' + String(username).toLowerCase();
  const item = rateBuckets.get(key);
  if (item) item.failures += 1;
}

function installSecurity(app, db) {
  db.exec("CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);");
  const selectSession = db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?');
  const insertSession = db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)');
  const deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
  const clearExpired = db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?');

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !originAllowed(req)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  function sessionToken(req) {
    const raw = getCookie(req.headers.cookie, COOKIE_NAME);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? crypto.createHash('sha256').update(raw).digest('hex') : null;
  }
  function clearCookie(res) {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0' +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  }
  function authenticate(req, res, next) {
    const tokenHash = sessionToken(req);
    const session = tokenHash ? selectSession.get(tokenHash, Date.now()) : null;
    const user = session ? userProfile(db, session.user_id) : null;
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.authUser = user;
    req.sessionTokenHash = tokenHash;
    next();
  }

  app.post('/api/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = req.body?.password;
    if (!username || username.length > 150 || typeof password !== 'string' || password.length > 256) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    if (!rateLimit(req.ip, username)) return res.status(429).json({ error: 'Too many attempts; try later' });
    const row = db.prepare('SELECT id, password FROM users WHERE username = ?').all(username);
    // Only password hashes are accepted. Legacy plaintext credentials must be reset by an administrator.
    if (row.length !== 1 || !verifyPassword(password, row[0].password)) {
      noteFailure(req.ip, username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    rateBuckets.delete(String(req.ip) + ':' + username.toLowerCase());
    clearExpired.run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    insertSession.run(crypto.createHash('sha256').update(token).digest('hex'), row[0].id, now + SESSION_MS, now);
    res.setHeader('Set-Cookie', COOKIE_NAME + '=' + token + '; HttpOnly; SameSite=Strict; Path=/api; Max-Age=' +
      Math.floor(SESSION_MS / 1000) + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
    res.json({ success: true, user: userProfile(db, row[0].id) });
  });
  app.get('/api/me', authenticate, (req, res) => res.json({ user: req.authUser }));
  app.post('/api/logout', authenticate, (req, res) => {
    deleteSession.run(req.sessionTokenHash);
    clearCookie(res);
    res.json({ success: true });
  });
  app.use('/api', authenticate, (req, res, next) => {
    if (!isAllowed(req.authUser, req.method, req.originalUrl.split('?')[0], req.query)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  });
}

module.exports = { installSecurity, hashPassword, verifyPassword, isAllowed, originAllowed };
