# Task 10 handoff — lessons-10-e2e-regression

## Status
Complete. Review PASS. One app bug found in the exploratory pass and fixed in repair round 1. Full suite 31/31 on two consecutive runs. Unit 97/97. Typecheck clean.

## Shipped
- **Screenshot tour** of both lesson modes run as in class: `tests/e2e/lessons-10-e2e-regression/tour.spec.js`. 29 compressed PNGs are in `docs/lessons/tour/`, with an index in its `README.md`.
  - Students at 1366×768; the instructor at 1920×1080, plus one 1366 grid shot.
  - Every shot asserts its state first.
  - Every student in both runs passes `captureLeaks`.
- **§13 acceptance gaps**, now end to end (`acceptance.spec.js`):
  - **Grace window:** the UI is frozen at 0:00. A raw `select` on the real socket after `endsAt + 750 ms` gets `question closed`, and the answer is unchanged.
  - **20 s outages:**
    - self-paced late joiner: same question, selection, assigned set, and the clock reduced;
    - instructor-paced after reveal: annotations the instructor made while the student was offline are there on reconnect.
  - **Lesson reuse:** new session ID and code; the first run's history is deep-equal before and after the second run; the old code gets 404.
- **Tour tool:** `tools/e2e_tour_compress.cjs` palette-compresses the tour (2456 → 957 KiB).
- **Fix (B1):** below a long passage at 1366×768, three things were hidden:
  - the "Answer locked in" notice and the reveal verdict, under the fixed footer;
  - the class results chart, below the window.

  Now `#lesson-live` pads its scroll area for the header and footer (`scroll-padding`), and a status that just appeared scrolls into view (`nearest`).

## Evidence
- `e2e.md` has the checkpoints, the §13 → test map, the B1 repro and measured geometry, and the runs.
- **Desmos latency** (06 spec, Slow 3G): 253–295 ms, against a 500 ms target.

## Deviations / decisions (spec.md "Decisions")
1. The instructor tour shots use 1920×1080, the instructor's laptop per §13. Students use 1366×768.
2. The self-paced tour uses students 2, 3 and 4. Students 1 and 6 have stats pinned by other specs that run in parallel.
3. The tool is named with the `e2e_` prefix (already un-ignored). It uses the transitive `sharp`.

## Open items (non-blocking)
- **N2:** at 1366 width, typing in the instructor's Desmos scrolls the short question out of the card while the keypad is open. Not seen at 1920.
- **Carried over:**
  - from task 09: N2/N3 and the D1 batch size at class scale;
  - from task 06: `webSocketClose` logs 1006.

## Manual checks for you
- Look through `docs/lessons/tour/`.
- On a Chromebook, lock an answer and reveal on a long passage. The lock notice, the verdict and the class results should come into view without scrolling.
- If you ever run the live view on a 1366-wide screen, check the Desmos panel (N2).
