# Task 11c handoff — lessons-11c-student-desmos

## Status
Complete locally and pushed to `claude/sleepy-cori-x82ubx`. Unit tests, typecheck and the full e2e suite pass (numbers in `e2e.md`).

## Shipped

### C1. The student's own calculator
- **Button:** a **Calculator** button leads the student header tools (Bluebook-style icon + label), in both instructor-paced and self-paced views. It shows only while a Math question is on screen: not in the lobby, on R&W questions, on the self-paced review page, in polls, or on terminal screens.
- **Window** (`lesson-ui/Calculator.tsx`, `#lesson-calc`): a floating Desmos graphing calculator with editing on (`EDIT_OPTIONS`).
  - Drag it by the title bar. Resize it from the bottom-right corner (minimum 300×260).
  - Every move, resize and browser resize is clamped to the viewport.
  - Default position: 16 px from the left edge, 400 px wide, between the header (with its phase label) and the footer.
- **Layout shift:** while the window is open on a math question, `.lesson-main.with-calc` pads the question 440 px from the left. That is the window's default footprint plus a gap, so at the default position the window never covers the question.
  - The padding is fixed: it does not follow the window when the student drags it.
  - It is CSS on the lesson container only. The stage split and the divider code are untouched, so this works the same once lessons-11b removes the divider (fixed split).
  - At ≤ 750 px wide there is no shift.
- **State:** the calculator is created on first open and then kept alive, hidden when closed or off a math question. It lives in `CalculatorShell`, above the Player / SelfPlayer / PollScreen screens, so it keeps its state:
  - across questions, polls and review;
  - when closed and reopened.

  It is memory-only and belongs to one lesson view. Leave view, a new join or a page reload starts it empty. That is deliberate: on a shared Chromebook, the next student to join the same session must not get the previous student's calculator.
- **Privacy:** the student calculator has no send path. There is no `syncOut` and no observer, and nothing reaches the socket or HTTP.
- **Server:** self-paced student snapshots now carry `hasMath` and `desmosKey` (`src/lesson-room.js`). Before this, only review snapshots had them, so self-paced students had no Desmos key during the set. The key is the same public key instructor-paced students already get.
  - Every self-paced snapshot carries it, acks included, because the client replaces its snapshot on each ack.
  - This adds about 70 bytes per snapshot.
- **Preload:** the Desmos API still preloads in the lobby for math lessons. The preload moved from `Player` into `CalculatorShell`, so self-paced lobbies preload too. Non-math lessons never render the shell and never load Desmos (spec 06 test 2 still asserts this).

### C2. Try it yourself
- **Instructor panel:** `#lesson-desmos` is always a read-only follower now. It keeps syncing after Try it yourself. The in-panel fork and **Back to instructor view** are gone.
- **Try it yourself** (`#lesson-desmos-fork`, id kept so spec 09's history assertion stays meaningful) takes the latest instructor state (expressions + viewport, as sent by the room) and puts it into the student's own calculator, then opens it:
  - **Empty** calculator: replaced without asking. Empty means every row is a blank expression, like a fresh calculator. Viewport-only changes don't count.
  - **Not empty:** a modal says "This will delete everything in your calculator and replace it with your instructor's graph." with **Cancel** and **Replace**. Cancel changes nothing, not even whether the window is open.
  - The modal is mounted only while it's asking, so it never adds text to the lesson screen.
- **History view** (§9.1) keeps its read-only follower with no button.

## Tests
- **New:** `tests/e2e/lessons-11c.spec.js`, 2 tests:
  - instructor-paced at 1366×768 (C1 + C2);
  - self-paced at Chrome's real 110% zoom: a 1242×698 CSS viewport at deviceScaleFactor 1.1.
- **Rewritten:** spec 06 (`tests/e2e/lessons-06-desmos/desmos.spec.js`). Its fork / Back section now asserts the new flow. The rewrite is described in `e2e.md`, and nothing was loosened.
- **New unit test** in `tests/test_lesson_room.cjs`: the self-paced snapshot carries `hasMath` and `desmosKey`, and `hasMath` is false with no math questions.

## Deviations / decisions
1. Screenshots for the PR are committed, palette-compressed, in `docs/lessons/11c/`, the same approach as the task 10 tour.
2. The layout shift uses the window's default footprint (fixed), not its live position.
3. "Empty" ignores viewport-only changes, so a student who only panned is not asked.
4. The self-paced snapshot change is a two-field server change, needed so C1 works in self-paced lessons.
5. This was one Claude Code session with no subagent pipeline. The specs were written in the same session as the code.

## Merge notes for 11a / 11b
- `lesson-ui/Stage.tsx` and every divider rule in `lesson.css` are untouched. The new CSS is one block before `/* Self-paced (§8.3) */`.
- `lesson-ui/index.tsx`:
  - `mountLesson.render` now wraps the screens in `CalculatorShell`;
  - `Player` gained the header button, the `with-calc` class and `onTry`.

  A conflict with 11a there should be local.

## Manual checks for you
- On a real Chromebook: open the calculator on a math question, drag and resize it, go to the next question, come back.
- Try it yourself on a Chromebook with an empty calculator and with a non-empty one.
- Check that the calculator window and the instructor's graph panel together still leave the question readable at 1366×768. Both are open after Try it yourself, and the stage is about 500 px wide then.
