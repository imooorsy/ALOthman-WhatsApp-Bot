'use strict';

// The conversation (ai/DESIGN.md sections 5 and 6).
//
//   const state = createState();
//   const out = handle(state, input, env);   // env = { replies, profile, triage? }
//   // out = { state, messages: [ { parts, text } ], events: [ { type, ... } ] }
//
// handle() is pure: it never changes the state it receives, reads no clock and uses no
// randomness. Time comes in input.at (seconds from the start of the conversation), and
// whether the message arrived outside working hours in input.outOfHours.

const { normalizeFlags } = require('./flags');
const { normalizeText, toWesternDigits } = require('./normalize');
const { createLanguage, updateLanguage, pickVersion } = require('./language');
const { pickPart, makePart, greetingPart, placeholderValues, buildMessage, joinList, formatNumber } = require('./replies');
const { convertAmount } = require('./currency');
const { redact } = require('./record');
const T = require('./triage');

let defaultTriage = null;
const loadTriage = () => defaultTriage || (defaultTriage = require('../../config/triage.json'));

const CLIENT_INPUTS = ['text', 'voice', 'image', 'document', 'model_failed'];
const DEFAULT_LIMITS = { max_bot_messages: 15, abandoned_minutes: 10 };
// Replies that tell the client the team will contact them (DESIGN 6.1, step 5).
const CONTACT_PROMISES = [
  'review_representation', 'referred', 'referred_urgent', 'referred_team', 'referred_quote', 'human',
  'booking_received', 'business_development', 'transfer_unclear', 'discount', 'returning', 'no_approved_answer', 'waiting',
];

// Where each extracted field is kept: [part of the state, name there].
const EXTRACTED = {
  case_status: ['case', 'case_status'], monetary: ['case', 'monetary'],
  amount_min_sar: ['case', 'amount_min'], amount_max_sar: ['case', 'amount_max'], amount_currency: ['case', 'currency'],
  employment_ongoing: ['case', 'employment_ongoing'], employment_end_months_ago: ['case', 'employment_end_months_ago'],
  employment_end_needs_confirmation: ['case', 'employment_end_needs_confirmation'], dismissed: ['case', 'dismissed'],
  prior_procedure: ['case', 'prior_procedure'], acknowledgment_or_excuse: ['case', 'acknowledgment_or_excuse'],
  detained: ['case', 'detained'], in_riyadh: ['case', 'in_riyadh'], detention_place: ['case', 'detention_place'],
  detention_place_unknown: ['case', 'detention_place_unknown'],
  event_kind: ['case', 'event_kind'], event_days_until: ['case', 'event_days_until'],
  government_party: ['case', 'government_party'], state_owned_company: ['case', 'state_owned_company'],
  domestic_worker: ['case', 'domestic_worker'], enforcement_kind: ['case', 'enforcement_kind'],
  enforcement_exhausted: ['case', 'enforcement_exhausted'], final_judgment_nothing_left: ['case', 'final_judgment_nothing_left'],
  foreign_buyer: ['case', 'foreign_buyer'], heirs_count: ['case', 'heirs_count'],
  client_outside_ksa: ['case', 'client_outside_ksa'], case_outside_ksa: ['case', 'case_outside_ksa'],
  urgent: ['case', 'urgent_said'],
  name: ['known', 'name'], client_role: ['known', 'client_role'], client_type: ['known', 'client_type'],
  parties: ['known', 'parties'], city: ['known', 'city'], desired_outcome: ['known', 'desired_outcome'],
  stage: ['known', 'stage'], file_reference: ['known', 'file_reference'], preferred_time: ['known', 'preferred_time'],
  other_party_name: ['known', 'other_party'], phone: ['known', 'phone'], cv_field: ['known', 'cv_field'],
  cv_second_field: ['known', 'cv_second_field'],
  contract_compensation: ['case', 'contract_compensation'], contract_expired: ['case', 'contract_expired'], confidential: ['case', 'confidential'],
};

function createState() {
  return {
    status: 'intake', // intake | waiting | with_staff | closed | done
    phase: 'triage', // triage | offered | booking | document_wait | cv_wait | done
    closedOutcome: null,
    everWithStaff: false,
    firstReplyDone: false,
    sender: null,
    case: {
      specialty: null, goal: null, task_type: null, case_status: null, monetary: null,
      amount_min: null, amount_max: null, currency: null,
      employment_ongoing: null, employment_end_months_ago: null, employment_end_needs_confirmation: null, employment_end_disputed: null, dismissed: null,
      prior_procedure: null, acknowledgment_or_excuse: null, detained: null, in_riyadh: null, detention_place: null, detention_place_unknown: null,
      event_kind: null, event_days_until: null, government_party: null, state_owned_company: null, domestic_worker: null,
      enforcement_kind: null, enforcement_exhausted: null, final_judgment_nothing_left: null, foreign_buyer: null,
      heirs_count: null, client_outside_ksa: null, case_outside_ksa: null, complex_matter: false, urgent_said: null,
      contract_compensation: null, contract_expired: null, confidential: null,
      event_at: null,
    },
    known: {
      name: null, client_role: null, client_type: null, parties: null, city: null, service_description: null,
      desired_outcome: null, stage: null, file_reference: null, preferred_time: null, other_party: null, phone: null,
      consultation_format: null, cv_field: null, cv_second_field: null,
    },
    // conversion: the amount in another currency, in riyals at the day's rate (ai/src/currency.js).
    facts: { dates: [], amounts: [], documents: [], said: [], answers: [], earlierAmounts: [], conversion: null },
    asked: [], answered: [], lastAsked: [], askAgain: [], reasked: [], explained: [], questionCount: 0, followupMessages: 0, leadSent: false, amountRefused: false,
    offered: null, // { options: [...], card }
    outcome: null, priority: 'normal', reasons: [], offers: [],
    used: {}, sentCount: 0, handoff: null, lang: createLanguage(),
    clarifyAttempts: 0, lastClientAt: null, sensitiveWarned: false, awardSent: false, legalOffered: false, injection: false,
    // Earlier matters of the same conversation, for the staff: { specialty, outcome, reasons }.
    // noted: the matter last added for the staff while they had the conversation { index, at }.
    matters: [], noted: null, attachmentsInRow: 0,
  };
}

const limitsOf = (env) => ({ ...DEFAULT_LIMITS, ...((env.profile && env.profile.limits) || {}) });

// ---------- requests for the staff ----------

function createHandoff(t, reason, urgent = false) {
  const { s } = t;
  const isUrgent = urgent || s.priority === 'urgent';
  if (s.handoff) {
    if (isUrgent && !s.handoff.urgent) markUrgent(t);
    // A promise made beside the reply while the staff already have a request (a price the office
    // offered before, a question passed to them) is added to what their request is about.
    if (['pricing_request', 'admin_unanswered'].includes(reason) && s.handoff.reason !== reason && !s.reasons.includes(reason)) s.reasons.push(reason);
    return;
  }
  s.handoff = { reason, urgent: isUrgent, createdAt: t.input.at, updates: 0 };
  t.events.push({ type: 'handoff_created', reason, urgent: isUrgent });
  // A request made after the conversation ended is in the staff queue like any other.
  if (s.status === 'done') s.status = 'waiting';
}

function markUrgent(t) {
  if (t.s.handoff && !t.s.handoff.urgent) {
    t.s.handoff.urgent = true;
    t.events.push({ type: 'handoff_urgent' });
  }
}

// Ends the triage with an outcome. A reason creates a request for the staff.
function finish(t, outcome, reason = null, urgent = false) {
  const { s } = t;
  s.outcome = outcome;
  if (reason) {
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    createHandoff(t, reason, urgent);
  }
  s.phase = 'done';
  s.offered = null;
  s.status = s.handoff ? 'waiting' : 'done';
}

const silent = (t, reason) => t.events.push({ type: 'silent', reason });

// ---------- parts ----------

function markUsed(s, part) {
  const variants = s.used[part.id] || (s.used[part.id] = []);
  if (!variants.includes(part.variant)) variants.push(part.variant);
}

// The values of every placeholder for this input, with the extras of a consultation offer.
function values(t, extras = {}) {
  const { s, env, triage, version } = t;
  return placeholderValues(env.profile, version, t.flags, s.known, { prices: triage.prices, award: awardFor(t), ...extras });
}

// Adds the next usable phrasing of a reply to `list` (t.body by default).
function add(t, id, extras = {}, list = t.body) {
  const part = pickPart(t.env.replies, t.s.used, id, t.version, values(t, extras));
  if (!part) return false;
  markUsed(t.s, part);
  list.push(part);
  return true;
}

// A fragment's text, filled; fragments are building blocks and are not marked used.
function fragment(t, id, extras = {}) {
  const part = makePart(t.env.replies, id, 0, t.version, values(t, extras));
  return part ? part.text : null;
}

function awardFor(t) {
  const awards = t.triage.awards || {};
  const award = awards[t.s.case.specialty] || awards.general;
  return award ? award[t.version] || null : null;
}

// ---------- consultations ----------

// The consultation to offer for a card: its name and price in this version, and whether
// the price is "starting from". `phone` asks for the phone consultation where it exists.
function consultationFor(t, card, { phone = false } = {}) {
  const { s, triage } = t;
  const kind = card && (s.case.task_type === 'design' && triage.consultations.ip ? 'ip' : card.consultation);
  let consultation = kind && triage.consultations[kind];
  if (!consultation) return null;
  // The phone consultation only where this path has one (knowledge base A.3); elsewhere the
  // request for a call changes nothing in the price.
  const usePhone = Boolean(phone && consultation.phone && triage.consultations.phone);
  const formatsId = consultation.phone && !usePhone ? 'format_with_phone' : 'format_standard';
  if (usePhone) consultation = triage.consultations.phone;
  let priceKey = consultation.price;
  let from = false;
  if (!usePhone && s.case.complex_matter && consultation.complex_from) { priceKey = consultation.complex_from; from = true; }
  if (!usePhone && s.case.task_type === 'dispute' && consultation.dispute_from) { priceKey = consultation.dispute_from; from = true; }
  return {
    name: consultation.name[t.version],
    price: formatNumber(triage.prices[priceKey]),
    priceKey,
    from,
    phone: consultation.format === 'phone',
    formatsId,
  };
}

// What is still needed to book, as one phrase: "الاسم الكامل، و...".
function bookingNeeds(t, consultation) {
  const { s } = t;
  const items = [];
  if (!s.known.name) items.push(fragment(t, 'need_name'));
  if (!s.known.service_description) items.push(fragment(t, 'need_topic'));
  if (!s.known.consultation_format && !(consultation && consultation.phone)) {
    const formats = fragment(t, consultation ? consultation.formatsId : 'format_standard');
    items.push(fragment(t, 'need_format', { consultation_formats: formats }));
  }
  if (!s.known.preferred_time) items.push(fragment(t, 'need_time'));
  const kept = items.filter(Boolean);
  return joinList(kept.length ? kept : [fragment(t, 'need_time')], t.version);
}

// A consultation the knowledge base gives no price for: company formation (2, 5.12), and an
// enforcement request that is not a note dispute (table 2; the 1,000 of 5.10 is the note's).
const unpriced = (s, card) => Boolean(card && (card.consultation_quote
  || (card.notes_only && s.case.enforcement_kind && s.case.enforcement_kind !== 'note')));

