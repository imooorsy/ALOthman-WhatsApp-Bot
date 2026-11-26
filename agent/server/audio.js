'use strict';
// Structural check of a recorded voice sample (WebM or Ogg, as browsers record them).
// It proves the file is a real audio container with audio in it and gives its length.
// It cannot prove that the speaker is a person: a human review stays necessary.

// ---- Ogg: a chain of pages, each "OggS" + header + segment table + data ----
function inspectOgg(data) {
  let offset = 0, pages = 0, lastGranule = 0n, codec = null, preSkip = 0;
  while (offset < data.length) {
    if (offset + 27 > data.length || data.toString('latin1', offset, offset + 4) !== 'OggS') return { ok: false };
    const granule = data.readBigInt64LE(offset + 6); const segments = data[offset + 26];
    if (offset + 27 + segments > data.length) return { ok: false };
    let size = 0; for (let i = 0; i < segments; i++) size += data[offset + 27 + i];
    const body = offset + 27 + segments;
    if (body + size > data.length) return { ok: false };
    if (pages === 0) {
      const head = data.toString('latin1', body, body + 8);
      if (head === 'OpusHead' && size >= 19) { codec = 'opus'; preSkip = data.readUInt16LE(body + 10); }
      else if (head.startsWith('\x01vorbis')) codec = 'vorbis';
      else return { ok: false };
    }
    if (granule > lastGranule) lastGranule = granule;
    pages++; offset = body + size;
  }
  if (pages < 3 || !codec) return { ok: false };
  // Opus counts 48000 samples a second; Vorbis uses its own rate, so its length is not derived here.
  const duration = codec === 'opus' ? Math.max(0, Number(lastGranule) - preSkip) / 48000 : null;
  return { ok: true, format: 'ogg', duration };
}

// ---- WebM: nested EBML elements, each an id, a size and a payload ----
const MASTERS = new Set([0x1A45DFA3, 0x18538067, 0x1F43B675, 0x1549A966, 0x1654AE6B, 0xAE, 0xA0]);
function vint(data, offset, keepMarker) {
  const first = data[offset]; if (first === undefined || first === 0) return null;
  let length = 1; while (!(first & (0x80 >> (length - 1)))) length++;
  if (offset + length > data.length) return null;
  let value = BigInt(keepMarker ? first : first & (0xFF >> length)); let ones = (first & (0xFF >> length)) === (0xFF >> length);
  for (let i = 1; i < length; i++) { value = (value << 8n) | BigInt(data[offset + i]); if (data[offset + i] !== 0xFF) ones = false; }
  return { length, value, unknown: !keepMarker && ones };
}
function inspectWebm(data) {
  let offset = 0, docType = null, audioTrack = false, codec = null, blocks = 0, scale = 1000000, clusterTime = 0, lastTime = 0;
  while (offset < data.length) {
    const id = vint(data, offset, true); if (!id || id.length > 4) return { ok: false };
    const size = vint(data, offset + id.length, false); if (!size) return { ok: false };
    const body = offset + id.length + size.length; const key = Number(id.value);
    if (MASTERS.has(key)) { offset = body; continue; } // entered, not skipped: its children follow
    if (size.unknown) return { ok: false };
    const end = body + Number(size.value); if (end > data.length) return { ok: false };
    const bytes = data.subarray(body, end);
    const uint = () => { let n = 0; for (const b of bytes) n = n * 256 + b; return n; };
    if (key === 0x4282) docType = bytes.toString('latin1');
    else if (key === 0x83 && uint() === 2) audioTrack = true;
    else if (key === 0x86) { const name = bytes.toString('latin1'); if (name === 'A_OPUS' || name === 'A_VORBIS') codec = name; }
    else if (key === 0x2AD7B1) scale = uint() || scale;
    else if (key === 0xE7) clusterTime = uint();
    else if (key === 0xA3 || key === 0xA1) {
      const track = vint(bytes, 0, false);
      if (track && bytes.length > track.length + 3) { blocks++; lastTime = Math.max(lastTime, clusterTime + bytes.readInt16BE(track.length)); }
    }
    offset = end;
  }
  if (!['webm', 'matroska'].includes(docType) || !audioTrack || !codec || blocks < 3) return { ok: false };
  return { ok: true, format: 'webm', duration: (lastTime * scale) / 1e9 };
}

// data: the uploaded bytes. declared: the length in seconds the browser reported.
// Returns { ok, format, duration } or { ok: false }.
function inspectAudio(data, declared) {
  if (!Buffer.isBuffer(data) || data.length < 200) return { ok: false };
  const result = data.subarray(0, 4).toString('latin1') === 'OggS' ? inspectOgg(data)
    : data.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3])) ? inspectWebm(data) : { ok: false };
  if (!result.ok) return { ok: false };
  // The audio in the file must be about as long as claimed. Blocks are 20 to 60 ms
  // apart, so the last time stamp sits slightly before the true end.
  if (result.duration !== null && Number.isFinite(declared)
    && Math.abs(result.duration - declared) > Math.max(2, declared * 0.35)) return { ok: false };
  return result;
}
module.exports = { inspectAudio };
