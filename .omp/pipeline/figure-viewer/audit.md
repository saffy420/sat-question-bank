# figure-viewer — audit of every math question with a figure

## How it was run
- Source: the recovered snapshot from `https://helpmeaceit.page/api/questions` (4,170 rows, read only), plus the
  665 `/qimg/*` crops those questions reference (figures, notation crops and picture choices), in the scratchpad.
  Nothing was written to any database. The app never called production: Playwright answered `/api/questions` and
  `/qimg/*` from the local copy.
- Scope: every Math question with a `.qfig` figure (323) or an authored inline `svg[role=img]` (3 AI questions),
  326 in total.
- Views, at 1366×768 and 100 %:
  - **bank:** the real practice player, all 326 in one set;
  - **lesson:** the real student lesson view. The instructor-paced session's student snapshot has its question
    swapped per audited question through WebSocket routing, so `lesson-ui`'s Stage renders it as a student sees it.
- Script: `.omp/pipeline/figure-viewer/audit.mjs`, with `e2e/sheet.mjs` for contact sheets. Raw results go to
  `e2e/audit/audit.json`, which is gitignored, like the other `e2e/` output.

```
BANK=<snapshot.json> QIMG=<crop dir> PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node .omp/pipeline/figure-viewer/audit.mjs
```

The e2e server must be running on :8787 (`node tools/e2e_server.cjs enabled`, seeded).

## Checks per question (both views)
One frame per figure; no `.qfig` left outside a frame; the image decoded; the figure inside its frame at 100 %; the
frame no wider than the column and centred on it; the image not upscaled past its natural size; the frame a direct
block of the stem; toolbar present; no horizontal page scroll; no page errors; and the first line (80 px) of the first
answer control on screen: above the footer in lessons, inside the question pane in the bank.

## Results (final code)

| View | Audited | Structural problems | Figure shrunk to fit | First choice still below the fold |
|---|---|---|---|---|
| bank | 326 | 0 | 15 | 8 |
| lesson | 326 | 0 | 46 | 21 |

No page errors in either view.

### Found and fixed by the audit
- **The 3 AI questions with an inline SVG graph** (`ai_m008`, `ai_m014`, `ai_m024`) threw
  `Failed to execute 'replaceWith'… contains the parent` in `wrapFigures`, which blanked the question in every view.
  Fixed in `78154f6`; a regression check is in the bank spec.
- **Long stems and two-figure stems pushed the choices off-screen** (12 bank / 48 lesson with a fixed cap). Fixed by
  `fitFigures`: the figure cap for that stem shrinks, never below 140 px. That leaves the 8 / 21 below.
- **2 figures were authored after all the text** (`1adb39f0`, `d7bf55e1`), so they sat below the question. They now
  move above the last text block.

### Still pushed off-screen with the figure at its 140 px floor
- Bank (8): `d65b9a87 f8a322d9 d94018fd 197bed38 2ecce641 b58dbf88 d5f349b7 4fbffc0a`
- Lesson (21): `608cf8e2 9bb4107c d65b9a87 f8a322d9 d94018fd 7b52985c 197bed38 9ff88bb5 1a1a95de 930c2990 13294295
  2ecce641 d0cb49e8 b58dbf88 d112bc9d 25fc031a d5f349b7 babd7461 e9c5bfb2 e0d2e21a 4fbffc0a`

In every one of these, the text or the extraction debris below is what pushes the choices off-screen, not the figure:
- two figures in one stem (7);
- stems two to three times the bank median length (158 characters);
- stray notation paragraphs.

The lesson column is narrower than the bank's (46 % of the window), so it has more of these.

## Questions that still render wrong (content, not the viewer)
These are extraction defects in the stored `stem_html` / crops that predate this task. The viewer renders them
faithfully. They are more visible now that the figure sits in the question column. I found them by screenshotting
the stem of every stem with a notation-only paragraph next to a figure (71 questions) and reviewing each one.

1. **Rotated axis title extracted as scrambled notation crops**, shown as garbled vertical fragments under the frame.
   12 questions: `7b52985c 13294295 197bed38 1a1a95de 2e0290c3 2ecce641 4fbffc0a 8d63b6f1 930c2990 9ff88bb5 d0cb49e8
   d112bc9d`.
2. **Figure labels or fragments detached from the crop**, shown as loose text or dots above or below the frame:
   - `d65b9a87`: "Data Set A / Data Set B" and stray dots;
   - `d94018fd`: "Class A" and tick numbers;
   - `6c9444cd`: Class A/B;
   - `d3b9c8d8`: Group 1/2;
   - `f8a322d9`: "ger … integ";
   - `d5f349b7`: "P R S" and a rule;
   - `babd7461`: segment labels K, J, L, R, T;
   - `0013adbd`: a stray "k";
   - `3b44439b`: a stray "q".
3. **A sliver of a neighbouring table ("spread") at the top of the crop:** `25fc031a`, `608cf8e2`, `f8a322d9`.
4. **`b544a348`: the figure is the worked elimination** (`5x+3y=38`, `−(x+3y=10)`, `4x=28`). It shows the solution
   step on the question. Worth checking against the source PDF.
5. **Roman-numeral statements run together** ("I. … II. …" in one paragraph) in several data questions
   (`d65b9a87`, `608cf8e2`). This is text formatting, not a figure issue.

Fixing these means re-extracting or hand-repairing content (CLAUDE.md: "Re-extraction overwrites repaired
content"). That is outside this task and needs your go-ahead.

## Not covered
Reading & Writing figures (out of scope: math only); picture choices and explanation crops (unchanged); real phones.
