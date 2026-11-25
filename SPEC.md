# Osman Dashboard (لوحة عثمان) — Full Build Spec

Read this ENTIRE file (sections 1–14) before writing code. Work through ALL milestones in section 14 in the stated order, commit after each milestone, and only stop if you are truly blocked. If you run low on budget, stop at a clean milestone boundary and update STATUS.md with what is done and what is next.

## 1. CONTEXT
- The office (آل عثمان محامون ومستشارون, Al Othman Law Office) has a WhatsApp number answered by an AI agent called "Othman" (عثمان). The agent talks to each client until it decides one of three outcomes: (a) hand the chat to a human employee (normal or urgent), (b) the client is not suitable for the office rules/terms, (c) the chat is finished and the client waits for the secretary to schedule an appointment.
- The agent is built by a separate AI engineer who will SEND THE AGENT CODE LATER (it is not a hosted API). Its language/runtime is unknown (could be TypeScript or Python). Build everything now against a clean agent port + mock agent (section 8) so dropping the real agent in later is a small, isolated change.
- This project is the staff dashboard plus the WhatsApp message pipeline around the agent.

## 2. UI SOURCE OF TRUTH
`design/osman-dashboard.html` is the approved design. Reproduce it faithfully:
- Tokens: --color-primary oklch(0.387 0.148 267); --color-sand oklch(0.969 0.013 73); --color-dark oklch(0.223 0.094 252); --color-text-dark oklch(0.32 0.0739 263.98). Reuse its CSS variables and component styles as-is (global CSS / CSS modules). No UI kit.
- Fonts: Amiri (headings), IBM Plex Sans Arabic (body). RTL everywhere; phone numbers and Latin text isolated as LTR (bdi/.ltr).
- Collapsible dark sidebar, 3-column Chats layout (list / conversation / actions + summary), toasts, accessible tabs and switches, responsive breakpoints, reduced-motion support.
- REMOVE the Overview page and the Clients page (and their sidebar items), all demo data, and the "numbers are sample" note. Sidebar: المحادثات, الإعدادات only. Keep the bot status indicator ("البوت يعمل" / "البوت متوقف").
- Still store client records (name, phone, detected category, short description): the chat header and summary need them, and a Clients page may come later.
- SECURITY: the prototype uses innerHTML. Never do that. Render all client text and agent text as escaped text. The agent summary is plain text.

## 3. SCOPE (v1)
- Pages: /login, /chats (+ /chats/[id] deep link), /settings. Default route /chats.
- Roles: `admin` (edits settings, manages staff) and `employee` (chats; settings view-only).
- UI language: Arabic only, Western digits, times shown in Asia/Riyadh.

## 4. STACK & REPO
pnpm monorepo:
- apps/api: NestJS 10+ (TypeScript, strict), Prisma + PostgreSQL, Socket.IO gateway (@nestjs/websockets), pg-boss for background jobs (same Postgres, own schema), class-validator DTOs, Pino logging, @nestjs/throttler, helmet.
- apps/web: Next.js (App Router) + TypeScript, socket.io-client, plain CSS from the design.
- packages/shared: shared TypeScript types/enums (statuses, event names, agent contract).
- agent/: placeholder for the AI engineer's agent (section 8).
- design/osman-dashboard.html, render.yaml, docs/, .env.example, README.md, AGENTS.md (short conventions for future Codex sessions).

Auth: email + password (argon2 or bcrypt), JWT in an httpOnly Secure cookie (SameSite=Lax, Domain=parent domain so app.<domain> and api.<domain> share it), Origin check on mutations, login rate-limit. Provide `pnpm seed` creating one admin from env vars plus default categories/services (section 5).

Tests: Jest for the state machine, secretary-link builder, webhook idempotency, agent contract validation; one e2e test: webhook -> queue -> mock agent -> status change -> socket event.

## 5. DOMAIN MODEL (Prisma)
- StaffUser(id, name, email unique, passwordHash, role, notifyPrefs JSON)
- Client(id, phone E.164 unique, name?, detectedCategory?, shortDescription?)
- Conversation(id, clientId, status, assignedStaffId?, category?, summary?, urgentReason?, unreadCount, lastClientMessageAt, lastActivityAt, version Int for optimistic concurrency)
- Message(id, conversationId, direction[client|agent|staff], type[text|image|audio|document|other], text, waMessageId unique nullable, deliveryStatus, agentConfigVersion?, createdAt)
- ConversationEvent(id, conversationId, type, actorStaffId?, payload JSON, createdAt) — audit trail
- Notification(id, type, conversationId, reason, createdAt) + NotificationRead(notificationId, staffId)
- OfficeSettings (single row: JSON + configVersion Int incremented on every save)
- Service(id, name, price Decimal, active, sort); CaseCategory(id, name, active, outOfScope Bool, sort)

