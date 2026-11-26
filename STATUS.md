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

## Delivered agent and QR connector
- Reviewed the supplied Node.js source and added an isolated dashboard adapter without changing engineer internals. The dashboard keeps auth, PostgreSQL, queues, state transitions and delivery. The engineer's standalone server/file store is not started.
- Native model schemas, guard, memory and summaries are reused. All eleven native actions are mapped. Invalid replies fail into the existing audited human handoff. Added a regression check for a win-guarantee phrase the native guard missed. Static prompt/legal rule differences and missing source tests are documented in docs/AGENT_REVIEW.md.
- Added a bounded optional JSON state contract and Conversation.agentState migration; memory/counters survive subsequent calls without agent database access and are omitted from staff chat responses. Migration applied to local and test databases.
- Added Evolution v2 outbound sends and secret-protected, instance-filtered webhook ingestion through the same durable inbox/queue pipeline. Self/group/history events are filtered and attachments retain the staff-handoff policy. Supplied phone aliases are required for private-ID senders.
- Added local Docker compose and idempotent setup/QR scripts; generated ignored connector secrets. Docker Compose configuration and script syntax validate. Evolution has not been started or paired; no real WhatsApp message has been sent. Full setup steps: docs/WHATSAPP_QR.md.
- At the user's request, apps/api/.env now selects inprocess mode, the delivered adapter, MODEL_PROVIDER=openrouter and OPENROUTER_MODEL=openai/gpt-6-luna. This model is named in the engineer's comments and verified against OpenRouter's current listing. OPENROUTER_API_KEY is an empty field for the user to fill. WA_PROVIDER remains mock. A key plus API restart is required before real agent replies; QR scan and switching WA_PROVIDER are required for real WhatsApp.
- Workspace typecheck and API build pass. All 84 Jest tests pass, including a two-turn PostgreSQL memory test and existing webhook/queue/socket e2e. Native Node AgentService dynamic import -> delivered adapter -> provider fixture -> shared validation also passed. Real model policy acceptance and a paired-phone test remain pending credentials/user QR scan.

## Evolution first-start recovery
- The first link attempt reached the container before its HTTP service finished starting, causing UND_ERR_SOCKET. Confirmed that the running service subsequently returned HTTP 200.
- Added an initial read-only readiness wait and actionable, sanitized CLI errors. Mutations are never automatically retried. Added a container HTTP health check and documented Compose --wait.
- Found that the pinned Evolution build returns 404 for a filtered lookup of an instance that does not yet exist. First-time linking now lists instances and selects locally instead; the authenticated unfiltered request returned HTTP 200.
- Four readiness regression tests, script syntax validation, Compose config validation and workspace typecheck passed. No WhatsApp messages were sent.

## QR generation and pairing recovered
- Diagnosed the actual no-QR failure inside Docker: WhatsApp and GitHub HTTPS requests failed UNABLE_TO_VERIFY_LEAF_SIGNATURE while the host trusted its local HTTPS-inspection CA.
- Mounted an ignored local certificate bundle read-only and configured NODE_EXTRA_CA_CERTS through the idempotent setup script. Verification remains enabled. Recreated the connector; container HTTPS checks for WhatsApp, GitHub and Google returned HTTP 200.
- Ran the link script directly and generated .local/whatsapp-qr.png. Subsequently verified the instance state is open: the phone is paired, and the linking process removed the QR image on success.
- Extended subsequent CLI scan windows to ten minutes with an explicit waiting message. Four readiness tests, workspace typecheck, script syntax and Compose validation pass. No test/client WhatsApp messages were sent by this recovery.

