'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { equal, clientIp } = require('./auth');
const { normalizeEvent } = require('./evolution');
const { qaData } = require('./qa');
const { needsStaff, isUrgent, formatHours } = require('./engine');
const { inspectAudio } = require('./audio');
const { phoneJid } = require('./phone');
const { alertText } = require('./alerts');
const { originOf } = require('./config');
const { healthReport, lastBackup } = require('./health');
const VIEW_AUDIT_MS = 30 * 60000;
// The newest conversations the page lists, besides every one a person must see.
const LIST_LIMIT = 300;

const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
// A file from disk. A missing or unreadable file is a 404: a stream error never ends the process.
function sendFile(res, file) {
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (res.headersSent) return res.destroy?.();
    res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'الملف غير متاح.' }));
  });
  res.on?.('error', () => stream.destroy());
  return stream.pipe(res);
}
async function body(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('حجم الطلب أكبر من المسموح.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function createApp({ store, config, engine, auth }) {
  // The review material is read when it is first asked for: a server deployed without the spec
  // or the tests starts, and only the review pages lack it (server/qa.js).
  let qa = null; const material = () => (qa ||= qaData());
  const viewed = new Map(); // session + conversation -> when the opening was last recorded
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // The public address as browsers send it in the Origin header (server/config.js).
      const origin = originOf(config.origin);
      const url = new URL(req.url, origin); const route = url.pathname;
      // For an outside monitor (deploy/README.md): 200 while the service works, with warnings;
      // 503 when clients are not served (server/health.js). Codes only, never client data.
      if (route === '/health') {
        const report = healthReport({ store, engine, config });
        return json(res, report.status, report.body);
      }
      // The page and its API answer only at the public address (against DNS rebinding). The
      // webhook is called by Evolution on the internal address, and is checked by its secret.
      const internal = route === '/webhooks/evolution';
      if (!internal && req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'عنوان وصول غير معتمد.' });
      if (route === '/webhooks/evolution' && req.method === 'POST') {
        if (config.mode !== 'live') return json(res, 401, { error: 'unauthorized' });
        // A refused webhook is counted, logged and alerted (engine.webhookRefused), never silent.
        if (!config.webhookSecret || !equal(req.headers.authorization, `Bearer ${config.webhookSecret}`)) { engine.webhookRefused('secret'); return json(res, 401, { error: 'unauthorized' }); }
        const payload = await body(req);
        if (payload.instance !== config.instance) { engine.webhookRefused('instance'); return json(res, 400, { error: 'unexpected_instance' }); }
        engine.webhookAccepted();
        for (const event of normalizeEvent(payload)) engine.incoming(event);
        return json(res, 200, { accepted: true });
      }
      if (route.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return json(res, 403, { error: 'مصدر الطلب غير معتمد.' });
      if (route === '/api/login' && req.method === 'POST') {
        const input = await body(req); const session = await auth.login(input.username, input.password, clientIp(req, config));
        res.setHeader('Set-Cookie', `session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { user: session.user, csrf: session.csrf });
      }
      if (route.startsWith('/api/')) {
        const session = auth.get(req); if (!session) return json(res, 401, { error: 'سجّل الدخول أولًا.' });
        const user = session.user;
        if (!['GET', 'HEAD'].includes(req.method) && !equal(req.headers['x-csrf-token'], session.csrf)) return json(res, 403, { error: 'رمز الجلسة غير صالح.' });
        const admin = () => { if (user.role !== 'admin') { const e = new Error('هذه العملية للمسؤول فقط.'); e.status = 403; throw e; } };
        if (route === '/api/session') return json(res, 200, { user, csrf: session.csrf });
        if (route === '/api/logout' && req.method === 'POST') { auth.logout(session.token); res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
        if (route === '/api/state' && req.method === 'GET') {
          // needsStaff and urgent are decided here once, for the list, the counters and the
          // notifications alike. The list carries what a row shows, for the newest conversations
          // and every one a person must see whatever its age; ?q= searches all of them, in the
          // name, the number and every message the client wrote.
          const all = Object.values(store.data.conversations).sort((a, b) => b.updatedAt - a.updatedAt);
          const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
          const said = c => c.messages.some(m => m.role === 'client' && `${m.text || ''} ${m.transcript || ''}`.toLowerCase().includes(q));
          const matching = q ? all.filter(c => `${c.name} ${c.jid}`.toLowerCase().includes(q) || said(c)) : all;
          // Unread is this employee's own count (engine.unread): another person reading the
          // conversation never clears it.
          const unread = c => engine.unread(c, user.username);
          const active = c => needsStaff(c) || c.state.status === 'with_staff' || unread(c) > 0;
          const conversations = matching.filter((c, i) => i < LIST_LIMIT || active(c)).map(c => ({
            id: c.id, name: c.name, jid: c.jid, demo: c.demo, updatedAt: c.updatedAt, paused: c.paused, assigned: c.assigned, unread: unread(c),
            mine: Boolean(c.assignedTo) && c.assignedTo === user.username, owned: Boolean(c.assignedTo),
            state: { status: c.state.status, outcome: c.state.outcome, priority: c.state.priority },
            lastMessage: c.messages.at(-1)?.text || '', count: c.messages.length, needsStaff: needsStaff(c), urgent: isUrgent(c), overdue: needsStaff(c) && (c.reminders || 0) > 0 }));
          const counts = { all: all.length, waiting: all.filter(needsStaff).length, staff: all.filter(c => c.state.status === 'with_staff').length, urgent: all.filter(isUrgent).length, listed: conversations.length };
          return json(res, 200, { mode: config.mode, enabled: store.data.settings.enabled, status: engine.status(), connection: store.data.connection,
            conversations, counts, readiness: engine.ready(), reviewCount: store.data.reviews.length, recordingCount: new Set(store.data.recordings.map(r => r.sampleId)).size,
            alerts: user.role === 'admin' ? (store.data.alerts || []).slice(-20).reverse().map(a => ({ ...a, text: alertText(a.kind) })) : [],
            scenarios: engine.demoScenarios().map(c => ({ id: c.id, title: c.title })) });
        }
        const media = /^\/api\/media\/([a-f0-9-]+)\/([\w.-]{1,128})$/.exec(route);
        if (media && req.method === 'GET') {
          const m = engine.conversation(media[1]).messages.find(x => x.id === media[2]);
          if (!m?.media || m.media.status !== 'stored' || !/^[a-f0-9-]+\.[a-z0-9]+$/.test(m.media.file)) return json(res, 404, { error: 'المرفق غير متاح.' });
          store.audit(user.username, 'media_opened', media[1], { save: false });
          const name = encodeURIComponent((m.media.fileName || m.media.file).replace(/[\r\n"\\/]/g, '_'));
          res.setHeader('Content-Type', m.media.contentType);
          // Only images and audio open in the page; any other file is a download.
          res.setHeader('Content-Disposition', `${m.media.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`);
          return sendFile(res, path.join(store.dir, 'media', m.media.file));
        }
        const conv = /^\/api\/conversations\/([a-f0-9-]+)(?:\/(\w+))?$/.exec(route);
        if (conv) {
          const c = engine.conversation(conv[1]);
          if (req.method === 'GET' && !conv[2]) {
            // The page reads the open conversation every few seconds: one "view" entry is
            // recorded per opening, not per read, and reading never rewrites the state.
            const key = `${session.token}:${c.id}`;
            if (Date.now() - (viewed.get(key) || 0) > VIEW_AUDIT_MS) { viewed.set(key, Date.now()); store.audit(user.username, 'view', c.id, { save: false }); }
            if (viewed.size > 5000) viewed.clear();
            // Opened: its new messages are read, by this employee only. Kept in memory; the next
            // write saves it.
            engine.markRead(c, user.username);
            return json(res, 200, c);
          }
          // Deleted for good, by the admin only (engine.forget).
          if (req.method === 'DELETE' && !conv[2]) { admin(); viewed.delete(`${session.token}:${c.id}`); return json(res, 200, engine.forget(c.id, user.username)); }
          if (req.method === 'POST') {
            const input = await body(req);
            const out = conv[2] === 'reply' ? await engine.staffReply(c.id, input.text, user.name, user.username, user.username) : engine.action(c.id, conv[2], user, input);
            return json(res, 200, out);
          }
        }
        if (route === '/api/demo' && req.method === 'POST') { const input = await body(req); return json(res, 200, await engine.demo(input.scenario)); }
        if (route === '/api/settings' && req.method === 'GET') {
          admin();
          // Beside the settings: how fast the replies went out lately and what became of the
          // model's writing (engine.phrase), the alert channel, the webhooks, the connection
          // and the last backup, for the admin to see the service is sound.
          return json(res, 200, { ...store.data.settings, readiness: engine.ready(), status: engine.status(), repliesStatus: engine.replies.status,
            users: auth.users.map(({ username, name, role, disabled }) => ({ username, name, role, disabled: disabled === true })),
            metrics: { latency: engine.latency(), phrasing: store.data.phrasingStats || null },
            alertChannel: { configured: Boolean(config.alertWebhook), ...(store.data.alertChannel || {}) },
            webhook: store.data.webhook || null, connection: store.data.connection, backup: { lastAt: lastBackup(config.backupDir) } });
        }
        if (route === '/api/settings' && req.method === 'PUT') {
          admin(); const input = await body(req); const next = structuredClone(store.data.settings);
          if (input.profile) {
            // The working hours are set as days and times, and their text is made from them, so
            // that what clients read is what the assistant and the reminders count.
            if (['working_hours', 'working_hours_en'].some(key => Object.hasOwn(input.profile, key))) throw new Error('أوقات العمل تُعدَّل من أيام العمل وساعاته، لا من نصها.');
            if (input.profile.office_hours) {
              const h = input.profile.office_hours; const time = /^([01]\d|2[0-3]):[0-5]\d$/;
              if (!Array.isArray(h.days) || !h.days.length || h.days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || !time.test(h.open) || !time.test(h.close) || h.open >= h.close) throw new Error('أيام العمل وساعاته غير صالحة.');
              next.profile.office_hours = { days: [...new Set(h.days)].sort((a, b) => a - b), open: h.open, close: h.close, utc_offset_minutes: next.profile.office_hours?.utc_offset_minutes ?? 180 };
              next.profile.working_hours = formatHours(next.profile.office_hours, 'arabic');
              next.profile.working_hours_en = formatHours(next.profile.office_hours, 'english');
            }
            for (const base of ['office_name','address','price_info','contact_info']) for (const key of [base, `${base}_en`]) {
              if (Object.hasOwn(input.profile,key)) { const value = input.profile[key]; if (value !== null && (typeof value !== 'string' || value.length > 1500)) throw new Error('بيانات المكتب غير صالحة.'); next.profile[key] = value?.trim() || null; }
            }
            // How long ended conversations are kept (engine.retention): null keeps them all.
            if (Object.hasOwn(input.profile, 'retention_days')) {
              const days = input.profile.retention_days;
              if (days !== null && !(Number.isInteger(days) && days >= 30 && days <= 3650)) throw new Error('مدة الاحتفاظ من 30 إلى 3650 يومًا، أو فارغة.');
              next.profile.limits = { ...(next.profile.limits || {}), retention_days: days };
            }
            for (const key of ['services', 'services_en']) if (input.profile[key]) { if (!Array.isArray(input.profile[key]) || input.profile[key].length > 40 || input.profile[key].some(s => typeof s !== 'string' || s.length > 150)) throw new Error('قائمة الخدمات غير صالحة.'); next.profile[key] = input.profile[key].map(s => s.trim()).filter(Boolean); }
            // The English names say the Arabic ones in the same order, or are left empty.
            if (next.profile.services_en?.length && next.profile.services_en.length !== next.profile.services.length) throw new Error('عدد الخدمات بالإنجليزية لازم يساوي عددها بالعربية وبالترتيب نفسه، أو اتركها فارغة.');
            next.officeApproved = false;
          }
          if (input.excluded) {
            // Numbers as the office writes them (+966، 00966، 05، 5) become one form, so that
            // an existing client is matched however the number was typed.
            if (!Array.isArray(input.excluded) || input.excluded.length > 5000) throw new Error('الأرقام المستثناة غير صالحة.');
            const bad = input.excluded.filter(j => !phoneJid(j));
            if (bad.length) throw new Error(`أرقام مستثناة غير صالحة: ${bad.slice(0, 3).map(x => String(x).slice(0, 20)).join('، ')}`);
            next.excluded = [...new Set(input.excluded.map(phoneJid))];
          }
          for (const key of ['officeApproved','existingClientsReviewed']) if (typeof input[key] === 'boolean') next[key] = input[key];
          if (next.officeApproved && !next.profile.office_name) throw new Error('أدخل اسم المكتب الفعلي قبل اعتماد البيانات.');
          // The office approves the reply texts and the qualification rules as they are now:
          // the approval is tied to their fingerprint and lapses when either file changes.
          if (typeof input.approveReplies === 'boolean') next.repliesApproval = input.approveReplies ? { hash: engine.contentHash(), by: user.username, at: Date.now() } : null;
          const repliesApproved = next.repliesApproval?.hash === engine.contentHash();
          if (typeof input.enabled === 'boolean') {
            if (input.enabled && config.mode !== 'live') throw new Error('تشغيل واتساب الفعلي متاح في الوضع الحي بعد الإعداد.');
            if (input.enabled && !repliesApproved) throw new Error('اعتمد نصوص الردود الحالية أولًا؛ لا يُفعَّل المساعد بنصوص غير معتمدة.');
            // A trial on the test number (TRIAL_NUMBER) is switched on without an evaluation: only
            // while that number is the one linked (engine.trial).
            if (input.enabled && !engine.ready().evaluated && !engine.trial()) throw new Error('لا يوجد تقييم حي ناجح للنموذج والنصوص الحالية؛ شغّل npm run eval:live أولًا.');
            // What is still missing is named, so that the admin knows which box or setting it is.
            const lacking = [[next.profile.office_name, 'اسم المكتب'], [next.officeApproved, 'مربع «راجع المكتب هذه البيانات واعتمد استخدامها»'],
              [next.existingClientsReviewed, 'مربع «راجعنا قائمة العملاء الحاليين والأرقام المستثناة»'],
              [config.modelKey && config.model, 'مفتاح خدمة فهم الرسائل ومعرّف النموذج'], [config.evolutionKey && config.evolutionUrl && config.instance, 'إعدادات ربط واتساب'],
              [config.webhookSecret, 'سر استقبال الرسائل'], [store.data.connection.state === 'open', 'اتصال الرقم بواتساب']].filter(([ok]) => !ok).map(([, name]) => name);
            if (input.enabled && lacking.length) throw new Error(`أكمل متطلبات الربط واعتماد المكتب وقائمة العملاء الحاليين أولًا. الناقص: ${lacking.join('، ')}.`);
            // History from before the assistant's first switch-on is not imported (engine.incoming).
            // That line is drawn once: switching the assistant off and on again never moves it, so
            // a message sent just before a switch, or held back by a disconnection, is kept.
            if (store.data.settings.enabled === true && !next.firstActivatedAt) next.firstActivatedAt = next.activatedAt;
            if (input.enabled && !next.firstActivatedAt) next.firstActivatedAt = next.activatedAt = Date.now();
            next.enabled = input.enabled;
          }
          // Changing office data, or losing the replies approval, revokes live sending.
          if (!next.officeApproved || !repliesApproved) next.enabled = false;
          next.approvedBy = next.officeApproved ? user.username : null;
          store.data.settings = next;
          // Stopping the assistant cancels what it was about to send; a client message it had
          // taken to answer goes to the staff with an alert, never dropped unseen.
          if (!next.enabled || input.profile) for (const c of engine.inFlight()) {
            c.revision++;
            const why = c.pending.length || c.processing ? engine.unanswered(c) : null;
            if (why) engine.holdForStaff(c, why);
            c.pending = []; c.pendingSince = null;
            store.save(c);
          }
          store.audit(user.username, 'settings_updated'); return json(res, 200, next);
        }
        if (route === '/api/users' && req.method === 'POST') { admin(); const result = auth.add(await body(req)); store.audit(user.username, 'user_added'); return json(res, 201, result); }
        // The admin's own check of the number's connection: the same as the timer's (a check
        // that fails leaves the connection "unknown", with the reason).
        if (route === '/api/connection/check' && req.method === 'POST') {
          admin(); return json(res, 200, await engine.checkConnection());
        }
        // A test alert, to see the channel receives them (it is recorded like any alert's delivery).
        if (route === '/api/alerts/test' && req.method === 'POST') {
          admin();
          if (!config.alertWebhook) throw new Error('لا توجد قناة تنبيهات: اضبط ALERT_WEBHOOK_URL على الخادم.');
          const result = await engine.sendAlert('test');
          store.audit(user.username, 'alert_tested');
          return result.ok ? json(res, 200, { ok: true }) : json(res, 502, { error: `لم يصل التنبيه التجريبي إلى القناة (${result.error}).` });
        }
        const account = /^\/api\/users\/([a-zA-Z0-9_.-]{3,40})$/.exec(route);
        if (account && req.method === 'PUT') {
          admin(); const input = await body(req);
          const result = auth.update(account[1], { disabled: input.disabled, password: input.password }, user.username);
          store.audit(user.username, input.password !== undefined ? 'user_password_reset' : result.disabled ? 'user_disabled' : 'user_enabled'); return json(res, 200, result);
        }
        if (route === '/api/audit' && req.method === 'GET') { admin(); return json(res, 200, store.auditTail(100)); }
        if (route === '/api/qa' && req.method === 'GET') return json(res, 200, { ...material(), reviews: store.data.reviews, recordings: store.data.recordings });
        if (route === '/api/reviews' && req.method === 'POST') {
          const input = await body(req);
          if (!['conversation','dialect'].includes(input.kind) || typeof input.reviewer !== 'string' || input.reviewer.trim().length < 2 || typeof input.notes !== 'string' || input.notes.length > 5000) throw new Error('أكمل اسم المراجع ونوع التقييم والملاحظات.');
          if (input.kind === 'conversation' && (!material().samples.some(s => s.id === input.sampleId) || input.independent !== true)) throw new Error('يلزم مراجع مستقل وحالة موجودة.');
          if (input.kind === 'dialect' && input.saudiSpeaker !== true) throw new Error('مراجعة اللهجة تحتاج متحدثًا سعوديًا.');
          if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new Error('التقييم من 1 إلى 5.');
          const review = { id: randomUUID(), kind: input.kind, reviewer: input.reviewer.trim().slice(0,80), sampleId: input.kind === 'conversation' ? input.sampleId : 'all-replies',
            score: input.score, notes: input.notes, independent: input.independent === true, saudiSpeaker: input.saudiSpeaker === true, by: user.username, at: Date.now() };
          store.data.reviews.push(review); store.audit(user.username, 'review_saved'); return json(res, 201, review);
        }
        if (route === '/api/recordings' && req.method === 'POST') {
          const input = await body(req, 9_000_000);
          if (!material().voices.some(v => v.id === input.sampleId) || typeof input.speaker !== 'string' || !input.speaker.trim() || input.realVoice !== true || !Number.isFinite(input.duration) || input.duration < 0.5 || input.duration > 130 || typeof input.audio !== 'string') throw new Error('أكمل بيانات التسجيل بصوت بشري ومدته.');
          const data = Buffer.from(input.audio, 'base64');
          // The file must be a real audio container whose audio is about as long as stated.
          const checked = data.length <= 6_000_000 ? inspectAudio(data, input.duration) : { ok: false };
          if (!checked.ok) throw new Error('ملف الصوت غير صالح أو كبير جدًا.');
          const id = randomUUID(); const ext = checked.format; const dir = path.join(store.dir, 'recordings'); fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${id}.${ext}`), data, { mode: 0o600 });
          // Uploaded is not accepted: a person listens to it and marks it reviewed.
          const recording = { id, sampleId: input.sampleId, speaker: input.speaker.trim().slice(0,80), duration: checked.duration ?? input.duration, ext, by: user.username, at: Date.now(), reviewed: false };
          store.data.recordings.push(recording); store.audit(user.username, 'recording_saved'); return json(res, 201, recording);
        }
        const verdict = /^\/api\/recordings\/([a-f0-9-]+)\/review$/.exec(route);
        if (verdict && req.method === 'POST') {
          const input = await body(req); const recording = store.data.recordings.find(r => r.id === verdict[1]);
          if (!recording) return json(res, 404, { error: 'التسجيل غير موجود.' });
          if (typeof input.passed !== 'boolean') throw new Error('حدد نتيجة المراجعة.');
          if (recording.by === user.username && user.role !== 'admin') throw new Error('يراجع التسجيل شخص غير من رفعه.');
          Object.assign(recording, { reviewed: true, passed: input.passed, reviewedBy: user.username, reviewedAt: Date.now() });
          store.audit(user.username, 'recording_reviewed'); return json(res, 200, recording);
        }
        const audio = /^\/api\/recordings\/([a-f0-9-]+)$/.exec(route);
        if (audio && req.method === 'GET') {
          const recording = store.data.recordings.find(r => r.id === audio[1]); if (!recording) return json(res,404,{error:'التسجيل غير موجود.'});
          res.setHeader('Content-Type', `audio/${recording.ext}`); return sendFile(res, path.join(store.dir,'recordings',`${recording.id}.${recording.ext}`));
        }
        return json(res, 404, { error: 'المسار غير موجود.' });
      }
      const files = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'] };
      const file = files[route];
      if (file && req.method === 'GET') { res.setHeader('Content-Type',file[1]); return sendFile(res, path.join(config.root,'dashboard',file[0])); }
      return json(res,404,{error:'not_found'});
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 400, { error: /^[a-z_0-9]+$/.test(error.message) ? 'تعذر الاتصال بالخدمة. راجع إعدادات الخادم.' : error.message });
      else res.end();
    }
  });
  return server;
}
module.exports = { createApp, body };
