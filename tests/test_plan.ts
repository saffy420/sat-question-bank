// The Study Plan engine (lesson-ui/plan.ts): docs/plan/BRIEF.md checkpoints that are pure logic.
//
//   node --test tests/test_plan.ts        (Node 22.18+ strips the types)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../public/shared/stats.js';
import {
  advanceCycle, orderSkills, logTest, resolveLog, countBySkill, modulesOf, routesOf, blockedIds, seenIds, pickSet, newRun,
  segmentIds, closeSegment, scoreRun, nextStep, tooSoon, addDays, emptyState, nextTestNumber, SHAPES
} from '../lesson-ui/plan.ts';
import type { TestMap, TestLog, BankQ, SkillCount, PlanState, PoolContext } from '../lesson-ui/plan.ts';

const count = (misses: number, slows = 0): SkillCount => ({ misses, slows, missIds: [], slowIds: [] });

// A small map: PT1 and PT2, each RW m1 of 4, RW easy of 2 (no hard), Math m1 of 3, Math easy and hard of 2.
const Q = (id: string, skill: string, difficulty = 'Medium', extra: Partial<BankQ> = {}): BankQ => ({ id, skill, difficulty, ...extra });
const bank: BankQ[] = [
  Q('a1', 'Alpha'), Q('a2', 'Alpha'), Q('a3', 'Alpha'), Q('b1', 'Beta'), Q('b2', 'Beta'), Q('c1', 'Gamma'), Q('c2', 'Gamma'),
  Q('d1', 'Delta'), Q('d2', 'Delta'), Q('e1', 'Eps'), Q('e2', 'Eps'), Q('h1', 'Alpha', 'Hard'),
  Q('x1', 'Alpha'), Q('x2', 'Beta'), Q('x3', 'Gamma'), Q('x4', 'Delta'), Q('x5', 'Eps'), Q('x6', 'Alpha'), Q('x7', 'Beta')
];
const byId = new Map(bank.map(q => [q.id, q]));
const MAP: TestMap = { tests: [
  { id: 'PT1', number: 1, name: 'Practice Test 1', RW: { m1: ['a1', 'a2', 'b1', null], easy: ['c1', 'missing'], hard: null }, Math: { m1: ['d1', 'e1', 'a3'], easy: ['b2', 'c2'], hard: ['d2', 'e2'] } },
  { id: 'PT2', number: 2, name: 'Practice Test 2', RW: { m1: ['x1', 'x2', 'x3', 'x4'], easy: ['x5', 'h1'], hard: null }, Math: { m1: ['x6', 'x7', 'a1'], easy: ['a2', 'b1'], hard: ['c1', 'd1'] } }
] };
const log = (testId: string, date: string, marks: Record<string, string>, route = { RW: 'easy', Math: 'easy' } as TestLog['route']): TestLog =>
  ({ testId, number: Number(testId.slice(2)), date, route, marks, at: date + 'T20:00:00Z' });

test('modules follow the module-2 route; unexported routes are not offered', () => {
  const t = MAP.tests[0];
  assert.deepEqual(routesOf(t, 'RW'), ['easy']);
  assert.deepEqual(routesOf(t, 'Math'), ['easy', 'hard']);
  assert.deepEqual(modulesOf(t, { RW: 'easy', Math: 'hard' }).map(m => [m.key, m.ids?.length]), [['RW1', 4], ['RW2', 2], ['Math1', 3], ['Math2', 2]]);
  assert.deepEqual(modulesOf(t, { RW: 'hard', Math: 'easy' })[1].ids, null);
});

test('a log resolves each mark to its bank question and skill; unmapped positions count for nothing', () => {
  const l = log('PT1', '2026-10-01', { RW1: 'W.SW', RW2: 'WW', Math1: '..S', Math2: 'W' }, { RW: 'easy', Math: 'hard' });
  const items = resolveLog(MAP.tests[0], l, byId);
  assert.equal(items.length, 11);
  assert.deepEqual(items.filter(i => i.mark).map(i => [i.module, i.number, i.id, i.mark]),
    [['RW1', 1, 'a1', 'W'], ['RW1', 3, 'b1', 'S'], ['RW1', 4, null, 'W'], ['RW2', 1, 'c1', 'W'], ['RW2', 2, null, 'W'], ['Math1', 3, 'a3', 'S'], ['Math2', 1, 'd2', 'W']]);
  const c = countBySkill(items);
  assert.deepEqual(c.Alpha, { misses: 1, slows: 1, missIds: ['a1'], slowIds: ['a3'] });
  assert.deepEqual(c.Beta, { misses: 0, slows: 1, missIds: [], slowIds: ['b1'] });
  assert.deepEqual(c.Gamma, { misses: 1, slows: 0, missIds: ['c1'], slowIds: [] });
  assert.deepEqual(c.Delta, { misses: 1, slows: 0, missIds: ['d2'], slowIds: [] });
  assert.deepEqual(c.Eps, { misses: 0, slows: 0, missIds: [], slowIds: [] }, 'a tested skill with nothing marked still counts as tested');
});

