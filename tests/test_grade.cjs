// Self-check for the page side of a practice Check (afterCheck in public/index.html) and for the shared renderer.
//
// The record rules themselves (first Check records, a wrong Check leaves the question open, Show answer) are covered
// through the real recorder in tests/test_bank_record.ts. What is left in the page is the glue: which session is saved,
// whether the Focus ladder moves, and - the reported bug - that the home screens are redrawn AFTER the record moves.
// The function lives inside the page's IIFE, so it is lifted out by its markers rather than duplicated here.
//
//   node tests/test_grade.cjs
const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
const block = page.slice(page.indexOf('// --- bank check'), page.indexOf('// --- end bank check ---'));
if (!block) throw new Error('bank check block not found in public/index.html');
const stats = require('../public/shared/stats.js');
const { createRecorder, pick } = require('../lesson-ui/record.ts');
// The block's free variables (S, PROG, refresh, ...) are parameters here, which is what lets them be stubbed. `S` is
// reassigned per case, so it is read through a getter and the block's bare `S` is rewritten to call it.
const lifted = new Function('createRecorder', 'Stats', 'PROG', 'LOG', 'saveProgress', 'saveLog', 'getS', 'levelOf', 'nextLevel', 'refresh', 'bankDraw', 'saveSession', 'reviewState',
  block.replace(/\bS\b/g, 'getS()') + '\nreturn { afterCheck, REC };');

const choices = [{ letter: 'A' }, { letter: 'B' }];
const Q = { id: 'q1', answer: 'B', choices };
let drawn, redraws, sessions, PROG, LOG, S, drawnAt;

// The stem of every case: a fresh session, an empty record, and counters reset.
function setup(opts) {
  opts = opts || {};
  PROG = opts.prog || {}; LOG = [];
  S = { ans: {}, sel: {}, miss: {}, tried: {}, checked: {}, changes: {}, history: {}, first: {},
        qStart: Date.now() - 4000, started: Date.now() - 9000,
        // Focus fields: the ladder only runs when `focus` is set, so an ordinary session leaves S.lvl and S.streak alone.
        focus: !!opts.focus, lvl: opts.lvl || 3, streak: 0, session: opts.session || null,
        items: opts.items || [Q], i: 0 };
  drawn = 0; redraws = 0; sessions = 0;
  const refresh = () => { drawn++; drawnAt = { marker: (PROG[Q.id] || {}).marker, log: LOG.length }; };
  return lifted(createRecorder, stats, PROG, LOG, () => {}, () => {}, () => S,
    q => q.level || 3, (lvl, streak, ok) => ok ? (streak >= 2 ? Math.min(5, lvl + 1) : lvl) : Math.max(1, lvl - 1),
    refresh, () => { redraws++; }, () => { sessions++; }, () => null);
}
const answer = (env, q, letter) => { pick(S, q, letter); const res = env.REC.check(S, q); env.afterCheck(q, res); };

// 1. A wrong answer marks the record Red and redraws the home screens once - the reported bug is that it did the first
//    and not the second, so the mistake log stayed empty until the session ended.
let env = setup();
answer(env, Q, 'A');
assert.strictEqual(PROG[Q.id].marker, 'Red');
assert.strictEqual(drawn, 1, 'the first Check must redraw the home screens');
// 2. The redraw has to come after the record moves, or it draws the old state.
assert.deepStrictEqual(drawnAt, { marker: 'Red', log: 1 });
assert.deepStrictEqual(JSON.parse(LOG[0].answer_history_json).map(x => x.answer), ['A']);
assert.ok(Number.isInteger(JSON.parse(LOG[0].answer_history_json)[0].atMs));
assert.ok(redraws >= 1, 'the bank screen is drawn after every Check');

// 3. A right answer redraws too - the dashboard and topic list moved as well.
env = setup();
answer(env, Q, 'B');
assert.strictEqual(PROG[Q.id].marker, 'Green');
assert.strictEqual(drawn, 1);
assert.ok(S.checked[Q.id]);

// 4. Retry until correct: the miss leaves the question open and is recorded once; the correction that follows is neither
//    a second attempt nor a second redraw of the home screens (nothing on them moved), but the bank screen is redrawn.
env = setup();
answer(env, Q, 'A');
assert.ok(!S.checked[Q.id], 'a wrong Check keeps the question open');
assert.strictEqual(drawn, 1);
const before = redraws;
answer(env, Q, 'B');
assert.ok(S.checked[Q.id]);
assert.strictEqual(PROG[Q.id].marker, 'Red', 'only the first Check moves the record');
assert.strictEqual(LOG.length, 1, 'one attempt, however many Checks');
assert.strictEqual(drawn, 1, 'nothing on the home screens moved');
assert.ok(redraws > before);
assert.deepStrictEqual(JSON.parse(LOG[0].answer_history_json).map(x => x.answer), ['A']);
assert.deepStrictEqual(S.history[Q.id].map(x => x.answer), ['A', 'B'], 'the later try is in the answer history only');

