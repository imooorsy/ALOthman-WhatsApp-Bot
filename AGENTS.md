# Conventions
- Read SPEC.md and STATUS.md before changes. Follow M1–M5 in order.
- Strict TypeScript; pnpm workspace. Run typecheck and relevant tests before committing.
- Keep design/osman-dashboard.html unchanged; reuse its CSS, RTL and Arabic labels.
- Never render untrusted HTML or log message text, credentials, tokens or webhook bodies.
- Database changes require checked-in Prisma migrations. Every staff mutation needs role validation and audit.
- Real agent code belongs in agent/; integration and validation belong to the API adapters.
