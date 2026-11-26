'use strict';

// The referral record for the staff (knowledge base section 7, ai/DESIGN.md section 7).
// It is built from what the client stated; dates, amounts and names are quoted in the
// client's own words between « ». It never contains an ID number, an IBAN or a code.

const { loadReplies } = require('./replies');

const NOT_STATED = 'غير مذكور';

const OUTCOMES = {
  booking_request: 'حجز استشارة', document_request: 'طلب صياغة أو خدمة بعرض سعر',
  representation_review: 'مراجعة إمكانية التمثيل', follow_up: 'متابعة ملف قائم', declined: 'اعتذار',
  offer_declined: 'لم يقبل العميل ما عُرض عليه', referred: 'إحالة للفريق', cv: 'سيرة ذاتية',
  marketing: 'عرض تسويقي', business_development: 'تطوير الأعمال',
};

const REASONS = {
  urgent: 'مؤشر عاجل', detained: 'شخص موقوف', deadline_72h: 'موعد أو مهلة خلال 72 ساعة',
  judgment: 'حكم صادر وموعده قريب أو غير واضح', labor_time_review: 'المدة قريبة من 12 شهرًا وتحتاج تدقيقًا',
  labor_time_indicator: 'أكثر من 12 شهرًا مع مؤشر إقرار أو عذر أو إجراء سابق', labor_time: 'أكثر من 12 شهرًا دون مؤشر',
  below_threshold: 'المبلغ دون حد التمثيل', above_threshold: 'المبلغ عند حد التمثيل أو أكثر',
  outside_ksa_below: 'دون الحد والعميل خارج المملكة', amount_unclear: 'المبلغ يعبر الحد', amount_unknown: 'المبلغ غير معروف',
  amount_refused: 'رفض العميل ذكر المبلغ', other_currency: 'المبلغ بعملة أخرى ولم يحسمه الحد (انظر سطر المبلغ)', non_monetary: 'قضية غير مالية',
  no_threshold: 'لا حد مالي لهذا المسار', enforcement_not_note: 'تنفيذ غير منازعة سند',
  government_admin: 'قضية إدارية أو حكومية أو عسكرية', residency_immigration: 'شؤون إقامة أو ترحيل',
  medical_malpractice: 'أخطاء طبية', traffic_individual: 'حادث مرور لفرد', government_attestation: 'تصديق حكومي',
  non_legal: 'خدمة غير قانونية', domestic_labor: 'عمالة منزلية أو مكتب استقدام', foreign_case: 'قضية خارج المملكة',
  finished_case: 'قضية منتهية', enforcement_exhausted: 'تنفيذ مستنفد', prison_outside_riyadh: 'سجن خارج الرياض',
  ambiguous_party: 'الخصم جهة مملوكة للدولة وتحتاج تقديرًا', wants_human: 'طلب التحدث مع موظف',
  follow_up: 'عميل قائم', booking: 'طلب حجز', document_request: 'طلب صياغة أو خدمة', quote: 'تسعير من الفريق',
  pricing_request: 'يطلب سعرًا يقول إن المكتب عرضه عليه من قبل', admin_unanswered: 'سؤال عن المكتب دون جواب معتمد', unclear: 'تعذر فهم الطلب',
  model_failed: 'تعذر الفهم الآلي', abandoned: 'توقف العميل عن الرد', reply_cap: 'بلغ حد الرسائل',
  returning: 'عميل عائد', business_development: 'تعاون من محامٍ أو مكتب', delivery: 'مندوب توصيل',
  no_price: 'خدمة بلا سعر معلن', no_consultation: 'لا استشارة بسعر معتمد لهذا المسار',
  representation_review: 'دراسة إمكانية التمثيل', urgent_review: 'عاجل', migrated: 'محادثة من النسخة السابقة',
  client_insists: 'العميل يصر بعد الاعتذار', new_matter: 'موضوع آخر بعد إحالة الطلب',
  booking_incomplete: 'توقف العميل أثناء الحجز', document_pending: 'توقف العميل بعد طلب الصياغة',
  attachments: 'ملفات من العميل تحتاج اطلاعًا', interrupted: 'انقطع التشغيل أثناء الرد',
  late_message: 'رسالة وصلت متأخرة بعد انقطاع', media_failed: 'مرفق تعذر تنزيله', delivery_failed: 'رسالة لم تصل إلى العميل',
  processing_failed: 'توقف الرد الآلي', unresolved_sender: 'رقم المرسل غير معروف', assistant_unavailable: 'المساعد لم يكن جاهزًا للرد',
  assistant_off: 'أُوقف المساعد أثناء المحادثة', group_claim: 'مطالبة جماعية لعدة عمال',
  facts_changed: 'تغيّرت المعلومات بعد الاعتذار فأُعيد الفرز',
  tm_rejection: 'رفض طلب علامة، ومهلة التظلم جارية', unlisted_subject: 'موضوع قانوني خارج قوائم الخدمات',
  // Reasons the server gives (server/engine.js).
  flood: 'رسائل كثيرة متتابعة من العميل', unsupported_content: 'محتوى لا يقرؤه المساعد (موقع أو جهة اتصال أو غيرهما)',
  unfinished_matter: 'انتقل العميل لموضوع آخر قبل اكتمال فرز هذا الموضوع',
};

