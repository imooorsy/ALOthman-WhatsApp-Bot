> **مؤرشف.** هذا عقد النسخة الأولى (الأسئلة الثلاثة الثابتة). حل محله [DESIGN.md](DESIGN.md) بعد قاعدة معرفة المكتب في 2026-11-12.

# تصميم التنفيذ المرجعي لشغل الذكاء الاصطناعي

التاريخ: 2026-11-10
المصدر: [spec.md](../.specify/specs/001-legal-whatsapp-agent/spec.md)، [plan.md](../.specify/specs/001-legal-whatsapp-agent/plan.md)، [replies-draft.md](../.specify/specs/001-legal-whatsapp-agent/replies-draft.md)، [model-instructions-draft.md](../.specify/specs/001-legal-whatsapp-agent/model-instructions-draft.md)، [test-set.md](../.specify/specs/001-legal-whatsapp-agent/test-set.md).

هذا الملف هو عقد التنفيذ: الصيغ والواجهات والقواعد التفصيلية التي يلتزم بها كل ملف في `ai/` و`config/`. إذا تعارض مع المواصفات فالمواصفات هي المرجع، ويُبلَّغ عن التعارض.

## 0. النطاق والتقنية

- داخل النطاق: ملفات الإعداد، تعليمات النموذج ومخططه، منطق القرار (المسار، اللغة، اختيار الرد، سير المحادثة، التأهيل، فحص الملخص)، وبيانات الاختبار وأدواته.
- خارج النطاق: الاتصال بواتساب و Evolution، قاعدة البيانات، لوحة التحكم، استدعاء النموذج الفعلي، التوقيتات الفعلية (التجميع ومؤشر الكتابة). هذه يبنيها المطوّر ويستدعي منها هذا المنطق.
- Node.js 18 أو أحدث، CommonJS (`require` و`module.exports`)، دون أي مكتبة خارجية. الاختبار بـ`node --test`.
- كل الدوال خالصة: لا قراءة ساعة ولا عشوائية داخل المنطق. الوقت يُمرَّر في المدخلات.
- لا يُكتب أي ملف خارج `D:\Elmaster whatsapp`.

## 1. الملفات

| الملف | المحتوى |
| --- | --- |
| `config/approved-replies.json` | كل الردود بثلاث نسخ |
| `config/banned-phrases.json` | العبارات المحظورة |
| `config/office-profile.json` | بيانات المكتب (فارغة حتى تصل) والحدود الرقمية |
| `config/qualification-rules.json` | قواعد التأهيل، فارغة ومعطلة |
| `ai/prompts/understand.md`، `summary.md`، `transcribe.md` | نصوص تعليمات النموذج |
| `ai/schema/understanding.schema.json` | مخطط JSON لمخرجات الفهم |
| `ai/src/flags.js` | `defaultFlags()` و`normalizeFlags(obj)` |
| `ai/src/normalize.js` | تطبيع النص العربي والأرقام |
| `ai/src/path.js` | `choosePath(flags, ctx)` |
| `ai/src/language.js` | حالة اللغة واختيار النسخة |
| `ai/src/replies.js` | تحميل الردود، اختيار الصياغة، التعبئة، وصل الأجزاء |
| `ai/src/flow.js` | `createState()` و`handle(state, input, env)` |
| `ai/src/qualify.js` | `qualify(known, rulesConfig)` |
| `ai/src/summary-check.js` | `checkSummaryQuotes(summary, clientMessages)` |
| `ai/src/validate-replies.js` | فاحص ملف الردود (يعمل كأمر وكدالة) |
| `ai/tests/*.test.js` | اختبارات الوحدات والمحادثات |
| `ai/tests/data/test-profile.json` | بيانات مكتب وهمية للاختبار |
| `ai/tests/data/test-set.json` | الـ190 رسالة بتوقعات منظمة |
| `ai/tests/data/conversations.json` | محادثات اختبار كاملة |
| `ai/tests/grade.js` | مقيّم مخرجات النموذج على مجموعة الاختبار |

## 2. `config/approved-replies.json`

```json
{
  "version": 1,
  "status": "draft",
  "versions": ["saudi", "fusha", "english"],
  "greetings": {
    "salam": { "saudi": "...", "fusha": "...", "english": "..." }
  },
  "replies": {
    "welcome_ask": {
      "purpose": "الترحيب مع السؤال عن الحاجة",
      "kind": "question",
      "variants": [ { "saudi": "...", "fusha": "...", "english": "..." } ]
    }
  }
}
```

- النصوص تُنقل حرفيًا من `replies-draft.md`، مع المتغيرات `{office_name}` و`{client_name}` و`{working_hours}` و`{address}` و`{services_list}` و`{service_name}` و`{price_info}` و`{contact_info}` كما هي.
- `greetings`: المفاتيح `salam` و`morning` و`evening` و`hello` و`afiya`. حيث يقول الجدول «لا يُضاف شيء» تكون القيمة نصًا فارغًا.
- `kind`: `question` أو `statement` أو `ack` أو `connector`.

