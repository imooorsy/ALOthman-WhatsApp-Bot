'use strict';
// The checks of a reply the model wrote when it runs the conversation itself (CONVERSATION=agent,
// server/agent.js; the project owner's decision of 18 November 2026). The model writes each reply
// from the office's file (ai/prompts/office.md), and none reaches the client before it passes:
// - every number is the office's (its prices, its contact data and hours, its awards: sections 4,
//   13 and 16.1 to 16.3 of the file) or the client's own: no threshold, no statutory period, no
//   article, no price the file does not have (16.4 lists numbers the office says are wrong);
// - no price written in words, which the numbers could not check;
// - no phrase the file forbids (13, 5.3), no promise and no judgment of the case, no word of the
//   office's banned list (config/banned-phrases.json);
// - every link, site and e-mail address is the office's (16.1);
// - the language is the one the model says it wrote in, the length a WhatsApp message's, and no
//   hidden or direction-changing character, nor any symbol outside plain punctuation.
// A reply that fails is asked for again once with the reasons, then a safe reply goes out instead
// (server/engine.js). What the checks cannot see: a price that belongs to another service than the
// one named (both are the office's numbers), and the meaning of a sentence.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeText } = require('./normalize');
const banned = require('../../config/banned-phrases.json');

const OFFICE_FILE = path.join(__dirname, '..', 'prompts', 'office.md');
const readOffice = () => fs.readFileSync(OFFICE_FILE, 'utf8');

