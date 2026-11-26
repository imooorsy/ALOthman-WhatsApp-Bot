# لوحة عثمان

Staff dashboard and WhatsApp pipeline for آل عثمان محامون ومستشارون. Requirements: [SPEC.md](SPEC.md). Implementation progress: [STATUS.md](STATUS.md).

## Local development

Use Node.js 22+ and pnpm 10+. Run `pnpm install`, `docker compose up -d`, then copy `.env.example` to `apps/api/.env`. Set a random JWT secret of at least 32 characters and an initial admin password of at least 12 characters. Set `NEXT_PUBLIC_API_URL=http://localhost:4000` in `apps/web/.env.local`.

Run `pnpm --filter @osman/shared build`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm seed`, then `pnpm dev`. Open http://localhost:3000/login. PostgreSQL is on localhost:54329. The seed is idempotent and never resets existing passwords or settings.

Production requires HTTPS, explicit WEB_ORIGINS and COOKIE_DOMAIN. The development cookie exception permits HTTP on localhost only. Never commit `.env` files or client records.

## Workspace and commands

- `apps/api`: NestJS, Prisma/PostgreSQL, pg-boss, Meta/mock WhatsApp and agent adapters.
- `apps/web`: Next.js App Router, Arabic RTL interface, approved design CSS and Socket.IO client.
- `packages/shared`: statuses, state machine, settings schemas, agent port and notification types.
- `agent/`: integration boundary for the engineer's code; the HTTP container is a placeholder until replaced.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:agent-contract`.

The API development command compiles before starting and watches compiled output. During API development, run `pnpm --filter @osman/api exec tsc --watch` in another terminal for continuous TypeScript compilation. Next.js development uses its normal live reload. All timestamps in the interface use Asia/Riyadh with Western digits.

