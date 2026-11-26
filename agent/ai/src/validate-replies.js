'use strict';

// Checks the approved replies (config/approved-replies.json, version 3) against the
// contract in ai/DESIGN.md section 4, config/triage.json and the writing rules of the
// office's knowledge base (.specify/specs/001-legal-whatsapp-agent/office-knowledge-base.md).
//
// As a function: validateReplies(replies, banned, triage) returns { ok, errors }.
//                `triage` defaults to config/triage.json. The reply IDs of the table in
//                DESIGN.md section 4.4 are read from ai/DESIGN.md.
// As a command:  node ai/src/validate-replies.js [replies.json] [banned-phrases.json] [triage.json]
//                Without arguments it checks the files in config/. It prints the errors
//                and exits with code 1 if there are any.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const TRIAGE_FILE = path.join(CONFIG_DIR, 'triage.json');
const DESIGN_FILE = path.join(ROOT, 'ai', 'DESIGN.md');

const VERSIONS = ['arabic', 'english'];
const GREETINGS = ['salam', 'morning', 'evening', 'hello', 'afiya'];

// The kinds of DESIGN.md section 4.1 but "greeting", which is the kind of the replies in
// "greetings". An entry of "replies" has one of these.
const REPLY_KINDS = ['statement', 'question', 'lead', 'ack', 'fragment'];

// The placeholders of DESIGN.md section 4.2. Besides these: {price_<key>} for each key of
// "prices" in triage.json.
const PLACEHOLDERS = [
  'office_name', 'working_hours', 'address', 'contact_info', 'website', 'price_info', 'other_offices',
  'services_list', 'service_name', 'consultation_name', 'consultation_price', 'consultation_formats',
  'booking_needs', 'award',
];
const PRICE_PREFIX = 'price_';

// A text that names a price says that the price does not include VAT (knowledge base 3.3).
const VAT_NOTE_ARABIC = 'غير شاملة';
const VAT_NOTE_ENGLISH = /\bVAT\b/;

// Forms that address a man only. Every Arabic text must suit men and women (DESIGN.md
// section 2). Written in plain form (see `plain`).
const MALE_ONLY_FORMS = [
  'أبشر', 'تفضل', 'آمر', 'توضح لي', 'تشرح لي', 'تعطيني', 'تحتاج', 'تقدر', 'تعيد التسجيل',
  'تكتبه لي', 'أرسل', 'اذكر', 'أرفق', 'ترغب', 'سيرتك', 'حياك',
];

