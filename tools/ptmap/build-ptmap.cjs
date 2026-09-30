// Maps every question position in each Bluebook practice test to its bank ID.
//
//   node tools/ptmap/build-ptmap.cjs
//
// Reads  active-ids.json (repo root) and practice-tests/PT*-questions.json.
// Writes tools/ptmap/practice-test-map.json, README.md and UNMATCHED.md.
// Matching is exact on College Board's external_id; no fuzzy or text matching.
// Outputs hold IDs, positions and counts only - never question text.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = __dirname;
const TEST_DIR = path.join(ROOT, 'practice-tests');
const FILE_RE = /^PT(\d+)-RW(easy|hard)-M(easy|hard)-questions\.json$/;
const EXTERNAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Below this fallback hit rate (questionId vs external_id) a file with no
// externalId is treated as unmappable rather than partially mapped.
const FALLBACK_MIN_HIT_RATE = 0.5;

const SECTIONS = ['RW', 'Math'];
const SECTION_OF = { Reading: 'RW', Math: 'Math' };
const COUNT = { RW: 27, Math: 22 };
const DOMAINS = { RW: ['INI', 'CAS', 'EOI', 'SEC'], Math: ['H', 'P', 'Q', 'S'] };
// sequence layout: [first, last] of each block, in 147 slots per test
const BLOCKS = {
  RW:   { m1: [0, 26],   A: [27, 53],   B: [54, 80] },
  Math: { m1: [81, 102], A: [103, 124], B: [125, 146] },
};

const errors = [];   // contradictions/inconsistencies; make the run exit non-zero
const notes = [];    // things worth reading that are not errors
const err = m => errors.push(m);
const note = m => notes.push(m);

// ---- inputs ---------------------------------------------------------------
const active = JSON.parse(fs.readFileSync(path.join(ROOT, 'active-ids.json'), 'utf8'));
const byExt = new Map(); // external_id -> [{questionId, section}]
for (const a of active) {
  if (!byExt.has(a.external_id)) byExt.set(a.external_id, []);
  byExt.get(a.external_id).push(a);
}
for (const [ext, rows] of byExt) {
  const ids = [...new Set(rows.map(r => r.questionId))];
  if (ids.length > 1) note(`active-ids.json: external_id ${ext} is shared by ${ids.length} bank IDs (${ids.join(', ')}); a match on it is ambiguous, so it maps to null and is listed in UNMATCHED.md`);
}

// Bank IDs supplied by hand for externalIds that are absent from active-ids.json
// (looked up in the bank). Used only after an exact miss, and only when the
// section agrees.
const manual = new Map(JSON.parse(fs.readFileSync(path.join(OUT, 'manual-matches.json'), 'utf8'))
  .map(m => [m.externalId, m]));

function lookup(ext, section) {
  const rows = (byExt.get(ext) || []).filter(r => r.section === section);
  const ids = [...new Set(rows.map(r => r.questionId))];
  if (ids.length === 1) return { bankId: ids[0] };
  if (ids.length > 1) return { bankId: null, ambiguous: ids };
  const m = manual.get(ext);
  if (m && m.section === section) return { bankId: m.bankId };
  return { bankId: null };
}

function blockOf(section, seq) {
  for (const [name, [lo, hi]] of Object.entries(BLOCKS[section])) if (seq >= lo && seq <= hi) return name;
  return null;
}

