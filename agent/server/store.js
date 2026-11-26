'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createState } = require('../ai/src/flow');
const { writeAtomic, readError } = require('./files');

const VERSION = 2;
// Delivery ids kept against a second delivery of the same event: the newest ones. A message
// already kept is also recognised by its id in its conversation, whatever its age.
const SEEN_KEEP = 1000;

// A conversation saved by the first version (state with "questions", no "case"): its messages,
// what the client stated, the request and the employee's ownership are kept; the assistant does
// not resume its old questions, and a conversation it was still screening goes to the staff.
function migrateState(old) {
  const s = createState();
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const k = old.known || {};
  Object.assign(s.known, { name: text(k.name), city: text(k.city), phone: text(k.phone), client_type: ['individual', 'company'].includes(k.client_type) ? k.client_type : null,
    service_description: text(k.need), stage: text(k.stage), other_party: text(k.other_party) });
  s.facts.dates = Array.isArray(old.facts?.dates) ? old.facts.dates : [];
  s.facts.amounts = Array.isArray(old.facts?.amounts) ? old.facts.amounts : [];
  s.status = ['waiting', 'with_staff', 'closed', 'done'].includes(old.status) ? old.status : 'waiting';
  s.closedOutcome = old.closedOutcome ?? null;
  s.everWithStaff = old.everWithStaff === true;
  s.firstReplyDone = true;
  s.sentCount = Number(old.sentCount) || 0;
  s.lang = { last: ['ar', 'en'].includes(old.lang?.last) ? old.lang.last : null };
  s.lastClientAt = old.lastClientAt ?? null;
  s.phase = 'done';
  s.handoff = old.handoff || (s.status === 'waiting' ? { reason: 'migrated', urgent: false, createdAt: 0, updates: 0 } : null);
  if (s.handoff && !s.reasons.includes('migrated')) s.reasons.push('migrated');
  return s;
}

// Missing fields of a newer state shape get their defaults, without touching what is there.
function withDefaults(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!Object.hasOwn(value, key)) value[key] = structuredClone(fallback);
    else if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) withDefaults(value[key], fallback);
  }
  return value;
}

const fingerprint = (text) => createHash('sha1').update(text).digest('base64');
// A conversation's file name: its id when that is a plain name (always, for ids the server
// makes), a hash of it otherwise.
const fileName = (id) => (/^[\w-]{1,128}$/.test(id) ? id : createHash('sha256').update(String(id)).digest('hex').slice(0, 40));

