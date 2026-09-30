import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, lesson, join, openLive } from '../lessons-11-ui-polish/helpers.js';
import { RW, MATH, SPR, SIZES, shot, startPractice, current, goTo, primary, choice, choiceBox, snapshot, attemptsSince, progressOf, expectNoLeak, exportedText } from './support';

// bank-bluebook checkpoints C1-C6. The practice player is the lesson-ui screen (Bank.tsx): same header, toolbar, column,
// choice rows and footer as the lesson student view, plus Check / retry-until-correct.

const pick = async (page, letter) => { await choice(page, letter).scrollIntoViewIfNeeded(); await choice(page, letter).click(); };

// What screens A/B are made of, measured on either screen. `root` is #lesson-live or #bank-live, `card` the stage.
const metrics = (page, [root, card, tool]) => page.evaluate(([root, card, tool]) => {
  const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, cx: b.x + b.width / 2 }; };
  const q = s => document.querySelector(`${root} ${s}`), c = s => document.querySelector(`${card} ${s}`);
  const fs = el => parseFloat(getComputedStyle(el).fontSize);
  const st = (el, ...p) => Object.fromEntries(p.map(k => [k, getComputedStyle(el)[k]]));
  const box = c('[data-lesson-choice="A"] .choice');
  return {
    vw: innerWidth, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    header: r(q('.lesson-header')), footer: r(q('.lesson-footer')), footerPosition: getComputedStyle(q('.lesson-footer')).position,
    h1: fs(q('.lesson-header h1')), clock: fs(q('.lesson-timer strong')), hide: fs(q('.lesson-timer button')),
    tool: { box: r(q(tool)), svg: r(q(`${tool} svg`)), label: fs(q(`${tool} span`)) },
    name: fs(q('.lesson-footer>span:first-child')),
    pill: { box: r(q('.lesson-position')), font: fs(q('.lesson-position')), ...st(q('.lesson-position'), 'backgroundColor', 'borderTopLeftRadius') },
    submit: { h: r(q('.lesson-submit')).h, ...st(q('.lesson-submit'), 'backgroundColor', 'borderTopLeftRadius', 'fontSize') },
    strip: r(c('.stage-strip')), number: r(c('.stage-strip>span')),
    column: r(c('.stage-question')), stem: fs(c('.lesson-stem')),
    row: { ...r(box), radius: parseFloat(getComputedStyle(box).borderTopLeftRadius), fontSize: fs(box), ...st(box, 'borderTopWidth', 'minHeight') },
    badge: r(c('[data-lesson-choice="A"] .badge')),
    dashes: getComputedStyle(q('.lesson-header'), '::after').backgroundImage
  };
}, [root, card, tool]);