function offerConsultation(t, card, options = {}) {
  const { s } = t;
  if (card && card.consultation_offer) return serviceOffer(t, card, card.consultation_offer);
  // «تُحدد الأتعاب بعد مراجعة المختص» (section 3), and the team prices it. Not said twice when the
  // decline has just said it.
  if (unpriced(s, card)) {
    if (!s.offers.some((o) => o.reply === 'decline_enforcement_other')) add(t, 'fees_by_team');
    s.offers.push({ reply: 'fees_by_team', prices: [] });
    add(t, 'referred_quote');
    s.offered = null;
    return finish(t, 'document_request', 'quote');
  }
  // A phone consultation where this path has none (knowledge base A.3): the format is asked
  // again with the formats it has, and the staff never read "phone".
  const kind = card && card.consultation && t.triage.consultations[card.consultation];
  if (s.known.consultation_format === 'phone' && kind && !kind.phone) s.known.consultation_format = null;
  const consultation = consultationFor(t, card, options);
  if (!consultation) return review(t, card && card.no_price ? 'no_price' : 'no_consultation');
  const extras = {
    consultation_name: consultation.name,
    consultation_price: consultation.price,
    booking_needs: bookingNeeds(t, consultation),
  };
  // Everything to book was already given: the price, then the booking request (knowledge base
  // 6.8 and 6.9), without asking again for what the client said.
  if (s.known.name && s.known.service_description && s.known.preferred_time && (s.known.consultation_format || consultation.phone)) {
    const id = consultation.from ? 'consult_price_from' : 'consult_price';
    add(t, id, extras);
    s.offers.push({ reply: id, prices: [consultation.priceKey] });
    add(t, 'booking_received');
    add(t, 'booking_documents');
    s.offered = null;
    return finish(t, 'booking_request', 'booking');
  }
  add(t, consultation.from ? 'consult_offer_from' : 'consult_offer', extras);
  s.offers.push({ reply: consultation.from ? 'consult_offer_from' : 'consult_offer', prices: [consultation.priceKey] });
  s.phase = 'booking';
  s.offered = null;
  // A labour consultation only: any near date is asked with the offer (knowledge base 4.1).
  if (card.consultation_asks_date && T.questionApplies(s, 'q_deadlines', t.triage) && !s.asked.includes('q_check_new') && !s.answered.includes('q_check_new')
    && add(t, 'q_deadlines')) {
    s.asked.push('q_deadlines');
    s.lastAsked = ['q_deadlines'];
    t.askedNow = true;
  }
  return true;
}

// A service offer: its reply, then what follows it (DESIGN 6.5).
function serviceOffer(t, card, offer) {
  const { s } = t;
  if (offer.reply.startsWith('consult_offer')) return offerConsultation(t, card);
  // Its price was already given as the answer to "how much": what follows it only.
  const question = t.env.replies.replies[offer.reply].kind === 'question';
  if (question || !s.used[offer.reply]) add(t, offer.reply);
  if (!s.offers.some((o) => o.reply === offer.reply)) s.offers.push({ reply: offer.reply, prices: pricesIn(t, offer.reply) });
  // A refused trademark (knowledge base 5.11): the refusal's notice date is asked, and the request
  // is urgent, since the time to object is running. The answer goes to the team with the request.
  if (offer.urgent) {
    s.priority = 'urgent';
    if (!s.reasons.includes(offer.urgent)) s.reasons.push(offer.urgent);
  }
  if (offer.ask && T.questionApplies(s, offer.ask, t.triage)) {
    askOne(t, offer.ask);
    s.phase = 'document_wait';
    return true;
  }
  if (t.env.replies.replies[offer.reply].kind === 'question') {
    s.phase = 'document_wait';
    return true;
  }
  if (offer.then === 'booking') {
    add(t, 'booking_details', { booking_needs: bookingNeeds(t, null) });
    s.phase = 'booking';
    return true;
  }
  // A fixed price needs no quote: the request goes to the team as it is.
  add(t, offer.then === 'refer' ? 'referred' : 'referred_quote');
  finish(t, 'document_request', 'document_request');
  return true;
}

const pricesIn = (t, id) => [...new Set((t.env.replies.replies[id].variants[0].arabic.match(/\{price_(\w+)\}/g) || [])
  .map((placeholder) => placeholder.slice(7, -1)))];

function offerDocument(t, card) {
  const { s } = t;
  const task = card.tasks && s.case.task_type && card.tasks[s.case.task_type];
  // The commercial tasks are priced for claims under the threshold (knowledge base 3.1): above
  // it, or crossing it, the team quotes.
  const quote = { reply: 'offer_quote', then: 'refer_quote' };
  let offer = task || card.document || quote;
  if (!task && card.document && card.document.reply === 'offer_commercial_tasks' && card.threshold) {
    const amount = T.amountAgainst(s, card.threshold, t.triage);
    if (['above', 'straddle', 'other_currency'].includes(amount)) offer = quote;
    // An amount not said yet: asked once, and the document offer waits for it.
    if (amount === 'unknown') {
      const id = card.first.find((q) => (t.triage.questions[q].known || []).includes('amount')) || 'q_amount_estimate';
      if (!s.asked.includes(id) && !s.answered.includes(id) && !s.amountRefused) {
        s.case.goal = 'document';
        s.phase = 'triage';
        s.offered = null;
        return askOne(t, id);
      }
      offer = quote;
    }
  }
  // A labour objection to a judgment is drafted as an objection (6.18).
  if (!task && card.document && card.document.reply === 'offer_labor_drafting' && s.case.case_status === 'judgment') {
    return serviceOffer(t, card, { reply: 'offer_labor_objection', then: 'refer_quote' });
  }
  if (offer.reply !== 'offer_quote') return serviceOffer(t, card, offer);
  // A service the team prices «بعد معرفة التفاصيل» (knowledge base 3): what is wanted is asked
  // first, with the card's first questions, once, so that the client is not passed on after one
  // word and the team's record says what he needs (the project owner's decision of 16 November
  // 2026; 1.11 sent a task straight to the price). Unanswered, the request goes on as it is.
  const next = T.nextQuestions(s, card, t.triage);
  if (next && !next.followup) {
    s.case.goal = 'document';
    s.phase = 'triage';
    s.offered = null;
    return ask(t, { ask: next.ids, lead: next.lead, followup: false });
  }
  // With the quote, the consultation of this subject where it has an approved price (table 2:
  // «البديل المعروض»), for a client who would rather start there.
  const consultation = !unpriced(s, card) && consultationFor(t, card);
  if (consultation && !consultation.from) {
    add(t, 'offer_quote_consult', { consultation_price: consultation.price });
    if (!s.offers.some((o) => o.reply === 'offer_quote_consult')) s.offers.push({ reply: 'offer_quote_consult', prices: [consultation.priceKey] });
    add(t, 'referred_quote');
    return finish(t, 'document_request', 'document_request');
  }
  return serviceOffer(t, card, offer);
}

// The legal question gets the paid consultation of its card (knowledge base 1.6, 6.7).
function legalOffer(t, card) {
  const { s } = t;
  const consultation = card && !card.consultation_offer && !unpriced(s, card) ? consultationFor(t, card) : null;
  if (consultation) {
    const id = consultation.from ? 'legal_offer_from' : 'legal_offer';
    if (add(t, id, { consultation_price: consultation.price })) s.offers.push({ reply: id, prices: [consultation.priceKey] });
  } else {
    add(t, 'legal_offer_generic');
  }
  s.legalOffered = true;
  s.phase = 'offered';
  s.offered = { options: ['consultation', ...(consultation && t.triage.consultations[card.consultation]?.phone ? ['phone'] : [])], card: s.case.specialty };
  return true;
}

function review(t, reason) {
  if (add(t, 'review_representation') && !t.s.offers.some((o) => o.reply === 'review_representation')) t.s.offers.push({ reply: 'review_representation', prices: [] });
  if (reason && !t.s.reasons.includes(reason)) t.s.reasons.push(reason);
  finish(t, 'representation_review', 'representation_review');
  return true;
}

// ---------- questions ----------

function ask(t, decision) {
  const { s, triage } = t;
  if ((decision.lead || (t.first && decision.followup)) && !s.leadSent) {
    add(t, 'lead');
    s.leadSent = true;
  } else if (decision.followup && !t.first && t.flags.answered_pending !== false && !t.flags.sensitive_data) {
    // "شكرًا للتوضيح" only after an answer.
    add(t, 'ack');
  }
  // A question counts as asked only when it was sent.
  const sent = decision.ask.filter((id) => add(t, id));
  if (sent.length) t.askedNow = true;
  for (const id of sent) {
    if (!s.asked.includes(id)) s.asked.push(id);
    s.questionCount += 1;
  }
  // A question asked once more ("again") is not asked a third time.
  for (const id of s.askAgain || []) {
    const short = triage.questions[id].short;
    if (sent.includes(id) || (short && sent.includes(short.id))) (s.reasked ||= []).push(id);
  }
  if (s.askAgain) s.askAgain = s.askAgain.filter((id) => !(s.reasked || []).includes(id));
  if (decision.followup && sent.length) s.followupMessages += 1;
  s.lastAsked = sent;
  return true;
}

const askOne = (t, id) => ask(t, { ask: [id], lead: false, followup: false });

// ---------- the triage (DESIGN 6.2) ----------

const cardOf = (t) => (t.s.case.specialty ? t.triage.cards[t.s.case.specialty] : null);

// A sender the triage acts on: "unknown" (a greeting, a name, an unclear message) is not one.
const SENDERS = ['existing_client', 'job', 'training', 'marketing', 'law_firm', 'wrong_number', 'delivery'];
const namedSender = (flags) => SENDERS.includes(flags.sender);

// Something in the message beyond courtesy that the triage can act on.
function hasSubstance(flags) {
  return Boolean(flags.specialty || flags.goal || flags.task_type || flags.has_legal_question || flags.wants_human
    || namedSender(flags) || flags.extracted.service_description || flags.extracted.detained
    || flags.answered_pending === true || flags.yes_no || flags.extracted.amounts_mentioned.length
    || flags.extracted.dates_mentioned.length || flags.extracted.case_status);
}

function triage(t) {
  const { s, flags } = t;
  const c = s.case;
  // A job or training applicant who writes about a legal matter of his own is a client now.
  if (['job', 'training'].includes(s.sender) && legalSubstance(flags) && !['job', 'training'].includes(flags.sender)) s.sender = null;
  // A job or training applicant is what the latest message says («تدريب» after the unclear question).
  const said = t.senderIgnored ? null : flags.sender;
  const sender = ['job', 'training'].includes(said) ? said : (s.sender || said);

  // 1. Who is writing. An existing client with an urgent matter: the urgent request first, and
  // the file number only completes it (knowledge base 1.7, 1.11).
  if (sender === 'existing_client' || c.goal === 'follow_up') {
    const urgent = T.urgency(s, t.triage);
    if (urgent) {
      s.priority = 'urgent';
      if (!s.reasons.includes(urgent)) s.reasons.push(urgent);
      createHandoff(t, 'urgent', true);
      s.status = 'waiting';
    }
    return existingClient(t);
  }
  if (sender === 'job' || sender === 'training') return cvStart(t, sender);
  if (sender === 'marketing') { add(t, 'marketing'); return finish(t, 'marketing'); }
  if (sender === 'law_firm') { add(t, 'business_development'); return finish(t, 'business_development', 'business_development'); }
  if (sender === 'wrong_number') { add(t, 'wrong_number'); return true; }
  if (sender === 'delivery') { add(t, 'delivery'); createHandoff(t, 'delivery', true); return true; }

  // 2. A request to talk to the staff.
  if (flags.wants_human) return humanRequest(t);

  // 3. Urgent, and the one exclusion that applies even then.
  const excluded = T.exclusion(s, t.triage);
  // A prison outside Riyadh is declined even when urgent (1.7): an urgent request opened while
  // the place was unknown is withdrawn, since there is nothing left for the staff to do.
  if (excluded === 'prison_outside_riyadh') {
    if (s.handoff && s.handoff.reason === 'urgent') { s.handoff = null; s.priority = 'normal'; t.events.push({ type: 'handoff_withdrawn', reason: excluded }); }
    return decline(t, t.triage.excluded[excluded].reply, [], excluded);
  }
  const urgent = T.urgency(s, t.triage);
  if (urgent) return onUrgent(t, urgent);

  // 4. Excluded services.
  if (excluded === 'ambiguous_party') { add(t, 'referred'); return finish(t, 'referred', 'ambiguous_party'); }
  if (excluded) return decline(t, t.triage.excluded[excluded].reply, [], excluded);

  const card = cardOf(t);

  // 5. A legal question: the paid consultation, never an answer.
  if (flags.has_legal_question && !s.legalOffered && !(card && card.no_price)) return legalOffer(t, card);

  // 6. No subject yet.
  if (!card || c.specialty === 'general') return noSubject(t, card);

  // 7. The goal.
  if (c.goal === 'consultation') return offerConsultation(t, card, { phone: s.known.consultation_format === 'phone' });
  // Notarization asks the number and the type of the documents first (knowledge base 3.1).
  if (c.goal === 'document') return card.questions_before_offer ? cardStep(t, card) : offerDocument(t, card);

  // 8 to 10. The card.
  return cardStep(t, card);
}

