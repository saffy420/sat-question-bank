import type { FilterDef } from '../filterTypes.ts';
import { Segmented } from './Segmented.tsx';
import { RESULT_INITIAL, resultActive, resultMode, resultTest, type ResultMode } from './predicates.ts';

const TEXT: Record<ResultMode, string> = { all: 'All', correct: 'Correct only', incorrect: 'Incorrect only' };

export const result: FilterDef<ResultMode> = {
  key: 'result',
  label: 'Result',
  initial: RESULT_INITIAL,
  isActive: resultActive,
  summary: v => TEXT[resultMode(v)],
  test: resultTest,
  Control: ({ value, onChange }) => <Segmented label="Result" value={resultMode(value)} onChange={onChange}
    options={[{ value: 'all', text: 'All' }, { value: 'correct', text: 'Correct only' }, { value: 'incorrect', text: 'Incorrect only' }]}/>
};
