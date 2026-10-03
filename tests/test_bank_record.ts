// The practice record path (lesson-ui/record.ts) through the real stats functions.
//
//   node --test tests/test_bank_record.ts        (Node 22.18+ strips the types)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../public/shared/stats.js';
import { createRecorder, pick, commit, remember, firstTry, outcome, SHOW_ANSWER_AFTER } from '../lesson-ui/record.ts';
import type { PracticeState, Question, Progress, Attempt } from '../lesson-ui/record.ts';

const MC: Question = { id: 'mc', answer: 'B', choices: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }] };
const SPR: Question = { id: 'spr', answer: '3', spr: true, choices: [] };
const NOKEY: Question = { id: 'nokey', answer: '', choices: [{ letter: 'A' }, { letter: 'B' }] };

function setup(prog: Record<string, Progress> = {}) {
  const log: Attempt[] = [], savedProgress: Progress[] = [], savedLog: Attempt[] = [];
  const rec = createRecorder({ stats, prog: () => prog, log: () => log, saveProgress: r => savedProgress.push(...r), saveLog: r => savedLog.push(...r) });
  const T0 = 1_700_000_000_000;
  const S: PracticeState = { started: T0, qStart: T0, ans: {}, sel: {}, tried: {}, checked: {}, miss: {}, changes: {}, history: {} };
  return { rec, S, prog, log, savedProgress, savedLog, T0 };
}
const answers = (a: Attempt) => JSON.parse(a.answer_history_json!).map((x: { answer: string }) => x.answer);

test('wrong, wrong, right: one attempt, the first-try result and the time to the first Check', () => {
  const { rec, S, prog, log, savedProgress, savedLog, T0 } = setup();
  S.qStart = T0;
  pick(S, MC, 'A', T0 + 1000);
  const first = rec.check(S, MC, T0 + 4000)!;
  assert.deepEqual(first, { ok: false, first: true, closed: false, recorded: true });
  assert.equal(S.checked.mc, undefined, 'a wrong Check leaves the question open');
  assert.equal(S.sel.mc, null, 'the wrong pick is cleared');
  pick(S, MC, 'C', T0 + 9000);
  assert.deepEqual(rec.check(S, MC, T0 + 12000), { ok: false, first: false, closed: false, recorded: false });
  pick(S, MC, 'B', T0 + 20000);
  const last = rec.check(S, MC, T0 + 25000)!;
  assert.deepEqual(last, { ok: true, first: false, closed: true, recorded: false });
  assert.equal(S.checked.mc, true);
  assert.deepEqual(S.miss.mc, ['A', 'C']);

  assert.equal(log.length, 1, 'one attempt, not one per Check');
  assert.equal(savedLog.length, 1);
  assert.equal(log[0].correct, 0, 'the first-try result, not the eventual one');
  assert.equal(log[0].picked, 'A');
  assert.equal(log[0].time_taken_ms, 4000, 'the time to the FIRST Check');
  assert.deepEqual(answers(log[0]), ['A'], 'the recorded history ends at the recorded pick');
  assert.equal(savedProgress.length, 1, 'the record moved once');
  assert.deepEqual({ a: prog.mc.attempts, c: prog.mc.corrects, m: prog.mc.marker, t: prog.mc.time_taken_ms }, { a: 1, c: 0, m: 'Red', t: 4000 });
  assert.deepEqual(S.history!.mc.map(x => x.answer), ['A', 'C', 'B'], 'later tries go into the answer history');
  assert.equal(firstTry(S, MC, stats.isRight), false);
  assert.equal(outcome(S, MC, prog.mc.marker, stats.isRight), 'wrong');
});

test('right first try: Green, one attempt; wrong earlier and right in a later sitting: Orange', () => {
  const a = setup();
  pick(a.S, MC, 'B', a.T0 + 500);
  assert.deepEqual(a.rec.check(a.S, MC, a.T0 + 2000), { ok: true, first: true, closed: true, recorded: true });
  assert.equal(a.prog.mc.marker, 'Green');
  assert.equal(a.log.length, 1);
  assert.equal(a.log[0].correct, 1);
  assert.equal(outcome(a.S, MC, a.prog.mc.marker, stats.isRight), 'correct');

  const b = setup({ mc: { question_id: 'mc', attempts: 1, corrects: 0, marker: 'Red' } });
  pick(b.S, MC, 'B', b.T0 + 500);
  b.rec.check(b.S, MC, b.T0 + 2000);
  assert.equal(b.prog.mc.marker, 'Orange');
  assert.equal(outcome(b.S, MC, b.prog.mc.marker, stats.isRight), 'corrected');
});