// ---- pass 1: parse files, work out each file's sequence blocks -------------
const files = fs.readdirSync(TEST_DIR).filter(f => /^PT.*-questions\.json$/.test(f)).sort();
const parsed = [];
for (const f of files) {
  const m = FILE_RE.exec(f);
  if (!m) { err(`${f}: filename does not match PT<n>-RW<easy|hard>-M<easy|hard>-questions.json; skipped`); continue; }
  const rows = JSON.parse(fs.readFileSync(path.join(TEST_DIR, f), 'utf8'))
    .flatMap(s => s.items || []);
  const label = { RW: m[2], Math: m[3] };
  const items = [];
  for (const it of rows) {
    const section = SECTION_OF[it.section];
    const seq = it.sequence;
    if (!section) { err(`${f}: item with unknown section ${JSON.stringify(it.section)}`); continue; }
    const block = blockOf(section, seq);
    if (!block) { err(`${f}: ${section} item with sequence ${seq} is outside every ${section} block`); continue; }
    const dn = Number(it.displayNumber);
    if (!Number.isInteger(dn)) { err(`${f}: ${section} seq ${seq} has non-integer displayNumber ${JSON.stringify(it.displayNumber)}`); continue; }
    const code = it.metadata && it.metadata.PRIMARY_CLASS_CD;
    if (code && !DOMAINS[section].includes(code)) err(`${f}: ${section} seq ${seq} has domain code ${code}, which is not a ${section} code`);
    items.push({ section, block, seq, dn, externalId: it.externalId || null, questionId: it.questionId || null });
  }
  parsed.push({ file: f, test: `PT${m[1]}`, num: Number(m[1]), label, items });
}

// Which block does each label (easy/hard) mean? Tally over every file and section.
const tally = {};                       // "easy|A" -> count
for (const p of parsed) for (const s of SECTIONS) {
  p[s] = new Set(p.items.filter(i => i.section === s && i.block !== 'm1').map(i => i.block));
  for (const b of p[s]) tally[`${p.label[s]}|${b}`] = (tally[`${p.label[s]}|${b}`] || 0) + 1;
}
const diffOfBlock = {};                 // A|B -> easy|hard, majority vote
for (const b of ['A', 'B']) {
  const e = tally[`easy|${b}`] || 0, h = tally[`hard|${b}`] || 0;
  if (e === h) err(`cannot tell whether block ${b} is easy or hard (${e} easy vs ${h} hard labels)`);
  else diffOfBlock[b] = e > h ? 'easy' : 'hard';
}
if (diffOfBlock.A && diffOfBlock.A === diffOfBlock.B) err('blocks A and B resolve to the same difficulty');

// ---- pass 2: per-file checks and the map ------------------------------------
const map = {};          // test -> section -> { m1, easy, hard } (arrays or null)
const fileReport = [];   // per file, for the README
const unmatched = [];    // {test, section, module, dn, sequence, externalId}
const ambiguous = [];    // {test, section, module, dn, sequence, externalId, ids}
const positions = new Map(); // externalId -> [ "PT4 RW m1 #3" ]
const posTests = new Map();  // externalId -> Set(test)
const mapped = new Set();    // bankIds with a position
const seen = {};         // "test|section|module" -> { file, ids: [externalId by dn] } for cross-file compare