// ---------- a question is not left behind ----------
//
// The project owner's decision of 16 November 2026, after the office owner's test («أي تاريخ؟»
// answered with the next two questions, twice): while the triage still has questions to ask, it
// does not go on to the next one before the client answered the one he was asked, and a client
// who asks what the question means, or objects to the questions, is answered first. A question
// is put again once, alone; and once more when he asks about it. A client who says he does not
// know, refuses, or will answer later is not asked again (knowledge base 1.4), and a decision
// that needs no more questions (a decline, a referral, an offer) is not held back.

// «ما أعرف»: he cannot answer, which is an answer.
const UNKNOWN_SAID = ['ما اعرف', 'مااعرف', 'لا اعرف', 'ما ادري', 'ماادري', 'لا ادري', 'مدري', 'مادري', 'ما عندي علم', 'ماعندي علم', 'مش عارف',
  'مو عارف', 'معرفش', 'ما اذكر', 'مااذكر', 'لا اذكر', 'مش فاكر', 'مو متاكد', 'مش متاكد', 'غير متاكد', 'ما عندي', 'ماعندي', 'لا علم لي',
  'ما اقدر', 'مااقدر', 'لا استطيع', 'ما استطيع', 'صعب احدد', 'ما احد يعرف',
  "don't know", 'dont know', 'do not know', 'not sure', 'no idea', "can't remember", 'cannot remember'];
// He asks back, or objects: «أي تاريخ؟», «وش تقصد», «ما فهمت», «ليش تسأل وما تنتظر جوابي».
const ASKING_BACK = ['اي', 'ايش', 'وش', 'شنو', 'ايه', 'ليش', 'ليه', 'لماذا', 'كيف', 'يعني', 'تقصد', 'قصدك', 'تقصدون', 'المقصود', 'وضح', 'وضحوا', 'اشرح',
  'فهمت', 'فاهم', 'افهم', 'مفهوم', 'what', 'which', 'why', 'how', 'mean', 'meaning', 'understand', 'explain', 'huh'];
const wordsOf = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean).map((w) => normalizeText(w));
// «ولا أعرف البنود»: the same words behind a joined «و» or «ف».
const saysUnknown = (text) => { const plain = ` ${wordsOf(text).map((w) => w.replace(/^[وف](?=.{2})/, '')).join(' ')} `; return UNKNOWN_SAID.some((p) => plain.includes(` ${wordsOf(p).join(' ')} `)); };
const asksBack = (text) => /[؟?]/.test(String(text || '')) || wordsOf(text).some((w) => ASKING_BACK.includes(w) || ASKING_BACK.includes(w.replace(/^[وف]/, '')));

// The model's reading of this reply (ai/prompts/turn.md, asked for by the server beside the
// understanding): what became of each question of the assistant's last message, and whether the
// client asked or objected. Null when there is none; the words of the message decide then.
const TURN_STATUS = ['answered', 'partly', 'not_answered', 'does_not_know', 'refused', 'later'];
const TURN_ASKS = ['nothing', 'what_we_meant', 'objection', 'about_office', 'legal_question', 'other'];
function turnOf(t) {
  const turn = t.input && t.input.turn;
  if (!turn || typeof turn !== 'object' || !Array.isArray(turn.pending)) return null;
  const status = {};
  for (const p of turn.pending) if (p && typeof p.id === 'string' && TURN_STATUS.includes(p.status) && t.s.lastAsked.includes(p.id)) status[p.id] = p.status;
  // A reading with no word on any question of the last message says nothing.
  if (!Object.keys(status).length) return null;
  return { status, asks: TURN_ASKS.includes(turn.client_asks) ? turn.client_asks : 'nothing' };
}
// He asks what the question means, or objects to the questions.
const asksAboutIt = (t) => { const read = turnOf(t); return read ? ['what_we_meant', 'objection'].includes(read.asks) : asksBack(t.input.text) && t.flags.answered_pending !== true; };

// The question a short form stands for («q_labor_end» for «q_labor_status»), or the id itself.
const baseOf = (id, triage) => (Object.keys(triage.questions).find((q) => triage.questions[q].short && triage.questions[q].short.id === id) || id);

// Whether a question may no longer be put again: once for a reply that left it unanswered, and
// up to twice, explained, for a client who asks what it means or objects (he is still asking).
function spentOn(s, id, triage, asksAbout) {
  const base = baseOf(id, triage);
  const times = (list) => (list || []).filter((x) => x === id || x === base).length;
  // An explanation he asked for is not the repetition a silent question is owed: after it, a
  // question he still left unanswered is put once more (the office owner's test of 16 November,
  // where the number of heirs was never asked again).
  return asksAbout ? times(s.explained) >= 2 : times(s.reasked) >= 1;
}

// He wrote this before the assistant's last reply reached him (the server says so), and that
// reply was the explanation of these very questions: it has been answered already, and a second
// copy of it is not sent (two messages ten seconds apart got the same reply twice).
const alreadyExplained = (t, ids) => t.input.crossed === true && asksAboutIt(t)
  && ids.every((id) => (t.s.explained || []).includes(baseOf(id, t.triage)));

// The questions of the assistant's last message that the client's reply left unanswered and that
// may still be put again. Empty when he answered, cannot or will not answer, or said he will later.
function leftUnanswered(t) {
  const { s, flags, input, triage } = t;
  if (t.first || !s.lastAsked.length || input.type !== 'text' && input.type !== 'voice') return [];
  const read = turnOf(t);
  // With a reading of the reply, its word on each question decides (an objection is not a
  // refusal, whatever the tagging called it); without one, the tagging and the words do.
  if (!read && (flags.refused_pending || flags.will_reply_later || saysUnknown(input.text))) return [];
  const catalog = triage.questions;
  const asked = s.lastAsked.filter((id) => catalog[id]);
  if (read) {
    // The reading says which question was answered: one it calls unanswered, or answered in
    // part, is put again while it is still due; «ما أعرف», a refusal and «برد عليكم» are not.
    const due = asked.filter((id) => ['not_answered', 'partly'].includes(read.status[id]) && T.questionApplies(s, id, triage, true)
      && !((catalog[id].known || catalog[id].known_all) && !T.fieldMissing(s, id, triage)));
    const about = ['what_we_meant', 'objection'].includes(read.asks);
    return due.filter((id) => !spentOn(s, id, triage, about));
  }
  const answered = (id) => s.answered.includes(id) || s.answered.includes(baseOf(id, triage))
    || Boolean((catalog[id].known || catalog[id].known_all) && !T.fieldMissing(s, id, triage))
    // What he said since leaves it without a subject (he still works there: no end date to ask).
    || !T.questionApplies(s, id, triage, true);
  const open = asked.filter((id) => !answered(id));
  // «نعم» or a short answer the model read as one, without saying which question it answers.
  if (flags.answered_pending === true && open.length === asked.length) return [];
  const back = asksAboutIt(t);
  return open.filter((id) => !spentOn(s, id, triage, back));
}

// The questions of the assistant's last message, put again after an answer to the client's own
// question about the office. Once for each: a client who keeps asking is only answered.
function backToQuestion(t) {
  const { s, triage } = t;
  const catalog = triage.questions;
  const ids = s.lastAsked.filter((id) => catalog[id] && !s.answered.includes(id) && !(s.returned || []).includes(id)
    && T.questionApplies(s, id, triage, true) && !((catalog[id].known || catalog[id].known_all) && !T.fieldMissing(s, id, triage)));
  const sent = ids.filter((id) => add(t, id));
  if (!sent.length) return false;
  (s.returned ||= []).push(...sent);
  s.lastAsked = sent;
  t.askedNow = true;
  return true;
}

function askAgain(t, ids) {
  const { s, triage } = t;
  const back = asksAboutIt(t);
  // He asked what was meant, or objected: a word of apology, then the question, which the
  // wording model puts in plainer words (ai/prompts/phrase.md, section 4).
  if (back) add(t, 'explain_question');
  const sent = ids.filter((id) => add(t, id));
  if (!sent.length) return false;
  const list = back ? (s.explained ||= []) : (s.reasked ||= []);
  for (const id of sent) list.push(baseOf(id, triage));
  if (s.askAgain) s.askAgain = s.askAgain.filter((id) => !sent.includes(id) && !sent.some((x) => baseOf(x, triage) === id));
  s.lastAsked = sent;
  t.askedNow = true;
  return true;
}

function cardStep(t, card) {
  const { s } = t;
  const decision = T.cardDecision(s, card, t.triage);
  // Before the next question, the one he was asked and did not answer. And before a decision that
  // ends the questions (a decline, a referral, an offer), the question he asks about or objects
  // to: «ما فهمت» to the last question is explained, not answered with «أُحيل طلبكم».
  if (decision.ask || asksAboutIt(t)) {
    const open = leftUnanswered(t);
    if (open.length && alreadyExplained(t, open)) return silent(t, 'crossed') || true;
    if (open.length && askAgain(t, open)) return true;
  }
  if (decision.ask) return ask(t, decision);
  if (decision.decline) return decline(t, decision.decline, decision.options, decision.reason, card);
  if (decision.refer) {
    if (decision.urgent) s.priority = 'urgent';
    add(t, decision.urgent ? 'referred_urgent' : (decision.reply || 'referred'));
    return finish(t, 'referred', decision.refer, decision.urgent);
  }
  if (decision.review) return review(t, decision.review);
  // A service card at the end of its questions.
  const task = card.tasks && s.case.task_type && card.tasks[s.case.task_type];
  const offer = task || card.after_questions || card.consultation_offer;
  if (offer) return serviceOffer(t, card, offer);
  add(t, 'offer_quote');
  add(t, 'referred_quote');
  return finish(t, 'document_request', 'quote');
}

function noSubject(t, card) {
  const { s, flags } = t;
  // «ما أعرف» to the question just asked is not an answer: the next step is taken, and no
  // question is asked twice (knowledge base 1.4).
  const nonAnswer = !t.first && !flags.is_unclear && !hasSubstance(flags) && s.lastAsked.length > 0
    && !flags.courtesy_only && !flags.closing && !flags.will_reply_later;
  if (!nonAnswer && (flags.is_unclear || !hasSubstance(flags))) {
    if (t.first) return true; // welcome_full asks how we can help
    // A courtesy, a closing word, or a question about the office already answered: nothing more.
    // Anything else the client wrote is never left without a reply.
    const nothingSaid = flags.courtesy_only || flags.closing || flags.will_reply_later || t.side.length > 0 || Boolean(t.greetingPart);
    if (!flags.is_unclear && nothingSaid) return closingOrNothing(t);
    // «عندي مشكلة وأريد مساعدتكم» names no subject: the client is asked what it is, in plain
    // words, before «لم تتضح لنا الصورة» (the office owner's test of 16 November 2026: «ليش ما
    // تسألني ايش هي مشكلتك»).
    if (!s.asked.includes('q_topic') && !s.handoff) return askOne(t, 'q_topic');
    return clarifyOrTransfer(t);
  }
  if (s.case.goal === 'consultation' && !s.asked.includes('q_topic')) return askOne(t, 'q_topic');
  if (!s.case.goal && !s.asked.includes('q_goal')) return askOne(t, 'q_goal');
  if (!s.asked.includes('q_topic')) return askOne(t, 'q_topic');
  if (card && card.first.length) {
    const decision = T.cardDecision(s, card, t.triage);
    if (decision.ask) return ask(t, decision);
  }
  // A legal subject the client described, on none of the lists: it was understood, and it goes to
  // the team (knowledge base 2.1), not to another request to explain.
  // «عندي مشكلة وأريد مساعدتكم» is no description: nothing was understood yet, and the team is not
  // given a request that says nothing (the project owner's decision of 16 November 2026).
  if (s.known.service_description && !flags.is_unclear && describes(s.known.service_description)) {
    add(t, 'referred');
    return finish(t, 'referred', 'unlisted_subject');
  }
  return clarifyOrTransfer(t);
}