معرفات الردود، وعدد صياغاتها بترتيبها في `replies-draft.md`:

| المعرف | النوع | الصياغات | الغرض في `replies-draft.md` |
| --- | --- | --- | --- |
| `welcome_ask` | question | 3 | الترحيب مع السؤال عن الحاجة |
| `welcome_only` | statement | 1 | الترحيب وحده |
| `ask_need` | question | 2 | الحاجة |
| `ask_name` | question | 2 | الاسم |
| `ask_urgency` | question | 2 | الاستعجال |
| `ask_client_type` | question | 1 | فرد أم منشأة |
| `ask_city` | question | 1 | المدينة |
| `ask_stage` | question | 1 | المرحلة |
| `ask_phone` | question | 1 | رقم الجوال |
| `ask_amount` | question | 1 | المبلغ |
| `ask_other_party` | question | 1 | الطرف الآخر |
| `ack` | ack | 4 | تمام، يعطيك العافية، واضح، زين |
| `ack_name` | ack | 1 | حياك الله يا {client_name} |
| `clarify` | question | 2 | طلب غير واضح |
| `audio_unclear` | question | 1 | تسجيل صوتي غير واضح |
| `transfer_legal` | statement | 3 | سؤال قانوني |
| `connector_after_legal` | connector | 1 | وصلة قبل سؤال استقبال بعد سؤال قانوني |
| `transfer_human` | statement | 2 | العميل طلب موظفًا |
| `transfer_done` | statement | 3 | اكتملت البيانات. الصياغة الأولى تحتاج `{client_name}` |
| `transfer_unclear` | statement | 1 | تعذر الفهم بعد محاولتين |
| `waiting` | statement | 2 | العميل يسأل وهو ينتظر |
| `returning` | statement | 1 | عميل عائد، أو قال إنه عميل للمكتب |
| `not_client` | statement | 1 | ليس عميلًا |
| `wrong_number` | statement | 1 | رقم خطأ |
| `doc_received` | statement | 1 | وصل مستند |
| `image_received` | statement | 1 | وصلت صورة |
| `admin_hours` | statement | 1 | أوقات العمل |
| `admin_address` | statement | 1 | العنوان |
| `admin_services` | statement | 1 | الخدمات |
| `admin_service_yes` | statement | 1 | خدمة سمّاها العميل وهي في القائمة |
| `admin_fees` | statement | 1 | الأتعاب، إذا اعتمد المكتب ذكرها |
| `admin_fees_unknown` | statement | 1 | الأتعاب، دون قيمة معتمدة |
| `admin_contact` | statement | 1 | التواصل |
| `who_reply` | statement | 1 | من يحادثه العميل |
| `no_approved_answer` | statement | 1 | لا توجد إجابة معتمدة |
| `connector_admin_then_legal` | statement | 1 | وصلة بعد جواب إداري في رسالة فيها سؤال قانوني |
| `thanks_reply` | statement | 2 | رد الشكر |
| `goodbye_reply` | statement | 1 | الوداع |

## 3. مخرجات النموذج (`flags`)

الصيغة المرجعية هي جدول «المخرجات» في `model-instructions-draft.md`، بحقول عليا وكائن `extracted`:

```json
{
  "language": "ar", "arabic_register": "colloquial", "greeting": "salam", "closing": null,
  "courtesy_only": false, "answered_pending": null, "refused_pending": false,
  "has_legal_question": false, "admin_topics": [], "asked_service": null, "matched_service": null,
  "provides_intake_info": false, "wants_human": false, "asks_if_bot": false, "asks_who": false,
  "says_existing_client": false, "is_client": "yes", "non_client_type": null,
  "is_unclear": false, "injection_attempt": false,
  "extracted": {
    "name": null, "address_name": null, "client_type": null, "city": null,
    "service_description": null, "stage": null, "dates_mentioned": [], "amounts_mentioned": [],
    "other_party_name": null, "urgent": null, "phone": null
  }
}
```

`defaultFlags()` يعيد هذا الكائن بالقيم الافتراضية أعلاه، لكن `language: "unknown"` و`arabic_register: null` و`greeting: null`. `normalizeFlags(obj)` يدمج كائنًا جزئيًا مع الافتراضي، ويقبل الحقول المستخرجة سواء جاءت داخل `extracted` أو في المستوى الأعلى.

## 4. المسار — `choosePath(flags, ctx)`

`ctx = { audioUnclear: boolean }`. يعيد أول ما ينطبق بهذا الترتيب:

1. `flags.asks_if_bot` ← `"asks_if_bot"`
2. `flags.wants_human` ← `"wants_human"`
3. `flags.says_existing_client` ← `"existing_client"`
4. `flags.is_client === "no"` ← `"not_client"`
5. `ctx.audioUnclear` ← `"audio_unclear"`
6. `flags.has_legal_question` ← `"legal"`
7. `flags.asks_who` ← `"who"`
8. `flags.admin_topics.length > 0` ← `"admin"`
9. `flags.is_unclear` ← `"unclear"`
10. `flags.closing` ← `"closing"`
11. غير ذلك ← `"intake"`

## 5. اللغة — `language.js`

- الحالة: `{ last: "ar" | "en" | null, fusha: 0, colloquial: 0 }`.
- `updateLanguage(lang, flags)`: إذا `language = "ar"` تصبح `last = "ar"`، ويزيد عدّاد `fusha` أو `colloquial` إذا كانت `arabic_register` إحداهما. إذا `language = "en"` تصبح `last = "en"`. القيم `other` و`unknown` لا تغيّر شيئًا.
- `pickVersion(lang)`: `"english"` إذا `last = "en"`. غير ذلك: `"fusha"` إذا `fusha > colloquial`، وإلا `"saudi"`.

## 6. الردود — `replies.js`

- `loadReplies(path)` يقرأ الملف. `pickVariant(used, id)` يعيد رقم أصغر صياغة لم تُستخدم في المحادثة، أو `null` إذا استُنفدت.
- المعرفات التي يجوز تكرارها بعد الاستنفاد، فتُعاد أول صياغة: التحيات، وكل ما يبدأ بـ`admin_`، و`who_reply`، و`no_approved_answer`، و`doc_received`، و`image_received`، و`thanks_reply`، و`goodbye_reply`. الباقي لا يتكرر.
- اسم العميل صالح للتعبئة إذا كان من كلمة إلى ثلاث كلمات، كل كلمة حروف عربية أو لاتينية فقط وطولها لا يتجاوز 15 حرفًا، وليس فيه كلمة من قائمة «ليست اسمًا» في `replies.js` (مثل «يحق» و«تعويض» و«المحكمة»): ما فيه كلمة منها جملة لا اسم، ولا تُعاد على العميل داخل رد. إذا لم يكن صالحًا لا يُستخدم `ack_name` ولا الصياغة الأولى من `transfer_done`.
- التعبئة من ملف بيانات المكتب: `office_name`، `working_hours`، `address`، `services_list` (القائمة موصولة بـ«، » في العربية و", " في الإنجليزية)، `price_info`، `contact_info`. `service_name` من `flags.matched_service`. `client_name` من `known.address_name`.
- وصل أجزاء الرسالة الواحدة:
  - بعد التحية: «، » في العربية و". " في الإنجليزية. التحية الفارغة تُحذف.
  - بعد `ack` أو `ack_name`: ". " ثم الجزء التالي.
  - بعد `connector`: مسافة. في الإنجليزية يُصغَّر أول حرف من الجزء التالي إلا إذا كانت الكلمة "I".
  - بين جملتين خبريتين، أو خبرية ثم سؤال: مسافة.
- كل رسالة صادرة: `{ parts: [ { id, variant, text } ], text }`. جزء التحية معرفه `greeting:<type>` و`variant = 0`.

الردود الإدارية بحسب `admin_topics`، بترتيب ورودها:

| الموضوع | الرد |
| --- | --- |
| `hours` | `admin_hours` |
| `address` | `admin_address` |
| `services` | `admin_service_yes` إذا وُجدت `matched_service`. `no_approved_answer` إذا وُجدت `asked_service` دون مطابقة. غير ذلك `admin_services` |
| `fees` | `admin_fees` إذا وُجدت `price_info`، وإلا `admin_fees_unknown` |
| `contact` | `admin_contact` |
| `other` | `no_approved_answer` |

إذا كانت قيمة المتغير المطلوب غير موجودة في بيانات المكتب يُستخدم `no_approved_answer` بدل الرد. `no_approved_answer` و`admin_fees_unknown` لا يُرسل أي منهما أكثر من مرة في الرسالة الواحدة، وإذا اجتمعا يُكتفى بـ`no_approved_answer`. الردود الإدارية في الرسالة الواحدة تُوصل بمسافة.

## 7. سير المحادثة — `flow.js`

### 7.1 الواجهة

```js
const state = createState()            // حالة محادثة جديدة
const out = handle(state, input, env)  // لا يغيّر state الممرَّر
// env = { replies, profile }  ملف الردود وملف بيانات المكتب بعد التحميل
// out = { state, messages: [ { parts, text } ], events: [ { type, ... } ] }
```

الحالة:

```js
{
  status: "intake",            // intake | waiting | with_staff | closed
  closedOutcome: null,         // existing_client | incomplete | null
  everWithStaff: false,
  firstReplyDone: false,
  known: { need: null, name: null, address_name: null, urgent: null, client_type: null,
           city: null, stage: null, amount: null, other_party: null, phone: null },
  questions: { need: { asked: 0, dropped: false }, name: { asked: 0, dropped: false },
               urgency: { asked: 0, dropped: false } },
  pending: "none",             // need | name | urgency | clarify | none
  clarifyAttempts: 0,
  used: {},                    // { replyId: [variantIndex, ...] }
  sentCount: 0,
  handoff: null,               // { reason, urgent, createdAt, updates }
  lang: { last: null, fusha: 0, colloquial: 0 },
  suppressIntake: false,
  lastClientAt: null,
  facts: { dates: [], amounts: [] }   // كل موعد ومبلغ ذكره العميل بكلماته، لملخص الموظف
}
```

المدخلات، وكلها فيها `at` بالثواني من بداية المحادثة:

| `type` | الحقول | المعنى |
| --- | --- | --- |
| `text` | `flags`، `text` | رسالة مكتوبة، أو رسائل مجمّعة. `text` نص العميل نفسه، وتمريره إلزامي في التشغيل الفعلي (انظر 7.2) |
| `voice` | `flags`، `audioUnclear` | رسالة صوتية بعد التفريغ |
| `image`، `document` | | مرفق |
| `timer` | | نبضة دورية لفحص توقف العميل |
| `model_failed` | `greeting`، `language` | النموذج تأخر أو تعطل. التحية واللغة من الفحص السريع، وقد تكونان `null` |
| `staff_takeover`، `staff_reactivate`، `idle_expired` | | أحداث الموظف |
| `staff_close` | `outcome` | `existing_client` أو `incomplete` أو `null` |

الأحداث الصادرة: `handoff_created` مع `reason` و`urgent`، و`handoff_updated`، و`handoff_urgent`، و`silent` مع `reason`.

أسباب إنشاء الطلب: `legal_question`، `wants_human`، `intake_complete`، `unclear`، `not_client`، `asks_if_bot`، `existing_client`، `admin_unanswered`، `model_failed`، `reply_cap`، `abandoned`، `returning`، `need_unknown`.

`need_unknown`: تُرك سؤال الحاجة والحاجة غير معروفة، فلا أسئلة بعده ولا رد اكتمال (انظر «الحاجة أولًا» في 7.3).

### 7.2 قواعد عامة

- نسخة اللغة تُحدد بعد تحديث حالة اللغة من `flags` الرسالة الحالية.
- كل ما في `flags.extracted` يُسجَّل في `known` دائمًا: `service_description` في `need`، وأول عنصر من `amounts_mentioned` في `amount`، و`urgent` إذا لم تكن `null`.
- **لا يُحفظ إلا ما كتبه العميل.** إذا مُرِّر `input.text`: الاسم واسم المناداة والمدينة واسم الطرف الآخر والرقم تُحذف إن لم توجد حروفها في نص العميل (بعد توحيد أشكال الحروف والمسافات)، والتواريخ والمبالغ تُحذف إن لم توجد حرفيًا ككلمات وأرقام كاملة. السبب: اسم المناداة يُعبَّأ في الرد، فاسم يخترعه النموذج يصل العميل كنص حر. من دون `text` لا يمكن التحقق، فيُحفظ ما أعطاه المستدعي كما هو؛ لذلك تمريره إلزامي في الخلفية.
- كل التواريخ والمبالغ التي ذكرها العميل تُجمع دون تكرار في `facts.dates` و`facts.amounts`.
- أسئلة إضافية: إذا مُرِّرت `env.extraQuestions` (من الحقول التي تتطلبها قواعد التأهيل المعتمدة) تُطرح بعد الأسئلة الثلاثة بترتيبها، من: `client_type`، `city`، `stage`، `amount`، `other_party`، `phone`. لكل منها صياغة واحدة، فإن لم يُجب تُرك للموظف. من دونها لا يتغير شيء.
- إذا كان الطلب موجودًا ووصلت رسالة أو مرفق من العميل يصدر `handoff_updated` مرة واحدة لذلك المدخل.
- أول رسالة يرسلها المساعد في المحادثة تبدأ برد التحية (إن حيّا العميل) ثم الترحيب. بعدها تُضاف رد التحية فقط إذا حيّا العميل من جديد، دون ترحيب.
- حد الرسائل: إذا كان إرسال رسائل هذا المدخل سيجعل `sentCount` يتجاوز الحد في بيانات المكتب (المقترح 15) لا يُرسل شيء، ويُنشأ الطلب بسبب `reply_cap` إن لم يكن موجودًا، وتصبح الحالة `waiting`، ويصدر `silent`.
- حد الردود في الدقيقة يطبقه النظام خارج هذا الملف.

