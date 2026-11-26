# Render with external Neon databases

Use `render.neon.yaml` as the Blueprint Path when creating a **new** deployment. It creates the same three services and pairing disk as `render.yaml`, but no Render databases. The QR flow, production domains, Firebase secret file, migrations and seed are unchanged; follow [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md) for those steps. Do not deploy both Blueprints for the same number.

## Cost comparison

At the checked published rates, Render services/storage cost approximately $39.25/month: web $7, API $7, connector $25 and 1 GB pairing disk $0.25. **Neon is additional.** The Free plan includes 100 CU-hours per project/month and 1 GB storage. Our pg-boss workers poll every 0.5 seconds, including when there are no messages, so expect the API database compute to stay awake. This inference follows the current worker configuration; changing database provider does not change that behavior.

At a fixed 0.25 CU running 730 hours, consumption is 182.5 CU-hours. Neon Launch compute at $0.106/CU-hour is approximately $19.35/month, plus storage ($0.35/GB-month), backup/history, transfer or other applicable charges. Thus budget roughly **$59–60/month total** at that compute size and small storage, with higher cost if compute scales up. Free-plan quota is not enough for continuous full-month operation with this queue. Do not assume that a paid plan receives the free plan's compute allowance.

The smaller all-Render profile is approximately $51.85/month and is currently the cheaper estimated always-on managed option. Neon is useful for an existing paid account or limited-duration testing, but is not automatically a cost reduction here. Both estimates exclude model usage, taxes and account/usage extras. Verify the actual creation previews and monitor billing.

## Create and connect

1. Create a Neon project in Frankfurt (matching Render). Use one production branch and its single compute endpoint. For a paid small deployment start at 0.25 CU; monitor memory, connections and latency. Configure compute limits and billing alerts deliberately. A fixed small compute controls compute spend but has less capacity; ten real concurrent model chats have not been validated on this profile.
2. In that branch's **Databases** page, create two databases: `osman` and `evolution`, preferably each owned by a separate role. Two logical databases share the branch compute. Never use the same database for both applications: their Prisma tables/migration histories can conflict. Give each application role ownership of its own database so migrations and the API's `pgboss` schema can be created.
3. In **Connect**, select `osman`, its role, and turn **connection pooling off**. Copy the direct PostgreSQL URL into the Render **osman-api → DATABASE_URL** prompt. Retain Neon's TLS parameters such as `sslmode=require`. Use direct connections for the existing queue, transaction locks and migrations; this option does not require changing the application schema or adding a second migration URL.
4. Select `evolution` and its role; again disable pooling. Put its separate direct URL into **osman-whatsapp → DATABASE_CONNECTION_URI**. Add `connection_limit=10` to that Prisma URL using `&` if a query already exists (otherwise `?`). The API already defaults its Prisma pool to 20 connections. Account for the queue's additional connections and deployment migrations when checking Neon's connection limits.
5. Keep both URLs private in Render environment variables. Do not paste them into Git, chat, public Firebase variables or browser configuration. No database credentials are shipped in this repository.
6. Enter the remaining secrets and deploy. Check migration/seed success, health, admin login, QR pairing, inbound/reply delivery and reconnect as in the main deployment guide. Monitor Neon CU-hours, storage and transfer from day one. Stopping only the browser does not stop background database usage.

Validate both manifests locally with `pnpm check:render` and `pnpm check:render render.neon.yaml`. This checks official Render schema compatibility, not connectivity to an actual Neon account. No Neon resources or live migration were created by this preparation. Moving an existing populated installation requires backups and a planned restore/cutover of both databases; changing URLs alone starts with empty databases and loses access to existing records/pairing metadata.

Use Neon backup/restore facilities appropriate to the purchased plan and offsite logical backups of both databases; retain the Render pairing disk backup too. Free plan restore/history and storage allowances are limited.

Sources: [Neon pricing](https://neon.com/pricing), [database management](https://neon.com/docs/manage/databases), [scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Render pricing](https://render.com/pricing).