// The reasons that make a request urgent, for the priority line.
const URGENT_REASONS = ['urgent', 'detained', 'deadline_72h', 'judgment', 'labor_time_review', 'urgent_review', 'delivery', 'tm_rejection'];

const ROLES = {
  claimant: 'مدعٍ', defendant: 'مدعى عليه', employee: 'موظف', employer: 'صاحب عمل', heir: 'وريث',
  relative: 'قريب', partner: 'شريك', investor: 'مستثمر', agent: 'وكيل', other: 'أخرى',
};
const CASE_STATUS = { new: 'مطالبة جديدة', existing: 'قضية قائمة', judgment: 'مراجعة حكم (صدر حكم)' };
const FORMATS = { in_person: 'حضوري', online: 'أونلاين', phone: 'هاتفية' };
// What the client was offered, by the reply used (knowledge base 7).
const OFFERS = {
  consult_offer: 'عرض استشارة', consult_offer_from: 'عرض استشارة بسعر يبدأ من كذا',
  consult_price: 'عرض استشارة، وأرسل العميل بيانات الحجز', consult_price_from: 'عرض استشارة بسعر يبدأ من كذا، وأرسل العميل بيانات الحجز',
  review_representation: 'مراجعة المختص لإمكانية التمثيل', phone_chosen: 'اختار العميل الاستشارة الهاتفية',
  fees_specialty: 'ذُكر سعر الاستشارة جوابًا عن سؤاله', fees_specialty_from: 'ذُكر سعر الاستشارة (يبدأ من) جوابًا عن سؤاله',
  legal_offer: 'عرض استشارة مدفوعة بدل الجواب', legal_offer_from: 'عرض استشارة مدفوعة بدل الجواب',
  legal_offer_generic: 'عرض استشارة مدفوعة بدل الجواب',
  decline_labor: 'اعتذار عن التمثيل دون الحد، مع الاستشارة والصياغة',
  decline_labor_time: 'اعتذار مبدئي لمضي أكثر من 12 شهرًا، مع الاستشارة',
  decline_commercial: 'اعتذار عن التمثيل دون الحد، مع الاستشارة والمهام',
  decline_commercial_complex: 'اعتذار عن التمثيل دون الحد، مع الاستشارة والمهام',
  decline_civil: 'اعتذار عن التمثيل دون الحد، مع البدائل', decline_tax: 'اعتذار عن التمثيل دون الحد، مع البدائل',
  decline_tax_complex: 'اعتذار عن التمثيل دون الحد، مع البدائل', decline_enforcement: 'اعتذار عن التنفيذ، مع الاستشارة',
  decline_service: 'اعتذار عن الخدمة', decline_prison_outside: 'اعتذار عن زيارة سجن خارج الرياض',
  offer_labor_drafting: 'عرض صياغة صحيفة أو مذكرة', offer_labor_objection: 'عرض مذكرة اعتراض على حكم',
  offer_commercial_tasks: 'عرض المهام التجارية', offer_contract_drafting: 'عرض صياغة عقد',
  offer_contract_review: 'عرض مراجعة عقد', offer_tm_registration: 'عرض تسجيل علامة تجارية',
  offer_tm_objection: 'عرض التظلم من رفض علامة', offer_company_formation: 'عرض تأسيس شركة',
  offer_articles_amendment: 'عرض تعديل عقد التأسيس', offer_patent_stages: 'عرض مراحل براءة الاختراع',
  offer_pr_stages: 'عرض مراحل الإقامة المميزة', offer_fdi_stages: 'عرض مراحل الاستثمار الأجنبي',
  offer_shares_letter: 'عرض خطاب الأنصبة', offer_notarization: 'عرض التوثيق', offer_quote: 'تسعير من الفريق',
  fees_by_team: 'طلب استشارة لا سعر معتمد لها، والتسعير من الفريق',
  offer_detainee_inquiry: 'عرض خدمة الاستعلام (موقوف في الرياض لا يعرف أهله مكانه)',
  decline_enforcement_other: 'اعتذار عن التنفيذ، مع استشارة يسعّرها الفريق',
};

