'use strict';
// The conversation run by the model (CONVERSATION=agent): the project owner's decision of 18
// November 2026, with the office's file «alothman_assistant_prompt.md» («الفايل ده فيه كل حاجه
// عدلهم»، «استبدل القديم بالحاجات اللي في الفايل ده»). The model reads the whole conversation with
// the office's file (ai/prompts/office.md, verbatim) and the server's contract (ai/prompts/agent.md),
// decides the next step, and writes the reply itself with its record for the team (section 14 of
// the file). The code keeps what the model is not trusted with: every reply passes
// ai/src/agent-guard.js before it is sent; the requests for the staff, their alerts and the
// conversation's state are the server's (server/engine.js, converse); an employee who takes the
// conversation stops the model.
const fs = require('node:fs');
const path = require('node:path');
const { claimsReferral } = require('../ai/src/agent-guard');
const { normalizeText } = require('../ai/src/normalize');

const OFFICE = fs.readFileSync(path.join(__dirname, '../ai/prompts/office.md'), 'utf8').trim();
const CONTRACT = fs.readFileSync(path.join(__dirname, '../ai/prompts/agent.md'), 'utf8').trim();
// One text, the same for every request, so that the provider keeps it cached.
const agentPrompt = `${OFFICE}\n\n${CONTRACT}`;

const REPLY_IDS = [...Array.from({ length: 20 }, (_, i) => `R${i + 1}`), 'free', 'none'];
const ACTIONS = ['ask', 'answer', 'book', 'refer', 'urgent', 'decline', 'existing_client', 'job', 'marketing', 'close', 'silent'];
// The classifications of the file's record (section 14), and «قيد الفرز» while the facts are gathered.
const STATUSES = ['قيد الفرز', 'عاجل', 'خارج النطاق', 'مراجعة استثنائية', 'مكتمل مبدئيًا', 'يحتاج استكمال بيانات', 'يحتاج مستندًا', 'غير مستوفٍ', 'غير مكتمل بعد الطلب'];
const PRIORITIES = ['عاجل', 'عادي', 'للحفظ'];
const REQUESTED = ['استشارة', 'صياغة', 'تمثيل', 'متابعة ملف', 'خدمة غير قضائية', 'غير محدد'];

// The conversation's memory (the project owner's idea of 18 November 2026: «نخلي فيه ذاكرة للمودل
// والحاجات تكون متشافة عشان يعرف اللي عنده واللي محتاجه»): a sheet of the facts the path needs,
// each known (in the client's words), missing, not known to the client, or refused. The model
// updates it with every answer; the server keeps it, gives it back, counts how often each fact was
// asked, refuses a question about a known fact or one asked twice (ai/src/agent-guard.js), and
// says when every needed fact is settled, so that the model decides instead of asking on.
const MEMORY_STATUS = ['معروف', 'ناقص', 'لا يعرف', 'رفض'];
// The amount against its path's threshold (section 3.1, step 9 of 2.1): once it meets it, three
// messages of questions at most, then R3 (the project owner's decision of 18 November 2026).
// «استثناء» while the exception questions of 5.4 are asked (step 8): they are not the assessment's.
const THRESHOLD = ['يبلغ الحد', 'دون الحد', 'غير معروف', 'لا ينطبق', 'استثناء'];
const THRESHOLD_QUESTIONS = 3;

// The answer's form. The memory comes first and the reply after it: the model writes down what it
// knows and what is missing before it decides what to say.
const text = { type: 'string' };
const list = { type: 'array', items: { type: 'string' } };
const memoryItem = { type: 'object', additionalProperties: false, required: ['field', 'required', 'status', 'value'],
  properties: { field: text, required: { type: 'boolean' }, status: { type: 'string', enum: MEMORY_STATUS }, value: text } };
const agentSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    service: text, requested: { type: 'string', enum: REQUESTED }, client_name: text,
    memory: { type: 'array', items: memoryItem }, threshold: { type: 'string', enum: THRESHOLD }, required_documents: list, risk_flags: list,
    status: { type: 'string', enum: STATUSES }, priority: { type: 'string', enum: PRIORITIES },
    action: { type: 'string', enum: ACTIONS }, next_question: text, asking_about: list, reply_used: { type: 'string', enum: REPLY_IDS },
    language: { type: 'string', enum: ['ar', 'en'] }, reply: text, internal_summary: text,
  },
};
agentSchema.required = Object.keys(agentSchema.properties);

// The sheet as the server keeps it: { [key]: { field, required, status, value, asked } }, the key
// being the fact's name in comparison form (ai/src/normalize.js), so that «تاريخ الاستحقاق» written
// twice is one fact. A fact known stays known unless the client gives a new value; a fact once
// needed stays needed; the values lose any identity or account number (16.2).
const memoryKey = (field) => normalizeText(String(field || '').toLowerCase());
function mergeMemory(sheet = {}, items = []) {
  const next = structuredClone(sheet || {});
  for (const item of Array.isArray(items) ? items : []) {
    const key = memoryKey(item && item.field);
    if (!key) continue;
    const before = next[key];
    const wasKnown = Boolean(before && before.status === 'معروف' && before.value);
    const nowKnown = item.status === 'معروف' && String(item.value || '').trim();
    next[key] = {
      field: String(item.field).trim().slice(0, 80),
      required: Boolean(item.required) || Boolean(before && before.required),
      status: nowKnown ? 'معروف' : wasKnown ? 'معروف' : (MEMORY_STATUS.includes(item.status) ? item.status : 'ناقص'),
      value: redact(String(nowKnown ? item.value : wasKnown ? before.value : (item.value || '')).trim().slice(0, 300)),
      asked: before ? before.asked || 0 : 0,
    };
  }
  return next;
}
// The facts the reply asked about: each counted, a fact not on the sheet added as missing.
function countAsked(sheet = {}, fields = []) {
  const next = structuredClone(sheet || {});
  for (const field of new Set(Array.isArray(fields) ? fields : [])) {
    const key = memoryKey(field);
    if (!key) continue;
    next[key] ||= { field: String(field).trim().slice(0, 80), required: false, status: 'ناقص', value: '', asked: 0 };
    next[key].asked = (next[key].asked || 0) + 1;
  }
  return next;
}
const memoryForModel = (sheet) => Object.values(sheet || {}).map(({ field, required, status, value, asked }) => ({ field, required, status, value, asked }));
// Every fact the path needs is known, not known to the client, refused, or asked twice in vain.
function readyToDecide(sheet) {
  const needed = Object.values(sheet || {}).filter((f) => f.required);
  return needed.length > 0 && needed.every((f) => f.status !== 'ناقص' || (f.asked || 0) >= 2);
}
// The messages that asked: all of them, and those asked while the amount met the threshold.
function countAsks(asks = {}, decision = {}) {
  const next = { total: (asks && asks.total) || 0, afterThreshold: (asks && asks.afterThreshold) || 0 };
  if (decision.reply && decision.action === 'ask') {
    next.total += 1;
    if (decision.threshold === 'يبلغ الحد') next.afterThreshold += 1;
  }
  return next;
}
// What the checks need of the conversation's course (ai/src/agent-guard.js).
const progressFor = (c) => ({ afterThreshold: (c.agentAsks && c.agentAsks.afterThreshold) || 0, referred: Boolean(c.state && c.state.handoff) });

// The record's lists of section 14, from the sheet.
function recordFields(sheet) {
  const facts = Object.values(sheet || {});
  return {
    known_facts: facts.filter((f) => f.status === 'معروف').map((f) => `${f.field}: ${f.value}`),
    missing_critical_data: facts.filter((f) => f.required && f.status !== 'معروف')
      .map((f) => `${f.field}${f.status === 'لا يعرف' ? ' (لا يعرفه العميل)' : f.status === 'رفض' ? ' (رفض ذكره)' : (f.asked || 0) >= 2 ? ' (سُئل مرتين دون جواب)' : ''}`),
  };
}

