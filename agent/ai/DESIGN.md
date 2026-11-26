# عقد التنفيذ: المساعد «عثمان» وفرز المكتب

التاريخ: 2026-11-12
المصادر: [قاعدة معرفة المكتب](../.specify/specs/001-legal-whatsapp-agent/office-knowledge-base.md) (المرجع لسلوك المساعد)، [spec.md](../.specify/specs/001-legal-whatsapp-agent/spec.md) القسم 1.1، [config/triage.json](../config/triage.json).
حل محل [DESIGN-v1.md](DESIGN-v1.md).

هذا الملف يحدد الصيغ والقواعد التي يلتزم بها `ai/` و`config/` والخلفية. إذا خالف قاعدة المعرفة فالقاعدة هي المرجع، ويُبلَّغ عن التعارض.

## المحادثة يديرها النموذج (قرار صاحب المشروع، 18 نوفمبر 2026)

صاحب المشروع سلّم ملف المكتب الجديد `alothman_assistant_prompt.md` («الفايل ده فيه كل حاجه عدلهم»، «استبدل القديم بالحاجات اللي في الفايل ده»). الملف برومبت كامل لعثمان: هوية، وتسلسل فرز، وتصنيفات، وجدول خدمات وحدود، وأسعار، وبطاقات، وردود جاهزة R1 إلى R20، وسجل إحالة، وسجل مواعيد. صار هو قاعدة المعرفة: نُسخ بنصه إلى `ai/prompts/office.md` وإلى `.specify/.../office-knowledge-base.md`، وحُفظت القاعدة السابقة في `.specify/.../archive/office-knowledge-base-2026-11-15.md`.

- **`CONVERSATION=agent` (الافتراضي):** النموذج يقرأ المحادثة كلها مع ملف المكتب وعقد الخادم (`ai/prompts/agent.md`)، ويقرر الخطوة ويكتب الرد بنفسه، ومعه سجل الإحالة للفريق (القسم 14 من الملف). `server/agent.js` يبني الطلب ويطبّق القرار على حالة المحادثة؛ `server/openrouter.js` (`converse`) يرسله بطلب واحد بتفكير منخفض (`AGENT_REASONING=low`).
- **الكود يحرس ولا يكتب** (`ai/src/agent-guard.js`): كل رد يُفحص قبل إرساله: كل رقم من القسمين 4 و16 أو من كلام العميل (لا حدود ولا مدد ولا مواد ولا أرقام 16.4)، ولا سعر بالحروف، ولا عبارة ممنوعة (13، 5.3، ووعد أو حكم على القضية إلا منفيًا، وقائمة المكتب، و«المساعد الذكي»)، ولا رابط أو بريد إلا من 16.1، واللغة والطول والحروف، ولا سؤال ثالث عما سُئل عنه مرتين (القسم 1.4؛ ثلاث مرات إذا استفسر العميل عنه). الرد المرفوض يُطلب ثانية مع الأسباب، ثم يُرسل رد احتياطي ويُحال الطلب.
- **ذاكرة المحادثة** (فكرة صاحب المشروع، 18 نوفمبر): مع كل رد يكتب النموذج كشف بيانات المسار (`memory`: البند، لازم أم لا، معروف أو ناقص أو لا يعرفه العميل أو رفض، والقيمة بكلام العميل) ويسمّي ما يسأل عنه (`asking_about`). الخادم يحفظ الكشف ويرده إليه مع عدد مرات سؤال كل بند و`ready_to_decide` حين تكتمل البيانات اللازمة؛ والفحص يرفض السؤال عن بند معروف أو سُئل مرتين بلا جواب. قائمتا ما ذكره العميل والناقص في سجل الفريق من الكشف (`server/agent.js`: mergeMemory، countAsked، readyToDecide، keepDecision؛ العقد القسم 3).
- **الخادم يملك الحالة:** `refer` و`urgent` و`book` و`existing_client` تفتح طلب الفريق وتنبيهه (العاجل فورًا ولو كان النموذج ما زال يسأل)، والرد الذي يقول للعميل إن طلبه أُحيل يجعله كذلك. بعد الإحالة يستمر النموذج في الرد حتى يستلم موظف المحادثة. حد الردود في المحادثة `AGENT_MAX_REPLIES` (40). الرسالة الصوتية تُفرَّغ أولًا. والصورة أو ملف PDF الجديد يُرسل مع الطلب ليقرأ منه النموذج معلومة الفرز الظاهرة (القسم 1.7 من الملف: موعد جلسة، تاريخ حكم أو فصل، مبلغ)، ثلاثة على الأكثر، الصورة حتى 5 ميجابايت وPDF حتى 10؛ الفيديو والملف الأكبر يُوصفان فقط. أرقام الهوية والحسابات تُحذف من السجل (16.2).
- **ما بقي من الطريقة السابقة:** `CONVERSATION=flow` يعيد فرز الكود (`ai/src/flow.js` و`config/triage.json` و`config/approved-replies.json`) المبني من القاعدة المؤرشفة، والتجربة المحلية في اللوحة تستعمله دائمًا. الأقسام 3 إلى 8 أدناه تصفه، ولا تصف المحادثة التي يديرها النموذج.
- **التقييم:** بوابة التقييم الحي تقيس فرز الكود، فلا تغطي خادمًا يديره النموذج (`conversation` في البصمات). الرد على العملاء يعمل الآن بوضع التجربة على رقم التجربة فقط، ولا تقييم مكتوب لهذه الطريقة بعد.

## 0. المبادئ

- النموذج اللغوي يفهم فقط: يخرج بيانات منظمة (القسم 3). كل نص يصل العميل من قالب في `config/approved-replies.json`، وكل رقم فيه من `config/triage.json` أو `config/office-profile.json`.
- منطق الفرز خالص: `handle(state, input, env)` لا يقرأ الساعة ولا يستخدم العشوائية، ولا يغيّر الحالة التي يستلمها. الوقت وكون الرسالة خارج الدوام يأتيان في المدخلات.
- Node.js 18 أو أحدث، CommonJS، دون مكتبات خارجية. الاختبار بـ`node --test`.

## 1. الملفات

| الملف | المحتوى |
| --- | --- |
| `config/triage.json` | البطاقات، والحدود، والأسعار، والاستشارات، والمستبعد، وكتالوج الأسئلة، والجوائز |
| `config/approved-replies.json` | كل الردود بنسختين: `arabic` و`english` |
| `config/office-profile.json` | بيانات المكتب بالعربية والإنجليزية، وساعات العمل المنظمة |
| `config/banned-phrases.json` | عبارات لا تظهر في أي رد |
| `ai/prompts/understand.md` | تعليمات الفهم |
| `ai/schema/understanding.schema.json` | مخطط مخرجات الفهم |
| `ai/src/flags.js` | القيم الافتراضية للمخرجات وتطبيعها |
| `ai/src/language.js` | اختيار نسخة الرد |
| `ai/src/replies.js` | تحميل الردود، اختيار الصياغة، التعبئة، الوصل |
| `ai/src/triage.js` | قرارات الفرز الخالصة: العاجل، المستبعد، الحد، الأسئلة التالية |
| `ai/src/flow.js` | `createState()` و`handle(state, input, env)` |
| `ai/src/record.js` | سجل الإحالة للموظف (القسم 7 من قاعدة المعرفة) |

## 2. اللغة والنسخ

- نسختان: `arabic` و`english`.
- `language` في رسالة العميل: `en` أو `other` تجعل النسخة `english`؛ `ar` تجعلها `arabic`؛ `unknown` لا تغيّر شيئًا. قبل أي رسالة واضحة: `arabic`.
- العربية بصيغة الجمع المهذبة («حياكم الله»، «ترغبون»)، فتصلح للرجل والمرأة.

## 3. مخرجات الفهم (flags)

المدخلات التي يستلمها النموذج مع كل رسالة: `message` (الرسائل المتتالية مجمّعة)، `is_voice`، `last_bot_message` (نص آخر رسالة أرسلها المساعد أو `null`)، `known` (ما عُرف من المحادثة)، `services` (خدمات المكتب)، `today` (`{ gregorian, weekday, hijri }`). كتالوج الأسئلة (المعرّف ونصه العربي) يُلحق بالتعليمات.

المستوى الأعلى:

| الحقل | القيم | المعنى |
| --- | --- | --- |
| `language` | `ar`، `en`، `other`، `unknown` | لغة الرسالة. العربية بحروف لاتينية `ar` |
| `greeting` | `salam`، `morning`، `evening`، `hello`، `afiya`، `null` | تحية العميل |
| `closing` | `thanks`، `goodbye`، `null` | شكر أو وداع |
| `courtesy_only` | منطقي | الرسالة تحية أو شكر أو وداع فقط |
| `answered_pending` | منطقي أو `null` | أجاب عن سؤال `last_bot_message`. `null` إذا لم يكن فيها سؤال |
| `refused_pending` | منطقي | رفض الإجابة، أو سأل لماذا يُسأل، أو تهرّب |
| `will_reply_later` | منطقي | قال إنه سيرد أو يعود لاحقًا («خلني أشوف الأوراق وأرد عليكم»). «ما أعرف» ليست منها |
| `yes_no` | `yes`، `no`، `null` | جواب سؤال نعم أو لا في `last_bot_message` |
| `sender` | `client`، `existing_client`، `job`، `training`، `marketing`، `law_firm`، `wrong_number`، `delivery`، `unknown` | من المرسل |
| `asks_identity` | منطقي | يسأل مع من يتحدث، أو هل يتحدث مع نظام آلي |
| `wants_human` | منطقي | يطلب أن يكلمه أو يتصل به موظف بدل إكمال المحادثة |
| `has_legal_question` | منطقي | يطلب معلومة أو تقييمًا أو رأيًا قانونيًا، ولو «معلومة عامة» أو «استشارة مجانية» |
| `admin_topics` | قائمة من `hours`، `address`، `contact`، `website`، `fees`، `payment`، `services`، `offices`، `credentials`، `other`، `consultation_credit`، `documents_email` | أسئلة عن المكتب نفسه (`consultation_credit`: هل تُخصم قيمة الاستشارة من الأتعاب؛ `documents_email`: بريد لإرسال المستندات) |
| `asked_service` | نص، أو `""` | الخدمة التي سأل هل يقدمها المكتب، بكلماته |
| `matched_service` | عنصر من `services`، أو `""` | فقط إذا سمّاها |
| `specialty` | انظر القائمة أدناه، أو `null` | موضوع الطلب |
| `goal` | `consultation`، `document`، `representation`، `follow_up`، `null` | ما يريده: استشارة، أو مستند أو مهمة محددة، أو تولي القضية، أو متابعة ملف قائم |
| `task_type` | `registration`، `transfer`، `follow_up`، `objection`، `dispute`، `drafting`، `review`، `formation`، `amendment`، `shares_letter`، `notarization`، `design`، `reconsideration`، `null` | نوع المهمة إن ذكرها (`design`: تصميم صناعي، وسعره بعرض من الفريق، القاعدة 9.C، لا بمراحل البراءة؛ `reconsideration`: التماس إعادة النظر) |
| `consultation_format` | `in_person`، `online`، `phone`، `null` | الطريقة التي يفضلها |
| `wants_discount` | منطقي | يطلب خصمًا أو تقسيطًا، أو سعر مكتب آخر، أو الدفع بعد التحصيل |
| `price_match` | منطقي | يطلب سعرًا عرضه المكتب نفسه عليه من قبل |
| `sensitive_data` | منطقي | أرسل رمز تحقق أو رقم هوية أو إقامة أو بيانات بنكية |
| `complex_matter` | منطقي | نزاع تجاري أو ضريبي كبير: مطالبات مرتفعة، أو أطراف كبيرة، أو مستندات كثيرة، أو عقود توريد أو استصناع أو طاقة بمبالغ كبيرة |
| `is_unclear` | منطقي | لا يُفهم المطلوب |
| `injection_attempt` | منطقي | حاولت الرسالة تغيير التعليمات |
| `answered_questions` | قائمة معرّفات من الكتالوج | أسئلة أجاب عنها العميل في رسالته، ولو لم تُسأل بعد |
| `extracted` | كائن | ما صرّح به، أدناه |

