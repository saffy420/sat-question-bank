// The four extra Question Bank filters (lesson-ui/qbank/filters/predicates.ts) and how applyExtraFilters combines them.
//
//   node --test tests/test_qbank_filters.ts        (Node 22.18+ strips the types)
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExtraFilters } from '../lesson-ui/qbank/filterTypes.ts';
import type { FilterCtx, FilterDef, FilterQuestion } from '../lesson-ui/qbank/filterTypes.ts';
import { savedIds, setSaved, loadSaved, subscribe } from '../lesson-ui/qbank/saved.ts';
import {
  BLUEBOOK_INITIAL, COMPLETED_INITIAL, RESULT_INITIAL, SAVED_INITIAL, TIME_EDGES_S, TIME_INITIAL, TIME_LABELS,
  bluebookActive, bluebookIds, bluebookTest, completedActive, completedMode, completedTest, resultActive, resultOf, resultTest, savedActive, savedTest,
  timeActive, timeInRange, timeRange, timeSummary, timeTest
} from '../lesson-ui/qbank/filters/predicates.ts';

const q = (id: string): FilterQuestion => ({ id, section: 'Math' });
const PTMAP = { tests: [
  { id: 'PT1', RW: { m1: ['rw1', 'rw2', null], easy: ['rw3'], hard: null }, Math: { m1: ['m1'], easy: null, hard: ['m2', null] } },
  { id: 'PT2', RW: { m1: null, easy: null, hard: null }, Math: { m1: ['m1', 'm3'], easy: [], hard: [] } }
] };
const ctx = (prog: FilterCtx['prog'] = {}, ptmap: FilterCtx['ptmap'] = PTMAP): FilterCtx => ({ prog, log: [], ptmap });
// The defs as the page builds them, minus the JSX controls (predicates.ts is JSX-free).
const defs = [
  { key: 'bluebook', initial: BLUEBOOK_INITIAL, isActive: bluebookActive, test: bluebookTest },
  { key: 'timeSpent', initial: TIME_INITIAL, isActive: timeActive, test: timeTest },
  { key: 'result', initial: RESULT_INITIAL, isActive: resultActive, test: resultTest },
  { key: 'saved', initial: SAVED_INITIAL, isActive: savedActive, test: savedTest },
  { key: 'completed', initial: COMPLETED_INITIAL, isActive: completedActive, test: completedTest }
] as unknown as FilterDef<any>[];

test('bluebookIds: every non-null id across both sections and all three modules, memoised per map', () => {
  const ids = bluebookIds(PTMAP);
  assert.deepEqual([...ids].sort(), ['m1', 'm2', 'm3', 'rw1', 'rw2', 'rw3']);
  assert.equal(bluebookIds(PTMAP), ids, 'same object, same set');
  assert.notEqual(bluebookIds({ tests: PTMAP.tests }), ids, 'a new map is read again');
  assert.equal(bluebookIds({ tests: [] }).size, 0);
  assert.equal(bluebookIds(null).size, 0);
  assert.equal(bluebookIds({ tests: [null, 5, { RW: null, Math: { m1: 'x' } }] as unknown[] }).size, 0, 'malformed entries are skipped');
});

test('bluebook: all keeps everything, hide drops test questions, only keeps them', () => {
  const c = ctx();
  assert.equal(bluebookTest(q('rw1'), 'all', c), true);
  assert.equal(bluebookTest(q('rw1'), 'hide', c), false);
  assert.equal(bluebookTest(q('rw1'), 'only', c), true);
  assert.equal(bluebookTest(q('other'), 'hide', c), true);
  assert.equal(bluebookTest(q('other'), 'only', c), false);
  assert.equal(bluebookTest(q('m1'), 'hide', c), false, 'in two tests still counts once');
  assert.equal(bluebookActive('all'), false);
  assert.equal(bluebookActive('hide') && bluebookActive('only'), true);
  const none = ctx({}, { tests: [] });
  assert.equal(bluebookTest(q('rw1'), 'hide', none), true, 'a map that failed to load hides nothing');
});

