# تشغيل المساعد على الخادم

هذا الدليل لمن يجهّز الخادم ويشغّله. يفترض خادم Linux (Ubuntu 24.04 مثلًا) واسم نطاق للوحة يشير إليه، ويُستبدل `reception.example.sa` أينما ورد باسم المكتب الفعلي.

## 1. ما يلزم

- Node.js 24 (المشروع بلا حزم خارجية).
- nginx (الإصدار 1.24 في Ubuntu 24.04 يكفي) وشهادة TLS للاسم من Let's Encrypt (certbot).
- Docker لتشغيل Evolution API على الخادم نفسه.
- جدار ناري (ufw) ومزامنة وقت (NTP).
- رقم واتساب المكتب، ومفتاح Anthropic API، وعنوان يستقبل التنبيهات (اختياري لكنه موصى به)، وخدمة تفريغ صوت (اختيارية).

## 2. التثبيت

```sh
sudo useradd --system --home /opt/elmaster --shell /usr/sbin/nologin elmaster
sudo mkdir -p /opt/elmaster/backups && sudo chown -R elmaster:elmaster /opt/elmaster
# انسخ ملفات المشروع إلى /opt/elmaster، ثم:
cd /opt/elmaster && sudo -u elmaster cp .env.example .env.local && sudo chmod 600 .env.local
sudo -u elmaster npm test
sudo -u elmaster npm run setup     # حساب المسؤول الأول
```

القيم الحية في `.env.local`:

| المتغير | القيمة |
| --- | --- |
| `APP_MODE` | `live` |
| `HOST` و`PORT` | `127.0.0.1` و`3210`: الخادم لا يُفتح للخارج إلا عبر nginx. لا تضبط `HOST=0.0.0.0` |
| `PUBLIC_ORIGIN` | `https://reception.example.sa` (تُحذف الشرطة الأخيرة إن كُتبت) |
| `TRUST_PROXY` | `1`: يُقرأ عنوان المستخدم من nginx لحدود محاولات الدخول |
| `EVOLUTION_URL` و`EVOLUTION_INSTANCE` و`EVOLUTION_API_KEY` | من إعداد Evolution (الخطوة 5) |
| `EVOLUTION_TEXT_FORMAT` | `text` لـEvolution v2، و`textMessage` لـv1 |
| `WEBHOOK_SECRET` | سر عشوائي: `openssl rand -hex 32` |
| `MODEL_PROVIDER` | من يجيب عن النموذج: `anthropic` (الافتراضي) أو `openrouter` لنموذج من صانع آخر عبر OpenRouter. التقييم الحي الناجح يغطي المزوّد الذي أُجري به وحده |
| `ANTHROPIC_API_KEY` و`ANTHROPIC_MODEL` | المفتاح ومعرّف النموذج الذي نجح في التقييم الحي (الخطوة 6) |
| `OPENROUTER_API_KEY` و`OPENROUTER_MODEL` | مع `MODEL_PROVIDER=openrouter`: المفتاح ومعرّف النموذج عند OpenRouter (مثل `openai/gpt-6-luna`). `MODEL_SPLIT=on` يطلب الفهم في طلبين معًا، والافتراضي طلب واحد |
| `CONVERSATION` | `agent` (الافتراضي، قرار 18 نوفمبر 2026): النموذج يدير المحادثة بملف المكتب `ai/prompts/office.md` وكل رد يُفحص قبل إرساله. `flow`: فرز الكود المبني من القاعدة السابقة. النموذج يديرها عبر OpenRouter فقط |
| `AGENT_MODEL` و`AGENT_REASONING` و`AGENT_TIMEOUT_MS` و`AGENT_MAX_REPLIES` | اختيارية: نموذج آخر للمحادثة، ومقدار تفكيره قبل الرد (`low` افتراضيًا)، ومهلته (20 ثانية)، وحد ردوده في المحادثة الواحدة (40) |
| `MODEL_TIMEOUT_MS` | مهلة فهم الرسالة: 6000 افتراضيًا. بعدها يصل العميلَ الترحيب ويُحال للموظف |
| `PROMPT_CACHE_TTL` | `1h` افتراضيًا: تبقى تعليمات النموذج في ذاكرة المزود ساعة بين الرسائل، فيبقى الرد سريعًا والمكتب هادئ. `5m` للمدة القصيرة. وما دام المساعد يرد يجدد الخادم هذه الذاكرة قبل انتهائها (طلب صغير بلا بيانات عملاء، كل 50 دقيقة تقريبًا، أو كل 4 دقائق مع `5m`): الرسالة التي تجد التعليمات خارج الذاكرة تنتظر نحو 6 ثوانٍ بدل 2.5، أي أكثر من مهلة النموذج |
| `TRANSCRIBE_URL` و`TRANSCRIBE_API_KEY` و`TRANSCRIBE_MODEL` | اختيارية: تفريغ الرسائل الصوتية (الخطوة 5) |
| `ALERT_WEBHOOK_URL` | عنوان يستقبل التنبيهات (الخطوة 7) |
| `BACKUP_DIR` | اختياري: مجلد النسخ الاحتياطية، ويُفضّل على قرص آخر (الخطوة 8) |
| `RATES_URL` | اختياري: جدول أسعار الصرف اليومي للمبالغ بغير الريال (القاعدة 4.4). فارغًا يقرأ الخادم مرة في اليوم `https://open.er-api.com/v6/latest/USD` (ExchangeRate-API، دون مفتاح، ولا يحمل الطلب شيئًا عن العملاء)، ويحفظه في `.local/rates.json`. يحتاج الخادم اتصالًا خارجيًا بهذا العنوان. `off` يوقف القراءة: يبقى تحويل الدولار وعملات الخليج المربوطة به، ويُحال غيرها للفريق. شروط المصدر تطلب ذكره حيث تظهر الأسعار، وهو مذكور في لوحة الموظفين وفي سجل الإحالة |
| `EVAL_MODELS` و`HELD_OUT_SET` | للتقييم الحي: النموذج المقيَّم، ومسار المجموعة المحجوزة خارج المستودع (الخطوة 6) |
| `EVAL_RPM` | للتقييم الحي: أقصى عدد طلبات في الدقيقة. حساب OpenRouter الجديد يسمح بـ20 للنموذج، فضع 18 |