parsed.sort((a, b) => a.num - b.num || a.file.localeCompare(b.file));
for (const p of parsed) {
  const rep = { file: p.file, test: p.test, label: p.label, blocks: {}, flags: [], unmappable: false, fallback: null };
  fileReport.push(rep);

  // sequence layout per section
  for (const s of SECTIONS) {
    const blocks = [...new Set(p.items.filter(i => i.section === s).map(i => i.block))].sort();
    rep.blocks[s] = blocks;
    if (!blocks.includes('m1')) err(`${p.file}: ${s} has no module 1 items in ${BLOCKS[s].m1.join('-')}`);
    const m2 = blocks.filter(b => b !== 'm1');
    if (m2.length !== 1) err(`${p.file}: ${s} has ${m2.length} module-2 blocks (${m2.join(',') || 'none'}); expected exactly one`);
    else if (diffOfBlock[m2[0]] !== p.label[s]) {
      const msg = `${p.file}: ${s} filename says ${p.label[s]} but sequence block ${m2[0]} is ${diffOfBlock[m2[0]]}; trusting the sequence block`;
      rep.flags.push(msg); err(msg);
    }
  }

  // join key: externalId, or questionId fallback for old exports
  const missingExt = p.items.filter(i => !i.externalId).length;
  let key = i => i.externalId;
  if (missingExt === p.items.length && p.items.length) {
    const hits = p.items.filter(i => i.questionId && byExt.has(i.questionId)).length;
    rep.fallback = { hits, total: p.items.length };
    if (hits / p.items.length < FALLBACK_MIN_HIT_RATE) {
      rep.unmappable = true;
      note(`${p.file}: no externalId on any item; questionId fallback matched ${hits}/${p.items.length}, so the file is unmappable`);
      continue;
    }
    key = i => i.questionId;
  } else if (missingExt) {
    err(`${p.file}: ${missingExt} of ${p.items.length} items lack externalId while the rest have it`);
  }

  // integrity: contiguous displayNumbers, monotonic sequence, no repeated externalId
  const seenIds = new Set();
  for (const s of SECTIONS) for (const b of ['m1', 'A', 'B']) {
    const its = p.items.filter(i => i.section === s && i.block === b).sort((x, y) => x.seq - y.seq);
    if (!its.length) continue;
    const want = COUNT[s];
    const dns = its.map(i => i.dn);
    if (dns.length !== want || dns.some((d, k) => d !== k + 1)) err(`${p.file}: ${s} ${b} displayNumbers are not 1-${want} in sequence order (${dns.join(',')})`);
    its.forEach((i, k) => { if (i.seq !== BLOCKS[s][b][0] + k) err(`${p.file}: ${s} ${b} #${i.dn} has sequence ${i.seq}, expected ${BLOCKS[s][b][0] + k}`); });
  }
  for (const i of p.items) {
    const k = key(i);
    if (!k) { err(`${p.file}: ${i.section} seq ${i.seq} has no join key`); continue; }
    if (!EXTERNAL_ID_RE.test(k)) err(`${p.file}: ${i.section} seq ${i.seq} join key is not a UUID-shaped externalId`);
    if (seenIds.has(k)) err(`${p.file}: externalId ${k} appears more than once in the test`);
    seenIds.add(k);
  }

  // place items into the map
  const t = map[p.test] || (map[p.test] = {
    RW: { m1: null, easy: null, hard: null }, Math: { m1: null, easy: null, hard: null } });
  for (const s of SECTIONS) for (const b of ['m1', 'A', 'B']) {
    const its = p.items.filter(i => i.section === s && i.block === b).sort((x, y) => x.dn - y.dn);
    if (!its.length) continue;
    const module = b === 'm1' ? 'm1' : diffOfBlock[b];
    const found = [];
    const entries = its.map(i => {
      const k = key(i);
      const r = lookup(k, s);
      const where = `${p.test} ${s} ${module} #${i.dn}`;
      if (!positions.has(k)) { positions.set(k, []); posTests.set(k, new Set()); }
      if (!positions.get(k).includes(where)) positions.get(k).push(where);
      posTests.get(k).add(p.test);
      const base = { test: p.test, section: s, module, dn: i.dn, sequence: i.seq, externalId: k };
      if (r.ambiguous) found.push(['amb', { ...base, ids: r.ambiguous }]);
      else if (!r.bankId) found.push(['none', base]);
      return { displayNumber: i.dn, sequence: i.seq, externalId: k, bankId: r.bankId };
    });
    const prev = seen[`${p.test}|${s}|${module}`];
    if (!prev) {
      seen[`${p.test}|${s}|${module}`] = { file: p.file, entries };
      t[s][module] = entries;
      entries.forEach(e => e.bankId && mapped.add(e.bankId));
      for (const [kind, u] of found) (kind === 'amb' ? ambiguous : unmatched).push(u);
    } else {
      // a second export of the same module (e.g. module 1) must be identical; it adds nothing new
      const same = prev.entries.length === entries.length &&
        prev.entries.every((e, k) => e.externalId === entries[k].externalId && e.sequence === entries[k].sequence);
      if (!same) err(`${p.test} ${s} ${module}: ${p.file} differs from ${prev.file}; keeping ${prev.file}`);
    }
  }
}