Seed categories: عمالي، تجاري وعقود، ضريبي وزكوي، عقاري، أسري، خارج النطاق (outOfScope = true).
Seed services (SAR, excluding VAT): استشارة حضورية أو مرئية 750، استشارة هاتفية 500، صياغة صحيفة أو مذكرة (من) 2,500، حضور جلسة أو تحقيق 5,000.

## 6. CONVERSATION STATE MACHINE (pure, unit-tested class)
Statuses: agent_active "عثمان يحاور", human "عند موظف", urgent "عاجل", waiting_schedule "بانتظار الموعد", not_suitable "غير مناسب".
- A new inbound message creates Client + Conversation (agent_active) if no open one exists.
- The agent is called ONLY when status = agent_active and global pause is off. In any other status, inbound messages are stored, unreadCount increments, staff are notified (section 10); the agent never replies there.
- Agent action mapping: continue -> stay agent_active; handoff -> human (+ notify); handoff_urgent -> urgent (+ urgent notify); not_suitable -> not_suitable; completed -> waiting_schedule.
- Non-text inbound (image/voice/document): store with its type, show "[مرفق: صورة]" etc., send the agent "[attachment]" as text, and by default route the chat to human with reason "مرفق" (configurable constant).
- Staff actions (server-validated, each writes a ConversationEvent and emits a socket update; use optimistic concurrency via `version`):
  - "تحويل إلى موظف": status = human, assignedStaffId = current user. If another employee already holds it, block and show who.
  - "إعادة إلى عثمان": status = agent_active, clear assignee; the agent resumes on the next client message.
  - "تحويل إلى السكرتيرة (واتساب)": build `https://wa.me/<secretary number, digits only>?text=<encodeURIComponent(message)>`, open in a new tab, set status = waiting_schedule. Arabic message template: client name (or phone), phone, detected category, summary, then "بانتظار تحديد موعد". If the secretary number is empty in Settings, block with a toast pointing to Settings.
  - "إغلاق: غير مناسب": confirm dialog, status = not_suitable.
- The composer is enabled only for human/urgent AND inside WhatsApp's 24-hour customer-service window; otherwise show helper text ("اضغط تحويل إلى موظف لاستلام المحادثة") or an explanation that a template message is required (v1: disabled state only).
- Global "إيقاف البوت مؤقتًا": the agent is not called; inbound messages go to human status and notify staff.
- Make unspecified cases configurable constants. Default: a new client message in waiting_schedule -> store + notify; in not_suitable -> store silently.

## 7. WHATSAPP PIPELINE (Meta WhatsApp Cloud API behind IWhatsAppProvider)
- GET/POST /webhooks/whatsapp. Enable NestJS `rawBody` and verify X-Hub-Signature-256 with the app secret. Return 200 immediately; persist the message and enqueue a pg-boss job. Idempotent on waMessageId (Meta retries).
- Worker: per-conversation serialization using a Postgres advisory lock; short debounce (default 3 s) that batches rapid consecutive client messages into one agent call.
- Outbound via IWhatsAppProvider.send (agent replies and staff messages); store delivery status from status webhooks.
- Agent failure/timeout (default 20 s, 1 retry) or invalid agent output: set status human, create an `agent_error` event, notify staff with the reason. Never leave a client silently unanswered.
- Env: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_VERIFY_TOKEN, WA_APP_SECRET, WA_API_VERSION. Provide a `WA_PROVIDER=mock` mode with a dev endpoint to simulate inbound messages so everything is testable without Meta.

## 8. AGENT PORT (isolated; the real agent arrives later as code)
Interface `AgentPort.respond(AgentRequest): Promise<AgentResponse>` in packages/shared.

- AgentRequest: conversationId, clientPhone, history[{role: client|assistant|staff, text, at}], newMessages[], config {version, office, contacts, services, categories, rules}.
- AgentResponse: reply (string|null), action [continue|handoff|handoff_urgent|not_suitable|completed], category (string|null), clientName (string|null), summary (plain string|null, for the team), urgentReason (string|null).

The contract is a PROPOSAL; validate every response with a schema (zod) and treat anything invalid as an agent failure.

Implementations selected by env `AGENT_MODE`:
1. `mock` (default now): keyword rules that exercise every action, for demos and tests.
2. `inprocess`: for when the engineer's agent is Node/TypeScript. It lives in `agent/` and is wrapped by a thin adapter in apps/api. Do not edit the agent's internals.
3. `http`: for when the agent is Python or another runtime. It lives in `agent/` with its own Dockerfile, exposes a private `POST /respond` (same contract) and runs as a Render private service; the API calls `AGENT_URL`.

The agent is stateless and has no database access: our backend passes the history and the settings snapshot on every call. Log which `config.version` produced each reply (Message.agentConfigVersion).

Add `docs/AGENT_INTEGRATION.md` explaining how to plug the real agent in (steps for inprocess and http modes), required env vars, and a contract test (`pnpm test:agent-contract`) that runs sample requests against whichever mode is active and checks the response shape.

Also expose `GET /internal/agent-config` (protected by AGENT_API_KEY) returning the current settings, for agents that prefer to pull them.