**وقت الخادم:** واتساب يؤرخ كل رسالة بساعته. إذا تأخرت ساعة الخادم بدت الرسائل آتية من المستقبل (يصل تنبيه `clock_skew`)، وإذا تقدمت عُدّت الرسائل الحديثة متأخرة فلا يرد عليها المساعد. فعّل المزامنة وتحقق منها:

```sh
sudo timedatectl set-ntp true
timedatectl status          # System clock synchronized: yes
```

**الجدار الناري:** لا يُفتح من الخادم للخارج إلا SSH وHTTP وHTTPS:

```sh
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable && sudo ufw status verbose
```

## 3. الخدمة الدائمة

```sh
sudo cp deploy/elmaster.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now elmaster
journalctl -u elmaster -f
```

تعيد الخدمة تشغيل الخادم بعد أي عطل خلال 5 ثوانٍ. عند التشغيل يكتب السجل هل يوجد تقييم حي يغطي النموذج والنصوص الحالية، وهل تفريغ الصوت مفعّل، وحالة اتصال الرقم. المحادثات التي انقطع الرد فيها بإعادة التشغيل تُحال للموظفين مع تنبيه، ولا يُعاد إرسال أي رسالة غير مؤكدة، والمرفق الذي انقطع تنزيله يصير طلبًا للموظف. جلسات الدخول محفوظة (بتجزئتها فقط، في `.local/sessions.json`)، فإعادة التشغيل لا تُخرج الموظفين.

## 4. TLS والوكيل العكسي

```sh
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/elmaster   # عدّل الاسم ومسارات الشهادة
sudo ln -s /etc/nginx/sites-available/elmaster /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/letsencrypt
```

