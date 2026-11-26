'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createState, handle } = require('../ai/src/flow');
const { qualify } = require('../ai/src/qualify');
const { loadReplies } = require('../ai/src/replies');
const { checkSummaryQuotes } = require('../ai/src/summary-check');
const { normalizeText } = require('../ai/src/normalize');
const { buildRecord } = require('../ai/src/record');
const { checkPhrasing, humanize, questionsOf } = require('../ai/src/phrase-check');
const { checkAgentReply } = require('../ai/src/agent-guard');
const { agentInput, decisionFrom, applyDecision, renderRecord, fallbackDecision, mergeMemory, keepDecision, progressFor } = require('./agent');
// The attachments the model reads (section 1.7 of the office's file): at most this many a reply,
// each at most this large; the image types its gateway takes.
const AGENT_FILES = 3;
const AGENT_FILE_MB = { image: 5, pdf: 10 };
const AGENT_IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const { pickVersion } = require('../ai/src/language');
const { contentHash, findEvaluation } = require('./evaluation');
const { postAlert } = require('./alerts');
const { writeAtomic } = require('./files');
const rules = require('../config/qualification-rules.json');
const banned = require('../config/banned-phrases.json');
const triageConfig = require('../config/triage.json');
// The local preview's test data and the office's acceptance scenarios. Both are optional: a
// server deployed without the tests starts, and only the local preview lacks them.
const demoProfile = (() => { try { return require('../ai/tests/data/test-profile.json'); } catch { return null; } })();
const scenarios = (() => {
  const file = path.join(__dirname, '../ai/tests/data/office-scenarios.json');
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []; } catch { return []; }
})();
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'long' });
const GREGORIAN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
const HIJRI = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric' });

// Today as the model needs it to count days and months from what the client says.
function today(now = Date.now()) {
  return { gregorian: GREGORIAN.format(now), weekday: WEEKDAY.format(now), hijri: HIJRI.format(now) };
}

