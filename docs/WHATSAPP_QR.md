# WhatsApp through a QR login

The supplied engineer code uses Evolution API's **WHATSAPP-BAILEYS** connector. This is a WhatsApp linked-device session, distinct from the existing official Meta Cloud API provider. The dashboard now supports `WA_PROVIDER=mock|meta|evolution`; select one provider for a number and keep the engineer's standalone server stopped. Production deployment and admin QR onboarding are described in [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md). An admin can now pair from Settings → ربط واتساب المكتب; the commands below remain available for local setup.

## Local setup (Windows + Docker Desktop)

From the repository root:

```powershell
node scripts/whatsapp-setup.mjs
docker compose -f compose.evolution.yaml up -d
node scripts/whatsapp-link.mjs
```

The linking script waits for Evolution to finish starting before its first authenticated read. A Docker container marked Started may still be running migrations; the compose health check reports readiness separately. To wait explicitly, use `docker compose -f compose.evolution.yaml up -d --wait --wait-timeout 180`. If a later connection drops, rerun the link command; mutations are not automatically replayed.

Setup is idempotent and has already been run locally. It generates random private keys in ignored `.local/evolution.env` and `apps/api/.env`. It keeps existing model/WhatsApp modes. The compose file pins Evolution v2.3.8, which fixes sessions that remain open but stop receiving messages, binds port 8080 to localhost, and persists the linked session and an independent connector PostgreSQL database. Docker pulls the images on first run. Wait for the connector to become available before running the link script. `docker compose -f compose.evolution.yaml ps` shows its state.

The link script creates the `osman` instance, subscribes to MESSAGES_UPSERT and MESSAGES_UPDATE, installs an authenticated webhook and refreshes `.local/whatsapp-qr.png` for up to ten minutes. Open that image from Explorer while the script runs. On the phone containing the number to connect, choose **WhatsApp → Linked devices → Link a device**, then scan the image. The script reports connected and removes the QR image; if it times out, rerun for a fresh code. It does not print API secrets/pairing codes or send messages. Treat the QR as a login credential and do not share it.

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

### Local HTTPS inspection certificates

If Evolution stays connecting and returns only `count: 0`, check HTTPS access from inside its container. A machine using antivirus/corporate HTTPS inspection may require its trusted root CA inside Docker too. Put a PEM bundle of the required public root certificates in ignored `.local/certs/extra-ca.pem`, run `node scripts/whatsapp-setup.mjs`, then recreate with `docker compose -f compose.evolution.yaml up -d --wait --wait-timeout 180`. Setup adds NODE_EXTRA_CA_CERTS only when this bundle exists, and Compose mounts it read-only. TLS verification stays enabled; do not use NODE_TLS_REJECT_UNAUTHORIZED=0. This is a local trust configuration, not an application credential, and must not be copied into a production environment with a different certificate chain.

The local Docker callback is `http://host.docker.internal:4000/webhooks/evolution`. The connector sends the private `x-webhook-secret` header. This route bypasses browser Origin checks only because it verifies that header, selected provider and instance. Each message/receipt is persisted with its unique WhatsApp ID and a pg-boss job in one transaction, then follows the same debounce, advisory lock, state machine, staff notifications and outbound provider as Meta. Client text is not logged.

In another hosting arrangement set EVOLUTION_CALLBACK_URL before pairing, for example `https://osman-api.alothmanlaw.sa/webhooks/evolution`. EVOLUTION_URL must be the connector base URL reachable by the API. The Render Blueprint now includes this private, always-on connector and persistent pairing disk. Its private hostport is normalized by the API; the browser never receives the connector API key. Do not copy the local Docker-host callback into production.

Direct chats are accepted with either a real phone identity or WhatsApp's opaque private ID (`@lid`). Client.waAddress stores the delivery address separately; Client.phone remains null when WhatsApp does not supply a phone alias. Private IDs are never treated as phone numbers. Both agent and staff replies use the actual delivery address. The dashboard identifies these clients as حساب واتساب until a name/phone becomes available; forwarding a secretary message that requires a phone number is blocked with guidance when none is known. Groups, self messages, reactions and history-sync events do not trigger agent replies. Attachments retain the staff-handoff policy and the staff composer retains its 24-hour limit. Verify receiving after reconnect/restart before rollout.

## Concurrent conversations

AGENT_CONCURRENCY=10 starts ten independent conversation workers and ten inbox workers. Each worker fetches one job; each chat retains its own history and memory. PostgreSQL advisory locks serialize work within one conversation. Busy chat jobs are deferred instead of occupying the workers needed for other clients. Settings reads reuse the conversation transaction's connection so concurrent agents do not each wait for a second database connection. Provider rate limits and latency still apply; queues retain work and exhausted agent failures route to staff. Provision the database connection pool for the configured concurrency and other API work.

A database-backed test holds ten simulated agent requests at a barrier until all ten are running, then verifies ten separate replies to private-ID senders, isolated histories, one model call per chat and non-blocking busy-chat deferral. This does not send real WhatsApp messages or claim a ten-request production OpenRouter load test.

To stop the connector without deleting its session: `docker compose -f compose.evolution.yaml stop`. To stop real sends in the dashboard: set WA_PROVIDER=mock and restart the API, and/or disable the agent in Settings. Do not delete connector volumes as a routine restart.

## Connected session but no new messages

The WhatsApp `open` state and an HTTP-healthy container do not prove that new messages are arriving. Evolution 2.3.8 fixes a Baileys status-acknowledgment problem that can hold incoming messages while the session still appears open. This project pins that release. Before updating a previously paired connector, preserve its PostgreSQL backup and instances volume; keep the local CA mount and webhook authentication intact. Do not log webhook/message bodies during diagnostics. Verify a new plain text message reaches the connector, dashboard inbox and agent response separately. A heart reaction is ignored and an emoji-only message may intentionally receive no reply under the intake policy.

Automatic blue read receipts are disabled in the connector settings. Check the dashboard for receipt instead of using blue ticks as the bot health indicator. In a human/urgent/waiting_schedule chat the bot remains silent by design; use إعادة إلى عثمان when staff intentionally returns that chat to the agent.

## Sources

- [Evolution instance creation/QR implementation](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/controllers/instance.controller.ts)
- [Evolution v2.3.7 release and reconnect/private-ID changes](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7)
- [Evolution v2.3.8: open sessions that stop receiving messages](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.8)