// 5. Wrong once in an earlier sitting, right now: Orange, and still drawn.
env = setup({ prog: { q1: { question_id: 'q1', attempts: 1, corrects: 0, marker: 'Red' } } });
answer(env, Q, 'B');
assert.strictEqual(PROG[Q.id].marker, 'Orange');
assert.strictEqual(drawn, 1);

// 6. An unscorable question writes nothing, so there is nothing on the home screens to redraw (the bank screen still is).
env = setup();
const unkeyed = { id: 'u1', answer: '', choices };
answer(env, unkeyed, 'A');
assert.deepStrictEqual(PROG, {});
assert.strictEqual(LOG.length, 0);
assert.strictEqual(drawn, 0);
assert.ok(S.checked.u1 && redraws >= 1);

// 7. A practice session is saved after a scored Check, not after an unscorable one.
env = setup({ session: { name: 'Missed' } });
answer(env, Q, 'A');
assert.strictEqual(sessions, 1);
env = setup({ session: { name: 'Missed' } });
answer(env, unkeyed, 'A');
assert.strictEqual(sessions, 0);

// 8. The Focus ladder moves on the first Check only: a retry that ends right must not count as a first-try success.
const mid = { id: 'm', level: 3, answer: 'B', choices }, hard = { id: 'h', level: 4, answer: 'B', choices }, easy = { id: 'e', level: 2, answer: 'B', choices };
env = setup({ focus: true, lvl: 3, items: [mid, hard, easy] });
answer(env, mid, 'A');
assert.strictEqual(S.lvl, 2, 'a first-try miss lowers the target');
assert.deepStrictEqual(S.items.map(q => q.id), ['m', 'e', 'h'], 'what is left is reordered nearest the target');
const lvl = S.lvl, streak = S.streak;
answer(env, mid, 'B');
assert.strictEqual(S.lvl, lvl, 'the retry that ends right does not move the ladder');
assert.strictEqual(S.streak, streak);
console.log('8 cases pass');

import('../public/shared/renderer.js').then(renderer => {
  const question = { id: 'mc', answer: 'B', choices, spr: false };
  const spr = { id: 'spr', answer: '3', choices: [], spr: true };
  const { execFileSync } = require('node:child_process');
  const baseline = execFileSync('git.exe', ['show', '00cebf32:public/index.html'], { cwd: __dirname + '/..', encoding: 'utf8' });
  const original = baseline.slice(baseline.indexOf('function choiceHTML(q,'), baseline.indexOf('function loadQuestion()', baseline.indexOf('function choiceHTML(q,')));
  const baselineChoice = new Function('esc', original + '\nreturn choiceHTML;')(s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])));
  global.S = { checked: {}, miss: {}, ko: {} }; global.PROG = {};
  for (const c of [{ letter: 'A', img: '/qimg/a_a.png' }, { letter: 'B', img: '/qimg/photo.svg' }, { letter: 'C', content: '<p>one</p><p>two</p>' }])
    assert.equal(renderer.choiceHTML(question, c, null, true), baselineChoice(question, c, null, true), 'choice markup baseline parity');
  const raw = { correct_answer: 'B ΓÇö reason', choices_json: '[{"letter":"B"},{"letter":"  "}]', explanation_html: '' };
  const norm = stats.normalizeQuestion(raw);
  assert.equal(norm.choices[1].letter, 'B', 'baseline assigns fallback to blank letter');
  assert.equal(norm.answer, 'B', 'baseline decodes mojibake before extracting MC answer prefix');
  assert.equal(stats.normalizeQuestion({ choices_json:'[{"letter":"A","content":"ΓÇö"}]', correct_answer:'A' }).choices[0].content, '—');
  assert.equal(stats.normalizeQuestion({ choices_json:'[]', correct_answer:'', explanation_html:'<p>The correct answer is 8 or 9 ΓÇö.</p>' }).answer, '8 or 9');
  const figure = { ...question, section:'Math', stem_html:'<p>Question</p><div class="qfig"><img src="/qimg/chart.png"></div>', explanation_html:'<p>Explanation</p>' };
  const dom = { createElement: () => ({ innerHTML: '', querySelectorAll() { return []; } }) };
  const mcPreview = renderer.previewHTML({ ...question, explanation_html:'<p>Explanation</p>' }, dom, 'A');
  const sprPreview = renderer.previewHTML({ ...spr, stem_html:'<p>Grid</p>', explanation_html:'<p>Answer</p>' }, dom, '2');
  assert.match(mcPreview, /class="choices"/);
  assert.match(mcPreview, /Explanation/);
  assert.match(sprPreview, /disabled value="2"/);
  assert.match(renderer.previewHTML(figure, dom, 'A'), /class="cb expl"/);
  assert.match(page, /SharedRenderer\.previewHTML\(q, document\)/);
  assert.match(fs.readFileSync(__dirname + '/../admin-ui/ui.tsx', 'utf8'), /previewHTML\(q, document, picked\)/);
  console.log('grade: renderer baseline parity pass');
}).catch(e => { console.error(e.name, e.message, e.stack); process.exitCode = 1; });
