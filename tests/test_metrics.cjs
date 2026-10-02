// The derived metrics, lifted out of public/index.html by their markers so a copy
// here cannot drift from what ships.
//   node tests/test_metrics.cjs
const fs = require('fs');
const assert = require('assert');

const { pathToFileURL } = require('node:url');
const src = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
assert.match(src, /import \* as Stats from '\/shared\/stats.js'/);
const stats = import(pathToFileURL(__dirname + '/../public/shared/stats.js'));
const api = (QS, PROG, LOG) => ({
  trapCounts: () => statsModule.trapCounts(QS, LOG), pacing: () => statsModule.pacing(QS, LOG),
  guessing: () => statsModule.guessing(LOG), levelOf: q => statsModule.levelOf(q), targetOf: q => statsModule.targetOf(q)
});
let statsModule;

const QS = [
  { id: 'q1', section: 'Math', skill: 'Circles', difficulty: 'Hard',
    choices: [{ letter: 'A', content: 'a' }, { letter: 'B', content: 'b', trap: 'sign-flip' }] },
  { id: 'ai_rw001', section: 'Reading & Writing', skill: 'Transitions', difficulty: 'Hard', level: 5,
    choices: [{ letter: 'A', content: 'a' }, { letter: 'C', content: 'c', trap: 'too-extreme' }] },
  { id: 'q2', section: 'Math', difficulty: 'Easy', choices: [] }
];
const LOG = [
  { question_id: 'q1', ts: 'T1', correct: 0, time_taken_ms: 40000, picked: 'B', changes: 0 },
  { question_id: 'q1', ts: 'T2', correct: 1, time_taken_ms: 95000, picked: 'A', changes: 3 },
  { question_id: 'ai_rw001', ts: 'T3', correct: 0, time_taken_ms: 200000, picked: 'C', changes: 1 }
];
stats.then(module => {
statsModule = module;
const a = api(QS, {}, LOG);

assert.deepStrictEqual(a.trapCounts(), [['sign-flip', 1], ['too-extreme', 1]],
  'a wrong pick must be counted against the trap its own choice carries');

// A correct answer never counts as a trap, however it was reached.
const onlyRight = api(QS, {}, [{ question_id: 'q1', ts: 'T', correct: 1, picked: 'B', changes: 0 }]);
assert.deepStrictEqual(onlyRight.trapCounts(), [], 'a correct attempt was counted as a trap');

const p = a.pacing();
assert.strictEqual(p.rushed, 1, '40s against a 155s Hard Circles target is rushed');
assert.strictEqual(p.onPace, 1, '95s against a 155s Hard Circles target is on pace');
assert.strictEqual(p.slow, 1, '200s against a 75s level-5 Transitions target is slow');
assert.strictEqual(p.n['Math'], 2, 'per-section counts are wrong');

const g = a.guessing();
assert.strictEqual(g.mean, 4 / 3, 'mean switches over three attempts');
assert.strictEqual(g.changedN, 2, 'two attempts had a switch');
assert.strictEqual(g.changedAcc, 50, 'one of the two switched attempts was right');
assert.strictEqual(g.steadyAcc, 0, 'the single unswitched attempt was wrong');

// Rows written before this shipped have no `changes` and must not be averaged in.
const old = api(QS, {}, [{ question_id: 'q1', ts: 'T', correct: 1, time_taken_ms: 1000 }]);
assert.strictEqual(old.guessing().n, 0, 'attempts predating the column were counted');

assert.strictEqual(a.levelOf(QS[0]), 3, 'official Hard is level 3');
assert.strictEqual(a.levelOf(QS[1]), 5, 'an AI row keeps its stored level');
assert.strictEqual(a.levelOf(QS[2]), 1, 'official Easy is level 1');
assert.strictEqual(a.targetOf(QS[1]), 75000, 'level-5 Transitions target');
assert.strictEqual(a.targetOf(QS[2]), 70000, 'no skill or domain falls back to the Math section time (95s x 0.75, to 5s)');
console.log('metrics: all cases hold');
}).catch(e => { console.error(e); process.exitCode = 1; });