test('checkpoint: plan order after logging: misses, then slows, then lower lifetime accuracy', () => {
  // Alpha 2 misses; Beta 1 miss 2 slows; Gamma 1 miss 1 slow; Delta 1 miss 1 slow, lower accuracy than Gamma; Eps slow only.
  const l = log('PT1', '2026-10-01', { RW1: 'WWWS', RW2: 'SS', Math1: 'WSS', Math2: 'SW' });
  // RW1: a1 W, a2 W, b1 W, (null) S; RW2: c1 S, missing S; Math1: d1 W, e1 S, a3 S; Math2(easy): b2 S, c2 W
  const acc = new Map<string, number | null>([['Alpha', 0.9], ['Beta', 0.5], ['Gamma', 0.6], ['Delta', 0.4], ['Eps', 0.1]]);
  const { state } = logTest(emptyState(), MAP, l, byId, acc);
  const plan = state.plan!;
  assert.deepEqual(Object.fromEntries(Object.entries(plan.counts).map(([k, v]) => [k, [v.misses, v.slows]])),
    { Alpha: [2, 1], Beta: [1, 1], Gamma: [1, 1], Delta: [1, 0], Eps: [0, 1] });
  // Beta and Gamma tie on misses and slows: Beta's lower accuracy wins. Delta has fewer slows, so it is last.
  assert.deepEqual(plan.steps.map(s => [s.kind, s.skill ?? s.number]), [
    ['drill', 'Alpha'], ['drill', 'Beta'], ['drill', 'Gamma'], ['drill', 'Delta'],
    ['consolidate', 'Alpha'], ['consolidate', 'Beta'], ['consolidate', 'Gamma'], ['consolidate', 'Delta'],
    ['test', 2]]);
  assert.deepEqual(plan.slowOnly, ['Eps'], 'a slow alone appears on the plan but makes no drill');
  assert.equal(plan.steps.at(-1)!.date, '2026-10-08', 'next test recommended a week after this one');
  assert.equal(nextStep(plan)!.id, 'PT1.d0');
});

test('slows break ties between equal misses', () => {
  const counts = { A: count(1, 0), B: count(1, 3), C: count(1, 1) };
  assert.deepEqual(orderSkills(['A', 'B', 'C'], counts, new Map()), ['B', 'C', 'A']);
  // Lifetime accuracy only after slows; a skill with no answers counts as 0.
  const tied = { A: count(1, 1), B: count(1, 1), C: count(1, 1) };
  assert.deepEqual(orderSkills(['A', 'B', 'C'], tied, new Map([['A', 0.7], ['B', null], ['C', 0.2]])), ['B', 'C', 'A']);
});

test('the slows-as-misses constant turns a slow into a drill', () => {
  const r = advanceCycle({}, { A: count(0, 2) }, true);
  assert.deepEqual(r.drill, ['A']);
  assert.deepEqual(advanceCycle({}, { A: count(0, 2) }).drill, []);
});

test('checkpoint: maintenance after two clean tests; not due on entry, then every other cycle', () => {
  let s = advanceCycle({}, { A: count(1) });
  assert.equal(s.skills.A.status, 'drilling');
  s = advanceCycle(s.skills, { A: count(0, 1) });
  assert.deepEqual([s.skills.A.status, s.skills.A.clean, s.drill, s.due], ['drilling', 1, [], []], 'one clean test is not enough');
  s = advanceCycle(s.skills, { A: count(0) });
  assert.deepEqual([s.skills.A.status, s.skills.A.clean, s.due], ['maintenance', 2, []], 'two consecutive clean tests: maintenance');
  const dueSeq: boolean[] = [];
  for (let i = 0; i < 4; i++) { s = advanceCycle(s.skills, { A: count(0) }); dueSeq.push(s.due.includes('A')); }
  assert.deepEqual(dueSeq, [true, false, true, false]);
  // A skill never missed also reaches maintenance after two clean tests.
  let n = advanceCycle({}, { N: count(0) });
  n = advanceCycle(n.skills, { N: count(0) });
  assert.equal(n.skills.N.status, 'maintenance');
  // A miss in between restarts the streak.
  let r = advanceCycle({}, { R: count(0) });
  r = advanceCycle(r.skills, { R: count(1) });
  r = advanceCycle(r.skills, { R: count(0) });
  assert.deepEqual([r.skills.R.status, r.skills.R.clean], ['drilling', 1]);
  // A skill the test did not cover keeps its state.
  const kept = advanceCycle(s.skills, { Z: count(0) });
  assert.deepEqual(kept.skills.A, s.skills.A);
});

