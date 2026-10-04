import type { FilterDef } from '../filterTypes.ts';
import { Segmented } from './Segmented.tsx';
import { COMPLETED_INITIAL, completedActive, completedMode, completedTest, type CompletedMode } from './predicates.ts';

const TEXT: Record<CompletedMode, string> = { show: 'Show all', hide: 'Hide completed' };

export const completed: FilterDef<CompletedMode> = {
  key: 'completed',
  label: 'Completed',
  initial: COMPLETED_INITIAL,
  isActive: completedActive,
  summary: v => TEXT[completedMode(v)],
  test: completedTest,
  Control: ({ value, onChange }) => <Segmented label="Completed" value={completedMode(value)} onChange={onChange}
    options={[{ value: 'show', text: 'Show all' }, { value: 'hide', text: 'Hide completed' }]}/>
};
