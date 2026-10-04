// The filters the Question Bank's Filters row offers beyond section, domain, skill and difficulty.
// Each entry owns its stored value (F.extra[key]), its predicate and its control; order here is the order shown.
import type { FilterDef } from './filterTypes.ts';
import { bluebook } from './filters/bluebook.tsx';
import { timeSpent } from './filters/timeSpent.tsx';
import { result } from './filters/result.tsx';
import { saved } from './filters/saved.tsx';
import { completed } from './filters/completed.tsx';

export const EXTRA_FILTERS: FilterDef<any>[] = [bluebook, timeSpent, result, saved, completed];