**الشهادة أول مرة:** لا شهادة بعد، فعلّق كتلة `listen 443` مؤقتًا، ثم:

```sh
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d reception.example.sa --deploy-hook "systemctl reload nginx"
```

ثم أعد كتلة 443، و`sudo nginx -t && sudo systemctl reload nginx`.

**التجديد:** يجدد certbot الشهادة تلقائيًا (مؤقت `certbot.timer`: `systemctl list-timers | grep certbot`) عبر المسار `/.well-known/acme-challenge/` على المنفذ 80، ولذلك لا يُحوَّل هذا المسار إلى HTTPS في الإعداد. `--deploy-hook` يعيد تحميل nginx بعد كل تجديد. جرّبه: `sudo certbot renew --dry-run`.

الإعداد يمنع الوصول إلى `/webhooks/` من الخارج: Evolution يتصل بالخادم مباشرة على الجهاز نفسه.

## 5. Evolution API وواتساب

1. شغّل Evolution API بإصدار محدد (لا `latest`)، وهو الإصدار الذي جُرّب على الرقم التجريبي (المهمة T026)، **بشبكة المضيف** (انظر «Evolution في Docker» أدناه).
2. أنشئ instance واربط رقم المكتب بمسح الرمز.
3. اضبط الـwebhook على الخادم المحلي، مع ترويسة السر، وهذه الأحداث. مثال لـEvolution v2، ويُطابَق مع توثيق الإصدار المثبت:

```sh
curl -X POST "$EVOLUTION_URL/webhook/set/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' -d '{
  "webhook": { "enabled": true, "url": "http://127.0.0.1:3210/webhooks/evolution",
    "headers": { "Authorization": "Bearer <WEBHOOK_SECRET>" }, "byEvents": false, "base64": false,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "MESSAGES_EDITED", "SEND_MESSAGE", "CONNECTION_UPDATE"] } }'
```

`MESSAGES_UPDATE` يحمل حالة التسليم (وصلت، قُرئت، فشلت) وحذف العميل لرسالته، و`MESSAGES_DELETE` الحذف في الإصدارات التي ترسله حدثًا مستقلًا، و`MESSAGES_EDITED` تعديل العميل لرسالة (يقرؤه المساعد رسالةً جديدة ويُعلَّم في اللوحة). إذا لم يقبل الإصدار المثبت `MESSAGES_EDITED` فاحذفه: يقرأ الخادم التعديل أيضًا إذا وصل ضمن `MESSAGES_UPSERT`. الخادم يقرأ شكلي v1 وv2 لهذه الأحداث.

4. تحقق: `npm run check:evolution` يطبع حالة الاتصال. والخادم نفسه يسأل Evolution عن الاتصال عند التشغيل وكل 3 دقائق: إذا تعذر الوصول إليه صارت الحالة «تعذر التحقق»، فلا يرد المساعد وتُحال الرسائل للموظفين، ويصل تنبيه `disconnected` إذا دام الانقطاع أكثر من دقيقة.
5. في تطبيق واتساب للأعمال على هاتف المكتب: أوقف رسالة الترحيب ورسالة الغياب. إن بقيت، يسجلها الخادم ردًا تلقائيًا (لا استلامًا من موظف) وينبّه المسؤول.

### Evolution في Docker

الخادم يستمع على `127.0.0.1:3210` فقط. حاوية بشبكة Docker الافتراضية (bridge) لا ترى `127.0.0.1` المضيف، و`host.docker.internal` يشير إلى عنوان جسر Docker لا إلى `127.0.0.1`، فلا تصل الرسائل إلى الخادم. **الطريقة الموصى بها: شبكة المضيف.**

```yaml
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7   # إصدار محدد، لا latest (المجرَّب في 16 نوفمبر 2026)
    network_mode: host
    env_file: evolution.env
    restart: unless-stopped
    volumes:
      - evolution_instances:/evolution/instances
volumes:
  evolution_instances:
```