// Words that say a client has something to ask, not what it is. A description made of them only
// («عندي مشكلة اريد مساعدتكم», «I need help with a legal problem») names no subject.
const GENERIC_WORDS = new Set(['عندي', 'عندنا', 'عنده', 'لدي', 'لدينا', 'معي', 'مشكلة', 'مشكله', 'مشكلتي', 'مشاكل', 'قضية', 'قضيتي', 'قضايا',
  'موضوع', 'موضوعي', 'طلب', 'طلبي', 'استفسار', 'استفساري', 'سؤال', 'اريد', 'نريد', 'ابغى', 'ابغي', 'ابي', 'ابا', 'احتاج', 'محتاج', 'نحتاج', 'ودي',
  'بغيت', 'اود', 'ارغب', 'مساعدة', 'مساعدتكم', 'مساعدتك', 'تساعدوني', 'تساعدني', 'ساعدوني', 'خدمة', 'خدمتكم', 'تخدموني', 'تخدمني', 'محامي',
  'محامية', 'قانوني', 'قانونية', 'قانون', 'منكم', 'معكم', 'لكم', 'من', 'في', 'على', 'مع', 'عن', 'لو', 'سمحت', 'سمحتم', 'ممكن', 'فضلا', 'رجاء', 'انا',
  'اخوي', 'اخي', 'يا', 'شي', 'شيء', 'حاجة', 'اتكلم', 'اكلمكم', 'اتواصل', 'بخصوص', 'بس', 'فقط', 'واحد', 'هذا', 'هذي', 'هذه', 'كذا', 'عاجل', 'ضروري',
  'مهم', 'جدا', 'اللي', 'الي', 'هو', 'هي', 'ما', 'وش', 'ايش', 'كيف', 'ليش', 'هل', 'فيه', 'فيها', 'تكمل', 'اكمل', 'معاي', 'معايا', 'عايز', 'عاوز',
  'i', 'we', 'have', 'has', 'a', 'an', 'the', 'problem', 'issue', 'case', 'matter', 'question', 'need', 'want', 'help', 'legal', 'lawyer',
  'please', 'with', 'my', 'me', 'you', 'your', 'can', 'could', 'would', 'like', 'to', 'about', 'some', 'something', 'advice', 'and', 'for',
].map((word) => normalizeText(word)));

function describes(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).some((raw) => {
    const word = normalizeText(raw);
    if (word.length < 3 || GENERIC_WORDS.has(word)) return false;
    // «والمشكلة», «بقضية», «لمساعدتكم»: the same words behind a conjunction, a preposition or the article.
    const bare = word.replace(/^[وف]?(?:بال|لل|ال|ب|ل)?/, '');
    return !(GENERIC_WORDS.has(bare) || GENERIC_WORDS.has(word.replace(/^[وف]/, '')));
  });
}

function clarifyOrTransfer(t) {
  const { s, input } = t;
  if (s.clarifyAttempts < 1) {
    s.clarifyAttempts += 1;
    return add(t, input.type === 'voice' ? 'media_unclear' : 'clarify');
  }
  // The staff already have the conversation: their request stays as it is.
  if (s.handoff) return add(t, 'waiting') || silent(t, 'unclear') || true;
  add(t, 'transfer_unclear');
  return finish(t, 'referred', 'unclear');
}

function closingOrNothing(t) {
  const { flags } = t;
  if (flags.closing) return add(t, flags.closing === 'goodbye' ? 'goodbye_reply' : 'thanks_reply');
  return true;
}

const JUDGMENT_QUESTIONS = ['q_judgment_type', 'q_judgment_dates', 'q_judgment_new_evidence'];

function onUrgent(t, reason) {
  const { s } = t;
  const c = s.case;
  s.priority = 'urgent';
  if (!s.reasons.includes(reason)) s.reasons.push(reason);
  markUrgent(t);
  const card = cardOf(t);
  // A document request keeps its offer, and the urgent request reaches the staff first
  // (knowledge base 8.5, 1.11).
  if (c.goal === 'document' && card && (card.document || card.tasks)) {
    createHandoff(t, 'urgent', true);
    s.status = 'waiting';
    return offerDocument(t, card);
  }
  // Only the procedure, its date and the notice date are asked, once (knowledge base 1.7).
  // The request reaches the staff at once; the question only completes it (knowledge base 1.11).
  const askNow = (id) => { createHandoff(t, 'urgent', true); s.status = 'waiting'; return askOne(t, id); };
  if (c.detained === true) {
    const place = c.detention_place && normalizeText(c.detention_place) !== normalizeText(s.known.city || '') ? c.detention_place : null;
    // A family that said it does not know where he is held is not asked where (knowledge base 1.4).
    if (!place && c.detention_place_unknown !== true && !['q_urgent_detained', 'q_urgent_detained_place', 'q_crim_place'].some((id) => s.asked.includes(id))) {
      // The basics only (knowledge base 5.13): with the investigation's date and the applicant's
      // capacity already said, only the place is asked; with the capacity said («ابني موقوف»),
      // the question goes without it (1.4: what the client said is not asked).
      const told = c.event_days_until !== null && c.event_days_until !== undefined && s.known.client_role;
      return askNow(told ? 'q_crim_place' : T.formOf(s, 'q_urgent_detained', t.triage));
    }
    // Neither the place nor the city is known: the city is asked once, since outside Riyadh the
    // visit is declined and in Riyadh the inquiry service is offered (knowledge base 5.13).
    if (!place && c.detention_place_unknown === true && c.in_riyadh === null && !s.known.city && T.questionApplies(s, 'q_crim_city', t.triage)) return askNow('q_crim_city');
  } else if (reason === 'judgment') {
    // A judgment to review (knowledge base 5.9, example 18): its kind and level, its date and the
    // notice's; not the procedure, which the client may not know.
    const questions = JUDGMENT_QUESTIONS.filter((id) => T.questionApplies(s, id, t.triage));
    if (questions.length) {
      createHandoff(t, 'urgent', true);
      s.status = 'waiting';
      return ask(t, { ask: questions, lead: false, followup: false });
    }
  } else if (reason !== 'labor_time_review' && T.questionApplies(s, 'q_urgent', t.triage)) {
    return askNow('q_urgent');
  }
  // Held in Riyadh, the family not knowing where: the inquiry service at its price, with the urgent
  // request (knowledge base 5.13). The place known, no price (5.13's rule, A.15, example 12).
  const placeKnown = c.detention_place && normalizeText(c.detention_place) !== normalizeText(s.known.city || '');
  if (c.detained === true && c.in_riyadh === true && c.detention_place_unknown === true && !placeKnown
    && s.sender !== 'existing_client' && c.goal !== 'follow_up' && add(t, 'offer_detainee_inquiry')) {
    s.offers.push({ reply: 'offer_detainee_inquiry', prices: ['detainee_inquiry'] });
  }
  add(t, 'referred_urgent');
  // A request the staff already have (a booking, a review) keeps its outcome, now urgent.
  return finish(t, s.handoff && s.outcome ? s.outcome : 'referred', 'urgent', true);
}

// A request to talk to a person, at any stage. A request already with the staff keeps its
// outcome; the wish is added to its reasons.
function humanRequest(t) {
  const { s } = t;
  // Asked again: "your request is with the team" once, then nothing (spec criterion 46).
  if (s.handoff && s.reasons.includes('wants_human')) return add(t, 'waiting') || silent(t, 'wants_human') || true;
  add(t, 'human');
  if (!s.handoff) return finish(t, 'referred', 'wants_human');
  if (!s.reasons.includes('wants_human')) s.reasons.push('wants_human');
  s.phase = 'done';
  s.offered = null;
  s.status = 'waiting';
  return true;
}

function decline(t, reply, options, reason, card = null) {
  const { s } = t;
  if (add(t, reply)) s.offers.push({ reply, prices: pricesIn(t, reply) });
  if (!s.reasons.includes(reason)) s.reasons.push(reason);
  s.outcome = 'declined';
  if (options && options.length) {
    s.phase = 'offered';
    s.offered = { options: [...options], card: card ? s.case.specialty : null };
    s.status = 'intake';
    return true;
  }
  s.phase = 'done';
  s.offered = null;
  s.status = s.handoff ? 'waiting' : 'done';
  return true;
}

function existingClient(t) {
  const { s } = t;
  s.sender = 'existing_client';
  if (!s.known.file_reference && !s.asked.includes('q_existing_client')) return askOne(t, 'q_existing_client');
  add(t, s.priority === 'urgent' ? 'referred_urgent' : 'referred_team');
  return finish(t, 'follow_up', 'follow_up', s.priority === 'urgent');
}

function cvStart(t, kind) {
  const { s, flags, input } = t;
  s.sender = kind;
  s.outcome = 'cv';
  // Two fields named: one question, and the record's main field follows the answer (5.16).
  if (twoFields(t)) return askTwoFields(t);
  // The CV came with this message (a caption), or before it: received (knowledge base 5.16).
  if (cvFile(t)) return cvReceived(t);
  if (flags.is_unclear && !s.used.cv_unclear) return add(t, 'cv_unclear');
  add(t, kind === 'training' ? 'cv_training' : 'cv_job');
  s.phase = 'cv_wait';
  return true;
}

// A file came with the message, or before it: a job seeker's file is his CV, a photo of it too.
const cvFile = (t) => ['document', 'image'].includes(t.input.attachment) || t.s.facts.documents.some((d) => d === 'document' || d === 'image');

// The applicant named two fields, and was not asked yet which one he prefers.
const twoFields = (t) => Boolean(t.s.known.cv_field && t.s.known.cv_second_field && t.s.known.cv_second_field !== t.s.known.cv_field
  && !t.s.asked.includes('cv_two_fields'));
function askTwoFields(t) {
  askOne(t, 'cv_two_fields');
  t.s.phase = 'cv_wait';
  return true;
}

function cvReceived(t, id = 'cv_received') {
  const { s } = t;
  if (twoFields(t)) return askTwoFields(t);
  // A CV sent as a photo, with no field said: a clear PDF copy is asked for, once (5.16).
  if (id === 'cv_received' && t.input.type === 'image' && !s.facts.documents.includes('document') && !s.known.cv_field && !s.used.cv_pdf) {
    add(t, 'cv_pdf');
    s.outcome = 'cv';
    s.phase = 'cv_wait';
    return true;
  }
  add(t, id);
  s.outcome = 'cv';
  s.phase = 'done';
  s.status = s.handoff ? 'waiting' : 'done';
  return true;
}

// ---------- the other phases (DESIGN 6.5) ----------

function offered(t) {
  const { s, flags } = t;
  const card = s.offered && s.offered.card ? t.triage.cards[s.offered.card] : cardOf(t);
  const options = (s.offered && s.offered.options) || [];
  // The phone consultation has its own price wherever this path has one (knowledge base 3.1, A.3),
  // whether or not the offer named it.
  const kind = card && card.consultation && t.triage.consultations[card.consultation];
  const wantsPhone = flags.consultation_format === 'phone' && Boolean(kind && kind.phone);
  const choseConsultation = flags.goal === 'consultation' || wantsPhone
    || (flags.yes_no === 'yes' && options[0] === 'consultation');
  if (choseConsultation && options.includes('consultation')) {
    if (!card || card === t.triage.cards.general) {
      // The consultation was offered before the subject was known: its price needs the subject.
      s.case.goal = 'consultation';
      s.phase = 'triage';
      s.offered = null;
      return s.asked.includes('q_topic') ? clarifyOrTransfer(t) : askOne(t, 'q_topic');
    }
    return offerConsultation(t, card, { phone: wantsPhone });
  }
  // The document offered, also asked for by its price («كم سعر الصحيفة؟»).
  if ((flags.goal === 'document' || flags.task_type === 'drafting') && options.includes('document')) return offerDocument(t, card);
  // A document the offer did not include: offered if the path has one and nothing was declined;
  // after a decline, a request for a service not offered goes to the staff (6.19).
  if (flags.goal === 'document') {
    if (s.outcome !== 'declined' && card && (card.document || card.tasks)) return offerDocument(t, card);
    add(t, 'referred');
    return finish(t, s.outcome === 'declined' ? 'declined' : 'referred', 'client_insists');
  }
  // Another goal than the options, even with a "no" to them ("لا، أبغى محامي يتولى القضية"):
  // after a decline the client insists, and the staff decide (knowledge base 6.19); after the
  // offer of a consultation for a legal question, the triage takes the request as it is now.
  if (flags.goal && !['consultation', 'document'].includes(flags.goal)) {
    if (s.outcome === 'declined' && !decisionChanged(t)) { add(t, 'referred'); return finish(t, 'declined', 'client_insists'); }
    return reopen(t);
  }
  // «لا» to the paid consultation, and with it his question again or more about his matter («لا.
  // هل يحق لي رفع دعوى؟»): not «العفو، حياكم الله». The consultation was offered and refused; his
  // matter is still there, and the triage takes it up with its card's questions, so that the team
  // can look at it (the office owner's test of 16 November 2026).
  const legalOffered = s.legalOffered === true && s.outcome !== 'declined' && options[0] === 'consultation';
  if (flags.yes_no === 'no' && legalOffered && card && card !== t.triage.cards.general
    && (flags.has_legal_question || flags.specialty || anyExtracted(flags))) {
    s.offered = null;
    return reopen(t);
  }
  if (flags.yes_no === 'no' || (flags.closing && !hasSubstance(flags))) {
    closingOrNothing(t);
    if (!t.body.length) add(t, 'thanks_reply');
    if (s.outcome !== 'declined') s.outcome = 'offer_declined';
    s.phase = 'done';
    s.offered = null;
    s.status = s.handoff ? 'waiting' : 'done';
    return true;
  }
  if (legalAgain(t)) return subjectNamed(t) ? legalForSubject(t, card) : legalOffer(t, card);
  // New facts that change the decision send the request back to the triage.
  if (decisionChanged(t)) return reopen(t);
  // The client's own case after the consultation was offered for a legal question: the
  // triage takes it (knowledge base 1.11). After a decline, new facts that do not change it
  // go to the staff (6.19).
  if (caseFacts(flags)) {
    if (s.outcome === 'declined') { add(t, 'referred'); return finish(t, 'declined', 'client_insists'); }
    s.phase = 'triage';
    s.offered = null;
    return triage(t);
  }
  // A legal question again: the paid consultation once more while it has phrasings, then
  // nothing (spec criterion 51).
  if (flags.has_legal_question) return subjectNamed(t) ? legalForSubject(t, card) : legalOffer(t, card);
  if (t.side.length) return true;
  // Courtesy, or "let me think about it": answered politely, the offer stays open.
  if (flags.courtesy_only || flags.closing) return closingOrNothing(t);
  if (!(hasSubstance(flags) || flags.is_unclear)) return deferral(t);
  return clarifyOrTransfer(t);
}