// The state lives in the data folder as a small core file (state.json: settings, alerts,
// connection...) and one file per conversation (conversations/<id>.json). A save writes only
// what changed: the conversation it is given, any other one changed since (touch, or a write
// that failed), and the core; so its cost does not grow with the number of conversations.
class Store {
  constructor(dir, seed) {
    this.dir = dir; this.file = path.join(dir, 'state.json'); this.auditFile = path.join(dir, 'audit.log');
    this.conversationsDir = path.join(dir, 'conversations');
    fs.mkdirSync(this.conversationsDir, { recursive: true });
    this.written = new Map(); // conversation id -> fingerprint of what its file holds
    this.dirty = new Set(); // changed in memory, not yet on disk
    this.removed = new Set(); // deleted in memory, its file still to remove
    this.loadCore(seed);
    this.data.alerts ||= [];
    this.data.seen ||= {};
    // The audit trail used to live inside the state file, trimmed to its last entries.
    // It is now an append-only file of its own; entries found in the state move there once.
    if (Array.isArray(this.data.audit) && this.data.audit.length && !fs.existsSync(this.auditFile)) {
      fs.writeFileSync(this.auditFile, this.data.audit.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    }
    this.data.audit = [];
    this.loadConversations();
    // Conversations of the first state shape are migrated once, and kept. The shape decides,
    // not the file's version number, so a state copied between versions is migrated too.
    for (const c of Object.values(this.data.conversations)) {
      if (c.state && !c.state.case) {
        c.state = migrateState(c.state);
        c.migratedFrom = 1; this.dirty.add(c.id);
        if (c.state.status === 'waiting') { c.paused = true; c.error = 'محادثة من النسخة السابقة؛ نُقلت للموظف دون إعادة الفرز.'; }
      }
    }
    this.data.version = VERSION;
    for (const c of Object.values(this.data.conversations)) {
      if (c.state) withDefaults(c.state, createState());
      // One unread counter shared by everyone became a count per conversation (inbox) read by
      // each employee on their own (readBy): what was unread stays unread for all.
      if (typeof c.unread === 'number') { c.inbox = c.unread; c.readBy = {}; delete c.unread; this.dirty.add(c.id); }
    }
    this.recover();
    this.save();
  }
  // The core state file; if it is damaged (a crash in the middle of a write on a disk that lost
  // it), the last copy kept beside it (state.json.bak, at most ten minutes old), and the admin
  // is told (loadedFrom). With none of them readable the server does not start.
  loadCore(seed) {
    this.loadedFrom = 'state';
    this.data = null;
    for (const [from, file] of [['state', this.file], ['backup', `${this.file}.bak`]]) {
      if (!fs.existsSync(file)) continue;
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); this.loadedFrom = from; break; }
      catch (error) { console.error(`${file} is not readable: ${readError(error)}`); }
    }
    if (!this.data && fs.existsSync(this.file)) throw new Error(`${this.file} and its backup are damaged; restore a backup (deploy/README.md) before starting.`);
    if (!this.data) { this.data = structuredClone(seed); this.loadedFrom = 'new'; }
  }
  // Every conversation file. A state of the earlier single-file shape keeps its conversations
  // inside the core: they move to their own files, never over a file that already exists (that
  // one is newer). A conversation file that cannot be read is moved aside (<id>.json.damaged),
  // the server starts, and the admin is told (damaged). Leftovers of an interrupted write
  // (.tmp) are removed: the file they were to replace is still whole.
  loadConversations() {
    const inside = this.data.conversations && typeof this.data.conversations === 'object' ? this.data.conversations : {};
    this.data.conversations = {};
    this.damaged = [];
    for (const name of fs.readdirSync(this.conversationsDir)) {
      const full = path.join(this.conversationsDir, name);
      if (name.endsWith('.tmp')) { fs.rmSync(full, { force: true }); continue; }
      if (!name.endsWith('.json')) continue;
      try {
        const text = fs.readFileSync(full, 'utf8'); const c = JSON.parse(text);
        if (!c || typeof c.id !== 'string' || !Array.isArray(c.messages)) throw new Error('not_a_conversation');
        this.data.conversations[c.id] = c; this.written.set(c.id, fingerprint(text));
      } catch (error) {
        console.error(`conversations/${name} is not readable: ${readError(error)}; moved aside as ${name}.damaged`);
        try { fs.renameSync(full, `${full}.damaged`); } catch {}
        this.damaged.push(name);
      }
    }
    this.moving = new Set();
    for (const c of Object.values(inside)) {
      if (!c?.id || this.data.conversations[c.id] || fs.existsSync(this.conversationFile(c.id)) || fs.existsSync(`${this.conversationFile(c.id)}.damaged`)) continue;
      this.data.conversations[c.id] = c; this.dirty.add(c.id); this.moving.add(c.id);
    }
  }
  // Never retry ambiguous sends after a crash: the provider may have accepted them. What this
  // stop interrupted (a reply being prepared or sent, messages waiting for one) goes to the
  // staff, with a request; an unconfirmed message of an earlier stop was dealt with then, and
  // never reopens a conversation again. An attachment this stop was downloading is not there:
  // a request too. `recovered` and `mediaLost` list them for the alerts (engine.afterRestart).
  recover() {
    this.recovered = []; this.mediaLost = [];
    const request = (c, reason) => {
      if (!c.state) return;
      c.state.handoff ||= { reason, urgent: false, createdAt: Math.max(0, (Date.now() - (c.createdAt || Date.now())) / 1000), updates: 0 };
      if (['done', 'closed'].includes(c.state.status)) c.state.status = 'waiting';
      if (c.state.status !== 'with_staff') { c.requestedAt ||= Date.now(); c.reminders = 0; }
    };
    for (const c of Object.values(this.data.conversations)) {
      let interrupted = Boolean(c.processing || c.pending?.length);
      for (const m of c.messages) {
        if (m.delivery === 'sending') { m.delivery = 'unknown'; interrupted = true; }
        if (m.media?.status === 'pending') {
          m.media.status = 'failed'; this.dirty.add(c.id);
          if (this.mediaLost.includes(c.id)) continue;
          this.mediaLost.push(c.id);
          c.error = 'انقطع تنزيل مرفق من العميل بإعادة تشغيل الخادم؛ راجعه من هاتف المكتب.';
          request(c, 'media_failed');
        }
      }
      if (!interrupted) continue;
      c.processing = false; c.pending = []; c.pendingSince = null; c.paused = true;
      c.error = 'انقطع التشغيل أثناء الرد؛ راجع المحادثة وواتساب قبل إعادة المساعد لتجنب تكرار رسالة.';
      if (c.state && c.state.status !== 'with_staff') {
        c.state.status = 'waiting';
        c.state.handoff ||= { reason: 'interrupted', urgent: false, createdAt: Math.max(0, (Date.now() - (c.createdAt || Date.now())) / 1000), updates: 0 };
        c.requestedAt ||= Date.now(); c.reminders = 0;
      }
      this.recovered.push(c.id); this.dirty.add(c.id);
    }
  }
  conversationFile(id) { return path.join(this.conversationsDir, `${fileName(id)}.json`); }
  // Writes what changed: the conversation `c` when given, every conversation changed and not
  // yet written (touch, or a write that failed), the deletions, and the core. A failed write
  // (a full or read-only disk) never throws: the state stays in memory, `saveError` says why,
  // and the engine stops answering until a write succeeds again (it is a requirement of
  // answering). onSaveError and onSaveRecovered are set by it.
  save(c = null) {
    if (c && typeof c.id === 'string' && this.data.conversations[c.id] === c) this.dirty.add(c.id);
    let ok = true;
    for (const id of [...this.dirty]) ok = this.writeConversation(id) && ok;
    for (const id of [...this.removed]) ok = this.removeFile(id) && ok;
    ok = this.writeCore() && ok;
    if (ok && this.saveError) { this.saveError = null; this.onSaveRecovered?.(); }
    return ok;
  }
  // A change kept in memory, written by the next save (a read marker, a burst of messages).
  touch(c) { if (c && this.data.conversations[c.id] === c) this.dirty.add(c.id); }
  // Writes what is waiting. Run by the engine's timer and at a stop.
  flush() { return this.save(); }
  // A conversation deleted for good (retention): its file goes with the next save.
  remove(id) {
    delete this.data.conversations[id];
    this.dirty.delete(id); this.written.delete(id); this.removed.add(id);
  }
  writeConversation(id) {
    const c = this.data.conversations[id];
    if (!c) { this.dirty.delete(id); return true; }
    const text = JSON.stringify(c); const print = fingerprint(text);
    if (this.written.get(id) === print) { this.dirty.delete(id); return true; }
    try { writeAtomic(this.conversationFile(id), text); } catch (error) { return this.failed(error); }
    this.written.set(id, print); this.dirty.delete(id);
    return true;
  }
  removeFile(id) {
    try { fs.rmSync(this.conversationFile(id), { force: true }); } catch (error) { return this.failed(error); }
    this.removed.delete(id);
    return true;
  }
  // The core is written when it changed. Every ten minutes the core being replaced is kept as
  // state.json.bak first.
  writeCore() {
    // An earlier single-file state is the only copy of its conversations until each one is in
    // its own file: it is not replaced before. (Its backup copy may keep them a while longer;
    // a file that exists is never overwritten from it, loadConversations.)
    if (this.moving.size && [...this.moving].some(id => this.dirty.has(id))) return false;
    this.moving.clear();
    const { conversations, ...core } = this.data;
    const text = JSON.stringify(core);
    if (text === this.coreText && this.file === this.coreFile) return true;
    try {
      if (Date.now() - (this.backedUpAt || 0) > 600000 && fs.existsSync(this.file)) {
        fs.copyFileSync(this.file, `${this.file}.bak`); this.backedUpAt = Date.now();
      }
      writeAtomic(this.file, text);
    } catch (error) { return this.failed(error); }
    this.coreText = text; this.coreFile = this.file;
    return true;
  }
  failed(error) {
    const first = !this.saveError;
    this.saveError = { at: Date.now(), message: String(error?.code || error?.message || error).slice(0, 120) };
    if (first) { console.error(`State not saved: ${this.saveError.message}`); this.onSaveError?.(this.saveError); }
    return false;
  }
  // One line per action, never trimmed and never rewritten. `save` writes the state too, with
  // the conversation acted on; reading a conversation does not.
  audit(actor, action, conversation = null, { save = true } = {}) {
    try {
      fs.appendFileSync(this.auditFile, JSON.stringify({ at: Date.now(), actor, action, conversation }) + '\n', { mode: 0o600 });
    } catch (error) { this.failed(error); }
    if (save) this.save(conversation ? this.data.conversations[conversation] : null);
  }
  // The newest entries first.
  auditTail(count = 100) {
    if (!fs.existsSync(this.auditFile)) return [];
    const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-count).reverse().map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  }
  // Delivery ids are kept for the newest events only.
  remember(key) {
    this.data.seen[key] = Date.now();
    const keys = Object.keys(this.data.seen);
    if (keys.length > SEEN_KEEP) for (const k of keys.slice(0, keys.length - SEEN_KEEP)) delete this.data.seen[k];
  }
}
function initialState(profile) {
  return { version: VERSION, settings: { enabled: false, activatedAt: Date.now(), firstActivatedAt: null, officeApproved: false,
    profile, excluded: [], existingClientsReviewed: false, repliesApproval: null }, conversations: {}, seen: {},
    reviews: [], recordings: [], audit: [], alerts: [], connection: { state: 'unconfigured', checkedAt: null } };
}
module.exports = { Store, initialState, migrateState, VERSION };