(ومعه قاعدة بياناته كما في توثيق الإصدار المثبت.) بهذا يصل Evolution إلى `http://127.0.0.1:3210/webhooks/evolution`، ويصل الخادم إلى Evolution على `http://127.0.0.1:8080` (`EVOLUTION_URL`). لكن منفذ Evolution (8080) يصبح مفتوحًا على كل واجهات الجهاز، وواجهته تتحكم في رقم واتساب: الجدار الناري (الخطوة 2) يمنعه من الخارج، فلا تفتح غير 22 و80 و443، وتحقق من الخارج أن `http://<عنوان الخادم>:8080` لا يجيب.

**البديل (شبكة bridge):** انشر منفذ Evolution على الجهاز نفسه فقط: `127.0.0.1:8080:8080`، لا `8080:8080` (ما ينشره Docker يتجاوز ufw). واجعل الخادم يستمع على عنوان جسر Docker بدل `127.0.0.1`: `HOST=172.17.0.1`، أو بوابة شبكتك (`docker network inspect <الشبكة> -f '{{(index .IPAM.Config 0).Gateway}}'`)، واضبط الـwebhook على `http://172.17.0.1:3210/webhooks/evolution`، و`proxy_pass` في nginx على العنوان نفسه، وأضف للخدمة `After=docker.service` (`sudo systemctl edit elmaster`) لأن العنوان لا يوجد قبل Docker. هذا العنوان لا يُوصل إليه من خارج الجهاز، والجدار الناري يمنع الباقي.

### تجربة على رقم تجريبي (جهاز واحد)

ليجرّب موظفو المكتب المساعد قبل أن يجتاز نموذج التقييم الحي: شريحة تجريبية غير رقم المكتب، على جهاز واحد، بلا نطاق ولا TLS. ملفاتها في `deploy/trial/`.

```sh
node scripts/trial-setup.js --number 9665XXXXXXXX   # رقم الشريحة التجريبية بمفتاح الدولة، أرقام فقط
docker compose -f deploy/trial/docker-compose.yml up -d
npm run setup && npm start                            # الخادم على 127.0.0.1:3210
node scripts/trial-link.js                             # في نافذة أخرى: رمز QR في deploy/trial/qr.png، ورمز اقتران يُكتب في الهاتف
```

- `trial-setup.js` يكتب `deploy/trial/evolution.env` (إعدادات Evolution وقاعدة بياناته، بمفتاح وكلمة مرور يولّدهما ولا يطبعهما) ويضع في `.env.local` عنوان Evolution واسم الـinstance والمفتاح نفسه وسر الـwebhook وصيغة v2 والوضع الحي. تشغيله ثانية لا يغيّر مفتاحًا موجودًا.
- Evolution منشور على `127.0.0.1:8080` فقط، وقاعدة بياناته بلا منفذ. في Docker Desktop يصل إلى الخادم عبر `http://host.docker.internal:3210/webhooks/evolution` (جُرّب). `CORS_ORIGIN=*` لازم: بغيره يرفض Evolution كل طلب بلا ترويسة Origin، وطلبات الخادم بلا ترويسة.
- `trial-link.js` ينشئ الـinstance (محادثات فردية فقط، بلا استيراد تاريخ)، ويضبط الـwebhook بسر الخادم، ثم ينتظر الربط: من الهاتف التجريبي، واتساب ← الأجهزة المرتبطة ← ربط جهاز، ثم مسح الرمز أو كتابة رمز الاقتران. `node scripts/trial-link.js --status` يطبع الحالة.
- **`TRIAL_NUMBER`:** ما دام الرقم المربوط هو هذا الرقم، يرد المساعد دون تقييم حي ناجح، وتقول اللوحة «المساعد يرد (تجربة)». إذا رُبط أي رقم آخر، أو تعذّر على الخادم معرفة الرقم المربوط، عاد شرط التقييم كما هو. باقي المتطلبات كلها قائمة: اعتماد بيانات المكتب والنصوص، ومراجعة الأرقام المستثناة، وزر التشغيل (الخطوة 6).
- الإيقاف: `docker compose -f deploy/trial/docker-compose.yml down` (تبقى البيانات في وحدتي التخزين؛ `down -v` يحذفها)، وإلغاء الربط من الهاتف (الأجهزة المرتبطة).