test('a retry can never walk a question to Green', () => {
  const { rec, S, prog, log, T0 } = setup();
  for (const letter of ['A', 'C', 'D', 'B']) { pick(S, MC, letter, T0 + 100); rec.check(S, MC, T0 + 200); }
  assert.equal(S.checked.mc, true);
  assert.equal(prog.mc.marker, 'Red');
  assert.equal(prog.mc.attempts, 1);
  assert.equal(log.length, 1);
});

test('SPR: three wrong Checks offer Show answer; the attempt stays wrong', () => {
  const { rec, S, prog, log, T0 } = setup();
  for (let n = 1; n <= SHOW_ANSWER_AFTER; n++) {
    assert.equal(rec.showAnswer(S, SPR), false, `not offered after ${n - 1} wrong Checks`);
    commit(S, SPR, String(n * 10), T0 + n * 1000);
    assert.equal(rec.check(S, SPR, T0 + n * 1000 + 5)!.ok, false);
  }
  assert.equal(S.checked.spr, undefined);
  assert.deepEqual(S.miss.spr, ['10', '20', '30']);
  assert.equal(rec.showAnswer(S, SPR), true);
  assert.equal(S.checked.spr, true);
  assert.equal(S.shown!.spr, true);
  assert.equal(log.length, 1);
  assert.equal(log[0].correct, 0);
  assert.equal(log[0].picked, '10');
  assert.equal(prog.spr.marker, 'Red');
  assert.equal(firstTry(S, SPR, stats.isRight), false);
  assert.equal(rec.showAnswer(S, MC), false, 'multiple choice has no Show answer');
});

test('SPR right after two misses closes; nothing more is recorded', () => {
  const { rec, S, log, T0 } = setup();
  commit(S, SPR, '1', T0 + 10); rec.check(S, SPR, T0 + 20);
  commit(S, SPR, '2', T0 + 30); rec.check(S, SPR, T0 + 40);
  commit(S, SPR, '3', T0 + 50);
  assert.deepEqual(rec.check(S, SPR, T0 + 60), { ok: true, first: false, closed: true, recorded: false });
  assert.equal(log.length, 1);
  assert.equal(S.shown, undefined);
});

test('an unscorable question (no stored answer) closes and records nothing', () => {
  const { rec, S, prog, log, savedProgress, T0 } = setup();
  pick(S, NOKEY, 'A', T0);
  assert.deepEqual(rec.check(S, NOKEY, T0 + 10), { ok: null, first: true, closed: true, recorded: false });
  assert.equal(S.checked.nokey, true);
  assert.deepEqual(prog, {});
  assert.equal(log.length, 0);
  assert.equal(savedProgress.length, 0);
  assert.equal(outcome(S, NOKEY, undefined, stats.isRight), 'unscored');
});

test('giveUp before any Check: one wrong first try timed to now, then closed with the answer shown', () => {
  const { rec, S, prog, log, savedLog, T0 } = setup();
  pick(S, MC, 'A', T0 + 1000);
  assert.deepEqual(rec.giveUp(S, MC, T0 + 7000), { ok: false, first: true, closed: true, recorded: true });
  assert.equal(S.checked.mc, true);
  assert.equal(S.shown!.mc, true);
  assert.equal(log.length, 1);
  assert.equal(savedLog.length, 1);
  assert.deepEqual({ c: log[0].correct, t: log[0].time_taken_ms, p: log[0].picked }, { c: 0, t: 7000, p: '' });
  assert.equal(prog.mc.marker, 'Red');
  assert.equal(outcome(S, MC, prog.mc.marker, stats.isRight), 'wrong');
  assert.equal(rec.giveUp(S, MC, T0 + 9000), null, 'a closed question cannot be given up again');
  assert.equal(log.length, 1);
});

