'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./schema');
const { normalizeFlags } = require('../ai/src/flags');
const { courtesySection, CHOICES } = require('../ai/src/phrase-check');
const schema = require('../ai/schema/understanding.schema.json');
const triage = require('../config/triage.json');
const replies = require('../config/approved-replies.json');
const prompt = fs.readFileSync(path.join(__dirname, '../ai/prompts/understand.md'), 'utf8');

// The question catalog the model marks as answered (ai/DESIGN.md section 3): each id with
// its Arabic text. It is appended to the instructions, which are cached by the provider.
const catalog = ['## كتالوج الأسئلة', '',
  ...Object.keys(triage.questions).map((id) => `- ${id}: ${replies.replies[id] ? replies.replies[id].variants[0].arabic : ''}`)].join('\n');
const system = `${prompt.trim()}\n\n${catalog}\n`;

// Adapting an approved reply to the client (ai/DESIGN.md section 4.5): the model chooses courtesy
// phrases from the list (the same list the check allows), and the code puts them around the
// approved sentences (composeCourtesy in ai/src/phrase-check.js), which it never changes.
const phrasePrompt = `${fs.readFileSync(path.join(__dirname, '../ai/prompts/phrase.md'), 'utf8').trim()}\n\n${courtesySection()}`;
// A nullable choice lists null among its values and has no type keyword, as in the understanding
// schema: the provider refuses an enum under a type array (HTTP 400, "Enum value ... does not
// match declared type", seen on 15 November 2026).
const nullable = (values) => ({ enum: [...values, null] });
const phraseSchema = { type: 'object', properties: {
  opening: { type: 'array', items: { type: 'string', enum: CHOICES.all } },
  thanks: nullable(CHOICES.thanks),
  lead: nullable(CHOICES.leads),
  // The message's questions in the model's own wording (ai/src/phrase-check.js, humanize): each
  // is checked by the code, and one that fails goes out in the office's wording.
  questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } },
    required: ['id', 'text'], additionalProperties: false } },
}, required: ['opening', 'thanks', 'lead', 'questions'], additionalProperties: false };
// The reading of the client's reply to the assistant's questions (ai/prompts/turn.md): what became
// of each question he was asked, and whether he asked or objected. The flow acts on it (ai/src/
// flow.js, "a question is not left behind"): the project owner's decision of 16 November 2026 that
// the conversation has a mind, not only a path.
const turnPrompt = fs.readFileSync(path.join(__dirname, '../ai/prompts/turn.md'), 'utf8').trim();
const TURN_STATUS = ['answered', 'partly', 'not_answered', 'does_not_know', 'refused', 'later'];
const TURN_ASKS = ['nothing', 'what_we_meant', 'objection', 'about_office', 'legal_question', 'other'];
const turnSchema = { type: 'object', properties: {
  pending: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: TURN_STATUS } },
    required: ['id', 'status'], additionalProperties: false } },
  client_asks: { type: 'string', enum: TURN_ASKS },
  about: { type: 'string' },
}, required: ['pending', 'client_asks', 'about'], additionalProperties: false };
const API = 'https://api.anthropic.com/v1/messages';
// The schema as sent: its root annotations ("$schema", "title") are not structured-output
// keywords, and say nothing to the model. `schema` itself, as the evaluation fingerprints it
// (server/evaluation.js), stays as the file has it.
const { $schema: _version, title: _title, ...requestSchema } = schema;
// The provider compiles the schema of a request into a grammar, and refuses one that is too large
// (HTTP 400, "The compiled grammar is too large"). Measured on 15 November 2026 with Haiku 5.5:
// a request holds 72 units, where a property is one unit, a nullable number (a type array) two,
// a list three (measured: two and a half), and an object one more than its properties. The whole
// contract weighs about 92, so a message is understood in two requests sent together, with the
// same instructions: the top-level fields in one, `extracted` in the other. Their answers make
// the one object of the contract, which is validated whole.
const GRAMMAR_LIMIT = 72;
function grammarUnits(node) {
  if (!node || typeof node !== 'object') return 0;
  if (node.properties) return 1 + Object.values(node.properties).reduce((sum, child) => sum + grammarUnits(child), 0);
  if (node.type === 'array') return 3;
  return Array.isArray(node.type) || node.anyOf ? 2 : 1;
}
// What a request's schema weighs: its root object is not counted.
const grammarWeight = (root) => grammarUnits(root) - 1;
const { extracted: extractedSchema, ...flagProperties } = requestSchema.properties;
const requestSchemas = {
  flags: { ...requestSchema, properties: flagProperties, required: requestSchema.required.filter((key) => key !== 'extracted') },
  extracted: { type: 'object', additionalProperties: false, required: ['extracted'], properties: { extracted: extractedSchema } },
};
// The usage of the two requests, added up (the numbers only).
function sumUsage(list) {
  const known = list.filter(Boolean);
  if (!known.length) return null;
  const total = {};
  for (const usage of known) for (const [key, value] of Object.entries(usage)) if (typeof value === 'number') total[key] = (total[key] || 0) + value;
  return total;
}
// The instructions stay cached for an hour by default (config.promptCacheTtl): a quiet office
// still reads them from the cache, which is faster. "5m" is the provider's default.
const cached = (c) => ({ type: 'ephemeral', ...(c.promptCacheTtl === '1h' ? { ttl: '1h' } : {}) });
// One retry for a failure that says "try again later" (429 rate limit, 5xx, 529 overloaded),
// only when the first attempt failed fast enough to leave time for a second inside the same
// timeout: the reply's time budget is not stretched. A refused request (any other 4xx: an
// invalid request, a key, a model) is never retried, nor a timeout.
const RETRY_WITHIN_MS = 2000;
const RETRY_PAUSE_MS = 250;
const retryable = (status) => status === 429 || status >= 500;
// The timer keeps the process alive. Unreferenced, it let the evaluation (a script with nothing
// else pending) end without a word, with exit code 0, at the first answer that asked for a retry:
// seen on 15 November 2026 with another provider's 429.
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Reading one message needs no extended thinking, and thinking costs time and output tokens
// within max_tokens. How it is turned off depends on the model (Anthropic API, November 2026):
// Haiku 5.5 and Sonnet 5 accept "disabled" at effort high or below, Sonnet 5.5 takes
// "between_tools" instead, and Opus 5.5 and Fable always think, so they get the lowest effort.
// Older models think only when asked and may reject the effort setting, so they get neither.
function reasoningFor(model) {
  const id = String(model || '');
  if (/^claude-(haiku-5|sonnet-5$|sonnet-5-0)/.test(id)) return { thinking: { type: 'disabled' }, effort: 'low' };
  if (/^claude-sonnet-5-5/.test(id)) return { thinking: { type: 'between_tools' }, effort: 'low' };
  if (/^claude-(opus-5|fable-5|mythos-5)/.test(id)) return { effort: 'low' };
  return {};
}