### تفريغ الرسائل الصوتية (اختياري)

بلا خدمة تفريغ يرد المساعد على الرسالة الصوتية بطلب ملخص مكتوب في سطرين، وإذا تكرر التعذر أحال العميل للموظف (قاعدة المعرفة 1.9)، ويبقى التسجيل مسموعًا في اللوحة. لتفريغها نصًا يقرؤه المساعد كالرسالة المكتوبة: خدمة متوافقة مع OpenAI لنقطة `/audio/transcriptions` (OpenAI أو Groq أو خادم Whisper محلي):

| المتغير | القيمة |
| --- | --- |
| `TRANSCRIBE_URL` | مثل `https://api.openai.com/v1` (يُضاف `/audio/transcriptions` إن لم يكن في العنوان) |
| `TRANSCRIBE_API_KEY` | مفتاح الخدمة. يُترك فارغًا مع `TRANSCRIBE_URL=https://openrouter.ai/api/v1`: يُستعمل مفتاح OpenRouter نفسه (`OPENROUTER_API_KEY`)، ولا يُرسل لعنوان غيره |
| `TRANSCRIBE_MODEL` | معرّف النموذج، مثل `gpt-4o-mini-transcribe` أو `whisper-1`؛ وعلى OpenRouter `openai/whisper-large-v3` (جُرّب يوم 17 نوفمبر 2026 على رسالتين بلهجة سعودية: 3 إلى 5 ثوانٍ، ونحو 0.0000075 دولار للثانية) |
| `TRANSCRIBE_LANGUAGE` | اختياري: `ar` إذا كانت كل الرسائل بالعربية |
| `TRANSCRIBE_PROMPT` | اختياري: `on` يرسل تعليمات التفريغ (`ai/prompts/transcribe.md`) للنماذج التي تتبع التعليمات؛ اتركه فارغًا مع Whisper |
| `TRANSCRIBE_TIMEOUT_MS` | 15000 افتراضيًا |

تعذر الفهم (لا شيء واضح في التسجيل) أو فشل الخدمة يعامَل كرسالة صوتية غير واضحة: يُطلب من العميل ملخص مكتوب. فشل الخدمة يُسجَّل برمزه، ويصل تنبيه `transcription_failed` مرة في الساعة على الأكثر. جرّب التفريغ على الرقم التجريبي قبل التشغيل.

## 6. قبل أن يرد المساعد

1. **التقييم الحي:** ضع في `.env.local` `EVAL_MODELS` بمعرّف النموذج (ومعه `PHRASING_MODEL` إن اختلف نموذج الصياغة)، ثم `npm run eval:live`. يُشترط أن يجتاز كل الحدود، وأن يصل 95% من الردود في وقتها المقدّر. لقياس الثبات: `npm run eval:live -- --repeat 3`. الخادم لا يرد بلا تقييم ناجح لنفس النموذج والتعليمات والنصوص والكود، وقوائم الخدمات كما في إعدادات اللوحة؛ فتعديل الخدمات من اللوحة يستلزم تقييمًا جديدًا.
   - **المجموعة المحجوزة:** `HELD_OUT_SET=/المسار/held-out.json` في `.env.local`: ملف **خارج مجلد المشروع** فيه رسائل حقيقية من المكتب بتوقعاتها، يجمعها ويكتب توقعاتها من لا يعدّل تعليمات النموذج (طريقة إعدادها في `ai/README.md`، «المجموعة المحجوزة»). احفظه بصلاحيات بيانات العملاء (`chmod 600`، مالكه `elmaster`) ولا تنسخه إلى المستودع: يُرفض إن كان داخله. إذا ضُبط قيّمه `npm run eval:live` مع كل تشغيل بالحدود نفسها، ويسقط التشغيل إذا لم يحققها، ولا يُطبع منه ولا يُحفظ إلا الأعداد: لا رسالة ولا مخرج ولا رقم رسالة فشلت.
