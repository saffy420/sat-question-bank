// Pure rules behind build-ptmap.cjs's PDF merge (tests: tests/test_ptmap.cjs). No file access here.
const { isRight } = require('../../public/shared/stats.js');

// ---- CSV (RFC 4180 subset: quoted fields may hold commas and doubled quotes) ----
const csvField = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(cols, rows) {
  return [cols.join(','), ...rows.map(r => cols.map(c => csvField(r[c])).join(','))].join('\n') + '\n';
}
function parseCsv(text) {
  const lines = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); lines.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); lines.push(row); }
  const [head, ...body] = lines;
  return body.map(r => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])));
}

// ---- PDF rows ----
const PLACEHOLDER = /^(xyz\d{5}|abcd\d{4})$/;
const BANK_ID = /^[0-9a-f]{8}$/;
const DIFFICULTY = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const MODULE_OF_BLOCK = { 1: 'm1', 2: 'easy', 3: 'hard' };

// The PDF's skill names next to the bank's: compare after folding case, '&' and punctuation, then through aliases.
const fold = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const SKILL_ALIAS = {
  'distributions': 'one variable data distributions and measures of center and spread',
  'probability': 'probability and conditional probability',
  'linear inequalities': 'linear inequalities in one or two variables',
  'systems of linear equations': 'systems of two linear equations in two variables',
  'nonlinear equations and systems': 'nonlinear equations in one variable',
  'nonlinear equations in one or two variables': 'nonlinear equations in one variable',
  'sample statistics and margin of error': 'inference from sample statistics and margin of error',
  'ratios rates proportions and units': 'ratios rates proportional relationships and units',
  'models and scatterplots': 'two variable data models and scatterplots',
  'observational studies': 'evaluating statistical claims observational studies and experiments',
};
const skillKey = s => SKILL_ALIAS[fold(s)] || fold(s);
const sameSkill = (pdf, bank) => skillKey(pdf) === skillKey(bank);

// One bank row as the build keeps it in sources/bank-check.json (from a normalized /api/questions row).
function bankFact(q) {
  return { section: q.section === 'Math' ? 'Math' : 'RW', skill: q.skill || '', difficulty: q.difficulty || '',
    answer: q.answer || '', spr: !!q.spr, letters: q.choices.map(c => String(c.letter || '').trim().toUpperCase()).join('') };
}
const asQuestion = f => ({ answer: f.answer, spr: f.spr, choices: f.letters.split('').map(letter => ({ letter })) });

// Does the PDF's printed answer agree with the bank's key? A grid-in may list several accepted forms ("30, -30");
// agreement is any form accepted; some-but-not-all is reported.
function answerCheck(fact, pdfAnswer) {
  const forms = String(pdfAnswer || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!forms.length) return { ok: null, why: 'no answer printed' };
  const q = asQuestion(fact);
  const got = forms.map(v => isRight(q, v));
  if (got.every(g => g === null)) return { ok: null, why: `bank answer is unscorable (bank ${fact.answer || 'blank'})` };
  if (!got.some(g => g === true)) return { ok: false, why: `answer: PDF ${pdfAnswer}, bank ${fact.answer}` };
  if (got.some(g => g !== true)) return { ok: true, why: `answer: bank ${fact.answer} accepts only some PDF forms (${pdfAnswer})` };
  return { ok: true, why: '' };
}

// Verdict for one PDF row: a usable bank ID, or null with the reason; warnings never block.
function validateRow(row, facts) {
  const id = row.id;
  if (!id) return { id: null, kind: 'blank', reasons: ['no ID printed'], warnings: [] };
  if (PLACEHOLDER.test(id)) return { id: null, kind: 'placeholder', reasons: [`${id} is a placeholder`], warnings: [] };
  if (!BANK_ID.test(id)) return { id: null, kind: 'reject', reasons: [`${id} is not a bank ID`], warnings: [] };
  const f = facts[id];
  if (!f) return { id: null, kind: 'reject', reasons: [`${id} is not in the bank`], warnings: [] };
  const reasons = [], warnings = [];
  if (f.section !== row.section) reasons.push(`${id} is a ${f.section} question`);
  const a = answerCheck(f, row.answer);
  if (a.ok === false) reasons.push(a.why); else if (a.why) warnings.push(a.why);
  if (row.skill && !sameSkill(row.skill, f.skill)) warnings.push(`skill: PDF "${row.skill}", bank "${f.skill}"`);
  const d = DIFFICULTY[row.difficulty];
  if (d && d.toLowerCase() !== String(f.difficulty).toLowerCase()) warnings.push(`difficulty: PDF ${d}, bank ${f.difficulty || 'none'}`);
  return reasons.length ? { id: null, kind: 'reject', reasons, warnings } : { id, kind: 'ok', reasons, warnings };
}

// Merge one module. `existing` is the export-built array (bank ID or null per position) or null when nobody exported
// it; `pdf` is the PDF's rows for that module by number (missing rows allowed). The exports win: a non-null existing ID
// is kept and a differing PDF ID is a conflict. A null or missing position is filled from a PDF row that validates.
function mergeModule(existing, pdf, facts, count) {
  const ids = [], events = [];
  let filled = 0;
  for (let n = 1; n <= count; n++) {
    const cur = existing ? (existing[n - 1] ?? null) : null;
    const row = pdf.find(r => Number(r.number) === n);
    const v = row ? validateRow(row, facts) : null;
    if (cur) {
      ids.push(cur);
      if (row && row.id && row.id !== cur) events.push({ n, kind: 'conflict', kept: cur, pdf: row.id, why: v.kind === 'ok' ? 'PDF ID differs; kept the export ID' : `PDF ID differs (${v.reasons.join('; ')}); kept the export ID` });
      else if (row && facts[cur]) {
        const a = answerCheck(facts[cur], row.answer);
        if (a.ok === false) events.push({ n, kind: 'crosscheck', kept: cur, pdf: row.id || '', why: a.why });
      }
      continue;
    }
    if (v && v.id) { ids.push(v.id); filled++; } else ids.push(null);
    if (v && v.kind !== 'ok' && v.kind !== 'blank') events.push({ n, kind: v.kind, pdf: row.id, why: v.reasons.join('; ') });
    if (v && v.id && v.warnings.length) events.push({ n, kind: 'warn', pdf: row.id, why: v.warnings.join('; ') });
  }
  const seen = new Map();
  ids.forEach((id, k) => { if (id) { if (seen.has(id)) events.push({ n: k + 1, kind: 'duplicate', pdf: id, why: `${id} also at #${seen.get(id)} in this module` }); else seen.set(id, k + 1); } });
  const anything = existing || ids.some(Boolean);
  return { ids: anything ? ids : null, filled, events };
}

module.exports = { toCsv, parseCsv, PLACEHOLDER, MODULE_OF_BLOCK, DIFFICULTY, skillKey, sameSkill, bankFact, answerCheck, validateRow, mergeModule };
