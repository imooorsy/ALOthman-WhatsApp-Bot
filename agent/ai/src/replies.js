'use strict';

// The approved replies: loading the file, choosing a phrasing, filling the placeholders
// and joining the parts of one message (ai/DESIGN.md section 4).
//
// A part is { id, variant, text }: the reply id, the index of its phrasing (0 for the
// first one) and the text in one version ("arabic" or "english"), filled.
// The reply to a greeting has the id "greeting:<type>" and variant 0.

const fs = require('node:fs');
const path = require('node:path');
const { sameText, normalizeText } = require('./normalize');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config', 'approved-replies.json');

// Replies that are never sent again once all their phrasings were used: the welcome, the lead-in
// and the acknowledgement, which would only repeat themselves; "your request is with the team"
// (spec criterion 46) and the paid-consultation answer to a legal question (criterion 51), after
// which the assistant stays silent on purpose; and the one-time marketing reply. Every other
// reply (a question, a decline, an offer, a referral) is due whenever the conversation needs
// it, so its first phrasing is repeated rather than leaving the client without a reply. The
// polite word to "let me think about it" is said once too.
const ONCE = ['welcome_full', 'welcome_short', 'lead', 'ack', 'waiting', 'legal_offer', 'legal_offer_from',
  'legal_offer_generic', 'marketing', 'sensitive_warning', 'deferral_reply', 'subject_again'];
const REPEATABLE = [];

const BYTE_ORDER_MARK = 0xFEFF;

function loadReplies(file = DEFAULT_FILE) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text);
}

let approved = null;
function approvedReplies() {
  if (approved === null) approved = loadReplies();
  return approved;
}

const isGreeting = (id) => id.startsWith('greeting:');
const kindOf = (replies, id) => (isGreeting(id) ? 'greeting' : (replies.replies[id] || {}).kind);
const isRepeatable = (id, replies = approvedReplies()) => isGreeting(id) || REPEATABLE.includes(id)
  || kindOf(replies, id) === 'fragment' || !ONCE.includes(id);

function variantCount(replies, id) {
  if (isGreeting(id)) return Object.hasOwn(replies.greetings, id.slice('greeting:'.length)) ? 1 : 0;
  return Object.hasOwn(replies.replies, id) ? replies.replies[id].variants.length : 0;
}

// Index of the lowest phrasing of `id` that the conversation has not used yet.
// When all were used: 0 for a repeatable reply, null for any other.
function pickVariant(used, id, replies = approvedReplies()) {
  const count = variantCount(replies, id);
  const taken = (used && used[id]) || [];
  for (let variant = 0; variant < count; variant += 1) {
    if (!taken.includes(variant)) return variant;
  }
  return count > 0 && isRepeatable(id, replies) ? 0 : null;
}

// A client name may be used when it has one to three words of Arabic or Latin letters,
// none of them a word that is never part of a name (a sentence is not a name).
const NAME_WORD = /^(?:(?=\p{L})[\p{Script=Arabic}\p{Script=Latin}]){1,15}$/u;
const NOT_NAME_WORDS = [
  'يحق', 'يحقلك', 'تستحق', 'يستحق', 'يجب', 'يلزم', 'لازم', 'تقدر', 'يمكنك', 'لك', 'عليك',
  'تعويض', 'التعويض', 'دعوى', 'الدعوى', 'قضية', 'القضية', 'محكمة', 'المحكمة', 'قانون', 'القانون',
  'نظام', 'النظام', 'مادة', 'المادة', 'عقوبة', 'حقك', 'حقوقك', 'مهلة', 'استئناف',
  'you', 'your', 'can', 'must', 'should', 'entitled', 'legal', 'law', 'court', 'claim', 'sue', 'rights',
].map((word) => normalizeText(word).toLowerCase());

function isValidName(name) {
  if (typeof name !== 'string') return false;
  const words = name.trim().split(/\s+/);
  return words.length <= 3 && words.every((word) => NAME_WORD.test(word)
    && !NOT_NAME_WORDS.includes(normalizeText(word).toLowerCase()));
}

const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

// "2,500": the digits and thousands separator the firm uses in both languages.
const formatNumber = (value) => (typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : null);

