'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Replaces a file whole: the new content reaches the disk (fsync) under a temporary name, then
// takes the old one's place (rename), and the folder entry is synced where the system allows.
// A crash or a power cut leaves the old file or the new one, never half of one. Throws on a
// failed write; the caller decides what that means.
function writeAtomic(file, text, mode = 0o600) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', mode);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  syncFolder(path.dirname(file));
}

// The rename itself is made durable where the system allows syncing a folder (not on Windows).
function syncFolder(dir) {
  try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch {}
}

// Why a file could not be read, for the log: the error's kind and, for damaged JSON, where.
// Never the message itself: JSON.parse quotes the text around the fault, the clients' words.
function readError(error) {
  if (error instanceof SyntaxError) {
    const at = /position (\d+)/.exec(String(error.message))?.[1];
    return `invalid JSON${at ? ` at position ${at}` : ''}`;
  }
  return String(error?.code || error?.name || 'error');
}

module.exports = { writeAtomic, syncFolder, readError };
