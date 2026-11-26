'use strict';

// Checks a reply the model wrote against the approved reply it was written from (ai/DESIGN.md
// section 4.5), under the owner's decision of 2026-11-14: the approved replies are the office
// staff's own words; the model adapts them to the client's message under the strictest limits.
//
// The approved reply is cut into sentences. A sentence made only of courtesy phrases (thanks, a
// lead-in such as «لنتمكن من خدمتكم») is free: it may be kept, reworded or dropped. Every other
// sentence is locked: in the written reply it has the same words in the same order, the same
// punctuation between them, no line break inside, and the same ending right after it, so a
// question stays one and a statement never becomes one. Around the locked sentences the model
// may add only whole phrases of COURTESY, a few of them: a condolence only after the client spoke
// of a death, a reply to a greeting only after the greeting, a lead-in only right before a
// question. Between them only spaces, single line breaks, «.»، «،» and «,». No character the
// approved text and the phrases do not have, so nothing hidden or look-alike reaches the client.
// Whatever fails is not sent: the approved text is. (Red-team review of 2026-11-14 in tasks.md.)

const { normalizeText } = require('./normalize');
const { joinParts } = require('./replies');

// The phrases a receptionist adds without adding content, by group. A group with `cues` is
// allowed only when the client's messages have one of them as a whole word (with a joined و، ف،
// ب or ل). A `lead` group comes only right before a question. None of the phrases answers yes or
// no, accepts, promises, judges or informs. Left out on purpose, since after a client's question
// they read as an answer: «أكيد»، «تمام»، «أبشروا»، «إن شاء الله»، «تفضلوا»، «حياكم الله»، «أهلًا
// وسهلًا»، «لخدمتكم»، «كذلك»، «أيضًا»، «نتفهم ذلك»، «وأنتم بخير»، «الله يصبركم»، "of course",
// "sure", "welcome", "happy to help", "please", "we understand".
// Words of a question on how the case will end: after them, sympathy is not added.
const OUTCOME_CUES = ['أكسب', 'أخسر', 'أربح', 'نكسب', 'نخسر', 'بكسب', 'بخسر', 'يكسب', 'يخسر', 'تكسب', 'تخسر', 'فرصتي', 'فرصتنا',
  'فرصة', 'احتمال', 'موقفي', 'موقفنا', 'قوية', 'ضعيفة', 'win', 'lose', 'losing', 'winning', 'chance', 'chances', 'odds', 'succeed'];
