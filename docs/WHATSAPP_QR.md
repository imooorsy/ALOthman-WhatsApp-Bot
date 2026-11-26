# WhatsApp through a QR login

The supplied engineer code uses Evolution API's **WHATSAPP-BAILEYS** connector. This is a WhatsApp linked-device session, distinct from the existing official Meta Cloud API provider. The dashboard now supports `WA_PROVIDER=mock|meta|evolution`; select one provider for a number and keep the engineer's standalone server stopped.

## Local setup (Windows + Docker Desktop)

From the repository root:

```powershell
node scripts/whatsapp-setup.mjs
docker compose -f compose.evolution.yaml up -d
node scripts/whatsapp-link.mjs
```

Setup is idempotent and has already been run locally. It generates random private keys in ignored `.local/evolution.env` and `apps/api/.env`. It keeps existing model/WhatsApp modes. The compose file pins the same Evolution v2.3.7 release as the engineer's trial setup, binds port 8080 to localhost, and persists the linked session and an independent connector PostgreSQL database. Docker pulls the images on first run. Wait for the connector to become available before running the link script. `docker compose -f compose.evolution.yaml ps` shows its state.

The link script creates the `osman` instance, subscribes to MESSAGES_UPSERT and MESSAGES_UPDATE, installs an authenticated webhook and refreshes `.local/whatsapp-qr.png` for up to two minutes. Open that image from Explorer while the script runs. On the phone containing the number to connect, choose **WhatsApp → Linked devices → Link a device**, then scan the image. The script reports connected and removes the QR image; if it times out, rerun for a fresh code. It does not print API secrets/pairing codes or send messages. Treat the QR as a login credential and do not share it.

Then edit **apps/api/.env**:

```dotenv
WA_PROVIDER=evolution
AGENT_MODE=inprocess
AGENT_MODULE=../../agent/dashboard-adapter.cjs
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=<your private key>
OPENROUTER_MODEL=openai/gpt-6-luna
```

The setup script already fills EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY and EVOLUTION_WEBHOOK_SECRET. Set the OpenRouter values yourself locally, never in the browser or a public repository. Restart the API (`pnpm --filter @osman/api build`, then `pnpm --filter @osman/api start`, after stopping its old process). The web server needs no Firebase or WhatsApp secret.

For a connector-only trial, keep `AGENT_MODE=mock`: incoming messages use deterministic mock replies sent to the linked test phone. Use a test number, send from a different phone, and then verify `/chats`. Do not mistake mock replies for the real agent. In Settings, enable تشغيل نموذج عثمان and save before the intended agent test.

## Webhook and routing

The local Docker callback is `http://host.docker.internal:4000/webhooks/evolution`. The connector sends the private `x-webhook-secret` header. This route bypasses browser Origin checks only because it verifies that header, selected provider and instance. Each message/receipt is persisted with its unique WhatsApp ID and a pg-boss job in one transaction, then follows the same debounce, advisory lock, state machine, staff notifications and outbound provider as Meta. Client text is not logged.

In another hosting arrangement set EVOLUTION_CALLBACK_URL in the shell before running the link script, for example `https://api.example.com/webhooks/evolution`. EVOLUTION_URL must be the connector base URL reachable by the API. Use HTTPS/private networking, protect the manager/API key, and persist connector volumes. This connector is an additional always-on service; the existing Render Blueprint does not deploy it. Do not copy the local Docker-host callback into production.

Only direct chats with an E.164 phone identity are accepted. Private-ID senders need the phone alias supplied by Evolution. Groups, self messages, reactions and history-sync events do not trigger agent replies. Attachments follow the dashboard's existing staff-handoff policy; the native agent's media/transcription pipeline is not started. The dashboard retains its 24-hour staff-composer limit for all providers. QR sessions can disconnect and require relinking; verify receiving after reconnect/restart before a rollout.

To stop the connector without deleting its session: `docker compose -f compose.evolution.yaml stop`. To stop real sends in the dashboard: set WA_PROVIDER=mock and restart the API, and/or disable the agent in Settings. Do not delete connector volumes as a routine restart.

## Sources

- [Evolution instance creation/QR implementation](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/controllers/instance.controller.ts)
- [Evolution v2.3.7 release and reconnect/private-ID changes](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7)
