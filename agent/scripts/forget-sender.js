'use strict';
// Deletes for good what the server keeps of one sender: the conversations kept under that
// WhatsApp address, their attachments, the alerts that point to them and the delivery ids
// remembered for the address. For a tester's conversations in a trial, or a client who asks for
// it. The server must be stopped first: it holds the conversations in memory and would write
// them back. Nothing of a conversation is printed, only how many were deleted, and one line of
// the audit trail records the deletion (without the address).
//
//   node scripts/forget-sender.js <address> [more addresses]
//   an address: a phone number with its country code (digits), or a WhatsApp address ending in
//   @s.whatsapp.net or @lid (a sender the provider named by a private id only).
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, config } = require('../server/config');
const { Store, initialState } = require('../server/store');

// The WhatsApp address of what was typed, or null.
function addressOf(value) {
  const text = String(value || '').trim();
  if (/^\d{5,24}@lid$/.test(text) || /^\d{7,16}@s\.whatsapp\.net$/.test(text)) return text;
  const digits = text.replace(/[\s+()-]/g, '');
  return /^\d{9,16}$/.test(digits) && !digits.startsWith('0') ? `${digits}@s.whatsapp.net` : null;
}

// Deletes the conversations of `addresses` from the store in `dir`. Returns the counts.
function forget(dir, addresses, seed) {
  const targets = new Set(addresses);
  const store = new Store(dir, seed);
  const found = Object.values(store.data.conversations).filter((c) => !c.demo && (targets.has(c.jid) || (c.lid && targets.has(c.lid))));
  let messages = 0, files = 0;
  for (const c of found) {
    messages += c.messages.length;
    for (const m of c.messages) {
      if (!m.media || !m.media.file) continue;
      fs.rmSync(path.join(store.dir, 'media', path.basename(m.media.file)), { force: true }); files += 1;
    }
    // The addresses this conversation was known by: their remembered delivery ids go too.
    for (const address of [c.jid, c.lid].filter(Boolean)) targets.add(address);
    store.remove(c.id);
  }
  const ids = new Set(found.map((c) => c.id));
  store.data.alerts = (store.data.alerts || []).filter((a) => !ids.has(a.conversation));
  for (const key of Object.keys(store.data.seen || {})) if (targets.has(key.slice(0, key.lastIndexOf(':')))) delete store.data.seen[key];
  if (found.length) store.audit('الصيانة', `forget_sender:${found.length}`, null, { save: false });
  const saved = store.save();
  return { conversations: found.length, messages, files, saved };
}

async function main(argv = process.argv.slice(2), { fetcher = fetch, log = console.log } = {}) {
  const addresses = argv.map(addressOf);
  if (!addresses.length || addresses.some((a) => !a)) throw new Error('Usage: node scripts/forget-sender.js <phone number with its country code | address ending @lid or @s.whatsapp.net> [more]');
  loadEnv();
  const c = config();
  // A running server would write the conversations back from its memory.
  const running = await fetcher(`http://127.0.0.1:${c.port}/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (running) throw new Error('The server is running: stop it first, then run this again, then start it.');
  const out = forget(c.dir, addresses, initialState(require('../config/office-profile.json')));
  log(`deleted: ${out.conversations} conversation(s), ${out.messages} message(s), ${out.files} file(s)${out.saved ? '' : ' — NOT SAVED: check the disk'}`);
  return out;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { addressOf, forget, main };
