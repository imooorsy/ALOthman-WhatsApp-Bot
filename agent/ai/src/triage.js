'use strict';

// Pure triage decisions (ai/DESIGN.md sections 6.3 and 6.4). They read the conversation
// state and config/triage.json, and never change either.

const URGENT_EVENTS = ['hearing', 'investigation', 'objection_deadline', 'limitation', 'general_assembly', 'auction', 'reply_deadline'];

const isSet = (value) => value !== null && value !== undefined && value !== '';

// One field of what is known about the conversation, wherever it is kept.
function fieldValue(s, field) {
  if (field === 'amount') {
    const c = s.case;
    return isSet(c.amount_min) || isSet(c.amount_max) || c.currency === 'other' ? true : null;
  }
  if (Object.hasOwn(s.case, field)) return s.case[field];
  if (Object.hasOwn(s.known, field)) return s.known[field];
  return null;
}

// Why the request is urgent, or null.
function urgency(s, triage) {
  const c = s.case;
  const days = triage.limits.urgent_days;
  if (c.detained === true && c.in_riyadh !== false) return 'detained';
  const near = isSet(c.event_days_until) && c.event_days_until >= 0 && c.event_days_until <= days;
  if (URGENT_EVENTS.includes(c.event_kind) && near) return 'deadline_72h';
  if (c.urgent_said === true && near) return 'deadline_72h';
  // An issued judgment, for its objection deadline; enforcing a judgment is not urgent (A.12).
  // A final judgment with nothing left to do has no deadline (knowledge base 2.1).
  if (c.case_status === 'judgment' && c.specialty !== 'enforcement' && c.final_judgment_nothing_left !== true
    && !(isSet(c.event_days_until) && c.event_days_until > days)) return 'judgment';
  if (c.specialty === 'labor' && timeRuleApplies(s) && laborTime(s, triage) === 'review') return 'labor_time_review';
  return null;
}

// The 12-month rule is about a worker's new claim (knowledge base 4.3): not a claim of the
// employer, and not a case already filed or judged.
function timeRuleApplies(s) {
  return !['existing', 'judgment'].includes(s.case.case_status) && s.known.client_role !== 'employer' && s.known.client_type !== 'company'
    && s.case.monetary !== false;
}

// The exclusion that applies (a key of triage.excluded), "ambiguous_party", or null.
function exclusion(s, triage) {
  const c = s.case;
  if (c.detained === true && c.in_riyadh === false) return 'prison_outside_riyadh';
  if (c.specialty && Object.hasOwn(triage.excluded, c.specialty)) return c.specialty;
  // A tax, zakat or customs dispute is always against the authority: it is the tax card (5.3).
  if (c.government_party === true && c.specialty !== 'tax') return c.state_owned_company === true ? 'ambiguous_party' : 'government_admin';
  if (c.domestic_worker === true) return 'domestic_labor';
  if (c.case_outside_ksa === true) return 'foreign_case';
  if (c.final_judgment_nothing_left === true) return 'finished_case';
  if (c.specialty === 'enforcement' && c.enforcement_exhausted === true) return 'enforcement_exhausted';
  return null;
}

// Labour time rule (knowledge base 4.3): ok | review | over | unknown.
function laborTime(s, triage) {
  const c = s.case;
  const L = triage.limits;
  if (c.employment_ongoing === true) return 'ok';
  if (!isSet(c.employment_end_months_ago)) return 'unknown';
  const months = c.employment_end_months_ago;
  if (months < L.labor_review_from_months) return 'ok';
  if (months <= L.labor_review_to_months) return 'review';
  return 'over';
}

// The amount against a threshold: below | above | straddle | unknown | other_currency.
// An open bound keeps its meaning (understand.md section 9): «أقل من X» is only a top, X
// itself excluded, and «أكثر من X» only a floor. A bound that leaves both sides possible
// crosses the threshold.
// An amount in another currency is judged in riyals at the day's rate (knowledge base 4.4,
// ai/src/currency.js). Not converted (the currency unclear, no rate of the day), or within the
// margin of the threshold, where the rate itself would decide: other_currency, for the team.
function amountAgainst(s, threshold, triage = null) {
  const c = s.case;
  if (c.currency === 'other') {
    const conversion = s.facts && s.facts.conversion;
    if (!conversion || !conversion.rate) return 'other_currency';
    const margin = (triage && triage.currencies && triage.currencies.margin) || 0;
    const near = (value) => isSet(value) && Math.abs(value - threshold) < threshold * margin;
    if (near(c.amount_min) || near(c.amount_max)) return 'other_currency';
  }
  const hasMin = isSet(c.amount_min);
  const hasMax = isSet(c.amount_max);
  if (!hasMin && !hasMax) return 'unknown';
  if (hasMin && hasMax) {
    if (c.amount_max < threshold) return 'below';
    if (c.amount_min >= threshold) return 'above';
    return 'straddle';
  }
  if (hasMax) return c.amount_max <= threshold ? 'below' : 'straddle';
  return c.amount_min >= threshold ? 'above' : 'straddle';
}

