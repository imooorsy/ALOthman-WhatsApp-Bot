'use strict';
// Voice notes as text, through an OpenAI-compatible /audio/transcriptions endpoint (OpenAI,
// Groq, a local Whisper server...): TRANSCRIBE_URL, TRANSCRIBE_API_KEY and TRANSCRIBE_MODEL.
// The text goes to the model like a written message. A note that cannot be heard clearly,
// or a failed call, is an unclear voice note: the client is asked for a short written summary
// (knowledge base 1.9), and the staff keep the recording.
const fs = require('node:fs');
const path = require('node:path');

// The largest file the common endpoints accept.
const MAX_BYTES = 25 * 1024 * 1024;
// The file name tells the endpoint the format; these are the ones it reads.
const EXTENSIONS = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'm4a' };
// The project's instructions for a transcript (as said, in the client's dialect, nothing
// guessed). Sent only with TRANSCRIBE_PROMPT=on, for a model that follows instructions: Whisper
// reads a prompt as earlier speech, and an Arabic one can turn an English note into Arabic.
const PROMPT = (() => { try { return fs.readFileSync(path.join(__dirname, '../ai/prompts/transcribe.md'), 'utf8').trim(); } catch { return ''; } })();
const UNCLEAR = /\[\s*غير واضح\s*\]/g;

// The endpoint: a base like https://api.openai.com/v1, or the full path to /audio/transcriptions.
function endpoint(url) {
  const base = new URL(url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('invalid_transcribe_url');
  return /\/audio\/transcriptions\/?$/.test(base.pathname) ? base.href : `${base.href.replace(/\/+$/, '')}/audio/transcriptions`;
}

// Nothing heard clearly: empty, only the marks of what was not heard, or the instructions read
// back (what Whisper may return for silence).
function unclear(text) {
  const left = String(text).replace(UNCLEAR, ' ').replace(/[\s\p{P}\p{S}]+/gu, '');
  return !left || Boolean(PROMPT && text.includes(PROMPT.split('\n')[0].trim()));
}

class Transcriber {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; this.url = endpoint(config.transcribeUrl); }
  // file: the stored attachment; contentType: its type. Returns { text, unclear }; throws a
  // short code when the call fails.
  async transcribe(file, contentType = 'audio/ogg') {
    const c = this.config;
    const data = await fs.promises.readFile(file);
    if (!data.length || data.length > MAX_BYTES) throw new Error('audio_size');
    const type = String(contentType || 'audio/ogg').split(';')[0].trim().toLowerCase();
    const form = new FormData();
    form.append('file', new Blob([data], { type }), `voice.${EXTENSIONS[type] || 'ogg'}`);
    form.append('model', c.transcribeModel);
    form.append('response_format', 'json');
    if (c.transcribeLanguage) form.append('language', c.transcribeLanguage);
    if (c.transcribePrompt && PROMPT) form.append('prompt', PROMPT);
    const response = await this.fetcher(this.url, { method: 'POST', body: form, redirect: 'error',
      signal: AbortSignal.timeout(c.transcribeTimeout || 15000),
      headers: c.transcribeKey ? { Authorization: `Bearer ${c.transcribeKey}` } : {} });
    if (!response.ok) throw new Error(`transcribe_http_${response.status}`);
    const body = await response.json();
    const text = String(body?.text ?? '').trim().slice(0, 20000);
    return { text, unclear: unclear(text) };
  }
}

module.exports = { Transcriber, endpoint, unclear, PROMPT };
