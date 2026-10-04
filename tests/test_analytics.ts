// Analytics (lesson-ui/analytics/analytics.ts): the aggregation behind the Analytics tab, checked against hand arithmetic.
//
//   node --test tests/test_analytics.ts        (Node 22.18+ strips the types)
// Days are local calendar days, so the file runs in a zone where local and UTC days differ.
process.env.TZ = 'America/Los_Angeles';
import test from 'node:test';
import assert from 'node:assert/strict';
import { targetOf } from '../public/shared/stats.js';
import {
  MIN_SAMPLE, rate, short, fmtTime, rangeStart, inRange, buckets, heat, streak, dayKey, totals, sectionStats, skillStats,
  lowestAccuracy, slowestVsTarget, skillDrill, takeSections, takeDifficulty, takeTime, takeLowest, takeSlowest, takeGuessing,
  takePacing, takeLevels, takeWeakest, overLabel
} from '../lesson-ui/analytics/analytics.ts';
import type { AQuestion, AAttempt } from '../lesson-ui/analytics/analytics.ts';

const Q = (id: string, section: string, skill: string, difficulty: string, level?: number): AQuestion =>
  ({ id, section, skill, difficulty, level: level ?? ({ Easy: 1, Medium: 2, Hard: 3 } as Record<string, number>)[difficulty] });
const RW = 'Reading & Writing', M = 'Math';
// Recommended times (targetOf: skill base x difficulty factor, nearest 5 s) worked out by hand beside each.
const QS = [
  Q('w1', RW, 'Words in Context', 'Easy'),            // 60 x 0.75 = 45s
  Q('w2', RW, 'Words in Context', 'Medium'),          // 60s
  Q('w3', RW, 'Words in Context', 'Hard'),            // 60 x 1.3 = 78 -> 80s
  Q('t', RW, 'Transitions', 'Medium'),                // 50s
  Q('b', RW, 'Boundaries', 'Medium'),                 // 50s
  Q('c', M, 'Circles', 'Hard'),                       // 120 x 1.3 = 156 -> 155s
  Q('l', M, 'Linear functions', 'Medium'),            // 80s
  Q('p', M, 'Percentages', 'Easy'),                   // 75 x 0.75 = 56.25 -> 55s
  Q('v', M, 'Area and volume', 'Medium')              // 110s
];
const S = 1000;
let tick = 0;
const at = () => new Date(Date.UTC(2026, 8, 1, 12, tick++)).toISOString();
const A = (id: string, correct: number[], secs: number[]): AAttempt[] =>
  correct.map((c, i) => ({ question_id: id, ts: at(), correct: c, time_taken_ms: secs[i] * S }));
const LOG: AAttempt[] = [
  // Words in Context: 6 answers, 2 right = 33%; 6 x 70s = 420s against 45+45+60+60+80+80 = 370s -> +8.3s, +14%.
  ...A('w1', [1, 0], [70, 70]), ...A('w2', [0, 0], [70, 70]), ...A('w3', [1, 0], [70, 70]),
  // Transitions: 5 answers, 4 right = 80%; 80s against 50s -> +30s, +60%.
  ...A('t', [1, 1, 1, 1, 0], [80, 80, 80, 80, 80]),
  // Boundaries: 5 answers, 2 right = 40%; only 3 timed, so it is not on the slow list.
  ...A('b', [1, 1, 0, 0, 0], [40, 40, 40, 0, 0]),
  // Circles: 7 answers, 3 right = 43%; 200s against 155s -> +45s, +29%.
  ...A('c', [1, 1, 1, 0, 0, 0, 0], [200, 200, 200, 200, 200, 200, 200]),
  // Linear functions: 5 answers, all right = 100%; 60s against 80s -> -20s, -25%.
  ...A('l', [1, 1, 1, 1, 1], [60, 60, 60, 60, 60]),
  // Percentages: 6 answers, 3 right = 50%; 66s against 55s -> +11s, +20%.
  ...A('p', [1, 1, 1, 0, 0, 0], [66, 66, 66, 66, 66, 66]),
  // Area and volume: 4 answers, below the floor on both lists.
  ...A('v', [0, 0, 0, 0], [100, 100, 100, 100]),
  // Not graded, or not a known question: never counted.
  { question_id: 'c', ts: at(), correct: null, time_taken_ms: 5000 }, { question_id: 'gone', ts: at(), correct: 1, time_taken_ms: 5000 }
];