// How an amount in another currency was converted (ai/src/currency.js), or why it was not.
const FAILED = { unclear_currency: 'العملة لم تتضح، فلم يُحوَّل', no_rate: 'لا يوجد سعر صرف حديث لهذه العملة، فلم يُحوَّل',
  no_amount: 'لم يُذكر إجمالي واحد، فلم يُحوَّل' };
const riyals = (value) => `${value.toLocaleString('en-US')} ريال`;
function conversionNote(state) {
  const conv = state.facts && state.facts.conversion;
  if (!conv) return 'بعملة غير الريال';
  const code = conv.code ? ` (${conv.code})` : '';
  if (conv.failed) return `بعملة غير الريال${code}: ${FAILED[conv.failed] || conv.failed}`;
  const c = state.case;
  const value = c.amount_min !== null && c.amount_max !== null && c.amount_min !== c.amount_max
    ? `من ${riyals(c.amount_min)} إلى ${riyals(c.amount_max)}`
    : riyals(c.amount_min !== null ? c.amount_min : c.amount_max);
  const how = conv.source === 'peg' ? 'سعر الربط الثابت بالدولار' : `سعر ${conv.date || 'اليوم'}، من ${conv.source}`;
  return `بعملة غير الريال${code}: نحو ${value}، بسعر ${Number(conv.rate.toPrecision(4))} ريال للوحدة، ${how}`;
}
let defaultReplies = null;

// A file the client sent, by its kind (knowledge base 7: the kind only).
const SENT = { image: 'صورة أرسلها العميل', document: 'ملف أرسله العميل' };
const CV_FIELDS = {
  law_practice: 'المحاماة والاستشارات', legal_research: 'البحث والصياغة القانونية', secretarial: 'السكرتارية',
  admin_customer_service: 'الإدارة وخدمة العملاء', support: 'مجالات مساندة', training: 'تدريب', unknown: 'مجال غير محدد',
};