// "Let me think and get back to you": one polite word, and the offer stays open.
function deferral(t) {
  return add(t, 'deferral_reply') || true;
}

// Something about the case itself in the message: its subject, its facts, its stage.
// The same legal question again, with nothing new about the case but its subject (spec
// criterion 51).
function legalAgain(t) {
  const { s, flags } = t;
  return flags.has_legal_question && s.legalOffered && (!flags.specialty || flags.specialty === s.case.specialty)
    && !caseFacts({ ...flags, specialty: null });
}

// A legal question that names its subject only after the general offer: an excluded subject is
// declined and one without a priced consultation goes on with its card, as in a first message;
// one with a priced consultation gets that offer. The reply is never empty.
const subjectNamed = (t) => Boolean(t.flags.specialty && t.flags.specialty !== 'general' && t.flags.specialty !== t.specialtyBefore);
function legalForSubject(t, card) {
  const { s } = t;
  const before = t.body.length;
  if (!T.exclusion(s, t.triage)) legalOffer(t, card);
  if (t.body.length > before) return true;
  if (s.phase === 'done' || s.status === 'done') { s.outcome = null; s.status = s.handoff ? 'waiting' : 'intake'; }
  s.phase = 'triage';
  s.offered = null;
  return triage(t);
}

// A conversation that left its end for an offer or a booking is active again: the timer watches
// it, and a client who stops answering reaches the staff.
function active(t, result) {
  const { s } = t;
  if (s.phase !== 'done' && s.status === 'done') s.status = s.handoff ? 'waiting' : 'intake';
  return result;
}

// Anything the model took from the message: a fact, a name, an answer.
const anyExtracted = (flags) => Object.values(flags.extracted).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''));

function caseFacts(flags) {
  const x = flags.extracted;
  return Boolean(flags.specialty || x.service_description || x.amounts_mentioned.length || x.dates_mentioned.length
    || x.case_status || x.detained || x.event_kind || x.dismissed || x.employment_ongoing !== null);
}

// The triage takes the request again as it is now. After a decline that no longer holds, its
// reason leaves the record and the change is noted.
const DECLINE_REASONS = ['below_threshold', 'labor_time', 'enforcement_not_note'];
function reopen(t) {
  const { s } = t;
  if (s.outcome === 'declined') {
    s.reasons = s.reasons.filter((reason) => !DECLINE_REASONS.includes(reason));
    if (!s.reasons.includes('facts_changed')) s.reasons.push('facts_changed');
  }
  s.phase = 'triage';
  s.offered = null;
  s.outcome = null;
  s.status = 'intake';
  return triage(t);
}

// After a decline, has a decisive fact changed so that the card would not decline now?
function decisionChanged(t) {
  const { s } = t;
  if (T.urgency(s, t.triage)) return true;
  const card = cardOf(t);
  if (!card || s.outcome !== 'declined') return false;
  if (!t.flags.extracted.amounts_mentioned.length && t.flags.extracted.employment_end_months_ago === null
    && t.flags.extracted.acknowledgment_or_excuse === null) return false;
  const decision = T.cardDecision({ ...s, asked: [...s.asked, 'q_check_new', 'q_labor_status', 'q_labor_end'] }, card, t.triage);
  return !decision.decline;
}

function booking(t) {
  const { s, flags } = t;
  // Another goal than the consultation, even with a "no" to it: a document is offered, and
  // representation goes back to the triage, or to the staff after a decline (6.19).
  if (flags.goal === 'document') {
    const card = cardOf(t);
    if (card && (card.document || card.tasks)) return offerDocument(t, card);
    add(t, 'referred'); return finish(t, s.outcome === 'declined' ? 'declined' : 'referred', 'client_insists');
  }
  if (flags.goal && !['consultation', 'document'].includes(flags.goal)) {
    if (s.outcome === 'declined') { add(t, 'referred'); return finish(t, 'declined', 'client_insists'); }
    s.phase = 'triage';
    return triage(t);
  }
  // A question about the office while booking is answered; the booking waits for its details.
  if (adminOnly(flags)) return true;
  // «لا» to «هل يوجد موعد قريب؟» answers that question; it does not decline the consultation.
  const noDate = flags.yes_no === 'no' && s.lastAsked.includes('q_deadlines') && !flags.closing;
  if ((flags.yes_no === 'no' && !noDate) || (flags.closing && !hasSubstance(flags) && !flags.extracted.name)) {
    closingOrNothing(t);
    if (!t.body.length) add(t, 'thanks_reply');
    s.outcome = s.outcome === 'declined' ? 'declined' : 'offer_declined';
    s.phase = 'done';
    s.status = s.handoff ? 'waiting' : 'done';
    return true;
  }
  // Only booking details, or a yes, make a booking request (knowledge base 6.9): a courtesy or
  // a message about something else asks again for what is needed.
  const details = flags.extracted.name || flags.extracted.preferred_time || flags.consultation_format
    || flags.yes_no === 'yes' || flags.answered_pending === true || flags.extracted.service_description;
  if (!details) {
    if (t.side.length) return true;
    if (flags.courtesy_only && !flags.is_unclear) return closingOrNothing(t);
    if (!hasSubstance(flags) && !flags.is_unclear) return deferral(t);
    return add(t, 'booking_details', { booking_needs: bookingNeeds(t, null) }) || true;
  }
  // A phone call where this consultation has none (knowledge base A.3): the formats it has.
  const card = cardOf(t);
  const kind = card && card.consultation && t.triage.consultations[card.consultation];
  if (s.known.consultation_format === 'phone' && kind && !kind.phone) {
    s.known.consultation_format = null;
    return add(t, 'booking_details', { booking_needs: bookingNeeds(t, null) }) || true;
  }
  if (s.known.consultation_format === 'phone' && kind && kind.phone && !s.offers.some((o) => o.prices.includes('phone_consultation'))) {
    s.offers.push({ reply: 'phone_chosen', prices: ['phone_consultation'] });
  }
  if (!s.known.name && !s.asked.includes('q_booking_name')) return askOne(t, 'q_booking_name');
  add(t, 'booking_received');
  add(t, 'booking_documents');
  return finish(t, 'booking_request', 'booking');
}

function documentWait(t) {
  const { s, flags } = t;
  // "No, thanks" to the drafting offer ends it, as a "no" to a booking does: nothing for the team.
  if (t.input.type === 'text' && (flags.yes_no === 'no' || (flags.closing && !hasSubstance(flags)))) {
    closingOrNothing(t);
    if (!t.body.length) add(t, 'thanks_reply');
    s.outcome = 'offer_declined';
    s.phase = 'done';
    s.status = s.handoff ? 'waiting' : 'done';
    return true;
  }
  // "Let me think about it": one polite word, and the offer stays open.
  if (t.input.type === 'text' && !hasSubstance(flags) && !flags.is_unclear && !flags.courtesy_only && !flags.closing) {
    return t.side.length ? true : deferral(t);
  }
  add(t, 'referred_quote');
  return finish(t, 'document_request', 'document_request');
}

// A legal matter from a job seeker, or anything to triage, after the CV request: a new request.
const legalSubstance = (flags) => Boolean(flags.specialty || flags.goal || flags.has_legal_question || flags.wants_human
  || flags.extracted.service_description || flags.extracted.detained || flags.extracted.case_status);

function cvWait(t) {
  const { s, flags, input } = t;
  if (flags.wants_human) return humanRequest(t);
  if (legalSubstance(flags) && !['job', 'training'].includes(flags.sender)) {
    s.sender = null;
    s.outcome = null;
    s.phase = 'triage';
    return triage(t);
  }
  // Training or job, as the client corrects it after the unclear question.
  if (['job', 'training'].includes(flags.sender) && flags.sender !== s.sender && !s.used.cv_received) return cvStart(t, flags.sender);
  if (t.side.length) return true;
  // The CV attached with a caption, or «أرسلتها فوق» after one arrived: received.
  if (cvFile(t)) return cvReceived(t);
  // The training applicant's details (the CV is optional), or no CV: noted, never ignored.
  if (flags.courtesy_only && !hasSubstance(flags)) return closingOrNothing(t);
  return cvReceived(t, 'cv_noted');
}

// A request passed to the team with no subject (the messages were not understood, named
// nothing, or the model failed on them), that no employee has taken yet.
const emptyHandoff = (s) => Boolean(s.handoff && ['unclear', 'unlisted_subject', 'model_failed'].includes(s.handoff.reason) && !s.handoff.urgent
  && s.status === 'waiting' && !s.everWithStaff);

function done(t) {
  const { s, flags } = t;
  if (s.outcome === 'declined' && decisionChanged(t)) return reopen(t);
  // After such a request, a client who now says what his matter is, is not told to wait: the
  // request is withdrawn and the triage goes on with the subject, to reach the team at its end
  // with something to act on (the project owner's decision of 16 November 2026).
  if (emptyHandoff(s) && cardOf(t) && s.case.specialty !== 'general') {
    t.events.push({ type: 'handoff_withdrawn', reason: s.handoff.reason });
    s.reasons = s.reasons.filter((reason) => reason !== s.handoff.reason);
    s.handoff = null;
    s.clarifyAttempts = 0;
    return reopen(t);
  }
  // A legal question while the staff have the request: they answer it, the request stays.
  if (flags.has_legal_question && !s.legalOffered && !s.handoff && !(cardOf(t) && cardOf(t).no_price)) return active(t, legalOffer(t, cardOf(t)));
  if (legalAgain(t) && !s.handoff) return active(t, subjectNamed(t) ? legalForSubject(t, cardOf(t)) : legalOffer(t, cardOf(t)));
  const card = cardOf(t);
  // The consultation, also when the client said no to it before and wants it now.
  if (flags.goal === 'consultation' && card && (card.consultation || card.consultation_offer || card.consultation_quote)
    && (s.outcome === 'offer_declined' || !s.offers.some((o) => /^consult_(offer|price)/.test(o.reply) || o.reply === 'fees_by_team'))) {
    return active(t, offerConsultation(t, card, { phone: s.known.consultation_format === 'phone' }));
  }
  // A courtesy, a greeting or an answer about the office, with nothing else in the message, is
  // all there is to answer. With a request beside it («السلام عليكم، غيرت رأيي وأبغى محامي»),
  // the request is handled below: it is never left without a reply.
  const request = hasSubstance({ ...flags, yes_no: null, answered_pending: null }) || flags.is_unclear;
  if (!request && (flags.closing || (flags.courtesy_only && !t.greetingPart))) return closingOrNothing(t);
  if (!request && (t.side.length || t.greetingPart)) return true;
  // The team has a request that names no subject, and the client writes again without one: he
  // is asked for it once more, so that the triage can go on with him; then «طلبكم لدى الفريق».
  if (emptyHandoff(s) && add(t, 'subject_again')) return true;
  if (s.handoff) return add(t, 'waiting') || silent(t, 'done') || true;
  // After an end without the staff, a message with something to act on is never left unanswered
  // (DESIGN 6.5.1): a goal the client did not have is the same matter again; insisting after a
  // decline, or anything else, goes to the staff, after one request to clarify an unclear one.
  // A message first read as marketing, then about a legal matter: a request to triage.
  if (s.outcome === 'marketing' && legalSubstance(flags) && flags.sender !== 'marketing') return reopen(t);
  if (s.outcome === 'marketing' || !(hasSubstance(flags) || flags.is_unclear)) { silent(t, 'done'); return true; }
  if (flags.goal && flags.goal !== 'consultation' && s.outcome !== 'declined' && card) {
    s.phase = 'triage';
    s.outcome = null;
    s.status = 'intake';
    return triage(t);
  }
  // A bare «لا» after the end is a polite no, not a request.
  if (flags.yes_no === 'no' && !flags.goal && !flags.specialty && !flags.has_legal_question && !flags.wants_human) return closingOrNothing(t);
  if (s.outcome === 'declined' && flags.goal) { add(t, 'referred'); return finish(t, s.outcome, 'client_insists'); }
  // Facts of the case after the end: after a decline, new information goes to the staff (6.19);
  // otherwise the triage takes the request as it now is (spec criterion 58).
  if (caseFacts(flags)) {
    if (s.outcome === 'declined') { add(t, 'referred'); return finish(t, 'declined', 'client_insists'); }
    s.phase = 'triage';
    s.outcome = null;
    s.status = 'intake';
    return triage(t);
  }
  return clarifyOrTransfer(t);
}

