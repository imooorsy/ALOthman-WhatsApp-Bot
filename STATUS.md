# Implementation status

## Assumptions
- SPEC.md at the repository root is the authoritative full specification (docs/SPEC.md does not exist).
- Keep the already copied design and the original source documents unchanged.
- Local development uses PostgreSQL in Docker; production uses Render PostgreSQL.
- WA_PROVIDER=mock and AGENT_MODE=mock are defaults. Production cookies are always Secure; HTTP localhost uses an explicit development exception.
- No real agent internals are implemented; adapters own integration and validation.
- No production deployment is attempted without configured domains and credentials.

## Milestones
- M1 complete: scaffold, checked-in PostgreSQL migration, idempotent seed, cookie auth and roles, settings API and Arabic settings page, staff management.
- M2 complete: three-column chats and deep links, pure state machine, staff ownership and concurrency, secretary links, 24-hour window, mock inbound and agent.
- M3 complete: signed Meta webhook, atomic pg-boss enqueue, advisory-locked debounce worker, delivery receipts, validated mock/inprocess/http agent modes, timeout/retry fallback, private agent config endpoint and contract command.
- M4 complete: authenticated websocket realtime, reconnect refetch, durable missed notifications and reads, sound/desktop opt-in, preferences, badges, titles and urgent repeats.
- M5 complete: database-backed Jest e2e and adapter failure tests, durable webhook inbox/receipts, database constraints, production security hardening and patched dependencies, Render Blueprint and operations/agent/Web Push documentation.

## M1 validation
- Prisma migration deployed to Docker PostgreSQL 16; seed ran twice successfully.
- pnpm typecheck, API build and Next.js production build passed.
- node scripts/smoke-m1.mjs passed auth, Origin, employee permissions, defaults and settings concurrency checks.
- Browser visual QA remains for the full interface in M5.
- Local antivirus root certificate was exported to a temporary CA bundle for dependency installation; TLS verification stayed enabled. No machine configuration changed.

## M2 validation
- 22 Jest assertions passed for state transitions, pause, attachment policy, ownership, 24-hour boundary and encoded secretary links.
- Strict workspace typecheck and API build passed.
- scripts/smoke-m2.mjs passed the database-backed mock flow, staff takeover/send, stale action rejection, webhook-message ID deduplication, missing secretary validation and silent terminal messages; fixtures cleaned up.
- Terminal conversations are retained for incoming follow-ups so the specified not_suitable silent-store policy can apply.

## M3 validation
- 34 Jest assertions and pnpm test:agent-contract passed; strict workspace typecheck and API build passed.
- scripts/smoke-m3.mjs passed against live PostgreSQL: invalid signature rejected, three concurrent signed retries produced one inbound message and one mock-agent reply, durable queue executed, urgent status and config version recorded.
- M2 smoke reran successfully with asynchronous queue processing.
- ACK follows durable database/queue writes and does not wait for debounce or the agent.

## M4 validation
- Live signed-webhook smoke now verifies authenticated Socket.IO conversation.updated and handoff.created delivery, persisted missed notifications and mark-read removal.
- Workspace strict typecheck passed; API build passed. Browser sound and desktop permissions require an actual user gesture and are not auto-granted.

## M5 final validation
- All 39 Jest tests passed, including the actual PostgreSQL inbox/pg-boss -> mock agent -> urgent status -> Socket.IO event path, concurrent webhook retries, out-of-order delivery receipts, and persisted human fallback on agent failure.
- pnpm typecheck, shared/API builds, Next.js production build and pnpm test:agent-contract passed on the final patched Nest 11 / Zod 4 dependency set.
- All three migrations deployed successfully to local development and dedicated test databases. Prisma tooling remained functional after dependency upgrades.
- scripts/smoke-m1.mjs, scripts/smoke-m2.mjs and scripts/smoke-m3.mjs all passed against the running final API, including auth/Origin/roles, state actions, queue/realtime and notification reads.
- pnpm audit --prod --audit-level=high reported: No known vulnerabilities found. Transitive patch overrides are recorded in pnpm-workspace.yaml.
- HTTP /login returned 200 with RTL markup, CSP, nosniff and DENY framing headers. git diff --check passed.
- Temporary UI fixtures were removed. No demo clients are seeded. Original root HTML and DOCX remain untouched and untracked.

