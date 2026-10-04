// The rules behind the four extra Question Bank filters. Pure: no React, so unit tests import this file.
// Each stored value is whatever the page kept in F.extra[key]; anything unexpected reads as the filter's initial value.
import type { FilterCtx, FilterQuestion } from '../filterTypes.ts';
import { savedIds } from '../saved.ts';

// ---- Bluebook tests: questions that appear on a practice test in public/practice-tests.json.
export type BluebookMode = 'all' | 'hide' | 'only';
export const BLUEBOOK_INITIAL: BluebookMode = 'all';
export const bluebookMode = (v: unknown): BluebookMode => v === 'hide' || v === 'only' ? v : BLUEBOOK_INITIAL;
export const bluebookActive = (v: unknown) => bluebookMode(v) !== 'all';

const MODULES = ['m1', 'easy', 'hard'];
const SECTIONS = ['RW', 'Math'];
const idCache = new WeakMap<object, Set<string>>();
// Every non-null id in tests[*].RW|Math .m1|easy|hard, built once per map object.
export function bluebookIds(ptmap: { tests: unknown[] } | null | undefined): Set<string> {
  if (!ptmap || typeof ptmap !== 'object') return new Set();
  let ids = idCache.get(ptmap);
  if (ids) return ids;
  ids = new Set();
  for (const test of Array.isArray(ptmap.tests) ? ptmap.tests : []) {
    for (const section of SECTIONS) for (const mod of MODULES) {
      const list = (test as any)?.[section]?.[mod];
      if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') ids.add(id);
    }
  }
  idCache.set(ptmap, ids);
  return ids;
}
export function bluebookTest(q: FilterQuestion, value: unknown, ctx: FilterCtx): boolean {
  const mode = bluebookMode(value);
  if (mode === 'all') return true;
  return bluebookIds(ctx.ptmap).has(q.id) === (mode === 'only');
}

// ---- Time spent: the time to the first Check, in buckets. A value is the [lowest, highest] bucket index kept.
export type TimeRange = [number, number];
export const TIME_EDGES_S = [0, 20, 40, 60, 120, 180, 300, Infinity];
export const TIME_LABELS = ['0-20s', '20-40s', '40s-1m', '1-2m', '2-3m', '3-5m', '5m+'];
export const TIME_INITIAL: TimeRange = [0, TIME_LABELS.length - 1];
export const timeRange = (v: unknown): TimeRange => {
  if (!Array.isArray(v) || v.length !== 2) return TIME_INITIAL;
  const [lo, hi] = v;
  return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi < TIME_LABELS.length && lo <= hi ? [lo, hi] : TIME_INITIAL;
};
export const timeActive = (v: unknown) => { const [lo, hi] = timeRange(v); return lo !== TIME_INITIAL[0] || hi !== TIME_INITIAL[1]; };
// The bucket range as header text: "0-20s to 5m+", or just the bucket when both thumbs sit on it.
export const timeSummary = (v: unknown) => {
  const [lo, hi] = timeRange(v);
  return lo === hi ? TIME_LABELS[lo] : `${TIME_LABELS[lo]} to ${TIME_LABELS[hi]}`;
};
// A recorded time (ms) inside the range: from the start of bucket lo up to, not including, the end of bucket hi.
export const timeInRange = (ms: number | null | undefined, range: TimeRange) => {
  if (typeof ms !== 'number' || !(ms > 0)) return false;
  return ms >= TIME_EDGES_S[range[0]] * 1000 && ms < TIME_EDGES_S[range[1] + 1] * 1000;
};
export const timeTest = (q: FilterQuestion, value: unknown, ctx: FilterCtx) => timeInRange(ctx.prog[q.id]?.time_taken_ms, timeRange(value));

// ---- Result: how the question stands in the account's record (the same markers as the dashboard).
export type ResultMode = 'all' | 'correct' | 'incorrect';
export const RESULT_INITIAL: ResultMode = 'all';
export const resultMode = (v: unknown): ResultMode => v === 'correct' || v === 'incorrect' ? v : RESULT_INITIAL;
export const resultActive = (v: unknown) => resultMode(v) !== 'all';
// Green is right first try. Red is wrong and Orange was corrected after a miss: both have been missed (stats.everWrong),
// which is what the Mistakes tab lists. A question with no marker has not been attempted.
export function resultOf(prog: FilterCtx['prog'], id: string): 'correct' | 'incorrect' | null {
  const marker = prog[id]?.marker;
  if (marker === 'Green') return 'correct';
  if (marker === 'Red' || marker === 'Orange') return 'incorrect';
  return null;
}
export const resultTest = (q: FilterQuestion, value: unknown, ctx: FilterCtx) => {
  const mode = resultMode(value);
  return mode === 'all' || resultOf(ctx.prog, q.id) === mode;
};

// ---- Saved: the questions marked Saved (Mark for Review in the player), from the saved store.
export type SavedMode = 'all' | 'only';
export const SAVED_INITIAL: SavedMode = 'all';
export const savedMode = (v: unknown): SavedMode => v === 'only' ? 'only' : SAVED_INITIAL;
export const savedActive = (v: unknown) => savedMode(v) !== 'all';
export const savedTest = (q: FilterQuestion, value: unknown, _ctx: FilterCtx) => savedMode(value) === 'all' || savedIds.has(q.id);

// ---- Completed: hide questions that already carry a progress marker (Green, Red or Orange).
export type CompletedMode = 'show' | 'hide';
export const COMPLETED_INITIAL: CompletedMode = 'show';
export const completedMode = (v: unknown): CompletedMode => v === 'hide' ? 'hide' : COMPLETED_INITIAL;
export const completedActive = (v: unknown) => completedMode(v) !== 'show';
export const isCompleted = (prog: FilterCtx['prog'], id: string) => resultOf(prog, id) !== null;
export const completedTest = (q: FilterQuestion, value: unknown, ctx: FilterCtx) => completedMode(value) === 'show' || !isCompleted(ctx.prog, q.id);