// Whether a card's threshold decides this request.
function thresholdApplies(s, card) {
  if (!card.threshold) return false;
  // Buying property as a foreigner is not a claim (knowledge base 5.6).
  if (card.foreign_buyer_quote && s.case.foreign_buyer === true) return false;
  if (card.monetary_only && s.case.monetary === false) return false;
  if (card.notes_only && s.case.enforcement_kind !== 'note') return false;
  return true;
}

// The question lists of the conversation: the case overlay, or the card's own. A card with its
// own stage questions (criminal) keeps them for a case already open.
function questionLists(s, card, triage) {
  const overlay = !card.no_overlay && s.case.case_status && triage.case_overlays[s.case.case_status];
  return overlay ? { first: overlay.first, followups: overlay.followups } : { first: card.first, followups: card.followups };
}

// The form a question is asked in: its short one when the part it leaves out is already known
// ("short" in config/triage.json). A client who said he was dismissed is asked «متى انتهت علاقة
// العمل رسميًا؟», not whether the work goes on (knowledge base 1.11: only what is missing is asked).
function formOf(s, id, triage) {
  const short = triage.questions[id] && triage.questions[id].short;
  return short && isSet(fieldValue(s, short.known)) ? short.id : id;
}

// Whether a question's answer is a field the conversation holds (`known`, `known_all`) and that
// field is still unknown. Such a question is answered when its field is known, which
// questionApplies sees for itself; the model's mark on it, with nothing in the field, is no
// answer to a question that was not asked (ai/src/flow.js, where the marks are read).
function fieldMissing(s, id, triage) {
  const question = triage.questions[id];
  if (!question || (!question.known && !question.known_all)) return false;
  if (question.known && question.known.some((field) => isSet(fieldValue(s, field)))) return false;
  // As in questionApplies: the fields answer the question only for the values of known_all_if
  // (a deadline's day says nothing of the day the decision was served, knowledge base 1.7).
  const enough = !question.known_all_if || question.known_all_if.in.includes(fieldValue(s, question.known_all_if.field));
  if (question.known_all && enough && question.known_all.every((field) => isSet(fieldValue(s, field)))) return false;
  return true;
}

function questionApplies(s, id, triage, force = false) {
  const question = triage.questions[id];
  if (!question) return false;
  // again: a question the path depends on, left without its answer by a reply that answered what
  // was asked with it, is asked once more (ai/src/flow.js, where the client's reply is recorded).
  // force: whether the question would still be due had it not been asked (ai/src/flow.js asks it
  // again when the client's reply left it unanswered).
  const again = force || (s.askAgain || []).includes(id);
  if (!again && (s.asked.includes(id) || s.answered.includes(id))) return false;
  // Its short form (without what is already known) was asked or answered instead.
  if (!again && question.short && (s.asked.includes(question.short.id) || s.answered.includes(question.short.id))) return false;
  if (question.known && question.known.some((field) => isSet(fieldValue(s, field)))) return false;
  // known_all_if: the fields known are enough only for these values (a deadline still has its
  // notice date to ask, knowledge base 1.7).
  const enough = !question.known_all_if || question.known_all_if.in.includes(fieldValue(s, question.known_all_if.field));
  if (question.known_all && enough && question.known_all.every((field) => isSet(fieldValue(s, field)))) return false;
  const when = question.when;
  if (when) {
    const value = fieldValue(s, when.field);
    if (Object.hasOwn(when, 'is') && value !== when.is) return false;
    if (Object.hasOwn(when, 'not') && value === when.not) return false;
  }
  // unless: what the client said leaves the question without a subject (a contract that ended
  // at its term has no remaining time to ask about).
  if (question.unless && fieldValue(s, question.unless.field) === question.unless.is) return false;
  // at_least: asked only from this value on. An approximate date is confirmed when it is near the
  // 12-month limit (knowledge base 4.3); «الشهر اللي فات» is confirmed by nobody.
  if (question.at_least && !(Number(fieldValue(s, question.at_least.field)) >= question.at_least.value)) return false;
  return true;
}

