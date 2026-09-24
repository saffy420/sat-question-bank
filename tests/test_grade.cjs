// Self-check for grade() in public/index.html.
//
// The function lives inside the page's IIFE, so it is lifted out by its markers
// rather than duplicated here - a copy would drift from the one that ships.
// Its free variables (S, PROG, refresh, ...) resolve to globals at call time,
// which is what lets them be stubbed.
//
//   node tests/test_grade.cjs
const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
const block = page.slice(page.indexOf('function rememberAnswer('), page.indexOf('// --- end grade ---'));
if (!block) throw new Error('grade block not found in public/index.html');
const grade = new Function(block + '\nreturn grade;')();

const Q = { id: 'q1', answer: 'B', choices: [{letter:'A'},{letter:'B'}] };
let drawn, saved, logged;

// The stem of every case: a fresh session, an empty record, and counters reset.
function setup(opts) {
  opts = opts || {};
  global.PROG = opts.prog || {};
  global.LOG = [];
  global.SET = { retry: !!opts.retry };
  global.S = { ans: {}, sel: {}, ko: {}, miss: {}, tried: {}, checked: {}, changes: {}, history: {},
                qStart: Date.now(), started: Date.now(),
               // Focus fields: the ladder only runs when `focus` is set, so an
               // ordinary session leaves S.lvl and S.streak alone.
               focus: !!opts.focus, lvl: opts.lvl || 3, streak: 0,
               items: opts.items || [Q], i: 0 };
  global.levelOf = (q) => q.level || 3;
  global.nextLevel = (lvl, streak, ok) =>
    ok ? (streak >= 2 ? Math.min(5, lvl + 1) : lvl) : Math.max(1, lvl - 1);
  drawn = 0; saved = []; logged = [];
  global.refresh = () => { drawn++; drawnAt = { marker: (PROG[Q.id]||{}).marker, log: LOG.length }; };
  global.saveProgress = (r) => saved.push(...r);
  global.saveLog = (r) => logged.push(...r);
  global.renderAnswerArea = () => {};
  global.isRight = (q, v) => (v == null ? null : v === q.answer);
}
let drawnAt;

// 1. A wrong answer marks the record Red and redraws - the reported bug is that
//    it did the first and not the second, so the mistake log stayed empty until
//    the session ended.
setup();
S.ans[Q.id] = 'A';
grade(Q);
assert.strictEqual(PROG[Q.id].marker, 'Red');
assert.strictEqual(drawn, 1, 'a wrong answer must redraw the home screens');

// 2. The redraw has to come after the record moves, or it draws the old state.
assert.deepStrictEqual(drawnAt, { marker: 'Red', log: 1 });
assert.deepStrictEqual(JSON.parse(LOG[0].answer_history_json).map(x => x.answer), ['A']);
assert.ok(Number.isInteger(JSON.parse(LOG[0].answer_history_json)[0].atMs));

// 3. A right answer redraws too - the dashboard and topic list moved as well.
setup();
S.ans[Q.id] = 'B';
grade(Q);
assert.strictEqual(PROG[Q.id].marker, 'Green');
assert.strictEqual(drawn, 1);

// 4. Retry mode: a miss leaves the question open, and is still logged and drawn.
setup({ retry: true });
S.ans[Q.id] = 'A';
grade(Q);
assert.strictEqual(PROG[Q.id].marker, 'Red');
assert.ok(!S.checked[Q.id], 'retry mode keeps the question open');
assert.strictEqual(drawn, 1);
//    ... and the correction that follows does not walk the record to Green,
//    but is still an attempt, so it still redraws.
S.ans[Q.id] = 'B';
grade(Q);
assert.strictEqual(PROG[Q.id].marker, 'Red', 'only the first Check moves the record');
assert.strictEqual(LOG.length, 2);
assert.strictEqual(drawn, 2);
assert.deepStrictEqual(JSON.parse(logged[0].answer_history_json).map(x => x.answer), ['A']);
assert.strictEqual(S.changes[Q.id], 0, 'switch counter resets after scored retry');
S.ans[Q.id] = 'A';
S.history[Q.id] = [{ answer:'B', atMs:0 }];
grade(Q);
assert.deepStrictEqual(JSON.parse(LOG.at(-1).answer_history_json).map(x => x.answer), ['B','A']);
assert.equal(S.changes[Q.id],0);

// 5. Wrong once in an earlier sitting, right now: Orange, and still drawn.
setup({ prog: { q1: { question_id:'q1', attempts:1, corrects:0, marker:'Red' } } });
S.ans[Q.id] = 'B';
grade(Q);
assert.strictEqual(PROG[Q.id].marker, 'Orange');
assert.strictEqual(drawn, 1);

// 6. An unscorable question writes nothing, so there is nothing to redraw.
setup();
S.ans[Q.id] = null;
grade(Q);
assert.deepStrictEqual(PROG, {});
assert.strictEqual(LOG.length, 0);
assert.strictEqual(drawn, 0);