// Never kept (knowledge base 1.5, 7): an IBAN, an ID or iqama number, any run of 9 digits or
// more (an account or card number, even written in groups), and a code or number written after
// a word that names it (رمز، كود، تحقق، نفاذ، أبشر، حساب، بطاقة، آيبان). The case's amounts
// and dates stay: they are not named that way and are shorter.
// The words that name a code or a number, before it or after it, up to 40 letters away.
const NAMED = 'رمز|الرمز|كود|الكود|otp|code|pin|sms|تحقق|التحقق|نفاذ|أبشر|ابشر|حساب|الحساب|حسابي|بطاقة|البطاقة|آيبان|ايبان|iban|account|card|الرقم السري|رقم سري|كلمة المرور|password|verification';
// A number followed or preceded by a currency or a scale is an amount, and stays.
const CURRENCY = 'ريال|ريالا|ر\\.?\\s?س|sar|sr|ألف|الف|آلاف|الاف|مليون|مليار|دولار|usd|\\$|درهم|جنيه|يورو';
const AMOUNT_AFTER = new RegExp(`^\\s*(?:${CURRENCY})`, 'i');
const NOT_AMOUNT = `(?![0-9٠-٩])(?!\\s*(?:${CURRENCY}))`;
const SENSITIVE = new RegExp(`((?:${NAMED})[^0-9٠-٩\\n]{0,40})[0-9٠-٩]{4,8}${NOT_AMOUNT}`, 'gi');
const SENSITIVE_BEFORE = new RegExp(`(^|[^0-9٠-٩-])[0-9٠-٩]{4,8}${NOT_AMOUNT}(?![-:])(?=[^0-9٠-٩\\n]{0,40}(?:رمز|الرمز|كود|الكود|otp|code|pin|تحقق|التحقق|نفاذ|أبشر|ابشر|الرقم السري|رقم سري|كلمة المرور|password|verification))`, 'gi');
const AMOUNT_BEFORE = /(?:sar|sr|ر\.?\s?س|\$|usd)\s*$/i;
// A number the client calls an amount («المبلغ 150000000»), and a date with its time or a second
// date («2026-11-17 09», «2024-01-01 - 2024-12-31»).
const AMOUNT_NAMED = /(?:مبلغ|المبلغ|بمبلغ|مطالبتي|المطالبة|مطالبة|قيمة|قيمته|قيمتها|amount|claim)\s*[:：]?\s*(?:بين\s*)?$/i;
const DATE_LIKE = /^[0-9٠-٩]{4}-[0-9٠-٩]{1,2}-[0-9٠-٩]{1,2}/;
// A code after a word that names it, written with letters («رمز التحقق AB12CD») or in groups
// («رمز التحقق 12 34 56»).
const NAMED_MIXED = new RegExp(`((?:${NAMED})[^\\n]{0,40}?[\\s:：])(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,12}(?![A-Za-z0-9])`, 'gi');
const NAMED_GROUPS = new RegExp(`((?:${NAMED})[^0-9٠-٩\\n]{0,40})((?:[0-9٠-٩]{1,4}[ -]){1,5}[0-9٠-٩]{1,4})${NOT_AMOUNT}`, 'gi');
// Any short number, alone or in groups: for a message the client sent a code in (strict).
const SHORT_NUMBER = new RegExp(`(^|[^0-9٠-٩])((?:[0-9٠-٩]{1,8}[ -]){0,5}[0-9٠-٩]{1,8})${NOT_AMOUNT}`, 'g');
const digitsIn = (run) => run.replace(/[^0-9٠-٩]/g, '').length;
// strict: also every number of 4 to 8 digits that is not an amount, named or not.
function redact(text, { longNumbers = true, strict = false } = {}) {
  const out = String(text)
    .replace(/\bSA\s?\d{2}(?:\s?[0-9A-Z]{4}){5}\b/gi, '[محذوف]')
    .replace(/(^|[^\d٠-٩])[12٠١٢][0-9٠-٩]{9}(?![0-9٠-٩])/g, '$1[محذوف]');
  return (longNumbers ? out.replace(/[0-9٠-٩][0-9٠-٩ -]{7,}[0-9٠-٩]/g, (run, at, all) => (run.replace(/[^0-9٠-٩]/g, '').length >= 9
      && !AMOUNT_AFTER.test(all.slice(at + run.length)) && !AMOUNT_BEFORE.test(all.slice(0, at)) && !AMOUNT_NAMED.test(all.slice(0, at))
      && !DATE_LIKE.test(run) && !/[0-9٠-٩] - [0-9٠-٩]/.test(run) ? '[محذوف]' : run)) : out)
    .replace(SENSITIVE, '$1[محذوف]')
    .replace(SENSITIVE_BEFORE, '$1[محذوف]')
    .replace(NAMED_MIXED, '$1[محذوف]')
    .replace(NAMED_GROUPS, (found, before, run) => (digitsIn(run) >= 4 && digitsIn(run) <= 8 ? `${before}[محذوف]` : found))
    .replace(strict ? SHORT_NUMBER : /$^/, (found, before, run, at, all) => (digitsIn(run) >= 4 && digitsIn(run) <= 8
      && !AMOUNT_BEFORE.test(all.slice(0, at + before.length)) ? `${before}[محذوف]` : found));
}