// The value of every placeholder, null where there is none.
// - Office values come from the office profile. An English reply takes the field's
//   English value (office_name_en, ...) when the office gave one, and the Arabic one otherwise.
// - service_name is flags.matched_service, only if it is on the office's list.
// - extras: { prices: { key: number }, consultation_name, consultation_price,
//   consultation_formats, booking_needs, award } computed by the flow.
function placeholderValues(profile, version, flags, known, extras = {}) {
  const english = version === 'english';
  const pick = (key) => (english && textOrNull(profile[`${key}_en`])) || textOrNull(profile[key]);
  const arabic = Array.isArray(profile.services) ? profile.services : [];
  const translated = english && Array.isArray(profile.services_en) && profile.services_en.length === arabic.length
    ? profile.services_en : null;
  const services = arabic
    .map((service, index) => [textOrNull(service), (translated && textOrNull(translated[index])) || textOrNull(service)])
    .filter(([service]) => service);
  const matched = flags ? flags.matched_service : null;
  const found = services.find(([service, shown]) => sameText(service, matched) || sameText(shown, matched));
  const values = {
    office_name: pick('office_name'),
    working_hours: pick('working_hours'),
    address: pick('address'),
    contact_info: pick('contact_info'),
    website: pick('website'),
    price_info: pick('price_info'),
    other_offices: pick('other_offices'),
    services_list: services.length > 0 ? services.map(([, shown]) => shown).join(english ? ', ' : '، ') : null,
    service_name: found ? found[1] : null,
    consultation_name: extras.consultation_name || null,
    consultation_price: extras.consultation_price || null,
    consultation_formats: extras.consultation_formats || null,
    booking_needs: extras.booking_needs || null,
    award: extras.award || null,
  };
  for (const [key, value] of Object.entries(extras.prices || {})) values[`price_${key}`] = formatNumber(value);
  return values;
}

// Fills the {placeholders} of a text. Returns null when a value is missing, so that a
// text with an empty place is never sent.
function fillText(text, values) {
  let complete = true;
  const filled = text.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (values[name] === null || values[name] === undefined) complete = false;
    return values[name];
  });
  return complete ? filled : null;
}

// One phrasing of a reply as a part, or null if it does not exist or cannot be filled.
function makePart(replies, id, variant, version, values) {
  if (variant === null || variant >= variantCount(replies, id) || isGreeting(id)) return null;
  const text = fillText(replies.replies[id].variants[variant][version], values);
  return text === null ? null : { id, variant, text };
}

// The lowest unused phrasing of a reply that can be filled, or null.
function pickPart(replies, used, id, version, values) {
  const tried = [...((used && used[id]) || [])];
  for (;;) {
    const variant = pickVariant({ [id]: tried }, id, replies);
    const part = makePart(replies, id, variant, version, values);
    if (part || variant === null || tried.includes(variant)) return part;
    tried.push(variant);
  }
}

// The reply to a greeting, or null when nothing is said back.
function greetingPart(replies, type, version) {
  const known = typeof type === 'string' && Object.hasOwn(replies.greetings, type);
  const text = known ? replies.greetings[type][version] : '';
  return text ? { id: `greeting:${type}`, variant: 0, text } : null;
}

// Joins list items the way the firm writes them: "أ، وب، وج" and "a, b and c".
function joinList(items, version) {
  if (items.length === 0) return null;
  if (version === 'english') {
    return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }
  return items.map((item, index) => (index === 0 ? item : `و${item}`)).join('، ');
}

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const upperFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Joins the parts of one message into its text (DESIGN 4.3).
function joinParts(parts, version, replies) {
  const english = version === 'english';
  let text = '';
  let previous = null;
  for (const part of parts) {
    const kind = kindOf(replies, part.id);
    let piece = part.text;
    if (previous === 'greeting') text += english ? '. ' : '، ';
    else if (previous === 'lead') {
      text += ' ';
      if (english && !/^I\b/.test(piece)) piece = lowerFirst(piece);
    } else if (previous === 'question' && kind === 'question') {
      text += english ? ' And ' : ' و';
      if (english && !/^I\b/.test(piece)) piece = lowerFirst(piece);
    } else if (previous !== null) text += ' ';
    if (english && (previous === null || previous === 'statement' || previous === 'ack' || previous === 'greeting')) {
      piece = upperFirst(piece);
    }
    text += piece;
    previous = kind;
  }
  return text;
}

// One outgoing message { parts, text }. A part with an empty text is dropped.
function buildMessage(parts, version, replies) {
  const kept = parts.filter((part) => part.text !== '');
  return { parts: kept, text: joinParts(kept, version, replies) };
}

module.exports = {
  loadReplies,
  pickVariant,
  isRepeatable,
  isValidName,
  formatNumber,
  placeholderValues,
  fillText,
  makePart,
  pickPart,
  greetingPart,
  joinList,
  joinParts,
  buildMessage,
};
