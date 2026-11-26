# Production deployment for alothmanlaw.sa

Repository preparation is complete for a Render deployment. This document does not mean resources have already been created or that production DNS, credentials and acceptance tests have passed. The chosen addresses are:

| Purpose | Address |
| --- | --- |
| Staff dashboard | https://osman.alothmanlaw.sa |
| Dashboard API and callbacks | https://osman-api.alothmanlaw.sa |
| WhatsApp connector | Private Render service; no public login or manager |

## What the Blueprint creates

`render.yaml` defines three paid, always-on services in Frankfurt: osman-web (Next.js), osman-api (NestJS, queue workers and the delivered Node agent), and osman-whatsapp (Evolution 2.3.8). Each uses the 1c-2g compute plan. It also defines two private-access 0.5c-1g PostgreSQL databases and a 5 GB pairing disk mounted at /evolution/instances. Review the cost shown by Render before creating the Blueprint; this change has not created paid resources.

The API and connector each remain at one instance. The API uses its in-memory Socket.IO adapter; the connector has a single attached pairing disk. Ten conversation workers run inside the API, with a bounded Prisma pool and per-chat serialization. The connector's tested single-instance local cache is used, with Redis disabled. The database connection, connector hostport and generated API key are linked by Blueprint references. The API converts the private hostport to an internal HTTP URL; browsers never receive the connector address/key. The callback travels to the public HTTPS API with a separately generated secret header.

## 1. Create services and enter configuration

1. Push the committed project to your connected Git repository, then create a Render Blueprint from render.yaml. Choose the production branch. Use a private repository if required by the office's source-access policy. No local .env, .local, backups or client records belong in that repository.
2. Render prompts for OPENROUTER_API_KEY, a new SEED_ADMIN_EMAIL and a strong SEED_ADMIN_PASSWORD of at least 12 characters. JWT_SECRET, the Evolution API key and webhook secret are generated. Do not copy local test logins or JWT/connector secrets into production.
3. Supply the web's NEXT_PUBLIC_FIREBASE_* values, including the VAPID public key, from the existing Firebase web app. These are public SDK settings. Upload the private server service-account JSON as an **osman-api Secret File** named `firebase-service-account.json`, available at `/etc/secrets/firebase-service-account.json`. Never use a NEXT_PUBLIC variable for its contents. Firebase is configured separately from dashboard cookie authentication. If browser-referrer restrictions exist on the public Firebase API key, allow the dashboard's new HTTPS origin.
4. The API pre-deploy command runs `pnpm db:migrate`. Its initial-deploy hook runs `pnpm seed` once, creating only the admin, settings, services and categories—no sample clients/chats. The production seed starts the bot paused. Existing records are not overwritten on a repeat seed. If the initial hook needs rerunning, use `pnpm seed` in the API Render shell from the repository root, then remove SEED_ADMIN_PASSWORD after successful initialization.
5. If moving an existing Render service from the old mock Blueprint, verify all updated environment variables explicitly in Render; the new values select evolution/inprocess mode. Confirm the migrations, hook and build finished. Public Firebase variables are compiled at build time: redeploy the web service after changing them. Do not deploy the Python placeholder agent or start the engineer's independent server.

The production API rejects mock agent/provider settings, missing model/connector credentials, incompatible cookie domains and insecure webhook callbacks at startup. Production variables should remain as set by the Blueprint:

```dotenv
NODE_ENV=production
COOKIE_DOMAIN=.alothmanlaw.sa
WEB_ORIGINS=https://osman.alothmanlaw.sa
WA_PROVIDER=evolution
AGENT_MODE=inprocess
AGENT_MODULE=../../agent/dashboard-adapter.cjs
AGENT_CONCURRENCY=10
AGENT_INTAKE_MODE=flexible
MODEL_PROVIDER=openrouter
OPENROUTER_MODEL=openai/gpt-6-luna
EVOLUTION_INSTANCE=osman-production
EVOLUTION_CALLBACK_URL=https://osman-api.alothmanlaw.sa/webhooks/evolution
```

DATABASE_URL, EVOLUTION_URL and EVOLUTION_API_KEY come from Render service references. Do not replace them with localhost, host.docker.internal or Windows file paths. The local antivirus CA bundle is a development-machine setting and is not included in this deployment. TLS verification remains enabled.

## 2. Add the two DNS records and wait for HTTPS

The Blueprint declares osman.alothmanlaw.sa and osman-api.alothmanlaw.sa as custom domains. In each service's Render Custom Domains page, obtain the exact DNS target Render assigned. Create the requested records for `osman` and `osman-api` at the DNS provider. Use Render's displayed targets, because generated onrender.com hostnames can have a unique suffix. Complete verification and wait for valid HTTPS certificates on both addresses.