// an externalId at two positions inside one test (across module-2 variants; within one file is an error above)
for (const [k, where] of positions) {
  const byTest = {};
  for (const w of where) (byTest[w.split(' ')[0]] = byTest[w.split(' ')[0]] || []).push(w);
  for (const [tn, ws] of Object.entries(byTest)) if (ws.length > 1) note(`${tn}: externalId ${k} sits at more than one position (${ws.join('; ')}). No single export repeats it, so the question appears in both module-2 variants; its bank ID has two positions in this test.`);
}

const testKeys = Object.keys(map).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
const out = {};
for (const k of testKeys) out[k] = map[k];
fs.writeFileSync(path.join(OUT, 'practice-test-map.json'), JSON.stringify(out, null, 1) + '\n');

// ---- reports ------------------------------------------------------------------
const reused = [...posTests].filter(([, s]) => s.size > 1);
const cell = (t, s, m) => {
  const a = map[t] && map[t][s][m];
  if (!a) return 'missing';
  return `present, ${a.filter(e => !e.bankId).length} null`;
};
const cover = [];
for (const t of testKeys) for (const s of SECTIONS) cover.push(`| ${t} | ${s} | ${['m1', 'easy', 'hard'].map(m => cell(t, s, m)).join(' | ')} |`);
const positionsTotal = testKeys.reduce((n, t) => n + SECTIONS.reduce((m, s) => m + ['m1', 'easy', 'hard'].reduce((x, mod) => x + (map[t][s][mod] ? map[t][s][mod].length : 0), 0), 0), 0);
const nullTotal = positionsTotal - testKeys.reduce((n, t) => n + SECTIONS.reduce((m, s) => m + ['m1', 'easy', 'hard'].reduce((x, mod) => x + (map[t][s][mod] ? map[t][s][mod].filter(e => e.bankId).length : 0), 0), 0), 0);
const activeIds = new Set(active.map(a => a.questionId));
const placedActive = [...mapped].filter(b => activeIds.has(b)).length;
const scoresPath = path.join(TEST_DIR, 'scores.json');