## 9. PAGES & BEHAVIOR

### /chats
- Right column: tabs الكل / عاجل / عند موظف / بانتظار الموعد / غير مناسب with live counts; rows show phone (LTR), Arabic relative time, last message preview, status label, unread indicator. Sort: urgent first, then latest activity.
- Middle: header, thread (client / عثمان / staff clearly distinguished), composer.
- Left: the four action buttons, "ملخص الفريق", key-value box (name, phone, secretary number), hint text under the WhatsApp button.
- Live updates via Socket.IO without reload; auto-reconnect and refetch on reconnect; keep scroll position; auto-scroll only when at bottom; opening a chat marks it read.

### /settings (admin edits, employee view-only)
- معلومات المكتب: name, intro text the agent uses, address, working hours.
- بيانات التواصل: office number for urgent cases, secretary WhatsApp number, employee number.
- الخدمات والأسعار: editable rows, add/remove, active switch.
- تصنيفات القضايا (NEW panel): add/rename/activate categories, mark "خارج النطاق".
- قواعد القبول والتحويل: minimum claim 80,000 SAR; urgent handoff on near deadline; auto-apology out of scope; send summary to employee on handoff; pause bot.
- إعدادات الإشعارات: per user; see section 10.
- Validate (E.164 phones, numeric prices, required fields). Each save increments configVersion and shows the toast "تم حفظ التغييرات". Confirm before saving while the bot is active.

## 10. NOTIFICATIONS (sound + desktop notification)
Triggers: (1) the agent moves a chat to human; (2) the agent marks it urgent; (3) a client message arrives in a human/urgent/waiting_schedule chat that is not currently open and focused; (4) agent failure fallback. Never notify the staff member for an action they performed themselves.

- Backend writes a Notification row and emits socket events (`handoff.created`, `message.inbound`, `conversation.updated`) to all connected staff.
- Frontend: a "تفعيل الإشعارات" banner/button (user gesture required) that requests Notification permission AND unlocks audio. Handle default/granted/denied with clear Arabic guidance for denied.
- On event: `new Notification(...)` with Arabic title/body (phone, category, short reason); `tag` = conversation id to avoid duplicates; `requireInteraction: true` for urgent. Click focuses the tab and opens /chats/{id}.
- Two short sounds (normal / urgent); urgent repeats every 30 s until the chat is opened or taken. Per-user toggles: sound, desktop, volume, and a "test notification" button.
- Also: sidebar badge, tab title "(3) لوحة عثمان", and missed notifications listed after login (GET /notifications + mark-read endpoint).
- Prepare, do not build, Web Push (service worker + VAPID) for when the browser is closed; document it in the README as phase 2. State clearly that without it alerts work only while the dashboard tab is open.

## 11. SETTINGS -> AGENT
Settings are the single source of fixed knowledge for the agent. Every agent call carries `config.version`. Any settings change takes effect on the next agent call.

## 12. SECURITY & PRIVACY (legal client data)
HTTPS only, secure cookies, CORS allowlist, rate limiting on login and webhooks, role checks on every endpoint, no message bodies in application logs, secrets only in env vars, audit trail of staff actions, data-retention setting as a README TODO.

## 13. DEPLOYMENT (Render, paid always-on instances)
- Provide `render.yaml` (Blueprint): web service `osman-web` (Next.js), web service `osman-api` (NestJS, healthCheckPath /health, ONE instance in v1 because Socket.IO is single-node), a Render PostgreSQL database, and an optional private service `osman-agent` (only for AGENT_MODE=http). Wire DATABASE_URL via fromDatabase and AGENT_URL via fromService.
- Run `prisma migrate deploy` as a pre-deploy command (or in the start command if pre-deploy is unavailable). Verify the render.yaml field names against the current Render Blueprint docs before writing.
- Use two subdomains (app.<domain>, api.<domain>) with the cookie on the parent domain; Socket.IO connects directly to api.<domain> with websocket transport.
- Provide `.env.example` listing every variable, and a README with: Render setup, domains, Meta WhatsApp Cloud API setup (webhook URL https://api.<domain>/webhooks/whatsapp, verify token, permanent token), how to switch AGENT_MODE, and how to back up the database.

## 14. MILESTONES (follow this exact order, commit after each)
- **M1:** monorepo scaffold, Prisma schema + migrations + seed, auth + roles, Settings API + page matching the design.
- **M2:** Chats UI matching the design with the full state machine, staff actions, the secretary wa.me link, using the WhatsApp mock provider and mock agent.
- **M3:** real WhatsApp webhook pipeline + pg-boss worker + agent port (mock/inprocess/http skeleton) + failure fallback + contract test.
- **M4:** Socket.IO realtime + notifications (sound, desktop, badges, urgent repeat, missed notifications).
- **M5:** tests, security hardening, render.yaml, README, docs/AGENT_INTEGRATION.md.

Before M1, write a short list of assumptions in STATUS.md (do not wait for answers), then proceed with sensible defaults.
