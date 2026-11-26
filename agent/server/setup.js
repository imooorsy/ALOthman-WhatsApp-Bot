'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { config, loadEnv } = require('./config');
const { Auth } = require('./auth');
loadEnv(); const c = config(); fs.mkdirSync(c.dir, { recursive: true });
const auth = new Auth(c.dir);
if (!auth.users.length) {
  const password = randomBytes(18).toString('base64url');
  auth.add({ username: 'admin', name: 'مسؤول المكتب', role: 'admin', password });
  fs.writeFileSync(path.join(c.dir, 'login.txt'), `Local dashboard account\nUsername: admin\nPassword: ${password}\n`, { mode: 0o600 });
  console.log('Admin account created. Read .local/login.txt on this device; the password is not printed.');
} else console.log('Existing accounts preserved.');
