import type { FilterDef } from '../filterTypes.ts';
import { Segmented } from './Segmented.tsx';
import { SAVED_INITIAL, savedActive, savedMode, savedTest, type SavedMode } from './predicates.ts';

const TEXT: Record<SavedMode, string> = { all: 'All', only: 'Saved only' };

export const saved: FilterDef<SavedMode> = {
  key: 'saved',
  label: 'Saved',
  initial: SAVED_INITIAL,
  isActive: savedActive,
  summary: v => TEXT[savedMode(v)],
  test: savedTest,
  Control: ({ value, onChange }) => <Segmented label="Saved" value={savedMode(value)} onChange={onChange}
    options={[{ value: 'all', text: 'All' }, { value: 'only', text: 'Saved only' }]}/>
};