const RIYADH_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
const RIYADH_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false });
// What an attachment is called for the model, and the text a client message has when it came
// without words (server/engine.js, fromClient).
const ATTACHMENT = { voice: 'رسالة صوتية', image: 'صورة', document: 'مستند', video: 'فيديو', unsupported: 'محتوى غير مدعوم (موقع أو جهة اتصال أو غيرهما)' };
const NO_CAPTION = new Set(['رسالة صوتية', 'صورة واردة', 'مستند وارد', 'مقطع فيديو', 'رسالة غير مدعومة']);
// The messages the model reads: the latest, enough for a long screening.
const HISTORY = 40;

// One message as the model reads it. `attached`: its file goes with the request for the model to
// read (images and PDF documents the client just sent; server/engine.js, agentFiles).
function messageFor(m, isNew, attached = false) {
  const out = { role: m.role, date: RIYADH_DATE.format(m.at), time: RIYADH_TIME.format(m.at) };
  if (m.role === 'client' && m.type && m.type !== 'text') {
    out.attachment = ATTACHMENT[m.type] || ATTACHMENT.unsupported;
    if (m.type === 'voice') out.text = m.transcript ? String(m.transcript) : 'لم تُفهم';
    else out.text = m.text && !NO_CAPTION.has(m.text) ? String(m.text) : '';
  } else out.text = String(m.text || '');
  if (attached) out.file = true;
  if (m.deleted) out.deleted_by_client = true;
  if (isNew) out.new = true;
  return out;
}

// The model's own record given back to it (the facts are in the memory).
const RECORD_FIELDS = ['service', 'requested', 'threshold', 'status', 'priority', 'required_documents', 'risk_flags', 'next_question', 'internal_summary'];
const pick = (object, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(object, key)).map((key) => [key, object[key]]));

// What the model is sent for the client's new messages (`newIds`): the conversation, the day and
// the hour, the request's state and its own last record. `problems`: why its previous answer to
// these messages was refused, when it was.
function agentInput(c, { newIds = new Set(), attached = new Set(), outOfHours = false, today, now = Date.now(), problems = [] } = {}) {
  const s = c.state;
  const conversation = c.messages.filter((m) => ['client', 'assistant', 'staff'].includes(m.role) && m.type !== 'reaction')
    .slice(-HISTORY).map((m) => messageFor(m, newIds.has(m.id), attached.has(m.id)));
  return {
    today: { ...(today || {}), time: RIYADH_TIME.format(now) },
    out_of_hours: Boolean(outOfHours),
    whatsapp_name: String(c.name || '').slice(0, 60),
    request: { referred: Boolean(s.handoff), urgent: Boolean(s.handoff && s.handoff.urgent), handled_by_staff_before: Boolean(s.everWithStaff) },
    previous: c.agent ? pick(c.agent, RECORD_FIELDS) : null,
    // What it knows and what it still needs, and whether every needed fact is settled.
    memory: memoryForModel(c.agentMemory),
    ready_to_decide: readyToDecide(c.agentMemory) || progressFor(c).afterThreshold >= THRESHOLD_QUESTIONS,
    threshold_questions: progressFor(c).afterThreshold,
    conversation,
    ...(problems.length ? { guard_problems: problems } : {}),
  };
}

const HANDOFF_ACTIONS = new Set(['refer', 'urgent', 'book', 'existing_client']);
const OUTCOME_OF = { 'تمثيل': 'representation_review', 'صياغة': 'document_request', 'خدمة غير قضائية': 'document_request', 'استشارة': 'booking_request', 'متابعة ملف': 'follow_up' };

// The model's answer as the server acts on it. `reply` is the text that passed the checks. A
// reply that tells the client his request goes to the team, with an action that makes no
// request, is made one: what the client was told becomes true.
function decisionFrom(output, reply, state) {
  const d = { ...output, reply: reply || '' };
  if (!d.reply) d.action = 'silent';
  if (d.reply && !state.handoff && !HANDOFF_ACTIONS.has(d.action) && claimsReferral(d.reply)) { d.action = 'refer'; d.coerced = 'referral'; }
  return d;
}