### 7.3 الأسئلة

- الأسئلة الافتراضية بهذا الترتيب: `need` ثم `name` ثم `urgency`. السؤال معروف جوابه إذا كانت قيمته في `known` موجودة (`urgent` معروف إذا كان `true` أو `false`).
- السؤال التالي هو أول سؤال غير معروف وغير متروك.
- السؤال المعلّق أُجيب إذا كانت `flags.answered_pending = true`، أو صارت قيمته معروفة من هذه الرسالة.
- إذا لم يُجب السؤال المعلّق:
  - `refused_pending = true`: يُترك السؤال دون إعادة، ويُنتقل للسؤال التالي.
  - طُرح مرة واحدة: يُعاد بالصياغة الثانية.
  - طُرح مرتين: يُترك، ويُنتقل للسؤال التالي.
  - عدد مرات الطرح المسموح هو الطرح الأول ثم `reask_max` إعادة من بيانات المكتب (المقترح 1، فالمجموع مرتان).
  - سؤال الحاجة مستثنى من «يُنتقل للسؤال التالي»: انظر البند التالي.
- الحاجة أولًا: إذا تُرك سؤال الحاجة والحاجة ما زالت غير معروفة فلا يُطرح أي سؤال بعده، لا الاسم ولا الاستعجال، ولا يُرسل `transfer_done`.
  - يُترك سؤال الحاجة في ثلاث حالات: رفضه العميل (`refused_pending = true` وهو المعلّق)، أو طُرح العدد المسموح (الطرح الأول ثم `reask_max`) ولم تُعرف الحاجة، أو عُدّ مجابًا (`answered_pending = true` وهو المعلّق) دون أن تُستخرج منه حاجة.
  - عندها يُنشأ الطلب بسبب `need_unknown` إن لم يكن موجودًا (يصدر `handoff_created` بهذا السبب؛ وإن وُجد طلب بقي سببه كما هو)، وتصبح الحالة `waiting` و`pending = "none"`.
  - لا تُرسل رسالة مكان السؤال التالي في ذلك المدخل. ما يسبق السؤال التالي في المدخل نفسه يُرسل كما هو دون رسالة ثانية: الجواب الإداري، `who_reply`، جملة التحويل القانوني، تأكيد المرفق، رد التحية. وإذا لم يكن في المدخل ما يُرسل أصلًا يصدر `silent`.
  - بعدها تجري المحادثة على قواعد الحالة `waiting` (7.6)، ولو ذكر العميل حاجته لاحقًا.
  - السبب: من لم يذكر حاجة، كمن سأل عن أوقات الدوام فقط، لا معنى لسؤاله عن اسمه وعن استعجال موضوعه، ولا لإخباره بأن طلبه سُجّل وليس له طلب.
- إذا لم يبقَ سؤال: يُرسل `transfer_done`، ويُنشأ الطلب بسبب `intake_complete` إن لم يكن موجودًا، وتصبح الحالة `waiting`. إذا أرسل هذا المدخل نفسه جملة تحويل قانوني فلا يُرسل `transfer_done` معها.
- صياغة `transfer_done` هي أصغر صياغة غير مستخدمة مما يجوز استخدامه:
  - الأولى تحتاج اسمًا صالحًا للتعبئة (البند 6)، وتُتخطى دونه.
  - الثانية، وهي التي تقول إن المعلومات واضحة، لا تُستخدم أبدًا إذا كان اسم العميل غير معروف (`known.name` غير موجودة).
  - فمن لم يُعرف اسمه يصله `transfer_done` بصياغته الثالثة، ومن عُرف اسمه ولم يصلح للتعبئة يصله بالثانية.
- كلمة القبول قبل السؤال التالي تُضاف فقط إذا أجابت الرسالة الحالية عن السؤال المعلّق: `ack_name` بعد جواب الاسم إذا كان الاسم صالحًا، ولا شيء بعد جواب الحاجة، وأول صياغة غير مستخدمة من `ack` بعد غيرهما. لا كلمة قبول قبل `transfer_done` ولا عند إعادة السؤال ولا في أول رد.
- `welcome_ask` يُعد طرحًا لسؤال الحاجة.

### 7.4 الحالة `intake`، بحسب المسار