// The next questions to send in one message, or null: at most questions_per_message
// questions (by their "q" count), within the conversation's question budget and the
// card's follow-up message budget. `lead` is true for the card's first message.
function nextQuestions(s, card, triage) {
  const L = triage.limits;
  const lists = questionLists(s, card, triage);
  // A question whose part is already known is asked in its short form ("short" in triage.json).
  const shortOf = (id) => formOf(s, id, triage);
  const inFirst = (id) => lists.first.includes(id) || lists.first.some((first) => shortOf(first) === id);
  const pending = [...lists.first, ...lists.followups].filter((id) => questionApplies(s, id, triage)).map(shortOf);
  // The card's first questions go together in one message, as the firm asks them (4.2).
  const first = pending.filter(inFirst);
  if (first.length) {
    const ids = [];
    let count = 0;
    for (const id of first) {
      const q = triage.questions[id].q;
      // The conversation's budget counts questions, a compound one once, as the knowledge base
      // counts its own (1.11, 4.5); a message's room counts their parts.
      if (s.questionCount + ids.length + 1 > L.max_questions) break;
      ids.push(id);
      count += q;
    }
    if (ids.length) return { ids, count, lead: !s.leadSent, followup: false };
  }
  const ids = [];
  let count = 0;
  for (const id of pending) {
    const q = triage.questions[id].q;
    if (s.questionCount + ids.length + 1 > L.max_questions) break;
    if (ids.length > 0 && count + q > L.questions_per_message) break;
    ids.push(id);
    count += q;
    if (count >= L.questions_per_message) break;
  }
  if (ids.length === 0) return null;
  const followup = ids.some((id) => !inFirst(id));
  if (followup && !ids.some(inFirst) && s.followupMessages >= L.max_followup_messages) return null;
  return { ids, count, lead: !s.leadSent && ids.some(inFirst), followup };
}

// Did the conversation already ask a question whose answer is the amount, or did the client
// already answer it without giving one ("ما أعرف كم المبلغ")?
function amountAsked(s, triage) {
  return [...s.asked, ...s.answered].some((id) => (triage.questions[id] && triage.questions[id].known || []).includes('amount'));
}

