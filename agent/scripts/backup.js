'use strict';
// Backups of the server's data folder (.local/ by default): the state (state.json and one file
// per conversation in conversations/), the audit trail, the accounts and the attachments,
// copied with a SHA-256 of each file (task 23, deploy/README.md).
//
//   npm run backup                       a copy in BACKUP_DIR/<time>/ (default backups/), the 14 newest kept
//   npm run backup -- --keep 30          keeps the 30 newest
//   npm run restore -- backups/<time>    puts a copy back: only with the server stopped; the
//                                        current data is moved aside first, never deleted
//   node scripts/backup.js notify-failure
//                                        sends a backup_failed alert to ALERT_WEBHOOK_URL (run
//                                        by systemd when a backup fails: deploy/elmaster-backup.service)
//
// The server replaces each file whole (server/files.js), so a copy taken while it runs holds
// whole files, never half of one; a conversation that started during the copy may be missing,
// as if the copy had been taken a moment earlier, and the audit trail may miss its last line.
// A file unchanged since the previous backup (same size and time) is a hard link to that copy,
// checked against its hash first: attachments are not stored again every night. A restore needs
// the server stopped, since the running server would write over it.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { loadEnv, config } = require('../server/config');
const { postAlert } = require('../server/alerts');

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
// Sessions are not backed up: a restore never brings back a session that has ended.
const SKIPPED = new Set(['sessions.json']);

// Every file under a folder, as paths relative to it.
function filesOf(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesOf(full, base);
    const rel = path.relative(base, full);
    return entry.isFile() && !entry.name.endsWith('.tmp') && !SKIPPED.has(rel) ? [rel] : [];
  });
}

// The newest complete backup in `into` (its manifest is written last), or null.
function previous(into) {
  if (!fs.existsSync(into)) return null;
  const done = fs.readdirSync(into).filter((name) => fs.existsSync(path.join(into, name, 'manifest.json'))).sort();
  if (!done.length) return null;
  try {
    const target = path.join(into, done.at(-1));
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    return { target, files: new Map(manifest.files.map((f) => [f.path, f])) };
  } catch { return null; }
}

// The previous copy of a file, linked into the new backup when the file has not changed since
// and that copy is still sound. Returns the manifest entry, or null to copy the file instead.
function linkUnchanged(before, rel, stat, to) {
  const key = rel.split(path.sep).join('/');
  const old = before?.files.get(key);
  if (!old || old.size !== stat.size || old.mtimeMs !== stat.mtimeMs) return null;
  const copy = path.join(before.target, 'data', ...key.split('/'));
  try {
    if (!fs.existsSync(copy) || sha256(copy) !== old.sha256) return null;
    fs.linkSync(copy, to);
    return { path: key, sha256: old.sha256, size: stat.size, mtimeMs: stat.mtimeMs, linked: true };
  } catch { return null; }
}

// Copies the data folder into `into`/<time>/ with a manifest, and keeps the `keep` newest.
function backup(dataDir, into, { keep = 14 } = {}) {
  if (!fs.existsSync(path.join(dataDir, 'state.json'))) throw new Error(`No state.json in ${dataDir}: nothing to back up.`);
  fs.mkdirSync(into, { recursive: true, mode: 0o700 });
  const before = previous(into);
  // A new folder every time: a file in it may be a link shared with an older backup.
  let target = path.join(into, stamp());
  while (fs.existsSync(target)) target += '-1';
  const files = [];
  for (const rel of filesOf(dataDir)) {
    const from = path.join(dataDir, rel); const to = path.join(target, 'data', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    const stat = fs.statSync(from);
    const linked = linkUnchanged(before, rel, stat, to);
    if (linked) { files.push(linked); continue; }
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o600);
    files.push({ path: rel.split(path.sep).join('/'), sha256: sha256(to), size: fs.statSync(to).size, mtimeMs: stat.mtimeMs });
  }
  // The copy of the state must be readable on its own: the core and every conversation.
  JSON.parse(fs.readFileSync(path.join(target, 'data', 'state.json'), 'utf8'));
  for (const f of files) if (/^conversations\/[^/]+\.json$/.test(f.path)) JSON.parse(fs.readFileSync(path.join(target, 'data', ...f.path.split('/')), 'utf8'));
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), from: dataDir, files }, null, 2), { mode: 0o600 });
  const all = fs.readdirSync(into).filter((name) => fs.existsSync(path.join(into, name, 'manifest.json'))).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(into, old), { recursive: true, force: true });
  return { target, files: files.length, linked: files.filter((f) => f.linked).length };
}

// Checks a backup against its manifest: every file there, with its hash.
function verify(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  const bad = manifest.files.filter((f) => {
    const file = path.join(source, 'data', ...f.path.split('/'));
    return !fs.existsSync(file) || sha256(file) !== f.sha256;
  });
  if (bad.length) throw new Error(`The backup is damaged: ${bad.map((f) => f.path).slice(0, 5).join(', ')}`);
  return manifest;
}

// Whether something answers on the server's port: then the server runs, and a restore waits.
function portInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

// Puts a verified backup in place of the data folder; the current one is moved aside. Each file
// is copied, never linked: the restored data is independent of the backups.
function restore(source, dataDir) {
  const manifest = verify(source);
  let aside = null;
  if (fs.existsSync(dataDir)) { aside = `${dataDir}.before-restore-${stamp()}`; fs.renameSync(dataDir, aside); }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  for (const f of manifest.files) {
    const to = path.join(dataDir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(source, 'data', ...f.path.split('/')), to);
    fs.chmodSync(to, 0o600);
  }
  return { restored: manifest.files.length, aside };
}

// A failed backup is an alert, like the server's (no client data). Run by systemd's OnFailure=.
async function notifyFailure(c, fetcher = fetch) {
  if (!c.alertWebhook) throw new Error('No ALERT_WEBHOOK_URL: the failed backup is only in the journal (journalctl -u elmaster-backup).');
  const result = await postAlert(c.alertWebhook, { kind: 'backup_failed', origin: c.origin }, fetcher);
  if (!result.ok) throw new Error(`The backup_failed alert was not delivered (${result.error}).`);
  return result;
}

async function main(argv) {
  loadEnv();
  const c = config();
  const [command, ...rest] = argv;
  if (command === 'backup') {
    const keep = rest[0] === '--keep' && /^\d+$/.test(rest[1] || '') ? Number(rest[1]) : 14;
    const result = backup(c.dir, c.backupDir, { keep });
    console.log(`Backup: ${result.files} files (${result.linked} unchanged, linked to the previous copy) -> ${result.target}`);
  } else if (command === 'restore') {
    if (!rest[0]) throw new Error('Usage: npm run restore -- backups/<time>');
    if (await portInUse(c.host, c.port)) throw new Error(`The server answers on ${c.host}:${c.port}; stop it before restoring.`);
    const result = restore(path.resolve(rest[0]), c.dir);
    console.log(`Restored ${result.restored} files into ${c.dir}.${result.aside ? ` The previous data is kept in ${result.aside}.` : ''}`);
  } else if (command === 'notify-failure') {
    await notifyFailure(c);
    console.log('The backup_failed alert was sent.');
  } else throw new Error('Usage: node scripts/backup.js backup|restore|notify-failure');
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { backup, verify, restore, filesOf, notifyFailure };