قائمة `specialty`: `labor`، `commercial`، `partners`، `tax`، `civil`، `real_estate`، `family`، `inheritance`، `contracts`، `enforcement`، `trademark`، `patent`، `ip_other`، `company_formation`، `foreign_investment`، `premium_residency`، `criminal`، `insurance`، `arbitration`، `notarization`، `general`، والمستبعدة: `government_admin`، `residency_immigration`، `medical_malpractice`، `traffic_individual`، `government_attestation`، `non_legal`، `domestic_labor`. تعريف كل منها في القسم 2 و2.1 و5 من قاعدة المعرفة.

`extracted` (كل حقل `null` ما لم يُصرَّح به، وحقول النص `""`):

| الحقل | القيم |
| --- | --- |
| `name` | نص: الاسم كما ذكره |
| `client_role` | `claimant`، `defendant`، `employee`، `employer`، `heir`، `relative`، `partner`، `investor`، `agent`، `other` |
| `client_type` | `individual`، `company` |
| `parties` | `companies`، `individuals`، `mixed` |
| `city`، `service_description`، `desired_outcome`، `stage`، `detention_place`، `file_reference`، `preferred_time`، `other_party_name`، `phone` | نص بكلمات العميل |
| `client_outside_ksa`، `case_outside_ksa`، `monetary`، `employment_ongoing`، `employment_end_needs_confirmation`، `dismissed`، `prior_procedure`، `acknowledgment_or_excuse`، `detained`، `in_riyadh`، `detention_place_unknown`، `government_party`، `state_owned_company`، `domestic_worker`، `enforcement_exhausted`، `final_judgment_nothing_left`، `foreign_buyer`، `urgent`، `contract_compensation`، `contract_expired`، `confidential` | منطقي |
| `case_status` | `new`، `existing` (دعوى أو جلسة قائمة)، `judgment` (صدر حكم) |
| `dates_mentioned`، `amounts_mentioned`، `documents` | قوائم نصوص حرفية |
| `amount_min_sar`، `amount_max_sar` | رقم بالريال. مبلغ محدد: القيمتان متساويتان. نطاق: حداه. «حوالي 60 ألف» = 60000 |
| `amount_currency` | `SAR`، `other` |
| `amount_foreign_min`، `amount_foreign_max` | رقم بعملة المبلغ إذا كانت غير الريال، بقواعد مبلغ الريال. النموذج لا يحوّل؛ الكود يحوّل (6.4.2) |
| `amount_foreign_code` | `USD`، `EUR`، `GBP`، `CHF`، `CAD`، `AUD`، `JPY`، `CNY`، `HKD`، `SGD`، `MYR`، `IDR`، `INR`، `PKR`، `BDT`، `LKR`، `NPR`، `PHP`، `AED`، `KWD`، `QAR`، `BHD`، `OMR`، `JOD`، `EGP`، `IQD`، `LBP`، `SYP`، `YER`، `SDG`، `LYD`، `MAD`، `TND`، `DZD`، `TRY`، `ETB`، `KES`، `NGN`، `ZAR`، `RUB`، `KRW`، `SEK`، `NOK`، `DKK` (رمز العملة إذا بيّنتها الرسالة، وإلا لا شيء) |
| `employment_end_months_ago` | عدد الأشهر منذ انتهاء علاقة العمل، محسوبًا من `today` |
| `event_kind` | `hearing`، `investigation`، `objection_deadline`، `limitation`، `general_assembly`، `auction`، `reply_deadline`، `other` |
| `event_days_until` | عدد الأيام من `today` إلى أقرب موعد قادم ذكره. سالب إذا مضى |
| `enforcement_kind` | `note` (سند لأمر أو شيك)، `judgment`، `other` |
| `heirs_count` | رقم |
| `cv_field` | `law_practice`، `legal_research`، `secretarial`، `admin_customer_service`، `support`، `training`، `unknown` |
| `cv_second_field` | `law_practice`، `legal_research`، `secretarial`، `admin_customer_service`، `support`، `training`، `unknown` |

حقول النص في مخرجات النموذج نص دائمًا، `""` إذا لم يُذكر: مزوّد النموذج يقبل 16 حقلًا على الأكثر بنوعين (نص أو `null`) في المخطط. `normalizeFlags` تحوّل النص الفارغ إلى `null`، فهو داخل النظام `null` كبقية الحقول، و`emptyOutput()` تعطي المخرجات الفارغة بصيغة النموذج.

**المخطط يُرسل في طلبين.** المزوّد يحوّل مخطط كل طلب إلى قواعد توليد، ويرفض ما يزيد حجمه (HTTP 400، «The compiled grammar is too large»)، وهذا ما ظهر في أول نداء حي يوم 15 نوفمبر 2026. المقاس يومها: الطلب يتسع 72 وحدة (الحقل وحدة، والرقم الذي يقبل `null` وحدتان، والقائمة ثلاث، والكائن وحدة فوق حقوله)، والعقد كله نحو 92. فكل رسالة تُفهم بطلبين يُرسلان معًا بالتعليمات نفسها (`requestSchemas` في `server/providers.js`): الحقول العليا في طلب (وزنه 30)، و`extracted` في طلب (وزنه 65)، ثم يُجمع الجوابان في كائن واحد يُتحقق منه كاملًا بهذا المخطط. الاختبار `server/tests/live-2026-11-15.test.js` يسقط إذا زاد طلب على الحد: `extracted` يتسع لسبعة حقول بسيطة أخرى، وبعدها يُقسم. والاختيار الذي يقبل `null`، في أي مخطط يُرسل، يُكتب `enum` فيها `null` دون `type`: المزوّد يرفض `enum` تحت نوعين (وهذا ما رُفض به مخطط الصياغة في اليوم نفسه).

**مزوّد آخر: OpenRouter.** `MODEL_PROVIDER=openrouter` يجعل الخادم يسأل نموذجًا من صانع آخر عبر OpenRouter (`server/openrouter.js`)، بالتعليمات والمخطط والفحوص نفسها. المخطط يُرسل بصيغة OpenAI الصارمة (لكل `enum` نوع)، والعقد كله في طلب واحد، بلا تفكير (`reasoning.effort: none`)، ومع `provider.require_parameters` حتى لا يخدم الطلبَ إلا من يلتزم المخطط. `MODEL_SPLIT=on` يقسمه طلبين يُرسلان معًا، وفيه تفتح قائمة `answered_questions` الطلب الثاني قبل `extracted`: حين خُتم بها الطلب الأول استمر `openai/gpt-6-luna` في تعداد الأسئلة بلا توقف. المقاس يوم 16 نوفمبر 2026: الطلبان لم يكسبا وقتًا يُذكر (الأبطأ منهما يحكم، وتجاوز المهلةَ أكثر) وأضعفا تعليم الأسئلة المجابة، فالافتراضي طلب واحد. الجواب الذي ليس كائن JSON واحدًا، أو المقطوع، يُسأل مرة ثانية إن بقي من المهلة ثانية ونصف. والتقييم الحي يغطي المزوّد وعدد الطلبات اللذين أُجري بهما وحدهما (`provider` و`understandingRequests` في بصماته).

**علامة النموذج على سؤال لم يُطرح.** السؤال الذي جوابه حقل (`known` في `config/triage.json`) يُعد مجابًا حين يُعرف الحقل، والفرز يرى ذلك بنفسه؛ وعلامة النموذج عليه في `answered_questions` والحقل فارغ لا تُسقطه، ما لم يكن هو السؤال المطروح (`fieldMissing` في `ai/src/triage.js`). وسؤال تاريخَي الحكم (`dates: 2`) لا تُسقطه رسالة فيها تاريخ واحد. السبب: نموذج يعلّم ما لم يقله العميل يجعل المساعد يتخطى أسئلته، وهذا ما فعله `openai/gpt-6-luna` يوم 16 نوفمبر 2026 («فصلوني» عُلّمت جوابًا عن تاريخ الانتهاء، و«الحكم صدر أمس» جوابًا عن نوع الحكم وتاريخ التبليغ). السؤال الذي لا حقل وراءه يبقى على علامة النموذج.

قواعد يلتزمها النموذج: لا يستنتج ما لم يُذكر؛ ينقل التواريخ والمبالغ حرفيًا في القوائم؛ لا يحسب المستحقات ولا المدد النظامية، ويحسب فقط عدد الأشهر أو الأيام من `today` لما ذكره العميل.

## 4. الردود

### 4.1 الملف

```json
{ "version": 3, "status": "draft", "versions": ["arabic", "english"],
  "greetings": { "salam": { "arabic": "...", "english": "..." } },
  "replies": { "<id>": { "kind": "question", "q": 2, "source": "6.11", "variants": [ { "arabic": "...", "english": "..." } ] } } }
```

- `kind`: `statement`، `question`، `lead`، `ack`، `fragment`. التحيات في `greetings` دون `kind`.
- `q`: عدد الأسئلة داخل نص السؤال (1 أو 2). يُطابق `config/triage.json`.
- `source`: رقم الرد في قاعدة المعرفة إذا كان نصه منها (`6.4`)، أو `composed` إذا صيغ من قواعدها ويحتاج اعتماد المكتب.
- حيث كتب المكتب ردًا جاهزًا يُنقل بصياغته، مع هذه التعديلات: الأسعار تصبح متغيرات، وعبارة «غير شاملة ضريبة القيمة المضافة» تُضاف حيث يذكر الرد سعرًا بدونها، ومعها أن أسعار الصياغة والرفع لا تشمل رسوم طرف ثالث (القسم 3.3 من القاعدة)، وخطاب المفرد يصير جمعًا (ردود 5.16)، والتحية تنتقل إلى رد الترحيب. الأسئلة وعروض الخدمات وردود المكتب الإدارية صيغت من جداول القاعدة وقوائمها، و`source` يشير إلى قسمها.

