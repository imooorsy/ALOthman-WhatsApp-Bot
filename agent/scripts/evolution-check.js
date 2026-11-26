'use strict';
const { loadEnv, config } = require('../server/config');
const { Evolution } = require('../server/evolution');
loadEnv();
new Evolution(config()).state().then(result => {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), state: result.instance?.state || result.state || 'unknown' }, null, 2));
}).catch(error => { console.error(`Connection check failed: ${error.message}. Set EVOLUTION_URL, EVOLUTION_INSTANCE and EVOLUTION_API_KEY in .env.local.`); process.exitCode = 1; });