const near = (a, b, tol, label) => expect(Math.abs(a - b), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`C1 the bank question screen beside the lesson student view (B) at ${size}`, async ({ browser }) => {
    test.setTimeout(180000);
    const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
    const lessonStudent = await newUserContext(browser, 'e2e-student-1', { viewport });
    const bankStudent = await newUserContext(browser, 'e2e-student-2', { viewport });
    try {
      const { sessionId, joinCode } = await lesson(admin, `Bank layout ${size}`, [MATH], 'instructor', 120);
      const teacher = await openLive(admin, sessionId);
      const b = await lessonStudent.newPage();
      await join(b, joinCode);
      await teacher.locator('[data-live="start"]').click();
      await expect(b.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      await expect(b.locator('[data-lesson-choice="D"]')).toBeVisible();
      await b.mouse.move(2, 2);

      const page = await bankStudent.newPage();
      await startPractice(page, { math: true });
      expect(await current(page)).toBe(MATH);
      await expect(page.locator('[data-lesson-choice="D"]')).toBeVisible();
      await page.mouse.move(2, 2);

      const lessonM = await metrics(b, ['#lesson-live', '#lesson-card', '#lesson-private']);
      const bankM = await metrics(page, ['#bank-live', '#bank-card', '#bank-annotate']);
      const where = `${size}:`;
      expect([bankM.vw, bankM.vh], where).toEqual([viewport.width, viewport.height]);
      expect(bankM.scrollWidth, `${where} no sideways scroll`).toBe(bankM.vw);
      expect(bankM.footerPosition).toBe('fixed');
      // Header, footer, dashes, type scale.
      for (const k of ['header', 'footer']) { near(bankM[k].h, lessonM[k].h, 1, `${where} ${k} height`); near(bankM[k].y, lessonM[k].y, 1, `${where} ${k} y`); near(bankM[k].w, lessonM[k].w, 1, `${where} ${k} width`); }
      for (const k of ['h1', 'clock', 'hide', 'name', 'stem']) near(bankM[k], lessonM[k], 0.05, `${where} ${k} font size`);
      expect(bankM.dashes).toBe(lessonM.dashes);
      // The tool row: icon over label, same size, same ink as the lesson's Annotate tool.
      near(bankM.tool.box.h, lessonM.tool.box.h, 1, `${where} tool height`);
      near(bankM.tool.svg.w, lessonM.tool.svg.w, 0.5, `${where} tool icon`);
      near(bankM.tool.label, lessonM.tool.label, 0.05, `${where} tool label size`);
      near(bankM.tool.box.y, lessonM.tool.box.y, 1, `${where} tool row y`);
      // The position pill and the primary button: same solid pills.
      near(bankM.pill.box.h, lessonM.pill.box.h, 1, `${where} pill height`);
      near(bankM.pill.box.cx, lessonM.pill.box.cx, 1, `${where} pill centred`);
      near(bankM.pill.font, lessonM.pill.font, 0.05, `${where} pill font`);
      expect([bankM.pill.backgroundColor, bankM.pill.borderTopLeftRadius]).toEqual([lessonM.pill.backgroundColor, lessonM.pill.borderTopLeftRadius]);
      expect([bankM.submit.backgroundColor, bankM.submit.borderTopLeftRadius, bankM.submit.fontSize]).toEqual([lessonM.submit.backgroundColor, lessonM.submit.borderTopLeftRadius, lessonM.submit.fontSize]);
      near(bankM.submit.h, lessonM.submit.h, 1, `${where} primary height`);
      // The column: same width, centred, same question bar; the choice rows the same rounded rows.
      near(bankM.column.w, lessonM.column.w, 1, `${where} column width`);
      near(bankM.column.x, lessonM.column.x, 1, `${where} column x`);
      near(bankM.strip.h, lessonM.strip.h, 1, `${where} question bar height`);
      near(bankM.number.w, lessonM.number.w, 1, `${where} question number`);
      near(bankM.row.w, lessonM.row.w, 1, `${where} choice row width`);
      near(bankM.row.h, lessonM.row.h, 1, `${where} choice row height`);
      near(bankM.badge.w, lessonM.badge.w, 0.5, `${where} letter circle`);
      expect(bankM.row.radius, `${where} rounded row`).toBeGreaterThanOrEqual(10);
      near(bankM.row.radius, lessonM.row.radius, 0.5, `${where} row radius`);
      expect(bankM.row.borderTopWidth).toBe(lessonM.row.borderTopWidth);
      // One column (a math question without a passage), about 46 % of the window.
      expect(bankM.column.w / bankM.vw, `${where} column share`).toBeGreaterThan(0.4);
      expect(bankM.column.w / bankM.vw, `${where} column share`).toBeLessThan(0.52);

      await shot(page, `bank-${size}`);
      await shot(b, `lesson-B-${size}`);
    } finally { await admin.close(); await lessonStudent.close(); await bankStudent.close(); }
  });
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`C2 a right answer goes Next, Check, Next at ${size}`, async ({ browser }) => {
    const student = await newUserContext(browser, 'e2e-student-3', { viewport });
    try {
      const page = await student.newPage();
      const before = await snapshot(student);
      await startPractice(page);
      expect(await current(page)).toBe(RW);
      // Nothing picked: the button skips.
      await expect(primary(page)).toHaveText('Next');
      await expect(primary(page)).toHaveAttribute('data-mode', 'next');
      await pick(page, 'A');
      await expect(primary(page)).toHaveText('Check');
      await expect(primary(page)).toHaveAttribute('data-mode', 'check');
      await expect(choiceBox(page, 'A')).toHaveClass(/sel/);
      // Nothing is graded by picking.
      await expect(page.locator('#bank-card .choice.right, #bank-card .choice.wrong')).toHaveCount(0);
      expect(await attemptsSince(student, before, [RW])).toHaveLength(0);
      await shot(page, `C2-picked-${size}`);
      await primary(page).click();
      // Right: Next again, the right choice green, the explanation appears.
      await expect(primary(page)).toHaveText('Next');
      await expect(primary(page)).toHaveAttribute('data-mode', 'next');
      await expect(choiceBox(page, 'A')).toHaveClass(/right/);
      await expect(page.locator('#bank-verdict')).toContainText('Correct');
      await expect(page.locator('#bank-reveal')).toContainText('E2E_EXPL_MARKER_RW');
      await shot(page, `C2-right-${size}`);
      await expect.poll(async () => (await attemptsSince(student, before, [RW])).length).toBe(1);
      const [attempt] = await attemptsSince(student, before, [RW]);
      expect(attempt).toMatchObject({ question_id: RW, correct: 1, picked: 'A' });
      // Next moves on, and the new question starts again at Next.
      await primary(page).click();
      expect(await current(page)).toBe(MATH);
      await expect(primary(page)).toHaveText('Next');
      await expect(choiceBox(page, 'A')).not.toHaveClass(/sel|right|wrong/);
    } finally { await student.close(); }
  });
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`C3 a wrong multiple-choice answer is marked, retried, then answered correctly, with no answer leak at ${size}`, async ({ browser }) => {
    test.setTimeout(120000);
    const student = await newUserContext(browser, 'e2e-student-2', { viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    try {
      const page = await student.newPage();
      const before = await snapshot(student);
      const progress0 = (await progressOf(student, RW))?.attempts || 0;
      await startPractice(page);
      await expectNoLeak(page, { marker: 'E2E_EXPL_MARKER_RW' });
      await pick(page, 'B');
      await primary(page).click();
      // Marked wrong and disabled; nothing else changes. The button is back to Next (nothing picked).
      await expect(choiceBox(page, 'B')).toHaveClass(/wrong/);
      await expect(choice(page, 'B')).toBeDisabled();
      await expect(primary(page)).toHaveText('Next');
      await expect(page.locator('#bank-status')).toBeVisible();
      for (const letter of ['A', 'C', 'D']) await expect(choice(page, letter)).toBeEnabled();
      await expect(choiceBox(page, 'A')).not.toHaveClass(/right|wrong|sel/);
      await expectNoLeak(page, { marker: 'E2E_EXPL_MARKER_RW' });
      await shot(page, `C3-wrong-${size}`);
      // The export holds no answer and no explanation either.
      const exported = await exportedText(page);
      expect(exported).toContain('QUESTION');
      expect(exported).not.toMatch(/CORRECT ANSWER|OFFICIAL EXPLANATION|E2E_EXPL_MARKER_RW/);
      // A second wrong answer is marked too; the first stays marked; still nothing revealed.
      await pick(page, 'C');
      await expect(primary(page)).toHaveText('Check');
      await primary(page).click();
      await expect(choiceBox(page, 'C')).toHaveClass(/wrong/);
      await expect(choiceBox(page, 'B')).toHaveClass(/wrong/);
      await expect(page.locator('#bank-card .choice.wrong')).toHaveCount(2);
      await expectNoLeak(page, { marker: 'E2E_EXPL_MARKER_RW' });
      // A disabled choice cannot be picked again.
      await choice(page, 'B').click({ force: true });
      await expect(primary(page)).toHaveText('Next');
      // One attempt so far, the first-try miss.
      await expect.poll(async () => (await attemptsSince(student, before, [RW])).length).toBe(1);
      // Right answer: only now the explanation.
      await pick(page, 'A');
      await primary(page).click();
      await expect(choiceBox(page, 'A')).toHaveClass(/right/);
      await expect(page.locator('#bank-card .choice.wrong')).toHaveCount(2);
      await expect(primary(page)).toHaveText('Next');
      await expect(page.locator('#bank-reveal')).toContainText('E2E_EXPL_MARKER_RW');
      await shot(page, `C3-solved-${size}`);
      // The record is first-try: one attempt, wrong, the first pick; one progress move.
      await page.waitForTimeout(500);
      const attempts = await attemptsSince(student, before, [RW]);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ question_id: RW, correct: 0, picked: 'B' });
      expect(JSON.parse(attempts[0].answer_history_json).map(h => h.answer)).toEqual(['B']);
      const progress = await progressOf(student, RW);
      expect(progress.attempts).toBe(progress0 + 1);
      expect(progress.marker).toBe('Red');
    } finally { await student.close(); }
  });
}