### 4.2 المتغيرات

| المتغير | المصدر |
| --- | --- |
| `{office_name}`، `{working_hours}`، `{address}`، `{contact_info}`، `{website}`، `{price_info}`، `{other_offices}` | بيانات المكتب، والحقل الإنجليزي للنسخة الإنجليزية |
| `{services_list}`، `{service_name}` | خدمات المكتب |
| `{price_<key>}` | `prices.<key>` من `triage.json`، بفاصل الآلاف: `2,500` |
| `{consultation_name}`، `{consultation_price}` | الاستشارة المعروضة: اسمها بالنسخة، وسعرها |
| `{consultation_formats}` | جزء `format_standard` أو `format_with_phone` معبأً |
| `{booking_needs}` | أجزاء ما ينقص من بيانات الحجز، موصولة |
| `{award}` | جائزة البطاقة من `awards`، أو `general` |

النص الذي ينقصه متغير لا يُرسل (`fillText` تعيد `null`).

### 4.3 وصل أجزاء الرسالة

- بعد التحية: «، » في العربية، و«. » في الإنجليزية.
- بعد `lead` («لنتمكن من خدمتكم:»): مسافة، وفي الإنجليزية يصغَّر أول حرف.
- سؤال بعد سؤال: في العربية «و» ملتصقة بأول السؤال الثاني («وكم...»)، وفي الإنجليزية «And » ثم أول حرف مصغَّر.
- `fragment` لا يُرسل وحده؛ يُستعمل لبناء `{booking_needs}` و`{consultation_formats}`. الوصل في العربية: «أ، وب، وج»، وفي الإنجليزية: «a, b and c».
- غير ذلك: مسافة.

### 4.4 معرّفات الردود غير الأسئلة

| المعرّف | متى |
| --- | --- |
| `welcome_full` | أول رد حين تكون الرسالة تحية فقط أو غير مفهومة (6.1) |
| `welcome_short` | أول رد في غير ذلك: «حياكم الله في {office_name}، معكم عثمان المساعد الذكي.» |
| `identity` | سؤال الهوية بعد أول رد |
| `lead`، `ack` | قبل أول سؤال من البطاقة، وقبل أسئلة المتابعة |
| `review_representation` | 6.3 |
| `referred`، `referred_labor_time`، `referred_urgent`، `referred_team`، `referred_quote`، `human`، `transfer_unclear`، `business_development` | الإحالات؛ `referred_labor_time` للعمالي بعد 12 شهرًا مع مؤشر، بعبارة المدة الوحيدة (4.3) |
| `explain_question` | قبل سؤال يُعاد لأن العميل استفسر عنه أو اعترض على الأسئلة («أي تاريخ؟»): اعتذار قصير، ثم السؤال بصياغة أوضح (قرار صاحب المشروع، 16 نوفمبر 2026) |
| `subject_again` | بعد إحالة بلا موضوع (`unclear` أو `unlisted_subject`) لم يستلمها موظف: يُطلب الموضوع مرة أخرى ليكمل المساعد الفرز، مرة واحدة (قرار صاحب المشروع، 16 نوفمبر 2026) |
| `out_of_hours` | يُلحق برد فيه وعد بالتواصل إذا وصلت الرسالة خارج الدوام |
| `consult_offer`، `consult_offer_from`، `consult_price`، `consult_price_from` | 6.8 بسعر ثابت، أو «يبدأ من» (ومنه نزاعات الملكية الفكرية)؛ و`consult_price*` جملة السعر وحدها حين أعطى العميل كل بيانات الحجز |
| `booking_details`، `booking_received`، `booking_documents` | طلب بيانات الحجز لخدمات المراحل والتوثيق، و6.9، وبعده أن الفريق سيطلب المستندات للتحضير (3.1، A.4) |
| `legal_offer`، `legal_offer_from`، `legal_offer_generic` | 6.7 بسعر، أو «يبدأ من»، أو دون تخصص معروف |
| `fees_specialty`، `fees_specialty_from`، `fees_by_team` | سؤال الأتعاب بعد معرفة التخصص: بسعر الاستشارة، أو «يبدأ من»، أو أن الفريق يحددها |
| `decline_labor`، `decline_labor_time`، `decline_commercial`، `decline_commercial_complex`، `decline_civil`، `decline_tax`، `decline_tax_complex`، `decline_enforcement`، `decline_enforcement_other`، `decline_service`، `decline_prison_outside` | 6.4، 6.5، 6.20، وصياغات القاعدة للحقوقي والضريبي والتنفيذ، و6.12، و6.6. نسختا `_complex` للنزاع الكبير: الاستشارة فيه تبدأ من السعر الأعلى (A.3) |
| `offer_labor_drafting`، `offer_labor_objection`، `offer_commercial_tasks`، `offer_shares_letter`، `offer_contract_review`، `offer_contract_drafting`، `offer_tm_registration`، `offer_tm_objection`، `offer_patent_stages`، `offer_pr_stages`، `offer_fdi_stages`، `offer_company_formation`، `offer_articles_amendment`، `offer_notarization`، `offer_detainee_inquiry`، `offer_quote`، `offer_quote_consult` | عروض الخدمات بأسعارها (`offer_detainee_inquiry`: خدمة الاستعلام لموقوف في الرياض لا يعرف أهله مكانه، 5.13) |
| `marketing`، `discount_declined`، `discount`، `sensitive_warning`، `media_unclear`، `clarify` | 6.15، 3.3 (لا خصم ولا تقسيط، معتمد) و6.16 (سعر عرضه المكتب نفسه من قبل؛ سعر المكتب الآخر والدفع بعد التحصيل خصمٌ يُعتذر عنه)، تنبيه الخصوصية، 6.17، الاستيضاح |
| `cv_unclear`، `cv_job`، `cv_training`، `cv_received`، `cv_noted`، `cv_two_fields`، `cv_pdf` | 5.16 (`cv_two_fields`: سؤال واحد لمن ذكر مجالين؛ `cv_pdf`: نسخة PDF واضحة لمن أرسل السيرة صورة) |
| `admin_hours`، `admin_address`، `admin_contact`، `admin_website`، `admin_payment`، `admin_offices`، `admin_credentials`، `admin_services`، `admin_service_yes`، `admin_fees`، `admin_consult_independent`، `admin_documents_email`، `no_approved_answer` | أسئلة المكتب (`admin_consult_independent`: جملة 3.1 عن استقلال الاستشارة عن أتعاب التمثيل؛ `admin_documents_email`: بريد المستندات في 1.8) |
| `thanks_reply`، `goodbye_reply`، `deferral_reply`، `waiting`، `returning`، `wrong_number`، `delivery`، `doc_received`، `image_received` | المجاملات والانتظار وغير العملاء والمرفقات؛ `deferral_reply` («في خدمتكم دائمًا.») مرة واحدة لـ«خلني أفكر» بعد عرض، والعرض يبقى |
| `fragment`: `need_name`، `need_topic`، `need_format`، `need_time`، `format_standard`، `format_with_phone` | أجزاء البناء |

الأسئلة: كل معرّف في `questions` من `triage.json` له رد من نوع `question` بالمعرّف نفسه.

### 4.4.1 تكرار الردود

كل رد يُرسل كلما احتاجته المحادثة، بأول صياغة له بعد أن تُستعمل صياغاته، فلا يبقى العميل دون رد (موضوع ثانٍ بعد اعتذار، أو سؤال يتكرر في مسارين). يُستثنى ما لا يُكرر أبدًا (`ONCE` في `ai/src/replies.js`): الترحيب والتمهيد والإقرار `ack`، و`waiting` (المعيار 46)، والاستشارة المدفوعة للسؤال القانوني (المعيار 51)، والتسويق، وتنبيه الخصوصية. والسؤال لا يُحسب مسؤولًا إلا إذا أُرسل.

### 4.5 صياغة الرد

`handle()` يعيد الرد المعتمد كما هو. الخادم (`server/engine.js`) يطلب من النموذج ضبطه لرسالة العميل قبل إرساله، بتعليمات `ai/prompts/phrase.md` ومعها قائمة العبارات المسموحة (`courtesySection()`). قرار صاحب المشروع (2026-11-14): الردود المعتمدة كلام موظفي المكتب، والنموذج يضبطها بأشد القيود. والنموذج لا يكتب الرد: **يختار** فقط، والكود يركّب:

