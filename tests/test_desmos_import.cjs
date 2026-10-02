// Prepzy Desmos solutions: tools/desmos/import.cjs SQL, tools/desmos/map.cjs matching, scrape parsing,
// and migration 0015 against the schema.sql snapshot.
//   node --test tests/test_desmos_import.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const root = __dirname + '/../';
const { buildSql, problems, MAX_STATEMENT } = require('../tools/desmos/import.cjs');
const { match } = require('../tools/desmos/map.cjs');
const { cbIdsOf, solutionsOf, slim } = require('../tools/desmos/scrape.cjs');
const { plain } = require('../tools/desmos/common.cjs');

const STATE = { version: 11, graph: { viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 } }, expressions: { list: [{ type: 'expression', id: '1', latex: 'y=2x+3' }] } };
const row = (id, extra = {}) => ({ question_id: id, cbId: id, testName: 'Linear functions', questionIndex: 0, method: 'cbId', score: 1,
  credit_name: 'Ada', source_fingerprint: 'fp-' + id, state: STATE, ...extra });

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(readFileSync(root + 'schema.sql', 'utf8'));
  d.exec("INSERT INTO questions (id) VALUES ('aaaa1111'), ('bbbb2222')");
  return d;
}
const changes = (d) => d.prepare('SELECT total_changes() AS n').get().n;

test('the generated SQL is idempotent: a rerun writes nothing and leaves the same rows', () => {
  const d = db();
  const sql = buildSql([row('bbbb2222'), row('aaaa1111', { credit_name: "O'Brien" })], new Set(['aaaa1111', 'bbbb2222']));
  assert.equal(buildSql([row('aaaa1111', { credit_name: "O'Brien" }), row('bbbb2222')], new Set(['aaaa1111', 'bbbb2222'])), sql, 'same mapping, same bytes, whatever the order');
  d.exec(sql);
  const first = d.prepare('SELECT question_id, state_json, credit_name, source, source_fingerprint, imported_at FROM desmos_solutions ORDER BY question_id').all().map(r => ({ ...r }));
  assert.equal(first.length, 2);
  assert.deepEqual(JSON.parse(first[0].state_json), STATE);
  assert.equal(first[0].credit_name, "O'Brien");
  assert.equal(first[0].source, 'prepzy');
  assert.ok(first[0].imported_at);
  const before = changes(d);
  d.exec(sql);
  assert.equal(changes(d), before, 'an unchanged rerun spends no row writes');
  assert.deepEqual(d.prepare('SELECT question_id, state_json, credit_name, source, source_fingerprint, imported_at FROM desmos_solutions ORDER BY question_id').all().map(r => ({ ...r })), first);
  // A changed solution replaces the stored one in place; still one row per question.
  const next = { ...STATE, expressions: { list: [{ type: 'expression', id: '1', latex: 'y=3x' }] } };
  d.exec(buildSql([row('aaaa1111', { state: next, credit_name: 'Ada' })], new Set(['aaaa1111'])));
  const now = d.prepare("SELECT state_json, credit_name FROM desmos_solutions WHERE question_id='aaaa1111'").get();
  assert.deepEqual([JSON.parse(now.state_json), now.credit_name], [next, 'Ada']);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM desmos_solutions').get().n, 2);
});

test('unknown question IDs are refused before any SQL is written', () => {
  assert.throws(() => buildSql([row('aaaa1111'), row('ffff9999')], new Set(['aaaa1111'])), e => /REFUSED/.test(e.message) && e.problems.length === 1 && /ffff9999.*unknown question_id/.test(e.problems[0]));
  // AI questions are not in the core set the importer is given, so they are refused the same way.
  assert.match(problems([row('ai_m001')], new Set(['aaaa1111']))[0], /unknown question_id/);
});

test('the SQL itself skips an ID the target database does not have', () => {
  const d = db();
  // The bank the importer validated against had it; this database does not.
  d.exec(buildSql([row('aaaa1111'), row('cccc3333')], new Set(['aaaa1111', 'cccc3333'])));
  assert.deepEqual(d.prepare('SELECT question_id FROM desmos_solutions').all().map(r => r.question_id), ['aaaa1111']);
});