const COURTESY = [
  // After a question on how the case will end, sympathy reads as the answer: not then.
  { name: 'تعاطف، إلا بعد سؤال عن نتيجة القضية', blockedBy: OUTCOME_CUES,
    arabic: ['الله يعينكم', 'الله يكون في عونكم', 'الله يفرج همكم', 'يفرج همكم', 'الله يفرج عنكم', 'الله يسهل أموركم',
    'الله يحفظكم', 'نتفهم وضعكم', 'نتفهم قلقكم', 'نتفهم شعوركم'],
  english: ['we are sorry to hear that', "we're sorry to hear that", 'we are very sorry to hear that',
    "we're very sorry to hear that", 'sorry to hear that', 'we understand your concern'] },
  { name: 'شكر', arabic: ['شكرًا', 'شكرًا لكم', 'شكرًا جزيلًا', 'شكرًا على التوضيح', 'شكرًا للتوضيح', 'شكرًا على توضيحكم',
    'شكرًا على المعلومات', 'شكرًا على تواصلكم', 'شكرًا على تواصلكم معنا', 'شكرًا لتواصلكم', 'شكرًا لتواصلكم معنا', 'نشكر لكم',
    'نشكر لكم التوضيح', 'نشكر لكم توضيح الطلب', 'نشكر لكم تواصلكم', 'نشكركم', 'نشكركم على التوضيح', 'نشكركم على تواصلكم',
    'مشكورين', 'مشكورين على التوضيح', 'يعطيكم العافية', 'الله يعطيكم العافية', 'جزاكم الله خيرًا', 'جزاكم الله خير',
    'الله يجزاكم خير'],
  english: ['thank you', 'thanks', 'thank you very much', 'many thanks', 'thank you for explaining', 'thank you for clarifying',
    'thanks for clarifying', 'thank you for the details', 'thanks for the details', 'thank you for reaching out',
    'thanks for reaching out', 'thank you for contacting us', 'thanks for getting in touch'] },
  { name: 'تمهيد، قبل سؤال مباشرة بعده «:» أو «،»', lead: true, arabic: ['لنتمكن من خدمتكم', 'حتى نتمكن من خدمتكم', 'عشان نخدمكم',
    'عشان نعرف كيف نخدمكم'], english: ['to help you'] },
  { name: 'تحية وربط بالإنجليزية', english: ['hello', 'hi', 'and'] },
  { name: 'بعد ذكر وفاة', cues: ['توفى', 'توفت', 'توفيت', 'توفاه', 'توفاها', 'توفوا', 'متوفى', 'المتوفى', 'وفاة',
    'الوفاة', 'وفاته', 'وفاتها', 'وفاتهم', 'مات', 'ماتت', 'ماتوا', 'المرحوم', 'المرحومة', 'الفقيد', 'الفقيدة', 'يرحمه', 'يرحمها',
    'يرحمهم', 'انتقل إلى رحمة الله', 'انتقلت إلى رحمة الله', 'died', 'deceased', 'passed away'],
  arabic: ['الله يرحمه', 'الله يرحمها', 'الله يرحمهم', 'يرحمه الله', 'يرحمها الله', 'رحمه الله', 'رحمها الله', 'الله يغفر له',
    'الله يغفر لها', 'يغفر له', 'يغفر لها', 'عظم الله أجركم', 'أحسن الله عزاءكم', 'إنا لله وإنا إليه راجعون'],
  english: ['please accept our condolences', 'our condolences', 'our deepest condolences', 'we are sorry for your loss',
    "we're sorry for your loss", 'sorry for your loss', 'may he rest in peace', 'may she rest in peace'] },
  { name: 'بعد ذكر توقيف، إلا بعد سؤال عن الإفراج', blockedBy: [...OUTCOME_CUES, 'أمل', 'يطلع', 'يخرج', 'الإفراج', 'إفراج', 'يفرج'], cues: ['موقوف', 'موقوفة', 'موقوفين', 'توقيف', 'التوقيف', 'مسجون', 'مسجونة', 'سجن', 'السجن', 'سجنوه',
    'سجنوها', 'محبوس', 'محبوسة', 'حبسوه', 'حبسوها', 'محتجز', 'محتجزة', 'احتجاز', 'الاحتجاز', 'قبضوا', 'القبض', 'مقبوض', 'مسكوه',
    'مسكوها', 'detained', 'arrested', 'prison', 'jail', 'custody'],
  arabic: ['الله يفرج عنه', 'الله يفرج عنها', 'الله يفرج عنهم'] },
  { name: 'بعد ذكر مرض', cues: ['مريض', 'مريضة', 'مرضه', 'مرضها', 'المرض', 'تعبان', 'تعبانة', 'مستشفى', 'المستشفى',
    'العناية المركزة', 'منوم', 'منومة', 'تنويم', 'sick', 'hospital', 'hospitalized'],
  arabic: ['سلامتكم', 'ما تشوفون شر', 'الله يشفيه', 'الله يشفيها'] },
  { name: 'ردًا على السلام', cues: ['السلام', 'سلام', 'salam', 'salaam', 'assalam', 'assalamu'],
    arabic: ['وعليكم السلام', 'وعليكم السلام ورحمة الله', 'وعليكم السلام ورحمة الله وبركاته'],
    english: ['wa alaikum assalam', 'walaikum assalam'] },
  { name: 'ردًا على صباح الخير', cues: ['صباح', 'صباحو', 'good morning'], arabic: ['صباح النور', 'صباح الخير'], english: ['good morning'] },
  { name: 'ردًا على مساء الخير', cues: ['مساء', 'مسا', 'مساكم', 'good evening', 'good afternoon'], arabic: ['مساء النور', 'مساء الخير'],
    english: ['good evening', 'good afternoon'] },
  { name: 'في رمضان', cues: ['رمضان', 'ramadan'], arabic: ['رمضان كريم'], english: ['ramadan kareem'] },
  { name: 'ردًا على «رمضان كريم»', cues: ['رمضان كريم'], arabic: ['الله أكرم'] },
  { name: 'في العيد', cues: ['عيد', 'العيد', 'عيدكم', 'عيدك', 'eid'], arabic: ['كل عام وأنتم بخير', 'عيدكم مبارك'], english: ['eid mubarak'] },
  { name: 'ردًا على «جمعة مباركة»', cues: ['جمعة مباركة'], arabic: ['جمعة مباركة'] },
];
const COURTESY_PHRASES = {
  arabic: COURTESY.flatMap((g) => g.arabic || []),
  english: COURTESY.flatMap((g) => g.english || []),
};

const toLatinDigits = (s) => String(s)
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
// Western digits, and no thousands separators: "2,500", "٢٬٥٠٠" and "2500" are one number.
const latinNumbers = (s) => toLatinDigits(s).replace(/(\d)[,٬](?=\d{3}(?!\d))/g, '$1');

// The numbers of a text, each written one way.
function numbers(text) {
  return new Set(latinNumbers(text).match(/\d+(?:[.:]\d+)*/g) || []);
}

// The words of a text in comparison form, with where each one is in the text: letters with their
// marks (dropped by normalizeText), or a number written one way. Any other numeral is a word of
// its own, so it cannot pass unseen. Punctuation is not a word.
const WORD = /[0-9٠-٩۰-۹]+(?:[.:,٬][0-9٠-٩۰-۹]+)*|[\p{L}\p{M}\p{Cf}]+|\p{N}+/gu;
const canon = (w) => (/^[0-9٠-٩۰-۹]/.test(w) ? latinNumbers(w) : normalizeText(w.toLowerCase()));
// A word of a locked sentence is compared as written, its marks included («نقدّر» is not «نقدر»,
// «مدعى» is not «مدعي»): only the tatweel and the case of Latin letters may differ.
const exact = (raw) => (/^[0-9٠-٩۰-۹]/.test(raw) ? latinNumbers(raw) : raw.replace(/ـ/g, '').toLowerCase());
function wordsAt(text) {
  return [...String(text).matchAll(WORD)].map((m) => ({ w: canon(m[0]), x: exact(m[0]), start: m.index, end: m.index + m[0].length })).filter((x) => x.w);
}
const tokensOf = (text) => wordsAt(text).map((x) => x.w);
// The words with single spaces around them, so a phrase is found inside a word («ويحق»،
// «تستحقون») but never across two («من قبل» is not «نقبل»).
const spaced = (text) => ` ${tokensOf(text).join(' ')} `;

