'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash, createHmac } = require('node:crypto');
const { writeAtomic, readError } = require('./files');
const equal = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
// The same hash for a login, run in the background thread pool: a login (or many guesses)
// never stalls the server's replies while it is computed.
const passwordHashAsync = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key.toString('hex'))));
});
// A session is kept on disk by a hash of its token only, and the page's CSRF token is derived
// from the session token: the sessions file holds nothing that opens a session.
const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');
const csrfOf = (token) => createHmac('sha256', String(token)).update('csrf').digest('hex').slice(0, 48);
const PASSWORD_RULE = 'كلمة المرور 12 حرفًا على الأقل.';
// Failed logins are remembered for a minute, for at most this many accounts and addresses; an
// account keeps at most this many open sessions. Memory stays bounded whatever is sent.
const FAILURE_WINDOW_MS = 60000;
const MAX_FAILURE_KEYS = 10000;
const MAX_SESSIONS_PER_USER = 20;
const SESSION_MS = 8 * 3600000;
class Auth {
  constructor(dir) {
    this.file = path.join(dir, 'users.json'); this.sessionsFile = path.join(dir, 'sessions.json');
    this.sessions = new Map(); this.failures = new Map();
    this.users = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    this.loadSessions();
  }
  write() { writeAtomic(this.file, JSON.stringify(this.users, null, 2)); }
  // The sessions of the last run, so that a restart does not sign everyone out. Expired ones,
  // and those of an account disabled or removed meanwhile, are not kept.
  loadSessions() {
    let saved = [];
    try { saved = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') console.error(`sessions.json is not readable (${readError(error)}); every account signs in again.`); }
    const now = Date.now();
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!/^[a-f0-9]{64}$/.test(String(s?.hash)) || !(s.expires > now)) continue;
      const user = this.users.find(u => u.username === s.user?.username && !u.disabled);
      // A session of an earlier generation was ended (a new password, a logout whose file could
      // not be written): it does not come back from an old file.
      if (user && (s.epoch || 0) === (user.epoch || 0)) this.sessions.set(s.hash, { user: { username: user.username, name: user.name, role: user.role }, expires: s.expires, epoch: user.epoch || 0 });
    }
  }
  // Returns whether the file was written.
  saveSessions() {
    try { writeAtomic(this.sessionsFile, JSON.stringify([...this.sessions].map(([hash, s]) => ({ hash, user: s.user, expires: s.expires, epoch: s.epoch || 0 })))); return true; }
    catch (error) { console.error(`Sessions not saved: ${readError(error)}`); return false; }
  }
  // Starts a new generation of an account's sessions: those of the earlier ones are refused when
  // the sessions are loaded again, whatever the sessions file holds. Its remaining sessions move
  // to the new generation.
  newEpoch(username) {
    const user = this.users.find(u => u.username === username);
    if (!user) return;
    user.epoch = (user.epoch || 0) + 1;
    for (const s of this.sessions.values()) if (s.user.username === username) s.epoch = user.epoch;
  }
  add({ username, name, password, role = 'agent' }) {
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || !name?.trim() || typeof password !== 'string' || password.length < 12 || !['admin', 'agent'].includes(role)) throw new Error('اسم المستخدم 3–40 حرفًا لاتينيًا وكلمة المرور 12 حرفًا على الأقل.');
    if (this.users.some(u => u.username === username)) throw new Error('اسم المستخدم موجود بالفعل.');
    const user = { username, name: name.slice(0, 80), role, ...passwordHash(password) };
    this.users.push(user); this.write();
    return { username, name: user.name, role };
  }
  // Failed attempts only are counted, per account and address: behind one proxy every
  // employee shares the address, and a successful login must not lock the others out.
  // A wider limit per address still slows down guessing across many accounts. An attempt is
  // counted before its password is checked, so that attempts made at the same time are
  // limited too; a successful one is then taken off the count.
  async login(username, password, ip) {
    const now = Date.now(); const recent = key => (this.failures.get(key) || []).filter(t => now - t < FAILURE_WINDOW_MS);
    this.prune(now);
    const account = `${ip}|${String(username || '').toLowerCase().slice(0, 80)}`;
    if (recent(account).length >= 8 || recent(ip).length >= 40) throw new Error('محاولات كثيرة؛ حاول بعد دقيقة.');
    for (const key of [account, ip]) this.failures.set(key, [...recent(key), now]);
    const user = this.users.find(u => u.username === username);
    const hash = await passwordHashAsync(String(password || ''), user?.salt || 'invalid-user');
    if (!user || user.disabled || !equal(hash, user.hash)) throw new Error('بيانات الدخول غير صحيحة.');
    this.failures.delete(account); this.forgive(ip, now);
    const token = randomBytes(32).toString('hex');
    const session = { user: { username: user.username, name: user.name, role: user.role }, expires: now + SESSION_MS, epoch: user.epoch || 0 };
    const own = [...this.sessions].filter(([, s]) => s.user.username === user.username);
    for (const [old] of own.slice(0, Math.max(0, own.length - MAX_SESSIONS_PER_USER + 1))) this.sessions.delete(old);
    this.sessions.set(tokenHash(token), session); this.saveSessions();
    return { token, csrf: csrfOf(token), ...session };
  }
  // A successful attempt no longer counts against its address.
  forgive(ip, at) {
    const times = this.failures.get(ip) || []; const i = times.lastIndexOf(at);
    if (i >= 0) times.splice(i, 1);
    if (!times.length) this.failures.delete(ip);
  }
  // Forgets failures older than the window and expired sessions, and keeps the failure table
  // within its size by dropping its oldest entries.
  prune(now = Date.now()) {
    for (const [key, times] of this.failures) {
      const kept = times.filter(t => now - t < FAILURE_WINDOW_MS);
      if (kept.length) this.failures.set(key, kept); else this.failures.delete(key);
    }
    while (this.failures.size > MAX_FAILURE_KEYS) this.failures.delete(this.failures.keys().next().value);
    let expired = false;
    for (const [key, s] of this.sessions) if (s.expires < now) { this.sessions.delete(key); expired = true; }
    if (expired) this.saveSessions();
  }
  // A logout that could not be written to the sessions file is written to the accounts file
  // instead, as a new generation: the session does not return after a restart.
  logout(token) {
    const key = tokenHash(token); const session = this.sessions.get(key);
    if (!session || !this.sessions.delete(key) || this.saveSessions()) return;
    this.newEpoch(session.user.username);
    try { this.write(); this.saveSessions(); } catch (error) { console.error(`Logout not saved: ${readError(error)}`); }
  }
  // Ends every session of an account: after it is disabled or its password changes.
  revoke(username) {
    let ended = false;
    for (const [key, s] of this.sessions) if (s.user.username === username) { this.sessions.delete(key); ended = true; }
    if (ended) this.saveSessions();
  }
  // An admin disables or enables an account, or sets a new password for it.
  update(username, { disabled, password }, actor) {
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error('الحساب غير موجود.');
    // Everything is checked before anything changes: a refused update changes nothing.
    if (typeof disabled === 'boolean') {
      if (disabled && username === actor) throw new Error('لا يمكن تعطيل حسابك وأنت داخل به.');
      if (disabled && user.role === 'admin' && !this.users.some(u => u.role === 'admin' && !u.disabled && u.username !== username)) throw new Error('يلزم بقاء مسؤول واحد على الأقل.');
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 12)) throw new Error(PASSWORD_RULE);
    if (typeof disabled === 'boolean') user.disabled = disabled;
    if (password !== undefined) Object.assign(user, passwordHash(password));
    // The account's earlier sessions end with this write, even if the sessions file cannot be.
    if (password !== undefined || disabled === true) user.epoch = (user.epoch || 0) + 1;
    this.write(); this.revoke(username);
    return { username, name: user.name, role: user.role, disabled: user.disabled === true };
  }
  get(req) {
    const token = /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const key = tokenHash(token); const s = this.sessions.get(key);
    if (!s) return null;
    if (s.expires < Date.now()) { this.sessions.delete(key); this.saveSessions(); return null; }
    return { token, csrf: csrfOf(token), ...s };
  }
}
// The client's address. Behind the TLS proxy on this machine (TRUST_PROXY=1), the address the
// proxy added last to X-Forwarded-For: the earlier ones are whatever the client sent. A request
// that did not come through the local proxy is never believed about its address.
function clientIp(req, config = {}) {
  const socket = req.socket?.remoteAddress || '';
  if (config.trustProxy && /^(127\.|::1$|::ffff:127\.)/.test(socket)) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded.at(-1).slice(0, 64);
  }
  return socket;
}
module.exports = { Auth, equal, passwordHash, clientIp, tokenHash, csrfOf, MAX_FAILURE_KEYS, MAX_SESSIONS_PER_USER };
