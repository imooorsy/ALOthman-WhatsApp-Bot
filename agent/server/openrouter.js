'use strict';
// A model reached through OpenRouter (the Chat Completions API): the understanding of a client
// message and the writing of a reply, with the instructions, the contract and the checks of
// server/providers.js. Chosen with MODEL_PROVIDER=openrouter (server/config.js). Like every model,
// it answers clients only after a full evaluation that every gate passed (server/evaluation.js).
// Tried on 15 and 16 November 2026 with openai/gpt-6-luna (tasks.md, T168).
//
// What differs from the Anthropic requests (openrouter.ai/docs and developers.openai.com, read on
// 15 November 2026):
// - the schema goes in OpenAI's strict form: every enum carries a type, so a choice that may be
//   null is a type array, and a boolean that may be null has no enum at all (typed);
// - the whole contract fits one request. Asked in two requests sent together, each answer is
//   shorter and comes sooner (MODEL_SPLIT);
// - reasoning.effort "none": reading one message needs no reasoning, which costs time;
// - provider.require_parameters: only an endpoint that takes every field of the request, the
//   schema among them, may serve it;
// - the maker caches the instructions on its own, for a while after their last use.
const { validate } = require('./schema');
const { system, schema, requestSchema, phrasePrompt, phraseSchema, turnPrompt, turnSchema } = require('./providers');
const { agentPrompt, agentSchema } = require('./agent');

const API = 'https://openrouter.ai/api/v1/chat/completions';
// One retry for a failure that says "try again later" (429, 5xx), only when the first attempt
// failed fast enough to leave time for a second inside the same timeout (as server/providers.js).
const RETRY_WITHIN_MS = 2000;
const RETRY_PAUSE_MS = 250;
const retryable = (status) => status === 429 || status >= 500;
// An answer that is not the contract's (not one JSON object, or cut short; seen on 15 November
// 2026 in about 8 requests of 500) is asked again once, when at least this much time is left.
const AGAIN_AT_LEAST_MS = 1500;
// The timer keeps the process alive (server/providers.js, pause).
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// The settings of every request besides the model's id. The evaluation records them with each
// model it measures, and a run covers a server only with the same ones (server/evaluation.js).
const REASONING = { effort: 'none' };
// How long the instructions stay cached after their last use (the maker's default). The server
// refreshes them before that (server/engine.js, keepWarm).
const CACHE_LIFE_MS = 30 * 60000;

// The schema as OpenAI's strict mode takes it.
function typed(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = { ...node };
  if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([name, child]) => [name, typed(child)]));
  if (out.items) out.items = typed(out.items);
  if (out.enum && out.type === undefined) {
    const kinds = [...new Set(out.enum.map((value) => (value === null ? 'null' : typeof value)))];
    out.type = kinds.length === 1 ? kinds[0] : kinds;
    if (kinds.every((kind) => kind === 'boolean' || kind === 'null')) delete out.enum;
  }
  return out;
}
// The two parts of the contract, for the two requests sent together. They are not Anthropic's
// two (server/providers.js, requestSchemas): there the list of answered questions closes the
// first part, and openai/gpt-6-luna, asked that way without reasoning, went on listing questions
// (the same id many times, or most of the catalog; measured on 16 November 2026 in eight
// scenarios). Here the list opens the second part, before `extracted`, as in the whole contract,
// where its answers were sound.
const { answered_questions: answeredSchema, extracted: extractedSchema, ...flagProperties } = requestSchema.properties;
const PARTS = {
  flags: { ...requestSchema, properties: flagProperties, required: requestSchema.required.filter((key) => Object.hasOwn(flagProperties, key)) },
  extracted: { type: 'object', additionalProperties: false, required: ['answered_questions', 'extracted'],
    properties: { answered_questions: answeredSchema, extracted: extractedSchema } },
};
// understanding: the whole contract. flags and extracted: its two parts. courtesy: the writing's
// choice of phrases.
const SCHEMAS = { understanding: typed(requestSchema), flags: typed(PARTS.flags), extracted: typed(PARTS.extracted), courtesy: typed(phraseSchema), turn: typed(turnSchema),
  // The conversation run by the model (server/agent.js).
  agent: typed(agentSchema) };
