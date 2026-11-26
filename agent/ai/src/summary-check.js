'use strict';

// Check of the staff summary (ai/DESIGN.md section 9): every date, amount or name that
// the summary puts between « » must be in one of the client's messages, letter for letter.

const { normalizeSpaces } = require('./normalize');

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
// A quote can be a span within a message, but cannot start/end halfway through
// a word or number (for example, 5 inside 85 or a different person's name).
function containsSpan(message, quote) {
  if (quote === '') return false;
  for (let start = message.indexOf(quote); start !== -1; start = message.indexOf(quote, start + 1)) {
    const before = Array.from(message.slice(0, start)).at(-1) || '';
    const after = Array.from(message.slice(start + quote.length))[0] || '';
    const first = Array.from(quote)[0];
    const last = Array.from(quote).at(-1);
    if (!(WORD_CHAR.test(before) && WORD_CHAR.test(first))
      && !(WORD_CHAR.test(last) && WORD_CHAR.test(after))) return true;
  }
  return false;
}

// summary: the text the model wrote. clientMessages: the texts of the client's messages,
// voice transcripts included. Only white space is normalized before comparing.
// Returns { ok, missing }: `missing` lists, once each, the quotes found in no message.
function checkSummaryQuotes(summary, clientMessages) {
  const messages = (Array.isArray(clientMessages) ? clientMessages : [])
    .filter((message) => typeof message === 'string')
    .map(normalizeSpaces);
  const missing = [];
  const text = String(summary == null ? '' : summary);
  // A partial/nested quote must not disappear from the check just because the
  // extraction regexp below cannot recognize it as a complete quoted span.
  let opened = false;
  let malformed = false;
  for (const char of text) {
    if (char === '«') {
      if (opened) malformed = true;
      opened = true;
    } else if (char === '»') {
      if (!opened) malformed = true;
      opened = false;
    }
  }
  malformed ||= opened;
  for (const [, quote] of text.matchAll(/«([^«»]*)»/g)) {
    const wanted = normalizeSpaces(quote);
    const found = messages.some((message) => containsSpan(message, wanted));
    if (!found && !missing.includes(wanted)) missing.push(wanted);
  }
  return { ok: !malformed && missing.length === 0, missing, ...(malformed ? { malformed: true } : {}) };
}

module.exports = { checkSummaryQuotes, containsSpan };
