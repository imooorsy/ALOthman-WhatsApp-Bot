'use strict';

// Internal classification of a client's request for the staff (ai/DESIGN.md section 8).
// It is shown to the staff only and never changes what is sent to the client.
//
// rulesConfig = { enabled, rules: [ { id, when: [ { field, op, value } ], classification,
//                                     reason, required: [field] } ] }

const { sameText } = require('./normalize');

const CLASSIFICATIONS = ['needs_review', 'suitable', 'out_of_scope', 'incomplete'];

// Reasons that do not come from a rule, in the words of spec.md section 5.
const REASONS = {
  notConfigured: 'معايير التأهيل غير مهيأة',
  missingData: 'لا توجد بيانات كافية للتصنيف',
  conflict: 'توجد معلومات متعارضة',
  noRule: 'حالة غير مغطاة بالقواعد',
};

const isPresent = (value) => value !== null && value !== undefined && value !== '';

// Two texts are equal when they are the same after normalization (letter forms, digits,
// spaces). Other values are compared strictly.
const equal = (a, b) => (typeof a === 'string' && typeof b === 'string' ? sameText(a, b) : a === b);

// One condition { field, op, value } against the known data. A comparison with a value
// that is not known never holds. "exists" holds when the field is known, or, with
// value false, when it is not.
function holds(condition, known) {
  const actual = known[condition.field];
  const present = isPresent(actual);
  switch (condition.op) {
    case 'exists': return present === (condition.value !== false);
    case 'eq': return present && equal(actual, condition.value);
    case 'neq': return present && !equal(actual, condition.value);
    case 'in': return present && Array.isArray(condition.value)
      && condition.value.some((item) => equal(actual, item));
    default: return false;
  }
}

// known: what the client stated (state.known of flow.js). Returns { classification, reasons }.
function qualify(known, rulesConfig) {
  const data = known || {};
  const enabled = Boolean(rulesConfig) && rulesConfig.enabled === true;
  const rules = enabled && Array.isArray(rulesConfig.rules) ? rulesConfig.rules : [];
  if (rules.length === 0) return { classification: 'needs_review', reasons: [REASONS.notConfigured] };

  const applied = [];
  const missing = [];
  for (const rule of rules) {
    const lacking = (rule.required || []).filter((field) => !isPresent(data[field]));
    // A condition on a required field that is still missing cannot be judged yet. The rule
    // is out only when a condition fails on what is known; then it asks for nothing.
    const waits = (condition) => lacking.includes(condition.field);
    const fails = (rule.when || []).some((condition) => !waits(condition) && !holds(condition, data));
    if (fails) continue;
    if (lacking.length === 0) applied.push(rule);
    for (const field of lacking) {
      if (!missing.includes(field)) missing.push(field);
    }
  }

  if (missing.length > 0) {
    const reasons = missing.map((field) => `${REASONS.missingData}: ${field}`);
    return { classification: 'incomplete', reasons };
  }
  if (applied.length === 0) return { classification: 'needs_review', reasons: [REASONS.noRule] };

  const reasons = applied.map((rule) => rule.reason || rule.id);
  const classifications = [...new Set(applied.map((rule) => rule.classification))];
  if (classifications.length > 1) {
    return { classification: 'needs_review', reasons: [REASONS.conflict, ...reasons] };
  }
  if (!CLASSIFICATIONS.includes(classifications[0])) {
    return { classification: 'needs_review', reasons: [REASONS.notConfigured] };
  }
  return { classification: classifications[0], reasons };
}

module.exports = { qualify, CLASSIFICATIONS };