test('time buckets: exact boundaries belong to the bucket that starts there', () => {
  assert.deepEqual(TIME_EDGES_S, [0, 20, 40, 60, 120, 180, 300, Infinity]);
  assert.equal(TIME_LABELS.length, 7);
  const bucketOf = (ms: number) => TIME_LABELS.findIndex((_, i) => timeInRange(ms, [i, i]));
  assert.equal(bucketOf(1), 0);
  assert.equal(bucketOf(19_999), 0);
  assert.equal(bucketOf(20_000), 1);
  assert.equal(bucketOf(39_999), 1);
  assert.equal(bucketOf(40_000), 2);
  assert.equal(bucketOf(60_000), 3);
  assert.equal(bucketOf(120_000), 4);
  assert.equal(bucketOf(179_999), 4);
  assert.equal(bucketOf(180_000), 5);
  assert.equal(bucketOf(299_999), 5);
  assert.equal(bucketOf(300_000), 6);
  assert.equal(bucketOf(86_400_000), 6, '5m+ has no upper bound');
});

test('time range: from the start of the low bucket to the end of the high bucket; no recorded time never matches', () => {
  assert.equal(timeInRange(45_000, [2, 5]), true);
  assert.equal(timeInRange(19_999, [2, 5]), false);
  assert.equal(timeInRange(299_999, [2, 5]), true);
  assert.equal(timeInRange(300_000, [2, 5]), false);
  assert.equal(timeInRange(30_000, [1, 1]), true);
  for (const none of [0, -5, NaN, null, undefined]) assert.equal(timeInRange(none as number, [0, 6]), false, String(none));
  assert.equal(timeActive([0, 6]), false);
  assert.equal(timeActive([0, 5]) && timeActive([1, 6]) && timeActive([3, 3]), true);
  assert.equal(timeTest(q('a'), [2, 5], ctx({ a: { time_taken_ms: 45_000 } })), true);
  assert.equal(timeTest(q('a'), [2, 5], ctx({ a: { time_taken_ms: 5_000 } })), false);
  assert.equal(timeTest(q('a'), [2, 5], ctx({ a: { marker: 'Green' } })), false, 'no time on the row');
  assert.equal(timeTest(q('a'), [2, 5], ctx({})), false, 'unattempted');
});

test('time summary reads like the slider header', () => {
  assert.equal(timeSummary([0, 6]), '0-20s to 5m+');
  assert.equal(timeSummary([2, 5]), '40s-1m to 3-5m');
  assert.equal(timeSummary([3, 3]), '1-2m');
  assert.equal(timeSummary('junk'), '0-20s to 5m+');
});

test('result: Green is correct; Red and Orange (ever missed) are incorrect; no marker is unattempted', () => {
  const prog = { g: { marker: 'Green' }, r: { marker: 'Red' }, o: { marker: 'Orange' }, none: {}, odd: { marker: 'Purple' } };
  assert.deepEqual(['g', 'r', 'o', 'none', 'odd', 'missing'].map(id => resultOf(prog, id)), ['correct', 'incorrect', 'incorrect', null, null, null]);
  const c = ctx(prog);
  assert.deepEqual(['g', 'r', 'o', 'none', 'missing'].map(id => resultTest(q(id), 'correct', c)), [true, false, false, false, false]);
  assert.deepEqual(['g', 'r', 'o', 'none', 'missing'].map(id => resultTest(q(id), 'incorrect', c)), [false, true, true, false, false]);
  assert.equal(resultTest(q('missing'), 'all', c), true, 'All keeps the unattempted');
  assert.equal(resultActive('all'), false);
  assert.equal(resultActive('correct') && resultActive('incorrect'), true);
});

test('completed: hide drops every question with a Green, Red or Orange marker; show keeps all', () => {
  const prog = { g: { marker: 'Green' }, r: { marker: 'Red' }, o: { marker: 'Orange' }, none: {}, odd: { marker: 'Purple' } };
  const c = ctx(prog);
  assert.deepEqual(['g', 'r', 'o', 'none', 'odd', 'missing'].map(id => completedTest(q(id), 'hide', c)), [false, false, false, true, true, true]);
  assert.deepEqual(['g', 'r', 'none'].map(id => completedTest(q(id), 'show', c)), [true, true, true]);
  assert.equal(completedActive('show'), false);
  assert.equal(completedActive('hide'), true);
  assert.equal(completedMode('garbage'), 'show');
});

