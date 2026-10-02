// Shared helpers for the Prepzy Desmos-solution pipeline (scrape.cjs -> map.cjs -> import.cjs).
// See tools/desmos/README.md. Nothing here touches the network or a database.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = __dirname;
const SNAPSHOT = path.join(ROOT, 'data', 'questions.snapshot.json');

// Our Math `skill` -> Prepzy testName, only where the names differ. Prepzy uses College Board's
// full skill name (read from its app bundle, 2026-10-02); the bank shortens this one.
const TEST_NAME = {
  'Nonlinear equations in one variable': 'Nonlinear equations in one variable and systems of equations in two variables'
};
const testNameOf = (skill) => TEST_NAME[skill] || skill;

// The banks, from the snapshot (docs/BOOTSTRAP.md) or from the local D1 files (--local). Each row
// keeps what matching needs: id, bank ('core' | 'ai'), section, skill, stem_html, choices_json.
function loadBank(argv = process.argv) {
  if (argv.includes('--local')) return localBank();
  const i = argv.indexOf('--bank');
  const file = i >= 0 ? argv[i + 1] : SNAPSHOT;
  if (!fs.existsSync(file)) throw new Error(`no bank at ${file}: fetch the snapshot (docs/BOOTSTRAP.md) or pass --local / --bank <file>`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  return rows.map(r => ({ id: r.id, bank: r.source === 'AI' ? 'ai' : 'core', section: r.section, skill: r.skill,
    stem_html: r.stem_html || '', choices_json: typeof r.choices_json === 'string' ? r.choices_json : JSON.stringify(r.choices_json || []) }));
}

// Same identification as tools/apply_ai.cjs: only the AI bank's `questions` has `level`, and two
// candidates of either kind means a stale file left behind by a database_id change.
function localBank() {
  const Database = require('better-sqlite3');
  const dir = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  const found = { core: [], ai: [] };
  for (const f of files) {
    const db = new Database(path.join(dir, f), { readonly: true });
    const cols = db.prepare('PRAGMA table_info(questions)').all().map(c => c.name);
    if (cols.length) found[cols.includes('level') ? 'ai' : 'core'].push(db); else db.close();
  }
  for (const k of ['core', 'ai']) if (found[k].length !== 1)
    throw new Error(`${found[k].length} local ${k} databases in ${dir}; expected exactly one (a database_id change leaves stale files)`);
  const out = [];
  for (const k of ['core', 'ai']) {
    for (const r of found[k][0].prepare('SELECT id, section, skill, stem_html, choices_json FROM questions').all())
      out.push({ ...r, bank: k, stem_html: r.stem_html || '', choices_json: r.choices_json || '[]' });
    found[k][0].close();
  }
  return out;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", minus: '-', times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠', pi: 'π', deg: '°', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...' };
// Strip HTML, convert &nbsp; and other entities, collapse whitespace. Our stems open with
// "<h3>Passage</h3>" / "<h3>Prompt</h3>" section labels that are not question text; they go too,
// as do <script>/<style> bodies and authored SVG text (axis labels would only add noise).
function plain(html) {
  return String(html || '')
    .replace(/<(script|style|svg|annotation)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h3>\s*(Passage|Prompt)\s*<\/h3>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? ' ')
    .replace(/[   ]/g, ' ')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ').trim();
}
// Words for comparison: lower case, letters and digits only. LaTeX commands (\frac, \left) are
// markup, not words, so they are dropped; their arguments stay.
const tokens = (html) => plain(html).toLowerCase().replace(/\\[a-z]+/g, ' ').match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [];

// Dice coefficient over token multisets: 1 for the same words, 0 for none in common.
function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const count = new Map();
  for (const t of a) count.set(t, (count.get(t) || 0) + 1);
  let shared = 0;
  for (const t of b) { const n = count.get(t); if (n) { shared++; count.set(t, n - 1); } }
  return (2 * shared) / (a.length + b.length);
}

// questionPreview's exact shape is not documented. Accept an HTML string, or an object whose
// stem sits under a stem/question/prompt/text/html key and whose choices are an array (of strings
// or of objects holding content/html/text) under a choices/options/answers key.
function previewParts(preview) {
  if (!preview) return { stem: '', choices: [] };
  if (typeof preview === 'string') return { stem: preview, choices: [] };
  const pick = (o, re) => Object.keys(o).find(k => re.test(k));
  const sk = pick(preview, /^(stem|stemHtml|stem_html|question|questionHtml|questionText|prompt|text|html)$/i);
  const ck = pick(preview, /^(choices|choicesHtml|options|answers|answerChoices)$/i);
  let stem = sk ? preview[sk] : '';
  if (stem && typeof stem === 'object') stem = stem.html || stem.text || stem.content || '';
  let choices = ck ? preview[ck] : [];
  if (typeof choices === 'string') choices = [choices];
  if (!Array.isArray(choices)) choices = Object.values(choices || {});
  choices = choices.map(c => typeof c === 'string' ? c : (c && (c.content || c.html || c.text || c.body || c.value)) || '');
  return { stem: String(stem || ''), choices: choices.map(String) };
}
function ourChoices(choicesJson) {
  try { const c = JSON.parse(choicesJson || '[]'); return Array.isArray(c) ? c.map(x => String(x && x.content || '')) : []; }
  catch { return []; }
}

// A state the embedded calculator can load: it names its version and draws at least one expression.
function stateProblems(state) {
  const bad = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['desmosState is not an object'];
  if (state.version === undefined || state.version === null || state.version === '') bad.push('no version');
  const list = state.expressions && state.expressions.list;
  if (!Array.isArray(list) || !list.length) bad.push('expressions.list is missing or empty');
  return bad;
}

// Any key that mentions an email, and anything shaped like an address, never reaches a file.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!/e-?mail/i.test(k)) out[k] = scrub(v);
    return out;
  }
  return typeof value === 'string' ? value.replace(EMAIL, '[email removed]') : value;
}

// CSV cell: always quoted, quotes doubled, so commas and newlines in stems survive.
const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const csv = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';

module.exports = { ROOT, DIR, SNAPSHOT, TEST_NAME, testNameOf, loadBank, plain, tokens, similarity,
  previewParts, ourChoices, stateProblems, scrub, EMAIL, csv };