- مخرجات النموذج (مخطط `phraseSchema` في `server/providers.js`، كل قيمة من قائمة مغلقة `CHOICES`): `{ opening: [عبارتان على الأكثر], thanks: عبارة أو null, lead: عبارة أو null }`. `opening` عبارات مجاملة تفتتح الرد (رد السلام، التعاطف، الدعاء...)، و`thanks` و`lead` بديل لعبارة الشكر أو التمهيد التي في الرد المعتمد حين تتكرر.
- `composeCourtesy(draft, choice, { version, said })` في `ai/src/phrase-check.js` يركّب: يبدّل جملة الشكر أو التمهيد في مكانها بعلاماتها، ويضع عبارات `opening` بعد جملة الترحيب إن بدأ بها الرد وإلا في أوله، ورد التحية أولًا. ويُسقط كل اختيار لا تسمح به المحادثة: عزاء دون ذكر وفاة، أو دعاء لموقوف بعد سؤال عن نتيجة قضيته، أو عبارة بغير لغة الرد، أو عبارة موجودة في الرد. جمل الرد المعتمد لا تتغير أبدًا، فالنص المركّب يمر بالفحص بطبيعته.
- ثم يمر النص المركّب على `checkPhrasing` (القواعد أدناه) شبكةً ثانية. ومزوّد يعيد `{ text }` (للاختبار) يُفحص نصه بالقواعد نفسها.
- **قراءة رد العميل («العقل»، قرار صاحب المشروع، 2026-11-16: «لازم يكون في عقل… يفهم هو ده رد السؤال ولا متجاوبش ولا العميل سأل على حاجة فأرد وأرجع تاني»).** طلب ثالث للنموذج بجانب الفهم (`provider.turn`، `ai/prompts/turn.md`، `turnSchema`)، متى كان في آخر رسالة للمساعد أسئلة: يصله `pending` (الأسئلة بمعرّفاتها ونص المكتب) و`conversation` (آخر 16 رسالة) و`message`، ويعيد لكل سؤال حالته (`answered`، `partly`، `not_answered`، `does_not_know`، `refused`، `later`) و`client_asks` (`nothing`، `what_we_meant`، `objection`، `about_office`، `legal_question`، `other`). المسار يعمل بها (`turnOf`، `leftUnanswered`، `askAgain`، `backToQuestion` في `ai/src/flow.js`):
  - ما دام الفرز سيسأل: السؤال `not_answered` أو `partly` يُعاد قبل أي سؤال جديد، مرة؛ ومع `what_we_meant` أو `objection` يسبقه `explain_question` ويُعاد مشروحًا، مرتين على الأكثر. `does_not_know` و`refused` و`later` لا تُعاد.
  - `answered` بالقراءة يُحسب مجابًا ولو لم يعلّمه الفهم؛ وعلامة الفهم على سؤال تقول القراءة إنه لم يُجب تُهمل. السؤال الذي جوابه حقل يحتاج الحقل.
  - سؤال عن المكتب وسط الأسئلة: يُجاب ثم يعود السؤال المعلّق مع الجواب، مرة.
  - القرار الذي لا يحتاج أسئلة (اعتذار، إحالة، عرض) لا يُؤخَّر.
  - بلا قراءة (فشل الطلب، أو مزوّد بلا `turn`، أو التجربة المحلية): تحكم كلمات الرسالة (`asksBack`، `saysUnknown`) وعلامات الفهم.
  - جُرّبت على النموذج الحي في 13 حالة فأصابت 12 (الخطأ: رفض ذكر المبلغ قُرئ `partly`؛ أضيفت قاعدة). زمنها 1.4 إلى 2.4 ثانية بجانب الفهم، وثمنها نحو 0.0001 دولار.
  - **حدها:** هي تحكم على الرد، والفهم والصياغة ما زالا يتفاوتان من مرة لأخرى (في إعادة واحدة لم يُستخرج «الشهر اللي فات» تاريخًا فسُئل عنه، وأعيد سؤال بنصه بدل شرحه).
- **الأسئلة بصياغة النموذج (قرار صاحب المشروع، 2026-11-16، بعد أول تجربة للمكتب: «عاوز بني آدم بيكلمني»).** استثناء من قرار 2026-11-14 للأسئلة وحدها: المسار يقرر ما يُسأل، ونص المكتب للسؤال هو **مضمونه**، والنموذج يكتبه كما يسأله موظف استقبال بلهجة العميل. كل جملة خبرية (الترحيب، السعر، الاعتذار، العرض، الإحالة) تبقى بنصها.
  - المدخل يزيد `questions`: أسئلة هذا الرد (`kind: question` في `approved-replies.json`) بمعرّفاتها ونص المكتب (`questionsOf`). والمخرج يزيد `questions: [{ id, text }]`.
  - `checkRewrite(approved, rewrite)` يفحص كل سؤال وحده: سطر واحد ينتهي بعلامة استفهام، بطول قريب، بحروف العربية وعلامات الترقيم العادية فقط، بلا رقم ليس في الأصل، وبلا وعد أو نصيحة أو قبول أو كلمة تُقرأ جوابًا («أبشر»، «أكيد»…) ولا عبارة محظورة، ولا أسئلة أكثر، والسؤال الطويل يحتفظ بربع كلماته ذات المعنى على الأقل. ما يسقط يُرسل بصياغة المكتب، والباقي بصياغة النموذج.
  - `humanize(message, choice, …)` يبدّل نص الأسئلة المقبولة ويعيد التركيب (`joinParts`) ثم `composeCourtesy`؛ و`checkPhrasing` يقارن بالنص بعد التبديل، فالجمل الخبرية تبقى مقفلة كما كانت.
  - بالعربية فقط: في التجربة غيّرت صياغة إنجليزية المعنى («how much are they claiming you owe?»)، ففحص الكلمات لا يضمن المعنى. هذا حد معروف في العربية أيضًا: الفحص يمنع الأرقام والوعود والنصائح، ولا يثبت أن السؤال هو نفسه.
  - النص المعتمد يُحفظ مع الرسالة (`draft`) ويظهر للموظف في اللوحة، والرسالة التالية تُفهم على ما أُرسل فعلًا (`last_bot_message`).
- إحصاء الصياغة في `phrasingStats`: `adapted` (تغيّر)، `unchanged`، `time` (لم يبق وقت أو انتهت المهلة)، `error`، `check` (رفضه الفحص). وسبب إرسال النص المعتمد كما هو يُحفظ مع الرسالة في `phrasingReason`.

قواعد الفحص (`checkPhrasing`):

- المدخلات: `draft` (الرد المعتمد)، و`conversation` (آخر 16 رسالة: `client` و`assistant` و`staff`)، و`language` (`arabic` أو `english`)، و`first_reply`.
- `ai/src/phrase-check.js` يقطع `draft` جملًا عند . ! ؟ : ؛ ونهاية السطر (لا داخل رقم). الجملة المكونة من عبارات مجاملة فقط (`COURTESY`) حرة: تبقى أو تُحذف أو تُبدّل. وكل جملة غيرها مقفلة: في ما كتبه النموذج كلماتها نفسها بترتيبها، والترقيم بين كلماتها كما هو (المسافات لا تُحسب)، بلا سطر جديد داخلها، وما قبل أول كلمة وما بعد آخر كلمة («(»، «)»)، ثم نهايتها: علامة السؤال تبقى، ولا علامة سؤال على جملة خبرية، والنقطة الأخيرة في الرد وحدها يجوز حذفها. يجوز «و» أو «ف» على أول كلمة، و"and" في أول جملة إنجليزية.
- حول الجمل المقفلة عبارات `COURTESY` كاملة فقط، بلغة الرد، ويجوز أن تسبقها «و» أو «ف» (لا أن تفقد واوها: «وأنتم» ليست «أنتم»)، وعددها لا يزيد على كلمات جمل `draft` الحرة وثماني كلمات. المجموعات ذات `cues` لا تُضاف إلا إذا كتب العميل أحد مفاتيحها كلمة كاملة (مع «و» أو «ف» أو «ب» أو «ل» ملتصقة): العزاء بعد ذكر وفاة، والدعاء للموقوف والمريض، ورد السلام والصباح والمساء والشكر ورمضان والعيد. وعبارات التمهيد («عشان نخدمكم»، "to help you") قبل سؤال مقفل مباشرة. والعبارة الموجودة في `draft` نفسه مسموحة دائمًا. ليست في القائمة عبارات تُقرأ جوابًا: «أكيد»، «تمام»، «أبشروا»، «إن شاء الله»، «تفضلوا»، «حياكم الله»، «أهلًا وسهلًا»، «نتفهم ذلك»، «وأنتم بخير»، «الله يصبركم»، "of course"، "sure"، "welcome".
- بين الجمل والعبارات: مسافات، وسطر جديد واحد (لا أكثر من سطر فارغ، ولا أكثر من سطرين زيادة على `draft`)، و«.» و«،» و«,» والفاصلة العليا، و«:» قبل سؤال فقط. ولا حرف في الرد ليس في `draft` ولا في العبارات ولا من هذه: فلا حروف خفية ولا محارف اتجاه ولا أشكال مشابهة ولا أرقام بنظام آخر ولا رموز تعبيرية ولا أكثر من علامتي تشكيل متتاليتين.
- شبكة ثانية بعد ذلك: لا عبارة وعد أو حكم أو رأي قانوني أو قبول («يحق»، «تستحق»، «ننصح»، «المادة»، «نوافق»، "entitled"...) ولا عبارة محظورة إلا ما في `draft`، تُقارن كلمة بكلمة. كل رقم في `draft` موجود ولا رقم جديد، ولا سطر قائمة، ولا رابط أو بريد جديد أو ناقص، واللغة لغة النسخة.
- مراجعة الفريق الأحمر (2026-11-14) وجدت 42 طريقة تمر بها صياغة مضللة من فحص الكلمات وحدها: نفي يُقطع بفاصلة أو سطر («لا، توجد شواغر»)، وأرقام يقلب عرضها محرف اتجاه، وعبارة مجاملة تُقرأ جوابًا. وجولتها الثانية وجدت 21 أدق: علامة داخل عبارة مجاملة تجعلها ادعاءً ("So, we can help you.")، ومفتاح داخل كلمة أخرى («بعيد» ليست العيد)، ونص يُدفع بعيدًا بالتطويل أو بآلاف النقاط، وشدة محذوفة تغيّر الكلمة («نقدّر» و«نقدر»). كلها مرفوضة الآن، ولكل نوع اختبار في `ai/tests/phrase-check.test.js`، وكل نص معتمد يمر على نفسه.
- قواعد الجولة الثانية: كلمات الجملة المقفلة تُقارن كما كُتبت بتشكيلها (لا يختلف إلا التطويل وحالة الحروف اللاتينية)، و«’» و«'» علامة واحدة و«،» و«,» علامة واحدة. داخل العبارة مسافات فقط (أو فاصلة "we're" العليا). بعد التمهيد «:» أو «،» أو مسافة ثم السؤال. الفاصل الحر ست خانات على الأكثر منها علامتان، ولا أربع مسافات متتالية، ولا تطويل أكثر مما في `draft`، والفاصلة العليا بين حرفين فقط. المفتاح الأقصر من أربعة أحرف يُطابَق كما هو دون «و» أو «ب»، و«توفي» يليها «ب…» وفاء لا وفاة. التعاطف والدعاء للموقوف لا يضافان بعد سؤال العميل عن نتيجة قضيته أو الإفراج (`blockedBy`).
- إذا مر يُرسل النص المركّب، ويُحفظ `draft` مع الرسالة و`phrasing: 'model'`. إذا لم يمر، أو فشل الطلب، أو تجاوز `PHRASING_TIMEOUT_MS`، يُرسل `draft` و`phrasing: 'approved'` مع `phrasingProblems`.
- لا صياغة في الوضع التجريبي، ولا بعد تعطل الفهم (`model_failed`)، ولا مع `PHRASING=off`. نموذج الصياغة هو نموذج الفهم ما لم يحدد `PHRASING_MODEL` غيره.
- وقت الكتابة يُحسب من مدة «يكتب…»، ويُعاد فحص استلام الموظف والإيقاف بعدها. «يكتب…» يظهر منذ بداية قراءة الرسالة، فوقت الفهم والكتابة جزء من مدة الكتابة لا يضاف إليها. للرد موعد: 15 ثانية من وصول آخر رسالة للعميل، و10 للرد الأول (`reply_target_seconds`، `first_reply_target_seconds`). تُعطى الصياغة ما بقي منه، وإذا بقيت أقل من ثانية بعد أقصر توقف يُرسل `draft` و`phrasingProblems: ['latency_budget']`.