// The conversation's state after the model's decision (the state of ai/src/flow.js, which the
// staff's actions, the timer and the dashboard read). `at`: seconds since the conversation began.
// Returns { state, events }: the events say whether a request was opened or made urgent.
function applyDecision(state, d, at) {
  const s = structuredClone(state);
  const events = [];
  s.lastClientAt = at;
  s.lang = { last: d.language === 'en' ? 'en' : 'ar' };
  if (d.reply) { s.firstReplyDone = true; s.sentCount = (s.sentCount || 0) + 1; }
  if (d.client_name && d.client_name.trim()) s.known.name = d.client_name.trim().slice(0, 60);
  // What the request is about: the timer passes a screening the client left to the staff only
  // when there is something to pass (ai/src/flow.js, onTimer).
  if (d.service && d.service.trim()) s.known.service_description = d.service.trim().slice(0, 200);
  const urgent = d.action === 'urgent' || d.priority === 'عاجل' || d.status === 'عاجل';
  // An urgent request reaches the staff at once, also while the model still asks its one or two
  // questions (section 5.1 of the file). A decline stays a decline, urgent or not (the prison
  // outside Riyadh, 3.2).
  if (HANDOFF_ACTIONS.has(d.action) || (urgent && !['decline', 'job', 'marketing'].includes(d.action))) {
    const reason = urgent ? 'urgent' : d.action === 'book' ? 'booking' : d.action === 'existing_client' ? 'follow_up' : (d.status === 'قيد الفرز' ? 'referred' : d.status);
    if (!s.handoff) { s.handoff = { reason, urgent, createdAt: at, updates: 0 }; events.push({ type: 'handoff_created', reason }); }
    else {
      s.handoff.updates = (s.handoff.updates || 0) + 1;
      if (urgent && !s.handoff.urgent) { s.handoff.urgent = true; events.push({ type: 'handoff_urgent' }); }
    }
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    if (urgent) s.priority = 'urgent';
    if (HANDOFF_ACTIONS.has(d.action)) {
      s.outcome = d.action === 'book' ? 'booking_request' : d.action === 'existing_client' ? 'follow_up' : (OUTCOME_OF[d.requested] || 'referred');
      s.phase = 'done';
    }
    s.status = 'waiting';
  } else if (s.handoff) {
    // The staff have the request; the model goes on answering until one of them takes it.
    s.handoff.updates = (s.handoff.updates || 0) + 1;
  } else if (d.action === 'decline' || d.action === 'job' || d.action === 'marketing') {
    s.outcome = d.action === 'decline' ? 'declined' : d.action === 'job' ? 'cv' : 'marketing';
    if (d.action !== 'decline') s.sender = d.action;
    s.phase = 'done';
    s.status = 'done';
  } else if (d.action === 'close') {
    if (s.outcome) s.status = 'done';
  } else {
    // Asking or answering: the screening goes on, also with a client who comes back after a decline.
    s.phase = 'triage';
    s.status = 'intake';
  }
  return { state: s, events };
}

// What the record may not keep (section 16.2 of the office's file): an identity or residence
// number (ten digits from 1 or 2) and a bank account number, which a client may send or a document
// may show. Taken out of every text of the record before it is kept.
const IDENTITY = /(?<![0-9٠-٩])[12١٢][0-9٠-٩]{9}(?![0-9٠-٩])/g;
const IBAN = /\bSA\s?\d{2}(?:\s?[0-9A-Z]){20}\b/gi;
const redact = (value) => (typeof value === 'string' ? value.replace(IDENTITY, '[رقم هوية محذوف]').replace(IBAN, '[رقم حساب محذوف]')
  : Array.isArray(value) ? value.map(redact) : value);
function redactRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, redact(value)]));
}