for (const [size, viewport] of Object.entries(SIZES)) test(`C4 a grid-in offers Show answer only after 3 wrong Checks, and the attempt stays wrong at ${size}`, async ({ browser }) => {
  test.setTimeout(120000);
  const student = await newUserContext(browser, 'e2e-student-2', { viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await student.newPage();
    const before = await snapshot(student);
    await startPractice(page);
    await goTo(page, SPR);
    const grid = page.locator('#bank-card #lesson-grid');
    await expect(primary(page)).toHaveText('Next');
    await expectNoLeak(page, { marker: 'E2E_EXPL_MARKER_SPR' });
    for (const [n, value] of [['1', '1'], ['2', '2'], ['3', '4']]) {
      await grid.fill(value);
      await expect(primary(page)).toHaveText('Check');
      await primary(page).click();
      await expect(page.locator('#bank-status')).toContainText('Not right');
      await expect(grid).toHaveValue('');           // cleared: the student must enter a new value
      await expect(primary(page)).toHaveText('Next');
      await expect(page.locator('#bank-reveal')).toHaveCount(0);
      if (n < 3) await expect(page.locator('#bank-show-answer'), `no Show answer after ${n} wrong Checks`).toHaveCount(0);
      await expectNoLeak(page, { marker: 'E2E_EXPL_MARKER_SPR' });
    }
    await expect(page.locator('#bank-show-answer')).toBeVisible();
    await shot(page, `C4-show-answer-${size}`);
    const exported = await exportedText(page);
    expect(exported).not.toMatch(/CORRECT ANSWER|OFFICIAL EXPLANATION|E2E_EXPL_MARKER_SPR/);
    await page.locator('#bank-show-answer').click();
    await expect(page.locator('#bank-verdict')).toContainText('Correct answer: 3');
    await expect(page.locator('#bank-reveal')).toContainText('E2E_EXPL_MARKER_SPR');
    await expect(page.locator('#bank-show-answer')).toHaveCount(0);
    await expect(grid).toBeDisabled();
    await shot(page, `C4-answer-shown-${size}`);
    await page.waitForTimeout(500);
    const attempts = await attemptsSince(student, before, [SPR]);
    expect(attempts, 'one attempt for three Checks and Show answer').toHaveLength(1);
    expect(attempts[0]).toMatchObject({ question_id: SPR, correct: 0, picked: '1' });
    expect((await progressOf(student, SPR)).marker).toBe('Red');
  } finally { await student.close(); }
});

test('C4b a grid-in answered right after two misses closes with one wrong attempt', async ({ browser }) => {
  const student = await newUserContext(browser, 'e2e-student-3', { viewport: SIZES['1366x768'] });
  try {
    const page = await student.newPage();
    const before = await snapshot(student);
    await startPractice(page);
    await goTo(page, SPR);
    const grid = page.locator('#bank-card #lesson-grid');
    for (const value of ['1', '2']) { await grid.fill(value); await primary(page).click(); await expect(page.locator('#bank-status')).toBeVisible(); }
    await grid.fill('3');
    await grid.press('Enter');                       // Enter in the field is Check
    await expect(page.locator('#bank-verdict')).toContainText('Correct');
    await expect(page.locator('#bank-show-answer')).toHaveCount(0);
    await page.waitForTimeout(500);
    const attempts = await attemptsSince(student, before, [SPR]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ correct: 0, picked: '1' });
  } finally { await student.close(); }
});