2. **اللوحة → الإعدادات:** اعتماد بيانات المكتب ومواعيد العمل، ومراجعة الأرقام المستثناة (تُكتب بأي صيغة: +966 أو 05)، واعتماد النصوص بنسختها الحالية. ثم **حالة الخدمة → إرسال تنبيه تجريبي** للتأكد أن قناة التنبيهات تستقبل.
3. **التشغيل:** زر «تشغيل المساعد». تبيّن اللوحة أي متطلب ناقص.

أي تعديل على النصوص أو الأسعار أو التعليمات أو النموذج يُسقط الاعتماد ويستلزم تقييمًا حيًا جديدًا. حتى ذلك الحين لا يرد المساعد، وتُحال رسائل العملاء للموظفين مع تنبيه.

**وحين لا يرد المساعد** (متوقف، أو موقوف في المحادثة، أو الرقم مستثنى لعميل حالي، أو ينقصه متطلب): كل رسالة عميل في محادثة لم يستلمها موظف تصير طلبًا في قائمة «بانتظار المتابعة» مع تنبيه، ولا تبقى رسالة دون أن يراها أحد. والرسائل الجديدة في محادثة استلمها موظف تُعد غير مقروءة لكل موظف على حدة، ويصل إشعارها إلى الموظف المستلم. أول تشغيل للمساعد يحدد ما قبله من تاريخ واتساب فلا يُستورد؛ وإيقافه ثم تشغيله لا يغيّر ذلك، فلا تضيع رسالة وصلت وقت الإيقاف أو تأخرت بانقطاع.

## 7. المراقبة والتنبيهات

- **فحص من الخارج:** راقب `https://reception.example.sa/health` كل دقيقة (UptimeRobot أو Better Stack مثلًا). يعيد **503** في ثلاث حالات، ومعها رمز السبب: تعذر حفظ البيانات (`storage`)، أو المساعد مفعّل لا يرد (`not_answering` مع ما ينقصه، ومنه اتصال الرقم)، أو رفض الخادم طلبات Evolution في آخر نصف ساعة ولم يقبل بعدها شيئًا (`webhook_rejected`: سر الـwebhook أو اسم الـinstance لا يطابق، فرسائل العملاء لا تصل). ويعيد **200** مع `warnings` لما يجب إصلاحه قبل أن يضر: لا قناة تنبيهات (`alert_channel_missing`)، القناة ترفض التنبيهات (`alert_channel_failing`)، الرقم غير متصل والمساعد متوقف (`not_connected`)، لا نسخة احتياطية (`backup_missing`) أو آخرها أقدم من 26 ساعة (`backup_old`)، أو طلبات webhook مرفوضة خلال اليوم، أو جدول أسعار الصرف أقدم من 3 أيام (`rates_stale`: المبالغ بعملة غير مربوطة بالدولار تُحال للفريق حتى يعود). ومعه وقت آخر طلب قبله الخادم من Evolution وعدد المرفوض وعمر آخر نسخة وتاريخ جدول الأسعار. لا بيانات عملاء فيه. عدم الرد أصلًا يعني توقف الخادم. اجعل خدمة المراقبة تنبّه على 503، وعلى `warnings` غير فارغة إن أمكنها.
- **تنبيهات الخادم:** يرسل الخادم إلى `ALERT_WEBHOOK_URL` طلب JSON فيه `text` (جملة عربية قصيرة تصف التنبيه، بلا بيانات عملاء)، ومعه `kind` و`conversation` (معرّف المحادثة فقط) و`at`. تقبله Slack (Incoming Webhook) وTeams (Workflows) مباشرة، ولغيرهما خدمة وسيطة. يتحقق الخادم من رد القناة: الرفض أو تعذر الوصول يُسجَّل في السجل، ويظهر في `/health` وفي **الإعدادات ← حالة الخدمة**، ومنها يُرسل تنبيه تجريبي. أنواعها:

| النوع | المعنى |
| --- | --- |
| `disconnected` / `reconnected` | انقطع اتصال الرقم أكثر من دقيقة (بإشعار Evolution أو بفحص الخادم كل 3 دقائق) / عاد |
| `webhook_rejected` | رفض الخادم طلبات من Evolution: سر الـwebhook أو اسم الـinstance لا يطابق (مرة في الساعة على الأكثر) |
| `assistant_stopped` / `assistant_resumed` | توقف المساعد عن الرد لنقص متطلب / عاد |
| `assistant_unavailable`، `assistant_off`، `paused`، `existing_client` | رسالة عميل لم يرد عليها المساعد (غير جاهز، متوقف، موقوف في المحادثة، رقم مستثنى) فصارت طلبًا |
| `request`، `request_urgent`، `reminder`، `escalation` | طلب جديد، أو طلب عاجل (جديد أو صار عاجلًا)، ولم يُستلم، وتأخر استلامه كثيرًا |
| `unresolved_sender` | رسالة من مرسل لم يُعرف رقمه: يُرد عليه من هاتف المكتب |
| `unmatched_phone_reply` | رد من هاتف المكتب لم يُطابَق بمحادثة: إن كان المساعد يرد على هذا العميل فأوقفه في محادثته |
| `flood` | رسائل كثيرة متتابعة من رقم واحد: أُوقف المساعد في محادثته حتى يراجعها موظف |
| `send_unknown`، `delivery_failed` | نتيجة إرسال غير مؤكدة / رسالة لم تصل إلى العميل |
| `processing_failed` | توقف الرد الآلي في محادثة |
| `media_failed`، `transcription_failed` | تعذر تنزيل مرفق / تعذر تفريغ رسالة صوتية |
| `model_failed`، `model_down` | تعذر الفهم الآلي لرسالة، أو تعطل متكرر في خدمة النموذج |
| `storage_failed` / `storage_recovered`، `state_restored`، `conversation_damaged` | تعذر الحفظ على القرص / عاد، أو حُمّلت النسخة الاحتياطية المحلية، أو ملف محادثة تالف نُقل جانبًا |
| `interrupted` | محادثة انقطع الرد فيها بإعادة التشغيل |
| `phone_auto_reply` | رد تطبيق واتساب تلقائيًا: أوقف الرد التلقائي فيه |
| `clock_skew` | ساعة الخادم متأخرة عن واتساب: راجع مزامنة الوقت (الخطوة 2) |
| `backup_failed` | فشل النسخ الاحتياطي الليلي |
| `retention`، `internal_error` | حُذفت محادثات منتهية بمدة الاحتفاظ / خطأ داخلي في الخادم |

- **السجل:** `journalctl -u elmaster`. أعطال النموذج والتفريغ والطلبات المرفوضة تُسجل برمزها فقط، بلا نص عميل.
- **زمن الرد:** في **الإعدادات ← حالة الخدمة** الوسيط وحد الـ95% لزمن آخر 200 رد آلي، مقابل الهدف (الأول خلال 10 ثوانٍ وما بعده خلال 15)، وما آلت إليه صياغة الردود بالنموذج.

## 8. النسخ الاحتياطي والاسترجاع

