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
- M5 pending: tests, hardening, Render and documentation.

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