// Reproduce real SPR Check path: refresh must finish before checked answer re-renders.
// bars() is lifted from the dashboard, not reimplemented; grading calls refresh().
import('../public/shared/stats.js').then(async stats => {
  const barsBlock = page.slice(page.indexOf('const bars ='), page.indexOf('function drawDash()'));
  const bars = new Function('cbSort', 'pctOf', 'esc', 'accHTML', barsBlock + '\nreturn bars;')(
    stats.cbSort, v => v.a ? Math.round(v.c / v.a * 100) : null, String, String);
  const answerBlock = page.slice(page.indexOf('function renderAnswerArea(q)'), page.indexOf('const isRight = Stats.isRight;'));
  const answerArea = new Function(answerBlock + '\nreturn renderAnswerArea;')();
  const spr = { id: 'spr', answer: '3', choices: [], spr: true };
  setup({ items: [spr] });
  S.ans.spr = '3';
  const verdict = { innerHTML: '' }, gi = {};
  const target = { set innerHTML(html) {
    this.html = html;
    verdict.innerHTML = ''; // DOM replacement removes earlier verdict
  } };
  global.$ = id => ({ 'answer-area': target, gi, 'spr-verdict': verdict })[id];
  global.esc = String;
  global.mathify = global.renderNoteChip = () => {};
  global.isRight = stats.isRight;
  global.renderAnswerArea = answerArea;
  global.refresh = () => { bars({ Algebra: { a: 1, c: 1 }, 'Advanced Math': { a: 1, c: 0 } }); drawn++; };
  grade(spr);
  assert.equal(S.checked.spr, true);
  assert.match(target.html, /id="gi"[^>]*disabled/);
  assert.match(verdict.innerHTML, /✓ Correct/, 'SPR verdict must render after dashboard refresh');

  // Real rememberAnswer and grade: a retry must keep prior attempt snapshot immutable.
  setup({ retry: true });
  global.isRight = stats.isRight;
  const mc = { id: 'mc', answer: 'B', choices: [{ letter: 'A' }, { letter: 'B' }] };
  S.history.mc = [{ answer: 'A', atMs: 1 }]; S.ans.mc = 'A';
  grade(mc);
  const firstAttempt = LOG[0];
  assert.deepStrictEqual(JSON.parse(firstAttempt.answer_history_json).map(x => x.answer), ['A']);
  assert.deepStrictEqual(S.history.mc, [], 'new retry begins with empty selection history');
  S.ans.mc = 'B'; grade(mc);
  assert.deepStrictEqual(JSON.parse(firstAttempt.answer_history_json).map(x => x.answer), ['A']);
  assert.deepStrictEqual(JSON.parse(LOG[1].answer_history_json).map(x => x.answer), ['B']);

  // SPR onchange(2), onchange(3), submit(3), grade(3): one switch, not two.
  setup(); global.isRight = stats.isRight;
  S.history.spr = []; S.ans.spr = '3';
  const remember = new Function(block + '\nreturn rememberAnswer;')();
  remember(spr, '2'); remember(spr, '3'); remember(spr, '3'); grade(spr);
  assert.equal(LOG[0].changes, 1);
  assert.deepStrictEqual(JSON.parse(LOG[0].answer_history_json).map(x => x.answer), ['2', '3']);
  // Reproduce MC stale closure after keyboard re-render: Check must grade current pick.
  const choices = [{ letter: 'A' }, { letter: 'B' }];
  const question = { id: 'mc', answer: 'B', choices, spr: false };
  setup(); global.isRight = stats.isRight;
  const renderer = await import('../public/shared/renderer.js');
  const render = new Function('choiceHTML', answerBlock + '\nreturn renderAnswerArea;')(
    (q, c, picked, staticMode) => renderer.choiceHTML(q, c, picked, staticMode, S, PROG));
  const nodes = [];
  const choice = letter => {
    const chk = { dataset: { chk: letter }, remove() {} };
    const ko = {};
    const el = { dataset: { letter }, parentElement: { querySelector: () => ko },
      querySelector: key => key === '.chk-btn' ? chk : null,
      classList: { add() {}, remove() {} }, appendChild(node) { this.button = node; } };
    return { el, chk };
  };
  const area = { set innerHTML(html) { this.html = html; nodes.splice(0, nodes.length, choice('A'), choice('B')); },
    querySelectorAll: () => nodes.map(n => n.el) };
  global.$ = id => id === 'answer-area' ? area : undefined;
  global.document = { createElement: () => ({ className: '', textContent: '' }) };
  global.esc = String;
  global.mathify = global.renderNoteChip = () => {};
  global.renderAnswerArea = render;
  global.rememberAnswer = remember;
  global.grade = grade;
  render(question);
  nodes[0].el.onclick({ target: { closest: () => null } });
  S.sel.mc = 'B'; // keyboard selection switches state then re-renders answer area
  render(question);
  nodes[1].chk.onclick({ stopPropagation() {} });
  assert.equal(S.ans.mc, 'B', 'Check must grade selected answer after keyboard re-render');
  setup(); global.isRight = stats.isRight;
  render(question);
  nodes[0].el.onclick({ target: { closest: () => null } });
  nodes[1].el.onclick({ target: { closest: () => null } });
  nodes[1].chk.onclick({ stopPropagation() {} });
  assert.equal(S.ans.mc, 'B', 'Check after clicking A then B must grade B');
  assert.deepStrictEqual(JSON.parse(LOG[0].answer_history_json).map(x => x.answer), ['A', 'B']);
  setup(); global.isRight = stats.isRight;
  render(question);
  nodes[0].el.onclick({ target: { closest: () => ({}) } });
  assert.equal(S.sel.mc, undefined, 'highlight click must not select choice');
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
  assert.match(fs.readFileSync(__dirname + '/../public/admin.js', 'utf8'), /previewHTML\(q, document, m\.picked\)/);
  console.log('grade: SPR refresh, retry snapshots, SPR switch count, MC keyboard Check, renderer baseline parity pass');
}).catch(e => { console.error(e.name, e.message, e.stack); process.exitCode = 1; });

console.log('6 cases pass');
