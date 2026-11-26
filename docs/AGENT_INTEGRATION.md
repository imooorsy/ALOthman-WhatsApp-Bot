# Agent integration

The proposed contract is in `packages/shared/src/index.ts`. Every response is validated with a strict Zod schema. History contains client, assistant and staff text with ISO timestamps; non-text messages use `[attachment]`. Requests include all fixed office knowledge and the current `config.version`. Agents must be stateless and must not connect to the database. The dashboard owns message delivery, routing, settings and staff notifications.

## Mock mode

`AGENT_MODE=mock` is the default. Keywords `موظف`, `عاجل`, `خارج النطاق`, and `موعد` exercise handoff, urgent, unsuitable and completed; other input continues. These are pipeline fixtures, not the office's legal rules. The supplied DOCX acceptance scenarios are for the engineer's real agent and are not implemented as legal reasoning here.

## Node or TypeScript in process

### Delivered agent

The supplied code is CommonJS Node.js with no npm dependencies. Use these values in **apps/api/.env**:

```dotenv
AGENT_MODE=inprocess
AGENT_MODULE=../../agent/dashboard-adapter.cjs
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=<private key, only on the API>
OPENROUTER_MODEL=openai/gpt-6-luna
AGENT_REASONING=low
AGENT_TIMEOUT_MS=20000
AGENT_RETRIES=1
```

Restart the API after changing env. The existing Settings → إعدادات الوكيل switch still stops all model calls. The engineer's `MODEL_PROVIDER=anthropic` example default cannot run this conversation-agent path: `converse` is implemented on the OpenRouter provider. The engineer's comments identify `openai/gpt-6-luna`; its current availability and structured-output support were verified on [OpenRouter](https://openrouter.ai/openai/gpt-6-luna). At the user's request, the local API now selects inprocess mode and that model; OPENROUTER_API_KEY is present but empty for the user to fill. WhatsApp remains mock until QR login. Missing credentials fail into the existing audited human handoff; no external AI call is attempted without a key. The setup script prepared private connector secrets without activating real WhatsApp sends.

The integration calls the engineer's OpenRouter request builder, strict schema, reply guard, memory helpers and plain-text team summary. It does not instantiate Engine, Store, Auth or Evolution from the supplied standalone application. This avoids duplicate sends, separate staff accounts and JSON-file storage. Actions map as follows: ask/answer → continue; refer/existing_client → human; urgent → urgent; book → waiting_schedule; decline/job/marketing → not_suitable; close/silent → human so an unanswered client is visible to the team. A decline remains unsuitable even if marked urgent. An explicit urgent priority/status also triggers urgent handoff for other actions.

The optional JSON `state` contract extension is bounded to 100,000 characters and JSON values only. Conversation.agentState stores the fact sheet, question counters and previous record in PostgreSQL; the next call receives it. The adapter has no database access or cross-conversation memory. Agent state is omitted from staff chat responses. Existing mock/HTTP agents may omit it. `pnpm db:migrate` installs the checked-in migration.

Dashboard settings are appended as the current authority on every call. The reply guard uses current service prices/contact numbers instead of the stale source allowlist. Every guard failure is rejected, retried by AgentService, and audited as agent_error if exhausted. Additional adapter checks cover a win-guarantee phrase missed by the source guard. These checks are deterministic checks, not a guarantee that all legal or factual mistakes are detectable. The supplied legal policy and its specialized case thresholds remain in ai/prompts/office.md; do not assume one dashboard minimum-claim value replaces every specialized legal rule without agreement with the engineer. Review prompt changes using the office's acceptance cases.

See [AGENT_REVIEW.md](AGENT_REVIEW.md) for findings and remaining live checks. The supplied package refers to tests/evaluation scripts that are absent from the delivered folder; the dashboard integration tests use deterministic OpenRouter fixtures, including persisted memory across two turns. A live `pnpm test:agent-contract` in inprocess mode makes billed model requests and requires the real key and model. The original mock contract check remains available without credentials.

Place the engineer's code under `agent/`, build it independently, and export a default object (or named `agent`) with `async respond(request)`. Set `AGENT_MODE=inprocess` and `AGENT_MODULE=../../agent/index.js`, resolved from the API working directory `apps/api`. Production runs from the same directory. Adapt only the thin API adapter if the engineer uses a different export signature. Do not edit the agent internals.

## Python or another HTTP runtime

Place the agent and its Dockerfile under `agent/`. Expose a private `POST /respond` accepting AgentRequest JSON and returning AgentResponse JSON. Require `x-agent-api-key`; use the same AGENT_API_KEY as the API. Set `AGENT_MODE=http` and AGENT_URL to the private service base URL including the port. The supplied Python server is an explicit unimplemented placeholder returning 503 until replaced by the AI engineer's runtime.

## Validation and failures

For Evolution private-ID-only senders, AgentRequest.clientPhone is null; conversationId remains the stable request identity. Do not assume a public phone is always available or infer it from an opaque ID. Agent state/history remain separate per conversation. AGENT_CONCURRENCY defaults to 10, allowing independent conversations to call the model concurrently while serializing messages within each chat.

Run `pnpm test:agent-contract` with the desired mode configured in `apps/api/.env`. It runs sample requests against the selected adapter and checks the full shape without logging client text. No Meta credentials are needed. Default timeout is 20 seconds with one retry; invalid output, exceptions and timeouts route the chat to a human with an `agent_error` audit entry and notification. An in-process timeout cannot forcibly terminate third-party JavaScript; keep that code stateless and side-effect-free, or use HTTP for process isolation.

`GET /internal/agent-config` accepts `x-agent-api-key: <AGENT_API_KEY>` and returns the same settings snapshot. Leave the key empty to disable access. Fixed knowledge updates apply to the next call; outgoing replies record Message.agentConfigVersion.