test('giveUp after a wrong Check records nothing new', () => {
  const { rec, S, prog, log, T0 } = setup();
  pick(S, MC, 'A', T0 + 100); rec.check(S, MC, T0 + 2000);
  assert.deepEqual(rec.giveUp(S, MC, T0 + 9000), { ok: false, first: false, closed: true, recorded: false });
  assert.equal(log.length, 1);
  assert.equal(log[0].picked, 'A');
  assert.equal(log[0].time_taken_ms, 2000);
  assert.equal(prog.mc.attempts, 1);
  assert.equal(S.checked.mc, true);
  assert.equal(firstTry(S, MC, stats.isRight), false);
});

test('giveUp on a grid-in closes it without three misses; on an unscorable question it records nothing', () => {
  const a = setup();
  assert.equal(a.rec.giveUp(a.S, SPR, a.T0 + 500)!.recorded, true);
  assert.equal(a.S.checked.spr, true);
  assert.equal(a.prog.spr.marker, 'Red');
  const b = setup();
  assert.deepEqual(b.rec.giveUp(b.S, NOKEY, b.T0), { ok: null, first: true, closed: true, recorded: false });
  assert.equal(b.S.checked.nokey, true);
  assert.equal(b.log.length, 0);
  assert.deepEqual(b.prog, {});
  assert.equal(outcome(b.S, NOKEY, undefined, stats.isRight), 'unscored');
});

test('Check with nothing picked does nothing', () => {
  const { rec, S, log } = setup();
  assert.equal(rec.check(S, MC), null);
  S.sel.mc = null;
  assert.equal(rec.check(S, MC), null);
  assert.equal(log.length, 0);
  assert.equal(S.tried.mc, undefined);
});

test('switches are second guesses; a first pick and the first pick after a wrong Check are not', () => {
  const { rec, S, log, T0 } = setup();
  pick(S, MC, 'A', T0); pick(S, MC, 'C', T0 + 1); pick(S, MC, 'D', T0 + 2);
  assert.equal(S.changes.mc, 2);
  rec.check(S, MC, T0 + 3);
  assert.equal(log[0].changes, 2);
  pick(S, MC, 'A', T0 + 4);
  assert.equal(S.changes.mc, 2, 'the pick after a wrong Check starts from nothing');
});

test('SPR: committed values, not keystrokes; one change per new value', () => {
  const { rec, S, log, T0 } = setup();
  commit(S, SPR, '2', T0 + 1); commit(S, SPR, '3', T0 + 2); commit(S, SPR, '3', T0 + 3);
  rec.check(S, SPR, T0 + 4);
  assert.equal(log[0].changes, 1);
  assert.deepEqual(answers(log[0]), ['2', '3']);
});

test('history keeps the first and the latest 127 edits', () => {
  const { S, T0 } = setup();
  for (let n = 0; n < 200; n++) remember(S, MC, `v${n}`, T0 + n);
  const h = S.history!.mc;
  assert.equal(h.length, 128);
  assert.equal(h[0].answer, 'v0');
  assert.equal(h.at(-1)!.answer, 'v199');
});

test('an answer over 32 characters or an empty one is not remembered', () => {
  const { S } = setup();
  remember(S, MC, 'x'.repeat(33)); remember(S, MC, ''); remember(S, MC, null);
  assert.equal(S.history!.mc, undefined);
});

test('exam scoring path: recordProgress + recordAttempt move the record once, with no history', () => {
  const { rec, prog, log, savedProgress, savedLog } = setup();
  const now = '2026-09-30T10:00:00.000Z';
  rec.recordProgress(MC, false, now, 0);
  rec.recordAttempt(MC, false, now, 0, 'A', 0);
  assert.equal(prog.mc.marker, 'Red');
  assert.equal(savedProgress.length, 1);
  assert.equal(savedLog.length, 1);
  assert.deepEqual(log[0], { question_id: 'mc', ts: now, correct: 0, time_taken_ms: 0, picked: 'A', changes: 0 });
});

test('firstTry falls back to ans/checked for sessions saved before the rule', () => {
  const { S } = setup();
  S.ans.mc = 'B'; S.checked.mc = true;
  S.ans.spr = '9'; S.checked.spr = true;
  assert.equal(firstTry(S, MC, stats.isRight), true);
  assert.equal(firstTry(S, SPR, stats.isRight), false);
  assert.equal(firstTry(S, NOKEY, stats.isRight), undefined);
  assert.equal(outcome(S, NOKEY, undefined, stats.isRight), 'none');
});