// The record the staff read in the dashboard, from the model's last answer.
function renderRecord(a, state = null) {
  const join = (items) => items.filter(Boolean).join('؛ ');
  const lines = [[a.service || 'المسار لم يتحدد بعد', a.requested && a.requested !== 'غير محدد' ? `المطلوب: ${a.requested}` : ''].filter(Boolean).join(' · '),
    `التصنيف: ${a.status} · الأولوية: ${a.priority}${['يبلغ الحد', 'دون الحد'].includes(a.threshold) ? ` · المبلغ: ${a.threshold}` : ''}`];
  if (a.internal_summary) lines.push(a.internal_summary);
  if (a.known_facts && a.known_facts.length) lines.push(`ما ذكره العميل: ${join(a.known_facts)}`);
  if (a.missing_critical_data && a.missing_critical_data.length) lines.push(`الناقص: ${join(a.missing_critical_data)}`);
  if (a.required_documents && a.required_documents.length) lines.push(`المستندات: ${join(a.required_documents)}`);
  if (a.risk_flags && a.risk_flags.length) lines.push(`للانتباه: ${join(a.risk_flags)}`);
  if (a.next_question) lines.push(`آخر سؤال للعميل: ${a.next_question}`);
  if (a.reply_used && !['free', 'none'].includes(a.reply_used)) lines.push(`آخر رد جاهز استُعمل: ${a.reply_used}`);
  if (a.fallback) lines.push(`تنبيه: أُرسل رد احتياطي (${a.fallback === 'model' ? 'تعذر طلب النموذج' : 'رُفض رد النموذج في الفحص'}). راجع المحادثة.`);
  if (state && state.handoff && state.handoff.reason === 'abandoned') lines.push('انقطع العميل عن الرد قبل اكتمال الفرز (غير مكتمل بعد الطلب).');
  if (state && state.handoff && state.handoff.reason === 'reply_cap') lines.push('بلغت المحادثة حد ردود المساعد؛ أكملها موظف.');
  return lines.join('\n');
}

// The reply sent when the model could not answer (twice) or its reply failed the checks (twice):
// the message is acknowledged and the staff get the conversation, without anything the model wrote.
function fallbackDecision(c, why) {
  const english = c.state.lang && c.state.lang.last === 'en';
  const referred = Boolean(c.state.handoff);
  const reply = referred
    ? (english ? 'Your message has reached us, and our team will contact you on this number.' : 'وصلت رسالتك، وسيتواصل معك الفريق المختص عبر هذا الرقم.')
    : (english ? 'Thank you for your message. Our team will review it and contact you on this number.' : 'شكرًا لتواصلك. وصلت رسالتك، وسيتواصل معك الفريق المختص عبر هذا الرقم.');
  const before = c.agent || {};
  // The memory is kept as it was: the server's sheet is not touched by a reply the model did not write.
  return { service: before.service || '', requested: before.requested || 'غير محدد', client_name: '', memory: [], threshold: before.threshold || 'غير معروف',
    required_documents: before.required_documents || [], risk_flags: before.risk_flags || [],
    status: before.status || 'قيد الفرز', priority: before.priority || 'عادي', action: referred ? 'answer' : 'refer', next_question: '', asking_about: [],
    reply_used: 'free', language: english ? 'en' : 'ar', reply, internal_summary: before.internal_summary || '', fallback: why };
}

// What the conversation keeps after the model's decision: the sheet with the facts the reply asked
// about counted, and the record for the staff with its fact lists made from the sheet.
// `sheet`: the memory after the model's answer was merged (the one before it for a safe reply).
function keepDecision(c, decision, sheet) {
  c.agentMemory = countAsked(sheet, decision.reply ? decision.asking_about : []);
  c.agentAsks = countAsks(c.agentAsks, decision);
  const { reply, memory, ...record } = decision;
  c.agent = { ...redactRecord({ ...record, ...recordFields(c.agentMemory) }), at: Date.now() };
}

module.exports = { agentPrompt, agentSchema, agentInput, decisionFrom, applyDecision, renderRecord, fallbackDecision, messageFor, redactRecord,
  mergeMemory, countAsked, countAsks, progressFor, THRESHOLD, THRESHOLD_QUESTIONS, memoryForModel, readyToDecide, recordFields, keepDecision, memoryKey, MEMORY_STATUS,
  ACTIONS, STATUSES, PRIORITIES, REQUESTED, REPLY_IDS, HANDOFF_ACTIONS, RECORD_FIELDS };
