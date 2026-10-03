// Converts the two "Bluebook App Test Questions (With Answers)" PDFs into one tracked input for build-ptmap.cjs.
//
//   node tools/ptmap/extract-pdf.cjs
//
// Reads  tools/ptmap/sources/SAT {RW,Math} Bluebook App Test Questions (With Answers).pdf (needs poppler's pdftotext).
// Writes tools/ptmap/sources/bluebook-ids.csv: test,section,block,number,id,skill,difficulty,answer.
// Rows are keyed by the PDF's Test/M/Q column (SAT4 RW 2.13 = test 4, RW, block 2, question 13); the `order` column
// has typos and is ignored. Block 1 is module 1, 2 is module-2 easy, 3 is module-2 hard. IDs are written as printed:
// placeholders (xyz#####, abcd####) and SAT11's missing IDs are left for build-ptmap.cjs to judge.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { toCsv } = require('./merge.cjs');

const SRC = path.join(__dirname, 'sources');
const PDFS = [
  ['RW', 'SAT RW Bluebook App Test Questions (With Answers).pdf'],
  ['Math', 'SAT Math Bluebook App Test Questions (With Answers).pdf'],
];
const COUNT = { RW: 27, Math: 22 };
const DOMAINS = ['Craft & Structure', 'Information & Ideas', 'Standard English Conventions', 'Expression of Ideas',
  'Algebra', 'Advanced Math', 'Problem-Solving & Data Analysis', 'Geometry & Trigonometry', 'Geometry and Trigonometry'];
// order, optional 8-character ID, subject, domain + skill, optional difficulty, Test/M/Q, answer
const ROW = /^\s*\d+\s+(?:([0-9a-z]{8})\s+)?(Reading & Writing|Math)\s+(.+?)\s+(?:([123])\s+)?SAT(\d+) (RW|M) ([123])\.(\d+)\s+(\S.*?)\s*$/;

const errors = [];
const rows = [];
for (const [section, file] of PDFS) {
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  const text = execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const line of text.split('\n')) {
    if (!/SAT\d+ (RW|M) [123]\.\d+/.test(line)) continue;
    const m = ROW.exec(line);
    if (!m) { errors.push(`${section}: unparsed row: ${line.trim()}`); continue; }
    const [, id, subject, mid, diff, test, sec, block, number, answer] = m;
    if ((sec === 'RW') !== (section === 'RW') || (subject === 'Math') !== (section === 'Math')) errors.push(`${section}: row from the other section: ${line.trim()}`);
    const domain = DOMAINS.find(d => mid.startsWith(d + ' '));
    if (!domain) errors.push(`${section}: unknown domain: ${line.trim()}`);
    const skill = (domain ? mid.slice(domain.length) : mid).trim().replace(/^(?:Geometry and Trigonometry)\s+/, '');
    rows.push({ test: Number(test), section, block: Number(block), number: Number(number), id: id || '', skill,
      difficulty: diff || '', answer: answer.replace(/\s*,\s*/g, ', ') });
  }
}

// Every test x section x block must hold questions 1..COUNT exactly once.
const key = r => `${r.test}|${r.section}|${r.block}`;
const groups = new Map();
for (const r of rows) (groups.get(key(r)) || groups.set(key(r), []).get(key(r))).push(r);
for (const [k, g] of groups) {
  const want = COUNT[k.split('|')[1]];
  const nums = g.map(r => r.number).sort((a, b) => a - b);
  if (nums.length !== want || nums.some((n, i) => n !== i + 1)) errors.push(`${k.replace(/\|/g, ' ')}: numbers are ${nums.join(',')}, expected 1-${want}`);
}
const tests = [...new Set(rows.map(r => r.test))].sort((a, b) => a - b);
for (const t of tests) for (const s of ['RW', 'Math']) for (const b of [1, 2, 3])
  if (!groups.has(`${t}|${s}|${b}`)) errors.push(`SAT${t} ${s} block ${b}: no rows`);

rows.sort((a, b) => a.test - b.test || (a.section === b.section ? 0 : a.section === 'RW' ? -1 : 1) || a.block - b.block || a.number - b.number);
const cols = ['test', 'section', 'block', 'number', 'id', 'skill', 'difficulty', 'answer'];
fs.writeFileSync(path.join(SRC, 'bluebook-ids.csv'), toCsv(cols, rows));
console.log(`${rows.length} rows, tests ${tests.join(',')}; ${rows.filter(r => !r.id).length} without an ID`);
if (errors.length) { console.error(errors.map(e => 'FAIL: ' + e).join('\n')); process.exit(1); }