test('completed combined with result can leave nothing, without error', () => {
  const prog = { g: { marker: 'Green' }, r: { marker: 'Red' }, none: {} };
  const ids = ['g', 'r', 'none'];
  const left = (values: Record<string, unknown>) => ids.filter(id => applyExtraFilters(defs, q(id), values, ctx(prog)));
  assert.deepEqual(left({ completed: 'hide' }), ['none']);
  assert.deepEqual(left({ completed: 'hide', result: 'correct' }), []);
  assert.deepEqual(left({ result: 'correct' }), ['g']);
});

test('saved: only keeps the questions in the saved store', async () => {
  await loadSaved(null);
  let calls = 0;
  const off = subscribe(() => calls++);
  assert.equal(await setSaved('s1', true, null), true);
  assert.equal(calls, 1);
  assert.equal(savedTest(q('s1'), 'only', ctx()), true);
  assert.equal(savedTest(q('s2'), 'only', ctx()), false);
  assert.equal(savedTest(q('s2'), 'all', ctx()), true);
  assert.equal(savedActive('all'), false);
  assert.equal(savedActive('only'), true);
  await setSaved('s1', true, null);
  assert.equal(calls, 1, 'saving what is already saved is not a change');
  await setSaved('s1', false, null);
  assert.equal(savedIds.has('s1'), false);
  off();
});

test('saved store: a refused write puts the old state back; later toggles are not undone by an earlier failure', async t => {
  await loadSaved(null);
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  assert.equal(await setSaved('x', true, { Authorization: 'Bearer t' }), false);
  assert.equal(savedIds.has('x'), false, 'the failed save is rolled back');
  const sent: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response('{}', { status: 200 }); }) as typeof fetch;
  const on = setSaved('y', true, { Authorization: 'Bearer t' }), off = setSaved('y', false, { Authorization: 'Bearer t' });
  assert.deepEqual([await on, await off], [true, true]);
  assert.deepEqual(sent, [{ question_id: 'y', saved: true }, { question_id: 'y', saved: false }], 'sent in order');
  assert.equal(savedIds.has('y'), false);
});

test('saved store: loadSaved replaces the set with the account list and ignores a failed read', async t => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  await loadSaved(null);
  await setSaved('stale', true, null);
  globalThis.fetch = (async () => Response.json(['a', 'b', 7])) as typeof fetch;
  await loadSaved({ Authorization: 'Bearer t' });
  assert.deepEqual([...savedIds].sort(), ['a', 'b']);
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  await loadSaved({ Authorization: 'Bearer t' });
  assert.equal(savedIds.size, 0, 'a failed read never shows another account\'s questions');
});

test('applyExtraFilters: every active filter must pass; inactive and unstored ones are skipped', async () => {
  await loadSaved(null);
  await setSaved('keep', true, null);
  const c = ctx({ keep: { marker: 'Red', time_taken_ms: 70_000 }, fast: { marker: 'Red', time_taken_ms: 5_000 } }, { tests: [{ RW: { m1: ['keep'] } }] });
  const run = (id: string, values?: Record<string, unknown>) => applyExtraFilters(defs, q(id), values, c);
  assert.equal(run('anything'), true, 'no stored values: nothing is active');
  assert.equal(run('anything', {}), true);
  assert.equal(run('keep', { bluebook: 'only', timeSpent: [3, 5], result: 'incorrect', saved: 'only' }), true);
  assert.equal(run('fast', { timeSpent: [3, 5] }), false);
  assert.equal(run('keep', { bluebook: 'hide' }), false);
  assert.equal(run('keep', { result: 'correct' }), false);
  assert.equal(run('fast', { saved: 'only' }), false);
  assert.equal(run('keep', { bluebook: 'only', saved: 'only', result: 'correct' }), false, 'one failing filter is enough');
  assert.equal(run('fast', { bluebook: 'all', timeSpent: [0, 6], result: 'all', saved: 'all' }), true, 'initial values are inactive');
});

test('garbage stored values read as the initial value', async () => {
  const c = ctx({ a: { marker: 'Green', time_taken_ms: 50_000 } });
  for (const junk of [undefined, null, 7, 'nope', {}, [], [3], [3, 1], [-1, 2], [0, 7], [1.5, 2], ['a', 'b'], NaN]) {
    for (const def of defs) assert.equal(def.isActive(junk), false, `${def.key} ${JSON.stringify(junk)}`);
    assert.equal(applyExtraFilters(defs, q('missing'), { bluebook: junk, timeSpent: junk, result: junk, saved: junk }, c), true);
  }
  assert.deepEqual(timeRange([3, 1]), TIME_INITIAL);
});