const quote = (value) => `«${redact(value)}»`;

// The client's words, quoted piece by piece around what was removed, so that every quote is still
// his own text; cut at about `max` letters, at a space.
const REMOVED = '[محذوف]';
function quoteWords(text, max = 200) {
  let kept = redact(String(text).replace(/\s+/g, ' ').trim());
  let more = false;
  if (kept.length > max) {
    const space = kept.lastIndexOf(' ', max);
    kept = kept.slice(0, space > max / 2 ? space : max).replace(/\[[^\]]*$/, '').trim();
    more = true;
  }
  const quoted = kept.split(REMOVED)
    .map((part) => part.split(/[«»]/).map((piece) => piece.trim()).filter(Boolean).map((piece) => `«${piece}»`).join(' '))
    .join(` ${REMOVED} `).replace(/\s+/g, ' ').trim();
  return quoted + (more ? ' …' : '');
}
// "شهر واحد، شهرين، 3 أشهر، 11 شهرًا": the noun after an Arabic number.
const months = (n) => (n === 1 ? 'شهر واحد' : n === 2 ? 'شهرين' : n >= 3 && n <= 10 ? `${n} أشهر` : `${n} شهرًا`);
const quoteAll = (items) => (items.length ? items.map(quote).join('، ') : NOT_STATED);
const or = (value) => (value === null || value === undefined || value === '' ? NOT_STATED : redact(value));