test('the targets in the fixture are the ones targetOf gives', () => {
  assert.deepEqual(QS.map(q => targetOf(q) / S), [45, 60, 80, 50, 50, 155, 80, 55, 110]);
});

test('5 lowest-accuracy skills: at least 5 answers, lowest first', () => {
  const rows = lowestAccuracy(skillStats(QS, LOG, targetOf));
  assert.deepEqual(rows.map(r => [r.skill, r.section, r.a, r.c, r.pct]), [
    ['Words in Context', RW, 6, 2, 33],
    ['Boundaries', RW, 5, 2, 40],
    ['Circles', M, 7, 3, 43],
    ['Percentages', M, 6, 3, 50],
    ['Transitions', RW, 5, 4, 80]
  ]);
  assert.equal(takeLowest(rows), 'Words in Context is your weakest skill: 33% over 6 answers.');
});

test('5 skills slowest vs target: at least 5 timed answers, furthest over (in percent) first', () => {
  const rows = slowestVsTarget(skillStats(QS, LOG, targetOf));
  assert.deepEqual(rows.map(r => [r.skill, Math.round(r.avgMs / S), Math.round(r.targetMs / S), overLabel(r.overMs), r.overPct]), [
    ['Transitions', 80, 50, '+30s', 60],
    ['Circles', 200, 155, '+45s', 29],
    ['Percentages', 66, 55, '+11s', 20],
    ['Words in Context', 70, 62, '+8s', 14],
    ['Linear functions', 60, 80, '−20s', -25]
  ]);
  assert.equal(takeSlowest(rows), 'Transitions runs 30s (60%) over target.');
  assert.equal(takeSlowest(rows.slice(4)), 'No skill you have timed is over target.');
});

test('ties: the same accuracy ranks the skill with more answers first', () => {
  const qs = [Q('x', M, 'Circles', 'Easy'), Q('y', M, 'Percentages', 'Easy')];
  const log = [...A('x', [1, 0, 0, 0, 0], [60, 60, 60, 60, 60]), ...A('y', [1, 1, 0, 0, 0, 0, 0, 0, 0, 0], Array(10).fill(60))];
  assert.deepEqual(lowestAccuracy(skillStats(qs, log, targetOf)).map(r => r.skill), ['Percentages', 'Circles']);
});

test('sections and difficulty: rings and rows, nothing below the floor', () => {
  const g = sectionStats(QS, LOG, targetOf);
  // R&W: 6 + 5 + 5 = 16 answers, 2 + 4 + 2 = 8 right. Math: 7 + 5 + 6 + 4 = 22, 3 + 5 + 3 + 0 = 11.
  assert.deepEqual([g[RW].a, g[RW].c, rate(g[RW]), g[M].a, g[M].c, rate(g[M])], [16, 8, 50, 22, 11, 50]);
  assert.equal(takeSections(g), 'Both sections are at 50%.');
  // R&W Easy and Hard are two answers each: no percentage, and the card says how many more it needs.
  assert.deepEqual(['Easy', 'Medium', 'Hard'].map(d => rate(g[RW].diff[d])), [null, 50, null]);
  assert.equal(short(g[RW].diff.Easy.a), 3);
  // Math: Easy 3/6, Medium 5/9 = 56%, Hard 3/7 = 43%.
  assert.deepEqual(['Easy', 'Medium', 'Hard'].map(d => rate(g[M].diff[d])), [50, 56, 43]);
  assert.equal(takeDifficulty(M, g[M]), 'Hard Math is where you lose the most: 43% right.');
  assert.equal(takeDifficulty(RW, g[RW]), 'Medium Reading & Writing: 50% right so far.');
  // Time: Hard 200s vs 155s = +45; Easy +11; Medium (5 x 60 + 4 x 100) / 9 = 77.8 vs (5 x 80 + 4 x 110) / 9 = 93.3.
  assert.equal(takeTime(M, g[M]), 'Hard Math is 45s over target on average.');
  assert.equal(g[M].diff.Hard.ms + g[M].diff.Medium.ms + g[M].diff.Easy.ms, g[M].ms, 'the time shares add up to the section');
});

test('one wrong answer is never 0%', () => {
  const t = totals(QS, [{ question_id: 'c', ts: at(), correct: 0, time_taken_ms: 1000 }], targetOf);
  assert.equal(rate(t), null);
  assert.equal(short(t.a), MIN_SAMPLE - 1);
  assert.equal(takeSections(sectionStats(QS, [], targetOf)), null);
  assert.deepEqual(lowestAccuracy(skillStats(QS, [], targetOf)), []);
  assert.equal(takeLowest([]), null);
});