test('C5 leaving mid-retry keeps the first-try result; the question resumes; results and Mistakes agree', async ({ browser }) => {
  test.setTimeout(150000);
  const student = await newUserContext(browser, 'e2e-student-3', { viewport: SIZES['1366x768'] });
  try {
    const page = await student.newPage();
    const before = await snapshot(student);
    const progress0 = (await progressOf(student, RW))?.attempts || 0;
    await startPractice(page);
    await pick(page, 'B');
    await primary(page).click();
    await expect(choiceBox(page, 'B')).toHaveClass(/wrong/);
    // Next (skip) leaves the question open and unsolved: no explanation is offered on the way out.
    await expect(primary(page)).toHaveText('Next');
    await primary(page).click();
    expect(await current(page)).toBe(MATH);
    await expect(page.locator('#bank-reveal, #bank-notes')).toHaveCount(0);
    // The navigator shows it wrong; Back resumes the retry with the miss still marked.
    await page.locator('#bank-nav').click();
    await expect(page.locator('[data-bank-q]').first()).toHaveAttribute('data-state', 'wrong');
    await shot(page, 'C5-navigator-1366x768');
    await page.locator('#bank-nav').click();
    await page.locator('#bank-back').click();
    expect(await current(page)).toBe(RW);
    await expect(choiceBox(page, 'B')).toHaveClass(/wrong/);
    await expect(choice(page, 'B')).toBeDisabled();
    await expect(page.locator('#bank-reveal')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await attemptsSince(student, before, [RW])).toHaveLength(1);
    // Solve it now: still one attempt, the first-try miss.
    await pick(page, 'A');
    await primary(page).click();
    await expect(page.locator('#bank-verdict')).toContainText('Correct');
    await page.waitForTimeout(500);
    const attempts = await attemptsSince(student, before, [RW]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ correct: 0, picked: 'B' });
    const progress = await progressOf(student, RW);
    expect(progress.attempts).toBe(progress0 + 1);
    expect(progress.marker).toBe('Red');
    // Skip to the end: the results are first-try (0 of 1) and call the solved retry Corrected.
    for (let k = 0; k < 8; k++) await primary(page).click();
    await expect(primary(page)).toHaveText('Finish');
    await primary(page).click();
    await expect(page.locator('#view-results')).toBeVisible();
    await expect(page.locator('#res-done')).toHaveText('1');
    await expect(page.locator('#res-correct')).toHaveText('0');
    await expect(page.locator('#res-acc')).toHaveText('0%');
    await expect(page.locator('#res-list .res-item').first()).toContainText('Corrected');
    await expect(page.locator('#res-list .res-item').nth(1)).toContainText('Skipped');
    await shot(page, 'C5-results-1366x768');
    // Back into a result: the question opens on the bank screen again.
    await page.locator('#res-list .res-item').first().click();
    await expect(page.locator('#bank-live')).toBeVisible();
    await expect(page.locator('#view-results')).toBeHidden();
    await expect(choiceBox(page, 'A')).toHaveClass(/right/);
    await page.locator('#bank-dashboard').click();
    await page.locator('#bank-exit-confirm').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#bank-live')).toBeHidden();
    // Mistakes lists it: first-try based.
    await page.locator('[data-tab="mistakes"]').click();
    await expect(page.locator('#tab-mistakes')).toContainText('Words in Context');
  } finally { await student.close(); }
});

