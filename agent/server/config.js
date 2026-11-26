'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function loadEnv(file = path.join(ROOT, '.env.local')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
// The page's address as browsers send it in the Origin header: "https://name" with no path and
// no trailing slash. Written with one ("https://name/"), every login would be refused.
function originOf(value) {
  try { return new URL(value).origin; } catch { return String(value).replace(/\/+$/, ''); }
}
function config(env = process.env) {
  const port = Number(env.PORT || 3210);
  // Which service answers for the model: Anthropic's API, or OpenRouter (another maker's model,
  // server/openrouter.js). Each has its own key and model id; the rest of the server reads
  // modelKey and model whichever it is.
  const modelProvider = String(env.MODEL_PROVIDER || 'anthropic').trim().toLowerCase();
  const openrouter = modelProvider === 'openrouter';
  return { root: ROOT, dir: path.join(ROOT, '.local'), host: env.HOST || '127.0.0.1', port,
    origin: originOf(env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`), mode: env.APP_MODE || 'demo',
    // Set when the TLS reverse proxy runs on this machine: the client's address is then read
    // from the X-Forwarded-For header it adds (server/auth.js, clientIp).
    trustProxy: ['1', 'true', 'yes'].includes(String(env.TRUST_PROXY || '').toLowerCase()),
    evolutionUrl: env.EVOLUTION_URL || '', instance: env.EVOLUTION_INSTANCE || '', evolutionKey: env.EVOLUTION_API_KEY || '',
    evolutionTextFormat: env.EVOLUTION_TEXT_FORMAT || 'textMessage',
    webhookSecret: env.WEBHOOK_SECRET || '', modelProvider,
    // A trial on a test number (the project owner's decision of 16 November 2026): the number
    // of the test SIM, digits only with its country code. While that number is the one linked,
    // the assistant answers although no evaluation covers its model; linked to any other number
    // it does not (server/engine.js, status). Empty: no trial.
    trialNumber: String(env.TRIAL_NUMBER || '').replace(/[^\d]/g, ''),
    modelKey: (openrouter ? env.OPENROUTER_API_KEY : env.ANTHROPIC_API_KEY) || '', model: (openrouter ? env.OPENROUTER_MODEL : env.ANTHROPIC_MODEL) || '',
    // OpenRouter only: the understanding in one request (the default), or with MODEL_SPLIT=on in
    // two sent together. Measured on 16 November 2026 with openai/gpt-6-luna: two requests gained
    // nothing (the slower of the two decides, and more of them passed the timeout) and marked the
    // answered questions less well. Anthropic's API always takes two (server/providers.js).
    modelSplit: openrouter ? String(env.MODEL_SPLIT || 'off').trim().toLowerCase() === 'on' : true,
    // 6 seconds, as in limits.model_timeout_seconds (the project owner's decision of 16 November
    // 2026; it was 4): after it the client gets the welcome and is passed to the staff. With the
    // 3 seconds that gather the first messages, the welcome still arrives within 10 seconds.
    modelVersion: env.ANTHROPIC_VERSION || '2023-06-01', modelTimeout: Number(env.MODEL_TIMEOUT_MS || 6000),
    // The model writes each approved reply for the client in natural words (ai/DESIGN.md 4.5).
    // PHRASING=off sends the approved texts as they are. The writing model is the same model
    // unless PHRASING_MODEL names another; after PHRASING_TIMEOUT_MS the approved text is sent.
    phrasing: (env.PHRASING || 'on').toLowerCase() !== 'off', phrasingModel: env.PHRASING_MODEL || '',
    phrasingTimeout: Number(env.PHRASING_TIMEOUT_MS || 5000),
    // How the conversation is run (the project owner's decision of 18 November 2026): "agent", the
    // model with the office's file (ai/prompts/office.md, server/agent.js), the default; or "flow",
    // the code's triage built from the earlier knowledge base (ai/src/flow.js). The model runs it
    // only through a provider that can (OpenRouter); the local preview always uses the flow.
    conversation: String(env.CONVERSATION || 'agent').trim().toLowerCase() === 'flow' ? 'flow' : 'agent',
    // The model that runs it (the understanding's model unless AGENT_MODEL names another), how much
    // it reasons before answering, how long it may take, and how many replies one conversation gets.
    agentModel: env.AGENT_MODEL || '',
    agentReasoning: ['none', 'minimal', 'low', 'medium', 'high'].includes(String(env.AGENT_REASONING || '').toLowerCase()) ? String(env.AGENT_REASONING).toLowerCase() : 'low',
    agentTimeout: Number(env.AGENT_TIMEOUT_MS || 20000), agentMaxTokens: Number(env.AGENT_MAX_TOKENS || 4000),
    agentMaxReplies: Number(env.AGENT_MAX_REPLIES || 40),
    // How long the provider keeps the instructions cached between messages: an hour by default,
    // so that a quiet office still reads them from the cache (faster replies); "5m" for the
    // shorter, cheaper cache write.
    promptCacheTtl: env.PROMPT_CACHE_TTL === '5m' ? '5m' : '1h',
    // Optional: voice notes as text (server/transcriber.js). Without it a voice note is answered
    // with a request for a short written summary, and the staff keep the recording.
    // The gateway that serves the model also transcribes (POST /audio/transcriptions, the same
    // form): with its address and no key of its own, the model's gateway key is used, so the
    // secret is kept in one place.
    transcribeUrl: /^https?:\/\//.test(env.TRANSCRIBE_URL || '') ? env.TRANSCRIBE_URL : '',
    transcribeKey: env.TRANSCRIBE_API_KEY || (/^https:\/\/openrouter\.ai\//.test(env.TRANSCRIBE_URL || '') ? env.OPENROUTER_API_KEY || '' : ''),
    transcribeModel: env.TRANSCRIBE_MODEL || '', transcribeLanguage: env.TRANSCRIBE_LANGUAGE || '',
    transcribePrompt: ['1', 'on', 'true', 'yes'].includes(String(env.TRANSCRIBE_PROMPT || '').toLowerCase()),
    transcribeTimeout: Number(env.TRANSCRIBE_TIMEOUT_MS || 15000),
    // Where scripts/backup.js writes, and where /health looks for the last backup.
    backupDir: env.BACKUP_DIR || path.join(ROOT, 'backups'),
    // The day's exchange rates, for an amount in another currency (server/rates.js). RATES_URL
    // replaces the public table's address; "off" stops the reading (the pegged currencies still
    // convert, the others go to the team).
    ratesUrl: String(env.RATES_URL || '').trim().toLowerCase() === 'off' ? ''
      : /^https:\/\//.test(env.RATES_URL || '') ? env.RATES_URL : 'https://open.er-api.com/v6/latest/USD',
    // Optional: an address that receives a short alert (an Arabic "text" and its kind; no client
    // data) when the number disconnects, a delivery fails, or a request waits too long.
    alertWebhook: /^https?:\/\//.test(env.ALERT_WEBHOOK_URL || '') ? env.ALERT_WEBHOOK_URL : '' };
}
module.exports = { loadEnv, config, originOf, ROOT };