// ---------- side replies (DESIGN 6.1, step 2) ----------

function side(t) {
  const { s, flags } = t;
  if (flags.sensitive_data && !s.sensitiveWarned) {
    add(t, 'sensitive_warning', {}, t.side);
    s.sensitiveWarned = true;
  }
  if (flags.asks_identity && !t.first) add(t, 'identity', {}, t.side);
  for (const topic of flags.admin_topics) adminReply(t, topic);
  // Fees (knowledge base 3.3, approved): no discount and no instalments, a polite no and the price
  // stays, with nothing for the team; another office's price and paying after collection are a
  // discount too (the owner's decision, 15 November). A price the office itself offered before is
  // the team's to check (3.3, the 6.16 reply).
  if (flags.price_match) {
    add(t, 'discount', {}, t.side);
    createHandoff(t, 'pricing_request');
  } else if (flags.wants_discount && !t.side.some((part) => part.id === 'admin_payment')) add(t, 'discount_declined', {}, t.side);
}

function adminReply(t, topic) {
  const { s, flags } = t;
  const unanswered = () => {
    if (!t.side.some((part) => part.id === 'no_approved_answer')) add(t, 'no_approved_answer', {}, t.side);
    createHandoff(t, 'admin_unanswered');
  };
  const simple = { hours: 'admin_hours', address: 'admin_address', contact: 'admin_contact', website: 'admin_website',
    payment: 'admin_payment', offices: 'admin_offices', consultation_credit: 'admin_consult_independent', documents_email: 'admin_documents_email' };
  if (simple[topic]) return add(t, simple[topic], {}, t.side) || unanswered();
  if (topic === 'credentials') {
    if (s.awardSent) return true;
    s.awardSent = true;
    return add(t, 'admin_credentials', {}, t.side) || unanswered();
  }
  if (topic === 'services') {
    // A service the office does not offer: the triage's apology answers it, without a promise
    // that the team will reply to the question.
    if (T.exclusion(s, t.triage) && s.phase === 'triage' && s.outcome !== 'declined') return true;
    const values0 = values(t);
    if (values0.service_name) return add(t, 'admin_service_yes', {}, t.side);
    if (flags.asked_service) return unanswered();
    return add(t, 'admin_services', {}, t.side) || unanswered();
  }
  if (topic === 'fees') {
    const card = cardOf(t);
    if (card && card.no_price) return add(t, 'fees_by_team', {}, t.side);
    // After a decline, the prices are those of what it offered: representation is not priced.
    const declined = s.outcome === 'declined' && [...s.offers].reverse().find((o) => o.reply.startsWith('decline_') && o.prices.length);
    if (declined) return add(t, declined.reply, {}, t.side);
    // The price of what is being discussed, not of a consultation: the document offered, or
    // the service and its stages (knowledge base 3.4, 3.5).
    if (card && s.phase === 'document_wait' && card.document) return add(t, card.document.reply === 'offer_labor_drafting' && s.case.case_status === 'judgment' ? 'offer_labor_objection' : card.document.reply, {}, t.side);
    const task = card && card.tasks && s.case.task_type && card.tasks[s.case.task_type];
    // An industrial design has no approved price (knowledge base 9.C): the team prices it.
    if (s.case.task_type === 'design') return add(t, 'fees_by_team', {}, t.side);
    const service = task || (card && (card.consultation_offer || card.after_questions));
    if (service && !service.reply.startsWith('consult_offer') && t.env.replies.replies[service.reply].kind !== 'question') {
      return add(t, service.reply, {}, t.side);
    }
    if (unpriced(s, card)) return add(t, 'fees_by_team', {}, t.side);
    const consultation = card ? consultationFor(t, card) : null;
    if (consultation) {
      const feesId = consultation.from ? 'fees_specialty_from' : 'fees_specialty';
      const told = add(t, feesId, { consultation_name: consultation.name, consultation_price: consultation.price }, t.side);
      if (told && !s.offers.some((o) => o.prices.includes(consultation.priceKey))) s.offers.push({ reply: feesId, prices: [consultation.priceKey] });
      return told;
    }
    if (card && (card.consultation_offer || card.tasks)) return add(t, 'fees_by_team', {}, t.side);
    return add(t, 'admin_fees', {}, t.side) || unanswered();
  }
  return unanswered();
}

// Only questions about the office, and nothing for the triage to act on.
// Booking details or an answer beside the question are acted on too.
function adminOnly(flags) {
  const x = flags.extracted;
  return flags.admin_topics.length > 0 && !flags.specialty && !flags.goal && !flags.task_type && !flags.has_legal_question
    && !flags.wants_human && !x.service_description && !namedSender(flags)
    && !x.amounts_mentioned.length && !x.dates_mentioned.length
    && !x.name && !x.preferred_time && !flags.consultation_format && !flags.yes_no && flags.answered_pending !== true;
}

// ---------- recording what the client said ----------

function inClientText(value, text) {
  const wanted = normalizeText(value);
  return wanted !== '' && normalizeText(text).includes(wanted);
}

// The extracted data, limited to what the client's text contains (DESIGN 5). Numbers the
// model computed are kept only when the words they come from are in the text.
const CURRENCY_WORD = /دولار|يورو|جنيه|درهم|دينار|ليرة|روبية|[إا]سترليني|فرنك|يوان|\$|€|£|usd|eur|gbp|aed|kwd|qar|bhd|omr|jod|egp|dollar|euro|pound|dirham|dinar|rupee|lira/i;

function grounded(extracted, text) {
  if (typeof text !== 'string') return extracted;
  const kept = { ...extracted };
  for (const field of ['name', 'city', 'other_party_name', 'phone', 'detention_place']) {
    if (kept[field] != null && !inClientText(kept[field], text)) kept[field] = null;
  }
  // Compared word by word in one writing: the digits («٣٠» and «30»), the alef forms, the ta
  // marbuta and the marks may differ; a number and a word may be joined («60ألف»); and the copy
  // may leave out a letter joined to the first word («بـ60 ألف» copied «60 ألف», «وبكرة» copied
  // «بكرة»).
  const words = (x) => toWesternDigits(String(x)).replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىی]/g, 'ي').toLowerCase()
    .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const said = words(text);
  const PROCLITICS = ['', 'و', 'ف', 'ب', 'ل', 'ك', 'وب', 'ول', 'فب', 'وال', 'بال', 'لل'];
  const within = (item) => {
    const want = words(item);
    if (!want.length) return false;
    for (let i = 0; i + want.length <= said.length; i++) {
      if (!PROCLITICS.some((p) => said[i] === p + want[0]) && !(said[i] === want[0].replace(/^[وفبلك]/, '') && want[0].length > 2)) continue;
      let j = 1;
      while (j < want.length && said[i + j] === want[j]) j++;
      if (j === want.length) return true;
    }
    return false;
  };
  for (const field of ['dates_mentioned', 'amounts_mentioned']) {
    kept[field] = (kept[field] || []).filter((item) => typeof item === 'string' && item.trim() !== '' && within(item));
  }
  if (!kept.amounts_mentioned.length) {
    // A currency said on its own («المبلغ بالدولار مو بالريال») is about the amount already stated:
    // it is kept, with no number of its own, when the text names a currency.
    const namesCurrency = kept.amount_currency === 'other' && kept.amount_foreign_code && CURRENCY_WORD.test(String(text));
    kept.amount_min_sar = null;
    kept.amount_max_sar = null;
    kept.amount_foreign_min = null;
    kept.amount_foreign_max = null;
    if (!namesCurrency) {
      kept.amount_currency = null;
      kept.amount_foreign_code = null;
    }
  }
  if (!kept.dates_mentioned.length) {
    kept.event_days_until = null;
    kept.employment_end_months_ago = null;
  }
  return kept;
}

// A subject other than the case's, after the case left its questions: a second matter, not a
// correction of the first (DESIGN 6.5.1).
// During the questions, another subject is a second matter once the first has facts of its
// own (a question answered, an amount); before that it corrects the first.
// A legal request without its subject named («عندي موضوع ثاني») is another matter too once the
// case has left its questions; during them it says nothing new about the case.
function isNewMatter(s, flags) {
  if (!flags.specialty || !s.case.specialty || s.case.specialty === 'general' || flags.specialty === s.case.specialty) return false;
  if (flags.specialty === 'general') return s.phase !== 'triage';
  return s.phase !== 'triage' || s.asked.length > 0 || s.case.amount_min !== null || s.case.amount_max !== null;
}

// A first matter left in the middle of its questions, that its card would not decline: the client
// moved on, and nothing else would bring it to the staff (knowledge base 1.10, criterion 58).
function unfinishedNeedsTeam(t) {
  const { s } = t;
  const card = cardOf(t);
  if (s.phase !== 'triage' || s.outcome !== null || !card || s.case.specialty === 'general') return false;
  return !T.cardDecision(s, card, t.triage).decline;
}

// A matter for the staff, who already have the conversation, with its own facts; an urgent sign
// in it makes their request urgent (knowledge base 1.7). The same subject again, or facts with no
// subject right after it, are added to it: nothing is written over the first matter.
function noteMatter(t, index = null) {
  const { s, flags } = t;
  const x = flags.extracted;
  let i = index;
  if (i === null) i = s.matters.findIndex((m) => m.noted && m.specialty === flags.specialty);
  if (i === -1) i = s.matters.findIndex((m) => m.noted && m.specialty === 'general');
  if (i === -1) {
    s.matters.push({ specialty: flags.specialty, outcome: null, reasons: [], urgent: false, amounts: [], dates: [], noted: true });
    i = s.matters.length - 1;
  }
  const m = s.matters[i];
  if (flags.specialty && m.specialty === 'general') m.specialty = flags.specialty;
  for (const item of x.amounts_mentioned) if (!m.amounts.includes(item)) m.amounts.push(item);
  for (const item of x.dates_mentioned) if (!m.dates.includes(item)) m.dates.push(item);
  if (!s.reasons.includes('new_matter')) s.reasons.push('new_matter');
  const urgent = T.urgency({ ...s, case: { ...caseOf(t), specialty: m.specialty } }, t.triage);
  if (urgent && !m.urgent) {
    m.urgent = true;
    m.reasons.push(urgent);
    s.priority = 'urgent';
    if (!s.reasons.includes(urgent)) s.reasons.push(urgent);
    markUrgent(t);
    t.newMatterUrgent = true;
  }
  s.noted = { index: i, at: t.input.at };
  t.newMatter = 'noted';
}