// The sentences of a text: cut at . ! ? ؟ : ؛ and line ends, but not inside a number
// ("4.2", "8:30"). Each keeps where it is, its ending punctuation, and whether it was a question.
function sentencesOf(text) {
  const out = [];
  const s = String(text);
  const re = /(?<![0-9٠-٩۰-۹])[.!؟?:؛]+|[.!؟?:؛]+(?![0-9٠-٩۰-۹])|\n+/g;
  let from = 0;
  for (const m of [...s.matchAll(re), { index: s.length, 0: '' }]) {
    const raw = s.slice(from, m.index);
    const body = raw.trim();
    if (body) {
      const start = from + raw.indexOf(body);
      out.push({ text: body, start, end: start + body.length, terminator: m[0].includes('\n') ? '' : m[0], question: /[؟?]/.test(m[0]) });
    }
    from = m.index + m[0].length;
  }
  return out;
}

// One joining «و» or «ف» on the first word of a locked sentence, added or dropped.
const bare = (w) => (w.length > 2 && /^[وف]/.test(w) ? w.slice(1) : w);
const sameFirst = (a, b) => a === b || bare(a) === b || a === bare(b);
// A phrase may get a joining «و» or «ف» in front, never lose its own («وأنتم» is not «أنتم»).
const phraseFirst = (a, b) => a === b || a === `و${b}` || a === `ف${b}`;

const asTokens = (list) => list.map(tokensOf);
const GROUPS = COURTESY.map((g) => ({
  cues: g.cues ? g.cues.map(tokensOf) : null, lead: g.lead === true, blockedBy: (g.blockedBy || []).map(tokensOf),
  arabic: asTokens(g.arabic || []), english: asTokens(g.english || []),
}));
const ALL_PHRASES = GROUPS.flatMap((g) => [...g.arabic, ...g.english]);
// Every character of the phrases, in both cases: what a courtesy addition may be written with.
const PHRASE_CHARS = new Set([...COURTESY_PHRASES.arabic, ...COURTESY_PHRASES.english].join('')
  .split('').flatMap((ch) => [ch, ch.toUpperCase()]));