class AnthropicProvider {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  // The two parts of the understanding (requestSchemas) are asked together; the message is
  // understood only when both answered, and their fields make a valid object of the contract.
  async understand(context) {
    const c = this.config;
    if (!c.modelKey || !c.model) throw new Error('model_not_configured');
    const start = Date.now();
    const answers = await Promise.all(Object.keys(requestSchemas).map((part) => this.understandPart(part, context, start)));
    const flags = Object.assign({}, ...answers.map((answer) => answer.fields));
    if (validate(flags, schema).length) throw new Error('model_invalid_schema');
    return { flags, ms: Date.now() - start, model: answers[0].model, usage: sumUsage(answers.map((answer) => answer.usage)),
      requestId: answers.map((answer) => answer.requestId).filter(Boolean).join(' ') || null,
      ...(answers.some((answer) => answer.retried) ? { retried: true } : {}) };
  }
  // One part, asked again once when the service said "try again later" and the time allows.
  async understandPart(part, context, start) {
    const c = this.config;
    try {
      return await this.understandOnce(part, context, c.modelTimeout);
    } catch (error) {
      const left = c.modelTimeout - (Date.now() - start) - RETRY_PAUSE_MS;
      if (!error.retryable || Date.now() - start >= RETRY_WITHIN_MS || left < 500) throw error;
      await pause(RETRY_PAUSE_MS);
      return { ...(await this.understandOnce(part, context, left)), retried: true };
    }
  }
  async understandOnce(part, context, timeoutMs) {
    const c = this.config;
    const { thinking, effort } = reasoningFor(c.model);
    const response = await this.fetcher(API, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', 'x-api-key': c.modelKey, 'anthropic-version': c.modelVersion },
      body: JSON.stringify({ model: c.model, max_tokens: 4096,
        ...(thinking ? { thinking } : {}),
        system: [{ type: 'text', text: system, cache_control: cached(c) }],
        messages: [{ role: 'user', content: JSON.stringify(context) }],
        output_config: { format: { type: 'json_schema', schema: requestSchemas[part] }, ...(effort ? { effort } : {}) } }),
    });
    if (!response.ok) throw Object.assign(new Error(`model_http_${response.status}`), { retryable: retryable(response.status) });
    const body = await response.json();
    if (body.stop_reason !== 'end_turn') throw new Error('model_incomplete');
    const answer = JSON.parse((body.content || []).filter(p => p.type === 'text').map(p => p.text).join(''));
    // Only the fields of this part are read from its answer.
    const fields = {};
    for (const key of Object.keys(requestSchemas[part].properties)) if (answer && Object.hasOwn(answer, key)) fields[key] = answer[key];
    return { fields, model: body.model, usage: body.usage || null, requestId: response.headers?.get?.('request-id') || null };
  }
  // input: { draft, conversation: [{ role, text }], language, first_reply }. Returns the model's
  // choice { opening, thanks, lead }; the caller composes and checks the reply before sending it.
  // timeoutMs: what is left of the reply's time budget, at most PHRASING_TIMEOUT_MS.
  async phrase(input, { timeoutMs } = {}) {
    const c = this.config;
    const model = c.phrasingModel || c.model;
    if (!c.modelKey || !model) throw new Error('model_not_configured');
    const start = Date.now();
    const { thinking, effort } = reasoningFor(model);
    const response = await this.fetcher(API, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs || c.phrasingTimeout || 5000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': c.modelKey, 'anthropic-version': c.modelVersion },
      body: JSON.stringify({ model, max_tokens: 600,
        ...(thinking ? { thinking } : {}),
        system: [{ type: 'text', text: phrasePrompt, cache_control: cached(c) }],
        messages: [{ role: 'user', content: JSON.stringify({ ...input, questions: input.questions || [] }) }],
        output_config: { format: { type: 'json_schema', schema: phraseSchema }, ...(effort ? { effort } : {}) } }),
    });
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    const body = await response.json();
    if (body.stop_reason !== 'end_turn') throw new Error('model_incomplete');
    const out = JSON.parse((body.content || []).filter(p => p.type === 'text').map(p => p.text).join(''));
    if (validate(out, phraseSchema).length) throw new Error('model_invalid_schema');
    return { choice: out, ms: Date.now() - start, model: body.model };
  }
  // Keeps the instructions of the requests in the provider's cache, with their schemas: the two
  // of the understanding, and the writing when the model writes. Each is sent once as the real
  // request is (the same model, settings, instructions and schema), with an empty message and an
  // answer of one token that is not read. A message that finds the instructions uncached waits
  // about six seconds instead of two and a half (measured on 15 November 2026), longer than the
  // model's timeout: the server calls this before the cache lapses (server/engine.js, keepWarm).
  // No client data goes in these requests.
  async warm({ timeoutMs = 30000 } = {}) {
    const c = this.config;
    if (!c.modelKey || !c.model) throw new Error('model_not_configured');
    const requests = Object.values(requestSchemas).map((part) => [c.model, system, part]);
    if (c.phrasing !== false) requests.push([c.phrasingModel || c.model, phrasePrompt, phraseSchema]);
    const usages = await Promise.all(requests.map(async ([model, instructions, format]) => {
      const { thinking, effort } = reasoningFor(model);
      const response = await this.fetcher(API, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-api-key': c.modelKey, 'anthropic-version': c.modelVersion },
        body: JSON.stringify({ model, max_tokens: 1,
          ...(thinking ? { thinking } : {}),
          system: [{ type: 'text', text: instructions, cache_control: cached(c) }],
          messages: [{ role: 'user', content: '{}' }],
          output_config: { format: { type: 'json_schema', schema: format }, ...(effort ? { effort } : {}) } }),
      });
      if (!response.ok) throw new Error(`model_http_${response.status}`);
      return (await response.json()).usage || null;
    }));
    return { requests: requests.length, usage: sumUsage(usages) };
  }
}
// The provider the settings name (config.modelProvider): Anthropic's API, or OpenRouter. The
// other file is loaded only when it is chosen.
const PROVIDERS = ['anthropic', 'openrouter'];
function providerFor(config, fetcher = fetch) {
  if (config.modelProvider === 'openrouter') return new (require('./openrouter').OpenRouterProvider)(config, fetcher);
  if (config.modelProvider && config.modelProvider !== 'anthropic') throw new Error('MODEL_PROVIDER must be anthropic or openrouter');
  return new AnthropicProvider(config, fetcher);
}
// The settings that go with each request to a model besides its id, as the provider in use sends
// them. The evaluation records them with each model, and a run covers a server only with the
// same ones (server/evaluation.js).
function requestSettings(config, model) {
  return config && config.modelProvider === 'openrouter' ? require('./openrouter').REASONING : reasoningFor(model);
}
// Only local canned QA conversations may use fixture flags. Free text is never
// passed through this provider in live mode.
class FixtureProvider {
  async understand(context) {
    if (!context.fixtureFlags) throw new Error('demo_fixture_only');
    return { flags: normalizeFlags(context.fixtureFlags), ms: 0, model: 'local-fixture' };
  }
}
module.exports = { AnthropicProvider, FixtureProvider, PROVIDERS, providerFor, requestSettings, prompt, system, catalog, schema, requestSchema, requestSchemas,
  GRAMMAR_LIMIT, grammarWeight, reasoningFor, phrasePrompt, phraseSchema, turnPrompt, turnSchema, TURN_STATUS, TURN_ASKS };
