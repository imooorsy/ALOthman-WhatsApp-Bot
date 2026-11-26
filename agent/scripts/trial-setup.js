'use strict';
// Prepares a trial on this machine with a test number (deploy/README.md, «تجربة على رقم تجريبي»):
// - deploy/trial/evolution.env: the settings of Evolution API and its database, with an API key
//   and a database password made here;
// - .env.local: the address, the instance name and the same API key for the assistant's server,
//   a webhook secret made here, the text format of Evolution v2, and live mode.
// No key, password or secret is printed, and one that already exists is kept. Run it again
// safely: it changes only what is missing or differs.
//
//   node scripts/trial-setup.js [--number <the test number, digits only>]
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');
const EVOLUTION_ENV = path.join(ROOT, 'deploy', 'trial', 'evolution.env');
const INSTANCE = 'elmaster-trial';
const secret = () => randomBytes(24).toString('hex');

// The settings of an env file as [name, value] lines, with the other lines kept as they are.
function readEnv(file) {
  if (!fs.existsSync(file)) return { lines: [], eol: '\n' };
  const raw = fs.readFileSync(file, 'utf8');
  return { lines: raw.split(/\r?\n/), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}
const valueOf = (lines, name) => {
  const line = lines.find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  return line === undefined ? undefined : line.replace(/^\s*[A-Z0-9_]+\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
};
// Sets `name` to `value`; `keep` leaves a value that is already there.
function setValue(lines, name, value, { keep = false } = {}) {
  const at = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  const current = valueOf(lines, name);
  if (at >= 0 && current && (keep || current === value)) return 'kept';
  if (at >= 0) { lines[at] = `${name}=${value}`; return current ? 'changed' : 'set'; }
  lines.push(`${name}=${value}`);
  return 'added';
}
function write(file, lines, eol) {
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(eol) + eol, { mode: 0o600 });
}

function main(argv = process.argv.slice(2)) {
  const number = argv[0] === '--number' ? String(argv[1] || '').replace(/[^\d]/g, '') : '';
  if (argv.length && (argv[0] !== '--number' || !/^\d{9,15}$/.test(number))) throw new Error('Usage: node scripts/trial-setup.js [--number <the test number with its country code, digits only>]');
  if (!fs.existsSync(ENV_LOCAL)) throw new Error('.env.local is missing: copy .env.example to .env.local first.');

  const local = readEnv(ENV_LOCAL);
  const evolution = readEnv(EVOLUTION_ENV);
  // One API key for both sides: the one the server already has, or the one Evolution has, or a new one.
  const apiKey = valueOf(local.lines, 'EVOLUTION_API_KEY') || valueOf(evolution.lines, 'AUTHENTICATION_API_KEY') || secret();
  const password = valueOf(evolution.lines, 'POSTGRES_PASSWORD') || secret();
  const report = {};

  const fixed = {
    SERVER_TYPE: 'http', SERVER_PORT: '8080', SERVER_URL: 'http://127.0.0.1:8080',
    // Nothing about this trial is reported to the maker of Evolution.
    TELEMETRY_ENABLED: 'false',
    // "*": Evolution refuses every request without an Origin header otherwise ("Not allowed by
    // CORS", seen on 16 November 2026), and the server's own requests carry none. Its port is
    // published on 127.0.0.1 only, and every request needs the API key.
    CORS_ORIGIN: '*', CORS_METHODS: 'GET,POST,PUT,DELETE', CORS_CREDENTIALS: 'true',
    // No DEBUG or WEBHOOKS level: those lines would carry the clients' messages into the logs.
    LOG_LEVEL: 'ERROR,WARN,INFO', LOG_COLOR: 'false', LOG_BAILEYS: 'error',
    DEL_INSTANCE: 'false',
    DATABASE_PROVIDER: 'postgresql', DATABASE_CONNECTION_CLIENT_NAME: 'elmaster_trial',
    // Kept by Evolution: the instance, and the messages it needs to hand a file over
    // (getBase64FromMediaMessage). Not kept: the phone's contacts, chats, labels and history.
    DATABASE_SAVE_DATA_INSTANCE: 'true', DATABASE_SAVE_DATA_NEW_MESSAGE: 'true', DATABASE_SAVE_MESSAGE_UPDATE: 'true',
    DATABASE_SAVE_DATA_CONTACTS: 'false', DATABASE_SAVE_DATA_CHATS: 'false', DATABASE_SAVE_DATA_LABELS: 'false',
    DATABASE_SAVE_DATA_HISTORIC: 'false', DATABASE_SAVE_IS_ON_WHATSAPP: 'false', DATABASE_DELETE_MESSAGE: 'true',
    CACHE_REDIS_ENABLED: 'false', CACHE_LOCAL_ENABLED: 'true',
    AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: 'false', LANGUAGE: 'en',
    CONFIG_SESSION_PHONE_CLIENT: 'Elmaster', CONFIG_SESSION_PHONE_NAME: 'Chrome', QRCODE_LIMIT: '30',
    WEBHOOK_GLOBAL_ENABLED: 'false', RABBITMQ_ENABLED: 'false', SQS_ENABLED: 'false', WEBSOCKET_ENABLED: 'false',
    PUSHER_ENABLED: 'false', KAFKA_ENABLED: 'false', TYPEBOT_ENABLED: 'false', CHATWOOT_ENABLED: 'false',
    OPENAI_ENABLED: 'false', DIFY_ENABLED: 'false', N8N_ENABLED: 'false', EVOAI_ENABLED: 'false', S3_ENABLED: 'false',
    POSTGRES_DB: 'evolution', POSTGRES_USER: 'evolution',
  };
  if (!evolution.lines.length) evolution.lines.push('# Evolution API for the trial (scripts/trial-setup.js). Holds a key and a password: keep it on this machine.');
  for (const [name, value] of Object.entries(fixed)) setValue(evolution.lines, name, value);
  report['evolution API key'] = setValue(evolution.lines, 'AUTHENTICATION_API_KEY', apiKey);
  report['database password'] = setValue(evolution.lines, 'POSTGRES_PASSWORD', password, { keep: true });
  setValue(evolution.lines, 'DATABASE_CONNECTION_URI', `postgresql://evolution:${password}@postgres:5432/evolution?schema=evolution_api`);
  write(EVOLUTION_ENV, evolution.lines, evolution.eol);

  report.EVOLUTION_URL = setValue(local.lines, 'EVOLUTION_URL', 'http://127.0.0.1:8080');
  report.EVOLUTION_INSTANCE = setValue(local.lines, 'EVOLUTION_INSTANCE', INSTANCE);
  report.EVOLUTION_API_KEY = setValue(local.lines, 'EVOLUTION_API_KEY', apiKey);
  report.EVOLUTION_TEXT_FORMAT = setValue(local.lines, 'EVOLUTION_TEXT_FORMAT', 'text');
  report.WEBHOOK_SECRET = setValue(local.lines, 'WEBHOOK_SECRET', secret(), { keep: true });
  report.APP_MODE = setValue(local.lines, 'APP_MODE', 'live');
  if (number) report.TRIAL_NUMBER = setValue(local.lines, 'TRIAL_NUMBER', number);
  write(ENV_LOCAL, local.lines, local.eol);

  console.log(`deploy/trial/evolution.env written. .env.local: ${Object.entries(report).map(([name, what]) => `${name} ${what}`).join(', ')}.`);
  console.log(`Instance: ${INSTANCE}. Next: docker compose -f deploy/trial/docker-compose.yml up -d`);
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main, INSTANCE };