| المسار | الرسائل | الطلب والحالة |
| --- | --- | --- |
| `asks_if_bot` | لا شيء | إنشاء الطلب بسبب `asks_if_bot` عاجلًا، أو `handoff_urgent` إن وُجد. الحالة `waiting` |
| `wants_human` | [تحية] [`welcome_only` إن كان أول رد] `transfer_human` | إنشاء بسبب `wants_human`. الحالة `waiting`. لا أسئلة |
| `existing_client` | [تحية] `returning` | إنشاء بسبب `existing_client`. الحالة `waiting` |
| `not_client`، رقم خطأ | [تحية] `wrong_number` | لا طلب. `suppressIntake = true`. الحالة تبقى `intake` |
| `not_client`، غير ذلك | [تحية] `not_client` | إنشاء بسبب `not_client`، عاجلًا إذا كان النوع `delivery`. الحالة `waiting` |
| `audio_unclear` أو `unclear` | انظر 7.5 | |
| `legal` | الرسالة الأولى: [تحية] [`welcome_only` إن كان أول رد] ثم جملة التحويل. الرسالة الثانية: السؤال التالي بحسب 7.3، مسبوقًا بـ`connector_after_legal` إذا لم يُستخدم | إنشاء بسبب `legal_question` إن لم يوجد. الحالة تبقى `intake` ما بقي سؤال، وإلا `waiting` |
| `who` | رسالة واحدة: [تحية] `who_reply` ثم السؤال التالي بحسب 7.3. لا ترحيب | |
| `admin` | الرسالة الأولى: [تحية] [`welcome_only` إن كان أول رد] الردود الإدارية. الرسالة الثانية: السؤال التالي بحسب 7.3 | إذا أُرسل `admin_fees_unknown` أو `no_approved_answer`: إنشاء بسبب `admin_unanswered` إن لم يوجد |
| `closing` | رد الشكر أو الوداع. لا سؤال بعده | |
| `intake` | بحسب 7.3. في أول رد: [تحية] `welcome_ask` إذا كانت الحاجة غير معروفة، وإلا [تحية] `welcome_only` ثم السؤال التالي في الرسالة نفسها | |

جملة التحويل في مسار `legal`:

- إذا في الرسالة مواضيع إدارية لها جواب معتمد: أجوبتها ثم `connector_admin_then_legal`. المواضيع التي لا جواب معتمدًا لها تُحذف، لأن التحويل يغطيها.
- غير ذلك: أول صياغة غير مستخدمة من `transfer_legal`.
- إذا استُخدم `connector_admin_then_legal` من قبل تُستخدم صياغة من `transfer_legal` بعد الأجوبة الإدارية.
- إذا استُنفدت الصياغات: لا تُرسل جملة تحويل، ويصدر `handoff_urgent` و`silent`، ولا يُعاد السؤال المعلّق في ذلك المدخل.

إذا كان `closing` أو `unclear` في أول رسالة في المحادثة تُعامل كتحية: [تحية] `welcome_ask`.

إذا كانت `suppressIntake = true` لا تُطرح أسئلة حتى تصل رسالة فيها `provides_intake_info = true` و`is_client = "yes"`، فتُلغى.

### 7.5 الاستيضاح

- في كل مرة لا تُفهم الرسالة (`unclear` أو `audio_unclear`) بعد أول رد: إذا كانت `clarifyAttempts < 2` يُرسل `audio_unclear` إن كان التسجيل هو غير الواضح ولم يُستخدم، وإلا أول صياغة غير مستخدمة من `clarify`، وتزيد `clarifyAttempts`. إذا كانت `clarifyAttempts = 2` يُرسل `transfer_unclear`، ويُنشأ الطلب بسبب `unclear`، وتصبح الحالة `waiting`.
- تسجيل غير واضح في أول رسالة: `welcome_only` ثم `audio_unclear` في رسالة واحدة، وتُحسب محاولة.
- أي رسالة مفهومة تعيد `clarifyAttempts` إلى صفر.
- الرسالة غير المفهومة لا تُحسب عدم إجابة عن السؤال المعلّق.

### 7.6 الحالة `waiting`

| المسار | الرسائل |
| --- | --- |
| `asks_if_bot` | لا شيء، و`handoff_urgent` |
| `closing` | رد الشكر أو الوداع |
| `legal` | أول صياغة غير مستخدمة من `transfer_legal`. إذا استُنفدت: لا شيء، و`handoff_urgent` و`silent` |
| `admin` | الردود الإدارية |
| `who` | `who_reply` |
| غير ذلك | أول صياغة غير مستخدمة من `waiting`. إذا استُنفدت: رد التحية وحده إن حيّا العميل، وإلا لا شيء و`silent` |

المرفق في `waiting`: `doc_received` أو `image_received`.

### 7.7 المرفقات والتوقف والأعطال وأحداث الموظف