// Replies that promise contact. The same reply is sent at any hour, so it must not say
// "now": neither of these Arabic words anywhere in it, nor the English word.
const CONTACT_PROMISES = [
  'review_representation', 'referred', 'referred_urgent', 'referred_team', 'referred_quote', 'human',
  'transfer_unclear', 'business_development', 'booking_received', 'waiting', 'returning', 'out_of_hours',
];
const NOW_WORDS = ['الحين', 'الآن'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The character that stretches Arabic letters (U+0640). It carries no meaning.
const TATWEEL = String.fromCodePoint(0x640);

// Plain form of a text, used for comparison: lower case, without diacritics, tatweel or
// invisible format characters, and with every run of spaces and punctuation as one space.
// The plain forms of recent texts are kept, as the same texts are checked again and again.
const plainForms = new Map();
function plain(text) {
  let form = plainForms.get(text);
  if (form === undefined) {
    form = text.normalize('NFC')
      .replaceAll(TATWEEL, '')
      .replace(/[\p{M}\p{Cf}]/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (plainForms.size >= 5000) plainForms.clear();
    plainForms.set(text, form);
  }
  return form;
}

// True when `words` are in `plainText` as whole words. Both are in plain form.
// An Arabic conjunction (و or ف) attached to the first word still counts.
function hasWords(plainText, words) {
  const padded = ` ${plainText} `;
  return ['', 'و', 'ف'].some((prefix) => padded.includes(` ${prefix}${words} `));
}

// The same lists in plain form, made once.
const PLAIN_MALE_ONLY_FORMS = MALE_ONLY_FORMS.map(plain);
const PLAIN_NOW_WORDS = NOW_WORDS.map(plain);
const PLAIN_VAT_NOTE_ARABIC = plain(VAT_NOTE_ARABIC);

// The forms that address a man only in a text in plain form, as `hasWords` finds them,
// in one pass: their plain forms, without repeats.
const MALE_ONLY_PATTERN = new RegExp(
  `(?<=^| )[وف]?(${PLAIN_MALE_ONLY_FORMS.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?= |$)`,
  'gu',
);
function maleOnlyForms(plainText) {
  return new Set([...plainText.matchAll(MALE_ONLY_PATTERN)].map((match) => match[1]));
}

// The reply IDs listed in the table of section 4.4 of DESIGN.md (its Markdown text), in
// order: the IDs in backticks in the first cell of each row. A cell that starts with a
// label and a colon, as «`fragment`: `need_name`، `need_topic`», lists the IDs after it.
function designReplyIds(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const start = lines.findIndex((line) => /^###\s+4\.4(?![.\d])/.test(line));
  const ids = [];
  if (start === -1) return ids;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) continue;
    const firstCell = line.split('|')[1];
    const labelled = /^\s*`[^`]*`\s*:(.*)$/.exec(firstCell);
    for (const [, id] of (labelled ? labelled[1] : firstCell).matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// The IDs of section 4.4 of ai/DESIGN.md, read once.
let designIds = null;
function readDesignIds() {
  if (designIds === null) designIds = designReplyIds(fs.readFileSync(DESIGN_FILE, 'utf8'));
  return designIds;
}

// Every place of triage.json that names a reply, as [where, id]: the replies of the cards
// and of the excluded services, and the questions of the cards and of the case overlays.
function triageReferences(triage) {
  const refs = [];
  const entries = (value) => (isObject(value) ? Object.entries(value) : []);
  const replyOf = (value) => (isObject(value) ? value.reply : undefined);
  const questionLists = (where, holder) => {
    for (const list of ['first', 'followups']) {
      if (Array.isArray(holder[list])) holder[list].forEach((id, i) => refs.push([`${where}.${list}[${i}]`, id]));
    }
  };
  for (const [key, card] of entries(triage.cards)) {
    if (!isObject(card)) continue;
    for (const field of ['below', 'not_note', 'document', 'consultation_offer', 'after_questions']) {
      if (card[field] !== undefined) refs.push([`cards.${key}.${field}.reply`, replyOf(card[field])]);
    }
    for (const [task, value] of entries(card.tasks)) refs.push([`cards.${key}.tasks.${task}.reply`, replyOf(value)]);
    questionLists(`cards.${key}`, card);
    if (card.amount_estimate !== undefined) refs.push([`cards.${key}.amount_estimate`, card.amount_estimate]);
  }
  for (const [key, overlay] of entries(triage.case_overlays)) {
    if (isObject(overlay)) questionLists(`case_overlays.${key}`, overlay);
  }
  for (const [key, value] of entries(triage.excluded)) refs.push([`excluded.${key}.reply`, replyOf(value)]);
  return refs;
}

function validateReplies(repliesObj, bannedObj, triageObj) {
  const errors = [];

  let banned = isObject(bannedObj) && Array.isArray(bannedObj.phrases) ? bannedObj.phrases : null;
  if (!banned || banned.some((phrase) => typeof phrase !== 'string' || plain(phrase) === '')) {
    errors.push('banned phrases: "phrases" must be a list of non-empty strings');
    banned = [];
  }
  const plainBanned = banned.map(plain);

  let triage = triageObj;
  let triageLoaded = true;
  if (triage === undefined) {
    try {
      triage = readJson(TRIAGE_FILE);
    } catch (err) {
      errors.push(err.message);
      triageLoaded = false;
    }
  }
  const triagePart = (name) => {
    if (isObject(triage) && isObject(triage[name])) return triage[name];
    if (triageLoaded) errors.push(`triage.json ${name}: must be an object`);
    return null;
  };
  const prices = triagePart('prices') || {};
  const questions = triagePart('questions');
  triagePart('cards');
  triagePart('excluded');

  // {consultation_price}, or {price_<key>} for a key of the prices.
  const isPrice = (name) => name === 'consultation_price' || (!PLACEHOLDERS.includes(name)
    && name.startsWith(PRICE_PREFIX) && Object.hasOwn(prices, name.slice(PRICE_PREFIX.length)));

  // Checks one text of `version`. `replyId` is null for a greeting.
  function checkText(where, text, version, replyId, mayBeEmpty) {
    if (typeof text !== 'string' || (text.trim() === '' && !(mayBeEmpty && text === ''))) {
      errors.push(`${where}: must be a non-empty string${mayBeEmpty ? ' or ""' : ''}`);
      return;
    }

    let price = null; // the first placeholder that stands for a price
    const words = text.replace(/\{([^{}]*)\}/g, (placeholder, name) => {
      if (isPrice(name)) {
        price = price || placeholder;
      } else if (!PLACEHOLDERS.includes(name)) {
        const hint = name.startsWith(PRICE_PREFIX) ? ' (not a key of triage.json prices)' : '';
        errors.push(`${where}: unknown placeholder ${placeholder}${hint}`);
      }
      return ' ';
    });
    if (/[{}]/.test(words)) errors.push(`${where}: unbalanced brace`);

    const plainText = plain(words);
    if (price) {
      const arabic = version === 'arabic';
      const noted = arabic ? plainText.includes(PLAIN_VAT_NOTE_ARABIC) : VAT_NOTE_ENGLISH.test(words);
      if (!noted) {
        const note = arabic ? `«${VAT_NOTE_ARABIC}»` : '"VAT"';
        errors.push(`${where}: names a price (${price}) without ${note} (knowledge base 3.3)`);
      }
    }
    banned.forEach((phrase, i) => {
      if (plainText.includes(plainBanned[i])) errors.push(`${where}: contains the banned phrase "${phrase}"`);
    });
    if (version === 'arabic') {
      const found = maleOnlyForms(plainText);
      MALE_ONLY_FORMS.forEach((form, i) => {
        if (found.has(PLAIN_MALE_ONLY_FORMS[i])) errors.push(`${where}: contains "${form}", which addresses a man only`);
      });
    }
    if (replyId !== null && CONTACT_PROMISES.includes(replyId)) {
      const i = PLAIN_NOW_WORDS.findIndex((w) => plainText.includes(w));
      const word = i !== -1 ? NOW_WORDS[i] : (hasWords(plainText, 'now') ? 'now' : null);
      if (word) errors.push(`${where}: contains "${word}", which a reply that promises contact must not say`);
    }
  }

  const versions = isObject(repliesObj) ? repliesObj.versions : undefined;
  if (!Array.isArray(versions) || versions.length !== VERSIONS.length
    || VERSIONS.some((version, i) => versions[i] !== version)) {
    errors.push(`versions: must be ${JSON.stringify(VERSIONS)}`);
  }

  const greetings = isObject(repliesObj) ? repliesObj.greetings : undefined;
  if (!isObject(greetings)) {
    errors.push('greetings: missing');
  } else {
    for (const type of GREETINGS) {
      if (!isObject(greetings[type])) {
        errors.push(`greetings.${type}: missing`);
        continue;
      }
      for (const version of VERSIONS) {
        // The English reply to «يعطيك العافية» adds nothing.
        const mayBeEmpty = type === 'afiya' && version === 'english';
        checkText(`greetings.${type}.${version}`, greetings[type][version], version, null, mayBeEmpty);
      }
    }
    for (const type of Object.keys(greetings)) {
      if (!GREETINGS.includes(type)) errors.push(`greetings.${type}: unknown greeting`);
    }
  }

  const replies = isObject(repliesObj) && isObject(repliesObj.replies) ? repliesObj.replies : null;
  if (replies === null) {
    errors.push('replies: missing');
    return { ok: false, errors };
  }

  for (const [id, reply] of Object.entries(replies)) {
    if (!isObject(reply)) {
      errors.push(`replies.${id}: must be an object`);
      continue;
    }
    if (reply.kind === 'greeting') {
      errors.push(`replies.${id}.kind: "greeting" is the kind of the replies in "greetings"`);
    } else if (!REPLY_KINDS.includes(reply.kind)) {
      errors.push(`replies.${id}.kind: must be one of ${REPLY_KINDS.join(', ')}`);
    }
    if (reply.kind === 'question' && reply.q !== 1 && reply.q !== 2) {
      errors.push(`replies.${id}.q: must be 1 or 2`);
    }
    if (typeof reply.source !== 'string' || reply.source.trim() === '') {
      errors.push(`replies.${id}.source: must be a non-empty string`);
    }
    if (!Array.isArray(reply.variants) || reply.variants.length === 0) {
      errors.push(`replies.${id}.variants: must be a non-empty list`);
      continue;
    }
    reply.variants.forEach((variant, index) => {
      for (const version of VERSIONS) {
        const text = isObject(variant) ? variant[version] : undefined;
        checkText(`replies.${id}.variants[${index}].${version}`, text, version, id, false);
      }
    });
  }

  // Each question of triage.json is a reply of kind "question" with the same count.
  if (questions !== null) {
    for (const [id, spec] of Object.entries(questions)) {
      const reply = replies[id];
      if (!Object.hasOwn(replies, id)) {
        errors.push(`replies.${id}: missing (a question of triage.json)`);
      } else if (isObject(reply) && reply.kind !== 'question') {
        errors.push(`replies.${id}.kind: must be "question" (a question of triage.json)`);
      } else if (isObject(reply) && reply.q !== (isObject(spec) ? spec.q : undefined)) {
        const expected = JSON.stringify(isObject(spec) ? spec.q : undefined);
        errors.push(`replies.${id}.q: must be ${expected}, as in triage.json questions`);
      }
    }
  }

  // Each reply that triage.json names exists.
  for (const [where, id] of triageLoaded && isObject(triage) ? triageReferences(triage) : []) {
    if (typeof id !== 'string' || id === '') errors.push(`triage.json ${where}: must be a reply ID`);
    else if (!Object.hasOwn(replies, id)) errors.push(`triage.json ${where}: no reply "${id}"`);
  }

  // The replies are those of DESIGN.md section 4.4 and the questions of triage.json.
  let listed = null;
  try {
    listed = readDesignIds();
    if (listed.length === 0) {
      errors.push('ai/DESIGN.md: no reply IDs in the table of section 4.4');
      listed = null;
    }
  } catch (err) {
    errors.push(`ai/DESIGN.md: cannot read the reply IDs of section 4.4 (${err.message})`);
  }
  if (listed !== null) {
    for (const id of listed) {
      if (!Object.hasOwn(replies, id)) errors.push(`replies.${id}: missing (listed in ai/DESIGN.md section 4.4)`);
    }
    if (questions !== null) {
      for (const id of Object.keys(replies)) {
        if (!listed.includes(id) && !Object.hasOwn(questions, id)) {
          errors.push(`replies.${id}: unknown reply ID (neither in ai/DESIGN.md section 4.4 nor a question of triage.json)`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Reads a JSON file, with or without a byte order mark. A failure names the file.
function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  } catch (err) {
    throw new Error(`cannot load ${file}: ${err.message}`);
  }
}

// Runs the command and returns its exit code.
function main(args) {
  const repliesPath = args[0] || path.join(CONFIG_DIR, 'approved-replies.json');
  const bannedPath = args[1] || path.join(CONFIG_DIR, 'banned-phrases.json');
  const triagePath = args[2] || TRIAGE_FILE;
  let errors;
  try {
    errors = validateReplies(readJson(repliesPath), readJson(bannedPath), readJson(triagePath)).errors;
  } catch (err) {
    errors = [err.message];
  }
  if (errors.length === 0) {
    console.log(`OK: ${repliesPath}`);
    return 0;
  }
  for (const error of errors) console.error(error);
  console.error(`${errors.length} error(s)`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { validateReplies, designReplyIds, CONTACT_PROMISES };