test('range: days end today on the local calendar, 12 months are calendar months, 0 is everything', () => {
  const now = new Date(2026, 9, 4, 15, 0);
  assert.equal(rangeStart(0, now), null);
  assert.equal(rangeStart(1, now)!.getTime(), new Date(2026, 9, 4).getTime());
  assert.equal(rangeStart(7, now)!.getTime(), new Date(2026, 8, 28).getTime());
  assert.equal(rangeStart(365, now)!.getTime(), new Date(2025, 10, 1).getTime());
  // 10:30pm on the 3rd in Los Angeles is already the 4th in UTC: it is yesterday here, not today.
  const late = { question_id: 'c', ts: '2026-10-04T05:30:00Z', correct: 1 };
  assert.equal(dayKey(new Date(late.ts)), '2026-10-03');
  assert.equal(inRange([late], 1, now).length, 0);
  assert.equal(inRange([late], 7, now).length, 1);
  const bs = buckets([late], 7, now);
  assert.equal(bs.length, 7);
  assert.deepEqual(bs.map(b => b.ok), [0, 0, 0, 0, 0, 1, 0]);
  const months = buckets([late], 365, now);
  assert.equal(months.length, 12);
  assert.equal(months[11].ok, 1);
  assert.equal(buckets([{ question_id: 'c', ts: '2025-12-15T12:00:00Z', correct: 0 }], 0, now).length, 11, 'all time runs from the first month');
});

test('heat map and streak count local days', () => {
  const now = new Date(2026, 9, 4, 9, 0);   // a Sunday morning, nothing yet today
  const log = [-1, -2, -2, -4].map(d => ({ question_id: 'c', ts: new Date(2026, 9, 4 + d, 23, 15).toISOString(), correct: 1 }));
  assert.equal(streak(log, now), 2, 'an empty today does not break the run until the day is over');
  const h = heat(log, now);
  assert.equal(h.cells.length, 26 * 7);
  assert.equal(h.days, 3);
  assert.equal(h.cells.find(c => c.key === '2026-10-02')!.ok, 2);
  assert.equal(h.cells.filter(c => c.future).length, 6, 'the grid runs to Saturday');
});

test('Practice: one skill, unseen first, levels taken in turn', () => {
  const qs = [Q('e1', M, 'Circles', 'Easy'), Q('e2', M, 'Circles', 'Easy'), Q('m1', M, 'Circles', 'Medium'), Q('h1', M, 'Circles', 'Hard'),
    Q('ai', M, 'Circles', 'Hard', 5), Q('x', M, 'Percentages', 'Easy')];
  const prog = { e1: { attempts: 1, last_reviewed: '2026-09-01T00:00:00Z' }, m1: { attempts: 1, last_reviewed: '2026-08-01T00:00:00Z' } };
  assert.deepEqual(skillDrill(qs, prog, 'Circles').map(q => q.id), ['e2', 'h1', 'ai', 'm1', 'e1']);
  assert.deepEqual(skillDrill(qs, prog, 'Circles', 2).map(q => q.id), ['e2', 'h1']);
  assert.deepEqual(skillDrill(qs, prog, 'Nothing'), []);
});

test('takeaways for the cards that keep their old numbers', () => {
  assert.equal(takePacing({ rushed: 1, onPace: 2, slow: 1 }), null);
  assert.equal(takePacing({ rushed: 2, onPace: 6, slow: 2 }), '60% of your timed answers are on pace; 20% rushed, 20% slow.');
  assert.equal(takeGuessing({ n: 9, changedN: 4, changedAcc: 50, steadyAcc: 80 }), null);
  assert.equal(takeGuessing({ n: 10, changedN: 5, changedAcc: 40, steadyAcc: 80 }), 'Changing your answer costs you: 40% right vs 80% when you kept your first pick.');
  assert.equal(takeLevels({ 1: { a: 10, c: 9 }, 3: { a: 5, c: 2 }, 5: { a: 2, c: 0 } }), 'Level 3 is your weakest at 40%.');
  assert.equal(takeWeakest({ Algebra: { a: 10, c: 9 }, Geometry: { a: 4, c: 0 } }, 'domain'), 'Your weakest domain right now is Algebra at 90%.');
  assert.deepEqual([fmtTime(46000), fmtTime(74000), fmtTime(120000), fmtTime(97 * 60000)], ['46s', '1m 14s', '2m', '1h 37m']);
});