// state: the conversation state of ai/src/flow.js. triage: config/triage.json.
function buildRecord(state, triage, replies = (defaultReplies ||= loadReplies())) {
  const c = state.case;
  const k = state.known;
  const card = c.specialty && triage.cards[c.specialty];
  // The request's own reason too, when the triage did not list it (a question about the office,
  // a discount, a client who stopped answering, or one the server raised).
  const why = state.handoff && !state.reasons.includes(state.handoff.reason) ? [...state.reasons, state.handoff.reason] : state.reasons;
  const reasons = why.map((reason) => REASONS[reason] || reason);
  const urgentWhy = why.filter((reason) => URGENT_REASONS.includes(reason)).map((reason) => REASONS[reason] || reason);
  const lines = [
    `الأولوية: ${state.priority === 'urgent' ? 'عاجل' : 'عادي'}${state.priority === 'urgent' && urgentWhy.length ? ` (${urgentWhy.join('؛ ')})` : ''}`,
    `النتيجة: ${OUTCOMES[state.outcome] || 'لم تكتمل بعد'}`,
    `المسار: ${card ? card.name.arabic : (REASONS[c.specialty] || c.specialty || NOT_STATED)}${c.case_status ? `، ${CASE_STATUS[c.case_status]}` : ''}`,
    `اللغة: ${state.lang && state.lang.last === 'en' ? 'إنجليزي' : state.lang && state.lang.last === 'ar' ? 'عربي' : NOT_STATED}`,
    `الاسم: ${k.name ? quote(k.name) : NOT_STATED}`,
    `صفة العميل: ${[k.client_role && ROLES[k.client_role], k.client_type === 'company' ? 'منشأة' : k.client_type === 'individual' ? 'فرد' : null].filter(Boolean).join('، ') || NOT_STATED}`,
    `الخدمة المطلوبة: ${or(k.service_description)}`,
    `ملخص الوقائع بكلمات العميل: ${(state.facts.said || []).length ? state.facts.said.map((text) => quoteWords(text)).join('\n  ') : NOT_STATED}`,
    ...((state.facts.answers || []).length ? [`إجابات العميل عن الأسئلة:\n${state.facts.answers.map((a) => `  س: ${a.asked.map((id) => questionText(replies, id)).filter(Boolean).join(' ')}\n  ج: ${quoteWords(a.text)}`).join('\n')}`] : []),
    ...(k.file_reference ? [`مرجع الملف لدى المكتب: «${redact(k.file_reference, { longNumbers: false })}»`] : []),
    ...(k.other_party ? [`الطرف الآخر: ${quote(k.other_party)}`] : []),
    `النتيجة المطلوبة: ${or(k.desired_outcome)}`,
    `المرحلة والجهة: ${or(k.stage)}`,
    ...(k.city || c.client_outside_ksa === true ? [`المدينة: ${[k.city && quote(k.city), c.client_outside_ksa === true ? 'العميل خارج المملكة' : null].filter(Boolean).join('، ')}`] : []),
    `المبلغ: ${quoteAll(state.facts.amounts)}${c.currency === 'other' ? ` (${conversionNote(state)})` : ''}${(state.facts.earlierAmounts || []).length ? `، وذكر قبله: ${quoteAll(state.facts.earlierAmounts)}` : ''}`,
    `التواريخ: ${quoteAll(state.facts.dates)}`,
  ];
  if (c.specialty === 'labor') {
    const time = c.employment_ongoing === true ? 'العلاقة مستمرة'
      : c.employment_end_months_ago !== null && c.employment_end_months_ago !== undefined ? `انتهت منذ نحو ${months(c.employment_end_months_ago)}` : 'تاريخ الانتهاء غير مذكور';
    const prior = c.prior_procedure === true ? 'يوجد إجراء سابق' : c.prior_procedure === false ? 'لا إجراء سابق' : 'الإجراء السابق غير مذكور';
    const indicator = c.acknowledgment_or_excuse === true ? 'يوجد إقرار أو عذر' : c.acknowledgment_or_excuse === false ? 'لا إقرار ولا عذر' : null;
    lines.push(`حقول العمالي: ${[time, prior, indicator, c.dismissed === true ? 'فصل' : null].filter(Boolean).join('، ')}`);
  }
  if (c.heirs_count) lines.push(`عدد الورثة: ${c.heirs_count}`);
  if (c.detained) lines.push(`التوقيف: ${c.in_riyadh === false ? 'خارج الرياض' : c.in_riyadh ? 'في الرياض' : 'المكان غير مذكور'}${c.detention_place ? `، ${quote(c.detention_place)}` : ''}${c.detention_place_unknown === true && !c.detention_place ? '، ولا يعرف العميل مكان التوقيف بالتحديد' : ''}`);
  lines.push(
    `المستندات المتوفرة: ${state.facts.documents.length ? state.facts.documents.map((item) => SENT[item] || redact(item)).join('، ') : NOT_STATED}`,
    `المعلومات الناقصة: ${missing(state, triage, replies).join('، ') || 'لا شيء'}`,
    `سبب الإحالة أو الاعتذار: ${reasons.join('؛ ') || NOT_STATED}`,
    `ما عُرض على العميل: ${offered(state, triage, replies) || 'لا شيء'}`,
    `الطريقة والوقت المفضلان: ${[k.consultation_format && FORMATS[k.consultation_format], k.preferred_time && redact(k.preferred_time)].filter(Boolean).join('، ') || NOT_STATED}`,
  );
  // A number the client gave to be reached on (not an ID: those are removed).
  if (k.phone) lines.push(`رقم للتواصل ذكره العميل: «${redact(k.phone, { longNumbers: false })}»`);
  if (state.sender === 'job' || state.sender === 'training') {
    const second = k.cv_second_field && k.cv_second_field !== k.cv_field ? `، ورغبة إضافية: ${CV_FIELDS[k.cv_second_field]}` : '';
    lines.push(`السيرة الذاتية: ${state.sender === 'training' ? 'تدريب' : 'توظيف'}، المجال الرئيسي: ${CV_FIELDS[k.cv_field] || CV_FIELDS.unknown}${second}، المدينة: ${k.city ? quote(k.city) : NOT_STATED}، المرفق: ${state.facts.documents.some((d) => d === 'document' || d === 'image') ? 'وصل' : 'لم يصل'}. المؤهل والخبرة واللغة كما كتبها المتقدم في «ملخص الوقائع» أعلاه.`);
  }
  // Earlier matters of the same conversation (DESIGN 6.5.1).
  if (state.matters && state.matters.length) {
    lines.push(`مواضيع أخرى في المحادثة: ${state.matters.map((m) => {
      const name = m.specialty && triage.cards[m.specialty] ? triage.cards[m.specialty].name.arabic : (REASONS[m.specialty] || m.specialty || NOT_STATED);
      const why = (m.reasons || []).map((r) => REASONS[r] || r).join('؛ ');
      const facts = [m.urgent ? 'عاجل' : null, (m.amounts || []).length ? `المبلغ: ${quoteAll(m.amounts)}` : null,
        (m.dates || []).length ? `التواريخ: ${quoteAll(m.dates)}` : null,
        (m.offers || []).length ? `عُرض: ${offered({ offers: m.offers }, triage, replies)}` : null].filter(Boolean).join('، ');
      return `${name} (${OUTCOMES[m.outcome] || 'لم تكتمل'}${why ? `: ${why}` : ''}${facts ? `؛ ${facts}` : ''})`;
    }).join('، ')}`);
  }
  // Instructions written to the assistant are not followed; the staff should know of them.
  if (state.injection) lines.push('تنبيه: في رسائل العميل تعليمات موجهة للمساعد، ولم تُتبع.');
  return lines.join('\n');
}