- مرفق في `intake`: [`welcome_only` إن كان أول رد] `doc_received` أو `image_received`. ثم في رسالة ثانية السؤال التالي: المرفق يُعد عدم إجابة عن السؤال المعلّق.
- `timer`: إذا كانت الحالة `intake`، ولا طلب، وأُرسل أول رد، ومضى على آخر رسالة للعميل ما يساوي أو يزيد على مدة التوقف في بيانات المكتب (المقترح 10 دقائق): يُنشأ الطلب بسبب `abandoned`، ولا تُرسل رسالة، وتبقى الحالة `intake`. إذا عاد العميل يكمل المساعد من حيث توقف.
- `model_failed`: [تحية إن وُجدت] `welcome_only` ثم `transfer_unclear` في رسالة واحدة، وإنشاء الطلب بسبب `model_failed`، والحالة `waiting`. إذا لم يكن أول رد: `transfer_unclear` وحده.
- `staff_takeover`: الحالة `with_staff`، و`everWithStaff = true`. في هذه الحالة لا يرسل المساعد شيئًا لأي مدخل.
- `staff_reactivate`: إذا لم يستلم المحادثةَ موظف من قبل (`everWithStaff = false`) تعود الحالة `intake` وتُكمل الأسئلة من حيث توقفت. إذا استلمها موظف من قبل تصبح الحالة `closed` دون نتيجة ويُحذف الطلب: الرسالة التالية يصلها رد `returning` وطلب جديد بسبب `returning`، ولا تُعاد أسئلة الفرز (معيار القبول 34).
- `staff_close`: الحالة `closed` مع النتيجة. `idle_expired`: الحالة `closed` دون نتيجة.
- رسالة في الحالة `closed`: إذا كانت النتيجة `existing_client` لا يُرسل شيء. غير ذلك: `returning` إن لم يُستخدم، وإنشاء طلب بسبب `returning`، والحالة `waiting`.

## 8. التأهيل — `qualify(known, rulesConfig)`

- يعيد `{ classification, reasons }`. القيم: `needs_review`، `suitable`، `out_of_scope`، `incomplete`.
- إذا كانت القواعد معطلة أو فارغة: `needs_review` مع السبب «معايير التأهيل غير مهيأة».
- صيغة القاعدة: `{ id, when: [ { field, op, value } ], classification, reason, required: [field] }`. العمليات: `eq`، `neq`، `in`، `exists`. القاعدة تنطبق إذا تحققت كل شروطها. إذا نقص حقل من `required` فالنتيجة `incomplete`. إذا انطبقت قواعد بتصنيفات متعارضة، أو لم تنطبق أي قاعدة، فالنتيجة `needs_review`.
- التصنيف داخلي للموظف، ولا يغيّر ما يُرسل للعميل.

## 9. فحص الملخص — `checkSummaryQuotes(summary, clientMessages)`

يستخرج كل ما بين «» في الملخص، ويتحقق من وجوده حرفيًا في إحدى رسائل العميل بعد تطبيع المسافات فقط، وعلى حدود كلمات وأرقام كاملة؛ فلا يقبل «٥ ألف» داخل «٨٥ ألف» ولا اسمًا مبتورًا من اسم آخر. يعيد `{ ok, missing: [ ... ] }`. الاقتباس الفارغ يُرفض، والاقتباسات غير المغلقة أو المتداخلة أو ذات علامة إغلاق منفردة تُرفض مع `malformed: true`؛ لا تُتجاهل باعتبارها نصًا غير مقتبس. هذا فحص للاقتباسات فقط، وليس إثباتًا لصحة كل جملة في الملخص.

## 10. مجموعة الاختبار والمقيّم

`ai/tests/data/test-set.json`:

```json
[ { "id": 1, "pending": "none", "message": "...", "language_label": "سعودي", "category": "admin",
    "expect": { "path": ["admin"], "admin_topics": ["address"], "language": "ar",
                "register": "colloquial", "greeting": "salam" } } ]
```

مفاتيح `expect` كلها اختيارية: `path` (قائمة المسارات المقبولة)، `legal` (يجب أن تكون `has_legal_question = true`)، `admin_topics`، `admin_any`، `language`، `register`، `greeting`، `closing`، `courtesy_only`، `injection`، `name`، `address_name`، `city`، `dates`، `amounts`، `urgent`، `client_type`، `answered_pending`، `refused_pending`، `non_client_type`.

`category`: `admin`، `legal`، `mixed`، `intake`، `unclear`، `injection`، `not_client`، `asks_if_bot`، `wants_human`، `dialect`، `short_answer`، `no_punctuation`، `long`، `misc`.

`ai/tests/grade.js` يأخذ ملفًا فيه `[ { "id": 1, "flags": { ... } } ]`، ويحسب دقة المسار إجمالًا ولكل فئة، ويقارن بهذه النسب، ويخرج بالرمز 1 إذا لم تتحقق إحداها:

| المقياس | الحساب | الحد |
| --- | --- | --- |
| توجيه السؤال القانوني | الرسائل التي فيها `legal = true`: نسبة ما فيه `has_legal_question = true` | 98% |
| العربية من الإنجليزية | الرسائل التي فيها `language` قيمتها `ar` أو `en` | 99% |
| الفصحى من العامية | الرسائل التي فيها `register` | 90% |
| الجواب القصير | الرسائل التي فيها `pending` غير `none`: نسبة ما تحققت كل توقعاته | 95% |
| العميل الحقيقي | الرسائل التي لا تقبل المسار `not_client`: نسبة ما فيه `is_client` غير `no` | 98% |

