# Delivered agent review

Reviewed the adapter-relevant request builder, configuration, schemas, prompt, guard, memory and summary functions, engine routing, Evolution transport and event normalization, startup and file-store boundaries. This is an integration review, not a claim that every legal acceptance scenario or every file in the standalone application was audited.

## Findings and handling

1. **Separate server and storage.** `server/start.js` starts the engineer's auth, file Store and Engine, including its own send/receive lifecycle. Starting it with this dashboard would split state and could duplicate bot replies. Our integration imports pure agent helpers/provider only; it never starts that server.
2. **Contract mismatch.** The engineer returns eleven actions and a detailed record rather than AgentResponse. The integration maps each action, checks the native schema and guard, and lets the dashboard validate the final shared schema. Silent/close go to staff rather than leaving a client unattended. Native referral coercion is retained.
3. **Memory needs persistence.** The native conversation keeps a fact sheet, asked counters and previous record. Discarding these per request breaks repetition controls. A checked-in migration adds backend-owned JSON state, returned to the otherwise stateless adapter each turn. Two-turn database tests check persistence and reuse.
4. **Conflicting fixed knowledge.** The static office prompt includes more specialized rules and services than the original dashboard defaults. Current settings are passed as overriding office data; current numbers/prices drive the guard. A static price removed from settings can now be rejected. The engineer should review representative legal scenarios and the priority of specialized thresholds before an office rollout; no legal rules were silently rewritten in the supplied code.
5. **Guard gaps.** The native guard accepted the Arabic phrase “أضمن لك كسب القضية” in an integration test. The wrapper rejects this family of win guarantees and has regression coverage. The original Engine also permits conduct-only guard failures on its last attempt; this integration instead rejects all guard failures and uses the dashboard's audited fallback. No keyword guard can establish semantic correctness of all model output.
6. **Provider/config mismatch.** The example defaults to Anthropic, but the model-driven conversation method exists on OpenRouterProvider. The engineer's comments name openai/gpt-6-luna, now verified against OpenRouter's current listing and selected locally as requested. The API-key field is still empty for the user to fill. No real model output is claimed or external model call made.
7. **Missing supplied tests.** `agent/package.json` references `ai/tests`, `server/tests` and live evaluation scripts absent from the delivered folder. Their evaluation results cannot be reproduced from this delivery. Integration tests were added to the dashboard's Jest suite; request the engineer's full test pack for policy-level acceptance.
8. **QR identity/session constraints.** The QR path is Evolution's WHATSAPP-BAILEYS integration. The original integration required a phone alias, which dropped private-ID-only senders; this is now corrected with a separate delivery address and nullable phone, preserving private IDs without fabricating E.164 numbers. AgentRequest.clientPhone can now be null. Group/self/history events remain ignored. Media is handed to staff; the standalone Engine's transcription/PDF/image processing is not enabled.

## Remaining live checks

- Supply an OpenRouter key and model ID, enable inprocess mode, and run the contract check plus representative Arabic office acceptance cases.
- Start Evolution, scan its QR from the intended phone, confirm the instance is open and webhook headers persist after restart.
- Test inbound text, bursts, an attachment, human takeover/send, delivery receipts, model failure, bot-off mode and private-ID senders using a test phone. The QR session must be online on an always-on host for production.
- Review Evolution's independent data retention/backups as well as the dashboard's PostgreSQL retention.