test('checkpoint: maintenance + 2 misses -> drilling; maintenance + 1 miss -> stays, streak reset, due regardless', () => {
  const m = { A: { status: 'maintenance' as const, clean: 3, misses: 0, slows: 0, lastDue: true }, B: { status: 'maintenance' as const, clean: 3, misses: 0, slows: 0, lastDue: true } };
  const r = advanceCycle(m, { A: count(2), B: count(1) });
  assert.deepEqual([r.skills.A.status, r.skills.A.clean], ['drilling', 0]);
  assert.deepEqual(r.drill, ['A']);
  // B was due last cycle, so the schedule says "not due"; one miss makes it due anyway.
  assert.deepEqual([r.skills.B.status, r.skills.B.clean], ['maintenance', 0]);
  assert.deepEqual(r.due, ['B']);
  const clean = advanceCycle(m, { B: count(0) });
  assert.deepEqual(clean.due, [], 'without the miss B would have been skipped this cycle');
});

test('steps: drills, consolidation for each drilled skill, due maintenance, next test', () => {
  let state: PlanState = emptyState();
  // Cycle 1: Alpha and Beta missed, the rest clean.
  state = logTest(state, MAP, log('PT1', '2026-10-01', { RW1: 'W.W.', RW2: '..', Math1: '...', Math2: '..' }), byId, new Map()).state;
  assert.deepEqual(state.plan!.steps.map(s => s.id), ['PT1.d0', 'PT1.d1', 'PT1.c0', 'PT1.c1', 'PT1.t']);
  assert.deepEqual(state.plan!.steps.map(s => s.skill || ''), ['Alpha', 'Beta', 'Alpha', 'Beta', '']);
  // Cycle 2: everything clean except Beta; Gamma/Delta/Eps now have two clean tests -> maintenance, not due yet.
  state = logTest(state, MAP, log('PT2', '2026-10-08', { RW1: '.W..', RW2: '..', Math1: '...', Math2: '..' }), byId, new Map()).state;
  assert.deepEqual(state.plan!.steps.map(s => [s.kind, s.skill || s.number]), [['drill', 'Beta'], ['consolidate', 'Beta'], ['test', 3]]);
  assert.equal(state.skills.Gamma.status, 'maintenance');
  assert.equal(state.tests.length, 2);
});

test('next test is the next unlogged mapped test, else N + 1', () => {
  assert.equal(nextTestNumber(MAP, ['PT1'], 1), 2);
  assert.equal(nextTestNumber(MAP, ['PT1', 'PT2'], 2), 3);
  assert.equal(nextTestNumber(MAP, ['PT2'], 2), 3, 'an earlier unlogged test is not "next"');
});

test('[DEFAULT] a test logged under 5 days after the previous one warns', () => {
  const s = { ...emptyState(), tests: [log('PT1', '2026-10-01', {})] };
  assert.equal(tooSoon(emptyState(), '2026-10-01'), null);
  assert.equal(tooSoon(s, '2026-10-04'), 3);
  assert.equal(tooSoon(s, '2026-10-06'), null);
  assert.equal(tooSoon(s, '2026-09-28'), -3, 'a date before the last logged test also warns (the page words it differently)');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
});

// Pool: skill Alpha has unseen medium u1..u12 (u11/u12 AI), seen-right r1..r3, a seen-wrong w1, a blocked medium
// (mapped to an untaken test), a reserved one; hard: three unseen official, one AI, one seen right.
const pool: BankQ[] = [
  ...Array.from({ length: 10 }, (_, i) => Q('u' + (i + 1), 'Alpha')),
  Q('u11', 'Alpha', 'Medium', { ai: true }), Q('u12', 'Alpha', 'Medium', { ai: true }),
  Q('r1', 'Alpha'), Q('r2', 'Alpha'), Q('r3', 'Alpha'), Q('w1', 'Alpha'), Q('blk', 'Alpha'), Q('res', 'Alpha'), Q('lesson', 'Alpha'),
  Q('h1', 'Alpha', 'Hard'), Q('h2', 'Alpha', 'Hard'), Q('h3', 'Alpha', 'Hard'), Q('hai', 'Alpha', 'Hard', { ai: true }), Q('hr', 'Alpha', 'Hard'),
  Q('nokey', 'Alpha', 'Hard'), Q('easy', 'Alpha', 'Easy'), Q('other', 'Beta')
];
const progress = {
  r1: { attempts: 1, marker: 'Green', last_reviewed: '2026-09-03' }, r2: { attempts: 1, marker: 'Orange', last_reviewed: '2026-09-01' },
  r3: { attempts: 2, marker: 'Green', last_reviewed: '2026-09-02' }, w1: { attempts: 1, marker: 'Red', last_reviewed: '2026-08-01' },
  hr: { attempts: 1, marker: 'Green', last_reviewed: '2026-07-01' }
};
const ctx = (over: Partial<PoolContext> = {}): PoolContext => ({
  questions: pool, progress, seen: seenIds(progress, [{ question_id: 'w1' }], ['lesson']), blocked: new Set(['blk']), reserved: new Set(['res']),
  scorable: q => q.id !== 'nokey', seed: 'PT1.d0', ...over
});