## Verification limits and next operational steps
- Browser visual QA could not run: cua browser host was unavailable; the native computer-use runtime failed to initialize kernel assets. Desktop/mobile appearance and native audio/desktop notification behavior still require manual browser verification. No permission dialogs were auto-granted.
- No Render resources were deployed and no real Meta messages were sent. Configure real domains/secrets and the permanent WhatsApp token, seed the production admin, and smoke-test with an office-controlled number before production use.
- The real agent is intentionally absent. Follow docs/AGENT_INTEGRATION.md to install its code and run the active-mode contract command. The HTTP container is a deliberate 503 placeholder until replaced.
- Web Push and data retention remain phase-2/TODO work as explicitly requested. Exactly-once outbound delivery across a crash after Meta accepts a send is not guaranteed; the README explains reconciliation.
- Local preview processes were stopped after checks; the local Docker database remains available. Start the application with pnpm dev.

## Local login/navigation recovery
- Reproduced a web-only hang: /login and /chats timed out while API /health remained 200 and POST /auth/login returned 201.
- The earlier combined runner had exited after the API was restarted, leaving the Next.js child listening but stalled. Restarted the web service in an independent retained session.
- Rechecked login (201), cookie-backed /auth/me (200), chats API (200, five sample conversations), /chats document (200), all seven page script assets (200), and credentialed CORS headers.
- Added --no-bail to pnpm dev and documented independent service restart commands. The updated command's workspace selection/options were validated.
- API and web are currently running independently for local testing. Browser UI automation remains unavailable, so no automated browser interaction is claimed.

## Agent settings on/off control
- Added an Arabic Agent Settings panel with an admin-only positive enable switch. Save Changes persists the existing rules.paused field; removed the duplicate pause switch from acceptance rules.
- Queued messages hand off with an audit event and notification when the model is disabled before processing. A response from an already-running call is discarded if the switch was disabled before delivery.
- Workspace typecheck and API build passed. All 42 Jest tests passed, including three new disabled-model regression cases and the database-backed pipeline tests.
- Local HTTP integration verified off -> human/no reply and on -> mock reply; original settings restored and temporary conversations removed. The running settings page returns 200.

## Firebase preparation
- Added Firebase 13.4 and a browser-only, lazily loaded Cloud Messaging initializer. Public project configuration and the supplied public VAPID key are in ignored local web environment files; Analytics is not initialized.
- Workspace and web TypeScript checks passed. Patched Firebase's transitive gRPC dependency; the production audit reports no known vulnerabilities.
- The supplied service-account JSON was found in the workspace, verified against the configured Firebase project, excluded from Git, and referenced only by the ignored API environment file. All Firebase configuration inputs are now available.
- Push enrollment and background delivery are not active yet; the service worker, authenticated registrations and backend sender remain to be implemented.

## Repeated desktop notification test fix
- Each test click now uses a unique notification tag and explicitly requests re-alerting; the previous test notification is closed. Test clicks focus the dashboard instead of navigating to a nonexistent test conversation.
- Real conversation alerts retain their grouping tag with re-alerting enabled. Unsupported browsers, blocked permission, disabled desktop preferences and notification creation errors now produce Arabic guidance instead of silent sound-only behavior.
- Prevented a late initial preferences response from overwriting preferences changed after enabling notifications.
- Two regression tests passed for distinct repeated-test tags and grouped real-alert re-alerting. Workspace TypeScript checks passed; visual OS banner display still needs manual browser verification.

## Firebase background delivery completed
- Implemented authenticated browser enrollment, logout cleanup, root service worker, minimal data-only FCM payloads, preference/read/age gates and durable pg-boss deliveries with checked-in migrations.
- Explicit closed-tab test sent exactly five notifications two seconds apart; Firebase accepted all five. OS banner count is not yet confirmed by the user. No additional push tests were sent during agent integration work.
- Push tests cover five distinct worker notifications, deduplication, expiry, session ownership, sanitized failures and queue timing. TypeScript checks, API build and automated tests pass; prior Next production build passed.