## 5. الحالة

```js
{
  status: 'intake',          // intake | waiting | with_staff | closed | done
  phase: 'triage',           // triage | offered | booking | document_wait | cv_wait | done
  closedOutcome: null, everWithStaff: false, firstReplyDone: false,
  sender: null,              // existing_client أو job أو training أو غيرها، أول ما يُعرف ويبقى
  case: { specialty, goal, task_type, case_status, monetary, amount_min, amount_max, currency,
          employment_ongoing, employment_end_months_ago, employment_end_needs_confirmation, dismissed,
          prior_procedure, acknowledgment_or_excuse, detained, in_riyadh, detention_place,
          event_kind, event_days_until, government_party, state_owned_company, domestic_worker,
          enforcement_kind, enforcement_exhausted, final_judgment_nothing_left, foreign_buyer,
          heirs_count, client_outside_ksa, case_outside_ksa, complex_matter, urgent_said },
  known: { name, client_role, client_type, parties, city, service_description, desired_outcome,
           stage, file_reference, preferred_time, other_party, phone, consultation_format, cv_field },
  facts: { dates: [], amounts: [], documents: [], said: [], answers: [], earlierAmounts: [],
           conversion: null },     // تحويل المبلغ بعملة أخرى للريال، أو سبب عدم تحويله (6.4.2)
  asked: [], answered: [], questionCount: 0, followupMessages: 0, leadSent: false,
  lastAsked: [],             // أسئلة آخر رسالة، لتُفهم إجابة العميل عليها
  amountRefused: false,      // رفض ذكر المبلغ بعد سؤاله
  offered: null,             // { options: [...], card }
  outcome: null,             // انظر 6.6
  priority: 'normal',        // normal | urgent
  reasons: [],               // القواعد التي أدت للنتيجة، للسجل
  offers: [],                // [{ reply, prices: [keys] }]
  used: {}, sentCount: 0, handoff: null, lang: { last: null },
  clarifyAttempts: 0, lastClientAt: null, sensitiveWarned: false, awardSent: false,
  legalOffered: false        // أُرسل عرض الاستشارة للسؤال القانوني
}
```

- كل قيمة غير `null` في `extracted` تُنسخ إلى `case` أو `known`، وتحل محل القديمة. المبلغ بعملة أخرى يُحوَّل للريال قبل نسخه (6.4.2).
- الاسم والمدينة والمكان والطرف الآخر والرقم تُحذف إن لم ترد حروفها في نص العميل. التواريخ والمبالغ الحرفية تُحذف إن لم ترد ككلمات كاملة. كما في النسخة الأولى (F07).
- `answered_questions` تُضاف إلى `answered` بعد حذف ما ليس في الكتالوج.

المدخلات: كما في النسخة الأولى (`text`، `voice`، `image`، `document`، `timer`، `model_failed`، `staff_*`، `idle_expired`)، ومعها `outOfHours` (منطقي) في رسائل العميل.

المخرجات: `{ state, messages: [ { parts, text } ], events }`. الأحداث: `handoff_created` مع `reason` و`urgent`، و`handoff_updated`، و`handoff_urgent`، و`silent`.

## 6. الفرز

### 6.1 ترتيب معالجة رسالة العميل

1. تحديث اللغة، ونسخ البيانات، وتسجيل الأسئلة المُجاب عنها.
2. الرد الجانبي، يُضاف قبل الخطوة الرئيسية في الرسالة نفسها:
   - `sensitive_data` ← `sensitive_warning` مرة واحدة.
   - `asks_identity` بعد أول رد ← `identity`.
   - `admin_topics` ← ردودها (4.4).
   - `price_match` (سعر عرضه المكتب نفسه من قبل) ← `discount` (6.16)، وطلب للموظف بسبب `pricing_request` (3.3: «مطالبة مطابقة عرض سابق من المكتب نفسه تُحال للفريق»). وإلا `wants_discount` (خصم، تقسيط، سعر مكتب آخر، الدفع بعد التحصيل) ← `discount_declined` دون طلب للموظف: لا خصم ولا تقسيط، والسعر يبقى (3.3، معتمد). سعر المكتب الآخر يُعتذر عنه بقرار صاحب المشروع (15 نوفمبر)، والمثال 16 كان يحيله بالرد 6.16.
3. الخطوة الرئيسية بحسب `phase` (6.2 إلى 6.5).
4. أول رد في المحادثة يبدأ بـ[رد التحية] ثم `welcome_full` (تحية فقط أو غير مفهوم) أو `welcome_short`.
5. إذا كان في الرسالة رد فيه وعد بالتواصل (`review_representation`، `referred*`، `human`، `booking_received`، `business_development`، `transfer_unclear`، `discount`، `returning`، `no_approved_answer`، `waiting`) و`outOfHours` صحيح، يُلحق `out_of_hours`، والعاجل أيضًا كما في القاعدة 1.8.
6. كل ذلك رسالة واحدة. حد الرسائل في المحادثة كما في النسخة الأولى.

### 6.2 الطور `triage`، بالترتيب، ويتوقف عند أول بند يحسم

1. **المرسل:** `existing_client` أو `goal = follow_up` ← `q_existing_client` إن لم يُعرف رقم الملف ولم يُسأل، وإلا `referred_team` وطلب بسبب `follow_up`. `job` أو `training` (آخر ما قاله العميل منهما) ← `cv_received` إن وصل مستند مع الرسالة أو قبلها، وإلا `cv_job` أو `cv_training` والطور `cv_wait`. `marketing` ← `marketing`، النتيجة `marketing`، دون طلب. `law_firm` ← `business_development` وطلب. `wrong_number` ← `wrong_number`. `delivery` ← `delivery` وطلب عاجل.
2. **طلب موظف:** `wants_human` ← `human` وطلب بسبب `wants_human`.
3. **العاجل** (6.3) ← يُسأل `q_urgent` مرة (نوع الإجراء وتاريخه وتاريخ التبليغ)، أو `q_urgent_detained` مرة إن لم يُعرف مكان التوقيف، ثم `referred_urgent` وطلب عاجل. من قال إنه لا يعرف أين يُحتجز الموقوف (`detention_place_unknown`) لا يُسأل عن المكان؛ وإذا كان في الرياض يسبق `referred_urgent` عرضُ خدمة الاستعلام `offer_detainee_inquiry` بسعرها (5.13). المكان المعروف لا يُذكر معه سعر (A.15، المثال 12). اقتراب مدة العمالي من 12 شهرًا يُحال مباشرة. السجن خارج الرياض ← `decline_prison_outside`. إذا كان `goal = document` وللبطاقة عرض مستند، يُرسل العرض والأولوية عاجلة.
4. **المستبعد** (6.3) ← رده، النتيجة `declined`، دون طلب.
5. **سؤال قانوني** ← `legal_offer` بسعر استشارة البطاقة، أو `legal_offer_from` إذا كانت الاستشارة «يبدأ من»، أو `legal_offer_generic` دون بطاقة؛ الطور `offered` بخيار `consultation`. إذا كانت البطاقة `criminal` ← تُكمل الأسئلة دون سعر.
6. **دون تخصص:** أول رد غير مفهوم ← `welcome_full`. بعده: رسالة لا تذكر موضوعًا («عندي مشكلة وأريد مساعدتكم») ← `q_topic` أولًا؛ وإلا `q_goal` مرة، ثم `q_topic` مرة، ثم `clarify` مرة، ثم `transfer_unclear` وطلب بسبب `unclear`. وصف من كلمات عامة فقط ليس موضوعًا ولا يُحال به (`unlisted_subject` يحتاج وصفًا فعليًا). بعد إحالة بلا موضوع لم يستلمها موظف: `subject_again` مرة، ومتى ذكر العميل موضوعًا له بطاقة سُحب الطلب وأكمل الفرز. رسالة ليست مجاملة ولا إغلاقًا لا تُترك بلا رد. تحية أو شكر وحدهما لا يُحسبان غموضًا.
7. **الهدف:**
   - `consultation` ← عرض الاستشارة (6.5)، والهاتفية بسعرها حيث للمسار هاتفية (3.1، A.3) ولو لم يذكرها العرض السابق. البطاقة التي لها `consultation_offer` تُرسل عرضها. والبطاقة التي لها `consultation_quote` (تأسيس الشركات: القاعدة لا تذكر سعرًا لاستشارته، القسمان 2 و5.12) ← `fees_by_team` («تُحدد الأتعاب بعد مراجعة المختص»، القسم 3) ثم `referred_quote`، النتيجة `document_request` والسبب `quote`.
   - `document` ← `tasks[task_type]` من البطاقة إن وجدت، وإلا `document`، وإلا `offer_quote`. ثم ما في `then`. الخدمة التي تُسعَّر بعرض (`offer_quote`) يسبقها سؤالا البطاقة الأولان مرة واحدة، ليُعرف المطلوب قبل الإحالة؛ ومعها استشارة التخصص حيث لها سعر معتمد (`offer_quote_consult`) (قرار صاحب المشروع، 16 نوفمبر 2026؛ القاعدة 1.11 كانت تنقل طالب المهمة إلى السعر مباشرة).
   - غير ذلك ← 8.
8. **أسئلة البطاقة:** القائمة `first` ثم `followups`. إذا كان `case_status` هو `existing` أو `judgment` تُستعمل قائمتا `case_overlays` مكانهما، والحد يبقى من البطاقة. السؤال يُتخطى إذا سُئل، أو أُجيب عنه، أو عُرف أحد حقوله `known` (كلها في `known_all`، وإذا كان معه `known_all_if` فلا يكفي ذلك إلا لتلك القيم: `q_urgent` لا يُسأل في جلسة أو تحقيق أو مزاد عُرف نوعها وتاريخها، ويُسأل في المهلة لأن تاريخ التبليغ ناقص، القاعدة 1.7 والمثال 7)، أو لم يتحقق شرطه `when`. ما بقي من أسئلة `first` يُرسل معًا في رسالة واحدة كما يسأله المكتب (4.2). أسئلة المتابعة سؤالان على الأكثر في الرسالة (مجموع `q`). أول رسالة أسئلة يسبقها `lead`، ورسائل المتابعة يسبقها `ack` ما بقيت له صياغة، إلا في أول رد في المحادثة فيسبقها `lead`. يتوقف السؤال عند 7 أسئلة في المحادثة، أو 3 رسائل متابعة.
9. **قرار البطاقة** يُفحص بعد كل رسالة، وقبل إرسال أي سؤال (6.4).
10. **انتهت الأسئلة دون قرار:** بطاقة خدمة (`service_card`) ← `tasks[task_type]` أو `after_questions` أو `consultation_offer` أو `offer_quote` مع `referred_quote`. غيرها ← `review_representation` وطلب بسبب `representation_review`.