- **ما يُحفظ:** مجلد البيانات `.local/` فيه `state.json` (الإعدادات والتنبيهات والحالة العامة)، وملف لكل محادثة في `conversations/`، و`audit.log`، و`users.json`، و`sessions.json`، والمرفقات في `media/`. يُكتب كل ملف كاملًا إلى ملف مؤقت ثم يُثبَّت على القرص (fsync) ثم يحل محل السابق، فلا يبقى نصف ملف بعد انقطاع الكهرباء، ولا يُكتب إلا ما تغيّر. عند أول تشغيل بعد التحديث تنتقل المحادثات من `state.json` إلى `conversations/` تلقائيًا؛ خذ نسخة احتياطية قبل التحديث.
- **يوميًا:**
  ```sh
  sudo cp deploy/elmaster-backup.service deploy/elmaster-backup-failed.service deploy/elmaster-backup.timer /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now elmaster-backup.timer
  ```
  كل نسخة مجلد في `backups/` (أو `BACKUP_DIR`) فيه البيانات وملف `manifest.json` ببصمة كل ملف، وتُحفظ آخر 30 نسخة. الملف الذي لم يتغير منذ النسخة السابقة (المرفقات غالبًا) رابط صلب (hard link) إلى نسخته هناك بعد التحقق من بصمتها، فلا يتكرر على القرص كل ليلة. جلسات الدخول لا تُنسخ. إذا فشل النسخ (أو تجاوز 3 ساعات) شغّل systemd الخدمة `elmaster-backup-failed` فوصل تنبيه `backup_failed`، وعمر آخر نسخة يظهر في `/health` (تحذير بعد 26 ساعة). انسخ مجلد النسخ إلى مكان خارج الخادم بأداة تشفّر (restic أو rclone crypt مثلًا)، فالنسخ فيها بيانات العملاء.
- **مجلد نسخ آخر (`BACKUP_DIR`):** الخدمات لا تكتب إلا في مجلداتها. إذا كان `BACKUP_DIR` غير `/opt/elmaster/backups` فأعطِ خدمة النسخ إذن الكتابة فيه:
  ```sh
  sudo mkdir -p /srv/elmaster-backups && sudo chown elmaster:elmaster /srv/elmaster-backups && sudo chmod 700 /srv/elmaster-backups
  sudo systemctl edit elmaster-backup      # ويُكتب فيه:
  #   [Service]
  #   ReadWritePaths=/srv/elmaster-backups
  sudo systemctl start elmaster-backup && journalctl -u elmaster-backup -n 5    # تجربة
  ```
  لا تضعه تحت `/home`: الخدمات لا تراه (`ProtectHome`)، ولا يقرأ الخادم عمر آخر نسخة.
- **حماية تلقائية:** يحتفظ الخادم كل 10 دقائق بنسخة `state.json.bak` من الملف العام. إذا تلف عند التشغيل تُحمّل هذه النسخة ويصل تنبيه `state_restored`. ملف محادثة تالف عند التشغيل يُنقل جانبًا (`conversations/<المعرّف>.json.damaged`) ويعمل الخادم، ويصل تنبيه `conversation_damaged`: استرجعه من النسخة الاحتياطية.
- **الاسترجاع:**
  ```sh
  sudo systemctl stop elmaster
  sudo -u elmaster npm run restore -- backups/<الوقت>
  sudo systemctl start elmaster
  ```
  يتحقق من بصمات النسخة قبل أي تغيير، ويرفض العمل والخادم يعمل. البيانات الحالية لا تُحذف: تُنقل إلى `.local.before-restore-<الوقت>`. الملفات المسترجعة نسخ مستقلة، لا روابط إلى النسخ الاحتياطية.
- **جرّب الاسترجاع مرة كل شهر** على جهاز آخر.

## 9. التحديث

1. خذ نسخة احتياطية (`sudo systemctl start elmaster-backup`)، وانسخ الإصدار الجديد، ثم `npm test`.
2. `sudo systemctl restart elmaster`.
3. إذا تغيرت النصوص أو التعليمات أو الأسعار: تقييم حي جديد (الخطوة 6)، ثم اعتماد النصوص من اللوحة.

## 10. الاحتفاظ بالبيانات

من الإعدادات: «مدة الاحتفاظ بالمحادثات المنتهية بالأيام». إذا تُركت فارغة لا يُحذف شيء. إذا حُددت (30 يومًا على الأقل)، تُحذف المحادثات المنتهية الأقدم منها مع مرفقاتها، مرة في الساعة، ولا تُحذف محادثة فيها طلب مفتوح. يُسجَّل الحذف في سجل التدقيق ويصل تنبيه به.
