'use strict';
const { config, loadEnv } = require('./config');
const { Store, initialState } = require('./store');
const { Auth } = require('./auth');
const { FixtureProvider, PROVIDERS, providerFor } = require('./providers');
const { Evolution } = require('./evolution');
const { Transcriber } = require('./transcriber');
const { Engine } = require('./engine');
const { ExchangeRates } = require('./rates');
const { createApp } = require('./app');
loadEnv(); const c = config();
if (!['demo','live'].includes(c.mode)) throw new Error('APP_MODE must be demo or live');
if (!PROVIDERS.includes(c.modelProvider)) throw new Error('MODEL_PROVIDER must be anthropic or openrouter');
if (!['127.0.0.1','localhost'].includes(c.host) && !c.origin.startsWith('https:')) throw new Error('Remote access requires an HTTPS PUBLIC_ORIGIN and TLS reverse proxy');
const officeFile = require('../config/office-profile.json');
const store = new Store(c.dir, initialState(officeFile));
// The office's data reached config/ after this store was created: it is loaded once,
// unapproved, and the admin approves it from the settings page.
if (!store.data.settings.profile.office_name && officeFile.office_name) {
  store.data.settings.profile = structuredClone(officeFile); store.data.settings.officeApproved = false;
  store.audit('النظام', 'office_profile_loaded');
}
const auth = new Auth(c.dir);
if (!auth.users.length) { console.error('Run npm run setup first.'); process.exit(1); }
const transport = new Evolution(c);
// Voice notes become text when a transcription service is configured (server/transcriber.js);
// without one, a voice note gets a request for a short written summary.
const transcriber = c.mode === 'live' && c.transcribeUrl && c.transcribeModel ? new Transcriber(c) : null;
const engine = new Engine(store, c, c.mode === 'demo' ? new FixtureProvider() : providerFor(c), transport, transcriber);
// The day's exchange rates, read once a day, for an amount in another currency (server/rates.js).
if (process.env.RATES_URL && process.env.RATES_URL.trim().toLowerCase() !== 'off' && c.ratesUrl !== process.env.RATES_URL) console.error('RATES_URL is neither an https address nor "off": the public table is used.');
engine.fx = c.ratesUrl ? new ExchangeRates({ dir: c.dir, url: c.ratesUrl, maxAgeDays: require('../config/triage.json').currencies.rates_max_age_days }).start() : null;
const server = createApp({ store, config: c, engine, auth, transport });
// What this restart found (server/store.js) is with the staff now, and alerted: replies it
// interrupted, attachment downloads it cut, files it could not read or write.
if (store.loadedFrom === 'backup') console.error('The state file was damaged; the backup copy was loaded.');
engine.afterRestart();
// One failing step never ends the process: it is logged and alerted, and the server goes on.
// An exception nobody caught leaves the process in an unknown state: it is logged and alerted,
// the state is saved if it can be, and the process ends for the supervisor to restart it.
process.on('unhandledRejection', (error) => { console.error('Unhandled rejection:', error); try { engine.alert('internal_error'); } catch {} });
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  try { engine.alert('internal_error'); store.save(); } catch {}
  process.exit(1);
});
const interval = setInterval(() => { try { engine.tick(); } catch (error) { console.error('Tick failed:', error); } }, 30000); interval.unref();
server.listen(c.port,c.host,() => {
  console.log(`Local: ${c.origin} (${c.mode})`);
  if (c.mode === 'live') {
    // Live replies need a measured run through the API of these models and texts (server/evaluation.js).
    const evaluation = engine.evaluation();
    console.log(evaluation.ok ? `Live evaluation: ${evaluation.run} (${evaluation.model})`
      : c.trialNumber ? 'Live evaluation: none covers these models and texts. TRIAL: the assistant answers only while the test number (TRIAL_NUMBER) is the one linked.'
        : 'Live evaluation: none covers these models and texts; the assistant will not answer. Run npm run eval:live.');
    console.log(transcriber ? `Voice notes: transcribed with ${c.transcribeModel}.` : 'Voice notes: no transcription service; the client is asked for a short written summary.');
    // Who runs the conversation (server/agent.js): the model with the office's file, or the code's triage.
    console.log(c.conversation === 'agent' && typeof engine.provider.converse === 'function'
      ? `Conversation: run by ${c.agentModel || c.model} (reasoning ${c.agentReasoning}) with the office's file ai/prompts/office.md; every reply checked before it is sent.`
      : `Conversation: the code's triage (ai/src/flow.js)${c.conversation === 'agent' ? '; this provider cannot run it (set MODEL_PROVIDER=openrouter)' : ''}.`);
    if (!c.alertWebhook) console.log('Alerts: no ALERT_WEBHOOK_URL; alerts show on the page only.');
    // The number's connection now, not at the first round of the timer.
    engine.checkConnection().then((connection) => console.log(`WhatsApp connection: ${connection.state}${connection.error ? ` (${connection.error})` : ''}`)).catch(() => {});
  }
});
// A stop writes what was kept in memory (read markers, a burst of messages) before it ends.
const stop = () => { clearInterval(interval); engine.fx?.stop(); engine.stop(); store.flush(); server.close(); };
process.on('SIGINT',stop); process.on('SIGTERM',stop);