مطابقة الأسماء والمدن والتواريخ والمبالغ بالاحتواء في أحد الاتجاهين بعد التطبيع (حذف التشكيل والتطويل والمسافات، وتوحيد الألف والتاء المربوطة والياء، وتحويل الأرقام الهندية). للتواريخ والمبالغ يجب أيضًا تطابق تسلسل الأرقام كاملًا؛ «٥ ألف» لا يطابق «٨٥ ألف»، و«٥ رجب» لا يطابق «١٥ رجب». هذا المقياس المتسامح مع الصياغة لا يثبت النقل الحرفي المطلوب للملخص أو التفريغ الصوتي.

يُرفض ملف التقييم إذا احتوى معرفًا مكررًا أو مجهولًا أو سجلًا غير صالح؛ لا تُخفى نتيجة سابقة باستبدالها بنتيجة تحمل المعرف نفسه. يظهر السبب في `inputErrors`، ويُخفق حكم النجاح عند وجود أي منها. يحفظ تقرير المقارنة بصمات ملفات المدخلات، ويفصل نتائج الفهم المحفوظة عن تجربة النموذج الفعلية وقياسات السرعة.

## 11. محادثات الاختبار — `ai/tests/data/conversations.json`

```json
[ { "id": "c01", "title": "استقبال عادي",
    "steps": [
      { "in": { "type": "text", "at": 0, "text": "السلام عليكم",
                "flags": { "language": "ar", "greeting": "salam", "courtesy_only": true } },
        "expect": { "messages": [ ["greeting:salam", "welcome_ask"] ],
                    "events": [], "status": "intake", "pending": "need" } }
    ] } ]
```

- `flags` جزئية وتُكمل بـ`normalizeFlags`. `text` للقراءة فقط.
- `expect.messages`: قائمة الرسائل، وكل رسالة قائمة معرفات أجزائها بالترتيب. يُكتب `id:2` لفرض الصياغة الثانية، وإلا تُقبل أي صياغة.
- `expect.events`: قائمة مثل `"handoff_created:legal_question"` و`"handoff_updated"` و`"handoff_urgent"` و`"silent"`. تُقارن كمجموعة.
- `expect.status` و`expect.pending` اختياريتان.
- المحادثات تعمل ببيانات `ai/tests/data/test-profile.json`.

## 12. قرارات تشغيلية تكمل المواصفات

هذه تفاصيل لم تنص عليها المواصفات واحتاجها التنفيذ:

- ترتيب الأسئلة: الحاجة، ثم الاسم، ثم الاستعجال.
- لا كلمة قبول بعد جواب الحاجة.
- الجواب الإداري أو جملة التحويل في رسالة، والسؤال التالي في رسالة ثانية. يُستثنى أول رد في مسار الاستقبال، ومسار `who`.
- الردود الإدارية يجوز تكرارها إذا تكرر السؤال.
- إرسال `admin_fees_unknown` أو `no_approved_answer` ينشئ طلبًا للموظف، لأن نصهما يقول «بحوّلك له».
- الرقم الخطأ لا ينشئ طلبًا.
- المرفق والرسالة التي لا تجيب يُعدّان عدم إجابة عن السؤال المعلّق. الرسالة غير المفهومة لا تُعد.
- إذا اكتملت الأسئلة في المدخل نفسه الذي أُرسلت فيه جملة تحويل قانوني لا يُرسل `transfer_done`.
- الحاجة أولًا: إذا بقيت الحاجة غير معروفة بعد طرح سؤالها العدد المسموح (الطرح الأول ثم `reask_max`)، أو رفض العميل ذكرها، يُترك سؤالها ولا يُسأل العميل بعده عن اسمه ولا عن الاستعجال، ولا يُرسل `transfer_done`. يُنشأ الطلب بسبب `need_unknown`، وتصبح الحالة `waiting`، ولا تُرسل رسالة لذلك. رأى قارئ أن من الآلية أن يُسأل عن الاسم والاستعجال من سأل عن الدوام فقط، ثم يُقال له «سجّلت طلبك» وليس له طلب. هذا استثناء لسؤال الحاجة وحده مما تقوله المواصفات عن السؤال المتروك («ينتقل لما بعدها»)، و`need_unknown` سبب ليس في قائمة المواصفات لأسباب إنشاء الطلب.
- الصياغة الثانية من `transfer_done` («المعلومات واضحة») لا تُستخدم إذا كان اسم العميل غير معروف؛ تُرسل الثالثة.
