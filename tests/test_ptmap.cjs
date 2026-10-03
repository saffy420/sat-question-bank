// Practice-test map build (tools/ptmap): the PDF merge rules, and that the generated files are reproducible.
//
//   node --test tests/test_ptmap.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { mergeModule, validateRow, answerCheck, parseCsv, toCsv, sameSkill } = require('../tools/ptmap/merge.cjs');

const facts = {
  aaaaaaa1: { section: 'Math', skill: 'Linear functions', difficulty: 'Hard', answer: 'B', spr: false, letters: 'ABCD' },
  aaaaaaa2: { section: 'Math', skill: 'Linear functions', difficulty: 'Hard', answer: 'C', spr: false, letters: 'ABCD' },
  aaaaaaa3: { section: 'Math', skill: 'Percentages', difficulty: 'Hard', answer: '30', spr: true, letters: '' },
  bbbbbbb1: { section: 'RW', skill: 'Text Structure and Purpose', difficulty: 'Medium', answer: 'A', spr: false, letters: 'ABCD' },
};
const row = (number, id, answer, extra = {}) => ({ test: '4', section: 'Math', block: '3', number: String(number), id, skill: 'Linear Functions', difficulty: '3', answer, ...extra });

test('a conflict keeps the export ID and is listed', () => {
  const r = mergeModule(['aaaaaaa1', null], [row(1, 'aaaaaaa2', 'C'), row(2, 'aaaaaaa1', 'B')], facts, 2);
  assert.deepEqual(r.ids, ['aaaaaaa1', 'aaaaaaa1']);
  assert.equal(r.filled, 1);
  assert.deepEqual(r.events.filter(e => e.kind === 'conflict').map(e => [e.n, e.kept, e.pdf]), [[1, 'aaaaaaa1', 'aaaaaaa2']]);
  // the fill repeats an ID already in the module: flagged, still mapped
  assert.deepEqual(r.events.filter(e => e.kind === 'duplicate').map(e => e.n), [2]);
});

test('a placeholder becomes null and is listed; an absent module stays null when nothing validates', () => {
  const r = mergeModule(null, [row(1, 'xyz00014', 'B'), row(2, 'abcd0006', 'C')], facts, 2);
  assert.equal(r.ids, null);
  assert.deepEqual(r.events.map(e => e.kind), ['placeholder', 'placeholder']);
  const s = mergeModule(null, [row(1, 'xyz00014', 'B'), row(2, 'aaaaaaa2', 'C')], facts, 2);
  assert.deepEqual(s.ids, [null, 'aaaaaaa2']);
});

test('an answer mismatch, a wrong section or an unknown ID is rejected', () => {
  const r = mergeModule(null, [row(1, 'aaaaaaa1', 'D'), row(2, 'bbbbbbb1', 'A'), row(3, 'ccccccc9', 'A')], facts, 3);
  assert.deepEqual(r.ids, null);
  assert.deepEqual(r.events.map(e => e.kind), ['reject', 'reject', 'reject']);
  assert.match(r.events[0].why, /answer: PDF D, bank B/);
  assert.match(r.events[1].why, /RW question/);
  assert.match(r.events[2].why, /not in the bank/);
});

test('grid-in forms: any accepted form passes, some-but-not-all warns, none rejects', () => {
  assert.deepEqual(answerCheck(facts.aaaaaaa3, '30'), { ok: true, why: '' });
  const partial = answerCheck(facts.aaaaaaa3, '30, -30');
  assert.equal(partial.ok, true); assert.match(partial.why, /only some/);
  assert.equal(answerCheck(facts.aaaaaaa3, '31, 32').ok, false);
  const frac = { ...facts.aaaaaaa3, answer: '451/100' };
  assert.deepEqual(answerCheck(frac, '451/100, 4.51'), { ok: true, why: '' });
});

test('skill and difficulty mismatches only warn; the PDF names are normalised first', () => {
  assert.ok(sameSkill('Text, Structure, and Purpose', 'Text Structure and Purpose'));
  assert.ok(sameSkill('Nonlinear Equations and Systems', 'Nonlinear equations in one variable'));
  assert.ok(sameSkill('Problem-Solving & Data', 'Problem-Solving and Data'));
  const v = validateRow(row(1, 'aaaaaaa1', 'B', { skill: 'Circles', difficulty: '1' }), facts);
  assert.equal(v.id, 'aaaaaaa1');
  assert.deepEqual(v.warnings.map(w => w.split(':')[0]), ['skill', 'difficulty']);
});

test('the same ID in easy and hard is legitimate (no flag across modules)', () => {
  const easy = mergeModule(['aaaaaaa1'], [row(1, 'aaaaaaa1', 'B', { block: '2' })], facts, 1);
  const hard = mergeModule(null, [row(1, 'aaaaaaa1', 'B')], facts, 1);
  assert.deepEqual([easy.ids, hard.ids], [['aaaaaaa1'], ['aaaaaaa1']]);
  assert.equal(easy.events.length + hard.events.length, 0);
});

test('CSV round-trips quoted fields', () => {
  const rows = [{ a: 'Form, Structure, and Sense', b: '30, -30' }, { a: 'say "hi"', b: '' }];
  assert.deepEqual(parseCsv(toCsv(['a', 'b'], rows)), rows);
});

test('the build is reproducible: two runs are byte-identical and match the committed outputs', () => {
  const root = path.join(__dirname, '..');
  const dirs = [1, 2].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'ptmap-')));
  for (const d of dirs) execFileSync(process.execPath, [path.join(root, 'tools/ptmap/build-ptmap.cjs'), '--out', d], { stdio: 'pipe' });
  const files = fs.readdirSync(dirs[0]).sort();
  assert.deepEqual(files, ['README.md', 'UNMATCHED.md', 'practice-test-map.json', 'practice-tests-ext.json', 'practice-tests.json']);
  const committed = { 'practice-tests.json': 'public', 'practice-tests-ext.json': 'public' };
  for (const f of files) {
    const a = fs.readFileSync(path.join(dirs[0], f));
    assert.ok(a.equals(fs.readFileSync(path.join(dirs[1], f))), `${f} differs between runs`);
    assert.ok(a.equals(fs.readFileSync(path.join(root, committed[f] || 'tools/ptmap', f))), `${f} is stale: rerun node tools/ptmap/build-ptmap.cjs`);
  }
  dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
});
