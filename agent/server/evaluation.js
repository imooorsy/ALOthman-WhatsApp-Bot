'use strict';
// What the measured evaluation through the API covers, and whether one covers this server
// (tasks.md, phase 11): live replies need a complete run of `npm run eval:live`, passing every
// gate, made with what this server uses now: the models and the settings of their requests, the
// API version and the timeouts, the instructions, the schema, the reply texts and the rules, the
// code that reads the model's answers and builds the replies (ai/src, server/providers.js), the
// office data the model reads, and the datasets and graders that measured it. Any change to one of
// them needs a new run.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { system, phrasePrompt, schema, requestSchemas, requestSettings } = require('./providers');
// The office's file and the server's contract, which the model reads when it runs the conversation.
const { agentPrompt } = require('./agent');
const { loadReplies } = require('../ai/src/replies');
const rules = require('../config/qualification-rules.json');
const banned = require('../config/banned-phrases.json');
const triageConfig = require('../config/triage.json');
const officeProfile = require('../config/office-profile.json');

const ROOT = path.join(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'ai', 'tests', 'results', 'live-runs');
// The code between the model and the client: every file under ai/src, and the request layer
// (each provider's file).
const CODE = ['ai/src', 'server/providers.js', 'server/openrouter.js', 'server/agent.js'];
// What measured the model: the two datasets, their graders, and the runner that applies the gates.
const DATASETS = ['ai/tests/data/test-set-v2.json', 'ai/tests/data/office-scenarios.json', 'ai/tests/grade.js',
  'ai/tests/grade-scenarios.js', 'ai/tests/scenarios.js', 'ai/tests/make-eval-pack.js', 'scripts/live-eval.js'];
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// The fingerprint of what the office approves: the reply texts, the triage rules and prices, the
// banned phrases, the qualification rules and the instructions for writing replies, as this
// process loaded and uses them.
function contentHash(replies = loadReplies()) {
  const hash = createHash('sha256');
  // The office's file (ai/prompts/office.md) with the server's contract: what the model follows
  // when it runs the conversation (CONVERSATION=agent). Changing either asks for a new approval.
  for (const part of [replies, triageConfig, banned, rules, phrasePrompt, agentPrompt]) {
    hash.update(typeof part === 'string' ? part : JSON.stringify(part));
    hash.update('|');
  }
  return hash.digest('hex');
}

// The files under `paths` (a directory is read whole), sorted by their path from `root`, with "/".
function filesOf(paths, root = ROOT) {
  const found = [];
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    if (fs.statSync(absolute).isDirectory()) for (const name of fs.readdirSync(absolute)) visit(`${relative}/${name}`);
    else found.push(relative);
  };
  for (const p of paths) visit(p);
  return found.sort();
}

// One hash of those files: each path and its bytes.
function filesHash(paths, root = ROOT) {
  const hash = createHash('sha256');
  for (const relative of filesOf(paths, root)) {
    hash.update(relative).update('\0').update(fs.readFileSync(path.join(root, relative))).update('\0');
  }
  return hash.digest('hex');
}

const attempt = (read) => { try { return read(); } catch { return null; } };
// The code this process runs is read when it is loaded: a change on disk needs a restart, and a run.
const CODE_SHA256 = attempt(() => filesHash(CODE));
// The max_tokens of the requests, as server/providers.js writes them (the whole file is in the
// code fingerprint too).
const MAX_TOKENS = attempt(() => [...fs.readFileSync(path.join(__dirname, 'providers.js'), 'utf8')
  .matchAll(/max_tokens:\s*([^,}\s]+)/g)].map((m) => m[1]).join(',')) || null;

// The office data the model reads: the services lists, as the server sends them with every
// message (server/engine.js, context) and names them in the approved replies. The server passes
// the profile of its settings; the evaluation uses config/office-profile.json.
function officeData(profile = officeProfile) {
  const p = profile || {};
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  return { services: list(p.services), services_en: list(p.services_en) };
}

// The settings that go with each request to a model besides its id (requestSettings in
// server/providers.js, for the provider in use): a run records them for every model it measured.
// A model that gets none has {}, which a run may leave out.
const sameSettings = (recorded, c, model) => JSON.stringify(recorded || {}) === JSON.stringify(requestSettings(c, model) || {});

// How many requests one understanding takes: Anthropic's API always the two parts of the
// contract; OpenRouter two, or one with MODEL_SPLIT=off.
const understandingRequests = (c) => (c.modelProvider === 'openrouter' && !c.modelSplit ? 1 : Object.keys(requestSchemas).length);

// What a run must have been made with to cover a server with config `c`, the reply texts it
// loaded and the office profile it sends the model.
function fingerprints(c, replies, profile) {
  return {
    systemSha256: sha256(system), phraseSha256: sha256(phrasePrompt), schemaSha256: sha256(schema),
    contentSha256: contentHash(replies), provider: c.modelProvider || 'anthropic', understandingRequests: understandingRequests(c),
    apiVersion: c.modelVersion,
    codeSha256: CODE_SHA256, datasetSha256: attempt(() => filesHash(DATASETS)), officeSha256: sha256(officeData(profile)),
    maxTokens: MAX_TOKENS, modelTimeoutMs: c.modelTimeout, phrasingTimeoutMs: c.phrasingTimeout,
    // A run measured the code's triage: it covers no server whose model runs the conversation.
    conversation: c.conversation || 'agent',
  };
}

// The newest complete run that covers this server: { ok: true, run, model, at } or
// { ok: false, reason }. The writing model, its settings and its timeout must match only when
// the model writes the replies. `profile` is the office profile the server sends the model (its
// settings); without it, config/office-profile.json.
function findEvaluation(c, { dir = EVAL_DIR, replies, profile } = {}) {
  if (!c.model) return { ok: false, reason: 'no_model' };
  const writer = c.phrasing ? (c.phrasingModel || c.model) : null;
  const compared = Object.entries(fingerprints(c, replies, profile)).filter(([key]) => writer || key !== 'phrasingTimeoutMs');
  if (compared.some(([, value]) => value === null || value === undefined || Number.isNaN(value))) return { ok: false, reason: 'no_fingerprint' };
  let runs;
  try { runs = fs.readdirSync(dir); } catch { return { ok: false, reason: 'no_runs' }; }
  for (const run of runs.sort().reverse()) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, run, 'manifest.json'), 'utf8')); } catch { continue; }
    if (!m || !m.complete || !m.fullRun || compared.some(([key, value]) => m[key] !== value)) continue;
    const entry = (m.models || []).find((x) => x.model === c.model && x.gatesPassed === true && sameSettings(x.reasoning, c, c.model)
      && (!writer || (x.phrasingModel === writer && sameSettings(x.phrasingReasoning, c, writer))));
    if (entry) return { ok: true, run, model: entry.model, at: m.finishedAt || m.startedAt };
  }
  return { ok: false, reason: 'no_matching_run' };
}

module.exports = { EVAL_DIR, CODE, DATASETS, sha256, contentHash, filesOf, filesHash, officeData, fingerprints, findEvaluation };
