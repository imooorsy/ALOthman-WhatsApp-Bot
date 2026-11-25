# Agent integration

The proposed contract is in `packages/shared/src/index.ts`. Every response is validated with a strict Zod schema. History contains client, assistant and staff text with ISO timestamps; non-text messages use `[attachment]`. Requests include all fixed office knowledge and the current `config.version`. Agents must be stateless and must not connect to the database. The dashboard owns message delivery, routing, settings and staff notifications.

## Mock mode

`AGENT_MODE=mock` is the default. Keywords `موظف`, `عاجل`, `خارج النطاق`, and `موعد` exercise handoff, urgent, unsuitable and completed; other input continues. These are pipeline fixtures, not the office's legal rules. The supplied DOCX acceptance scenarios are for the engineer's real agent and are not implemented as legal reasoning here.

## Node or TypeScript in process

Place the engineer's code under `agent/`, build it independently, and export a default object (or named `agent`) with `async respond(request)`. Set `AGENT_MODE=inprocess` and `AGENT_MODULE=../../agent/index.js`, resolved from the API working directory `apps/api`. Production runs from the same directory. Adapt only the thin API adapter if the engineer uses a different export signature. Do not edit the agent internals.

## Python or another HTTP runtime

Place the agent and its Dockerfile under `agent/`. Expose a private `POST /respond` accepting AgentRequest JSON and returning AgentResponse JSON. Require `x-agent-api-key`; use the same AGENT_API_KEY as the API. Set `AGENT_MODE=http` and AGENT_URL to the private service base URL including the port. The supplied Python server is an explicit unimplemented placeholder returning 503 until replaced by the AI engineer's runtime.

## Validation and failures

Run `pnpm test:agent-contract` with the desired mode configured in `apps/api/.env`. It runs sample requests against the selected adapter and checks the full shape without logging client text. No Meta credentials are needed. Default timeout is 20 seconds with one retry; invalid output, exceptions and timeouts route the chat to a human with an `agent_error` audit entry and notification. An in-process timeout cannot forcibly terminate third-party JavaScript; keep that code stateless and side-effect-free, or use HTTP for process isolation.

`GET /internal/agent-config` accepts `x-agent-api-key: <AGENT_API_KEY>` and returns the same settings snapshot. Leave the key empty to disable access. Fixed knowledge updates apply to the next call; outgoing replies record Message.agentConfigVersion.