### 6.3 العاجل والمستبعد

العاجل إذا تحقق أحد:
- `detained = true`.
- `event_kind` من `hearing`، `investigation`، `objection_deadline`، `limitation`، `general_assembly`، `auction`، `reply_deadline`، و`0 ≤ event_days_until ≤ limits.urgent_days`.
- `case_status = judgment` وليس `event_days_until > limits.urgent_days`.
- بطاقة `labor` و`employment_end_months_ago` بين `labor_review_from_months` و`labor_review_to_months`.
- `urgent_said = true` مع موعد قادم مذكور (`event_days_until` غير `null`) داخل الحد.

الحد المالي لا يؤخر العاجل.

المستبعد: `specialty` من قائمة `excluded`، أو `government_party` (إلا إذا كان `state_owned_company` ← إحالة بسبب `ambiguous_party`)، أو `domestic_worker` ← `domestic_labor`، أو `case_outside_ksa` ← `foreign_case`، أو `final_judgment_nothing_left` ← `finished_case`، أو بطاقة `enforcement` مع `enforcement_exhausted` ← `enforcement_exhausted`، أو `detained` مع `in_riyadh = false` ← `prison_outside_riyadh`.

### 6.4 قرار البطاقة

بالترتيب:
1. **العملة:** المبلغ بعملة غير الريال يُحكم عليه بالحد في البند 6 بعد تحويله للريال (6.4.2). إذا لم يُحوَّل، أو وقع بعد التحويل في حدود `currencies.margin` من الحد ← إحالة بسبب `other_currency` عند فحص الحد. البطاقة التي لا حد لها لا أثر فيها للعملة.
2. **مطالبة جماعية** (`group_review` و`complex_matter`، أي عدة عمال ضد صاحب عمل واحد): يُسأل `q_labor_group` (العدد والمجموع) مرة، ثم `review_representation` بسبب `group_claim` (4.2).
3. **مدة العمالي** (`time_rule`)، لمطالبة العامل المالية الجديدة فقط (القاعدة 4): لا لطلب غير مالي (`monetary = false`، فلا يُسأل عن المبلغ ولا يُطبق الحد، ويُحال للمراجعة بعد أسئلته)، ولا لصاحب العمل (`client_role = employer` أو `client_type = company`) ولا لقضية `existing` أو `judgment`. العلاقة مستمرة أو أقل من `labor_review_from_months` ← يستمر. بين الحدين ← عاجل (6.3). تاريخ قال العميل إنه لا يطابق العقد أو الإشعار (`employment_end_disputed`، جوابه «لا» عن `q_labor_confirm_end`) ← إحالة عاجلة للتدقيق (4.3). أكثر من `labor_review_to_months`: التاريخ التقريبي (`employment_end_needs_confirmation`) يُسأل عن مطابقته مرة، وإن بقي غير مؤكد ← إحالة عاجلة للتدقيق لا اعتذار؛ وإذا `acknowledgment_or_excuse` صحيح ← يُسأل `q_labor_ack_written` مرة (هل هو مكتوب، دون طلب نسخة، وفيه عبارة المدة) ما لم يُجب عنه، ثم `referred`؛ وإذا أُجيب عنه من قبل، أو كان المؤشر `prior_procedure` ← `referred_labor_time`؛ والسبب `labor_time_indicator` (4.3، المثال 8.4)؛ وإلا يُسأل `q_labor_time_indicators` مرة؛ بعده دون مؤشر ← `decline_labor_time`، الطور `offered` بخيار `consultation`.
4. **نوع التنفيذ** (`notes_only`): `enforcement_kind` غير `note` ← `decline_enforcement_other`: اعتذار مع استشارة «تُحدد أتعابها بعد مراجعة المختص»، لأن جدول القاعدة 2 يذكر لها «استشارة» بلا سعر، والـ1,000 لمنازعة السند وحدها (5.10). وإذا اختارها العميل ← `referred_quote` وطلب بسبب `quote`.
5. **غير مالي** (`monetary_only` و`monetary = false`) ← لا حد؛ تُكمل الأسئلة ثم 6.2.10. **المشتري الأجنبي** (`foreign_buyer_quote` و`foreign_buyer`) ليس مطالبة ← لا حد؛ تُكمل الأسئلة ومنها `q_re_foreign` (استشارة عن التملك أم عرض سعر للامتثال الكامل)، ثم الاستشارة إن اختارها، وإلا `offer_quote` و`referred_quote` (5.6).
6. **الحد** (`threshold`):
   - المبلغ المذكور من جديد يحل محل حدّيه معًا («أكثر من 200 ألف» بعد «50 ألف» لا أعلى له).
   - المبلغ معروف وأعلاه أقل من الحد ← القضية القائمة (`case_status = existing`) يُسأل عن جلستها القادمة أولًا (`q_case_next_hearing`)، فالقريبة عاجلة ولو كان المبلغ دون الحد (ملاحظة 4.4). ثم إذا `below_outside_ksa_refer` والعميل خارج المملكة ← إحالة بسبب `outside_ksa_below`. وإلا يُسأل ما لم يُعرف، كل واحد في رسالة لأن في كل منهما سؤالين: أولًا `q_labor_status` لمطالبة عامل جديدة لم يُعرف انتهاء علاقتها (القريبة من 12 شهرًا عاجلة)، ثم `q_check_new` إذا لم يُعرف `case_status` ولا موعد قادم. بعده ← رد `below.reply` (`below.reply_complex` إذا `complex_matter`: الاستشارة فيه تبدأ من السعر الأعلى)، الطور `offered` بخيارات `below.options`، النتيجة `declined`، السبب `below_threshold`.
   - أدناه يساوي الحد أو أكثر ← تُكمل الأسئلة ثم `review_representation`.
   - يعبر الحد ← `amount_estimate` أو `q_amount_estimate` مرة، ثم إحالة بسبب `amount_unclear`.
   - غير معروف بعد سؤال المبلغ ← سؤال التقدير مرة؛ إذا رفض أو بقي غير معروف ← إحالة بسبب `amount_unknown`.
7. لا حد ← تُكمل الأسئلة ثم 6.2.10.

الحدود «فأكثر»: المبلغ المساوي للحد يُدرس للتمثيل.

### 6.4.1 في كل الأطوار بعد الفرز

في الأطوار `offered` و`booking` و`done`: طلب الموظف (`wants_human`) ينشئ الطلب بسبب `wants_human`، والطلب القائم يحتفظ بنتيجته ويُضاف السبب إليه. ومؤشر عاجل جديد (لم تكن الأولوية عاجلة قبل الرسالة) يعيد الطور إلى `triage` ويمر بـ6.3 فورًا. في `document_wait` تُحال الرسالة التالية كما هي، والطلب عاجل إن كانت الأولوية عاجلة. طلب المستند العاجل يُنشئ الطلب العاجل قبل العرض.

### 6.4.2 المبلغ بعملة أخرى (القاعدة 4.4)

القاعدة: يُحوَّل المبلغ للريال بسعر اليوم، ثم يُحال إذا كان فوق الحد، ويُعتذر إذا كان تحته. النموذج لا يحوّل: يقرأ المبلغ بعملته (`amount_foreign_min`، `amount_foreign_max`) ورمز العملة (`amount_foreign_code`) إذا بيّنته الرسالة، و`null` إذا لم يبيّنه («دينار» أو «درهم» أو «روبية» بلا دولة، ولا يُستنتج من لهجة العميل). الكود (`ai/src/currency.js`) يحوّله عند تسجيل الرسالة، ويحفظ حديه بالريال في `case.amount_min` و`case.amount_max`، وطريقة التحويل في `facts.conversion` للسجل:

- الدولار والعملات المربوطة به (`currencies.pegged_per_usd` في `config/triage.json`: الدرهم الإماراتي، والريال القطري، والدينار البحريني، والريال العماني، والدينار الأردني) بسعرها الثابت، والريال 3.75 للدولار. لا تحتاج جدولًا.
- غيرها بجدول اليوم الذي يقرؤه الخادم مرة في اليوم (`server/rates.js`، المصدر ExchangeRate-API دون مفتاح، ولا يحمل الطلب شيئًا عن العملاء) ويمرره في `env.rates`، ما دام عمره أقل من `currencies.rates_max_age_days` أيام.
- لا تحويل إذا لم تتضح العملة (`unclear_currency`)، أو لم يوجد سعر حديث لها (`no_rate`)، أو لم يُذكر إجمالي واحد (`no_amount`).

فحص الحد (6.4، البند 6): المبلغ المحوَّل يُقارن بالحد كمبلغ الريال. إذا وقع أحد حديه في حدود `currencies.margin` (5%) من الحد، فالسعر نفسه هو ما يحسمه، فيُحال بسبب `other_currency`، وكذلك المبلغ الذي لم يُحوَّل. وحيث لا حد، لا أثر للعملة. سطر المبلغ في السجل يذكر المبلغ بكلمات العميل، ثم قيمته بالريال وسعر الوحدة وتاريخه ومصدره، أو سبب عدم التحويل؛ وتذكر لوحة الموظفين مصدر الأسعار كما تطلب شروطه. الهامش وعمر الجدول من إعدادات النظام: القاعدة لا تحددهما.

### 6.4.3 ما أُضيف في مراجعة المطابقة (15 نوفمبر، المرحلة 13 من `tasks.md`)