// Adds the numbers of one answer's usage to a total: the token counts, the cost the gateway
// states, and how many of the prompt's tokens were read from the cache.
function addUsage(total, usage) {
  for (const [key, value] of Object.entries(usage || {})) if (typeof value === 'number') total[key] = (total[key] || 0) + value;
  const cachedTokens = usage && usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens;
  if (typeof cachedTokens === 'number') total.cached_tokens = (total.cached_tokens || 0) + cachedTokens;
  return total;
}

class OpenRouterProvider {
  // config: { modelKey, model, phrasingModel, phrasing, modelSplit, modelTimeout, phrasingTimeout }
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; this.cacheLifeMs = CACHE_LIFE_MS; }
  // The requests of one understanding: the whole contract, or its two parts sent together.
  parts() { return this.config.modelSplit ? ['flags', 'extracted'] : ['understanding']; }
  body(model, instructions, name, content, maxTokens, reasoning = REASONING) {
    return JSON.stringify({ model, stream: false, max_tokens: maxTokens, reasoning, provider: { require_parameters: true },
      messages: [{ role: 'system', content: instructions }, { role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: SCHEMAS[name] } } });
  }
  async send(body, timeoutMs) {
    const response = await this.fetcher(API, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelKey}` }, body });
    if (!response.ok) throw Object.assign(new Error(`model_http_${response.status}`), { retryable: retryable(response.status) });
    const answer = await response.json();
    // The gateway may report the maker's failure inside an answer it sends with status 200.
    if (answer && answer.error) {
      const status = Number(answer.error.code) || 502;
      throw Object.assign(new Error(`model_http_${status}`), { retryable: retryable(status) });
    }
    return answer;
  }
  // One request, and its answer as an object.
  // `input`: an object, sent as its JSON text; or a list of content parts (text and files), sent as it is.
  async ask(model, instructions, name, input, maxTokens, timeoutMs, reasoning = REASONING) {
    const content = Array.isArray(input) ? input : JSON.stringify(input);
    const answer = await this.send(this.body(model, instructions, name, content, maxTokens, reasoning), timeoutMs);
    const choice = (answer.choices || [])[0] || {};
    if (choice.message && choice.message.refusal) throw new Error('model_refused');
    if (choice.finish_reason !== 'stop') throw Object.assign(new Error('model_incomplete'), { invalid: true });
    let object;
    try { object = JSON.parse(String((choice.message && choice.message.content) || '')); } catch { throw Object.assign(new Error('model_invalid_json'), { invalid: true }); }
    return { object, model: answer.model, usage: answer.usage || null, requestId: answer.id || null };
  }
  async understand(context) {
    const c = this.config;
    if (!c.modelKey || !c.model) throw new Error('model_not_configured');
    const start = Date.now();
    const answers = await Promise.all(this.parts().map((name) => this.part(name, context, start)));
    const flags = Object.assign({}, ...answers.map((answer) => answer.fields));
    if (validate(flags, schema).length) throw new Error('model_invalid_schema');
    const usage = answers.reduce((total, answer) => addUsage(total, answer.usage), {});
    return { flags, ms: Date.now() - start, model: answers[0].model, usage: Object.keys(usage).length ? usage : null,
      requestId: answers.map((answer) => answer.requestId).filter(Boolean).join(' ') || null,
      ...(answers.some((answer) => answer.retried) ? { retried: true } : {}) };
  }
  // One request of the understanding, asked again once inside the same timeout: after a failure
  // that says "try again later", or after an answer that is not the contract's. The reply's time
  // budget is not stretched, and a refused request or a timeout is never asked again.
  async part(name, context, start) {
    const c = this.config;
    try {
      return await this.partOnce(name, context, c.modelTimeout);
    } catch (error) {
      const spent = Date.now() - start;
      const wait = error.retryable ? RETRY_PAUSE_MS : 0;
      const left = c.modelTimeout - spent - wait;
      const again = error.retryable ? spent < RETRY_WITHIN_MS && left >= 500 : error.invalid === true && left >= AGAIN_AT_LEAST_MS;
      if (!again) throw error;
      if (wait) await pause(wait);
      return { ...(await this.partOnce(name, context, left)), retried: true };
    }
  }
  async partOnce(name, context, timeoutMs) {
    const out = await this.ask(this.config.model, system, name, context, 4096, timeoutMs);
    // Only the fields of this request are read from its answer.
    const fields = {};
    for (const key of Object.keys(SCHEMAS[name].properties)) if (out.object && Object.hasOwn(out.object, key)) fields[key] = out.object[key];
    return { fields, model: out.model, usage: out.usage, requestId: out.requestId };
  }
  // input: { draft, conversation: [{ role, text }], language, first_reply }. Returns the model's
  // choice { opening, thanks, lead }; the caller composes and checks the reply before sending it.
  // timeoutMs: what is left of the reply's time budget, at most PHRASING_TIMEOUT_MS.
  async phrase(input, { timeoutMs } = {}) {
    const c = this.config;
    const model = c.phrasingModel || c.model;
    if (!c.modelKey || !model) throw new Error('model_not_configured');
    const start = Date.now();
    const out = await this.ask(model, phrasePrompt, 'courtesy', { ...input, questions: input.questions || [] }, 600, timeoutMs || c.phrasingTimeout || 5000);
    if (validate(out.object, phraseSchema).length) throw new Error('model_invalid_schema');
    return { choice: out.object, ms: Date.now() - start, model: out.model };
  }
  // The reading of the client's reply to the questions he was asked (ai/prompts/turn.md).
  // input: { conversation: [{ role, text }], pending: [{ id, text }], message }. Returns
  // { turn: { pending: [{ id, status }], client_asks, about }, ms, model }. Not asked again: it
  // runs beside the understanding, and the flow judges by the words alone when it fails.
  async turn(input, { timeoutMs } = {}) {
    const c = this.config;
    if (!c.modelKey || !c.model) throw new Error('model_not_configured');
    const start = Date.now();
    const out = await this.ask(c.model, turnPrompt, 'turn', input, 300, timeoutMs || c.modelTimeout || 6000);
    if (validate(out.object, turnSchema).length) throw new Error('model_invalid_schema');
    return { turn: out.object, ms: Date.now() - start, model: out.model };
  }
  // The conversation run by the model (CONVERSATION=agent, server/agent.js): the office's file,
  // the server's contract and the conversation in; the reply and the record for the team out.
  // The model may reason first (AGENT_REASONING, low by default): it decides the whole next step,
  // not one message's flags. Not asked again here: the engine asks again once after a failure.
  // files: the attachments the client just sent, for the model to read (server/engine.js,
  // agentFiles): each after the conversation, an image as an image part and a PDF as a file part
  // (openrouter.ai/docs/features/multimodal/pdfs; the model reads PDFs itself, billed as input).
  async converse(input, { timeoutMs, files = [] } = {}) {
    const c = this.config;
    const model = c.agentModel || c.model;
    if (!c.modelKey || !model) throw new Error('model_not_configured');
    const start = Date.now();
    const effort = c.agentReasoning || 'low';
    const content = files.length ? [{ type: 'text', text: JSON.stringify(input) }, ...files.map((f) => (f.kind === 'pdf'
      ? { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${f.data}` } }
      : { type: 'image_url', image_url: { url: `data:${f.type};base64,${f.data}` } }))] : input;
    const out = await this.ask(model, agentPrompt, 'agent', content, c.agentMaxTokens || 4000, timeoutMs || c.agentTimeout || 20000, { effort });
    if (validate(out.object, agentSchema).length) throw Object.assign(new Error('model_invalid_schema'), { invalid: true });
    return { output: out.object, ms: Date.now() - start, model: out.model, usage: out.usage, requestId: out.requestId };
  }
  // Keeps the instructions in the maker's cache: each request of the understanding, and the
  // writing when the model writes, sent once as the real request is, with an empty message and
  // an answer cut after a few tokens that is not read. No client data goes in these requests.
  // When the model runs the conversation, its one request is the one kept warm.
  async warm({ timeoutMs = 30000 } = {}) {
    const c = this.config;
    if (!c.modelKey || !c.model) throw new Error('model_not_configured');
    const requests = c.conversation === 'agent' ? [[c.agentModel || c.model, agentPrompt, 'agent']] : this.parts().map((name) => [c.model, system, name]);
    if (c.phrasing !== false && c.conversation !== 'agent') requests.push([c.phrasingModel || c.model, phrasePrompt, 'courtesy']);
    const usage = {};
    await Promise.all(requests.map(async ([model, instructions, name]) => {
      addUsage(usage, (await this.send(this.body(model, instructions, name, '{}', 16), timeoutMs)).usage);
    }));
    return { requests: requests.length, usage: Object.keys(usage).length ? usage : null };
  }
}
module.exports = { OpenRouterProvider, typed, SCHEMAS, REASONING, CACHE_LIFE_MS, API, addUsage };
