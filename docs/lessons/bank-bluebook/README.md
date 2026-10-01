# bank-bluebook screenshots

Written by `tests/e2e/bank-bluebook/bank.spec.ts` (local `wrangler dev`, seeded bank of 9 questions).

| File | What it shows |
|---|---|
| `beside-B-1366x768.png`, `beside-B-1920x1080.png` | The lesson student view (B, left) and the bank question screen (right), the same math question, same viewport. Composite of the two files below. |
| `lesson-B-<size>.png`, `bank-<size>.png` | The two screens on their own (C1, which also asserts their geometry). |
| `C2-picked-*`, `C2-right-*` | Footer button `Check` after a pick; `Next` after the right answer, choice green, explanation inline. |
| `C3-wrong-*`, `C3-solved-*` | Wrong pick red and disabled, nothing revealed; then the right answer, both misses still red. |
| `C4-show-answer-*`, `C4-answer-shown-*` | Grid-in after 3 wrong Checks (Show answer offered), then the answer shown. |
| `C5-navigator-*`, `C5-results-*` | Navigator mid-retry (question marked wrong); results (first-try 0 of 1, retry solved = Corrected). |
| `C6-dark-1366x768.png`, `C6-phone-390x780.png` | Dark theme; phone width. |