// The text of a section of the office's file, from its heading to the next heading of the same
// level or a higher one. `heading` is the heading's number with its marks: '## 4.' or '### 16.1'.
function sectionOf(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${heading} `));
  if (start < 0) return '';
  const level = heading.match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const mark = lines[i].match(/^(#+)\s/);
    if (mark && mark[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const toLatinDigits = (s) => String(s)
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

// The numbers of a text, each written one way: Western digits, no thousands separators and no
// leading zero («2,500», «٢٬٥٠٠» and «2500» are 2500; «8:30» is 8 and 30; «+966 11» is 966 and 11).
function numbersOf(text) {
  const plain = toLatinDigits(text).replace(/(\d)[,٬](?=\d{3}(?!\d))/g, '$1');
  return [...new Set((plain.match(/\d+(?:\.\d+)?/g) || []).map((n) => n.replace(/^0+(?=\d)/, '')))];
}

// The amounts a client said, also as they are written back to him: «120 ألف» is 120 and 120000,
// «عشرين ألف» 20000, «مليون ونص» 1500000 (section 1.9 of the office's file). Over-reading is
// harmless here: these numbers only become numbers the reply may contain.
const UNITS = { 'واحد': 1, 'اثنين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5, 'ست': 6, 'سته': 6, 'سبع': 7, 'سبعه': 7,
  'ثمان': 8, 'ثمانيه': 8, 'تسع': 9, 'تسعه': 9, 'عشر': 10, 'عشره': 10, 'عشرين': 20, 'ثلاثين': 30, 'اربعين': 40, 'خمسين': 50, 'ستين': 60,
  'سبعين': 70, 'ثمانين': 80, 'تسعين': 90, 'ميه': 100, 'مايه': 100, 'مائه': 100, 'مئه': 100, 'ميتين': 200, 'مئتين': 200, 'ثلاثميه': 300,
  'ثلاثمائه': 300, 'اربعميه': 400, 'اربعمائه': 400, 'خمسميه': 500, 'خمسمائه': 500, 'ستميه': 600, 'ستمائه': 600, 'سبعميه': 700,
  'سبعمائه': 700, 'ثمانميه': 800, 'ثمانمائه': 800, 'تسعميه': 900, 'تسعمائه': 900 };
const SCALES = { 'الف': 1000, 'الاف': 1000, 'k': 1000, 'مليون': 1000000, 'ملايين': 1000000 };
const PAIRS = { 'الفين': 2000, 'مليونين': 2000000 };
function amountsSaid(text) {
  const out = new Set(numbersOf(text));
  const words = toLatinDigits(text).toLowerCase().replace(/(\d)[,٬](?=\d{3}(?!\d))/g, '$1').split(/[^\p{L}\p{N}.]+/u).filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : normalizeText(w)));
  let value = 0; // the units gathered before a scale word («مية وعشرين» ألف)
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i];
    const w = /^\d/.test(raw) ? raw : raw.replace(/^و(?=.{2})/, '');
    if (/^\d+(?:\.\d+)?$/.test(w)) { value = Number(w); continue; }
    if (Object.hasOwn(UNITS, w)) { value += UNITS[w]; continue; }
    if (Object.hasOwn(PAIRS, w)) { out.add(String(PAIRS[w])); value = 0; continue; }
    if (Object.hasOwn(SCALES, w)) {
      const scale = SCALES[w];
      let amount = (value || 1) * scale;
      if (/^(ونص|نص|ونصف)$/.test(words[i + 1] || '')) amount += scale / 2;
      out.add(String(Math.round(amount)));
      value = 0;
      continue;
    }
    value = 0;
  }
  return [...out];
}

// The parts of the office's file the client may be told numbers from: the prices (4), the ready
// replies (13), the contact data and hours, the consultations' length, and the awards (16.1 to
// 16.3). Not 16.4 (numbers the office says are wrong), nor the thresholds and periods elsewhere.
// The headings' own numbers and the replies' names (R1 to R20) are not numbers said to anyone.
const CLIENT_SECTIONS = ['## 4.', '## 13.', '### 16.1', '### 16.2', '### 16.3'];
function clientFacing(text) {
  return CLIENT_SECTIONS.map((heading) => sectionOf(text, heading)).join('\n')
    .split('\n').filter((line) => !/^#/.test(line)).join('\n').replace(/R\d+(?:[–-]R\d+)?/g, ' ')
    // References to other parts of the file («السجل 14», «القسمين 3 و 16»).
    .replace(/\S*(?:قسم|سجل|بطاق)\S*\s+[\d.]+(?:\s*(?:و|إلى|-|–)\s*[\d.]+)?/g, ' ');
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s،,)»"'<>]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const DOMAIN = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|sa|io|co|me|info|biz|app|link|ly|ai|gov|edu)\b/gi;
const cleanAddress = (value) => String(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[./]+$/, '');
function addressesOf(text) {
  const found = [...(String(text).match(LINK) || []), ...(String(text).match(EMAIL) || []), ...(String(text).match(DOMAIN) || [])];
  return [...new Set(found.map(cleanAddress))];
}

// The office's data the checks use, read once from its file.
function officeData(text = readOffice()) {
  const facing = clientFacing(text);
  const contact = ['### 16.1', '### 16.2', '### 16.3'].map((heading) => sectionOf(text, heading)).join('\n');
  return {
    numbers: new Set(numbersOf(facing)),
    addresses: new Set(addressesOf(contact)),
    latin: new Set((text.match(/[A-Za-z]+/g) || []).map((w) => w.toLowerCase())),
  };
}
let cached = null;
const office = () => (cached ||= officeData());

// Words in comparison form: letters without their marks, the forms of alef, ta marbuta and alef
// maqsura made one (ai/src/normalize.js), Latin in lower case.
const wordsOf = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => normalizeText(w)).filter(Boolean);

// What the client may not be told. Each is matched as whole words, each word also with an ending
// («مضمونة» for «مضمونه», «تستحقون» for «تستحق») and after a joined «و» or «ف».
const FORBIDDEN = [
  // The office's file, sections 13 and 5.3.
  'قضيتك قوية', 'قضيتك ضعيفة', 'قضيتكم قوية', 'قضيتكم ضعيفة', 'موقفك قوي', 'موقفك ضعيف', 'ستكسب', 'بتكسب', 'تكسب القضية',
  'سقطت', 'بالتقادم', 'فات الموعد', 'فاتك الموعد', 'فاتت المدة', 'محتال', 'نصاب', 'حدنا الأدنى', 'الحد الأدنى', 'النظام يعطيك',
  'لا تسمع دعواك', 'لا تقبل دعواك',
  // 1.5 and 16.2: nothing is confirmed before the team confirms it.
  'تم تأكيد الحجز', 'تم تأكيد موعدك', 'تم تأكيد الموعد', 'تم الحجز', 'تم حجز', 'تم ضبط موعدك', 'موعدك مؤكد', 'حجزك مؤكد',
  // No promise, no judgment of the case, no legal advice (1.5).
  'نضمن', 'مضمونة', 'حقك مضمون', 'فرصتك', 'فرصتكم', 'فرص الكسب', 'نسبة النجاح', 'يحق لك', 'يحق لكم', 'من حقك', 'من حقكم',
  'تستحق', 'ننصحك برفع', 'لازم ترفع', 'يجب أن ترفع',
  // The project owner's decision of 16 November 2026.
  'المساعد الذكي',
  'guarantee', 'you will win', 'strong case', 'weak case', 'entitled', 'time barred', 'statute of limitations', 'scammer', 'fraudster',
  'booking is confirmed', 'appointment is confirmed', 'smart assistant', 'ai assistant',
  // The office's list.
  ...(banned.phrases || []),
].map((phrase) => ({ phrase, words: wordsOf(phrase) })).filter((p) => p.words.length);

const bare = (w) => (w.length > 2 && /^[وف]/.test(w) ? w.slice(1) : w);
// A promise said in the negative is no promise («ما نقدر نضمن نتيجة القضية», "we cannot guarantee").
const NEGATABLE = new Set(['نضمن', 'مضمونه', 'حقك مضمون', 'ستكسب', 'بتكسب', 'تكسب القضيه', 'نسبه النجاح', 'guarantee', 'you will win']
  .map((p) => wordsOf(p).join(' ')));
const NEGATIONS = new Set(['ما', 'لا', 'لن', 'مو', 'مش', 'ليس', 'ليست', 'غير', 'بدون', 'دون', 'not', 'cannot', 'cant', 'can', 'no', 'never', 'dont', 't']);
function negated(words, i) {
  return words.slice(Math.max(0, i - 3), i).some((w) => NEGATIONS.has(bare(w)) || /^(مانقدر|مانستطيع|مانضمن|لانستطيع|لايمكن|مايمكن)$/.test(w));
}
function containsPhrase(words, phraseWords) {
  const key = phraseWords.join(' ');
  for (let i = 0; i + phraseWords.length <= words.length; i += 1) {
    if (phraseWords.every((p, k) => words[i + k].startsWith(p) || bare(words[i + k]).startsWith(p))) {
      if (NEGATABLE.has(key) && negated(words, i)) continue;
      return true;
    }
  }
  return false;
}

// A price in words: a number word just before «ريال» or after «SAR».
const NUMBER_WORDS = new Set(['الف', 'الاف', 'الفين', 'الفان', 'ميه', 'مايه', 'مائه', 'مئه', 'ميتين', 'مئتين', 'مليون', 'ملايين', 'عشره', 'عشرين',
  'ثلاثين', 'اربعين', 'خمسين', 'ستين', 'سبعين', 'ثمانين', 'تسعين', 'خمسميه', 'خمسمائه', 'سبعميه', 'سبعمائه', 'ثلاثميه', 'ثلاثمائه',
  'اربعميه', 'اربعمائه', 'ستميه', 'ستمائه', 'ثمانميه', 'ثمانمائه', 'تسعميه', 'تسعمائه', 'thousand', 'hundred', 'million']);
// A number written in digits next to the word («120 ألف ريال») is a number the other check reads.
function priceInWords(words) {
  const spelled = (window) => window.some((x) => NUMBER_WORDS.has(bare(x).replace(/^ب/, ''))) && !window.some((x) => /^\d/.test(x));
  return words.some((w, i) => (/^(ريال|ريالا|ريالات|sar|riyal|riyals)$/.test(bare(w)) && spelled(words.slice(Math.max(0, i - 3), i)))
    || (/^(sar|riyals?)$/.test(w) && spelled(words.slice(i + 1, i + 4))));
}

// Plain letters, digits and punctuation: the Arabic block (its letters, marks, tatweel, digits
// and punctuation, without its invisible signs), Latin letters, Western digits. The direction
// marks (LRM, RLM, ALM) are dropped before the check, since a phone number may carry one. Any other
// invisible or direction-changing character, another script's digits (which the numbers' check
// would not read), a look-alike presentation form, an emoji or a symbol is refused.
const DIRECTION_MARKS = /[‎‏؜]/g;
const ALLOWED_CHARACTER = /[؆-؛؝-ۿA-Za-z0-9 \n.,:;!?'"()«»\-–—/%+@&_’‘“”…]/;
const STACKED_MARKS = /[ً-ٰٟ]{3,}/;

// The questions of a text, each as its words of substance: the part before each question mark,
// from the sentence's start. «ما»، «هل»، «كم»، the conjunctions and the courtesy words are left out,
// and the article and a joined «و» or «ف» are dropped, so that «هل صدر صك حصر ورثة؟» and «وهل صدر
// صك حصر الورثة؟» are one question.
const QUESTION_STOP = new Set(['هل', 'ما', 'ماذا', 'كم', 'متي', 'اين', 'وين', 'وش', 'ايش', 'كيف', 'ليش', 'لماذا', 'في', 'من', 'علي', 'عن', 'الي', 'او', 'ام',
  'لك', 'لكم', 'عندك', 'عندكم', 'لديك', 'لديكم', 'تقريبا', 'يوجد', 'فيه', 'هذا', 'هذه', 'ذلك', 'اللي', 'الذي', 'التي', 'انت', 'انتم', 'ممكن', 'لو',
  'سمحت', 'طيب', 'تمام', 'شكرا', 'للتوضيح', 'عذرا', 'اقصد', 'يعني', 'بس', 'تقدر', 'تقدرون', 'هو', 'هي', 'كان', 'كانت', 'قد', 'مع', 'بالنسبه',
  'اذا', 'ان', 'انه', 'انها', 'بعد', 'قبل', 'الان', 'حاليا', 'الحين', 'معك', 'معكم', 'تذكر', 'تذكرون', 'تعرف', 'تعرفون', 'ذكرت', 'ذكرتم']);
const stem = (w) => { let x = bare(w); if (x.length > 4 && x.startsWith('ال')) x = x.slice(2); return x; };
function questionsOf(text) {
  return String(text).split(/[؟?]/).slice(0, -1).map((part) => part.split(/[.!\n:]/).pop().trim())
    .map((part) => Object.assign(new Set(wordsOf(part).map(stem).filter((w) => w.length > 1 && !QUESTION_STOP.has(w))), { text: part }))
    .filter((words) => words.size >= 2);
}
const sameQuestion = (a, b) => { let shared = 0; for (const w of a) if (b.has(w)) shared += 1; return shared / Math.min(a.size, b.size) >= 0.75; };
// The questions of a reply already asked `limit` times in the assistant's earlier messages.
function askedTooOften(text, previous, limit) {
  const earlier = previous.map(questionsOf);
  return questionsOf(text).filter((q) => earlier.filter((asked) => asked.some((p) => sameQuestion(q, p))).length >= limit);
}
// Whether the client's last words ask what was meant («وش تقصد؟»، «ما فهمت»): the question is then
// explained, once more than it would be asked.
const asksBack = (text) => /[؟?]/.test(String(text)) || wordsOf(text).some((w) => ['وش', 'ايش', 'تقصد', 'قصدك', 'فهمت', 'افهم', 'يعني', 'اي', 'what', 'mean'].includes(bare(w)));

// A value that says nothing was answered («غير مذكور»): not the client's answer.
const PLACEHOLDER = /^(?:لا (?:توجد|يوجد) (?:معلومات|ذكر)|غير (?:مذكور|محدد|معروف|واضح|مؤكد)|لم (?:يذكر|يُذكر|يحدد|يُحدد|يوضح|يُوضح|يجب|يُجب)|ناقص|لا يوجد ذكر|[-—?؟]+$)/;
// The client's answer written down: a new value that is no such note and shares a word of
// substance with his last message («غير مقتنع بالحكم فقط» from «مو مقتنع بالحكم بس»).
// The client says he knows no more than he said («ما عندي معلومات غير اللي قلتها لك»، «ما أدري»):
// what he was just asked, he does not know.
const NO_MORE = /ما\s*(?:عندي|عندى|اعرف|أعرف|ادري|أدري)\s*(?:معلومات|معلومه|معلومة|شي|شيء|غير|اكثر|أكثر|زياده|زيادة)?|مدري|لا\s*(?:اعرف|أعرف|ادري|أدري)|مش\s*عارف|معنديش|ماعندي|i don'?t know|no more (?:info|information)/i;
const answeredNow = (now, before, last = '') => {
  const value = String((now && now.value) || '').trim();
  if (!value || value === String((before && before.value) || '').trim() || PLACEHOLDER.test(value)) return false;
  const said = new Set(wordsOf(last).map(stem).filter((w) => w.length > 2 && !QUESTION_STOP.has(w)));
  return wordsOf(value).map(stem).some((w) => said.has(w));
};

// A service offered to the client («نقدر نعدّ لك التظلم، يناسبك؟») without its price or the words
// that its fees are set after the team's review (step 10 of 2.1, R8, R16). A choice of goals (R2,
// «... أم أن نتولى القضية؟») is no offer; nor one whose price the message before gave.
const OFFER_VERBS = /^ن(?:عد|جهز|صيغ|كتب|رفع|راجع|حضر|قدم|حجز)(?:ه|ها|هم)?$/;
const PRICE = /[0-9٠-٩][0-9٠-٩,٬.]*\s*(?:ريال|ر\.س|sar|riyal)/i;
const FEES_LATER = /أتعاب|اتعاب|تُسعّر|تسعر|تُسعر|يُسعّر|يسعر|عرض سعر|بعرض|fees/i;
function offersWithoutPrice(text, previous = []) {
  if (!/[؟?]/.test(text) || PRICE.test(text) || FEES_LATER.test(text)) return false;
  const words = wordsOf(text);
  if (words.includes('ام')) return false;
  const offer = words.some((w, i) => OFFER_VERBS.test(bare(w)) && (['لك', 'لكم'].includes(words[i + 1]) || ['ان', 'نقدر', 'نستطيع', 'ممكن'].includes(words[i - 1])));
  if (!offer) return false;
  const last = previous[previous.length - 1] || '';
  return !PRICE.test(last) && !FEES_LATER.test(last);
}

// Whether a reply claims the request went, or goes, to the team.
function claimsReferral(text) {
  const plain = String(text).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').toLowerCase();
  return /احيل|احلت|احلنا|سارفع|ارفعه للفريق|رفعت طلب|ارفع طلبك|سيتواصل معك|سيتواصل معكم|سيتواصلون|يتواصلون معك|يتواصل معك الفريق|will contact you|passed your request|referred your/.test(plain);
}

// output: the model's answer { reply, action, language }. said: the client's messages of the
// conversation (his own numbers, links and words may be said back to him). previous: the
// assistant's earlier replies, oldest first: a question is asked twice at most (section 1.4 of the
// office's file), three times when the client's last message asks what it meant.
// Returns { ok, problems, text }: `text` is the reply with the direction marks dropped and the
// blank lines squeezed, what goes out when `ok`. The problems are worded for the model, which is
// asked again with them.
function checkAgentReply(output, { said = [], previous = [], memory = null, progress = null, data = office() } = {}) {
  const problems = [];
  const action = output && output.action;
  const raw = output && typeof output.reply === 'string' ? output.reply : null;
  if (raw === null) return { ok: false, problems: ['لا يوجد حقل reply نصي'], text: '' };
  const text = raw.replace(DIRECTION_MARKS, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (action === 'silent') return text ? { ok: false, problems: ['action هي silent والرد ليس فارغًا'], text } : { ok: true, problems: [], text: '' };
  if (!text) return { ok: false, problems: ['الرد فارغ وaction ليست silent'], text };

  if (text.length > 1200) problems.push('الرد أطول من رسالة واتساب: اختصره إلى خمسة أسطر على الأكثر');
  if (text.split('\n').filter((line) => line.trim()).length > 8) problems.push('الرد فيه أسطر كثيرة: خمسة أسطر على الأكثر');
  const strange = [...new Set([...text].filter((ch) => !ALLOWED_CHARACTER.test(ch)))];
  if (strange.length) problems.push(`حروف أو رموز غير مسموحة: ${strange.slice(0, 5).map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}`);
  if (STACKED_MARKS.test(text)) problems.push('تشكيل متراكم على حرف واحد');

  const clientText = said.join('\n');
  const clientNumbers = new Set(amountsSaid(clientText));
  const unknown = numbersOf(text).filter((n) => !data.numbers.has(n) && !clientNumbers.has(n));
  if (unknown.length) problems.push(`أرقام ليست من القسمين 4 و16 ولا من كلام العميل: ${unknown.slice(0, 6).join('، ')}`);

  const words = wordsOf(text);
  if (priceInWords(words)) problems.push('سعر مكتوب بالحروف: اكتب الأسعار بالأرقام كما في القسم 4');
  const clientAddresses = new Set(addressesOf(clientText));
  const foreign = addressesOf(text).filter((a) => !data.addresses.has(a) && !clientAddresses.has(a));
  if (foreign.length) problems.push(`روابط أو عناوين بريد ليست من القسم 16.1: ${foreign.slice(0, 3).join('، ')}`);
  const hit = FORBIDDEN.filter((f) => containsPhrase(words, f.words)).map((f) => f.phrase);
  if (hit.length) problems.push(`عبارات ممنوعة: ${hit.slice(0, 4).map((p) => `«${p}»`).join('، ')}`);
  // From here to the threshold, the checks of the conversation's conduct (questions asked again, the
  // memory, the price of an offer, the questions after the threshold): what the client reads is safe
  // with them, so the server sends a reply that fails only these on its last attempt rather than
  // the safe reply (server/engine.js).
  const conductFrom = problems.length;
  const repeated = askedTooOften(text, previous, asksBack(said[said.length - 1] || '') ? 3 : 2);
  if (repeated.length) problems.push(`سألت هذا السؤال مرتين من قبل ولم يجب عنه: «${repeated[0].text}؟». لا تسأله مرة أخرى: اتركه للموظف المختص وانتقل لما بعده، أو أحل الطلب بما جمعته`);

  // The memory (server/agent.js): no question about a fact it holds as known, nor about one asked
  // twice already (three times when the client's last message asks what it meant); and, once there
  // is a sheet, a reply that asks names what it asks about.
  if (memory) {
    const keyOf = (field) => normalizeText(String(field || '').toLowerCase());
    const asking = Array.isArray(output.asking_about) ? output.asking_about.filter((f) => keyOf(f)) : [];
    const limit = asksBack(said[said.length - 1] || '') ? 3 : 2;
    for (const field of asking) {
      const now = memory.after && memory.after[keyOf(field)];
      const before = memory.before && memory.before[keyOf(field)];
      if (now && now.status === 'معروف' && now.value) { problems.push(`تسأل عن «${field}» وهو معروف من كلام العميل («${now.value}»): لا تسأل عنه`); break; }
      if (now && now.status === 'ناقص' && before && (before.asked || 0) >= 1 && answeredNow(now, before, said[said.length - 1] || '')) { problems.push(`سجلت جواب العميل عن «${field}» («${now.value}»): جوابه يحسم البند ولو لم يكن ما تنتظره، فاكتبه «معروف» واحسم عليه بما يقوله الملف، ولا تسأله بصيغة أخرى`); break; }
      if (before && (before.asked || 0) >= 1 && NO_MORE.test(said[said.length - 1] || '')) { problems.push(`العميل قال إنه لا يعرف أكثر مما قاله: اعتبر «${field}» لا يعرفه، ولا تسأله ثانية، واحسم بما عندك بحسب الملف`); break; }
      if (before && (before.asked || 0) >= limit) { problems.push(`سألت عن «${field}» ${before.asked} مرات ولم يجب: لا تسأله مرة أخرى، واحسم بما عندك أو انتقل لما بعده`); break; }
    }
    if (action === 'ask' && /[؟?]/.test(text) && !asking.length && Object.keys(memory.after || {}).length) {
      problems.push('ردك يسأل و asking_about فارغة: اكتب فيها البنود التي تسأل عنها بأسمائها في memory');
    }
  }
  // A service offered without its price (step 10 of 2.1).
  if (offersWithoutPrice(text, previous)) problems.push('تعرض على العميل خدمة دون سعرها: اذكر سعرها المعتمد من القسم 4 في الرسالة نفسها (R8)، أو قل إن أتعابها تُحدد بعد مراجعة المختص إن لم يكن لها سعر (R16)');
  // The amount meets its path's threshold: three messages of questions at most, then R3 (step 9).
  const asks = action === 'ask' || (action === 'answer' && Array.isArray(output.asking_about) && output.asking_about.length > 0);
  if (progress && !progress.referred && asks && output.threshold === 'يبلغ الحد' && (progress.afterThreshold || 0) >= 3) {
    problems.push('المبلغ يبلغ حد المسار وسألت بعد ذلك ثلاث رسائل (القسم 2.1، الخطوة 9): لا تسأل، أحل الآن بـR3 بما جمعته (أو R20 أو R11 إن انطبقا)، ويستكمل الموظف الباقي');
  }
  const conduct = problems.length - conductFrom;

  const arabicLetters = (text.match(/[ء-ي]/g) || []).length;
  const latinWords = text.match(/[A-Za-z]+/g) || [];
  if (output.language === 'en') {
    const latinLetters = latinWords.join('').length;
    if (!latinLetters) problems.push('language هي en والرد ليس بالإنجليزية');
    else if (arabicLetters > Math.max(10, latinLetters * 0.15)) problems.push('حروف عربية كثيرة في رد إنجليزي');
  } else {
    if (!arabicLetters) problems.push('language هي ar والرد ليس بالعربية');
    const clientLatin = new Set((clientText.match(/[A-Za-z]+/g) || []).map((w) => w.toLowerCase()));
    const stray = latinWords.filter((w) => !data.latin.has(w.toLowerCase()) && !clientLatin.has(w.toLowerCase()));
    if (stray.length > 3) problems.push(`كلمات إنجليزية كثيرة في رد عربي: ${stray.slice(0, 5).join(' ')}`);
  }
  return { ok: problems.length === 0, problems, text, conductOnly: problems.length > 0 && conduct === problems.length };
}

module.exports = { checkAgentReply, claimsReferral, numbersOf, amountsSaid, sectionOf, clientFacing, officeData, OFFICE_FILE, FORBIDDEN };
