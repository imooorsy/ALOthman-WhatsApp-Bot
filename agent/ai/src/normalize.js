'use strict';

// Normalization of Arabic text and of digits, used to compare two copies of the same
// text (ai/DESIGN.md section 10).
//
// The characters are named by code point: several of them are invisible, or combine
// with the letter before them, and would not be readable here.

const char = String.fromCodePoint;

// A pattern that matches any character of the given ranges of code points.
// A range is [from, to]; a single character is [code].
function anyOf(...ranges) {
  return new RegExp(`[${ranges.map(([from, to = from]) => `${char(from)}-${char(to)}`).join('')}]`, 'g');
}

const ARABIC_INDIC_ZERO = 0x0660; // digits U+0660..U+0669
const PERSIAN_ZERO = 0x06F0; // digits U+06F0..U+06F9
const ARABIC_INDIC_DIGITS = anyOf([ARABIC_INDIC_ZERO, ARABIC_INDIC_ZERO + 9]);
const PERSIAN_DIGITS = anyOf([PERSIAN_ZERO, PERSIAN_ZERO + 9]);

// Fathatan to sukun and the marks after them, the superscript alef, and the tatweel.
const DIACRITICS_AND_TATWEEL = anyOf([0x064B, 0x065F], [0x0670], [0x0640]);
// Zero-width characters and the marks that set the direction of the text.
const INVISIBLE_MARKS = anyOf([0x200B, 0x200F], [0x202A, 0x202E], [0x2066, 0x2069]);
// Alef with madda, with hamza above, with hamza below, and alef wasla.
const ALEF_FORMS = anyOf([0x0622], [0x0623], [0x0625], [0x0671]);
const TA_MARBUTA = anyOf([0x0629]);
const ALEF_MAQSURA_AND_FARSI_YA = anyOf([0x0649], [0x06CC]);
const ALEF = char(0x0627);
const HA = char(0x0647);
const YA = char(0x064A);

// Arabic-Indic and Persian digits become Western digits.
function toWesternDigits(text) {
  return String(text == null ? '' : text)
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.codePointAt(0) - ARABIC_INDIC_ZERO))
    .replace(PERSIAN_DIGITS, (digit) => String(digit.codePointAt(0) - PERSIAN_ZERO));
}

// Every run of white space becomes one space, and the ends are trimmed. Nothing else changes.
function normalizeSpaces(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

// Comparison form of a text: without diacritics, tatweel, spaces or invisible marks, with
// one form of alef, of ta marbuta and of ya, and with Western digits.
function normalizeText(text) {
  return toWesternDigits(text)
    .replace(DIACRITICS_AND_TATWEEL, '')
    .replace(/\s/g, '')
    .replace(INVISIBLE_MARKS, '')
    .replace(ALEF_FORMS, ALEF)
    .replace(TA_MARBUTA, HA)
    .replace(ALEF_MAQSURA_AND_FARSI_YA, YA);
}

// True when the two texts are the same after normalization. An empty text equals nothing.
function sameText(a, b) {
  const left = normalizeText(a);
  return left !== '' && left === normalizeText(b);
}

// True when one text contains the other after normalization. An empty text matches nothing.
function textMatches(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  return left !== '' && right !== '' && (left.includes(right) || right.includes(left));
}

module.exports = { toWesternDigits, normalizeSpaces, normalizeText, sameText, textMatches };