## Multi-client delivery and concurrency recovery
- Confirmed that Evolution stored incoming private-ID messages without a phone alias, while only one real client reached the dashboard. Corrected the E.164-only filter: Client now has a unique WhatsApp delivery address and nullable real phone, with a checked-in migration applied to local/test databases. Native private IDs are retained for outbound delivery and never fabricated as phone numbers.
- Added Arabic fallback client labels and guidance blocking secretary forwarding when the required client phone is unknown. AgentRequest.clientPhone may be null; the delivered adapter supports this without sharing state between clients.
- Replaced the single queue worker with AGENT_CONCURRENCY=10 independent conversation workers and inbox workers. Busy conversation locks use try-lock/defer behavior so bursts in one chat do not consume other clients' capacity. Settings reads reuse the transaction connection.
- All 87 Jest tests pass. A real PostgreSQL/pg-boss test proves ten simulated agent calls are in flight simultaneously, with ten isolated private-ID clients, correct outbound addresses, one call/reply per conversation and busy-chat deferral. Additional tests cover raw private-ID delivery and non-acknowledgment of deferred inbox rows. Workspace typecheck and API build pass. No production AI load test or test WhatsApp messages were sent.
- Restarted the local API with the changes and explicit AGENT_CONCURRENCY=10. The second phone should send a fresh message; previously filtered messages were not replayed as unsolicited outbound replies.

## Backed-up flexible intake experiment
- Before any agent edits, saved tracked agent code/prompts, API adapter and shared contract to .local/backups/agent-before-intake-20261126-013015.zip with a SHA-256 manifest at source checkpoint ff15a0d. Credentials and client records are excluded.
- Routing diagnostics confirmed existing_client after dashboard staff history, and close mapped to human. Added a separate experimental prompt/helper layer; the engineer's server/ai/config files are unchanged. No model weights were trained or changed.
- Ordinary closing/silence now remains agent_active; prior staff messages alone do not establish an existing legal file. Added booking-readiness guidance and one bounded model correction when referral/booking conflicts with unfinished intake. Urgent requests, explicit staff requests, genuine existing files and safety/error fallbacks are retained. Appointment dates remain preferences for secretary coordination, not confirmed bookings.
- AGENT_INTAKE_MODE=original restores the previous dashboard prompt/routing; flexible is the experimental default. Existing employee-owned conversations are not automatically resumed.
- Targeted deterministic tests passed. Live synthetic checks (no database/WhatsApp sends) passed for polite withdrawal, resuming after thanks and a ready appointment request. The debt-intake scenario initially failed validation; after strengthening the explicit-no-existing-file check, its rerun continued intake correctly. Full final checks are recorded below when complete.
- Final checks: all 94 Jest tests, workspace typecheck and API build passed. The phone-readiness regression also rejects a short six-digit contact number; targeted intake tests passed after that check. Confirmed no diff in the engineer's original server/ai/config directories. Restarted the API with flexible mode enabled; no live chat ownership/status was changed automatically.

## Connected-but-not-receiving WhatsApp recovery
- Traced the reported failure from the phone ending 8955. Evolution reported open and its authenticated webhook matched, but its incoming-message store was stale; a Docker-to-API authenticated probe returned 200. The failure was upstream of the dashboard/model, not a pending conversation job.
- Verified the official Evolution 2.3.8 release addresses open sessions that hold inbound messages due to missing Baileys status acknowledgments. Backed up the connector PostgreSQL database and pairing files to ignored .local/backups/evolution-before-238.dump and instances-before-238.tgz, then upgraded the pinned Compose image from 2.3.7 to 2.3.8 while retaining database, pairing, CA trust and webhook secrets.
- Confirmed new container health, open session, matching authenticated webhook, and the installed Baileys CB:status handler. Held messages then arrived from multiple phones. Messages from 8955 were stored and processed, and the resulting agent reply received a delivered status from WhatsApp. No synthetic WhatsApp messages were sent; these were client-initiated messages held upstream.
- Workspace typecheck and Docker Compose validation passed. Model prompts, staff ownership and conversation policies were unchanged. Blue read receipts remain intentionally disabled and are documented separately from message reception.