// Facts with no subject, in the message right after a matter was noted: they are about it.
function aboutNoted(t) {
  const { s, flags } = t;
  return Boolean(s.noted && s.noted.at === t.previousClientAt && s.matters[s.noted.index] && !flags.specialty && caseFacts(flags));
}

// The case fields of one message, on a case of their own: to judge a second matter's urgency
// without writing it over the first.
function caseOf(t) {
  const c = { ...createState().case, specialty: t.flags.specialty };
  for (const [key, [part, field]] of Object.entries(EXTRACTED)) {
    const value = t.flags.extracted[key];
    if (part === 'case' && value !== null && value !== undefined && value !== '') c[field] = value;
  }
  return c;
}

// The first matter is kept for the staff, with its amounts, dates, files and offers, and the new
// one starts its own triage with nothing of the first. A new session (a week later) also has its
// own message budget.
function startMatter(t, { unfinished = false, newSession = false } = {}) {
  const { s } = t;
  s.matters.push({ specialty: s.case.specialty, outcome: s.outcome, reasons: unfinished ? [...s.reasons, 'unfinished_matter'] : [...s.reasons],
    amounts: [...s.facts.amounts], dates: [...s.facts.dates], documents: [...s.facts.documents], offers: [...s.offers] });
  s.facts = createState().facts;
  s.case = createState().case;
  for (const field of ['client_role', 'parties', 'service_description', 'desired_outcome', 'stage', 'file_reference', 'other_party',
    'preferred_time', 'consultation_format']) s.known[field] = null;
  Object.assign(s, { asked: [], answered: [], lastAsked: [], askAgain: [], reasked: [], explained: [], questionCount: 0, followupMessages: 0, amountRefused: false,
    offered: null, outcome: null, reasons: [], priority: 'normal', phase: 'triage', status: 'intake', clarifyAttempts: 0, legalOffered: false,
    offers: [], noted: null });
  if (newSession) s.sentCount = 0;
  if (['job', 'training', 'marketing'].includes(s.sender)) s.sender = null;
  // The paid consultation for a legal question, and "your request is with the team", are said
  // once per matter: the new one has its own subject and price.
  for (const id of ['legal_offer', 'legal_offer_from', 'legal_offer_generic', 'waiting']) delete s.used[id];
}

function record(t) {
  const { s, flags } = t;
  // An amount in another currency is kept in riyals at the day's rate, as the threshold reads it
  // (knowledge base 4.4); how it was converted, or why it could not be, is kept for the record.
  // A currency said on its own is about the amount already stated in riyals.
  const x0 = flags.extracted;
  const alone = x0.amount_currency === 'other' && x0.amount_foreign_code && !x0.amounts_mentioned.length && s.case.currency !== 'other'
    && (s.case.amount_min !== null || s.case.amount_max !== null);
  const money = convertAmount(alone ? { ...x0, amount_foreign_min: s.case.amount_min, amount_foreign_max: s.case.amount_max } : x0, t.triage, t.env.rates);
  const extracted = money ? { ...flags.extracted, amount_min_sar: money.min, amount_max_sar: money.max } : flags.extracted;
  s.matters ||= [];
  if (aboutNoted(t)) return noteMatter(t, s.noted.index);
  if (isNewMatter(s, flags)) {
    // The staff already have the conversation (a request, an employee, or a close they made): the
    // new matter is noted for them, and an employee's client is never screened again (criterion 34).
    if (s.handoff || ['closed', 'with_staff'].includes(s.status)) return noteMatter(t);
    const unfinished = unfinishedNeedsTeam(t);
    startMatter(t, { unfinished });
    if (unfinished) createHandoff(t, 'unfinished_matter');
    t.newMatter = 'started';
  }
  // A corrected amount: the earlier one stays in the record, marked as said before.
  const amountChanged = extracted.amounts_mentioned.length && (extracted.amount_min_sar !== null || extracted.amount_max_sar !== null)
    && (s.case.amount_min !== null || s.case.amount_max !== null)
    && (extracted.amount_min_sar !== s.case.amount_min || extracted.amount_max_sar !== s.case.amount_max);
  if (amountChanged) {
    s.facts.earlierAmounts = [...(s.facts.earlierAmounts || []), ...s.facts.amounts.filter((a) => !extracted.amounts_mentioned.includes(a))];
    s.facts.amounts = [];
  }
  // An amount stated again replaces both bounds: «أكثر من 200 ألف» after «50 ألف» has no top.
  if (extracted.amounts_mentioned.length && (extracted.amount_min_sar !== null || extracted.amount_max_sar !== null)) {
    s.case.amount_min = null;
    s.case.amount_max = null;
  }
  for (const [key, [part, field]] of Object.entries(EXTRACTED)) {
    const value = extracted[key];
    if (value === null || value === undefined || value === '') continue;
    s[part][field] = value;
  }
  // A dismissal, or a contract that ended at its term, is the end of the work, whether or not the
  // model said so too: the client is then asked when it ended, not whether it goes on.
  if (s.case.employment_ongoing === null && (s.case.dismissed === true || s.case.contract_expired === true)) s.case.employment_ongoing = false;
  if (extracted.amount_currency) s.facts.conversion = money ? money.conversion : null;
  // «لا» to whether the date matches the contract's or the notice's: the date is disputed (4.3).
  if (s.lastAsked.includes('q_labor_confirm_end') && flags.yes_no === 'no') s.case.employment_end_disputed = true;
  else if (extracted.employment_end_needs_confirmation === false) s.case.employment_end_disputed = null;
  if (extracted.service_description && !s.known.service_description) s.known.service_description = extracted.service_description;
  // A date's distance counts from when it was said (onClientInput brings it up to date).
  if (extracted.event_days_until !== null && extracted.event_days_until !== undefined) s.case.event_at = t.input.at + extracted.event_days_until * 86400;
  for (const item of extracted.dates_mentioned) if (!s.facts.dates.includes(item)) s.facts.dates.push(item);
  for (const item of extracted.amounts_mentioned) if (!s.facts.amounts.includes(item)) s.facts.amounts.push(item);
  for (const item of extracted.documents || []) if (!s.facts.documents.includes(item)) s.facts.documents.push(item);
  // What the client wrote, in his words, for the record's summary of the facts (knowledge base 7:
  // three lines at most): his first messages with something to act on.
  // An answer to the questions just asked is kept with them, so that the team asks none again.
  s.facts.said ||= [];
  s.facts.answers ||= [];
  // A message in which the client sent a code or a number to identify himself keeps none of its
  // short numbers for the record, named or not (knowledge base 1.5, 7).
  const written = typeof t.input.text === 'string' ? t.input.text.trim() : '';
  const text = flags.sensitive_data ? redact(written, { strict: true }) : written;
  const answering = s.lastAsked.length > 0 && (flags.answered_pending === true || (flags.answered_questions || []).length > 0);
  if (text && answering && s.facts.answers.length < t.triage.limits.max_questions) {
    s.facts.answers.push({ asked: [...s.lastAsked], text: text.slice(0, 300) });
  } else if (text && (caseFacts(flags) || flags.has_legal_question || flags.goal || ['job', 'training'].includes(flags.sender) || ['job', 'training'].includes(s.sender)) && s.facts.said.length < 3) {
    s.facts.said.push(text.slice(0, 300));
  }
  // A specific subject is not overwritten by "general", nor a new client made an existing one in
  // the middle of the questions without a file or a follow-up (the model may guess).
  if (flags.specialty && !(flags.specialty === 'general' && s.case.specialty)) s.case.specialty = flags.specialty;
  if (flags.goal) s.case.goal = flags.goal;
  if (flags.task_type) s.case.task_type = flags.task_type;
  if (flags.complex_matter) s.case.complex_matter = true;
  if (flags.consultation_format) s.known.consultation_format = flags.consultation_format;
  if (flags.injection_attempt) s.injection = true;
  const midway = s.asked.length > 0 && flags.sender === 'existing_client' && !extracted.file_reference && flags.goal !== 'follow_up';
  if (midway) t.senderIgnored = true;
  if (['existing_client', 'job', 'training'].includes(flags.sender) && !s.sender && !midway) s.sender = flags.sender;
  const catalog = t.triage.questions;
  // The reading of the reply (ai/prompts/turn.md), when the server asked for one.
  const read = turnOf(t);
  for (const id of flags.answered_questions || []) {
    if (!Object.hasOwn(catalog, id) || s.answered.includes(id)) continue;
    // A question the reading calls unanswered is not answered because the tagging marked it.
    if (read && s.lastAsked.includes(id) && ['not_answered', 'partly'].includes(read.status[id])) continue;
    // A question whose answer is a field (its `known` fields in config/triage.json) is answered
    // when the field is known, and the triage sees that for itself. The model's mark alone, with
    // the field still unknown, does not skip a question that was not the one asked: a model that
    // marks what the client did not say would make the assistant skip its questions (seen on 16
    // November 2026: «فصلوني» marked as answering when the work ended, and a claim's parties,
    // earlier procedure and items marked with nothing said about them).
    if (!s.lastAsked.includes(id) && T.fieldMissing(s, id, t.triage)) continue;
    // A question about several dates (`dates` in config/triage.json: when the judgment was
    // issued and when it was served) is not answered by a message that names fewer («الحكم صدر
    // أمس» says nothing of the day it was served).
    if (!s.lastAsked.includes(id) && catalog[id].dates && (extracted.dates_mentioned || []).length < catalog[id].dates) continue;
    s.answered.push(id);
  }
  // The reading of the reply: a question it calls answered is answered, also when the tagging did
  // not mark it (a question whose answer is a field still needs the field); a refusal and «برد
  // عليكم» count as the tagging's own.
  if (read) {
    for (const id of s.lastAsked) {
      if (!Object.hasOwn(catalog, id)) continue;
      const fielded = Boolean(catalog[id].known || catalog[id].known_all);
      if (read.status[id] === 'answered' && !s.answered.includes(id) && !(fielded && T.fieldMissing(s, id, t.triage))) s.answered.push(id);
      if (read.status[id] === 'refused') flags.refused_pending = true;
    }
    const told = s.lastAsked.map((id) => read.status[id]).filter(Boolean);
    if (told.length && told.every((status) => status === 'later')) flags.will_reply_later = true;
  }
  if (flags.refused_pending && s.lastAsked.some((id) => (catalog[id] && catalog[id].known || []).includes('amount'))) {
    s.amountRefused = true;
  }
  // A question the path depends on ("again" in config/triage.json: when the work ended), asked
  // with another in one message and left without its answer by a reply that answered the other,
  // is asked once more, alone. The assistant does not go on with half an answer (the project
  // owner's decision of 16 November 2026), and a question is not repeated more than once
  // (knowledge base 1.4). A client who refused, or answered nothing of the message, is not asked again.
  for (const [id, question] of Object.entries(catalog)) {
    if (!question.again || (s.reasked || []).includes(id) || (s.askAgain || []).includes(id)) continue;
    const form = s.lastAsked.includes(id) ? id : (question.short && s.lastAsked.includes(question.short.id) ? question.short.id : null);
    if (!form || flags.refused_pending || !T.fieldMissing(s, id, t.triage)) continue;
    const others = s.lastAsked.filter((other) => other !== form);
    const answeredOther = others.some((other) => s.answered.includes(other)
      || ((catalog[other].known || catalog[other].known_all) && !T.fieldMissing(s, other, t.triage)));
    if (answeredOther) (s.askAgain ||= []).push(id);
  }
}

// ---------- one input ----------

// A client who comes back a week after the conversation ended starts afresh: the earlier matter
// stays in the record (spec criterion 58).
const NEW_SESSION_SECONDS = 7 * 86400;

