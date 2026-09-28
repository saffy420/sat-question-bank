# lessons-11a-bugfixes — e2e

**Spec:** `tests/e2e/lessons-11a.spec.js` (7 tests). **Unit:** `tests/test_lesson_room.cjs`, one new test (laser floor).

**Setup:**
- Local `wrangler dev` with local D1 and Durable Objects (00b harness), seeded with `npm run e2e:seed`.
- Browser: the preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- Screens:
  - instructor at 1920×1080;
  - students at 1366×768;
  - "110% zoom" is real browser zoom on a 1366×768 screen: a 1242×698 CSS-px viewport at device scale 1.1.

**Commands:**
- `npm test`: unit, **144/144**. `test_grade.cjs` calls Windows `git.exe`, so on Linux a `git.exe → git` shim goes on `PATH`.
- `npm run typecheck`: clean.
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`: full suite.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| A1 | Instructor strikes B → every student sees B struck, including one who reconnects | PASS | **Live:** the instructor uses the ABC toggle and ⊖ B; both students (1366, 110%) have `.stage-choice.eliminated` = `[B]` at 50% opacity. **Private:** student 1's own ⊖ C shows only on their card, not on the instructor's or student 2's, and their own ⊖ B stays unpressed. **Reconnect:** student 2's socket is closed and the browser goes offline; the instructor crosses out D and restores B; back online, student 2 sees `[D]`, and again after a full reload and rejoin. The instructor's reload keeps D. |
| A1 | Strikethrough tool on text inside a choice renders for students | PASS | A real mouse drag over "vague" (choice C) with the Strikethrough tool: the instructor and both students get a `[data-ann-mark]` "vague" with `text-decoration-line: line-through`. |
| A1 | Review mode | PASS | Self-paced set, instructor goes to Review Q1 and crosses out C: the student sees `[C]`. |
| A1 | My Lessons history | PASS | After Next and End session, the student opens the session in My Lessons: C (choice strike) and the eliminated `[D]` are there. |
| A2 | Strikethrough shows its own icon; every tool's indicator | PASS | For each tool: `aria-pressed` on exactly that button, and its own lucide icon (`lucide-strikethrough` and so on). The stage cursor carries the Strikethrough icon's path (`M16 4H9`) and not the highlighter's (`M3 29.5h11`), and the reverse for Highlight. Pen, Erase and Laser show `crosshair`. Over text, both text tools show the I-beam. With the tool off, the cursor is `auto`. |
| A3 | Laser: same word at 1366×768 and at 110% zoom, passage and figure questions | PASS | The instructor's socket sends laser frames in 120 ms bursts, as school Wi-Fi delivers them. The pointer travels word to word and rests. The word under the centre of each student's dot must equal the target word within 1.5 s (the idle heartbeat is 2.5 s). Passage question: plants, another, forest, defenses, seedling, plus the prompt's "conforms" and "Standard". Figure question: chart, hours, goal. |
| A4 | Builder filter panels | PASS | On `/admin/lessons/new` and `/admin/questions` at 1366, for Domain, Skill and Difficulty: `scrollWidth == clientWidth`; panel width ≥ trigger width; panel inside the viewport. For every option: checkbox ≤ 20 px wide, at the label's left edge, text starting ≤ 14 px after it, text and label inside the panel, and the label not overflowing. |
| A5 | One student connected, one offline at End session: both on /app | PASS | **Instructor-paced:** student 2's socket is closed and they go offline; End session. Student 1's lesson view closes at once on `/app`. Student 2's view stays until they come back online, then the reconnect gets 410 and they land on `/app`. Both answers (A, C) are in their lesson history. **Self-paced:** the first End session finishes the set, then one student goes offline and the second End session ends it. Same result, answers A and B saved. |

## Reproduced before fixing, and verified by reverting

With every app-code change stashed (tests and seed kept), all 7 tests fail:

| Test | Failure without the fix |
|---|---|
| A3 | Dot on "can" when the pointer rested on "plants". |
| A1 live | `eliminated` = `[]` on students. |
| A1 review | `eliminated` = `[]`. |
| A2 | Strikethrough's cursor is the highlighter SVG (`M3 29.5h11`), the reported bug. |
| A4 | Domain panel `scrollWidth` 308 vs `clientWidth` 248. |
| A5 ×2 | `#lesson-live` still visible after End session. |

The new unit test fails without the laser fix and passes with it.

### A3 diagnosis (the brief's fix text was a placeholder)

- **Static mapping is correct.** A sweep of all 116 words on the passage question, with the instructor at 1920 and students at 1366, at 110% browser zoom and at 110% CSS zoom, found **0** mismatches. The glyph anchors land on the right word.
- **The bug is timing.**
  - The room's laser floor (`Date.now() - lastLaser < 25 → return`) **dropped** any frame that arrived within 25 ms of the previous one.
  - The presenter sends ~30 Hz, but Wi-Fi delivers frames in bursts, so the frame for the word the pointer came to rest on was often dropped.
  - Students' dots then stayed on a word the pointer had only passed over until the 2.5 s idle heartbeat.
  - Repro: the instructor's frames are held and sent every 120 ms, and the pointer moves from "plants" to "another". The student's dot sat on "what" for the whole 3 s watched.
- **Fix** (`src/lesson-room.js`): the floor now holds the newest frame of a burst and sends it when the floor opens (≤ 25 ms later). A hide still goes out at once and cancels any held frame.

### Test-side findings during development (not app bugs)

- A first A1 run seemed to show choice-text strikes failing. The choice was below the 1080 px viewport, so the mouse drag landed on nothing. Scrolling it into view first, the unchanged code creates the mark.
- A5 self-paced: the set auto-submitted, so the status text reads "Time is up. Your answers were submitted…" rather than "Set finished". The test asserts the common part.

### App bug found by the new specs

- After an automatic release, a student who opened My Lessons straight away saw "No finished lessons yet".
  - `loadProgress` empties the list, refetches it, then calls `refresh()`, which doesn't redraw My Lessons.
  - Manual Leave had the same race, but it rarely showed.
  - Fix: redraw My Lessons when that tab is open. The A1 spec covers it (it opens My Lessons right after release).

## Full suite runs

| Run | Result | Time |
|---|---|---|
| 1 | 38 passed, 2 failed: `ui-admin-dashboard` "live presenter states" asserts the pen cursor is `crosshair`, and my first A2 change gave the pen its own icon. | 3.9 min |
| — | A2 narrowed: only Strikethrough gets its own cursor; pen, eraser and laser keep the crosshair. `ui-admin-dashboard` 4/4, 11a A2 pass. | — |
| 2 | **40 passed** | 4.0 min |

Screenshots are in `.omp/pipeline/lessons-11a-bugfixes/e2e/` (gitignored), with compressed copies in `docs/lessons/11a/`.