- **ميزانية الأسئلة:** `max_questions` تعد الأسئلة، والسؤال المركب واحد كما تعده القاعدة (1.11، 4.5)؛ و`questions_per_message` يعد أجزاء السؤال في الرسالة. حد رسائل المتابعة ثلاث.
- **العمالي (4.1، 4.5):** المتابعة: السبب، التحقيق، تعويض العقد، ثم «هل قُدّم طلب تسوية أو دعوى» (لازم)، ثم سؤال العقد الفرعي بحسب `contract_compensation` (كم التعويض، أو كم المدة المتبقية). المدة المتبقية لا تُسأل إذا قال العميل إن عقده انتهى بمدته أو لم يُجدَّد (`contract_expired`؛ قرار صاحب المشروع، 16 نوفمبر 2026). الاختياريان (آخر أجر، بنود المطالبة) لا يُسألان ضمن الحد. طلب «استشارة فقط» يُسأل مع عرضها عن موعد قريب (`q_deadlines`) ما لم يُسأل عنه مع `q_check_new`، و«لا» عنه ليست رفضًا للاستشارة.
- **الحكم الصادر (5.9، المثال 18):** العاجل بسبب `judgment` يسأل `q_judgment_type` و`q_judgment_dates` (ومعهما `q_judgment_new_evidence` إذا `task_type = reconsideration`) مرة، لا `q_urgent`، ثم `referred_urgent`. والسجل يسميه «مراجعة حكم».
- **التجاري (5.1):** السؤال الأول «ما سبب المطالبة وكم إجمالي المبلغ؟»، والمتابعة بمعايير الفرز المعتمدة أولًا: المستندات والحكم السابق، ثم موقف المدين وقدرته على السداد، ثم الإنذار السابق وشرط التحكيم.
- **الموقوف (5.13):** إذا لم يُعرف المكان ولا المدينة تُسأل المدينة مرة (`q_crim_city`) والطلب العاجل قائم: الرياض ← عرض الاستعلام والإحالة العاجلة، غيرها ← الاعتذار 6.6، «ما نعرف» ← الإحالة العاجلة.
- **العلامة التجارية (5.11):** الاعتراض على الرفض (`tasks.objection`) يُسأل معه عن تاريخ تبليغ الرفض (`ask`)، والطلب عاجل بسبب `tm_rejection` (`urgent`)، والجواب يصل الفريق مع الطلب.
- **العقود (5.7):** `q_contract_purpose_parties` بعد اللغة والصفحات. والعقد السري (`confidential`) يُسأل عن نوعه ولغته وصفحاته فقط.
- **التوثيق (3.1):** `questions_before_offer`: عدد المستندات ونوعها والصيغة قبل السعر، ولو طُلب التوثيق مباشرة.
- **موضوع خارج القوائم (2.1):** إذا وصف العميل موضوعه ولم يكن في القوائم ← `referred` وطلب بسبب `unlisted_subject`، بعد `q_topic` مرة، لا استيضاح ثانٍ.
- **أسئلة المكتب:** `consultation_credit` ← `admin_consult_independent` (جملة 3.1)، و`documents_email` ← `admin_documents_email` (1.8). وبعد `booking_received` يُرسل `booking_documents` (A.4). وجائزة واحدة في الرد (1.8).
- **السير الذاتية (5.16):** من ذكر مجالين يُسأل `cv_two_fields` مرة، والأول في السجل رغبة أساسية والثاني إضافية. السيرة المرسلة صورة وحدها ← `cv_pdf` مرة، والملف بعدها يُستلم. رسائل المتقدم تُحفظ بكلماته في السجل (المؤهل والخبرة واللغة كما كتبها)؛ ملف السيرة نفسه لا يُقرأ.
- **السجل (7):** «ما عُرض» يذكر 6.3 بلا سعر، وسعر الاستشارة الذي ذُكر جوابًا، والهاتفية التي اختارها العميل؛ «المعلومات الناقصة» تذكر الأسئلة التي سُئلت ولم يُجب عنها؛ ورقم التواصل الذي ذكره العميل؛ واللغة غير المعروفة «غير مذكور»؛ ومن لم يقبل العرض «لم يقبل العميل ما عُرض عليه». الحذف يُبقي التواريخ والنطاقات والمبلغ المسمّى مبلغًا، ويحذف الرمز المكتوب بحروف أو مجموعات.
- **العملة وحدها:** «المبلغ بالدولار مو بالريال» دون رقم ← يُحوَّل المبلغ المذكور من قبل، إذا سمّى النص عملة.

### 6.5 الأطوار الأخرى

- **عرض الاستشارة:** استشارة البطاقة من `consultations`. السعر `complex_from` إذا `complex_matter`، و`dispute_from` إذا `task_type = dispute`، وإلا `price`. `consult_offer` أو `consult_offer_from`، و`{consultation_formats}` فيها الهاتفية إذا `phone`. الطور `booking`. إذا كانت بيانات الحجز كلها معروفة (الاسم والموضوع والطريقة والوقت) ← `consult_price` أو `consult_price_from` ثم `booking_received`، والنتيجة `booking_request` (6.8 و6.9) دون أن يُسأل عما قاله.
- **`offered`:** اختيار الاستشارة (`goal = consultation`، أو `yes_no = yes` وأول الخيارات استشارة) ← عرض الاستشارة، ودون موضوع معروف (`general`) يُسأل `q_topic` أولًا؛ `consultation_format = phone` والخيار متاح ← بسعر الهاتفية. اختيار المستند، أو السؤال عن سعر الصياغة (`task_type = drafting`) ← عرض البطاقة؛ ومستند لم يُعرض: يُعرض إن كان للبطاقة مستند ولم يسبق اعتذار، وإلا `referred` بسبب `client_insists`. هدف آخر ← بعد اعتذار `client_insists`، وإلا يعود الفرز. `yes_no = no` أو شكر ← رد المجاملة، النتيجة تبقى، الطور `done`. السؤال القانوني نفسه مرة أخرى دون جديد غير موضوعه ← `legal_offer` ما بقيت له صياغة، ثم لا رد (المعيار 51). معلومة حاسمة جديدة (مبلغ يتجاوز الحد، أو موعد عاجل) ← يعود الفرز، ويحل سبب `facts_changed` محل سبب الاعتذار. وقائع القضية بعد عرض الاستشارة لسؤال قانوني ← يعود الفرز؛ وبعد اعتذار ← `referred` بسبب `client_insists`. مجاملة ← ردها. «خلني أفكر» وما لا طلب فيه ← `deferral_reply` مرة والعرض يبقى. غير ذلك ← `clarify` مرة ثم إحالة.
- **`booking`:** هدف المستند ← عرضه؛ هدف آخر ← يعود الفرز (أو `client_insists` بعد اعتذار)، ويُقرأ الهدف قبل «لا». سؤال عن المكتب وحده ← جوابه، والحجز ينتظر بياناته. الرفض ← رد المجاملة، النتيجة `offer_declined`. لا يصنع الحجز إلا بيانات الحجز (الاسم أو الوقت أو الطريقة أو وصف الموضوع) أو «نعم» أو جواب السؤال: إن لم يُعرف الاسم ولم يُسأل `q_booking_name` ← يُسأل، وإلا ← `booking_received`، طلب بسبب `booking`، النتيجة `booking_request`، الطور `done`. مجاملة ← ردها، و«خلني أفكر» ← `deferral_reply` مرة، وغير ذلك ← `booking_details` بما بقي. وطلب مكالمة هاتفية لاستشارة ليست لها هاتفية (A.3) ← `booking_details` بالطرق المتاحة. وبيانات الحجز أو «نعم» مع سؤال عن المكتب ← جوابه والحجز معًا.
- **`document_wait`:** بعد عرض يسأل سؤالًا (`offer_labor_drafting`، أو `offer_labor_objection` لقضية صدر فيها حكم): «لا» أو شكر ← رد المجاملة، النتيجة `offer_declined`، دون طلب. «خلني أفكر» وما لا شيء فيه ← `deferral_reply` مرة. ملف أو رسالة غير ذلك ← `referred_quote`، طلب بسبب `document_request`.
- **`cv_wait`:** مستند ← `cv_received`، النتيجة `cv`. طلب موظف ← 6.4.1. نص فيه طلب قانوني (تخصص، هدف، سؤال قانوني، وصف خدمة، توقيف، حالة قضية) ← يُنسى المرسل ويبدأ الفرز. «تدريب» بعد `cv_unclear` ← `cv_training`. نص بعد وصول مستند («أرسلتها فوق») ← `cv_received`. بيانات المتقدم دون سيرة، أو «ما عندي سيرة» ← `cv_noted`. مجاملة ← ردها.
- **`done`:** معلومة حاسمة جديدة بعد اعتذار ← يعود الفرز. سؤال قانوني ← `legal_offer` إن لم يُرسل ولم يكن طلب قائم، والسؤال نفسه مرة أخرى ← لا رد بعد استنفاد صياغته (المعيار 51)؛ ومع طلب قائم ← `waiting` والنتيجة تبقى. رسالة قُرئت أولًا تسويقًا ثم جاء فيها طلب قانوني ← يعود الفرز. طلب الاستشارة ← عرضها، ولو رفضها قبل ذلك. شكر أو مجاملة ← ردها. وطلب قائم ← `waiting` بصياغتيه ثم صمت. وبلا طلب: 6.5.1.
- ما بعد `then`: `refer_quote` ← `referred_quote` وطلب بسبب `document_request`. `refer` (خدمة بسعر ثابت) ← `referred` وطلب بسبب `document_request`. `booking` ← `booking_details` والطور `booking`.

### 6.5.1 بعد النتيجة

