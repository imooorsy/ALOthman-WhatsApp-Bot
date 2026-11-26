'use strict';
// The day's exchange rates (knowledge base 4.4: an amount in another currency is converted to
// riyals at the day's rate, then the threshold decides; ai/src/currency.js converts it).
//
// Once a day the server reads a public table of rates and keeps it in .local/rates.json. The
// request carries nothing about a client: it is the same address for everyone. The conversation
// gets the riyal value of each currency (env.rates), only while the table is younger than
// currencies.rates_max_age_days (config/triage.json); without one, nothing is converted and the
// team decides. The currencies pegged to the dollar need no table (config/triage.json).
//
// Source: the open access of ExchangeRate-API (no key, a new table once a day). Its terms ask for
// attribution where the rates are shown: the record names it, and the dashboard links to it.
// RATES_URL replaces the address (a response of the same form); RATES_URL=off stops the reading.
const fs = require('node:fs');
const path = require('node:path');
const { writeAtomic, readError } = require('./files');

const DEFAULT_URL = 'https://open.er-api.com/v6/latest/USD';
const DAY = 86400000;
// How often the server checks whether a newer table is due; the service asks for no more than one
// request an hour, and publishes once a day.
const CHECK_MS = 3 * 3600000;
const RETRY_MS = 3600000;

// The source as the record names it.
const sourceName = (url) => {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)er-api\.com$|(^|\.)exchangerate-api\.com$/.test(host) ? 'ExchangeRate-API (www.exchangerate-api.com)' : host;
  } catch { return 'rates'; }
};

// The table of a response: { base, updatedAt, nextAt, sar: { CODE: riyals for one unit } }, or
// null when the response is not one. The riyal is pegged to the dollar at 3.75: a table that says
// otherwise is not trusted.
function parseTable(data, now = Date.now()) {
  if (!data || data.result !== 'success' || !data.rates || typeof data.rates !== 'object') return null;
  const rates = data.rates;
  const sarPerBase = rates.SAR;
  const usdPerBase = rates.USD;
  if (!(sarPerBase > 0) || !(usdPerBase > 0) || Math.abs(sarPerBase / usdPerBase - 3.75) > 0.05) return null;
  const updatedAt = Number(data.time_last_update_unix) * 1000;
  // A time in the future (or in another unit) would keep the table "fresh" for ever.
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > now + DAY) return null;
  const sar = {};
  for (const [code, perBase] of Object.entries(rates)) {
    if (!/^[A-Z]{3}$/.test(code) || typeof perBase !== 'number' || !(perBase > 0) || !Number.isFinite(perBase)) continue;
    // One unit of any currency is worth between a millionth of a riyal and 100,000 riyals: a
    // rate outside that is an error of the table, and that currency is left without a rate.
    const value = sarPerBase / perBase;
    if (value >= 1e-6 && value <= 1e5) sar[code] = value;
  }
  const nextAt = Number(data.time_next_update_unix) * 1000;
  return { base: data.base_code || null, updatedAt, nextAt: Number.isFinite(nextAt) && nextAt > updatedAt ? nextAt : updatedAt + DAY, sar };
}

class ExchangeRates {
  constructor({ dir, url = DEFAULT_URL, maxAgeDays = 3, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10000, log = console } = {}) {
    Object.assign(this, { url, maxAgeDays, fetchImpl, now, timeoutMs, log });
    this.file = dir ? path.join(dir, 'rates.json') : null;
    this.table = null; this.timer = null; this.failedAt = 0; this.refreshing = null;
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // A file without its times is read again at once.
      if (saved && saved.sar && Number.isFinite(saved.updatedAt)) this.table = { ...saved, nextAt: Number.isFinite(saved.nextAt) ? saved.nextAt : 0, fetchedAt: Number.isFinite(saved.fetchedAt) ? saved.fetchedAt : 0 };
    } catch (error) { this.log.error(`Exchange rates: ${readError(error)} in ${this.file}; a new table will be read.`); }
  }

  // A newer table is due: none yet, or the service's next one is out, or the last is a day old.
  due() {
    const now = this.now();
    if (this.failedAt && now - this.failedAt < RETRY_MS) return false;
    return !this.table || now >= this.table.nextAt || now - this.table.fetchedAt >= DAY;
  }

  // One reading at a time: a second call gets the first one's promise. It never rejects.
  refresh() {
    if (this.refreshing) return this.refreshing;
    const job = this.read();
    this.refreshing = job;
    job.finally(() => { if (this.refreshing === job) this.refreshing = null; });
    return job;
  }

  async read() {
    {
      try {
        const response = await this.fetchImpl(this.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const table = parseTable(await response.json(), this.now());
        if (!table) throw new Error('not a table of rates');
        this.table = { ...table, source: sourceName(this.url), fetchedAt: this.now() };
        this.failedAt = 0;
        if (this.file) {
          try { writeAtomic(this.file, JSON.stringify(this.table)); } catch (error) { this.log.error(`Exchange rates: could not be saved (${error.code || error.name}).`); }
        }
        return true;
      } catch (error) {
        this.failedAt = this.now();
        this.log.error(`Exchange rates: could not be read (${error.name === 'TimeoutError' ? 'timeout' : error.message}).`);
        return false;
      }
    }
  }

  // What the conversation is given (ai/src/currency.js): { date, sar, source }, or null when there
  // is no table younger than maxAgeDays.
  current() {
    const t = this.table;
    if (!t || this.now() - t.updatedAt > this.maxAgeDays * DAY) return null;
    return { date: new Date(t.updatedAt).toISOString().slice(0, 10), sar: t.sar, source: t.source };
  }

  // For /health: the table's date and age, never more.
  status() {
    const t = this.table;
    return { date: t ? new Date(t.updatedAt).toISOString().slice(0, 10) : null, ageHours: t ? Math.floor((this.now() - t.updatedAt) / 3600000) : null,
      fresh: Boolean(this.current()) };
  }

  start() {
    this.load();
    if (this.due()) this.refresh();
    this.timer = setInterval(() => { if (this.due()) this.refresh(); }, CHECK_MS);
    this.timer.unref?.();
    return this;
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { ExchangeRates, parseTable, sourceName, DEFAULT_URL };