// The question as the client read it (its first phrasing, in Arabic).
function questionText(replies, id) {
  const reply = replies.replies[id];
  return reply ? reply.variants[0].arabic.replace(/\{\w+\}/g, '…') : null;
}

function missing(state, triage, replies = null) {
  const k = state.known;
  const c = state.case;
  const items = [];
  if (!k.name) items.push('الاسم');
  if (!k.service_description) items.push('وصف الطلب');
  const card = c.specialty && triage.cards[c.specialty];
  if (card && card.threshold && c.amount_min === null && c.amount_max === null && c.currency !== 'other' && c.monetary !== false) items.push('المبلغ');
  if (c.specialty === 'labor' && c.employment_ongoing !== true && c.employment_end_months_ago === null) items.push('تاريخ انتهاء العلاقة');
  // Questions that were asked and got no answer (knowledge base 7: «ما لم يُجب عنه»).
  const answered = new Set([...(state.answered || []), ...(state.facts.answers || []).flatMap((a) => a.asked)]);
  for (const id of state.asked || []) {
    const text = replies && !answered.has(id) ? questionText(replies, id) : null;
    if (text && Object.hasOwn(triage.questions, id)) items.push(`لم يُجب عن: ${text}`);
  }
  return items;
}

// «اعتذار عن التمثيل دون الحد، مع الاستشارة والصياغة (الرد 6.4): 750 ريال، 2,500 ريال».
function offered(state, triage, replies) {
  return state.offers.map((offer) => {
    const prices = offer.prices.map((key) => triage.prices[key]).filter((price) => typeof price === 'number')
      .map((price) => `${price.toLocaleString('en-US')} ريال`);
    const source = ((replies.replies[offer.reply] || {}).source || '').split(',')[0].trim();
    const label = `${OFFERS[offer.reply] || offer.reply}${/^\d+(?:\.\d+)*$/.test(source) ? ` (الرد ${source})` : ''}`;
    return `${label}: ${prices.length ? prices.join('، ') : 'بلا سعر'}`;
  }).join('؛ ');
}

module.exports = { buildRecord, redact };