لا تبقى رسالة فيها طلب دون رد:
- **موضوع آخر:** تخصص غير تخصص القضية بعد خروجها من الأسئلة (`offered`، `booking`، `document_wait`، `cv_wait`، `done`) موضوع ثانٍ لا تصحيح للأول، وكذلك طلب قانوني لم يُسمَّ موضوعه (`general`، «عندي موضوع ثاني») فيُسأل عن موضوعه. وأثناء الأسئلة، بعد سؤال مُجاب أو مبلغ معروف: إذا كان الأول لن يُعتذر عنه يُنشأ للموظف طلب بسبب `unfinished_matter` حتى لا يضيع، ثم يُفرز الثاني. وما يُحفظ للأول في `matters`: نتيجته وأسبابه ومبالغه وتواريخه وملفاته وعروضه، ولا يبقى شيء منها في الثاني. إذا لم يكن طلب قائم ← يُحفظ الأول في `matters` (التخصص والنتيجة والأسباب، ويظهر في السجل) وتُفرّغ القضية وأسئلتها وحقول الموضوع، ويبدأ الفرز للموضوع الجديد. وإذا كان طلب قائم ← يُضاف الموضوع إلى `matters` بمبالغه وتواريخه وسبب `new_matter` إلى الطلب، ولا يُكتب شيء منه فوق قضية الأول، والرد `waiting`؛ وإذا كان فيه مؤشر عاجل يصير الطلب القائم عاجلًا (الحدث `handoff_urgent`) والرد `referred_urgent`. الموضوع الجديد يأخذ `legal_offer` و`waiting` من جديد، ووقائعه في السجل له وحده. وكذلك «عام» لا يكتب فوق تخصص معروف أثناء الأسئلة، و«عميل حالي» يخمّنه النموذج في منتصف الأسئلة (دون رقم ملف ولا متابعة) لا يغيّر المسار. ووقائع بلا موضوع في الرسالة التي تلي موضوعًا أُضيف للطلب القائم («وجلستها بكرة») تُضاف إليه، والموضوع نفسه مرة أخرى لا يُضاف مرتين. ومحادثة أغلقها موظف أو انتهت مهلتها أو أعادها للمساعد: الموضوع الجديد يُضاف لما يراه الموظف، والرد `returning`، ولا يُعاد الفرز (المعيار 34).
- **طلب وظيفة أو تدريب بعد موضوع قانوني:** موضوع ثانٍ، ويبدأ رد 5.16. وطالب الوظيفة الذي يكتب عن قضية له ← يُفرز كعميل.
- **طلب بعد النهاية مع تحية أو شكر أو سؤال عن المكتب:** يُعالج الطلب ولا يُكتفى بالمجاملة أو بجواب السؤال («السلام عليكم، غيرت رأيي وأبغى محامي» ← `referred` وطلب بسبب `client_insists`). التحية أو الشكر وحدهما يبقيان كما هما.
- **حالة المحادثة بعد النهاية:** كل طلب يُنشأ والحالة `done` يجعلها `waiting` فيظهر في قائمة الموظفين؛ وعرض استشارة أو حجز يبدأ بعد النهاية يعيد الحالة `intake` فيراقبه المؤقت.
- **سؤال قانوني يسمّي موضوعه بعد العرض العام:** المستبعد يُعتذر عنه، وما لا استشارة مسعّرة له يمضي في بطاقته، وما له استشارة مسعّرة يأخذ عرضها. لا يبقى بلا رد. والسؤال نفسه في الموضوع نفسه يبقى على المعيار 51.
- **الموعد المذكور:** مسافته بالأيام تُقرَّب للأعلى، فلا تنقص إلا بعد مرور يوم كامل على ذكره («بعد 4 أيام» تبقى 4 في الرسالة التالية، و«اليوم» يبقى اليوم).
- **سؤال عن المكتب مع مؤشر عاجل** («أخوي موقوف، ممكن رقم للتواصل؟»): يُجاب السؤال ويُفتح الطلب العاجل. و«وش الخدمات» بعد اعتذار عن خدمة مستبعدة يُجاب. ووعد جانبي أثناء طلب قائم (سعر سبق عرضه، سؤال يُحال) يُضاف سببه إلى أسباب السجل.
- **العائد بعد أسبوع:** محادثة بلغ موضوعها خطوة (عرض أو اعتذار أو طلب سيرة أو نهاية) بلا طلب قائم، ورسالة بعد سبعة أيام من آخر رسالة للعميل ← جلسة جديدة: موضوع جديد والأول في `matters`، ولها حد رسائلها. والموعد المذكور يُعد من وقت ذكره (`event_at`)، فيقترب كل يوم.
- **هدف آخر بعد عرض:** `goal` غير الاستشارة والمستند ولو مع «لا» («لا، أبغى محامي يتولى قضيتي»): بعد اعتذار ← `referred` وطلب بسبب `client_insists` (6.19) والنتيجة تبقى `declined`؛ وبعد عرض الاستشارة لسؤال قانوني ← يعود الفرز بالطلب كما صار.
- **بعد `done` بلا طلب:** هدف جديد بعد رفض عرض ← يعود الفرز. «لا» وحدها ← لا شيء (رفض مهذب). إصرار بعد اعتذار (هدف) ← `referred` وطلب بسبب `client_insists`. رسالة غير مفهومة أو فيها ما يُعمل به ← `clarify` مرة ثم إحالة. المسوّق وحده لا يُرد عليه.

### 6.5.2 التوقف عن الرد والملفات

«خلني أشوف الأوراق وأرد عليك» أثناء الأسئلة (`will_reply_later`)، دون شيء فيها ← `deferral_reply` مرة، ولا يُعاد السؤال (المعيار 48). و«ما أعرف» ليست تأجيلًا: يمضي الفرز دون الجواب، فالمبلغ يُطلب تقديره مرة ثم يُحال (القاعدة 1.11)، وغيره لا يُسأل ثانية، والعاجل يُحال. وملف أو صورة دون كلام عنها ثم صمت ← طلب للموظف بسبب `attachments`، لأن الرد وعد باطلاع الفريق (القاعدة 1.5). بعد `abandoned_minutes` من آخر رسالة للعميل، بلا طلب قائم: أثناء الأسئلة وقد عُرف التخصص أو وصف الطلب ← `abandoned`؛ وعميل حالي لم يذكر رقم ملفه ← `follow_up`؛ وأثناء الحجز ← `booking_incomplete`؛ وبعد عرض الصياغة ← `document_pending`.

رد استلام الملف يعد بأن يطّلع عليه الفريق: ملف في `document_wait` ← `referred_quote` وطلب بسبب `document_request`؛ ملف بعد الفرز (`offered`، `booking`، `done`)، أو ملف ثانٍ متتالٍ دون كتابة أثناء الأسئلة ← طلب بسبب `attachments`. أي رسالة مكتوبة تبدأ العد من جديد.

عميل حالي مع مؤشر عاجل ← الطلب العاجل قبل سؤال رقم الملف، و`referred_urgent` بعده.

### 6.6 النتيجة والأولوية

`outcome`: `booking_request`، `document_request`، `representation_review`، `follow_up`، `declined`، `offer_declined`، `referred`، `cv`، `marketing`، `business_development`. `priority = urgent` مع أي عاجل. الطلب للموظف (`handoff`) يُنشأ لكل ما يحتاج تواصلًا، ولا يُنشأ لـ`declined` و`offer_declined` و`cv` و`marketing` والرقم الخطأ.

### 6.7 ما بقي من النسخة الأولى

حد الرسائل، والاستيضاح، والمرفقات، والتوقف عن الرد (يُنشأ الطلب فقط إذا عُرف التخصص أو وصف الطلب)، وتعطل النموذج، وأحداث الموظف، والمحادثة المغلقة والعميل العائد، وإعادة التشغيل دون إعادة الفرز لمن استلمه موظف.

## 7. سجل الإحالة

`record.js` يبني نصًا للموظف من الحالة بحقول القسم 7 من قاعدة المعرفة: الأولوية وسببها، النتيجة، المسار (والخدمة المستبعدة باسمها العربي)، اللغة، الاسم، صفة العميل، الخدمة المطلوبة، ملخص الوقائع بكلمات العميل (أول ثلاث رسائل فيها ما يُعمل به، كل منها بين « » ومقطوعة عند نحو 200 حرف، والمحذوف خارج الاقتباس)، إجابات العميل عن الأسئلة (نص السؤال وجوابه بكلماته)، النتيجة المطلوبة، المرحلة، المبلغ والعملة حرفيًا (وللعملة الأخرى قيمتها بالريال وسعرها وتاريخه ومصدره، أو سبب عدم تحويلها، 6.4.2)، التواريخ حرفيًا، حقول العمالي، عدد الورثة، المستندات (والملف المرسل بنوعه: صورة أو ملف)، المعلومات الناقصة، سبب الإحالة أو الاعتذار (والاعتذار الذي تغيّرت معلوماته يُستبدل سببه بـ«تغيّرت المعلومات بعد الاعتذار فأُعيد الفرز»)، ما عُرض بوصفه ورقم رده في القاعدة وأسعاره، الطريقة والوقت المفضلان، ومجال السيرة الذاتية بالعربية. وإذا كتب العميل تعليمات للمساعد يُضاف تنبيه بأنها لم تُتبع. الحقل غير المعروف يُكتب «غير مذكور»، ومرجع الملف والطرف الآخر والمدينة (ومعها «العميل خارج المملكة») تُذكر إن عُرفت. سبب الإحالة يشمل سبب الطلب نفسه إن لم يكن في أسباب الفرز (سؤال عن المكتب، خصم، توقف عن الرد، أو سبب من الخادم)، و«مواضيع أخرى في المحادثة» تذكر ما في `matters` بنتيجتها وسببها ومبالغها وتواريخها، والعاجل منها. مرجع الملف يُنقل كاملًا ولو طال (يُحذف منه رقم الهوية والآيبان والرمز المسمى فقط). لا يحتوي أرقام هوية أو حسابات أو رموز تحقق: يُحذف من النصوص كل آيبان، وكل رقم من 10 خانات يبدأ بـ1 أو 2، وكل رقم من 9 خانات فأكثر ولو كُتب مجموعات، وكل رقم من 4 إلى 8 خانات قبل أو بعد «رمز، كود، OTP، PIN، SMS، تحقق، نفاذ، أبشر، حساب، بطاقة، آيبان، الرقم السري، كلمة المرور» بأربعين حرفًا أو أقل. الرقم الذي تليه عملة أو «ألف» أو «مليون» مبلغ ويبقى، والتواريخ تبقى.

## 8. الاختبارات

- `ai/tests/triage.test.js`: قرارات 6.3 و6.4 مباشرة.
- `ai/tests/flow.test.js`: سير المحادثة.
- تقييم النموذج: `ai/tests/data/test-set-v2.json` 318 رسالة بتوقعات هذه النسخة: الـ190 الأولى (حوّلها `ai/tests/make-test-set-v2.js` مرة من النسخة الأولى، ثم صارت تُحفظ يدويًا) و128 أُضيفت لكل مسار حرج: طلب موظف، «هل أنت روبوت»، سؤال مكتب مع سؤال قانوني، عميل حالي، غير عميل، غير مفهوم، بيانات حساسة، أسئلة الكتالوج المجاب عنها، محاولة توجيه، تواريخ نسبية وهجرية، ومبالغ بصيغها وبعملات أخرى (رقمها بعملتها ورمزها، و`null` للعملة التي لا تُعرف دولتها). `ai/tests/make-eval-pack.js` يكتب ما يُرسل للنموذج كما يرسله الخادم بتاريخ ثابت للرسائل ولكل رسالة عميل في السيناريوهات الـ48. `ai/tests/grade.js` يقيّم الرسائل بـ19 حدًا (منها دقة المسار 90%، واستدعاء كل مسار حرج، وسقف للسؤال القانوني الخاطئ؛ والمجموعة الأقل من 20 رسالة تحتمل خطأً واحدًا)، و`ai/tests/grade-scenarios.js` يعيد تشغيل السيناريوهات بمخرجات النموذج ويصنف كل إخفاق: حرج ما غيّر النتيجة أو الطلب أو الأولوية أو الأسعار، وثانوي ما اختلف في أي سؤال سُئل وحده. الشرط صفر حرج وثانوي في 5% من الخطوات على الأكثر. مجموعة محجوزة اختيارية خارج المستودع (`HELD_OUT_SET`) تُعد إخفاقاتها ولا تُعرض. التشغيل المقاس بمفتاح: `npm run eval:live`، والخادم لا يرد إلا ببصمة تشغيل ناجح لنفس الكود والنماذج والتعليمات والبيانات (`server/evaluation.js`).
- `ai/tests/data/office-scenarios.json` و`ai/tests/office-scenarios.test.js`: أمثلة القسم 8 من قاعدة المعرفة وغيرها. التشغيل والفحص في `ai/tests/scenarios.js`. صيغة الخطوة: `{ "in": { "type", "text", "flags", "outOfHours"? }, "expect": { "includes": [ids], "excludes": [ids], "priority", "outcome", "phase", "status", "handoff" } }`، و`final` بالمفاتيح نفسها. `includes` تعني أن الرد ظهر في رسائل الخطوة؛ `id:2` يعني الصياغة الثانية.
