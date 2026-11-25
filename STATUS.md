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
- M2 pending: chats, state machine, staff actions, mock providers.
- M3 pending: webhook, durable worker, agent adapters.
- M4 pending: realtime and notifications.
- M5 pending: tests, hardening, Render and documentation.

## M1 validation
- Prisma migration deployed to Docker PostgreSQL 16; seed ran twice successfully.
- pnpm typecheck, API build and Next.js production build passed.
- node scripts/smoke-m1.mjs passed auth, Origin, employee permissions, defaults and settings concurrency checks.
- Browser visual QA remains for the full interface in M5.
- Local antivirus root certificate was exported to a temporary CA bundle for dependency installation; TLS verification stayed enabled. No machine configuration changed.