test('checkpoint: the drill pool never includes seen questions or questions from untaken tests', () => {
  const set = pickSet('drill', 'Alpha', ctx());
  assert.equal(set.ids.length, 15);
  assert.deepEqual(set.segs.map(s => [s.level, s.n, s.limitMs]), [['Medium', 10, 600000], ['Hard', 5, 450000]]);
  for (const bad of ['r1', 'r2', 'r3', 'w1', 'blk', 'res', 'lesson', 'nokey', 'easy', 'other', 'hr']) assert.ok(!set.ids.slice(0, 10).includes(bad) || bad === 'hr', bad);
  const medium = set.ids.slice(0, 10);
  assert.deepEqual(medium.slice().sort(), Array.from({ length: 10 }, (_, i) => 'u' + (i + 1)).sort(), 'ten unseen official mediums; AI waits behind them');
  // Hard: three unseen official, then the unseen AI one, then the fallback (seen and right). Never the unscorable one.
  assert.deepEqual(set.ids.slice(10, 13).sort(), ['h1', 'h2', 'h3']);
  assert.deepEqual(set.ids.slice(13), ['hai', 'hr']);
  assert.equal(set.short, false);
  // Same step, same set; another step orders the unseen questions differently.
  assert.deepEqual(pickSet('drill', 'Alpha', ctx()).ids, set.ids);
});

test('blocked IDs are every module of each unlogged test', () => {
  assert.deepEqual([...blockedIds(MAP, ['PT1'])].sort(), ['a1', 'a2', 'b1', 'c1', 'd1', 'h1', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
  assert.equal(blockedIds(MAP, ['PT1', 'PT2']).size, 0);
});

test('short pool: fill with least-recently-seen right answers, then shrink and say so', () => {
  const few = pool.filter(q => !/^u([3-9]|1[0-2])$/.test(q.id));
  const set = pickSet('drill', 'Alpha', ctx({ questions: few }));
  // u1, u2, then right answers oldest first: r2 (09-01), r3 (09-02), r1 (09-03). Never w1 (wrong), never blocked.
  assert.deepEqual(set.ids.slice(0, 5).slice(0, 2).sort(), ['u1', 'u2']);
  assert.deepEqual(set.ids.slice(2, 5), ['r2', 'r3', 'r1']);
  assert.deepEqual(set.segs.map(s => [s.level, s.n, s.limitMs]), [['Medium', 5, 300000], ['Hard', 5, 450000]]);
  assert.equal(set.short, true);
  const none = pickSet('consolidate', 'Beta', ctx());
  assert.deepEqual([none.ids, none.segs, none.short], [[], [], true]);
  const hard = pickSet('maintain', 'Alpha', ctx());
  assert.deepEqual(hard.segs.map(s => [s.level, s.n, s.limitMs]), [['Hard', 5, 450000]]);
  assert.equal(SHAPES.drill.length, 2);
});

test('segments, overtime and the score at the end of a set', () => {
  const run = newRun({ ids: ['m1', 'm2', 'm3', 'h1'], segs: [{ level: 'Medium', n: 3, limitMs: 180000, usedMs: 0, overMs: 0 }, { level: 'Hard', n: 1, limitMs: 90000, usedMs: 0, overMs: 0 }], short: true }, '2026-10-02T00:00:00Z');
  assert.deepEqual(segmentIds(run), ['m1', 'm2', 'm3']);
  closeSegment(run, 200400);
  assert.deepEqual([run.segs[0].usedMs, run.segs[0].overMs], [200400, 20400], 'soft limit: overtime is recorded');
  run.seg = 1;
  assert.deepEqual(segmentIds(run), ['h1']);
  closeSegment(run, 60000);
  assert.equal(run.segs[1].overMs, 0);
  const qs = new Map<string, BankQ & { answer: string; choices: { letter: string }[] }>(['m1', 'm2', 'm3', 'h1'].map(id => [id, { id, answer: 'A', choices: [{ letter: 'A' }, { letter: 'B' }] }]));
  run.ans = { m1: 'A', m2: 'B', h1: 'A' };
  const r = scoreRun(run, qs, stats.isRight as never);
  assert.deepEqual(r, { right: 2, scored: 4, missed: ['m2', 'm3'] }, 'a blank is a miss on the score');
});
