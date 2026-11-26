'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadReplies } = require('../ai/src/replies');

// Material for the human reviews in the dashboard: the 30 voice prompts, and the
// conversations of the reader pack with the approved reply texts. In live use the model writes
// each of these replies in its own words after they are checked (ai/DESIGN.md 4.5); the samples
// say so, so that a reviewer knows what the text shown is.
const APPROVED_NOTE = 'ملاحظة للمراجع: ردود المكتب هنا هي النصوص المعتمدة. في التشغيل يكتبها النموذج بكلام طبيعي على مقاس العميل بعد فحصها، والأسعار والأرقام لا تتغير.';
// Each part is optional: the prompts come from the spec (.specify/) and the samples from the
// tests (ai/tests/). A server deployed without them starts; the review pages show what is there.
function voicePrompts() {
  try {
    const file = fs.readFileSync(path.join(__dirname, '../.specify/specs/001-legal-whatsapp-agent/test-set.md'), 'utf8');
    return file.split(/\r?\n/).filter(line => /^\| ص\d+ \|/.test(line)).map(line => {
      const cells = line.split('|').slice(1, -1).map(s => s.trim());
      return { id: Number(cells[0].slice(1)), text: cells[1], condition: cells[2], expected: cells[3] };
    });
  } catch { return []; }
}
function samplesForReview() {
  try {
    const { transcripts, officeEnv } = require('../ai/tests/make-transcripts');
    const { selected } = require('../ai/tests/make-reader-pack');
    const env = officeEnv();
    return selected().map(c => ({ id: c.id, label: c.title.replace('محادثة ', ''), source: 'approved',
      text: `${APPROVED_NOTE}\n\n${transcripts([{ ...c, title: 'محادثة للمراجعة' }], env).split('\n\n').slice(2).join('\n\n')}` }));
  } catch { return []; }
}
function qaData() {
  return { voices: voicePrompts(), samples: samplesForReview(), replies: loadReplies().replies };
}
module.exports = { qaData };
