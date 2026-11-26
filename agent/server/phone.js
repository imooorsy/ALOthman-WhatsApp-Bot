'use strict';
// A phone number as the office writes it, as the address WhatsApp uses.
const { toWesternDigits } = require('../ai/src/normalize');

// "+966 50 000 0001", "00966500000001", "0500000001", "500000001", "٠٥٠٠٠٠٠٠٠١" or a WhatsApp
// address: 966500000001@s.whatsapp.net. A local Saudi mobile number gets the country code.
// Null when the value is not a number.
function phoneJid(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{7,16}@s\.whatsapp\.net$/.test(raw)) return raw;
  let digits = toWesternDigits(raw).replace(/[\s()+.\-‎‏]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return /^[1-9]\d{6,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}

module.exports = { phoneJid };