// The card's next action for a request whose goal is representation or not stated
// (DESIGN 6.4). Returns one of:
//   { ask: [ids], lead, followup }  { decline: reply, options, reason }
//   { refer: reason, urgent? }      { review: reason }   { service: true }
function cardDecision(s, card, triage) {
  const c = s.case;

  if (card.time_rule && timeRuleApplies(s)) {
    // A date the client says does not match the contract's or the notice's (knowledge base 4.3: a
    // disputed date is referred for checking, with priority).
    if (c.employment_end_disputed === true) return { refer: 'labor_time_review', urgent: true };
    const time = laborTime(s, triage);
    if (time === 'review') return { refer: 'labor_time_review', urgent: true };
    if (time === 'over') {
      // An acknowledgment or an excuse: whether it is in writing, once, then the specialist; the
      // time is spoken of in the knowledge base's one wording (4.3, example 8.4). With such an
      // indicator, or an earlier procedure, the specialist judges the time whatever the exact
      // date is, so an approximate date is not asked about first: example 8.4 («قبل سنتين») asks
      // only whether the acknowledgment is written (the owner's decision of 16 November 2026).
      if (c.acknowledgment_or_excuse === true && questionApplies(s, 'q_labor_ack_written', triage)) return { ask: ['q_labor_ack_written'], lead: false, followup: false };
      if (c.acknowledgment_or_excuse === true || c.prior_procedure === true) {
        return { refer: 'labor_time_indicator', reply: s.asked.includes('q_labor_ack_written') ? 'referred' : 'referred_labor_time' };
      }
      // No indicator so far, so the decline is possible: an approximate date is no ground for it
      // (4.3). It is confirmed once, and one still not confirmed is checked by the specialist.
      if (c.employment_end_needs_confirmation === true) {
        if (questionApplies(s, 'q_labor_confirm_end', triage)) return { ask: ['q_labor_confirm_end'], lead: false, followup: false };
        return { refer: 'labor_time_review', urgent: true };
      }
      if (!s.asked.includes('q_labor_time_indicators')) return { ask: ['q_labor_time_indicators'], lead: false, followup: false };
      return { decline: 'decline_labor_time', options: ['consultation'], reason: 'labor_time' };
    }
  }

  // A group claim, several workers against one company (knowledge base 4.2): their number and
  // the total are asked, and the specialist reviews it, whatever one worker's share is.
  if (card.group_review && c.complex_matter) {
    if (!s.asked.includes(card.group_review) && !s.answered.includes(card.group_review)) return { ask: [card.group_review], lead: false, followup: false };
    return { review: 'group_claim' };
  }

  if (card.notes_only && c.enforcement_kind && c.enforcement_kind !== 'note') {
    // Its consultation has no approved price (table 2 says «استشارة» only; 1,000 is the note's, 5.10).
    const other = card.not_note || card.below;
    return { decline: other.reply, options: other.options, reason: 'enforcement_not_note' };
  }

  const applies = thresholdApplies(s, card);
  const amount = applies ? amountAgainst(s, card.threshold, triage) : null;
  // An amount in another currency that the threshold cannot judge (knowledge base 4.4). Where no
  // threshold applies, its currency decides nothing.
  if (amount === 'other_currency') return { refer: 'other_currency' };
  if (applies) {
    if (amount === 'below') {
      if (card.below_outside_ksa_refer && c.client_outside_ksa === true) return { refer: 'outside_ksa_below' };
      // Before a decline: whether the claim is new, and for a worker's new labour claim when the
      // work ended, since near the 12-month limit it is urgent and past it the decline is another.
      // When the work ended goes first: its answer may make the claim urgent. Each check has two
      // questions, the most one message holds, so they go one message at a time.
      const before = [];
      if (card.time_rule && timeRuleApplies(s) && laborTime(s, triage) === 'unknown' && questionApplies(s, 'q_labor_status', triage)) before.push(formOf(s, 'q_labor_status', triage));
      if (!isSet(c.case_status) && !isSet(c.event_days_until) && !s.asked.includes('q_check_new')) before.push('q_check_new');
      // A case already filed: its next hearing first (knowledge base 5.8), since a hearing within
      // 72 hours is referred as urgent whatever the amount (4.4, note).
      if (c.case_status === 'existing' && !isSet(c.event_days_until) && questionApplies(s, 'q_case_next_hearing', triage)) before.push('q_case_next_hearing');
      const room = [];
      let count = 0;
      for (const id of before) {
        const q = (triage.questions[id] && triage.questions[id].q) || 1;
        if (room.length && count + q > triage.limits.questions_per_message) break;
        room.push(id);
        count += q;
      }
      if (room.length) return { ask: room, lead: false, followup: false };
      // A complex matter's consultation starts from the higher price: its decline says so (A.3).
      return { decline: c.complex_matter && card.below.reply_complex ? card.below.reply_complex : card.below.reply, options: card.below.options, reason: 'below_threshold' };
    }
    const estimate = card.amount_estimate || 'q_amount_estimate';
    if (amount === 'straddle') {
      if (!s.asked.includes(estimate)) return { ask: [estimate], lead: false, followup: false };
      return { refer: 'amount_unclear' };
    }
    if (amount === 'unknown' && (amountAsked(s, triage) || s.amountRefused)) {
      if (!s.asked.includes(estimate) && !s.answered.includes(estimate) && !s.amountRefused) {
        // The estimate is asked once, with the card's first questions still to ask (8.21).
        const next = nextQuestions(s, card, triage);
        const first = next && !next.followup ? next.ids.filter((id) => id !== estimate) : [];
        return { ask: [...first, estimate], lead: first.length > 0 && next.lead, followup: false };
      }
      return { refer: s.amountRefused ? 'amount_refused' : 'amount_unknown' };
    }
  }

  const next = nextQuestions(s, card, triage);
  if (next) return { ask: next.ids, lead: next.lead, followup: next.followup };

  // A foreign buyer who chose neither the consultation nor the quote: the team quotes it (5.6).
  if (card.foreign_buyer_quote && c.foreign_buyer === true) return { service: true };
  if (applies && amount === 'above') return { review: 'above_threshold' };
  if (applies && amount === 'unknown') return { refer: 'amount_unknown' };
  if (card.service_card) return { service: true };
  return { review: applies ? 'above_threshold' : (card.monetary_only && c.monetary === false ? 'non_monetary' : 'no_threshold') };
}

module.exports = {
  URGENT_EVENTS, isSet, fieldValue, urgency, exclusion, laborTime, timeRuleApplies, amountAgainst,
  thresholdApplies, questionLists, questionApplies, formOf, fieldMissing, nextQuestions, amountAsked, cardDecision,
};