The combined development runner uses `--no-bail` so an API restart/error does not terminate the runner while leaving the web child detached. For independent restarts, use separate terminals for `pnpm --filter @osman/api dev` and `pnpm --filter @osman/web dev`. If login returns 201 but `/chats` does not load, check that the web server itself responds; restarting the API alone cannot repair a stalled web process. See [pnpm runner behavior](https://pnpm.io/10.x/cli/recursive#--no-bail).

## Mock message flow

The delivered Node agent is integrated through `agent/dashboard-adapter.cjs`. See [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) for credentials, memory and validation, [AGENT_REVIEW.md](docs/AGENT_REVIEW.md) for review findings, and [WHATSAPP_QR.md](docs/WHATSAPP_QR.md) for the Evolution QR login supported by the engineer's code. The official Meta provider remains available. Do not start the engineer's standalone server alongside this dashboard.

Sign in, then use `POST /dev/inbound` on the API with the session cookie and an allowed Origin:

```json
{"id":"unique-local-message-id","phone":"+15555550100","type":"text","text":"عاجل"}
```

The endpoint is admin-only, available only outside production with WA_PROVIDER=mock. Use `موظف`, `عاجل`, `خارج النطاق`, or `موعد` to exercise the mock agent actions. Normal messages continue the chat. Non-text types are image, audio, document and other; attachments route to staff by default. Nothing is sent to Meta in mock mode. Test fixtures are never seeded as client/demo data.

Inbound behavior in human/urgent/waiting_schedule stores the message and notifies staff; not_suitable stores silently. Pause routes new inbound messages to staff. Staff takeover is exclusive, mutations use optimistic versions, and return-to-agent resumes on the next client message. Since not_suitable must retain silent follow-ups, v1 reuses the latest conversation rather than silently starting a new agent session for the same phone.

To enable or disable model replies, open Settings → **إعدادات الوكيل** → **تشغيل نموذج عثمان**, then save changes. Only admins can change this switch; employees can view it. It uses the existing global pause setting, so the sidebar status stays consistent. Disabled models are not called for queued messages, which hand off to staff with an audit event and notification. If a model call is already running, its result is checked against the current switch before sending a reply. Re-enabling does not take conversations away from staff; return a chat to عثمان to resume on its next client message.

## Tests

`pnpm test` runs unit and adapter tests. The database suite is skipped unless TEST_DATABASE_URL points to a separate, migrated test database. Create a database such as `osman_test`, apply migrations to it by setting DATABASE_URL for `pnpm db:migrate`, then set TEST_DATABASE_URL and run `pnpm test:e2e`. The suite starts a test API on port 4101, sends concurrent signed webhook retries, exercises the actual PostgreSQL inbox and pg-boss workers, validates the mock reply and urgent socket event, and verifies agent failure fallback. Use only a dedicated test database; fixture cleanup runs automatically.

For a running local API, `node scripts/smoke-m1.mjs`, `node scripts/smoke-m2.mjs`, and `node scripts/smoke-m3.mjs` cover auth/settings, chat actions, and signed-webhook/realtime integration. They read local credentials without printing them and clean up their records. The optional UI fixture script is local-only: run `node scripts/ui-fixture.mjs`, inspect with its documented disposable QA login, then run `node scripts/ui-fixture.mjs clean`.

## Render deployment

Follow [RENDER_DEPLOYMENT.md](docs/RENDER_DEPLOYMENT.md). The prepared addresses are **osman.alothmanlaw.sa** (dashboard) and **osman-api.alothmanlaw.sa** (API). The Blueprint includes paid web/API services, a private Evolution 2.3.8 connector, two private-access PostgreSQL databases and persistent pairing storage. The delivered Node agent runs inside the API. Run `pnpm check:render` for official JSON Schema validation; actual provisioning, DNS and account checks still happen on Render. No cloud resources were created by this repository change.

Enter the prompted production model/admin/Firebase values, upload the API's Firebase secret file, add the two DNS records Render supplies, and wait for HTTPS. Migrations run before deploy; the initial seed creates the admin and starts the bot paused. After login, an admin connects the business phone in **Settings → ربط واتساب المكتب**. QR images are authenticated, admin-only, short-lived and never placed on the public login page. Employees see connection status only. An already-connected session is preserved across dashboard visits, normal restarts and redeploys using its persistent storage.

Keep the API and connector single-instance. Stop/unlink the old local bot when cutting over the same business number, then perform the production inbound/reply, staff, scheduling and background-notification tests documented in the guide before office use. Review the documented v1 retention, session and experimental-agent limitations; local tests do not replace production acceptance.

## Meta WhatsApp Cloud API

Create/configure the Meta app, register the office WhatsApp number, and set WA_PHONE_NUMBER_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_ACCESS_TOKEN and WA_API_VERSION in Render. Use a permanent system-user access token with the required WhatsApp messaging permissions. WA_API_VERSION is explicit so upgrades can be tested before changing it.

Set the webhook URL to `https://api.<your-domain>/webhooks/whatsapp`, enter the same verify token, subscribe the app to the WhatsApp account's `messages` field, and complete GET verification. The POST endpoint verifies X-Hub-Signature-256 against the exact raw body; never use the access token as the app secret. See the [Meta messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages).

Switch WA_PROVIDER to `meta` only after verifying the real configuration. First test a real inbound message and delivery/read status receipts with an office-controlled test number. Staff free-text replies are enabled only inside the 24-hour customer-service window; templates and media downloads are outside v1. Media messages are represented by Arabic attachment placeholders. Evolution also supports private-ID-only senders through Client.waAddress with a nullable public phone; no private ID is converted into a phone number. AGENT_CONCURRENCY defaults to 10 independent conversation workers; messages inside one chat remain serialized. See docs/WHATSAPP_QR.md.

## Durability and operational limits

The webhook acknowledges after a unique inbox row and pg-boss job commit together, without waiting for a conversation lock or model call. The inbox worker deduplicates waMessageId, persists the domain message and its conversation job atomically, and the conversation worker debounces rapid messages (3 seconds by default). Transaction-scoped PostgreSQL advisory locks serialize conversation processing and staff changes. Agent replies record the config version; settings reads use a consistent snapshot. Failures and invalid responses become human handoffs with an audit event and notification.

Meta delivery is an external side effect. A process/database crash after Meta accepts a send but before the transaction commits can leave delivery uncertain; v1 does not claim exactly-once outbound delivery. Check Meta delivery receipts and conversation audit history before manually retrying uncertain sends. Queue errors are logged without request bodies. Monitor pg-boss failures, pending inbox rows, `/health`, and agent_error notifications. Internal config access requires `x-agent-api-key`; an empty key disables it.

## Notifications and Firebase Web Push

Staff must click **تفعيل الإشعارات** to unlock browser audio and request desktop notification permission. Denied permission requires allowing notifications in the browser's site settings. Sound, desktop, and volume preferences are stored per user. Urgent notifications repeat every 30 seconds until the chat is opened or assigned. Reconnecting refetches conversations and missed notifications. **Without Web Push, alerts work only while the dashboard tab is open.**

Firebase background delivery is now implemented following the later request. With Firebase configured, a registered browser can receive generic Arabic alerts after the dashboard tab closes. The API and browser background push service must remain running, and the staff session must remain valid. See [WEB_PUSH.md](docs/WEB_PUSH.md) for registration, server credentials, logout behavior and testing.

## Backups and data retention

Enable Render managed backups and point-in-time recovery appropriate to the paid database plan. Regularly create encrypted offsite logical backups with `pg_dump --format=custom --file=osman.dump` using the database URL through PG* environment variables or the Render shell. Include both `public` and `pgboss` schemas in full backups. Store keys separately and restrict backup access. Verify restore with `pg_restore --clean --if-exists --no-owner --dbname=<isolated-restore-database> osman.dump` against an isolated database, then run migrations and checks before any production recovery. Do not restore over a live database as a routine test.

TODO with office approval: define retention periods for messages, summaries, audit records, notifications, processed webhook inbox payloads, queue archives and backups; add a configurable retention setting and scheduled purge/export workflow. Define staff deactivation and token revocation beyond the current eight-hour session lifetime. Keep legal client data out of application logs and error output.