// Whether `now` is outside the office's working hours (profile.office_hours).
function outsideHours(profile, now = Date.now()) {
  const hours = profile && profile.office_hours;
  if (!hours) return false;
  const local = new Date(now + (hours.utc_offset_minutes || 0) * 60000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMinutes = (text) => { const [h, m] = String(text).split(':').map(Number); return h * 60 + (m || 0); };
  return !(hours.days.includes(local.getUTCDay()) && minutes >= toMinutes(hours.open) && minutes < toMinutes(hours.close));
}

// The working hours as the clients read them, made from the structured setting:
// «الأحد إلى الخميس، 8:30 ص – 5:30 م» / "Sunday to Thursday, 8:30 am – 5:30 pm".
const DAY_NAMES = { arabic: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  english: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
function formatHours(hours, version = 'arabic') {
  const names = DAY_NAMES[version];
  const days = [...new Set(hours.days)].sort((a, b) => a - b);
  const run = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText = run ? `${names[days[0]]} ${version === 'arabic' ? 'إلى' : 'to'} ${names[days.at(-1)]}`
    : days.map((d) => names[d]).join(version === 'arabic' ? '، و' : ', ');
  const time = (text) => {
    const [h, m] = String(text).split(':').map(Number);
    const hour = h % 12 || 12;
    const half = version === 'arabic' ? (h < 12 ? 'ص' : 'م') : (h < 12 ? 'am' : 'pm');
    return `${hour}:${String(m || 0).padStart(2, '0')} ${half}`;
  };
  return `${dayText}، ${time(hours.open)} – ${time(hours.close)}`.replace('، ', version === 'arabic' ? '، ' : ', ');
}

// Minutes of the office's working hours between two times. Without structured hours, every
// minute counts.
function workingMinutes(profile, from, to) {
  const hours = profile && profile.office_hours;
  if (!hours) return Math.max(0, to - from) / 60000;
  const DAY = 86400000;
  const offset = (hours.utc_offset_minutes || 0) * 60000;
  const at = (text) => { const [h, m] = String(text).split(':').map(Number); return (h * 60 + (m || 0)) * 60000; };
  let total = 0;
  for (let day = Math.floor((from + offset) / DAY) * DAY - offset; day < to; day += DAY) {
    if (!hours.days.includes(new Date(day + offset).getUTCDay())) continue;
    const start = Math.max(from, day + at(hours.open));
    const end = Math.min(to, day + at(hours.close));
    if (end > start) total += end - start;
  }
  return total / 60000;
}

const labels = { voice: 'رسالة صوتية', image: 'صورة واردة', document: 'مستند وارد', video: 'مقطع فيديو', unsupported: 'رسالة غير مدعومة', reaction: 'تفاعل' };
const PHONE_JID = /^\d{7,16}@s\.whatsapp\.net$/;
const LID_JID = /^\d{5,24}@lid$/;
const CLIENT_TYPES = ['text', 'voice', 'image', 'document'];
const PHONE = 'هاتف المكتب';
const HOUR = 3600000;
// A message from the office phone this soon after the client's is WhatsApp Business's automatic reply.
const AUTO_REPLY_MS = 3000;
// The longest client text kept (evolution.js cuts it there too).
const MAX_TEXT = 4000;
// Delivery ids kept against a second delivery of the same webhook: the newest ones. A message
// kept already is also recognised by its id in its conversation, whatever its age.
const SEEN_KEEP = 1000;
// The number's connection is asked of Evolution this often (and at start); a lost connection
// is an alert once it has lasted this long: WhatsApp reconnects by itself within seconds.
const CONNECTION_CHECK_MS = 3 * 60000;
const DISCONNECT_GRACE_MS = 60000;
// Proposed numbers the office has not set yet (office-brief questions 20 and 21).
const DEFAULTS = { late_message_minutes: 10, aggregation_max_seconds: 20, handoff_reminder_minutes: 15,
  handoff_escalation_minutes: 30, staff_idle_hours: 72, max_media_mb: 25,
  // The reply targets of spec criterion 10, from the client's last message.
  reply_target_seconds: 15, first_reply_target_seconds: 11,
  // One sender writing faster than this is held for the staff (one alert); above three times
  // it, the rest of that minute is counted, not kept: the office phone has every message.
  max_client_messages_per_minute: 20 };
// What an attachment is saved and served as. Anything else is kept as a plain download.
const MEDIA_TYPES = {
  'image/jpeg': ['jpg', true], 'image/png': ['png', true], 'image/webp': ['webp', true], 'image/gif': ['gif', true],
  'audio/ogg': ['ogg', true], 'audio/mpeg': ['mp3', true], 'audio/mp4': ['m4a', true], 'audio/webm': ['webm', true], 'audio/aac': ['aac', true],
  'application/pdf': ['pdf', false], 'video/mp4': ['mp4', false], 'video/3gpp': ['3gp', false], 'video/quicktime': ['mov', false],
};
const DELIVERY_RANK = { sending: 0, unknown: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };
const DELIVERY_OF = { PENDING: 'accepted', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed', FAILED: 'failed' };
// The requirements of answering, as the staff read them in a conversation's note.
const READY_NAMES = { mode: 'الوضع الحي', office: 'اعتماد بيانات المكتب', replies: 'اعتماد النصوص بنسختها الحالية',
  model: 'خدمة فهم الرسائل', evaluated: 'تقييم حي ناجح للنموذج والنصوص الحالية', evolution: 'ربط واتساب', webhook: 'استقبال الرسائل', existingClients: 'مراجعة الأرقام المستثناة',
  connected: 'اتصال الرقم', storage: 'حفظ البيانات على القرص' };
// A client message the assistant does not answer, in a conversation no employee holds: the
// reason its request gets (as the record names it), and what the staff read in it.
const UNANSWERED = {
  existing_client: ['follow_up', 'رقم مستثنى (عميل حالي)؛ لا يرد عليه المساعد. تابع رسالته من هنا أو من هاتف المكتب.'],
  paused: ['assistant_off', 'المساعد موقوف في هذه المحادثة؛ لم يُرد على رسالة العميل آليًا.'],
  assistant_off: ['assistant_off', 'المساعد متوقف؛ لم يُرد على رسالة العميل آليًا.'],
  assistant_unavailable: ['assistant_unavailable', null],
};
// Reasons the server gives a request that the record (ai/src/record.js) has no words for.
const REASON_LABELS = { flood: 'رسائل كثيرة متتابعة من العميل', unsupported_content: 'محتوى لا يقرؤه المساعد (موقع أو جهة اتصال أو غيرهما)' };
const FLOOD_NOTE = 'وصلت رسائل كثيرة متتابعة من هذا الرقم؛ أُوقف المساعد في المحادثة حتى يراجعها موظف.';

// An open request no employee has taken yet. A request can exist while the assistant is
// still asking its questions (status "intake"), so the status alone does not tell.
function needsStaff(c) {
  return c.state.status === 'waiting' || (c.state.status === 'intake' && Boolean(c.state.handoff));
}
// A failure as a short code for the log and the alert: never the client's text.
function errorCode(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (error instanceof SyntaxError) return 'invalid_json';
  return String(error?.message || 'error').replace(/[^\w.:-]/g, '_').slice(0, 60);
}
// The same for a call that failed on the network: the system's code says more ("ECONNREFUSED").
const failureCode = (error) => (error?.cause?.code ? String(error.cause.code).replace(/[^\w.:-]/g, '_').slice(0, 60) : errorCode(error));
// A send that certainly never reached WhatsApp: Evolution refused the connection or could not be
// found, or the request was refused before it was made.
const notReached = (error) => ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code || error?.code)
  || ['evolution_not_configured', 'invalid_evolution_url', 'unsupported_recipient', 'unsupported_evolution_format'].includes(error?.message);

// One priority rule: the triage marked the conversation urgent, or the request was created urgent.
function isUrgent(c) {
  return !['closed', 'done'].includes(c.state.status) && Boolean(c.state.handoff?.urgent || (needsStaff(c) && c.state.priority === 'urgent'));
}

// The flow has no input for content it cannot read (a location, a contact card...): it passes it
// to the staff as a message it could not understand ('model_failed'), and the request then gets
// its own reason, so that nobody looks for a failure of the model.
function relabel(before, state) {
  const from = 'model_failed'; const to = 'unsupported_content';
  const next = { ...state };
  if (!before.reasons.includes(from)) next.reasons = state.reasons.map(r => (r === from ? to : r));
  if (state.handoff && !before.handoff && state.handoff.reason === from) next.handoff = { ...state.handoff, reason: to };
  return next;
}

class Engine {
  constructor(store, config, provider, transport, transcriber = null) {
    Object.assign(this, { store, config, provider, transport, transcriber });
    this.replies = loadReplies(); this.timers = new Map(); this.running = new Map(); this.mediaJobs = new Map();
    // Client messages per conversation in the last minute, and when a phone reply that matched
    // no conversation was last alerted, by its private id. In memory: both are about now.
    this.rates = new Map(); this.unmatched = new Map();
    // The day's exchange rates (server/rates.js), when server/start.js reads them.
    this.fx = null;
    this.bannedPhrases = (banned.phrases || []).map(p => normalizeText(p).toLowerCase()).filter(Boolean);
    this.sleep = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
    // A state that cannot be written stops the answers (ready().storage) and is an alert.
    store.onSaveError = () => this.alert('storage_failed');
    store.onSaveRecovered = () => this.alert('storage_recovered');
  }
  // The local preview uses the office's own data once it is entered, the test data before.
  profile(c) {
    const office = this.store.data.settings.profile;
    return c.demo && !(office && office.office_name) && demoProfile ? demoProfile : office;
  }
  limit(c, key) { return this.profile(c).limits?.[key] ?? DEFAULTS[key]; }
  // The fingerprint of what the office approves (server/evaluation.js), as this process loaded
  // and uses it. The approval lapses when any part of it changes.
  contentHash() { return contentHash(this.replies); }
  // The measured evaluation through the API that covers this server's models, instructions and
  // texts (server/evaluation.js), and the office data the model reads: the services of the
  // settings, as the dashboard set them. Read again at most once a minute, and when the settings
  // change (a save replaces the profile).
  evaluation() {
    const now = Date.now(); const profile = this.store.data.settings.profile;
    if (!this.evaluationCache || now - this.evaluationCache.at > 60000 || this.evaluationCache.profile !== profile) {
      this.evaluationCache = { at: now, profile, value: findEvaluation(this.config, { replies: this.replies, profile }) };
    }
    return this.evaluationCache.value;
  }
  // Questions an approved rule needs, beyond the three default ones.
  // rates: the day's exchange rates (server/rates.js), or null; the pegged currencies need none.
  env(c) { return { replies: this.replies, profile: this.profile(c), triage: triageConfig, rates: this.fx ? this.fx.current() : null }; }
  // What the model is told about the conversation so far, besides the message itself.
  context(c) {
    // The automatic reply of the phone app is not the assistant's question.
    const lastBot = [...c.messages].reverse().find(m => m.role === 'assistant' || m.role === 'staff');
    const s = c.state;
    const known = Object.fromEntries(Object.entries({ ...s.case, ...s.known }).filter(([, v]) => v !== null && v !== false && v !== ''));
    return { last_bot_message: lastBot && lastBot.role === 'assistant' ? lastBot.text : null, known, services: this.profile(c).services || [], today: today() };
  }
  at(c) { return (Date.now() - c.createdAt) / 1000; }
  ready() {
    const s = this.store.data.settings; const c = this.config;
    return { office: Boolean(s.officeApproved && s.profile.office_name), replies: s.repliesApproval?.hash === this.contentHash(),
      model: Boolean(c.modelKey && c.model), evaluated: this.evaluation().ok === true,
      evolution: Boolean(c.evolutionUrl && c.evolutionKey && c.instance), webhook: Boolean(c.webhookSecret),
      existingClients: s.existingClientsReviewed === true, connected: this.store.data.connection.state === 'open',
      storage: !this.store.saveError };
  }
  // Whether the assistant answers clients now: switched on, live, and every requirement met.
  // `missing` names the requirements that are not met.
  status() {
    const s = this.store.data.settings;
    const missing = [...(this.config.mode === 'live' ? [] : ['mode']), ...Object.entries(this.ready()).filter(([, ok]) => !ok).map(([key]) => key)];
    // A trial on a test number (TRIAL_NUMBER; the project owner's decision of 16 November 2026):
    // while that number is the one linked, and nothing else is missing, the assistant answers
    // although no evaluation covers its model. `missing` still names the evaluation, and `trial`
    // says why it answers. Linked to any other number, or with the linked number unknown, the
    // evaluation is required as always.
    const trial = missing.length === 1 && missing[0] === 'evaluated' && this.trial();
    return { enabled: s.enabled === true, answering: s.enabled === true && (!missing.length || trial), missing, ...(trial ? { trial: true } : {}) };
  }
  // Whether the number linked now is the test number of the trial.
  trial() {
    const number = this.config.trialNumber;
    return Boolean(number) && this.store.data.connection.owner === number;
  }
  // The conversation is with a person, or kept out of the assistant's hands.
  held(c) {
    return Boolean(c.paused || this.isExcluded(c) || c.unresolved || c.state.status === 'with_staff');
  }
  // Kept from the assistant as an existing client: the number is on the office's list. Closing a
  // conversation as an existing client puts it there, and taking it off the list lifts it. A
  // local preview conversation has no number on the list: its own mark counts.
  isExcluded(c) {
    if (c.demo) return Boolean(c.excluded);
    const listed = this.excluded(c.jid);
    if (c.excluded && !listed) c.excluded = false;
    return listed;
  }
  // Whether a number is on the office's list of existing clients. The list can hold thousands:
  // it is looked up as a set, made again when the list changes.
  excluded(jid) {
    const list = this.store.data.settings.excluded || [];
    if (this.excludedFrom !== list || this.excludedSize !== list.length) Object.assign(this, { excludedSet: new Set(list), excludedFrom: list, excludedSize: list.length });
    return this.excludedSet.has(jid);
  }
  // status: the one computed for a whole round of the timer, when given.
  canReply(c, status = null) { return !this.held(c) && (c.demo || (status || this.status()).answering); }
  // Why a client message is not answered by the assistant, in a conversation no employee holds:
  // it then goes to the staff as a request, with an alert. Null when the assistant answers it,
  // or an employee has the conversation (it counts as unread for them). Demo ones stay quiet.
  unanswered(c, status = null) {
    if (c.demo || c.unresolved || c.state.status === 'with_staff') return null;
    if (this.isExcluded(c)) return 'existing_client';
    if (c.paused) return 'paused';
    if (this.store.data.settings.enabled !== true) return 'assistant_off';
    return (status || this.status()).answering ? null : 'assistant_unavailable';
  }
  // Such a message goes to the staff with the reason, and an alert: it never waits unseen.
  holdForStaff(c, why) {
    const [reason, note] = UNANSWERED[why] || [why, null];
    const missing = this.status().missing.map(k => READY_NAMES[k] || k).join('، ');
    c.error = note || `المساعد مفعّل لكنه لا يرد الآن (ينقص: ${missing})؛ لم يُرد على رسالة العميل آليًا.`;
    const had = needsStaff(c);
    this.requestStaff(c, reason);
    if (c.state.status !== 'waiting') { c.state.status = 'waiting'; c.reminders = 0; }
    c.requestedAt ||= Date.now(); c.pending = []; c.pendingSince = null;
    if (!had) this.alert(why, c.id);
  }
  // Records something the staff must see, and sends it to the alert channel if one is set.
  // The alert carries no client data: only its kind and the conversation's id.
  alert(kind, conversation = null) {
    const alerts = this.store.data.alerts ||= [];
    alerts.push({ id: randomUUID(), at: Date.now(), kind, conversation });
    this.store.data.alerts = alerts.slice(-200);
    if (this.config.alertWebhook && this.config.mode === 'live') this.sendAlert(kind, conversation).catch(() => {});
  }
  // Sends an alert to the channel and keeps whether it arrived (/health, the settings page): a
  // channel that refuses alerts (a wrong address, a payload it does not take) is logged and
  // reported, never silent. Also the admin's test (app.js).
  async sendAlert(kind, conversation = null) {
    if (!this.config.alertWebhook) return { ok: false, error: 'not_configured' };
    const result = await postAlert(this.config.alertWebhook, { kind, conversation, at: Date.now(), origin: this.config.origin });
    const channel = this.store.data.alertChannel ||= {};
    if (result.ok) Object.assign(channel, { okAt: Date.now(), error: null });
    else { Object.assign(channel, { failedAt: Date.now(), error: result.error }); console.error(`Alert not delivered (${kind}): ${result.error}`); }
    return result;
  }
  // Whether an alert of this kind (for this conversation, when given) was raised within `ms`.
  recentAlert(kind, ms, conversation = null) {
    const last = (this.store.data.alerts || []).findLast(a => a.kind === kind && (conversation === null || a.conversation === conversation));
    return Boolean(last && Date.now() - last.at <= ms);
  }
  // Makes sure the conversation has an open request for the staff.
  requestStaff(c, reason, urgent = false) {
    if (!c.state.handoff) c.state.handoff = { reason, urgent, createdAt: this.at(c), updates: 0 };
    else if (urgent) c.state.handoff.urgent = true;
    c.requestedAt ||= Date.now();
    // A request in an ended conversation is shown in the queue, never kept out of sight.
    if (['done', 'closed'].includes(c.state.status)) { c.state.status = 'waiting'; c.requestedAt = Date.now(); c.reminders = 0; }
    // The record the staff read says why.
    c.summary = this.summary(c);
  }
  incoming(event, { demo = false } = {}) {
    if (event.type === 'connection') { this.setConnection(String(event.state || 'unknown')); return null; }
    if (event.type === 'status') { this.delivery(event); return null; }
    if (event.type === 'revoke') return this.revoke(event, demo);
    // A sender first seen with both its LID and its phone number keeps that number when a
    // later event carries the LID only.
    if (LID_JID.test(event.jid)) {
      const known = Object.values(this.store.data.conversations).find(x => x.lid === event.jid && x.demo === demo && PHONE_JID.test(x.jid));
      if (known) event = { ...event, jid: known.jid, lid: event.jid };
    }
    const phone = PHONE_JID.test(event.jid);
    if (!event.id || (!phone && !LID_JID.test(event.jid)) || !Number.isFinite(event.at)) return null;
    // WhatsApp dates a message by its own clock: a time well ahead of ours means this server's
    // clock is behind (deploy/README.md, time synchronisation). The message is kept, and the
    // admin is told, once an hour.
    if (!demo && event.at > Date.now() + 60000 && !this.recentAlert('clock_skew', HOUR)) this.alert('clock_skew');
    // History from before the assistant was first switched on is not imported.
    if (!demo && event.at < this.store.data.settings.activatedAt) return null;
    const key = `${event.jid}:${event.id}`;
    if (Object.hasOwn(this.store.data.seen, key)) return null;
    this.store.data.seen[key] = Date.now();
    const oldKeys = Object.keys(this.store.data.seen);
    if (oldKeys.length > SEEN_KEEP) for (const k of oldKeys.slice(0, oldKeys.length - SEEN_KEEP)) delete this.store.data.seen[k];
    let c = Object.values(this.store.data.conversations).find(x => x.jid === event.jid && x.demo === demo);
    // The same message delivered again, after its delivery id was forgotten.
    if (c?.messages.some(m => m.id === event.id)) return null;
    if (!c) {
      // The office wrote first from its phone: the conversation is kept, the staff's from its
      // first message (the takeover below), so the client's answer is not the assistant's.
      if (event.fromMe && (!phone || event.type === 'reaction')) {
        // A reply from the office phone to a sender known by a private id that no conversation
        // has: it cannot be matched. The admin is told, since the assistant may be answering
        // the same client under the client's number.
        if (!phone && event.type !== 'reaction' && !demo) this.unmatchedPhoneReply(event.jid);
        this.store.save(); return null;
      }
      c = { id: randomUUID(), jid: event.jid, lid: event.lid || null, demo, name: event.fromMe ? event.jid.split('@')[0] : event.name || event.jid.split('@')[0],
        createdAt: Date.now(), updatedAt: Date.now(), state: createState(), messages: [], pending: [],
        processing: false, revision: 0, paused: false, assigned: null, excluded: false, error: null,
        classification: { classification: 'needs_review', reasons: ['معايير التأهيل غير مهيأة'] }, sentAt: [], summary: '', inbox: 0, readBy: {} };
      this.store.data.conversations[c.id] = c;
    }
    c.updatedAt = Date.now();
    if (event.lid && !c.lid) c.lid = event.lid;
    // A reaction from the office phone is not a reply: nothing changes.
    if (event.fromMe && event.type === 'reaction') { this.store.save(c); return c; }
    return event.fromMe ? this.fromPhone(c, event) : this.fromClient(c, event, { demo, phone });
  }
  // A message from the office's own number.
  fromPhone(c, event) {
    // Our own message comes back with its id. The text is compared only for a message whose
    // id the provider has not returned yet: a known, different id is a person's message.
    const own = c.messages.find(m => m.role !== 'client' && (m.providerId === event.id ||
      (!m.providerId && ['sending', 'unknown'].includes(m.delivery) && m.text === event.text && Date.now() - m.at < 60000)));
    if (own) { own.providerId = event.id; if ((DELIVERY_RANK[own.delivery] ?? 0) < DELIVERY_RANK.sent) own.delivery = 'sent'; this.store.save(c); return c; }
    // Within three seconds of the client's message no person answered: it is the automatic
    // reply of WhatsApp Business (plan, component 7; spec criterion 44). It is kept and shown,
    // the assistant goes on, and the admin is told to switch the automatic reply off.
    const lastClient = c.messages.findLast(m => m.role === 'client');
    if (lastClient && event.at >= lastClient.at && event.at - lastClient.at <= AUTO_REPLY_MS) {
      c.messages.push({ id: event.id, role: 'auto', text: event.text || labels[event.type], at: event.at, delivery: 'sent' });
      if (!this.recentAlert('phone_auto_reply', HOUR)) this.alert('phone_auto_reply', c.id);
      this.store.save(c); return c;
    }
    this.takeover(c.id, PHONE);
    c.messages.push({ id: event.id, role: 'staff', text: event.text || labels[event.type], at: event.at, delivery: 'sent', staff: PHONE });
    this.store.save(c); return c;
  }
  // A message from the client.
  fromClient(c, event, { demo, phone }) {
    const perMinute = this.limit(c, 'max_client_messages_per_minute');
    const rate = demo ? 0 : this.rate(c);
    // A burst far above the limit: the rest of the minute is counted, not kept, so that one
    // sender cannot fill the disk; the office phone has every message, and the staff are told.
    if (rate > perMinute * 3) {
      c.flood = { at: c.flood?.at || Date.now(), dropped: (c.flood?.dropped || 0) + 1 };
      c.error = `${FLOOD_NOTE} لم تُحفظ ${c.flood.dropped} من رسائله المتتابعة؛ راجعها من هاتف المكتب.`;
      this.later(c); return c;
    }
    // A message that arrives late (after a disconnection) is kept for the staff and never answered.
    const late = !demo && Date.now() - event.at > this.limit(c, 'late_message_minutes') * 60000;
    const text = String(event.text || '');
    const message = { id: event.id, role: 'client', text: text.slice(0, MAX_TEXT) || labels[event.type] || labels.unsupported, at: event.at, type: event.type,
      ...(event.edited ? { edited: true } : {}), ...(event.truncated || text.length > MAX_TEXT ? { truncated: true } : {}) };
    if (late) message.late = true;
    if (event.media) message.media = { ...event.media, status: demo ? 'demo' : 'pending' };
    c.messages.push(message);
    if (rate > perMinute && !c.flood) this.holdFlood(c);
    // A trial on the test number answers a sender known only by WhatsApp's private id: nobody
    // who writes to the test number is an existing client to keep from the assistant, and the
    // provider addresses the reply by that id. A conversation held earlier for want of a number,
    // which no employee took, starts afresh.
    const knownEnough = phone || this.trial();
    if (!phone && knownEnough && c.unresolved) {
      c.unresolved = false; c.error = null;
      if (c.state.handoff?.reason === 'unresolved_sender' && c.state.status !== 'with_staff') { c.state = createState(); c.requestedAt = null; c.reminders = 0; }
    }
    if (event.type === 'reaction') {
      // A reaction or a sticker is kept for the staff to see; it is never answered nor a request.
    } else if (!knownEnough) {
      // No phone number came with the event: the assistant cannot answer this sender.
      const had = needsStaff(c);
      c.unresolved = true; c.error = 'تعذر تحديد رقم المرسل؛ راجع المحادثة من هاتف المكتب.';
      this.requestStaff(c, 'unresolved_sender');
      if (!had && !demo) this.alert('unresolved_sender', c.id);
    } else if (late) {
      // It waits for a person even when the conversation was closed: never answered by the
      // assistant, never hidden from the queue. One alert for the request, not one a message.
      const had = needsStaff(c);
      c.error = 'وصلت رسالة متأخرة بعد انقطاع؛ لم يُرد عليها آليًا.';
      this.requestStaff(c, 'late_message');
      if (!had && !demo) this.alert('request', c.id);
    } else if (this.canReply(c)) {
      c.pending.push({ ...event, text: text.slice(0, MAX_TEXT), receivedAt: Date.now(), fixtureFlags: demo ? event.fixtureFlags : undefined });
      c.pendingSince ||= Date.now();
    } else {
      const why = this.unanswered(c);
      if (why) this.holdForStaff(c, why);
    }
    // A message that came while the conversation is with the staff (held by an employee, or a
    // request) is counted; each employee's reading is kept on its own (unread, markRead).
    if (this.held(c) || needsStaff(c)) c.inbox = (c.inbox || 0) + 1;
    // During a burst the file is written by the next save, not once a message.
    if (c.flood && rate > perMinute) this.later(c); else this.store.save(c);
    if (message.media && !demo) this.fetchMedia(c, message);
    if (!demo && c.pending.length) this.schedule(c);
    return c;
  }
  // Client messages of this conversation in the last minute, this one included.
  rate(c, now = Date.now()) {
    const times = (this.rates.get(c.id) || []).filter(t => now - t < 60000);
    times.push(now);
    this.rates.delete(c.id); this.rates.set(c.id, times);
    if (this.rates.size > 5000) this.rates.delete(this.rates.keys().next().value);
    return times.length;
  }
  // Too many messages a minute from one sender: the conversation is held for the staff (the
  // assistant does not answer each one), with one alert. Restarting the assistant in it from
  // the page ends that (action 'reactivate').
  holdFlood(c) {
    c.flood = { at: Date.now(), dropped: 0 };
    c.paused = true; c.revision++; c.pending = []; c.pendingSince = null;
    clearTimeout(this.timers.get(c.id)); this.timers.delete(c.id);
    c.error = FLOOD_NOTE;
    this.requestStaff(c, 'flood');
    this.alert('flood', c.id);
  }
  // A phone reply under a private id no conversation has: logged (without the id) and alerted,
  // at most once an hour for the same id.
  unmatchedPhoneReply(lid) {
    const now = Date.now();
    if (now - (this.unmatched.get(lid) || 0) < HOUR) return;
    this.unmatched.set(lid, now);
    if (this.unmatched.size > 1000) this.unmatched.delete(this.unmatched.keys().next().value);
    console.error('A reply from the office phone came under a private id that matches no conversation.');
    this.alert('unmatched_phone_reply');
  }
  // The client deleted a message: it is marked for the staff, and nothing is answered.
  revoke(event, demo) {
    const owner = Object.values(this.store.data.conversations).find(x => (x.jid === event.jid || x.lid === event.jid) && x.demo === demo);
    const m = owner?.messages.find(x => x.id === event.target && x.role === 'client');
    if (m && !m.deleted) { m.deleted = true; this.store.save(owner); }
    return owner || null;
  }
  // A change kept in memory and written by the next save (server/store.js, touch).
  later(c) { if (this.store.touch) this.store.touch(c); else this.store.save(c); }
  // The provider's later report on a message it accepted. A failure is shown; nothing is resent.
  delivery(event) {
    const next = DELIVERY_OF[String(event.status || '').toUpperCase()];
    if (!event.id || !next) return;
    const matched = Object.values(this.store.data.conversations).some(c => c.messages.some(x => x.role !== 'client' && x.providerId === event.id));
    if (!matched) {
      // The report came before the provider answered our send: kept until the id is known.
      this.earlyDelivery ||= new Map();
      this.earlyDelivery.set(event.id, event);
      if (this.earlyDelivery.size > 500) this.earlyDelivery.delete(this.earlyDelivery.keys().next().value);
      return;
    }
    for (const c of Object.values(this.store.data.conversations)) {
      const m = c.messages.find(x => x.role !== 'client' && x.providerId === event.id);
      if (!m) continue;
      if (next === 'failed') {
        if (m.delivery === 'failed') return;
        m.delivery = 'failed'; c.error = 'لم تصل رسالة إلى العميل؛ راجع المحادثة. لا تُعاد الرسالة تلقائيًا.';
        c.paused = true; c.revision++; c.pending = []; this.requestStaff(c, 'delivery_failed', true); this.alert('delivery_failed', c.id);
      } else if ((DELIVERY_RANK[next] ?? 0) > (DELIVERY_RANK[m.delivery] ?? 0) && m.delivery !== 'failed') m.delivery = next;
      this.store.save(c); return;
    }
  }
  // Fetches an attachment through the connector and keeps it for the staff. The file is
  // identified by the message id only; a link the client sends is never fetched.
  // A file larger than max_media_mb is not downloaded: by the size the sender's app declared
  // first, and the download itself stops at that size when none was declared.
  fetchMedia(c, m) {
    const maxBytes = this.limit(c, 'max_media_mb') * 1024 * 1024;
    const job = (async () => {
      try {
        if (m.media.size > maxBytes) throw new Error('media_size');
        const result = await this.transport.media(m.id, { maxBytes });
        const data = Buffer.from(String(result.base64 || ''), 'base64');
        if (!data.length || data.length > maxBytes) throw new Error('media_size');
        const mimetype = String(result.mimetype || m.media.mimetype || '').split(';')[0].trim().toLowerCase();
        const [ext, inline] = MEDIA_TYPES[mimetype] || ['bin', false];
        const dir = path.join(this.store.dir, 'media'); fs.mkdirSync(dir, { recursive: true });
        const file = `${randomUUID()}.${ext}`;
        writeAtomic(path.join(dir, file), data);
        m.media = { ...m.media, status: 'stored', file, size: data.length, inline, contentType: MEDIA_TYPES[mimetype] ? mimetype : 'application/octet-stream' };
        return path.join(dir, file);
      } catch (error) {
        const tooLarge = error?.message === 'media_size';
        m.media.status = tooLarge ? 'too_large' : 'failed';
        c.error = tooLarge ? `مرفق من العميل أكبر من ${this.limit(c, 'max_media_mb')} ميجابايت فلم يُنزَّل؛ راجعه من هاتف المكتب.` : 'تعذر تنزيل مرفق من العميل؛ راجعه من هاتف المكتب.';
        this.requestStaff(c, 'media_failed');
        this.alert('media_failed', c.id);
        return null;
      } finally { this.mediaJobs.delete(m.id); this.store.save(c); }
    })();
    this.mediaJobs.set(m.id, job); return job;
  }
  schedule(c) {
    clearTimeout(this.timers.get(c.id));
    const seconds = this.profile(c).limits?.[c.state.firstReplyDone ? 'aggregation_seconds' : 'aggregation_first_seconds'] ?? 3;
    // A client who keeps typing cannot push the reply back forever.
    const latest = (c.pendingSince || Date.now()) + this.limit(c, 'aggregation_max_seconds') * 1000;
    const delay = Math.max(0, Math.min(seconds * 1000, latest - Date.now()));
    this.timers.set(c.id, setTimeout(() => { this.timers.delete(c.id); this.flush(c.id).catch(() => this.fail(c, 'تعذرت معالجة الرسالة.')); }, delay));
  }
  // The assistant stops in this conversation and the staff get it, with an alert of `kind`.
  fail(c, message, kind = 'processing_failed') {
    c.error = message; c.processing = false; c.pending = []; c.paused = true;
    if (c.state.status !== 'with_staff') c.state.status = 'waiting';
    this.requestStaff(c, 'processing_failed', true);
    if (!c.demo) this.alert(kind, c.id);
    this.store.save(c);
  }
  async flush(id) {
    if (this.running.has(id)) return this.running.get(id);
    const job = this.process(id).finally(() => {
      this.running.delete(id);
      const c = this.store.data.conversations[id];
      if (c?.pending.length && this.canReply(c)) this.schedule(c);
    });
    this.running.set(id, job); return job;
  }
  // Text of a voice message, when a transcription service is configured. Null when there is
  // none, the attachment is not there, or the service failed (logged by its code; an alert at
  // most once an hour).
  async transcribe(c, event) {
    if (!this.transcriber) return null;
    const m = c.messages.find(x => x.id === event.id);
    try {
      const file = m?.media?.status === 'stored' ? path.join(this.store.dir, 'media', m.media.file) : await this.mediaJobs.get(event.id);
      if (!file) return null;
      const result = await this.transcriber.transcribe(file, m.media.contentType);
      m.transcript = String(result.text || '').slice(0, 20000);
      return { text: m.transcript, unclear: result.unclear === true || !m.transcript.trim() };
    } catch (error) {
      console.error(`Transcription failed: ${failureCode(error)}`);
      if (!this.recentAlert('transcription_failed', HOUR)) this.alert('transcription_failed');
      return null;
    }
  }
  // What the flow did to the conversation's request. A new request is an alert, an urgent one
  // as such; so is a request that became urgent later (a hearing tomorrow, a detained person
  // mentioned after a booking). A request the flow withdrew (an urgent one opened before the
  // prison's place was known) takes its waiting time and reminders with it, so that a later
  // request starts its own. Demo conversations stay quiet.
  afterFlow(c, before, events = []) {
    if (c.state.handoff) {
      c.requestedAt ||= Date.now();
      if (c.demo) return;
      if (!before.handoff) this.alert(c.state.handoff.urgent ? 'request_urgent' : 'request', c.id);
      else if (events.some(e => e.type === 'handoff_urgent')) this.alert('request_urgent', c.id);
    } else if (before.handoff) { c.requestedAt = null; c.reminders = 0; }
  }
  // The assistant stopped while it worked on a client message (a requirement lapsed, it was
  // switched off, the number was added to the existing clients): the message is the staff's.
  // A conversation the engine paused itself (fail) has its request already.
  handBack(c) {
    const why = this.unanswered(c);
    if (why && why !== 'paused') this.holdForStaff(c, why);
  }
  async process(id) {
    const c = this.store.data.conversations[id];
    if (!c || !c.pending.length) return;
    // A requirement lapsed while the messages waited: they go to the staff.
    if (!this.canReply(c)) { this.handBack(c); c.pending = []; c.pendingSince = null; this.store.save(c); return; }
    // Aggregate consecutive text messages; attachments retain their own order.
    let batch = [c.pending.shift()];
    while (batch[0].type === 'text' && c.pending[0]?.type === 'text') batch.push(c.pending.shift());
    if (!c.pending.length) c.pendingSince = null;
    // The age is checked again here: a message can grow old while it waits in the queue.
    if (!c.demo) {
      const lateMs = this.limit(c, 'late_message_minutes') * 60000;
      const old = batch.filter(e => Date.now() - e.at > lateMs);
      if (old.length) {
        for (const e of old) { const m = c.messages.find(x => x.id === e.id); if (m) m.late = true; }
        c.error = 'وصلت رسالة متأخرة بعد انقطاع؛ لم يُرد عليها آليًا.'; this.requestStaff(c, 'late_message');
        batch = batch.filter(e => !old.includes(e)); this.store.save(c);
        if (!batch.length) return;
      }
    }
    const first = batch[0]; let text = batch.map(x => x.text).join('\n'); const revision = c.revision;
    c.processing = true; c.error = null; this.store.save(c);
    // The time budget (spec criterion 10): the reply is due this long after the client's last
    // message reached us, the first one sooner. "Typing..." shows from now on, so the time the
    // model takes to read and write is part of the typing pause, not added to it.
    const receivedAt = Math.max(...batch.map(e => e.receivedAt || Date.now()));
    const deadline = receivedAt + this.limit(c, c.state.firstReplyDone ? 'reply_target_seconds' : 'first_reply_target_seconds') * 1000;
    let typingSince = Date.now();
    // Not for a conversation the team already has: its messages are often noted without a reply,
    // and a client who saw «يكتب…» and then nothing asked why (the office owner's test of 16
    // November 2026). A reply that does go out shows its own typing pause when it is sent.
    if (!c.demo && !c.state.handoff) this.transport.presence?.(c.jid, this.config.modelTimeout || 6000)?.catch(() => {});
    // Whether the message arrived outside working hours: when it arrived, not when it is processed.
    const outOfHours = c.demo && typeof first.outOfHours === 'boolean' ? first.outOfHours : outsideHours(this.profile(c), first.at);
    // The model runs the conversation (CONVERSATION=agent, server/agent.js).
    if (this.agentMode(c)) return this.converse(c, batch, { revision, receivedAt, outOfHours, typingSince });
    // A video is shown to the staff like a document; the flow knows it as one.
    let input = { type: first.type === 'video' ? 'document' : first.type, at: this.at(c), outOfHours };
    let unsupported = false;
    const understand = async (message, isVoice) => {
      let result;
      const ask = () => this.provider.understand({ message, is_voice: isVoice, ...this.context(c),
        ...(c.demo ? { fixtureFlags: first.fixtureFlags } : {}) });
      try {
        result = await ask();
      } catch (error) {
        // Not a refusal that a second request would only repeat (a wrong key, no credit).
        const transient = error?.name === 'TimeoutError' || error?.name === 'AbortError' || !/^model_http_4(?!08|29)\d\d$|^model_not_configured$/.test(String(error?.message || ''));
        if (c.demo || !transient) { if (!c.demo) this.modelTrouble('understand', error, c); throw error; }
        console.error(`Model understand failed once, asked again: ${errorCode(error)}`);
        // Asked once more before the client is passed to the staff: a slow or failed answer is
        // most often gone on the second request, and to the client a referral for it is the
        // assistant taking the easy way out (the owner's test of 16 November 2026, where one
        // timeout ended the conversation). «يكتب…» stays on meanwhile.
        this.transport.presence?.(c.jid, this.config.modelTimeout || 6000)?.catch(() => {});
        try { result = await ask(); } catch (again) { this.modelTrouble('understand', again, c); throw again; }
      }
      if (!c.demo) { this.modelTrouble('understand', null, c); this.modelUsedAt = Date.now(); }
      c.lastModel = { model: result.model, ms: result.ms };
      return result.flags;
    };
    try {
      if (first.type === 'text') {
        // The reading of his reply to the questions he was asked runs beside the understanding.
        const reading = this.readTurn(c, text, batch);
        input.flags = await understand(text, false); input.text = text;
        input.turn = await reading;
        // Written before the assistant's last reply was sent: he had not read it yet.
        const lastReply = [...c.messages].reverse().find((m) => m.role === 'assistant');
        if (lastReply && batch.every((e) => e.at < lastReply.at)) input.crossed = true;
      }
      else if (['image', 'document', 'video'].includes(first.type) && String(first.text || '').trim()) {
        // The caption is the client's own words; the file itself is not read here.
        text = String(first.text); input.flags = await understand(text, false); input.text = text; input.attachment = first.type; input.type = 'text';
      }
      else if (first.type === 'voice' && c.demo && first.fixtureFlags) {
        input.flags = await understand(text, true); input.audioUnclear = first.audioUnclear === true; input.text = text || undefined;
      } else if (first.type === 'voice') {
        // Heard: read like a written message. Not heard (no transcription service, a failed
        // call, nothing clear in it): an unclear voice note, for which the flow asks a short
        // written summary, then passes the client to the staff if it happens again
        // (knowledge base 1.9). The staff keep the recording either way.
        const heard = await this.transcribe(c, first);
        if (heard && !heard.unclear) {
          // A voice note that was heard is read like a written reply, its reading included.
          text = heard.text; input.text = text; input.audioUnclear = false;
          const reading = this.readTurn(c, text, batch);
          input.flags = await understand(text, true);
          input.turn = await reading;
        }
        else { input.audioUnclear = true; input.flags = {}; }
      } else if (first.type === 'unsupported') unsupported = true;
    } catch {
      input = { type: 'model_failed', at: input.at, outOfHours: input.outOfHours, language: first.type === 'text' ? (/[؀-ۿ]/.test(text) ? 'ar' : /[a-z]/i.test(text) ? 'en' : null) : c.state.lang.last };
      c.error = first.type === 'text' ? 'تعذّر فهم الرسالة آليًا؛ أُحيلت للموظف.'
        : first.type === 'voice' ? 'رسالة صوتية لم تُفهم آليًا؛ استمع إليها من اللوحة.' : 'تعذّر فهم تعليق المرفق آليًا؛ راجعه في المحادثة.';
    }
    if (unsupported) {
      input = { type: 'model_failed', at: input.at, outOfHours: input.outOfHours, language: c.state.lang.last };
      c.error = 'محتوى لا يقرؤه المساعد (موقع أو جهة اتصال أو غيرهما)؛ أُحيل للموظف. راجعه في المحادثة أو من هاتف المكتب.';
    }
    c.processing = false;
    if (revision !== c.revision || !this.canReply(c)) {
      if (revision === c.revision) this.handBack(c);
      this.store.save(c); return;
    }
    const before = c.state;
    const out = handle(c.state, input, this.env(c));
    c.state = unsupported ? relabel(before, out.state) : out.state;
    this.afterFlow(c, before, out.events);
    c.classification = qualify(c.state.known, rules);
    if (c.state.known.name) c.name = c.state.known.name;
    c.summary = this.summary(c);
    this.store.save(c); // Handoff is durable before any transfer claim is sent.
    for (const message of out.messages) {
      if (revision !== c.revision || !this.canReply(c)) break;
      c.sentAt = c.sentAt.filter(at => Date.now() - at < 60000);
      if (!c.demo && c.sentAt.length >= (this.profile(c).limits?.max_bot_messages_per_minute || 6)) { this.fail(c, 'توقف الرد الآلي عند حد الرسائل؛ يُراجع الموظف المحادثة.'); break; }
      // The approved reply, written for this client by the model when it passes the checks and
      // fits the time budget. The client sees "typing..." while it is written. A model that
      // just failed is not asked.
      const written = input.type === 'model_failed' ? null : await this.phrase(c, message, deadline);
      if (revision !== c.revision || !this.canReply(c)) break;
      const text = written && written.text ? written.text : message.text;
      // The final text, placeholders filled, must still be free of every banned phrase.
      const plain = normalizeText(text).toLowerCase();
      if (this.bannedPhrases.some(p => plain.includes(p))) { this.fail(c, 'أُوقف رد آلي لاحتوائه عبارة غير معتمدة؛ يُراجع الموظف المحادثة.'); break; }
      if (!c.demo) {
        // The typing pause is kept here, not handed to the provider, so that a takeover or a
        // stop during it still cancels the reply. The time "typing..." has already shown counts.
        const ms = Math.max(0, this.typingMs(c, text, 'assistant') - (Date.now() - typingSince));
        if (ms) { this.transport.presence?.(c.jid, ms)?.catch(() => {}); await this.sleep(ms); }
        if (revision !== c.revision || !this.canReply(c)) break;
      }
      const record = { ...(written ? { draft: message.text, phrasing: written.text ? 'model' : 'approved', ...(written.problems.length ? { phrasingProblems: written.problems } : {}), ...(written.reason ? { phrasingReason: written.reason } : {}) } : {}),
        ...(c.demo ? {} : { latencyMs: Date.now() - receivedAt }) };
      if (!await this.send(c, text, 'assistant', null, record)) break;
      c.sentAt.push(Date.now()); this.later(c);
      typingSince = Date.now();
    }
    // Stopped by a lapsed requirement before every reply went out: the rest is the staff's.
    if (revision === c.revision && !this.canReply(c)) { this.handBack(c); this.store.save(c); }
  }
  // The images and PDF documents among the client's new messages, read and encoded for the model:
  // { id, kind: 'image' | 'pdf', type, data } (base64). One still downloading is waited for. A video,
  // another type, a file too large, or one that could not be downloaded is not sent: the model then
  // sees only that it came, and its caption.
  async agentFiles(c, batch) {
    const out = [];
    for (const e of batch) {
      if (out.length >= AGENT_FILES || !['image', 'document'].includes(e.type)) continue;
      const m = c.messages.find((x) => x.id === e.id);
      if (!m || !m.media) continue;
      let file = m.media.status === 'stored' && m.media.file ? path.join(this.store.dir, 'media', path.basename(m.media.file)) : null;
      if (!file && this.mediaJobs.has(e.id)) file = await this.mediaJobs.get(e.id).catch(() => null);
      if (!file) continue;
      const type = String(m.media.contentType || m.media.mimetype || '').split(';')[0].trim().toLowerCase();
      const kind = type === 'application/pdf' ? 'pdf' : AGENT_IMAGE.test(type) ? 'image' : null;
      if (!kind) continue;
      let data;
      try { data = await fs.promises.readFile(file); } catch { continue; }
      if (!data.length || data.length > AGENT_FILE_MB[kind] * 1024 * 1024) continue;
      out.push({ id: e.id, kind, type, data: data.toString('base64') });
    }
    return out;
  }
  // Whether the model runs this conversation: set so (CONVERSATION=agent) with a provider that can.
  // The local preview's conversations replay the code's scenarios.
  agentMode(c) { return this.config.conversation === 'agent' && !c.demo && typeof this.provider.converse === 'function'; }
  // The client's new messages answered by the model (server/agent.js; the project owner's decision
  // of 18 November 2026). Its answer is checked (ai/src/agent-guard.js) and asked for again once
  // with the reasons when it fails, or when the request fails for a passing reason; after a second
  // failure a safe reply goes out and the staff get the conversation. The decision changes the
  // conversation's state, opens the staff's request with its alert, and the reply goes out after
  // its typing pause, unless an employee took the conversation meanwhile.
  async converse(c, batch, { revision, receivedAt, outOfHours, typingSince }) {
    // A voice note is heard first: its text is what the model reads. An image or a PDF the client
    // just sent goes with the request, for the model to read its triage facts (section 1.7).
    for (const e of batch) if (e.type === 'voice') await this.transcribe(c, e);
    const files = await this.agentFiles(c, batch);
    const attached = new Set(files.map((f) => f.id));
    const newIds = new Set(batch.map((e) => e.id));
    const said = c.messages.filter((m) => m.role === 'client').map((m) => m.transcript || m.text).filter(Boolean);
    const timeoutMs = this.config.agentTimeout || 20000;
    let decision = null; let problems = []; let refusals = 0;
    // The memory before these messages, and after the answer that is kept (server/agent.js).
    const sheetBefore = c.agentMemory || {};
    let sheet = sheetBefore;
    for (let attempt = 0; attempt < 2 && !decision; attempt += 1) {
      if (revision !== c.revision || !this.canReply(c)) break;
      const input = agentInput(c, { newIds, attached, outOfHours, today: today(), problems });
      try {
        const result = await this.provider.converse(input, { timeoutMs, files });
        this.modelTrouble('converse', null, c); this.modelUsedAt = Date.now();
        c.lastModel = { model: result.model, ms: result.ms };
        const merged = mergeMemory(sheetBefore, result.output.memory);
        const check = checkAgentReply(result.output, { said, previous: c.messages.filter((m) => m.role === 'assistant').map((m) => m.text),
          memory: { before: sheetBefore, after: merged }, progress: progressFor(c) });
        // On the last attempt a reply that fails only the checks of conduct goes out: better than the
        // safe reply, which hands the client to the staff (ai/src/agent-guard.js, conductOnly).
        if (check.ok || (attempt === 1 && check.conductOnly)) {
          decision = decisionFrom(result.output, check.text, c.state); sheet = merged;
          if (!check.ok) { decision.conduct_problems = check.problems; console.error(`Agent reply sent with conduct problems: ${check.problems.join(" | ").slice(0, 240)}`); }
        }
        else { problems = check.problems; refusals += 1; console.error(`Agent reply refused by the check: ${problems.join(' | ').slice(0, 240)}`); }
      } catch (error) {
        this.modelTrouble('converse', error, c);
        // Not a refusal that a second request would only repeat (a wrong key, no credit).
        const passing = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.invalid === true || !/^model_http_4(?!08|29)\d\d$|^model_not_configured$/.test(String(error?.message || ''));
        if (!passing) break;
        this.transport.presence?.(c.jid, timeoutMs)?.catch(() => {});
      }
    }
    c.processing = false;
    if (revision !== c.revision || !this.canReply(c)) { if (revision === c.revision) this.handBack(c); this.store.save(c); return; }
    if (!decision) {
      decision = fallbackDecision(c, refusals ? 'check' : 'model');
      c.error = refusals ? `رُفض رد النموذج في الفحص مرتين (${problems.slice(0, 2).join('؛ ')})؛ أُرسل رد احتياطي وأُحيلت المحادثة.`
        : 'تعذر طلب النموذج مرتين؛ أُرسل رد احتياطي وأُحيلت المحادثة.';
    }
    // A copy: the cap below changes the state in place, and the alert compares with this.
    const before = structuredClone(c.state);
    // The conversation's cap of replies (AGENT_MAX_REPLIES): past it nothing more is sent, and
    // the staff get the conversation.
    if (decision.reply && (c.state.sentCount || 0) >= (this.config.agentMaxReplies || 40)) {
      decision = { ...decision, reply: '', action: 'silent' };
      this.requestStaff(c, 'reply_cap');
    }
    const { state, events } = applyDecision(c.state, decision, this.at(c));
    c.state = state;
    const reply = decision.reply;
    // The memory, with the facts this reply asks about counted, and the record (section 14), with
    // no identity or account number (16.2).
    keepDecision(c, decision, sheet);
    if (state.known.name) c.name = state.known.name;
    c.summary = this.summary(c);
    this.afterFlow(c, before, events);
    this.store.save(c); // The request is durable before the client is told about it.
    if (!reply) return;
    c.sentAt = c.sentAt.filter(at => Date.now() - at < 60000);
    if (c.sentAt.length >= (this.profile(c).limits?.max_bot_messages_per_minute || 6)) { this.fail(c, 'توقف الرد الآلي عند حد الرسائل؛ يُراجع الموظف المحادثة.'); return; }
    const plain = normalizeText(reply).toLowerCase();
    if (this.bannedPhrases.some(p => plain.includes(p))) { this.fail(c, 'أُوقف رد آلي لاحتوائه عبارة غير معتمدة؛ يُراجع الموظف المحادثة.'); return; }
    const ms = Math.max(0, this.typingMs(c, reply, 'assistant') - (Date.now() - typingSince));
    if (ms) { this.transport.presence?.(c.jid, ms)?.catch(() => {}); await this.sleep(ms); }
    if (revision !== c.revision || !this.canReply(c)) { if (revision === c.revision) this.handBack(c); this.store.save(c); return; }
    if (!await this.send(c, reply, 'assistant', null, { agent: decision.reply_used, latencyMs: Date.now() - receivedAt, ...(decision.fallback ? { fallback: decision.fallback } : {}) })) return;
    c.sentAt.push(Date.now()); this.later(c);
  }
  // The model's reading of the client's reply to the questions of the assistant's last message
  // (ai/prompts/turn.md): which of them he answered, and whether he asked or objected. The flow
  // acts on it (ai/src/flow.js, "a question is not left behind"). Null when nothing was asked, the
  // provider has no such request, or it failed: the flow then judges by the words of the message.
  async readTurn(c, message, batch = []) {
    const s = c.state;
    if (c.demo || typeof this.provider.turn !== 'function' || !Array.isArray(s.lastAsked) || !s.lastAsked.length || ['with_staff', 'closed'].includes(s.status)) return null;
    const version = pickVersion(s.lang);
    const replies = this.env(c).replies.replies;
    const pending = s.lastAsked.filter((id) => replies[id]).map((id) => ({ id, text: replies[id].variants[0][version] || replies[id].variants[0].arabic }));
    if (!pending.length) return null;
    const now = new Set(batch.map((e) => e.id));
    const conversation = c.messages.filter((m) => ['client', 'assistant', 'staff'].includes(m.role) && (m.transcript || m.text) && !now.has(m.id))
      .slice(-16).map((m) => ({ role: m.role, text: String(m.transcript || m.text).slice(0, 1500) }));
    try {
      const out = await this.provider.turn({ conversation, pending, message: String(message).slice(0, 3000) }, { timeoutMs: this.config.modelTimeout || 6000 });
      return out && out.turn ? out.turn : null;
    } catch (error) { console.error(`Model turn reading failed: ${errorCode(error)}`); return null; }
  }
  // The approved reply adapted to this client (ai/DESIGN.md section 4.5), or null when there is
  // nothing to adapt with. The model chooses courtesy phrases; the code puts them around the
  // approved sentences (composeCourtesy), and checkPhrasing guards the result. { text, problems,
  // reason }: text is null when the approved text is sent as it is, and reason says why
  // ('time', 'error', 'check'); every outcome is counted (store.data.phrasingStats).
  // deadline: when the reply is due; with too little time left the approved text goes as it is.
  async phrase(c, message, deadline = Infinity) {
    // A text alone (an older caller) is a message without parts: nothing in it is reworded.
    if (typeof message === 'string') message = { text: message, parts: [] };
    const draft = message.text;
    if (!this.config.phrasing || c.demo || typeof this.provider.phrase !== 'function') return null;
    const version = pickVersion(c.state.lang);
    const count = (outcome) => { const st = this.store.data.phrasingStats ||= { adapted: 0, unchanged: 0, time: 0, error: 0, check: 0 }; st[outcome] = (st[outcome] || 0) + 1; };
    // A reply with questions is worth the wait: their wording is what makes the assistant read as
    // a person, so the writing always has a few seconds for them, also past the reply's target
    // (the owner's decision of 16 November 2026). Any other reply keeps to the time left.
    const asks = version === 'arabic' && questionsOf(message, this.env(c).replies, version).length > 0;
    const left = Math.max(deadline - Date.now() - 1500, asks ? 8000 : 0);
    if (left < 1000) { count('time'); return { text: null, problems: ['latency_budget'], reason: 'time' }; }
    // The wording of questions may take longer than a choice of phrases (three of them ran out
    // of five seconds in the office owner's conversation of 16 November, and went out unworded).
    const timeoutMs = Math.min(asks ? Math.max(this.config.phrasingTimeout || 5000, 8000) : (this.config.phrasingTimeout || 5000), left);
    try {
      this.transport.presence?.(c.jid, timeoutMs)?.catch(() => {});
      const conversation = c.messages.filter(m => ['client', 'assistant', 'staff'].includes(m.role) && (m.transcript || m.text))
        .slice(-16).map(m => ({ role: m.role, text: String(m.transcript || m.text).slice(0, 1500) }));
      const asked = { draft, questions: questionsOf(message, this.env(c).replies, version), conversation, language: version,
        first_reply: !c.messages.some(m => m.role === 'assistant') };
      const startedAt = Date.now();
      let result;
      try { result = await this.provider.phrase(asked, { timeoutMs }); } catch (error) {
        // An answer that is not the contract's (seen in about one writing of ten on 16 November
        // 2026) is asked for once more when two seconds of the writing's time are left.
        const rest = timeoutMs - (Date.now() - startedAt);
        if (!(error && error.invalid) || rest < 2000) throw error;
        result = await this.provider.phrase(asked, { timeoutMs: rest });
      }
      this.modelTrouble('phrase', null, c);
      const said = conversation.filter(m => m.role === 'client').map(m => m.text);
      // A choice is composed by the code; a text (a provider that writes) is only checked.
      // The questions go in the model's wording where each passed its own check (humanize); the
      // rest of the message is the approved text, which checkPhrasing then guards word for word.
      const human = typeof result.text === 'string' ? { base: draft, text: result.text, problems: [] }
        : humanize(message, result.choice || {}, { version, said, banned: banned.phrases || [], replies: this.env(c).replies });
      if (human.problems.length) console.error(`Reworded question refused by the check: ${human.problems.slice(0, 3).join(' | ').slice(0, 160)}`);
      const text = human.text;
      const check = checkPhrasing(human.base, text, { version, banned: banned.phrases || [], said });
      if (!check.ok) {
        count('check');
        if (result.choice) console.error(`Composed reply refused by the check: ${check.problems.slice(0, 3).join(' | ').slice(0, 160)}`);
        return { text: null, problems: check.problems, reason: 'check' };
      }
      count(text.trim() === String(draft).trim() ? 'unchanged' : 'adapted');
      return { text: text.trim(), problems: [] };
    } catch (error) {
      this.modelTrouble('phrase', error, c);
      count(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'time' : 'error');
      return { text: null, problems: [errorCode(error)], reason: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'time' : 'error' };
    }
  }
  // The model's health (task 14): each failure is logged by its code, without client data, and
  // kept with the last success. A failure to understand is an alert (at most every 15 minutes:
  // the conversation went to the staff); three within five minutes, or five failures to write
  // within ten, mean the service is failing, an alert at most every hour.
  modelTrouble(kind, error, c = null) {
    const health = this.store.data.modelHealth ||= { failures: [], lastOkAt: {} };
    const now = Date.now();
    if (!error) { health.lastOkAt[kind] = now; return; }
    const code = errorCode(error);
    console.error(`Model ${kind} failed: ${code}`);
    health.failures = [...health.failures, { at: now, kind, code }].slice(-50);
    const recent = (minutes) => health.failures.filter(f => f.kind === kind && now - f.at < minutes * 60000).length;
    const lastAlert = (alertKind) => (this.store.data.alerts || []).findLast(a => a.kind === alertKind)?.at || 0;
    if (kind === 'understand' && now - lastAlert('model_failed') > 15 * 60000) this.alert('model_failed', c?.id || null);
    const failing = kind === 'understand' ? recent(5) >= 3 : recent(10) >= 5;
    if (failing && now - lastAlert('model_down') > 3600000) this.alert('model_down');
  }
  // The referral record of the knowledge base (section 7) the staff read first: what the client
  // stated, every date, amount and name quoted in the client's words and checked against the
  // messages. Reasons the record has no words for are given the server's own.
  summary(c) {
    // A conversation the model runs: its own record (section 14 of the office's file).
    if (c.agent) return renderRecord(c.agent, c.state);
    const label = (reason) => REASON_LABELS[reason] || reason;
    const s = c.state;
    const state = { ...s, reasons: (s.reasons || []).map(label), handoff: s.handoff && { ...s.handoff, reason: label(s.handoff.reason) } };
    const lines = [buildRecord(state, triageConfig)];
    const said = c.messages.filter(m => m.role === 'client').flatMap(m => [m.text, m.transcript]).filter(Boolean);
    const check = checkSummaryQuotes(lines[0], said);
    if (!check.ok && !c.demo) lines.push(`تنبيه: لم يُطابق نص العميل حرفيًا: ${check.missing.join('، ') || 'علامات اقتباس'}. راجع المحادثة.`);
    return lines.join('\n');
  }
  // Assistant replies show "typing..." for 2 to 6 seconds by length (spec criterion 29). Staff replies go out at once.
  typingMs(c, text, role) {
    if (role !== 'assistant') return 0;
    const limits = this.profile(c).limits || {};
    const min = limits.typing_min_seconds ?? 2, max = limits.typing_max_seconds ?? 6;
    return Math.round(Math.min(max, Math.max(min, [...text].length / 20)) * 1000);
  }
  // Once the text is handed to the provider it cannot be recalled.
  async send(c, text, role, staff = null, extra = {}) {
    const m = { id: randomUUID(), text, role, staff, at: Date.now(), delivery: c.demo ? 'demo' : 'sending', ...extra };
    c.messages.push(m); c.updatedAt = Date.now();
    // The message is on disk before it leaves. One that could not be saved is not sent: a crash
    // would leave no trace of what the client was told. The staff are told, and send it by hand.
    if (!this.store.save(c) && !c.demo) {
      m.delivery = 'failed';
      this.fail(c, 'تعذر حفظ الرسالة قبل إرسالها (عطل في التخزين)؛ لم تُرسل إلى العميل، ويمكن إرسالها يدويًا بعد عودة التخزين دون خطر تكرار.', 'delivery_failed');
      return false;
    }
    if (c.demo) return true;
    try {
      const result = await this.transport.send(c.jid, text);
      m.providerId = result.key?.id || result.id || null;
      // The provider accepted the request; delivery is confirmed later by its status events.
      if (m.delivery === 'sending') m.delivery = String(result.status || '').toUpperCase() === 'PENDING' ? 'accepted' : 'sent';
      this.store.save(c);
      const early = m.providerId && this.earlyDelivery?.get(m.providerId);
      if (early) { this.earlyDelivery.delete(m.providerId); this.delivery(early); }
      return m.delivery !== 'failed';
    } catch (error) {
      // Refused by the provider (a 4xx), or Evolution could not be reached at all: certainly not
      // sent. Anything else: maybe sent, and the staff are told so (an alert too).
      if (error?.refused || notReached(error)) {
        m.delivery = 'failed';
        this.fail(c, error?.refused ? `رفض مزود واتساب الرسالة (${errorCode(error)})؛ لم تصل إلى العميل، ويمكن إرسالها يدويًا دون خطر تكرار.`
          : `تعذر الوصول إلى خادم واتساب (${failureCode(error)})؛ لم تُرسل الرسالة، ويمكن إرسالها يدويًا دون خطر تكرار.`, 'delivery_failed');
      } else {
        m.delivery = 'unknown';
        this.fail(c, 'نتيجة الإرسال غير مؤكدة؛ راجع واتساب قبل إعادة الإرسال لتجنب التكرار.', 'send_unknown');
      }
      // Evolution may be down: its connection is checked now, not at the next round of the timer.
      if (!error?.refused) this.checkConnection().catch(() => {});
      return false;
    }
  }
  conversation(id) { const c = this.store.data.conversations[id]; if (!c) throw new Error('المحادثة غير موجودة.'); return c; }
  // Client messages of this conversation that the employee `username` has not read yet: those
  // that came while it was with the staff (inbox), after the employee last read it (readBy).
  // One person reading never clears what another has not read.
  unread(c, username) { return Math.max(0, (c.inbox || 0) - ((c.readBy || {})[username] || 0)); }
  markRead(c, username) {
    if (!username || !this.unread(c, username)) return false;
    (c.readBy ||= {})[username] = c.inbox || 0;
    this.later(c); return true;
  }
  // staff: the name shown in the conversation; actor: who the audit trail records, the account
  // name when an employee acts from the page (names are not unique); account: the employee's
  // account, whose page is told of the conversation's new messages (null for the office phone).
  takeover(id, staff, actor = staff, account = null) {
    const c = this.conversation(id); c.revision++; c.pending = []; c.pendingSince = null; c.processing = false;
    c.assigned = staff; c.assignedTo = account; c.requestedAt = null; c.reminders = 0;
    // Taking a conversation is activity: it is not closed as idle for the time it waited before.
    c.updatedAt = Date.now();
    c.state = handle(c.state, { type: 'staff_takeover', at: this.at(c) }, this.env(c)).state;
    if (account) this.markRead(c, account);
    this.store.audit(actor, 'takeover', id); return c;
  }
  async staffReply(id, text, staff, actor = staff, account = null) {
    const c = this.conversation(id);
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('اكتب رسالة من 1 إلى 4000 حرف.');
    if (!c.demo && (!this.config.evolutionKey || this.config.mode !== 'live')) throw new Error('الربط الحي غير مهيأ.');
    if (c.unresolved) throw new Error('رقم المرسل غير معروف؛ رد عليه من هاتف المكتب.');
    this.takeover(id, staff, actor, account); const sent = await this.send(c, text.trim(), 'staff', staff);
    this.store.audit(actor, sent ? 'staff_sent' : 'staff_send_unknown', id); return c;
  }
  action(id, action, user, options = {}) {
    const c = this.conversation(id); const at = this.at(c); const account = user.username || null;
    if (action === 'takeover') return this.takeover(id, user.name, user.username || user.name, account);
    if (action === 'close') {
      if (!c.messages.some(m => m.role === 'staff' && ['accepted', 'sent', 'delivered', 'read', 'demo'].includes(m.delivery)) && !options.noReplyNeeded) throw new Error('رد على العميل أو علّم أن المحادثة لا تحتاج ردًا.');
      if (!['incomplete', 'existing_client'].includes(options.outcome)) throw new Error('حدد نتيجة الإغلاق.');
      c.state = handle(c.state, { type: 'staff_close', at, outcome: options.outcome }, this.env(c)).state;
      c.requestedAt = null; c.reminders = 0;
      // An ended conversation starts its count of new messages again.
      c.inbox = 0; c.readBy = {};
      if (options.outcome === 'existing_client') { c.excluded = true; if (!c.demo && !this.store.data.settings.excluded.includes(c.jid)) this.store.data.settings.excluded.push(c.jid); }
    } else if (action === 'reactivate') {
      if (this.isExcluded(c)) throw new Error('العميل مستثنى من الرد الآلي.');
      if (c.unresolved) throw new Error('رقم المرسل غير معروف؛ لا يمكن تشغيل المساعد في هذه المحادثة.');
      c.state = handle(c.state, { type: 'staff_reactivate', at }, this.env(c)).state;
      c.paused = false; c.assigned = null; c.assignedTo = null; c.error = null; c.flood = null; c.timerAt = null;
    } else if (action === 'return') {
      // «إرجاع للرد الذكي»: the request for the staff is withdrawn, and the assistant goes on with
      // the client from his next message (ai/src/flow.js, staff_return).
      if (this.isExcluded(c)) throw new Error('العميل مستثنى من الرد الآلي.');
      if (c.unresolved) throw new Error('رقم المرسل غير معروف؛ لا يمكن تشغيل المساعد في هذه المحادثة.');
      c.state = handle(c.state, { type: 'staff_return', at }, this.env(c)).state;
      c.paused = false; c.assigned = null; c.assignedTo = null; c.error = null; c.flood = null; c.timerAt = null;
      c.requestedAt = null; c.reminders = 0; c.inbox = 0; c.readBy = {};
      c.summary = this.summary(c);
    } else if (action === 'pause') c.paused = true;
    else throw new Error('إجراء غير معروف.');
    // An employee's action is activity on the conversation (staff_idle_hours counts from it).
    c.updatedAt = Date.now();
    if (account) this.markRead(c, account);
    c.revision++; c.pending = []; c.pendingSince = null; this.store.audit(user.username || user.name, action, id); return c;
  }
  // Conversations with a reply on its way: waiting messages, one being prepared or sent.
  inFlight() {
    return Object.values(this.store.data.conversations).filter(c => !c.demo && (c.pending.length || c.processing || this.running.has(c.id) || this.timers.has(c.id)));
  }
  // Scenarios the local preview can replay faithfully: client messages only.
  demoScenarios() { return scenarios.filter(s => s.steps.every(step => CLIENT_TYPES.includes(step.in.type))); }
  async demo(id) {
    if (this.config.mode !== 'demo') throw new Error('التجارب متاحة في الوضع التجريبي فقط.');
    const scenario = this.demoScenarios().find(s => s.id === id); if (!scenario) throw new Error('تجربة غير موجودة.');
    const jid = `${Math.floor(100000000000 + Math.random() * 899999999999)}@s.whatsapp.net`;
    let c;
    for (const step of scenario.steps) {
      const e = step.in;
      const media = e.type === 'text' ? undefined : { kind: e.type };
      c = this.incoming({ ...e, text: e.text || '', id: randomUUID(), jid, name: 'عميل تجريبي', at: Date.now(), fixtureFlags: e.flags || {}, media }, { demo: true });
      if (c) await this.flush(c.id);
    }
    return c;
  }
  // The number's connection as Evolution reports it: by its webhook, by the check every few
  // minutes (tick) and at start, and by the admin's check. A check that fails is "unknown": the
  // assistant does not answer on a connection nobody can confirm, and the messages go to the
  // staff. A lost connection is an alert once it has lasted a minute (tick); its return is an
  // alert only after that one.
  setConnection(state, error = null) {
    const now = Date.now(); const before = this.store.data.connection || {};
    const next = { ...before, state, checkedAt: now, error };
    if (state !== 'open' && before.state === 'open') Object.assign(next, { lostAt: now, lostAlerted: false });
    if (state === 'open' && before.state !== 'open') {
      if (before.lostAlerted) { next.reconnectedAt = now; this.alert('reconnected'); }
      Object.assign(next, { lostAt: null, lostAlerted: false });
    }
    // Which number is linked is known only while the connection is open, and is asked again
    // after every return (checkConnection): another number may have been linked meanwhile.
    if (state !== 'open' || before.state !== 'open') next.owner = null;
    this.store.data.connection = next; this.store.save();
    if (state === 'open' && before.state !== 'open' && this.config.trialNumber && !this.checking) this.checkConnection().catch(() => {});
  }
  async checkConnection() {
    const c = this.config;
    if (c.mode !== 'live' || typeof this.transport?.state !== 'function' || !(c.evolutionUrl && c.evolutionKey && c.instance)) return this.store.data.connection;
    this.checkedAt = Date.now();
    this.checking ||= (async () => {
      let state; let error = null;
      try { const result = await this.transport.state(); state = String(result?.instance?.state || result?.state || 'unknown'); }
      catch (failure) { state = 'unknown'; error = failureCode(failure); }
      if (!this.stopped) this.setConnection(state, error);
      // For a trial (TRIAL_NUMBER): which number is linked. Unknown when Evolution does not say
      // or cannot be asked: the trial then does not apply.
      if (!this.stopped && state === 'open' && c.trialNumber && typeof this.transport.owner === 'function') {
        let owner = null;
        try { owner = (await this.transport.owner()) || null; } catch { owner = null; }
        if (!this.stopped && this.store.data.connection.state === 'open' && this.store.data.connection.owner !== owner) {
          this.store.data.connection.owner = owner; this.store.save();
        }
      }
      return this.store.data.connection;
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
  watchConnection(now = Date.now()) {
    if (now - (this.checkedAt || 0) >= CONNECTION_CHECK_MS) this.checkConnection().catch(() => {});
    const conn = this.store.data.connection;
    if (conn.lostAt && !conn.lostAlerted && conn.state !== 'open' && now - conn.lostAt >= DISCONNECT_GRACE_MS) {
      conn.lostAlerted = true; this.alert('disconnected'); this.store.save();
    }
  }
  // Webhooks: when one was last accepted, and how many were refused (a wrong secret or instance
  // name), for /health and the settings page. A refusal is logged at most once a minute and
  // alerted at most once an hour: after a secret rotation that missed Evolution's settings,
  // every client message would otherwise be refused in silence.
  webhookAccepted() { (this.store.data.webhook ||= { rejected: 0 }).acceptedAt = Date.now(); }
  webhookRefused(reason) {
    const hook = this.store.data.webhook ||= { rejected: 0 }; const now = Date.now();
    Object.assign(hook, { rejected: (hook.rejected || 0) + 1, rejectedAt: now, reason });
    if (!this.recentAlert('webhook_rejected', HOUR)) this.alert('webhook_rejected');
    if (now - (this.refusalLoggedAt || 0) >= 60000) {
      this.refusalLoggedAt = now;
      console.error(`Webhook refused: ${reason === 'secret' ? 'wrong or missing secret' : 'unexpected instance name'} (${hook.rejected} refused so far)`);
      this.store.save();
    }
  }
  // What a restart found (server/store.js): replies it interrupted, attachment downloads it cut,
  // conversation files it could not read, a state it could not write or had to take from its
  // backup copy. Each is shown and alerted.
  afterRestart() {
    for (const id of this.store.recovered || []) if (!this.store.data.conversations[id]?.demo) this.alert('interrupted', id);
    // Their requests were made by the store; the record the staff read says why.
    for (const id of this.store.mediaLost || []) {
      const c = this.store.data.conversations[id];
      if (!c || c.demo) continue;
      c.summary = this.summary(c); this.alert('media_failed', c.id); this.store.save(c);
    }
    for (let i = 0; i < (this.store.damaged || []).length; i++) this.alert('conversation_damaged');
    if (this.store.saveError) this.alert('storage_failed');
    if (this.store.loadedFrom === 'backup') this.alert('state_restored');
  }
  // The reply times of the latest assistant replies, from the client's last message to the
  // reply's send (spec criterion 10: the first within 11 seconds, the others within 15): how
  // many, the median and the 95th percentile, for the settings page.
  latency(limit = 200, now = Date.now()) {
    const times = [];
    for (const c of Object.values(this.store.data.conversations)) {
      if (c.demo || now - c.updatedAt > 30 * 86400000) continue;
      for (const m of c.messages) if (m.role === 'assistant' && Number.isFinite(m.latencyMs)) times.push([m.at, m.latencyMs]);
    }
    const recent = times.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, ms]) => ms).sort((a, b) => a - b);
    const pick = (q) => (recent.length ? recent[Math.min(recent.length - 1, Math.ceil(q * recent.length) - 1)] : null);
    return { count: recent.length, p50: pick(0.5), p95: pick(0.95) };
  }
  // The provider keeps the model's instructions cached only for a while after their last use (an
  // hour, or five minutes with PROMPT_CACHE_TTL=5m; a provider that keeps them another time says
  // so, cacheLifeMs), and a message that finds them uncached waits longer than the model's
  // timeout allows: the client would get the welcome and go to the staff.
  // So while the assistant answers, the cache is refreshed before it lapses (the provider's warm):
  // at the first round of the timer, then whenever no message used the model for most of the
  // cache's life. A failure is logged and tried again later, not at every round.
  keepWarm(now = Date.now()) {
    if (this.config.mode !== 'live' || typeof this.provider.warm !== 'function' || this.warming || now < (this.warmNotBefore || 0)) return null;
    const life = this.provider.cacheLifeMs || (this.config.promptCacheTtl === '5m' ? 5 * 60000 : 3600000);
    if (now - (this.modelUsedAt || 0) < life * 5 / 6) return null;
    this.warmNotBefore = now + life / 6;
    this.warming = this.provider.warm().then(() => { this.modelUsedAt = now; }, (error) => { console.error(`Model warm-up failed: ${errorCode(error)}`); })
      .finally(() => { this.warming = null; });
    return this.warming;
  }
  tick(now = Date.now()) {
    this.retention(now);
    // A switched-on assistant that stops answering (a requirement lapsed: the texts in use are no
    // longer the approved ones, the connection dropped...) is an alert, and so is its return.
    // The status is computed once for the whole round.
    const status = this.status();
    const was = this.store.data.service || { answering: status.answering };
    if (status.enabled && was.answering !== status.answering) this.alert(status.answering ? 'assistant_resumed' : 'assistant_stopped');
    if (was.answering !== status.answering || String(was.missing) !== String(status.missing)) {
      this.store.data.service = { answering: status.answering, missing: status.missing, changedAt: now }; this.store.save();
    }
    this.watchConnection(now);
    if (status.answering) this.keepWarm(now);
    for (const c of Object.values(this.store.data.conversations)) {
      if (c.demo) continue;
      // The client stopped answering during the questions (a conversation still being screened,
      // with no request yet). A day after the client's last message the flow's answer is final
      // until the next one: it is not asked again every round (greetings alone stay "intake").
      if (c.state.status === 'intake' && !c.state.handoff && c.state.firstReplyDone && c.timerAt !== c.state.lastClientAt
        && !c.processing && !c.pending.length && this.canReply(c, status)) {
        const out = handle(c.state, { type: 'timer', at: this.at(c) }, this.env(c));
        if (out.events.length) { const before = c.state; c.state = out.state; this.afterFlow(c, before, out.events); c.summary = this.summary(c); this.store.save(c); }
        else if (this.at(c) - c.state.lastClientAt > 86400) { c.timerAt = c.state.lastClientAt; this.later(c); }
      }
      // A request nobody took: a reminder, then the office's admin. Only working minutes count.
      if (needsStaff(c)) {
        c.requestedAt ||= now;
        const waited = workingMinutes(this.profile(c), c.requestedAt, now); const reminders = c.reminders || 0;
        if (reminders < 1 && waited > this.limit(c, 'handoff_reminder_minutes')) { c.reminders = 1; this.alert('reminder', c.id); this.store.save(c); }
        else if (reminders < 2 && waited > this.limit(c, 'handoff_escalation_minutes')) { c.reminders = 2; this.alert('escalation', c.id); this.store.save(c); }
      }
      // A conversation left with an employee without activity (no client message and no action
      // of the staff, its takeover included) is closed, without an outcome.
      if (c.state.status === 'with_staff' && now - c.updatedAt > this.limit(c, 'staff_idle_hours') * 3600000) {
        c.state = handle(c.state, { type: 'idle_expired', at: this.at(c) }, this.env(c)).state;
        c.assigned = null; c.assignedTo = null; c.paused = false; c.revision++; c.inbox = 0; c.readBy = {};
        this.store.audit('النظام', 'idle_expired', c.id);
      }
    }
    // Changes kept in memory (read markers, a burst of messages) reach the disk.
    this.store.flush?.();
  }
  // Ended conversations untouched for longer than the office's retention (settings,
  // limits.retention_days, at least 30) are deleted with their files, once an hour at most.
  // Nothing is deleted while the office has not set it; an open request is never deleted.
  retention(now = Date.now()) {
    const days = this.store.data.settings.profile?.limits?.retention_days;
    if (!Number.isInteger(days) || days < 30 || now - (this.retentionAt || 0) < 3600000) return 0;
    this.retentionAt = now;
    const cutoff = now - days * 86400000; let removed = 0;
    for (const c of Object.values(this.store.data.conversations)) {
      if (c.demo || c.updatedAt > cutoff || !['closed', 'done'].includes(c.state.status) || c.pending?.length || c.processing || c.state.handoff) continue;
      for (const m of c.messages) if (m.media?.file) fs.rmSync(path.join(this.store.dir, 'media', path.basename(m.media.file)), { force: true });
      if (this.store.remove) this.store.remove(c.id); else delete this.store.data.conversations[c.id];
      removed += 1;
    }
    if (removed) { this.store.audit('النظام', `retention_deleted:${removed}`); this.alert('retention'); }
    return removed;
  }
  // «حذف المحادثة نهائيًا» (the admin's button on the page): the conversation, its attachments, the
  // alerts that point to it and the delivery ids kept for its address go for good, as
  // scripts/forget-sender.js does with the server stopped. Refused while a reply is being prepared
  // or sent. The audit trail keeps one line, without the conversation or its address.
  forget(id, actor) {
    const c = this.conversation(id);
    if (c.processing || this.running.has(id)) throw new Error('المساعد يجهّز ردًا في هذه المحادثة الآن؛ أعد المحاولة بعد لحظات.');
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    let files = 0;
    for (const m of c.messages) if (m.media?.file) { fs.rmSync(path.join(this.store.dir, 'media', path.basename(m.media.file)), { force: true }); files += 1; }
    const addresses = new Set([c.jid, c.lid].filter(Boolean));
    this.store.remove(id);
    this.store.data.alerts = (this.store.data.alerts || []).filter((a) => a.conversation !== id);
    for (const key of Object.keys(this.store.data.seen || {})) if (addresses.has(key.slice(0, key.lastIndexOf(':')))) delete this.store.data.seen[key];
    this.store.audit(actor, 'conversation_deleted');
    return { deleted: true, messages: c.messages.length, files };
  }
  stop() { this.stopped = true; for (const timer of this.timers.values()) clearTimeout(timer); }
}
module.exports = { Engine, needsStaff, isUrgent, today, outsideHours, workingMinutes, formatHours, READY_NAMES, errorCode };
