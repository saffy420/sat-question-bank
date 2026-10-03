import type { FilterDef } from '../filterTypes.ts';
import { Segmented } from './Segmented.tsx';
import { BLUEBOOK_INITIAL, bluebookActive, bluebookMode, bluebookTest, type BluebookMode } from './predicates.ts';

const TEXT: Record<BluebookMode, string> = { all: 'All questions', hide: 'Hide Bluebook', only: 'Only Bluebook' };

export const bluebook: FilterDef<BluebookMode> = {
  key: 'bluebook',
  label: 'Bluebook tests',
  initial: BLUEBOOK_INITIAL,
  isActive: bluebookActive,
  summary: v => TEXT[bluebookMode(v)],
  test: bluebookTest,
  Control: ({ value, onChange }) => <Segmented label="Bluebook tests" value={bluebookMode(value)} onChange={onChange}
    options={[{ value: 'all', text: 'All' }, { value: 'hide', text: 'Hide' }, { value: 'only', text: 'Only' }]}/>
};
