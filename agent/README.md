# Agent integration boundary

The delivered Node.js source is in `server/`, `ai/` and `config/`. Its original server, file storage and WhatsApp transport are not started by the dashboard. `dashboard-adapter.cjs` is our integration entry point; the engineer's internals remain unchanged. It receives history, versioned settings and backend-owned memory, and returns a validated response and updated memory without database access.

Use the dashboard's instructions in [AGENT_INTEGRATION.md](../docs/AGENT_INTEGRATION.md) and [WHATSAPP_QR.md](../docs/WHATSAPP_QR.md). Do not run `npm start` here alongside the dashboard: that starts a second independent bot. `placeholder_http.py` and its Dockerfile remain placeholders for a future HTTP runtime and are not needed for this Node agent.
