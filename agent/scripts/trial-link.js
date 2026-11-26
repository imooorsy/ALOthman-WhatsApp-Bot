'use strict';
// Links the test number for the trial (deploy/README.md, «تجربة على رقم تجريبي»):
// 1. creates the instance in Evolution API if it is not there (direct chats only, no history);
// 2. points its webhook at this server, with the server's secret;
// 3. asks for the link: the QR code as an image (deploy/trial/qr.png, written again whenever it
//    changes), and a pairing code to type in WhatsApp when the number is known (--number, or
//    TRIAL_NUMBER in .env.local);
// 4. waits until the number is connected, and says whether it is the trial's number.
// No key or secret is printed. The settings come from .env.local (scripts/trial-setup.js).
//
//   node scripts/trial-link.js [--number <digits>] [--webhook <url>] [--wait <minutes>] [--status]
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, config } = require('../server/config');

const EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'MESSAGES_EDITED', 'SEND_MESSAGE', 'CONNECTION_UPDATE'];
const QR_FILE = path.resolve(__dirname, '..', 'deploy', 'trial', 'qr.png');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function options(argv) {
  const out = { number: '', webhook: '', waitMinutes: 5, statusOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--status') out.statusOnly = true;
    else if (argv[i] === '--number' && /^\+?[\d\s-]{9,20}$/.test(argv[i + 1] || '')) out.number = argv[++i].replace(/[^\d]/g, '');
    else if (argv[i] === '--webhook' && /^https?:\/\//.test(argv[i + 1] || '')) out.webhook = argv[++i];
    else if (argv[i] === '--wait' && /^\d{1,2}$/.test(argv[i + 1] || '')) out.waitMinutes = Number(argv[++i]);
    else throw new Error('Usage: node scripts/trial-link.js [--number <digits>] [--webhook <url>] [--wait <minutes>] [--status]');
  }
  return out;
}

// fetcher, log and wait: for the tests.
async function link(argv = process.argv.slice(2), { env = (loadEnv(), process.env), fetcher = fetch, log = console.log, wait = sleep, qrFile = QR_FILE } = {}) {
  const o = options(argv);
  const c = config(env);
  if (!c.evolutionUrl || !c.evolutionKey || !c.instance || !c.webhookSecret) throw new Error('Evolution is not set in .env.local: run node scripts/trial-setup.js first.');
  const number = o.number || c.trialNumber;
  const base = c.evolutionUrl.replace(/\/$/, '');
  const api = async (method, route, body) => {
    const response = await fetcher(`${base}${route}`, { method, signal: AbortSignal.timeout(30000),
      headers: { apikey: c.evolutionKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { ok: response.ok, status: response.status, json };
  };
  const instancePath = encodeURIComponent(c.instance);
  const found = async () => {
    const list = await api('GET', `/instance/fetchInstances?instanceName=${instancePath}`);
    const items = list.ok ? [].concat(list.json || []).map((item) => (item && item.instance) || item).filter(Boolean) : [];
    return items.find((item) => [item.name, item.instanceName].includes(c.instance)) || null;
  };
  const stateOf = async () => { const r = await api('GET', `/instance/connectionState/${instancePath}`); return r.ok ? String((r.json && r.json.instance && r.json.instance.state) || (r.json && r.json.state) || 'unknown') : `HTTP ${r.status}`; };
  const ownerOf = (item) => String((item && (item.ownerJid || item.owner)) || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  const sameAsTrial = (owner) => (number ? (owner === number ? 'the trial number' : 'NOT the trial number') : 'no trial number set');

  let instance = await found();
  if (o.statusOnly) {
    const state = instance ? await stateOf() : 'no instance';
    log(`instance ${c.instance}: ${state}${instance && ownerOf(instance) ? `, linked to a number ending ${ownerOf(instance).slice(-4)} (${sameAsTrial(ownerOf(instance))})` : ''}`);
    return { state };
  }

  const webhook = { enabled: true, url: o.webhook || `http://host.docker.internal:${c.port}/webhooks/evolution`,
    headers: { Authorization: `Bearer ${c.webhookSecret}` }, byEvents: false, base64: false, events: EVENTS };
  if (!instance) {
    // Direct chats only, nothing marked as read for the client, no history imported.
    const created = await api('POST', '/instance/create', { instanceName: c.instance, integration: 'WHATSAPP-BAILEYS', qrcode: false,
      rejectCall: false, groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false, webhook });
    if (!created.ok) throw new Error(`Evolution refused to create the instance (HTTP ${created.status}).`);
    log(`instance ${c.instance}: created`);
  } else log(`instance ${c.instance}: already there`);
  const set = await api('POST', `/webhook/set/${instancePath}`, { webhook });
  if (!set.ok) throw new Error(`Evolution refused the webhook (HTTP ${set.status}).`);
  log(`webhook: ${webhook.url} (with the server's secret), events ${EVENTS.join(', ')}`);

  let state = await stateOf();
  let lastCode = '';
  const deadline = Date.now() + o.waitMinutes * 60000;
  while (state !== 'open' && Date.now() < deadline) {
    const asked = await api('GET', `/instance/connect/${instancePath}${number ? `?number=${number}` : ''}`);
    const data = asked.json || {};
    const image = typeof data.base64 === 'string' ? data.base64.replace(/^data:image\/\w+;base64,/, '') : '';
    const code = String(data.code || '');
    if (image && code !== lastCode) {
      fs.mkdirSync(path.dirname(qrFile), { recursive: true });
      fs.writeFileSync(qrFile, Buffer.from(image, 'base64'));
      log(`QR code written: ${path.relative(path.resolve(__dirname, '..'), qrFile).replaceAll('\\', '/')} (scan it from the test phone: WhatsApp > Linked devices > Link a device)`);
      if (data.pairingCode) log(`or the pairing code, typed on the phone (Link with phone number instead): ${data.pairingCode}`);
      lastCode = code;
    } else if (!image && !asked.ok) log(`waiting for a code (HTTP ${asked.status})`);
    await wait(5000);
    state = await stateOf();
  }
  if (state !== 'open') { log(`not connected yet (${state}). Run this again to get a new code.`); return { state }; }
  try { fs.rmSync(qrFile, { force: true }); } catch { /* the image is of no use once linked */ }
  instance = await found();
  const owner = ownerOf(instance);
  log(`connected${owner ? `: a number ending ${owner.slice(-4)} (${sameAsTrial(owner)})` : ''}`);
  return { state, owner };
}

if (require.main === module) link().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { link, options, EVENTS };
