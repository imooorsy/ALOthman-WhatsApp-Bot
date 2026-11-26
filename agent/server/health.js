'use strict';
// What /health tells an outside monitor (deploy/README.md, step 7). 503 when clients are not
// being served: the state cannot be written, the assistant is switched on but not answering
// (the number's connection included), or Evolution's webhooks are being refused. Warnings keep
// the 200: what an admin should fix before it matters. Codes and times only, never client data.
const fs = require('node:fs');
const path = require('node:path');

const HOUR = 3600000;
// A backup is due every night (deploy/elmaster-backup.timer): older than this, one was missed.
const BACKUP_DUE_MS = 26 * HOUR;
// Refused webhooks with nothing accepted since, this recently: client messages are being lost.
const REFUSED_MS = 30 * 60000;

// When the newest backup in the backup folder finished (its manifest is written last), or null.
function lastBackup(dir) {
  try {
    const done = fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'manifest.json'))).sort();
    return done.length ? fs.statSync(path.join(dir, done.at(-1), 'manifest.json')).mtimeMs : null;
  } catch { return null; }
}

function healthReport({ store, engine, config, now = Date.now() }) {
  const live = config.mode === 'live';
  const status = engine.status();
  const hook = store.data.webhook || {};
  const channel = store.data.alertChannel || {};
  const problems = []; const warnings = [];
  if (store.saveError) problems.push('storage');
  if (status.enabled && !status.answering) problems.push('not_answering');
  const refused = live && hook.rejectedAt && now - hook.rejectedAt < 24 * HOUR;
  if (refused && now - hook.rejectedAt < REFUSED_MS && !(hook.acceptedAt > hook.rejectedAt)) problems.push('webhook_rejected');
  else if (refused) warnings.push('webhook_rejected');
  const backupAt = live ? lastBackup(config.backupDir) : null;
  if (live) {
    if (!config.alertWebhook) warnings.push('alert_channel_missing');
    else if (channel.failedAt > (channel.okAt || 0)) warnings.push('alert_channel_failing');
    if (!status.enabled && store.data.connection?.state !== 'open') warnings.push('not_connected');
    if (!backupAt) warnings.push('backup_missing');
    else if (now - backupAt > BACKUP_DUE_MS) warnings.push('backup_old');
  }
  // The day's exchange rates (server/rates.js): without a recent table, an amount in a currency not
  // pegged to the dollar goes to the team instead of being converted.
  const fx = engine.fx ? engine.fx.status() : null;
  if (live && fx && !fx.fresh) warnings.push('rates_stale');
  const body = { ok: !problems.length, mode: config.mode, problems, warnings,
    ...(problems.includes('not_answering') ? { missing: status.missing } : {}),
    ...(live ? { webhook: { lastAcceptedAt: hook.acceptedAt || null, rejected: hook.rejected || 0 },
      backup: { lastAt: backupAt, ageHours: backupAt ? Math.floor((now - backupAt) / HOUR) : null },
      rates: fx ? { date: fx.date, ageHours: fx.ageHours } : null } : {}) };
  return { status: problems.length ? 503 : 200, body };
}

module.exports = { healthReport, lastBackup, BACKUP_DUE_MS };