const readme = `# Practice-test map

Maps every question position in each Bluebook practice test to its question bank ID.
Generated by \`build-ptmap.cjs\`; do not edit by hand. Outputs hold only IDs, positions and counts.

## Run

\`\`\`
node tools/ptmap/build-ptmap.cjs
\`\`\`

Reads \`active-ids.json\` (repo root), \`manual-matches.json\` (this folder) and every \`practice-tests/PT*-questions.json\`, then rewrites
\`practice-test-map.json\`, \`README.md\` and \`UNMATCHED.md\` in this folder. Output is deterministic.
The exit code is 1 if any check below fails; the files are still written.

Join: an item's \`externalId\` is matched exactly against \`external_id\` in \`active-ids.json\`, within the
same section. Bluebook's own \`questionId\` is never used as a join key except as the fallback for exports
with no \`externalId\` at all (hit rate reported; below ${FALLBACK_MIN_HIT_RATE * 100}% the file is unmappable and excluded). Every match is exact or \`null\`.

\`manual-matches.json\` holds bank IDs supplied by hand for externalIds that are absent from \`active-ids.json\`
(${manual.size} entries, looked up in the bank). They are used only after an exact miss and only when the section agrees.
\`displayNumber\` is written as an integer (the exports store it as a string).

## \`sequence\` layout

| Section | Module 1 | Module 2, block A | Module 2, block B |
|---|---|---|---|
| RW | 0-26 | 27-53 (${diffOfBlock.A || '?'}) | 54-80 (${diffOfBlock.B || '?'}) |
| Math | 81-102 | 103-124 (${diffOfBlock.A || '?'}) | 125-146 (${diffOfBlock.B || '?'}) |

Which block is easy or hard is derived from the filename labels across all files (majority vote per label).
Label evidence (files x sections): ${Object.entries(tally).sort().map(([k, v]) => `${k.replace('|', ' -> block ')}: ${v}`).join('; ')}.
${errors.some(e => /filename says/.test(e)) ? 'Some files contradict their filename; see below.' : 'Every file agrees with its filename in both sections, and every file has exactly one module-2 block per section.'}
Within each module, \`displayNumber\` runs 1-27 (RW) or 1-22 (Math) in \`sequence\` order.

## Files

| File | Filename labels (RW / Math) | RW blocks | Math blocks | Status |
|---|---|---|---|---|
${fileReport.map(r => `| ${r.file} | ${r.label.RW} / ${r.label.Math} | ${r.blocks.RW ? r.blocks.RW.join(',') : ''} | ${r.blocks.Math ? r.blocks.Math.join(',') : ''} | ${r.unmappable ? `unmappable (fallback ${r.fallback.hits}/${r.fallback.total})` : r.flags.length ? 'label contradicts sequence' : 'ok'} |`).join('\n')}

## Coverage

\`present, N null\` = the module was exported and N of its positions have no bank ID.
\`missing\` = nobody has exported that module yet (\`null\` in the JSON).

| Test | Section | m1 | easy | hard |
|---|---|---|---|---|
${cover.join('\n')}

- Positions mapped: ${positionsTotal}; positions with \`null\` bankId: ${nullTotal} (${unmatched.length} with no bank ID, ${ambiguous.length} ambiguous). See \`UNMATCHED.md\`.
- Active IDs that now have a practice-test position: **${placedActive} of ${activeIds.size}** (${(100 * placedActive / activeIds.size).toFixed(1)}%). ${mapped.size - placedActive} more mapped bank IDs come from \`manual-matches.json\` and are not in \`active-ids.json\`.
- Distinct Bluebook externalIds seen: ${positions.size}; reused on more than one test: ${reused.length}.

## Checks

${errors.length ? errors.map(e => `- FAIL: ${e}`).join('\n') : '- All checks passed: contiguous displayNumbers, sequence blocks, no repeated externalId within any single export, module 1 identical across files of the same test, filenames agree with sequence blocks.'}

## Notes

${notes.length ? notes.map(n => `- ${n}`).join('\n') + '\n' : ''}- ${fs.existsSync(scoresPath) ? '`practice-tests/scores.json` is present but this tool does not read it; the filename cross-check against it is not implemented.' : '`practice-tests/scores.json` is not in the repository, so the cross-check of filenames against tests actually taken has not been done.'}
- \`active-ids.json\` also holds IDs from the PSAT 8/9/10 tests, so many of the ${activeIds.size} IDs cannot appear in these SAT exports.

## Reused externalIds (same question on different tests)

${reused.length ? reused.map(([k, s]) => `- \`${k}\`: ${positions.get(k).join('; ')}`).join('\n') : 'None.'}
`;
fs.writeFileSync(path.join(OUT, 'README.md'), readme);

const row = u => `| ${u.test} | ${u.section} | ${u.module} | ${u.dn} | ${u.sequence} | ${u.externalId} |`;
const hdr = '| Test | Section | Module | displayNumber | sequence | externalId |\n|---|---|---|---|---|---|';
const unmatchedMd = `# Unmatched practice-test items

Generated by \`build-ptmap.cjs\`. No matches are guessed; these are for a human decision.

## externalId with no bank ID (${unmatched.length})

${unmatched.length ? `${hdr}\n${unmatched.map(row).join('\n')}` : 'None.'}

## externalId shared by several bank IDs (${ambiguous.length})

Exact matching cannot choose between them, so \`bankId\` is \`null\`.

${ambiguous.length ? `${hdr.replace('externalId |', 'externalId | Candidate bank IDs |').replace(/\|$/, '|---|')}\n${ambiguous.map(u => `${row(u)} ${u.ids.join(', ')} |`).join('\n')}` : 'None.'}
`;
fs.writeFileSync(path.join(OUT, 'UNMATCHED.md'), unmatchedMd);

console.log(`${testKeys.length} tests, ${positionsTotal} positions, ${placedActive}/${activeIds.size} active IDs placed, ${mapped.size - placedActive} manual, ${unmatched.length} unmatched, ${ambiguous.length} ambiguous`);
if (errors.length) { console.error(errors.map(e => 'FAIL: ' + e).join('\n')); process.exit(1); }
