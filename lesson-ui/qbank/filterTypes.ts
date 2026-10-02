// Shared by the question bank home (PR qbank-react) and the extra filters (PR qbank-filters).
// Both PRs add this file byte-for-byte identical; do not edit it in either PR.
import type { ComponentType } from 'react';

export type FilterQuestion = { id: string; section: string; domain?: string; skill?: string; difficulty?: string; spr?: boolean };
export type FilterCtx = {
  prog: Record<string, { marker?: string; attempts?: number; corrects?: number; time_taken_ms?: number } | undefined>;
  log: { question_id: string; ts: string; correct: number; time_taken_ms?: number }[];
  ptmap: { tests: unknown[] };
};
export type FilterDef<V = unknown> = {
  key: string;
  label: string;
  initial: V;
  isActive: (value: V) => boolean;
  summary: (value: V) => string;
  test: (q: FilterQuestion, value: V, ctx: FilterCtx) => boolean;
  Control: ComponentType<{ value: V; onChange: (value: V) => void }>;
};

export function applyExtraFilters(defs: FilterDef<any>[], q: FilterQuestion, values: Record<string, unknown> | undefined, ctx: FilterCtx): boolean {
  for (const def of defs) {
    const value = values && Object.hasOwn(values, def.key) ? values[def.key] : def.initial;
    if (def.isActive(value) && !def.test(q, value, ctx)) return false;
  }
  return true;
}
