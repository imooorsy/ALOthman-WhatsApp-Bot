'use strict';
// Connector to Evolution API. Field names differ between Evolution versions: the text
// format is chosen by EVOLUTION_TEXT_FORMAT, and the media, presence and status shapes
// below must be confirmed on the test number with the pinned version (task T026).
const { createHash } = require('node:crypto');
const PHONE_JID = /^\d{7,16}@s\.whatsapp\.net$/;
// WhatsApp's private id of a sender, when the provider gave no phone number with the message
// (seen on 16 November 2026 with Evolution v2.3.7: remoteJid "…@lid", remoteJidAlt undefined).
const LID_JID = /^\d{5,24}@lid$/;
// What Evolution takes as the recipient: the digits of a phone number, or a private id whole
// (its createJid keeps an address with "@lid" as it is). Null for anything else.
const recipient = (jid) => (PHONE_JID.test(jid) ? jid.split('@')[0] : LID_JID.test(jid) ? jid : null);
class Evolution {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  // maxBytes: the largest answer read; a larger one is abandoned before it fills the memory.
  async request(route, body, timeoutMs = 10000, maxBytes = null) {
    const c = this.config;
    if (!c.evolutionUrl || !c.evolutionKey || !c.instance) throw new Error('evolution_not_configured');
    const base = new URL(c.evolutionUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('invalid_evolution_url');
    const controller = new AbortController();
    const response = await this.fetcher(`${c.evolutionUrl.replace(/\/$/, '')}${route}/${encodeURIComponent(c.instance)}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), controller.signal]), redirect: 'error',
      headers: { apikey: c.evolutionKey, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // A 4xx answer is a refusal: the request was not carried out (error.refused). Anything else
    // that fails leaves it unknown whether it was.
    if (!response.ok) throw Object.assign(new Error(`evolution_http_${response.status}`), { refused: response.status >= 400 && response.status < 500 });
    if (!maxBytes || !response.body) return response.json();
    if (Number(response.headers?.get?.('content-length')) > maxBytes) { controller.abort(); throw new Error('media_size'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) { controller.abort(); throw new Error('media_size'); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  format() {
    const format = this.config.evolutionTextFormat || 'textMessage';
    if (!['textMessage', 'text'].includes(format)) throw new Error('unsupported_evolution_format');
    return format;
  }
  state() { return this.request('/instance/connectionState'); }
  // The WhatsApp number linked to the instance, digits only, or '' when Evolution does not say.
  // Evolution v2 lists the instance with ownerJid; v1 with instance.owner.
  async owner(timeoutMs = 10000) {
    const c = this.config;
    if (!c.evolutionUrl || !c.evolutionKey || !c.instance) throw new Error('evolution_not_configured');
    const base = new URL(c.evolutionUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('invalid_evolution_url');
    const response = await this.fetcher(`${c.evolutionUrl.replace(/\/$/, '')}/instance/fetchInstances?instanceName=${encodeURIComponent(c.instance)}`, {
      method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { apikey: c.evolutionKey, 'Content-Type': 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`evolution_http_${response.status}`), { refused: response.status >= 400 && response.status < 500 });
    const list = [].concat(await response.json() || []).map((item) => (item && item.instance) || item).filter(Boolean);
    const found = list.find((item) => [item.name, item.instanceName].includes(c.instance));
    return String((found && (found.ownerJid || found.owner)) || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  }
  // The text goes out at once. The typing pause is kept by the caller, so that it can
  // still cancel the reply; a delay handed to the provider cannot be cancelled.
  send(jid, text) {
    const number = recipient(jid);
    if (!number) throw new Error('unsupported_recipient');
    return this.request('/message/sendText', this.format() === 'text' ? { number, text, linkPreview: false } : { number, textMessage: { text }, linkPreview: false });
  }
  // Shows "typing..." to the client for `ms`. Best effort: a failure changes nothing.
  presence(jid, ms) {
    const number = recipient(jid);
    if (!number) return Promise.resolve(null);
    const delay = Math.max(0, Math.min(15000, Math.round(ms)));
    return this.request('/chat/sendPresence', this.format() === 'text' ? { number, delay, presence: 'composing' } : { number, options: { delay, presence: 'composing' } }, 5000 + delay);
  }
  // The attachment of a received message, by the message id the provider gave us. The answer
  // carries the file in base64: it is read up to a third more than maxBytes, and no further.
  media(messageId, { maxBytes = 25 * 1024 * 1024 } = {}) {
    if (typeof messageId !== 'string' || !/^[\w.-]{4,128}$/.test(messageId)) throw new Error('unsupported_message_id');
    return this.request('/chat/getBase64FromMediaMessage', { message: { key: { id: messageId } }, convertToMp4: false }, 30000,
      Math.ceil(maxBytes * 4 / 3) + 65536);
  }
}
// A video is kept like a document: fetched within the size limit and shown to the staff.
const KINDS = { audioMessage: 'voice', imageMessage: 'image', documentMessage: 'document', documentWithCaptionMessage: 'document', videoMessage: 'video', ptvMessage: 'video' };
// The longest client text kept: a longer one is cut here, and marked.
const MAX_TEXT = 4000;
// Delivery statuses as WhatsApp numbers them, when they come as numbers.
const STATUS_NAMES = ['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'];
// Wrappers around the real message, in Evolution v1 and v2 (WhatsApp's own names).
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'];
const unwrap = (message) => {
  let m = message || {};
  for (let i = 0; i < 4; i++) { const w = WRAPPERS.find(k => m[k]?.message); if (!w) break; m = m[w].message; }
  return m;
};
// The size the sender's app declared, in bytes: a number, a numeric string, or a 64-bit
// { low, high } value. Null when absent.
function declaredSize(value) {
  const n = value && typeof value === 'object' ? (Number(value.high) || 0) * 2 ** 32 + (Number(value.low) >>> 0) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
// What a shared location or contact card says, as the staff read it: «موقع: …», «جهة اتصال: …».
// They are kept for the staff; the assistant does not read them (server/engine.js).
function sharedText(message) {
  const location = message.locationMessage || message.liveLocationMessage;
  if (location) {
    const where = [location.name, location.address].filter(v => typeof v === 'string' && v.trim()).join('، ');
    const point = Number.isFinite(location.degreesLatitude) && Number.isFinite(location.degreesLongitude) ? `${location.degreesLatitude}, ${location.degreesLongitude}` : '';
    return `موقع: ${[where, point && `(${point})`].filter(Boolean).join(' ') || 'غير محدد'}${location.caption ? ` — ${location.caption}` : ''}`;
  }
  const cards = message.contactMessage ? [message.contactMessage] : message.contactsArrayMessage?.contacts || null;
  if (cards) {
    const one = (card) => [card?.displayName, /^TEL[^:\n]*:([^\n\r]+)/m.exec(String(card?.vcard || ''))?.[1]?.trim()].filter(Boolean).join(' ');
    return `${cards.length > 1 ? 'جهات اتصال' : 'جهة اتصال'}: ${cards.map(one).filter(Boolean).join('، ') || 'دون اسم'}`;
  }
  return '';
}
// A short, stable mark of a text: an edit delivered twice is one edit.
const mark = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 10);

// One message event of messages.upsert, send.message or messages.edited.
function messageEvent(d, instance, { editedEvent = false } = {}) {
  let message = unwrap(d.message || (d.editedMessage ? { protocolMessage: { editedMessage: d.editedMessage } } : null));
  // A deleted message names the one it deletes; an edit carries the new text, which is read
  // as the client's message; a reaction or a sticker is kept for the staff, never answered.
  // Any other protocol message (a setting, a sync) is nothing the client wrote.
  const protocol = message.protocolMessage;
  let edited = editedEvent;
  if (protocol) {
    if (protocol.editedMessage) { message = unwrap(protocol.editedMessage); edited = true; }
    else if (protocol.type === undefined || Number(protocol.type) === 0 || protocol.type === 'REVOKE') {
      return { type: 'revoke', instance, id: String(d.key?.id || ''), target: String(protocol.key?.id || ''),
        jid: String(d.key?.remoteJid || ''), fromMe: d.key?.fromMe === true };
    } else return null;
  }
  const reaction = message.reactionMessage ? String(message.reactionMessage.text || '') : message.stickerMessage ? 'ملصق' : null;
  // An edit changes the words only: the file came with the first message.
  const kind = edited ? null : Object.keys(KINDS).find(k => message[k]);
  const part = kind ? message[kind] : null;
  const caption = message.conversation || message.extendedTextMessage?.text
    || Object.keys(KINDS).map(k => message[k]?.caption).find(v => typeof v === 'string' && v) || '';
  const shared = reaction === null && !kind && !caption ? sharedText(message) : '';
  const text = String(reaction ?? (caption || shared));
  const type = reaction !== null ? 'reaction' : kind ? KINDS[kind] : shared ? 'unsupported' : text ? 'text' : 'unsupported';
  const seconds = Number(d.messageTimestamp?.low ?? d.messageTimestamp);
  // WhatsApp may identify the sender by a private id (@lid). The phone number, when the
  // provider gives it beside the id, is the address the conversation is kept under.
  const remote = String(d.key?.remoteJid || d.remoteJid || '');
  const alternate = [d.key?.remoteJidAlt, d.key?.senderPn, d.senderPn].map(v => String(v || '')).find(v => PHONE_JID.test(v));
  const useAlternate = remote.endsWith('@lid') && Boolean(alternate);
  const key = String(d.key?.id || d.keyId || d.id || '');
  return { type, instance, id: edited && key ? `${key}-edit-${mark(text)}` : key, jid: useAlternate ? alternate : remote,
    lid: remote.endsWith('@lid') ? remote : null, ...(edited ? { edited: true } : {}),
    fromMe: (d.key?.fromMe ?? d.fromMe) === true, text: text.slice(0, MAX_TEXT), ...(text.length > MAX_TEXT ? { truncated: true } : {}),
    // An edit may come without a time of its own: it is now.
    at: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : edited ? Date.now() : NaN,
    name: typeof d.pushName === 'string' ? d.pushName.slice(0, 80) : '',
    media: part ? { kind: type, mimetype: typeof part.mimetype === 'string' ? part.mimetype.slice(0, 100) : null,
      fileName: typeof part.fileName === 'string' ? part.fileName.slice(0, 200) : null,
      seconds: Number.isFinite(part.seconds) ? part.seconds : null, size: declaredSize(part.fileLength) } : null };
}

// The provider's later report on a message: delivered, read, failed, or deleted by the client.
// Evolution v2 names the message keyId; v1 sends the key's own fields (id, remoteJid, fromMe).
function statusEvent(d, instance) {
  const id = String(d.keyId || d.key?.id || d.id || '');
  const raw = d.status ?? d.update?.status ?? '';
  const status = Number.isInteger(raw) || /^\d$/.test(String(raw)) ? STATUS_NAMES[Number(raw)] || '' : String(raw);
  if (!id || !status) return null;
  if (status.toUpperCase() === 'DELETED') return deleteEvent(d, instance);
  return { type: 'status', instance, id, status };
}
function deleteEvent(d, instance) {
  const target = String(d.keyId || d.key?.id || d.id || '');
  return target ? { type: 'revoke', instance, id: `${target}-deleted`, target, jid: String(d.remoteJid || d.key?.remoteJid || ''), fromMe: (d.fromMe ?? d.key?.fromMe) === true } : null;
}

function normalizeEvent(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const event = String(payload.event || '').toLowerCase().replaceAll('_', '.');
  const items = [].concat(payload.data || []).filter(Boolean);
  if (event === 'connection.update') return [{ type: 'connection', instance: payload.instance, state: payload.data?.state || 'unknown' }];
  if (event === 'messages.update') return items.map(d => statusEvent(d, payload.instance)).filter(Boolean);
  if (event === 'messages.delete') return items.map(d => deleteEvent(d, payload.instance)).filter(Boolean);
  if (event === 'messages.edited') return items.map(d => messageEvent(d, payload.instance, { editedEvent: true })).filter(Boolean);
  if (!['messages.upsert', 'send.message'].includes(event)) return [];
  return items.map(d => messageEvent(d, payload.instance)).filter(Boolean);
}
module.exports = { Evolution, normalizeEvent, MAX_TEXT };