test('C6 tools: Annotate does not pick a choice, cross-out, Mark for Review, Notes dock, calculator dock, timer, dark theme, phone width', async ({ browser }) => {
  test.setTimeout(150000);
  const student = await newUserContext(browser, 'e2e-student-4', { viewport: SIZES['1366x768'] });
  try {
    const page = await student.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await startPractice(page, { math: true });
    expect(await current(page)).toBe(MATH);
    // Annotate: select text in the stem with the tool on; a highlight appears and no choice is picked.
    await page.locator('#bank-annotate').click();
    await expect(page.locator('#bank-annotate')).toHaveAttribute('aria-pressed', 'true');
    const stem = page.locator('#bank-card .lesson-stem');
    const box = await stem.boundingBox();
    await page.mouse.move(box.x + 2, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + 10, { steps: 6 }); await page.mouse.up();
    await expect(page.locator('#bank-card [data-ann-mark]')).not.toHaveCount(0);
    await expect(primary(page)).toHaveText('Next');
    await expect(page.locator('#bank-card .choice.sel')).toHaveCount(0);
    await page.locator('#bank-annotate').click();
    // Cross out: the ABC tool, then a choice's letter; a crossed choice is not graded or picked.
    await page.locator('#bank-card .stage-strike-toggle').click();
    await page.locator('#bank-card [data-strike="B"]').click();
    await expect(page.locator('#bank-card .stage-choice[data-choice="B"]')).toHaveClass(/struck/);
    await page.locator('#bank-card .stage-strike-toggle').click();
    // Mark for Review shows in the question bar and in the navigator.
    await page.locator('#stage-flag').click();
    await expect(page.locator('#stage-flag')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#bank-nav').click();
    await expect(page.locator('[data-bank-q][data-flagged="true"]')).toHaveCount(1);
    await page.locator('#bank-nav').click();
    // Notes dock: typed text is saved to the question and shown as a chip.
    await page.locator('#bank-notes-toggle').click();
    await page.locator('#bank-notes-text').fill('remember the slope');
    await page.locator('#bank-notes-close').click();
    await expect(page.locator('#bank-note-chip')).toContainText('remember the slope');
    await expect.poll(async () => (await (await student.request.get('/api/notes')).json()).some(n => n.question_id === MATH && n.body === 'remember the slope')).toBe(true);
    // Calculator dock (College Board iframe): opens left, the column reflows to its right.
    const columnX = (await page.locator('#bank-card .stage-question').boundingBox()).x;
    await page.locator('#bank-calc-toggle').click();
    await expect(page.locator('#lesson-calc .lesson-calc-frame iframe')).toHaveAttribute('src', 'https://www.desmos.com/testing/collegeboard/graphing');
    expect((await page.locator('#bank-card .stage-question').boundingBox()).x, 'the question moves right of the calculator').toBeGreaterThan(columnX);
    await page.locator('#bank-calc-scientific').click();
    await expect(page.locator('#lesson-calc iframe')).toHaveAttribute('src', 'https://www.desmos.com/testing/collegeboard/scientific');
    await page.locator('#lesson-calc-close').click();
    // Timer: Hide hides only the digits; Pause hides the question and Resume brings it back.
    await page.locator('#bank-live .lesson-timer button', { hasText: 'Hide' }).click();
    await expect(page.locator('#bank-clock')).toHaveCSS('visibility', 'hidden');
    await page.locator('#bank-live .lesson-timer button', { hasText: 'Show' }).click();
    await expect(page.locator('#bank-clock')).toHaveCSS('visibility', 'visible');
    await page.locator('#bank-pause').click();
    await expect(page.locator('#bank-card')).toBeHidden();
    await expect(page.locator('.bank-paused')).toBeVisible();
    await page.locator('#bank-pause').click();
    await expect(page.locator('#bank-card')).toBeVisible();
    // Dark theme: the screen goes dark, the footer stays pinned when the page scrolls.
    await page.locator('#bank-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.evaluate(() => document.getElementById('bank-live').scrollTo(0, 300));
    const dark = await page.evaluate(() => { const f = document.querySelector('#bank-live .lesson-footer').getBoundingClientRect(); return { bottom: f.bottom, vh: innerHeight, bg: getComputedStyle(document.getElementById('bank-content')).backgroundColor, filter: getComputedStyle(document.querySelector('#bank-live .lesson-main')).filter }; });
    expect(dark.bottom).toBe(dark.vh);
    expect(dark.bg).toBe('rgb(20, 20, 20)');
    expect(dark.filter).toMatch(/invert/);
    await shot(page, 'C6-dark-1366x768');
    await page.locator('#bank-theme').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    // Phone width: nothing scrolls sideways, the footer button is on screen.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.evaluate(() => document.getElementById('bank-live').scrollTo(0, 0));
    const phone = await page.evaluate(() => { const b = document.getElementById('bank-primary').getBoundingClientRect(); return { scroll: document.documentElement.scrollWidth, live: document.getElementById('bank-live').scrollWidth - document.getElementById('bank-live').clientWidth, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight }; });
    expect(phone.scroll).toBeLessThanOrEqual(phone.vw);
    expect(phone.live).toBeLessThanOrEqual(0);
    expect(phone.right).toBeLessThanOrEqual(phone.vw);
    expect(phone.bottom).toBeLessThanOrEqual(phone.vh);
    await shot(page, 'C6-phone-390x780');
    expect(errors).toEqual([]);
  } finally { await student.close(); }
});

test('C7 the keyboard: 1-4 pick, the arrows move, Enter checks a grid-in; Dashboard asks first', async ({ browser }) => {
  const student = await newUserContext(browser, 'e2e-student-4', { viewport: SIZES['1366x768'] });
  try {
    const page = await student.newPage();
    await startPractice(page);
    await page.locator('#bank-card').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('2');
    await expect(choiceBox(page, 'B')).toHaveClass(/sel/);
    await expect(primary(page)).toHaveText('Check');
    await page.keyboard.press('3');
    await expect(choiceBox(page, 'C')).toHaveClass(/sel/);
    await expect(choiceBox(page, 'B')).not.toHaveClass(/sel/);
    await page.keyboard.press('ArrowRight');
    expect(await current(page)).toBe(MATH);
    await page.keyboard.press('ArrowLeft');
    expect(await current(page)).toBe(RW);
    await page.locator('#bank-dashboard').click();
    await expect(page.locator('#bank-exit-dialog')).toBeVisible();
    await page.locator('#bank-exit-cancel').click();
    await expect(page.locator('#bank-exit-dialog')).toBeHidden();
    await expect(page.locator('#bank-live')).toBeVisible();
  } finally { await student.close(); }
});

test('C8 a note typed on one question is saved to that question when Next is pressed straight away', async ({ browser }) => {
  const student = await newUserContext(browser, 'e2e-student-4', { viewport: SIZES['1366x768'] });
  try {
    const page = await student.newPage();
    const text = `note for the first question ${Date.now()}`;    // unique: the local database keeps notes between runs
    await startPractice(page);
    expect(await current(page)).toBe(RW);
    await page.locator('#bank-notes-toggle').click();
    await page.locator('#bank-notes-text').fill(text);
    // No blur, no Close, no wait for the debounce: a DOM click moves no focus (the per-question timer's auto-advance does the same).
    await page.evaluate(() => document.getElementById('bank-primary').click());
    expect(await current(page)).toBe(MATH);
    await expect(page.locator('#bank-notes-text')).not.toHaveValue(text);   // the next question's own note (C6 may have left one)
    await expect.poll(async () => (await (await student.request.get('/api/notes')).json()).filter(n => n.body === text).map(n => n.question_id)).toEqual([RW]);
    await page.locator('#bank-back').click();
    await expect(page.locator('#bank-notes-text')).toHaveValue(text);
  } finally { await student.close(); }
});

// Practice exams keep the old player (a different contract: no Check, answers saved as you go). A saved exam session is
// resumed from the Exams tab; the old screen must still draw, take answers and save & quit.
test('C9 a practice exam still plays on the old screen: no Check, no retry, answers saved as you go, Save & quit', async ({ browser }) => {
  test.setTimeout(90000);
  const student = await newUserContext(browser, 'e2e-student-4', { viewport: SIZES['1366x768'] });
  try {
    const exams = await (await student.request.get('/exams.json')).json();
    const testId = (Array.isArray(exams) ? exams : exams.tests || exams.exams)[0].id;
    const id = 'ex_e2e_bank_bluebook';
    const state = { id, kind: 'exam', testId, name: 'E2E exam', mode: 'untimed', modIdx: 0, route: {}, startedAt: Date.now(), finished: null, score: null,
      mods: [{ ids: [RW, MATH, SPR], ans: {}, flags: {}, elapsed: 0, done: false }, { ids: null, ans: {}, flags: {}, elapsed: 0, done: false }, { ids: null, ans: {}, flags: {}, elapsed: 0, done: false }, { ids: null, ans: {}, flags: {}, elapsed: 0, done: false }] };
    const saved = await student.request.post('/api/sessions', { headers: { Origin: ORIGIN }, data: [{ id, kind: 'exam', state }] });
    expect(saved.status(), await saved.text()).toBe(200);
    const page = await student.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/app');
    await page.locator('[data-tab="exams"]').click();
    await page.locator(`[data-resume="${id}"]`).click();
    await expect(page.locator('#view-test')).toBeVisible();
    await expect(page.locator('#bank-live')).toBeHidden();
    await expect(page.locator('#pane-a #choices .choice')).toHaveCount(4);
    await page.locator('#pane-a .choice[data-letter="B"]').click();
    await expect(page.locator('#pane-a .choice[data-letter="B"]')).toHaveClass(/sel/);
    await expect(page.locator('.chk-btn, #bank-primary')).toHaveCount(0);             // nothing is graded in an exam
    await expect(page.locator('#expl-panel')).toHaveCount(0);
    await page.locator('#btn-next').click();
    await expect(page.locator('#pane-a .stem')).toContainText('3 + 4');
    await page.locator('#btn-next').click();
    await page.locator('#pane-a #gi').fill('3');
    await expect(page.locator('#pane-a #gi-submit')).toHaveCount(0);
    await expect(page.locator('#btn-next')).toHaveText('Finish module');
    await page.locator('#btn-back').click();
    await page.locator('#btn-back').click();
    await expect(page.locator('#pane-a .choice[data-letter="B"]')).toHaveClass(/sel/);  // the answer was kept
    await page.locator('#btn-dash').click();
    await expect(page.locator('#modal-root')).toContainText('Save and quit');
    await page.locator('#cm-yes').click();
    await expect(page.locator('#view-home')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await student.close(); }
});
