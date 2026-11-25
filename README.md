# لوحة عثمان

Staff dashboard and WhatsApp pipeline for آل عثمان محامون ومستشارون. Requirements: [SPEC.md](SPEC.md). Implementation progress: [STATUS.md](STATUS.md).

## Local development

Use Node.js 22+ and pnpm 10+. Run `pnpm install`, `docker compose up -d`, then copy `.env.example` to `apps/api/.env`. Set a random JWT secret of at least 32 characters and an initial admin password of at least 12 characters. Set `NEXT_PUBLIC_API_URL=http://localhost:4000` in `apps/web/.env.local`.

Run `pnpm --filter @osman/shared build`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm seed`, then `pnpm dev`. Open http://localhost:3000/login. PostgreSQL is on localhost:54329. The seed is idempotent and never resets existing passwords or settings.

Production requires HTTPS, explicit WEB_ORIGINS and COOKIE_DOMAIN. The development cookie exception permits HTTP on localhost only. Never commit `.env` files or client records.
