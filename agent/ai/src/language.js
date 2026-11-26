'use strict';

// The version of the replies (ai/DESIGN.md section 2): English when the client's last
// clear message is in English or in another language, Arabic otherwise.

function createLanguage() {
  return { last: null };
}

// lang: { last: 'ar' | 'en' | null }. A message whose language is unknown changes nothing.
function updateLanguage(lang, flags) {
  const language = flags && flags.language;
  if (language === 'ar') return { last: 'ar' };
  if (language === 'en' || language === 'other') return { last: 'en' };
  return { last: lang && lang.last ? lang.last : null };
}

function pickVersion(lang) {
  return lang && lang.last === 'en' ? 'english' : 'arabic';
}

module.exports = { createLanguage, updateLanguage, pickVersion };
