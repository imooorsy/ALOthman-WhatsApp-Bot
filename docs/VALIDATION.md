# Validation record

## M1

Required checks before the milestone commit:
- Dependency installation and Prisma client generation.
- Apply checked-in SQL migration to local PostgreSQL; seed twice to confirm idempotency.
- Strict TypeScript checks and production builds.
- HTTP smoke checks: unauthenticated settings denied, login sets an httpOnly cookie, Origin rejected on mutations, employee settings writes denied, admin save increments version, stale settings save rejected.

UI uses the approved prototype's extracted CSS. Client and staff data render as React text nodes. Visual checks are recorded after the development server is available.
