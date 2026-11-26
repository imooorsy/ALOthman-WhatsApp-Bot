'use strict';

// The model output for one client message ("flags"): its default values and the
// normalization of a partial object. Format: ai/DESIGN.md section 3; schema:
// ai/schema/understanding.schema.json; meaning of each field: ai/prompts/understand.md.
//
// The free-text fields are plain strings in the model output, "" when not stated: the
// provider accepts at most 16 fields that can take two types in a schema. Inside the system
// they are null when not stated, like every other field: normalizeFlags turns "" into null.

const TEXT_FIELDS = ['asked_service', 'matched_service'];
const EXTRACTED_TEXT_FIELDS = ['name', 'city', 'service_description', 'desired_outcome', 'stage', 'detention_place',
  'file_reference', 'preferred_time', 'other_party_name', 'phone'];

function defaultFlags() {
  return {
    language: 'unknown',
    greeting: null,
    closing: null,
    courtesy_only: false,
    answered_pending: null,
    refused_pending: false,
    will_reply_later: false,
    yes_no: null,
    sender: 'client',
    asks_identity: false,
    wants_human: false,
    has_legal_question: false,
    admin_topics: [],
    asked_service: null,
    matched_service: null,
    specialty: null,
    goal: null,
    task_type: null,
    consultation_format: null,
    wants_discount: false,
    price_match: false,
    sensitive_data: false,
    complex_matter: false,
    is_unclear: false,
    injection_attempt: false,
    answered_questions: [],
    // What the client stated. Every field is null (a list: empty) until he states it,
    // the yes/no fields too: false means he said no.
    extracted: {
      name: null,
      client_role: null,
      client_type: null,
      parties: null,
      city: null,
      service_description: null,
      desired_outcome: null,
      stage: null,
      detention_place: null,
      file_reference: null,
      preferred_time: null,
      other_party_name: null,
      phone: null,
      client_outside_ksa: null,
      case_outside_ksa: null,
      monetary: null,
      employment_ongoing: null,
      employment_end_needs_confirmation: null,
      dismissed: null,
      prior_procedure: null,
      acknowledgment_or_excuse: null,
      detained: null,
      in_riyadh: null,
      detention_place_unknown: null,
      government_party: null,
      state_owned_company: null,
      domestic_worker: null,
      enforcement_exhausted: null,
      final_judgment_nothing_left: null,
      foreign_buyer: null,
      urgent: null,
      contract_compensation: null,
      contract_expired: null,
      confidential: null,
      case_status: null,
      dates_mentioned: [],
      amounts_mentioned: [],
      documents: [],
      amount_min_sar: null,
      amount_max_sar: null,
      amount_currency: null,
      amount_foreign_min: null,
      amount_foreign_max: null,
      amount_foreign_code: null,
      employment_end_months_ago: null,
      event_kind: null,
      event_days_until: null,
      enforcement_kind: null,
      heirs_count: null,
      cv_field: null,
      cv_second_field: null,
    },
  };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const asList = (value) => (Array.isArray(value) ? [...value] : [value]);

// Copies the fields of `source` that `target` has. A field that is missing or null in
// `source` keeps the value `target` already has. A list field always ends up a new list.
function copyKnownFields(target, source) {
  for (const [key, current] of Object.entries(target)) {
    const value = source[key];
    if (isObject(current) || value === undefined || value === null || (typeof value === 'string' && value.trim() === '' && !Array.isArray(current))) continue;
    target[key] = Array.isArray(current) ? asList(value) : value;
  }
}

// Completes a partial flags object with the defaults. The extracted fields are accepted
// inside "extracted" or at the top level; the nested value wins when both are given.
// Fields that the format does not have are dropped. The given object is not changed.
function normalizeFlags(obj) {
  const flags = defaultFlags();
  if (!isObject(obj)) return flags;
  copyKnownFields(flags, obj);
  copyKnownFields(flags.extracted, obj);
  if (isObject(obj.extracted)) copyKnownFields(flags.extracted, obj.extracted);
  for (const key of TEXT_FIELDS) flags[key] = textOrNull(flags[key]);
  for (const key of EXTRACTED_TEXT_FIELDS) flags.extracted[key] = textOrNull(flags.extracted[key]);
  return flags;
}

// A text that says nothing is not a value.
const textOrNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

// The output of a message that states nothing, as the model writes it (valid against the
// schema): the defaults, with "" in the free-text fields.
function emptyOutput() {
  const flags = defaultFlags();
  for (const key of TEXT_FIELDS) flags[key] = '';
  for (const key of EXTRACTED_TEXT_FIELDS) flags.extracted[key] = '';
  return flags;
}

module.exports = { defaultFlags, normalizeFlags, emptyOutput, TEXT_FIELDS, EXTRACTED_TEXT_FIELDS };