// Between the sentences and the phrases: spaces, line breaks, full stops, commas; an apostrophe
// only between two letters ("we're").
const FREE_SEPARATOR = /[ \t\u00a0\n.،,'’]/;

// A few separators at a time: a gap is at most six characters, two of them punctuation, so
// nothing is pushed out of sight. Inside a phrase: spaces only, or the apostrophe of "we're", so
// a phrase is never cut by a mark. After a lead-in, before its question: a space, «:»، «،» or «,».
const MAX_GAP = 6;
const PHRASE_GAP = /^(?:[ \t ]+|['’])$/;
const LEAD_GAP = /^[ \t ]*[:،,]?[ \t ]*$/;

// Whether one of the cues is a whole word, or two, of the client's messages. A cue of four
// letters or more may carry a joined و، ف، ب or ل («بالمستشفى»); a shorter one is matched only
// as written («عيد» is not «بعيد» or «وعيد»). «توفى» followed by «ب…» is «fulfils», not «died».
const CUE_PREFIXES = ['', 'و', 'ف', 'ب', 'ل', 'وب', 'ول', 'فب'];
function cued(clientWords, cue) {
  const prefixes = [...cue[0]].length >= 4 ? CUE_PREFIXES : [''];
  for (let i = 0; i + cue.length <= clientWords.length; i++) {
    if (!prefixes.some((p) => clientWords[i] === `${p}${cue[0]}`)) continue;
    if (cue.length === 1 && cue[0] === 'توفي' && /^ب/.test(clientWords[i + 1] || '')) continue;
    let j = 1;
    while (j < cue.length && clientWords[i + j] === cue[j]) j++;
    if (j === cue.length) return true;
  }
  return false;
}

// The phrases allowed in this reply, in its language: those without cues, those whose cue the
// client wrote, and any the approved text has itself. `lead` are the lead-ins the approved text
// does not have: they must come right before a question.
function allowedPhrases(draft, said, version = 'arabic') {
  const clientWords = tokensOf(said.join('\n'));
  const lastWords = tokensOf(said.length ? said[said.length - 1] : '');
  const own = spaced(draft);
  const inDraft = (p) => own.includes(` ${p.join(' ')} `);
  const lang = version === 'english' ? 'english' : 'arabic';
  const plain = []; const lead = [];
  for (const g of GROUPS) {
    const open = (!g.cues || g.cues.some((cue) => cued(clientWords, cue))) && !g.blockedBy.some((cue) => cued(lastWords, cue));
    for (const p of g[lang]) {
      if (inDraft(p)) plain.push(p);
      else if (open) (g.lead ? lead : plain).push(p);
    }
  }
  return { plain, lead };
}

// True when the words are a run of whole phrases (or no words at all). joined(k): whether the
// gap after word k may be inside a phrase (spaces only); by default any gap may.
function courtesyRun(words, phrases = ALL_PHRASES, joined = () => true) {
  const ok = new Array(words.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < words.length; i++) {
    if (!ok[i]) continue;
    for (const p of phrases) {
      if (i + p.length > words.length || !phraseFirst(words[i], p[0])) continue;
      let j = 1;
      while (j < p.length && words[i + j] === p[j] && joined(i + j - 1)) j++;
      if (j === p.length) ok[i + p.length] = true;
    }
  }
  return ok[words.length];
}

// Where the sentence's words are in the text, at or after `from`: { start, skip }, skip being 1
// when an English sentence's leading "and" was dropped. Null when absent.
function findSentence(tokens, words, from) {
  for (const skip of words.length > 1 && words[0] === 'and' ? [0, 1] : [0]) {
    const want = words.slice(skip);
    for (let i = from; i + want.length <= tokens.length; i++) {
      if (!(skip ? tokens[i] === want[0] : sameFirst(tokens[i], want[0]))) continue;
      let j = 1;
      while (j < want.length && tokens[i + j] === want[j]) j++;
      if (j === want.length) return { start: i, skip };
    }
  }
  return null;
}

// Phrases that promise what only the team can give, judge the case, give legal information,
// accept a case, or claim the assistant is a person. A second net under the sentence rule.
const PROMISES = ['تم تأكيد', 'تم الحجز', 'تم حجز', 'تأكد الحجز', 'تأكد موعدكم', 'موعدكم ثابت', 'مضمون', 'نضمن', 'ستكسب',
  'تكسبون', 'نكسب', 'قضيتكم قوية', 'قضيتكم ضعيفة', 'موقفكم قوي', 'موقفكم ضعيف', 'مجانية', 'مجانا', 'خصم', 'confirmed',
  'guarantee', 'you will win', 'free of charge'];
const ADVICE = ['يحق', 'من حقكم', 'من حقك', 'حقوقكم', 'حقوقك', 'تستحق', 'يستحق', 'مستحق لكم', 'ننصح', 'نوصي', 'الأفضل لكم',
  'الأفضل أن', 'يجب عليكم', 'لازم ترفع', 'لازم تقدم', 'عليكم أن', 'القانون', 'قانوني', 'نظامي', 'النظام', 'المادة', 'بموجب',
  'باطل', 'ملزم', 'غير مشروع', 'تعسفي', 'تقادم', 'سقط حق', 'فرصة', 'فرصكم', 'نسبة النجاح', 'تكسب', 'تخسر', 'يحكم لكم',
  'تحكم لكم', 'entitled', 'legally', 'the law', 'by law', 'your rights', 'your right', 'you have the right', 'article',
  'we advise', 'we recommend', 'you should', 'you must', 'your chances', 'you will win', 'you will lose', 'owed'];
const ACCEPT = ['نوافق', 'وافقنا', 'قبلنا', 'نقبل', 'بيقبل', 'سنتولى', 'بنتولى', 'رح نتولى', 'نتولى قضيتكم', 'نتولى القضية',
  'يسعدنا نتولى', 'تم قبول', 'مقبول', 'تمت الموافقة', 'موظف خدمة', 'موظفة خدمة', 'انا موظف', 'we accept', 'we will take',
  'accepted', 'we agree', 'approved', 'represent you', 'i am a person', 'i am a human', 'member of staff'];

const LIST_LINE = /^\s*(?:[-•*·▪–—]|[0-9٠-٩]+\s*[.)\-–])\s+/m;
const LINK = /https?:\/\/\S+|www\.\S+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const squeeze = (s) => s.replace(/[ \t\u00a0]+/g, '').replace(/’/g, "'").replace(/،/g, ',');
const sameMark = (s) => s.replace(/\?/g, '؟');
const codepoint = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const lineBreaks = (s) => (s.match(/\n/g) || []).length;

// draft: the approved text. text: what the model wrote. version: 'arabic' | 'english'.
// banned: the office's banned phrases (config/banned-phrases.json). said: the client's messages
// in the conversation, for the cues of COURTESY; their words are never allowed into the reply.
// Returns { ok, problems }: problems is empty when the text may be sent.
function checkPhrasing(draft, text, { version = 'arabic', banned = [], said = [] } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, problems: ['empty'] };
  const d = String(draft);
  const t = text.trim();
  const problems = [];

  // 1. Characters: only those of the approved text and of the phrases, and the free separators.
  // So no hidden, direction-changing, look-alike or other-script character, nor another way of
  // writing the digits, nor marks piled on a letter, nor blank lines that push text out of sight.
  // («:» is placed by the separator rule below: only right before a question.)
  const known = new Set([...d, ...PHRASE_CHARS, ' ', '\n', '.', '،', ',', "'", '’', ':']);
  const strange = [...new Set([...t].filter((ch) => !known.has(ch)))];
  if (strange.length) problems.push(`new character ${strange.slice(0, 5).map(codepoint).join(' ')}`);
  if (/\p{M}{3,}/u.test(t) && !/\p{M}{3,}/u.test(d)) problems.push('stacked marks');
  if (/\n[ \t]*\n[ \t]*\n/.test(t) || lineBreaks(t) > lineBreaks(d) + 2) problems.push('line breaks');
  if (/[ \t\u00a0]{4,}/.test(t) && !/[ \t\u00a0]{4,}/.test(d)) problems.push('spaces');
  const tatweel = (x) => (x.match(/\u0640/g) || []).length;
  if (tatweel(t) > tatweel(d)) problems.push('tatweel');

  // 2. The locked sentences, whole, in order, with their punctuation and their ending.
  const sentences = sentencesOf(d).map((s) => ({ ...s, at: wordsAt(s.text) })).filter((s) => s.at.length);
  for (const s of sentences) { s.words = s.at.map((x) => x.w); s.exact = s.at.map((x) => x.x); s.free = courtesyRun(s.words); }
  const locked = sentences.filter((s) => !s.free);
  const at = wordsAt(t);
  const tokens = at.map((x) => x.w);
  const exactTokens = at.map((x) => x.x);
  const owner = new Array(tokens.length).fill(null); // the locked sentence a word belongs to
  const startsAt = new Map(); // first word index -> locked sentence
  const covered = new Array(t.length).fill(false); // characters accounted for
  for (const x of at) for (let i = x.start; i < x.end; i++) covered[i] = true;
  let cursor = 0;
  for (const s of locked) {
    const found = findSentence(exactTokens, s.exact, cursor);
    if (!found) { problems.push(`approved sentence changed: ${s.text.slice(0, 50)}`); continue; }
    const { start, skip } = found;
    const end = start + s.words.length - skip;
    for (let i = start; i < end; i++) owner[i] = s;
    startsAt.set(start, s);
    cursor = end;
    // Inside: the draft's punctuation between the same words, spaces aside, no line break.
    for (let k = start; k < end - 1; k++) {
      const draftGap = s.text.slice(s.at[k - start + skip].end, s.at[k - start + skip + 1].start);
      const textGap = t.slice(at[k].end, at[k + 1].start);
      if (squeeze(draftGap) !== squeeze(textGap)) { problems.push(`punctuation changed: ${s.text.slice(0, 50)}`); break; }
      for (let i = at[k].end; i < at[k + 1].start; i++) covered[i] = true;
    }
    // Before it: what the draft has before its first word («(»، «"»), right before it.
    if (!skip) {
      const opening = squeeze(s.text.slice(0, s.at[0].start));
      let i = at[start].start; let k = opening.length; const taken = [];
      while (k > 0 && i > 0) {
        i -= 1;
        if (/[ \t ]/.test(t[i])) continue;
        if (t[i] !== opening[k - 1]) break;
        taken.push(i); k -= 1;
      }
      if (k > 0) problems.push(`sentence opening changed: ${s.text.slice(0, 50)}`);
      else for (const p of taken) covered[p] = true;
    }
    // Right after it: what the draft has after its last word («)») and its ending, first, so a
    // question stays one; a question mark the draft does not have is punctuation added.
    const expected = sameMark(squeeze(s.text.slice(s.at.at(-1).end) + s.terminator));
    const gapEnd = end < at.length ? at[end].start : t.length;
    let i = at[end - 1].end; let k = 0; const taken = [];
    while (k < expected.length && i < gapEnd) {
      if (/[ \t ]/.test(t[i])) { i += 1; continue; }
      if (sameMark(t[i]) !== expected[k]) break;
      taken.push(i); i += 1; k += 1;
    }
    // (The last full stop of the reply may be left out: nothing comes after it.)
    const lastStop = expected.slice(k) === '.' && end === at.length && !t.slice(i).trim();
    if (k === expected.length || lastStop) for (const p of taken) covered[p] = true;
    else if (s.question) problems.push(`question dropped: ${s.text.slice(0, 50)}`);
    else if (/^[ \t ]*[؟?]/.test(t.slice(i, gapEnd))) problems.push(`made a question: ${s.text.slice(0, 50)}`);
    else problems.push(`sentence ending changed: ${s.text.slice(0, 50)}`);
  }

  // 3. Around them: whole phrases, a few, each lead-in right before a question; and between them,
  // only free separators («:» too, right before a question).
  const { plain, lead } = allowedPhrases(d, said.map(String), version);
  const runs = [];
  let words = [];
  let from = 0;
  tokens.forEach((w, i) => {
    if (owner[i] === null) { if (!words.length) from = i; words.push(w); return; }
    if (words.length) { runs.push({ words, from, next: startsAt.get(i) || null }); words = []; }
  });
  if (words.length) runs.push({ words, from, next: null });
  const gapAfter = (i) => t.slice(at[i].end, at[i + 1] ? at[i + 1].start : t.length);
  const bad = [];
  for (const run of runs) {
    // Inside a phrase only spaces (or the apostrophe of "we're"): a mark cuts it.
    const joined = (k) => PHRASE_GAP.test(gapAfter(run.from + k));
    if (courtesyRun(run.words, plain, joined)) continue;
    const withLead = lead.some((p) => {
      const rest = run.words.length - p.length;
      return rest >= 0 && phraseFirst(run.words[rest], p[0]) && p.every((w, j) => j === 0 || (run.words[rest + j] === w && joined(rest + j - 1)))
        && courtesyRun(run.words.slice(0, rest), plain, joined);
    });
    if (!withLead) bad.push(run.words.join(' '));
    // A lead-in leads straight into its question: «عشان نخدمكم: هل…؟».
    else if (!(run.next && run.next.question && LEAD_GAP.test(gapAfter(run.from + run.words.length - 1)))) problems.push(`lead-in not before a question: ${run.words.join(' ').slice(0, 60)}`);
  }
  if (bad.length) problems.push(`new words: ${bad.join(' | ').slice(0, 80)}`);
  const added = runs.reduce((n, run) => n + run.words.length, 0);
  const allowance = sentences.filter((s) => s.free).reduce((n, s) => n + s.words.length, 0) + 8;
  if (added > allowance) problems.push('too much added');
  const nextWord = (i) => at.findIndex((x) => x.start >= i);
  let gap = '';
  for (let i = 0; i <= t.length; i++) {
    if (i < t.length && !covered[i]) {
      gap += t[i];
      const letters = /\p{L}/u.test(t[i - 1] || '') && /\p{L}/u.test(t[i + 1] || '');
      if (FREE_SEPARATOR.test(t[i]) && (!/['’]/.test(t[i]) || letters)) continue;
      if (t[i] === ':' && startsAt.get(nextWord(i))?.question) continue;
      problems.push(`punctuation added: ${t[i]}`);
      break;
    }
    if (gap.length > MAX_GAP || (gap.match(/[^\s]/g) || []).length > 2) { problems.push('separator too long'); break; }
    gap = '';
  }

  // 4. Second net: phrases that must never appear unless the approved text has them.
  const st = spaced(t);
  const sd = spaced(d);
  for (const phrase of [...PROMISES, ...ADVICE, ...ACCEPT, ...banned]) {
    const p = tokensOf(phrase).join(' ');
    if (p && st.includes(p) && !sd.includes(p)) problems.push(`phrase: ${phrase}`);
  }

  const inDraft = numbers(d);
  const inText = numbers(t);
  for (const n of inText) if (!inDraft.has(n)) problems.push(`new number ${n}`);
  for (const n of inDraft) if (!inText.has(n)) problems.push(`missing number ${n}`);
  if (LIST_LINE.test(t)) problems.push('list');
  if (/[{}<>]/.test(t)) problems.push('markup');
  const clean = (x) => x.toLowerCase().replace(/[.,،؟?)]+$/, '');
  const linksOf = (x) => (x.match(LINK) || []).map(clean);
  const emailsOf = (x) => (x.match(EMAIL) || []).map(clean);
  for (const [kind, ofDraft, ofText] of [['link', linksOf(d), linksOf(t)], ['email', emailsOf(d), emailsOf(t)]]) {
    for (const x of ofText) if (!ofDraft.includes(x)) problems.push(`new ${kind}`);
    for (const x of ofDraft) if (!ofText.includes(x)) problems.push(`missing ${kind}`);
  }

  // Links and addresses are Latin in both languages: the language is read from the rest.
  const plainWords = t.replace(LINK, ' ').replace(EMAIL, ' ');
  const arabic = (plainWords.match(/[؀-ۿ]/g) || []).length;
  const latin = (plainWords.match(/[A-Za-z]/g) || []).length;
  if (version === 'arabic' && arabic <= latin) problems.push('not Arabic');
  if (version === 'english' && arabic > latin / 10) problems.push('not English');

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// The allowed phrases as the model reads them, appended to its instructions by server/providers.js.
function courtesySection() {
  const lines = ['## 6. العبارات', '',
    'تختار منها فقط، كل عبارة كما هي في القائمة. المجموعة المشروطة لا تُختار إلا إذا كتب العميل إحدى كلماتها، والمحجوبة لا تُختار بعد آخر رسالة فيها إحدى كلمات الحجب. ما لا يحقق شرطه يُحذف عند التركيب.', ''];
  for (const g of COURTESY) {
    const list = [...(g.arabic || []).map((p) => `«${p}»`), ...(g.english || []).map((p) => `"${p}"`)].join('، ');
    const when = g.cues ? ` (شرطها أن يكتب العميل مثل: ${g.cues.slice(0, 8).join('، ')})` : '';
    const unless = g.blockedBy ? ` (تُحجب بعد سؤال فيه مثل: ${g.blockedBy.slice(0, 8).join('، ')})` : '';
    lines.push(`- ${g.name}${when}${unless}: ${list}.`);
  }
  return lines.join('\n');
}

// ---------- the written reply, put together by the code (DESIGN 4.5) ----------
//
// The model does not write the reply: it chooses, from COURTESY, at most two phrases to open it,
// and a thanks or a lead-in to take the place of the draft's own when it would repeat what the
// assistant already said. The code puts them around the draft's sentences, which it never
// changes. A choice the conversation does not allow (a condolence without a death, a phrase of
// the other language) is left out. The result still goes through checkPhrasing.
const GREETING_GROUPS = new Set(['ردًا على السلام', 'ردًا على صباح الخير', 'ردًا على مساء الخير']);
const THANKS = new Set(COURTESY.filter((g) => g.name === 'شكر').flatMap((g) => [...(g.arabic || []), ...(g.english || [])]));
const LEADS = new Set(COURTESY.filter((g) => g.lead).flatMap((g) => [...(g.arabic || []), ...(g.english || [])]));
const GREETINGS = new Set(COURTESY.filter((g) => GREETING_GROUPS.has(g.name)).flatMap((g) => [...(g.arabic || []), ...(g.english || [])]));
// The values the model may give, for its answer's schema (server/providers.js).
const CHOICES = { all: [...COURTESY_PHRASES.arabic, ...COURTESY_PHRASES.english], thanks: [...THANKS], leads: [...LEADS] };

const joinedKey = (phrase) => tokensOf(phrase).join(' ');
const capitalize = (s, version) => (version === 'english' ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// choice: { opening: [phrases], thanks: phrase | null, lead: phrase | null }.
function composeCourtesy(draft, choice = {}, { version = 'arabic', said = [] } = {}) {
  const d = String(draft);
  const lang = version === 'english' ? 'english' : 'arabic';
  const { plain, lead } = allowedPhrases(d, said.map(String), version);
  const allowed = new Set([...plain, ...lead].map((p) => p.join(' ')));
  const ofLanguage = new Set(COURTESY_PHRASES[lang].map(joinedKey));
  const ok = (phrase) => typeof phrase === 'string' && ofLanguage.has(joinedKey(phrase)) && allowed.has(joinedKey(phrase));
  const own = spaced(d);
  const sentences = sentencesOf(d).map((s) => ({ ...s, words: tokensOf(s.text) }));
  const freeOf = (set) => sentences.find((s) => s.words.length && courtesyRun(s.words, [...set].map(tokensOf)));
  // Replacements of the draft's own thanks and lead-in, kept in place with their punctuation.
  const swaps = [];
  const thanksAt = freeOf(THANKS);
  if (thanksAt && THANKS.has(choice.thanks) && ok(choice.thanks)) swaps.push([thanksAt, choice.thanks]);
  const leadAt = freeOf(LEADS);
  if (leadAt && LEADS.has(choice.lead) && ok(choice.lead)) swaps.push([leadAt, choice.lead]);
  let text = d;
  for (const [s, phrase] of swaps.sort((a, b) => b[0].start - a[0].start)) {
    text = text.slice(0, s.start) + capitalize(phrase, version) + text.slice(s.end);
  }
  // The opening: at most two phrases the draft does not have (a thanks only when the draft has
  // none); a reply to a greeting first, the others after the draft's welcome sentence when it
  // opens with one. Lead-ins only take the place of the draft's own.
  const opening = [...new Set(Array.isArray(choice.opening) ? choice.opening : [])]
    .filter((p) => ok(p) && !LEADS.has(p) && !(THANKS.has(p) && thanksAt) && !own.includes(` ${joinedKey(p)} `)).slice(0, 2);
  const greetingAlready = sentences[0] && [...GREETINGS].some((g) => ` ${sentences[0].words.join(' ')} `.includes(` ${joinedKey(g)} `));
  const greet = opening.find((p) => GREETINGS.has(p) && !greetingAlready);
  const rest = opening.filter((p) => !GREETINGS.has(p));
  if (rest.length) {
    // «الله يعينكم، الله يسهل أموركم.» / "We're sorry to hear that. Our condolences."
    const block = version === 'english' ? rest.map((p) => `${capitalize(p, version)}.`).join(' ') : `${rest.join('، ')}.`;
    const first = sentencesOf(text)[0];
    const welcome = first && !first.question && (/حياكم الله في|welcome to/i.test(first.text)
      || [...GREETINGS].some((g) => ` ${tokensOf(first.text).join(' ')} `.includes(` ${joinedKey(g)} `)));
    if (welcome) {
      const at = first.end + first.terminator.length;
      text = `${text.slice(0, at)} ${block}${text.slice(at)}`;
    } else text = `${block} ${text}`;
  }
  if (greet) text = version === 'english' ? `${capitalize(greet, version)}. ${text}` : `${greet}، ${text}`;
  return text;
}

// ---------- the questions, said the way a person says them ----------
//
// The project owner's decision of 16 November 2026, after the office's first trial («عاوز بني
// آدم بيكلمني»): the flow still decides what is asked and where the conversation goes, and every
// statement (the welcome, a price, a decline, an offer, a referral) still reaches the client word
// for word. A question is different: the office's wording is what to ask, and the model may ask
// it as a receptionist would on WhatsApp, in the client's own register. Each rewritten question
// is checked here on its own, and one that fails goes out in the office's wording.

// Words that carry no content of a question: asking words, prepositions, pronouns, fillers.
const FUNCTION_WORDS = new Set(['هل', 'ما', 'ماذا', 'من', 'في', 'على', 'الى', 'عن', 'مع', 'او', 'ام', 'اذا', 'ان', 'كم', 'متى', 'اين',
  'كيف', 'لماذا', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'اللي', 'وش', 'ايش', 'وين', 'ليش', 'لو', 'حتى', 'ثم', 'قد', 'كان', 'يوجد', 'توجد',
  'فيه', 'عندك', 'عندكم', 'لديكم', 'ممكن', 'يمكن', 'تقدر', 'تقدرون', 'the', 'and', 'for', 'are', 'you', 'your', 'what', 'when', 'where',
  'which', 'how', 'does', 'did', 'has', 'have', 'there', 'any', 'this', 'that', 'with', 'from', 'was', 'were', 'will', 'can', 'could'].map(normalizeText));
// A word without its joined particles and pronouns, so «طلبكم» and «طلبك», «باستشارة» and
// «استشارة» count as one word. Rough on purpose: it only compares two wordings of one question.
const stem = (word) => {
  let w = word.replace(/^[وف]?(?:بال|لل|ال|ب|ل)?/, '');
  if (w.length < 3) w = word;
  const cut = w.replace(/(?:كم|هم|ها|نا|ون|ين|ات|ك|ه|ي)$/, '');
  return cut.length >= 3 ? cut : w;
};
const contentWords = (text) => [...new Set(tokensOf(text).filter((w) => w.length >= 3 && !/^\d/.test(w) && !FUNCTION_WORDS.has(w)).map(stem))];

// Words that answer, agree or reassure when put before a question («أبشر، وش مشكلتك؟» after the
// client asked whether the office will take his case reads as yes).
const ANSWER_WORDS = ['ابشر', 'ابشروا', 'اكيد', 'بالتاكيد', 'طبعا', 'تمام', 'ان شاء الله', 'باذن الله', 'لا تشيل هم', 'لا تقلق', 'ولا يهمك',
  'of course', 'sure', 'certainly', "don't worry", 'no problem'];
const REWRITE_MARKS = new Set([' ', '؟', '?', '،', ',', '.', ':', '؛', '(', ')', '«', '»', '"', "'", '’', '-', '/', '٪', '%']);

// approved: the office's wording of one question. rewrite: the model's. { ok, problems }.
function checkRewrite(approved, rewrite, { version = 'arabic', banned = [] } = {}) {
  if (typeof rewrite !== 'string' || !rewrite.trim()) return { ok: false, problems: ['empty'] };
  const a = String(approved);
  const r = rewrite.trim();
  const problems = [];
  if (/\n/.test(r)) problems.push('line break');
  if (r.length > Math.max(160, a.length * 2)) problems.push('too long');
  // Characters: letters of the reply's language (and the Latin words the office's wording has),
  // digits and plain punctuation. Nothing hidden, no other script, no emoji, no list or link.
  const ownLatin = new Set((a.match(/[A-Za-z]+/g) || []).map((w) => w.toLowerCase()));
  for (const word of r.match(/[A-Za-z]+/g) || []) if (version !== 'english' && !ownLatin.has(word.toLowerCase())) { problems.push('other script'); break; }
  const strange = [...new Set([...r].filter((ch) => !REWRITE_MARKS.has(ch) && !/[ء-غف-ْA-Za-z0-9٠-٩]/.test(ch)))];
  if (strange.length) problems.push(`new character ${strange.slice(0, 5).map(codepoint).join(' ')}`);
  if (version === 'english' && /[؀-ۿ]/.test(r)) problems.push('other script');
  if (/\p{M}{3,}/u.test(r)) problems.push('stacked marks');
  if (LINK.test(r) || EMAIL.test(r)) problems.push('link');
  LINK.lastIndex = 0; EMAIL.lastIndex = 0;
  // It stays a question, and does not become several more.
  const marks = (s) => (s.match(/[؟?]/g) || []).length;
  if (!/[؟?]$/.test(r)) problems.push('not a question');
  if (marks(r) > marks(a) + 1) problems.push('more questions');
  // No number the office's wording does not have: no price, no date, no percentage.
  const own = numbers(a);
  if ([...numbers(r)].some((n) => !own.has(n))) problems.push('new number');
  // Nothing that promises, advises, accepts the case or answers, unless the office wrote it.
  const had = spaced(a); const has = spaced(r);
  const squeezed = (s) => normalizeText(String(s).toLowerCase());
  for (const phrase of [...PROMISES, ...ADVICE, ...ACCEPT, ...ANSWER_WORDS]) {
    const key = tokensOf(phrase).join(' ');
    if (key && has.includes(key) && !had.includes(key)) { problems.push(`not allowed: ${phrase}`); break; }
  }
  if (banned.some((p) => squeezed(r).includes(squeezed(p)) && !squeezed(a).includes(squeezed(p)))) problems.push('banned phrase');
  // The same question: a long one keeps at least a quarter of its content words (the options of
  // a choice, the thing asked about). A short one («ما موضوع طلبكم باختصار؟») has too few to count.
  const wanted = contentWords(a);
  if (wanted.length >= 4) {
    const kept = new Set(contentWords(r));
    if (wanted.filter((w) => kept.has(w)).length / wanted.length < 0.25) problems.push('another question');
  }
  return { ok: problems.length === 0, problems };
}

// The parts of a message the model may reword: its questions.
const rewritable = (replies, id) => Boolean(replies && replies.replies && replies.replies[id] && replies.replies[id].kind === 'question');
// Arabic only: in the trial of 16 November an English rewording changed who owes whom («how much
// are they claiming you owe?»), which no word count catches; English clients are few, and their
// questions go out in the office's wording.
const questionsOf = (message, replies, version = 'arabic') => (version === 'arabic'
  ? ((message && message.parts) || []).filter((part) => rewritable(replies, part.id)).map((part) => ({ id: part.id, text: part.text })) : []);

// The reply as it is sent: the message's questions in the model's wording where it passed the
// check, the rest of the message word for word, and the courtesy phrases around it.
// message: { parts, text } of the flow. choice: the model's { opening, thanks, lead, questions }.
// Returns { base, text, rewritten, problems }: `base` is what checkPhrasing compares `text` with.
function humanize(message, choice = {}, { version = 'arabic', said = [], banned = [], replies = null } = {}) {
  const problems = [];
  let parts = (message && message.parts) || [];
  let rewritten = 0;
  const offered = Array.isArray(choice.questions) ? choice.questions.filter((q) => q && typeof q.id === 'string' && typeof q.text === 'string') : [];
  if (replies && offered.length && version === 'arabic') {
    let afterQuestion = false;
    parts = parts.map((part) => {
      const follows = afterQuestion;
      afterQuestion = rewritable(replies, part.id);
      const mine = rewritable(replies, part.id) && offered.find((q) => q.id === part.id);
      if (!mine || !mine.text.trim() || mine.text.trim() === String(part.text).trim()) return part;
      const check = checkRewrite(part.text, mine.text, { version, banned });
      if (!check.ok) { problems.push(...check.problems.map((p) => `${part.id}: ${p}`)); return part; }
      rewritten += 1;
      // The code joins a question to the one before it with «و»: one the model already began
      // with it («وهل…», «وبالنسبة…») would read «ووهل».
      const own = follows ? mine.text.trim().replace(/^و(?=(?:هل|كم|متى|ما|ماذا|أين|اين|كيف|لماذا|ليش|إذا|اذا|بالنسبة|عندك|عندكم|فيه|في|أي|اي|من)[\s،])/, '') : mine.text.trim();
      return { ...part, text: own.replace(/\?$/, version === 'english' ? '?' : '؟').replace(/[ \t ]+/g, ' ') };
    });
  }
  const base = rewritten ? joinParts(parts, version, replies) : String(message.text);
  return { base, text: composeCourtesy(base, choice, { version, said }), rewritten, problems };
}

module.exports = { checkPhrasing, composeCourtesy, numbers, sentencesOf, tokensOf, courtesyRun, allowedPhrases, courtesySection, COURTESY, COURTESY_PHRASES, CHOICES, PROMISES, ADVICE,
  checkRewrite, humanize, questionsOf, contentWords };
