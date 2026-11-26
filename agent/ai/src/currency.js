'use strict';

// A claim stated in another currency, in riyals at the day's rate (knowledge base 4.4), so that its
// card's threshold decides it as it decides an amount in riyals (ai/DESIGN.md 6.4.2).
//
// The model only reads the amount in its own currency and names the currency
// (amount_foreign_min, amount_foreign_max, amount_foreign_code); the code converts it. A currency
// pegged to the dollar has its fixed rate (config/triage.json, currencies). Any other needs the
// day's table that the server reads (server/rates.js) and passes in env.rates:
//   { date: 'YYYY-MM-DD', sar: { CODE: riyals for one unit }, source }
// Without a rate, or with the currency unclear, nothing is converted, and the team decides.

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Riyals for one unit of `code`: { rate, date, source } or null.
function sarPerUnit(code, triage, rates) {
  const cfg = (triage && triage.currencies) || {};
  const peg = cfg.pegged_per_usd && cfg.pegged_per_usd[code];
  if (isNumber(peg) && peg > 0 && isNumber(cfg.sar_per_usd)) return { rate: cfg.sar_per_usd / peg, date: null, source: 'peg' };
  const value = rates && rates.sar && rates.sar[code];
  if (isNumber(value) && value > 0) return { rate: value, date: rates.date || null, source: rates.source || 'table' };
  return null;
}

// The extracted amount when it is in another currency: { min, max, conversion }, min and max in
// riyals (null when not converted), or null for an amount in riyals or none.
// conversion: { code, foreign_min, foreign_max, rate, date, source } when converted, and
// { code, foreign_min, foreign_max, failed } when not: unclear_currency, no_rate or no_amount.
function convertAmount(extracted, triage, rates) {
  if (!extracted || extracted.amount_currency !== 'other') return null;
  const min = isNumber(extracted.amount_foreign_min) ? extracted.amount_foreign_min : null;
  const max = isNumber(extracted.amount_foreign_max) ? extracted.amount_foreign_max : null;
  const code = typeof extracted.amount_foreign_code === 'string' && extracted.amount_foreign_code ? extracted.amount_foreign_code : null;
  const base = { code, foreign_min: min, foreign_max: max };
  if (min === null && max === null) return { min: null, max: null, conversion: { ...base, failed: 'no_amount' } };
  if (!code) return { min: null, max: null, conversion: { ...base, failed: 'unclear_currency' } };
  const found = sarPerUnit(code, triage, rates);
  if (!found) return { min: null, max: null, conversion: { ...base, failed: 'no_rate' } };
  const toSar = (value) => (value === null ? null : Math.round(value * found.rate));
  return { min: toSar(min), max: toSar(max), conversion: { ...base, rate: found.rate, date: found.date, source: found.source } };
}

module.exports = { sarPerUnit, convertAmount };
