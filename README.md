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

Sign in, then use `POST /dev/inbound` on the API with the session cookie and an allowed Origin:

```json
{"id":"unique-local-message-id","phone":"+15555550100","type":"text","text":"عاجل"}
```

The endpoint is admin-only, available only outside production with WA_PROVIDER=mock. Use `موظف`, `عاجل`, `خارج النطاق`, or `موعد` to exercise the mock agent actions. Normal messages continue the chat. Non-text types are image, audio, document and other; attachments route to staff by default. Nothing is sent to Meta in mock mode. Test fixtures are never seeded as client/demo data.

Inbound behavior in human/urgent/waiting_schedule stores the message and notifies staff; not_suitable stores silently. Pause routes new inbound messages to staff. Staff takeover is exclusive, mutations use optimistic versions, and return-to-agent resumes on the next client message. Since not_suitable must retain silent follow-ups, v1 reuses the latest conversation rather than silently starting a new agent session for the same phone.

## Tests

`pnpm test` runs unit and adapter tests. The database suite is skipped unless TEST_DATABASE_URL points to a separate, migrated test database. Create a database such as `osman_test`, apply migrations to it by setting DATABASE_URL for `pnpm db:migrate`, then set TEST_DATABASE_URL and run `pnpm test:e2e`. The suite starts a test API on port 4101, sends concurrent signed webhook retries, exercises the actual PostgreSQL inbox and pg-boss workers, validates the mock reply and urgent socket event, and verifies agent failure fallback. Use only a dedicated test database; fixture cleanup runs automatically.

For a running local API, `node scripts/smoke-m1.mjs`, `node scripts/smoke-m2.mjs`, and `node scripts/smoke-m3.mjs` cover auth/settings, chat actions, and signed-webhook/realtime integration. They read local credentials without printing them and clean up their records. The optional UI fixture script is local-only: run `node scripts/ui-fixture.mjs`, inspect with its documented disposable QA login, then run `node scripts/ui-fixture.mjs clean`.

## Render deployment

Create a Blueprint from [render.yaml](render.yaml), which uses paid always-on services and a private-network PostgreSQL database. Field names, paid plan IDs, `numInstances`, `preDeployCommand`, and `fromService` properties were checked against the [Render Blueprint reference](https://render.com/docs/blueprint-spec). No infrastructure has been deployed by this repository change.

1. Configure custom domains `app.<your-domain>` on osman-web and `api.<your-domain>` on osman-api. Add the DNS records Render supplies and wait for HTTPS certificates.
2. Set API WEB_ORIGINS to `https://app.<your-domain>` (comma-separated exact origins if needed), COOKIE_DOMAIN to `.<your-domain>`, and the web build variable NEXT_PUBLIC_API_URL to `https://api.<your-domain>`. Redeploy the web service when that public build variable changes. Cookies are httpOnly, Secure, SameSite=Lax, eight-hour JWT sessions; no tokens are stored in localStorage.
3. The API's pre-deploy command applies checked-in Prisma migrations. In the API service shell, temporarily set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME and SEED_ADMIN_PASSWORD (12+ characters), run `pnpm seed` from the repository root, and remove the password variable afterward. The initial settings contain services/categories but empty contact numbers; fill those in before secretary transfers.
4. Keep osman-api at **one instance**. It runs pg-boss workers in the same always-on process and broadcasts sockets in memory. Set the graceful shutdown delay to 120 seconds as in the Blueprint. Before scaling horizontally, add a Socket.IO shared adapter and review background-worker concurrency.
5. Choose the agent mode using [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md). For HTTP mode, install the real agent first, uncomment the optional osman-agent service and AGENT_URL reference in render.yaml, and set AGENT_MODE=http. The adapter accepts a URL or Render's private `hostport`. Both services share AGENT_API_KEY by service reference. The placeholder intentionally returns 503 and triggers human fallback.

The Blueprint uses private DB access only (`ipAllowList: []`). Change database network access deliberately if you need a workstation maintenance connection. Do not expose the agent as a public web service.

## Meta WhatsApp Cloud API

Create/configure the Meta app, register the office WhatsApp number, and set WA_PHONE_NUMBER_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_ACCESS_TOKEN and WA_API_VERSION in Render. Use a permanent system-user access token with the required WhatsApp messaging permissions. WA_API_VERSION is explicit so upgrades can be tested before changing it.

Set the webhook URL to `https://api.<your-domain>/webhooks/whatsapp`, enter the same verify token, subscribe the app to the WhatsApp account's `messages` field, and complete GET verification. The POST endpoint verifies X-Hub-Signature-256 against the exact raw body; never use the access token as the app secret. See the [Meta messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages).

Switch WA_PROVIDER to `meta` only after verifying the real configuration. First test a real inbound message and delivery/read status receipts with an office-controlled test number. Staff free-text replies are enabled only inside the 24-hour customer-service window; templates and media downloads are outside v1. Media messages are represented by Arabic attachment placeholders. The current client model requires an E.164 phone number; supporting WhatsApp users who expose only a business-scoped user identifier needs a domain-model extension.

## Durability and operational limits

The webhook acknowledges after a unique inbox row and pg-boss job commit together, without waiting for a conversation lock or model call. The inbox worker deduplicates waMessageId, persists the domain message and its conversation job atomically, and the conversation worker debounces rapid messages (3 seconds by default). Transaction-scoped PostgreSQL advisory locks serialize conversation processing and staff changes. Agent replies record the config version; settings reads use a consistent snapshot. Failures and invalid responses become human handoffs with an audit event and notification.

Meta delivery is an external side effect. A process/database crash after Meta accepts a send but before the transaction commits can leave delivery uncertain; v1 does not claim exactly-once outbound delivery. Check Meta delivery receipts and conversation audit history before manually retrying uncertain sends. Queue errors are logged without request bodies. Monitor pg-boss failures, pending inbox rows, `/health`, and agent_error notifications. Internal config access requires `x-agent-api-key`; an empty key disables it.

## Notifications and phase 2 Web Push

Staff must click **تفعيل الإشعارات** to unlock browser audio and request desktop notification permission. Denied permission requires allowing notifications in the browser's site settings. Sound, desktop, and volume preferences are stored per user. Urgent notifications repeat every 30 seconds until the chat is opened or assigned. Reconnecting refetches conversations and missed notifications. **Without Web Push, alerts work only while the dashboard tab is open.**

Phase 2 preparation is documented in [WEB_PUSH.md](docs/WEB_PUSH.md): service worker registration, VAPID key management, subscription persistence, per-user routing, and minimal payloads. These are deliberately not implemented or represented as available in v1.

## Backups and data retention

Enable Render managed backups and point-in-time recovery appropriate to the paid database plan. Regularly create encrypted offsite logical backups with `pg_dump --format=custom --file=osman.dump` using the database URL through PG* environment variables or the Render shell. Include both `public` and `pgboss` schemas in full backups. Store keys separately and restrict backup access. Verify restore with `pg_restore --clean --if-exists --no-owner --dbname=<isolated-restore-database> osman.dump` against an isolated database, then run migrations and checks before any production recovery. Do not restore over a live database as a routine test.

TODO with office approval: define retention periods for messages, summaries, audit records, notifications, processed webhook inbox payloads, queue archives and backups; add a configurable retention setting and scheduled purge/export workflow. Define staff deactivation and token revocation beyond the current eight-hour session lifetime. Keep legal client data out of application logs and error output.