test('bad rows refuse the whole run', () => {
  const ids = new Set(['aaaa1111', 'bbbb2222']);
  const bad = (r) => problems([r], ids).join('\n');
  assert.match(bad(row('aaaa1111', { state: { expressions: { list: [{ latex: 'x' }] } } })), /no version/);
  assert.match(bad(row('aaaa1111', { state: { version: 11, expressions: { list: [] } } })), /expressions\.list/);
  assert.match(bad(row('aaaa1111', { state: null })), /not an object/);
  assert.match(bad(row('aaaa1111', { credit_name: 'someone@example.com' })), /email/);
  assert.match(bad(row("aa'; DROP TABLE questions; --")), /invalid question_id/);
  assert.match(problems([row('aaaa1111'), row('aaaa1111')], ids).join('\n'), /duplicate/);
  const big = { ...STATE, expressions: { list: [{ type: 'expression', id: '1', latex: 'x'.repeat(MAX_STATEMENT) }] } };
  assert.match(bad(row('aaaa1111', { state: big })), /too large/);
  assert.deepEqual(problems([row('aaaa1111'), row('bbbb2222', { credit_name: null, source_fingerprint: null })], ids), []);
});

test('migration 0015 on an existing database matches the schema.sql snapshot', () => {
  const fresh = db();
  const old = new DatabaseSync(':memory:');
  old.exec(readFileSync(root + 'schema.sql', 'utf8').replace(/CREATE TABLE IF NOT EXISTS desmos_solutions \([\s\S]*?\);/, ''));
  assert.equal(old.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='desmos_solutions'").get().n, 0);
  old.exec(readFileSync(root + 'migrations/0015_desmos_solutions.sql', 'utf8'));
  const cols = d => d.prepare('PRAGMA table_info(desmos_solutions)').all().map(c => ({ ...c }));
  assert.deepEqual(cols(old), cols(fresh));
  assert.deepEqual(cols(fresh).map(c => c.name), ['question_id', 'state_json', 'credit_name', 'source', 'source_fingerprint', 'imported_at']);
});

// ---- mapping ----
const bank = [
  { id: 'aaaa1111', bank: 'core', section: 'Math', skill: 'Linear functions', stem_html: '<h3>Prompt</h3><p>The function&nbsp;f is defined by \\(f(x)=2x+3\\). What is the value of \\(f(4)\\)?</p>', choices_json: JSON.stringify([{ letter: 'A', content: '<p>8</p>' }, { letter: 'B', content: '<p>11</p>' }, { letter: 'C', content: '<p>14</p>' }, { letter: 'D', content: '<p>5</p>' }]) },
  { id: 'bbbb2222', bank: 'core', section: 'Math', skill: 'Circles', stem_html: '<p>A circle in the xy-plane has equation \\((x-2)^2+(y+5)^2=49\\). What is the radius of the circle?</p>', choices_json: '[]' },
  { id: 'cccc3333', bank: 'core', section: 'Math', skill: 'Percentages', stem_html: '<p>A store sold 120 shirts on Monday, which is 40% of all shirts it sold that week. How many shirts did it sell that week?</p>', choices_json: '[]' },
  { id: 'dddd4444', bank: 'core', section: 'Math', skill: 'Percentages', stem_html: '<p>A store sold 150 shirts on Monday, which is 30% of all shirts it sold that week. How many shirts did it sell that week?</p>', choices_json: '[]' },
  { id: 'ai_m001', bank: 'ai', section: 'Math', skill: 'Nonlinear functions', stem_html: '<p>The function g is defined by g(x) = x squared minus 9 times x plus 14. For which positive value of x is g(x) equal to zero and greater than five?</p>', choices_json: '[]' },
  { id: 'rw000001', bank: 'core', section: 'Reading & Writing', skill: 'Inferences', stem_html: '<p>Text</p>', choices_json: '[]' }
];
const sol = (extra) => ({ cbId: null, testName: 'Linear functions', questionIndex: 0, questionFingerprint: 'fp', desmosState: STATE, makerAttribution: { displayName: 'Ada' }, questionPreview: null, ...extra });

test('a cbId equal to questions.id is confirmed; text decides the rest', () => {
  const sols = [
    sol({ cbId: 'aaaa1111', questionIndex: 0, questionPreview: { stem: '<p>The function f is defined by f(x) = 2x + 3. What is the value of f(4)?</p>', choices: ['8', '11', '14', '5'] } }),
    // No cbId: an exact text match (spacing, entities and markup aside) on one core question.
    sol({ testName: 'Circles', questionIndex: 3, questionPreview: { stem: 'A circle in the xy-plane&nbsp;has equation (x-2)^2+(y+5)^2=49.  What is the <b>radius</b> of the circle?', choices: [] } }),
    // Two near-identical candidates: held for review, never guessed.
    sol({ testName: 'Percentages', questionIndex: 1, questionPreview: { stem: 'A store sold shirts on Monday, which is of all shirts it sold that week. How many shirts did it sell that week?', choices: [] } }),
    // Nothing like it in the bank.
    sol({ testName: 'Circles', questionIndex: 7, questionPreview: { stem: 'Triangle ABC is similar to triangle DEF; find the length of side EF.', choices: [] } }),
    // A cbId the core bank does not have, whose text is an AI question: review, not import.
    sol({ cbId: 'eeee5555', testName: 'Nonlinear equations in one variable and systems of equations in two variables', questionPreview: { stem: 'The function g is defined by g(x) = x squared minus 9 times x plus 14. For which positive value of x is g(x) equal to zero and greater than five?' } }),
    // A cbId hit whose preview is a different question.
    sol({ cbId: 'bbbb2222', testName: 'Circles', questionIndex: 9, questionPreview: { stem: 'Kim drives 300 miles using 12 gallons of gasoline. At this rate, how many gallons are needed for 450 miles?' } })
  ];
  const { mapping, review, unmatched } = match(sols, bank);
  assert.deepEqual(mapping.map(m => [m.question_id, m.method]), [['aaaa1111', 'cbId'], ['bbbb2222', 'text']]);
  assert.deepEqual(Object.keys(mapping[0]).sort(), ['cbId', 'credit_name', 'method', 'questionIndex', 'question_id', 'score', 'source_fingerprint', 'state', 'testName']);
  assert.equal(mapping[0].credit_name, 'Ada');
  assert.deepEqual(review.map(r => [r.sol.testName, r.sol.questionIndex, r.q.id]).sort(), [
    ['Circles', 9, 'bbbb2222'], ['Nonlinear equations in one variable and systems of equations in two variables', 0, 'ai_m001'], ['Percentages', 1, 'cccc3333']]);
  assert.deepEqual(unmatched.map(u => [u.sol.testName, u.sol.questionIndex]), [['Circles', 7]]);
});

test('normalization strips HTML, converts &nbsp; and collapses whitespace', () => {
  assert.equal(plain('<h3>Prompt</h3><p>Hello&nbsp;&nbsp;<b>world</b>\n\n 3&lt;4</p><script>x()</script>'), 'Hello world 3<4');
});

// ---- scrape parsing ----
test('scrape keeps only the agreed fields and never an email', () => {
  const html = '<button aria-label="Copy College Board question ID 1a2b3c4d">1a2b3c4d</button><span aria-label="Copy College Board question ID 1a2b3c4d"></span>';
  assert.deepEqual(cbIdsOf(html), ['1a2b3c4d']);
  assert.deepEqual(cbIdsOf('<p>no id</p>'), []);
  const api = { _id: 'x', questionId: 'synthetic', userEmail: 'maker@example.com', finalizedBy: 'admin@example.com', votes: 3,
    desmosState: JSON.stringify(STATE), questionPreview: { stem: 'Ask maker@example.com' }, questionFingerprint: 'fp1',
    makerAttribution: { displayName: 'Maker', email: 'maker@example.com', userId: 'u1' } };
  for (const body of [api, [api], { solutions: [api] }]) assert.equal(solutionsOf(body).length, 1);
  assert.deepEqual(solutionsOf(null), []);
  assert.deepEqual(solutionsOf({ message: 'none' }), []);
  const r = slim(api, { cbId: '1a2b3c4d', testName: 'Linear functions', questionIndex: 4 });
  assert.deepEqual(Object.keys(r), ['cbId', 'testName', 'questionIndex', 'questionFingerprint', 'desmosState', 'questionPreview', 'makerAttribution']);
  assert.deepEqual(r.makerAttribution, { displayName: 'Maker' });
  assert.deepEqual(r.desmosState, STATE);
  assert.doesNotMatch(JSON.stringify(r), /@example\.com|synthetic|finalizedBy|userEmail/);
});