Cookie sessions use the configured parent domain, Secure, httpOnly and SameSite=Lax. Access the dashboard through its configured custom domain; logging in through an unrelated onrender.com address does not satisfy this cookie/origin setup. No DNS record for the main website needs to be replaced. The initial API migration/seed can complete before custom-domain DNS, but login, browser push and the connector callback must be tested after DNS/TLS are ready.

## 3. Link the production WhatsApp Business number

QR onboarding is now in **Settings → ربط واتساب المكتب** after authenticated login. There is no QR on the public login page. Employees can view connection status; only an admin can request or receive QR data.

1. Sign in as the seeded admin and open Settings. A fresh production instance shows واتساب غير متصل. Click **ربط واتساب / تحديث الرمز**. The backend creates the instance if absent, configures its authenticated callback and requests a QR. Requests are rate-limited and audited without storing the QR or keys.
2. When the QR appears, open **WhatsApp Business on the office phone → Linked devices → Link a device** and scan it. QR images expire and refresh while the Settings panel is open. If the API restarts during initial pairing, request the code again. It never resets an already-connected session merely because the Settings page is opened.
3. The panel changes to **واتساب متصل** and removes the QR after pairing. Closing the dashboard does not stop the connector. Ordinary API/connector restarts and redeploys retain the pairing through the connector database and persistent disk. If WhatsApp revokes the linked device or the pairing data is lost, the admin reconnects from the same Settings panel. Keep the phone/account active according to WhatsApp's linked-device requirements.
4. Complete office information, services, contacts and a real secretary test number in Settings. Enable **تشغيل نموذج عثمان** and save when ready for the supervised test. Model failures continue to route to staff with an audit event.

This is the Evolution linked-device method already tested locally, and supports the phone's WhatsApp Business app. Meta Cloud API is a separate supported provider with different onboarding and no linked-device QR in this panel; do not configure both pipelines to answer the same number.

### Moving from the local test session

Use a separate test number for staging if possible. Before using the same business number in production, stop the local connector with `docker compose -f compose.evolution.yaml stop evolution`, and keep the local bot off. After production pairing/testing, unlink the obsolete local device from the phone's Linked devices list. Two active bot deployments paired to the same number can both receive and answer messages. Production uses its own database/instance and does not import local chat fixtures or pairing backups automatically.

## 4. Verify before office use

Run `pnpm check:render` to validate the YAML against Render's current official JSON Schema. This checks structure, not your account, repository access, secrets, DNS or actual provisioning. Render can additionally validate it with `render blueprints validate render.yaml`. Local validation passed, along with strict TypeScript, the API build, the production web build and automated tests including queue processing, role protection and QR lifecycle checks.

After deployment, verify `/health`, admin login, employee access, admin-only QR, a new inbound text from another phone, a real agent reply delivered back to that phone, private-ID senders, human takeover/reply, urgent routing, appointment preparation/secretary link, bot pause/resume and reconnect after an intentional restart. Check that the paired status and webhook persist. Test background notification enrollment on the actual HTTPS domain, then close the tab and intentionally request a test notification. No automatic push-test batch is sent by deployment.

Readiness limits: no Render resources, production DNS or production secret files were configured by this repository task. Real production acceptance, phone pairing and notification banners still need verification there. The flexible intake layer remains an explicitly reversible experiment and needs the office/AI engineer's acceptance of its legal screening behavior. Define data retention and access/backup procedures for both databases, pairing files, audit records and backups; the v1 automatic retention purge is still a documented TODO. Exactly-once WhatsApp outbound delivery across a crash is not guaranteed. Paid plans and an attached disk support continuity, but a disk-backed connector has a brief restart gap on redeploy and cannot be horizontally scaled.

## Operations and rollback

Use Render's PostgreSQL backups/PITR as appropriate to the purchased plans, and test restores in an isolated environment. Back up the connector database as well as its pairing disk. Keep a connector backup before image upgrades; do not delete its disk/database as a routine restart. Keep secrets and backups out of Git. Monitor failed inbox/queue jobs, agent_error events and actual incoming-message activity rather than relying only on a green connected status.

To pause model replies, use the existing admin switch; incoming messages are kept for staff. To roll back the intake experiment, set AGENT_INTAKE_MODE=original and restart the API. To change the model, set OPENROUTER_MODEL and run the agent contract check with that account. Do not run local fixture scripts on the production database. Staff JWT sessions currently last eight hours; password-change session revocation and a dedicated staff-deactivation workflow are outside this v1.

Sources: [Render Blueprint reference](https://render.com/docs/blueprint-spec), [private services](https://render.com/docs/private-services), [persistent disk behavior](https://render.com/docs/disks), [environment variables and secret files](https://render.com/docs/configure-environment-variables), [Evolution 2.3.8 receive fix](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.8).