function onClientInput(t) {
  const { s, input } = t;
  const understood = input.type === 'text' || input.type === 'voice';
  t.flags = understood ? normalizeFlags(input.flags || {}) : normalizeFlags({});
  t.greeting = understood ? t.flags.greeting : input.greeting;
  s.matters ||= [];
  t.previousClientAt = s.lastClientAt;
  t.senderBefore = s.sender;
  t.specialtyBefore = s.case.specialty;
  // A week after the last message, with nothing open for the staff, once the matter reached a step
  // (an offer, a decline, a CV request, an end): a new session. In the middle of the questions the
  // timer has already given the staff the request.
  const idle = s.lastClientAt !== null && input.at - s.lastClientAt >= NEW_SESSION_SECONDS;
  const reached = s.phase !== 'triage' || s.outcome !== null;
  if (idle && reached && !s.handoff && !['with_staff', 'closed'].includes(s.status) && (s.case.specialty || s.outcome || s.sender)) startMatter(t, { newSession: true });
  s.lastClientAt = input.at;
  // A date said days ago is nearer now: the distance is counted from when it was said.
  // It drops only after a full day: «بعد 4 أيام» is still four days in the next message.
  if (s.case.event_at !== null && s.case.event_at !== undefined) s.case.event_days_until = Math.ceil((s.case.event_at - input.at) / 86400) || 0;
  if (understood) {
    s.attachmentsInRow = 0;
    s.lang = updateLanguage(s.lang, t.flags);
    t.flags.extracted = grounded(t.flags.extracted, input.text);
    // A caption came with an image or a document: the file is noted for the staff.
    if (input.attachment && !s.facts.documents.includes(input.attachment)) s.facts.documents.push(input.attachment);
    record(t);
    // The priority follows the facts, whatever the client asks for next (knowledge base 1.7); a
    // prison outside Riyadh is declined even when urgent.
    const wasUrgent = s.priority === 'urgent';
    const urgent = T.exclusion(s, t.triage) === 'prison_outside_riyadh' ? null : T.urgency(s, t.triage);
    if (urgent) {
      s.priority = 'urgent';
      if (!s.reasons.includes(urgent)) s.reasons.push(urgent);
      markUrgent(t);
      if (!wasUrgent) t.newUrgency = urgent;
    }
  } else if (input.type === 'model_failed') {
    s.lang = updateLanguage(s.lang, { language: input.language });
  } else if (!s.facts.documents.includes(input.type)) {
    s.facts.documents.push(input.type);
  }
  if (s.handoff) {
    s.handoff.updates += 1;
    t.events.push({ type: 'handoff_updated' });
  }
  const blocked = { s: structuredClone(s), input: t.input, events: [...t.events] };

  t.version = pickVersion(s.lang);
  t.first = !s.firstReplyDone;
  const officeName = values(t).office_name;
  if (officeName === null) throw new Error('handle: profile.office_name is missing');
  t.greetingPart = greetingPart(t.env.replies, t.greeting, t.version);

  if (s.status === 'closed') onClosed(t);
  else if (s.status !== 'with_staff') {
    if (input.type === 'model_failed') onModelFailed(t);
    else if (!understood) onAttachment(t);
    else if (input.type === 'voice' && input.audioUnclear === true) onUnclearVoice(t);
    else onMessage(t);
  }
  // A reply that asks nothing leaves no question pending: a later message is not its answer.
  if (t.body.length && !t.askedNow) s.lastAsked = [];
  return compose(t, blocked);
}

function onMessage(t) {
  const { s, flags } = t;
  side(t);
  // An urgent sign beside the question («أخوي موقوف، ممكن رقم للتواصل؟») is acted on too.
  if (adminOnly(flags) && s.phase !== 'booking' && !t.newUrgency) {
    // He asked about the office in the middle of the questions: he is answered, and the question
    // he was asked comes back with the answer, once (the owner's decision of 16 November 2026:
    // «العميل سأل على حاجة فأرد وأرجع تاني»).
    if (s.phase === 'triage' && t.side.length && !s.handoff) backToQuestion(t);
    return true;
  }
  // A second matter: its own triage, or, with the staff already on the first, their request.
  if (t.newMatter === 'started') return triage(t);
  if (t.newMatter === 'noted') return (t.newMatterUrgent ? add(t, 'referred_urgent') : add(t, 'waiting')) || silent(t, 'new_matter') || true;
  // At any later stage, a request for a person and a new urgent sign go to the staff at once
  // (knowledge base 1.7, 1.11). The triage handles both in its own order; after a document
  // offer the next message is referred anyway, urgent when it is.
  if (!['triage', 'cv_wait', 'document_wait'].includes(s.phase)) {
    if (flags.wants_human) return humanRequest(t);
    if (t.newUrgency) {
      s.phase = 'triage';
      s.offered = null;
      return onUrgent(t, t.newUrgency);
    }
    // A job or training request after a legal matter's triage is a matter of its own (5.16).
    if (['job', 'training'].includes(flags.sender) && !['job', 'training'].includes(t.senderBefore) && !s.handoff) {
      if (s.case.specialty || s.outcome) startMatter(t);
      return triage(t);
    }
  }
  switch (s.phase) {
    case 'offered': return offered(t);
    case 'booking': return booking(t);
    case 'document_wait': return documentWait(t);
    case 'cv_wait': return cvWait(t);
    case 'done': return done(t);
    default:
      if (flags.courtesy_only && !hasSubstance(flags)) return t.first ? true : closingOrNothing(t);
      // «خلني أشوف الأوراق وأرد عليك» in the middle of the questions: one polite word. No question is
      // asked twice (criterion 48), and the timer gives the staff what was gathered (criterion 49).
      // «ما أعرف» is not that: the triage goes on without the answer (knowledge base 1.4, 1.11: an
      // estimate of the amount once, then the referral; any other question is not asked again).
      if (!t.first && s.lastAsked.length && !hasSubstance(flags) && !anyExtracted(flags) && !flags.is_unclear && !flags.refused_pending
        && !flags.closing && !(flags.answered_questions || []).length && (t.side.length || flags.will_reply_later)) return t.side.length ? true : deferral(t);
      return triage(t);
  }
}

function onAttachment(t) {
  const { s, input } = t;
  s.attachmentsInRow = (s.attachmentsInRow || 0) + 1;
  // A CV, in one file or several: one acknowledgement.
  if (s.phase === 'cv_wait' || s.sender === 'job' || s.sender === 'training') {
    // The files after the one already acknowledged are quiet; one still awaited (the PDF asked for
    // after a photo) is received.
    return s.attachmentsInRow >= 2 && s.outcome === 'cv' && s.phase !== 'cv_wait' ? true : cvReceived(t);
  }
  // One acknowledgement for a burst of files; the next ones go to the staff quietly.
  if (s.attachmentsInRow >= 2 && s.phase !== 'document_wait') {
    createHandoff(t, 'attachments');
    if (s.phase === 'done') s.status = 'waiting';
    return true;
  }
  add(t, input.type === 'image' ? 'image_received' : 'doc_received');
  // The file a document request waits for: the request goes to the team.
  if (s.phase === 'document_wait') return documentWait(t);
  if (s.phase === 'triage' && !s.case.specialty && !s.used.media_unclear) return add(t, 'media_unclear');
  // The reply says the team will look at the file. Where no triage is going to bring it to them
  // (after the end or an offer), or files keep coming without a word, they get a request.
  if (s.phase !== 'triage' || s.attachmentsInRow >= 2) {
    createHandoff(t, 'attachments');
    if (s.phase === 'done') s.status = 'waiting';
  }
  return true;
}

function onUnclearVoice(t) {
  side(t);
  return clarifyOrTransfer(t);
}

function onModelFailed(t) {
  // The staff already have the request: it keeps its outcome, and they see the new message.
  if (t.s.handoff) return add(t, 'waiting') || silent(t, 'model_failed') || true;
  add(t, 'transfer_unclear');
  finish(t, 'referred', 'model_failed');
  return true;
}

function onClosed(t) {
  const { s } = t;
  if (s.closedOutcome === 'existing_client') return true;
  s.closedOutcome = null;
  add(t, 'returning');
  s.outcome = 'follow_up';
  s.phase = 'done';
  createHandoff(t, 'returning');
  s.status = 'waiting';
  return true;
}

// Builds the one message of this input: [greeting][welcome][side replies][step][note].
function compose(t, blocked) {
  const { s, input, env } = t;
  const parts = [];
  if (t.greetingPart && (t.side.length || t.body.length || t.first || t.flags.courtesy_only)) parts.push(t.greetingPart);
  if (t.first && s.status !== 'with_staff' && !(s.status === 'closed' && s.closedOutcome === 'existing_client')) {
    const full = t.body.length === 0 && t.side.length === 0;
    if (full || !t.body.some((part) => part.id === 'returning')) add(t, full ? 'welcome_full' : 'welcome_short', {}, parts);
  }
  // A reply that states its price: the answer to "how much" would say it twice.
  const priced = (part) => /^(consult_offer|consult_price|legal_offer|fees_|admin_fees)/.test(part.id)
    || (Object.hasOwn(env.replies.replies, part.id) && pricesIn(t, part.id).length > 0);
  const offersPrice = t.body.some((part) => priced(part) && !/^(fees_|admin_fees)/.test(part.id));
  parts.push(...(offersPrice ? t.side.filter((part) => !priced(part)) : t.side), ...t.body);
  if (input.outOfHours && parts.some((part) => CONTACT_PROMISES.includes(part.id))) add(t, 'out_of_hours', {}, parts);

  const messages = parts.length ? [buildMessage(parts, t.version, env.replies)] : [];
  if (messages.length && s.sentCount + messages.length > limitsOf(env).max_bot_messages) {
    // Message cap: nothing is sent and the staff get the conversation.
    const capped = { s: blocked.s, input, events: blocked.events, env };
    createHandoff(capped, 'reply_cap', capped.s.priority === 'urgent');
    capped.s.phase = 'done';
    capped.s.status = 'waiting';
    capped.events.push({ type: 'silent', reason: 'reply_cap' });
    return { state: capped.s, messages: [], events: capped.events };
  }
  if (messages.length) {
    s.firstReplyDone = true;
    s.sentCount += messages.length;
  }
  return { state: s, messages, events: t.events };
}

// ---------- staff events and the timer ----------

// The client stopped answering (DESIGN 6.5.2): during the questions about something to act on, as
// an existing client before giving the file, or in the middle of a booking or a document request.
function onTimer(t) {
  const { s, input, env } = t;
  const minutes = (t.triage.limits && t.triage.limits.abandoned_minutes) || limitsOf(env).abandoned_minutes;
  if (s.handoff || !s.firstReplyDone || s.lastClientAt === null || input.at - s.lastClientAt < minutes * 60) return;
  if (s.phase === 'triage' && s.sender === 'existing_client') createHandoff(t, 'follow_up');
  else if (s.phase === 'triage' && (s.case.specialty || s.known.service_description)) createHandoff(t, 'abandoned');
  else if (s.phase === 'booking') createHandoff(t, 'booking_incomplete');
  else if (s.phase === 'document_wait') createHandoff(t, 'document_pending');
  // A file with nothing said about it: the reply told the client the team will look at it
  // (knowledge base 1.5: never without a request), so the team gets it.
  else if (s.phase === 'triage' && s.facts.documents.some((d) => d === 'image' || d === 'document')) createHandoff(t, 'attachments');
}

function handle(state, input, env) {
  const s = structuredClone(state);
  const t = { s, input, env, triage: env.triage || loadTriage(), messages: [], events: [], body: [], side: [] };
  switch (input.type) {
    case 'staff_takeover':
      s.status = 'with_staff';
      s.everWithStaff = true;
      break;
    case 'staff_reactivate':
      // A client an employee already handled is never screened again (spec criterion 34).
      if (s.everWithStaff) {
        s.status = 'closed';
        s.handoff = null;
      } else {
        s.status = s.phase === 'done' ? (s.handoff ? 'waiting' : 'done') : 'intake';
      }
      s.closedOutcome = null;
      break;
    case 'staff_return':
      // An employee gives the conversation back to the assistant («إرجاع للرد الذكي»; the project
      // owner's decision of 16 November 2026): the request for the staff is withdrawn and the
      // triage goes on from what is known, the questions already asked not asked again. Unlike
      // staff_reactivate, it lifts the rule that a client an employee handled is not screened
      // again (spec criterion 34): the employee chose it.
      s.status = 'intake';
      s.phase = 'triage';
      s.handoff = null;
      s.outcome = null;
      s.closedOutcome = null;
      s.offered = null;
      s.priority = 'normal';
      s.reasons = [];
      s.everWithStaff = false;
      s.clarifyAttempts = 0;
      break;
    case 'staff_close':
    case 'idle_expired':
      s.status = 'closed';
      s.closedOutcome = input.type === 'staff_close' ? input.outcome || null : null;
      s.handoff = null;
      break;
    case 'timer':
      onTimer(t);
      break;
    default:
      if (!CLIENT_INPUTS.includes(input.type)) throw new Error(`handle: unknown input type "${input.type}"`);
      return onClientInput(t);
  }
  return { state: s, messages: [], events: t.events };
}

module.exports = { createState, handle };
