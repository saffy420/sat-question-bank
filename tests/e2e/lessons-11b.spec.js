import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN, CHROMEBOOK } from './lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from './lessons-00b-e2e-harness/leaks.js';

// lessons-11b: instructor screen cleanup (B1 fixed split, B2 layout) and the question navigator (B3).
// Instructor at 1920×1080 and 1366×768, students at 1366×768 (school Chromebooks).
const artifacts = '.omp/pipeline/lessons-11b-instructor-ui/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const RW = 'e2e-core-rw', SPLIT = 'e2e-split-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr';
const LAPTOP = { width: 1920, height: 1080 };

async function room(admin, items, title) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode: 'instructor', items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return await started.json();
}
async function teacherPage(admin, sessionId) {
  const page = await admin.newPage();
  await page.goto(`/admin/live/${sessionId}`);
  await expect(page.locator('#live-link')).toHaveText('Connected');
  return page;
}
async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  const socket = page.waitForEvent('websocket', { predicate: ws => roomSocket.test(ws.url()) });
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await socket;
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}
const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const phase = (page, text) => expect(page.locator('#lesson-content')).toContainText(text);
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });
const api = async (admin, sessionId) => (await admin.request.get(`/api/lessons/${sessionId}`)).json();
// Every visible control on the page (the toolbar, the bar, the stage, Desmos) that the join code box overlaps.
const underJoinCode = page => page.evaluate(() => {
  const code = document.getElementById('live-join').getBoundingClientRect();
  return [...document.querySelectorAll('button, input, select, summary, a, [role="button"], [tabindex]')].filter(el => {
    if (el.closest('#live-join')) return false;
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!r.width || !r.height || style.visibility === 'hidden') return false;
    return r.left < code.right && r.right > code.left && r.top < code.bottom && r.bottom > code.top;
  }).map(el => el.id || el.getAttribute('aria-label') || el.className || el.tagName);
});
// Native selection + pointerup through the real instructor toolbar handler (as in tasks 05 and 10).
async function selectText(page, text) {
  await page.locator('#live-card .lesson-stem').evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return;
    }
    throw Error(`Fixture text missing: ${text}`);
  }, text);
}

for (const viewport of [LAPTOP, CHROMEBOOK]) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`11b instructor layout ${size}: fixed split, full-screen question, bottom bar, popup, drawers, join code`, async ({ browser }) => {
    test.setTimeout(120000);
    mkdirSync(artifacts, { recursive: true });
    const admin = await newUserContext(browser, 'e2e-admin', { viewport });
    const student = await newUserContext(browser, 'e2e-student-4');
    const leaks = captureLeaks(student, { phaseAware: true });
    try {
      const title = `Task11b layout ${size}`;
      const { sessionId, joinCode } = await room(admin, [
        { question_id: SPLIT, time_limit_sec: 90, notes: 'E2E_NOTES_MARKER_11B compare \\(x+1\\) with the passage.' },
        { question_id: MATH, time_limit_sec: 90, notes: '' }], title);
      const teacher = await teacherPage(admin, sessionId);
      const pupil = await student.newPage();
      await join(pupil, joinCode);
      await expect(teacher.locator('#live-roster')).toContainText('E2E Student 4');
      await expect(teacher.locator('#side')).not.toHaveClass(/collapsed/);
      await teacher.locator('[data-live="start"]').click();
      await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
      await expect(pupil.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
      await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'ANSWERING');

      // App sidebar: collapses when the session starts; the instructor can still expand it.
      await expect(teacher.locator('#side')).toHaveClass(/collapsed/);
      await teacher.locator('#collapse').click();
      await expect(teacher.locator('#side')).not.toHaveClass(/collapsed/);
      await pupil.locator('[data-lesson-choice="B"]').click();
      await expect(teacher.locator('#live-responses')).toHaveText('1 of 1 responses');
      await expect(teacher.locator('#side')).not.toHaveClass(/collapsed/, { timeout: 1000 });
      await expect.poll(async () => (await box(teacher.locator('.live-area'))).left).toBe((await box(teacher.locator('#side'))).right);
      await teacher.locator('#collapse').click();
      await expect(teacher.locator('#side')).toHaveClass(/collapsed/);

      // B2 deletions: header row (badge, title, code, joined, Q n/N, timer), rail, meta strip, Responses panel.
      for (const gone of ['.live-top', '.question-rail', '.stage-heading', 'aside.responses', '.instructor-drawer', '.live-facts'])
        await expect(teacher.locator(gone)).toHaveCount(0);
      await expect(teacher.locator('#body')).not.toContainText('Correct:');
      await expect(teacher.locator('#body')).not.toContainText(title);
      await expect(teacher.locator('.live-bar')).not.toContainText('joined');

      // B1: no divider or expand controls on either view; a fixed 50/50 split.
      for (const page of [teacher, pupil]) {
        await expect(page.locator('.stage-divider, .stage-expand, .stage-grip, [role="separator"]')).toHaveCount(0);
        const card = page === teacher ? '#live-card' : '#lesson-card';
        await expect(page.locator(card)).toHaveClass(/stage-split/);
        const [passage, question] = [await box(page.locator(`${card} .stage-passage`)), await box(page.locator(`${card} .stage-question`))];
        expect(Math.abs(passage.width - question.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(passage.right - question.left)).toBeLessThanOrEqual(1);
      }

      // Margins: text sits at least 24px inside its pane, with the student view's inset.
      const inset = async (page, card) => {
        const pane = await box(page.locator(`${card} .stage-passage`)), text = await box(page.locator(`${card} .stage-passage p`).first());
        const qpane = await box(page.locator(`${card} .stage-question`)), choice = await box(page.locator(`${card} .stage-choice`).first());
        return { left: text.left - pane.left, right: qpane.right - choice.right };
      };
      const own = await inset(teacher, '#live-card');
      expect(own.left).toBeGreaterThanOrEqual(24);
      expect(own.right).toBeGreaterThanOrEqual(24);
      const studentText = await box(pupil.locator('#lesson-card .stage-passage p').first());
      const studentMain = await pupil.locator('.lesson-main').evaluate(el => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
      const studentInset = studentText.left - (await box(pupil.locator('.lesson-main'))).left;
      expect(studentText.left).toBeCloseTo(studentMain, 0);
      if (viewport.width === CHROMEBOOK.width) expect(Math.abs(own.left - studentInset)).toBeLessThanOrEqual(1);

      // No blank bands: the question area runs from the top of the viewport to the bottom bar.
      const [area, tools, body, bar, stage] = await Promise.all(['.live-area', '#live-tools', '.live-body', '.live-bar', '#live-stage'].map(s => box(teacher.locator(s))));
      expect(area.top).toBe(0);
      expect(tools.top).toBe(0);
      expect(Math.abs(body.top - tools.bottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(body.bottom - bar.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(stage.bottom - bar.top)).toBeLessThanOrEqual(1);
      expect(area.right).toBe(viewport.width);
      expect(bar.bottom).toBe(viewport.height);
      expect(await teacher.locator('#live-tools button:visible').count()).toBeGreaterThanOrEqual(6);
      // Annotation tools wait for the reveal.
      await expect(teacher.locator('[data-tool="pen"]')).toBeDisabled();

      // Correct answer: marked on the instructor's own choices in every phase; never sent before reveal.
      await expect(teacher.locator('#live-card [data-lesson-choice="A"] .choice')).toHaveClass(/right/);
      await expect(pupil.locator('#lesson-card .choice.right')).toHaveCount(0);

      // Join code: semi-opaque black box, large monospace, top-right, over no control.
      const code = teacher.locator('#live-join');
      await expect(code).toContainText(joinCode);
      await expect(code.locator('strong')).toHaveCSS('font-family', /mono/i);
      expect(parseFloat(await code.locator('strong').evaluate(el => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
      expect(await code.evaluate(el => getComputedStyle(el).backgroundColor)).toMatch(/^rgba\(0, 0, 0, 0\.[0-9]+\)$/);
      const corner = await box(code);
      expect(viewport.width - corner.right).toBeLessThanOrEqual(20);
      expect(corner.top).toBeLessThanOrEqual(10);
      expect(await underJoinCode(teacher)).toEqual([]);

      // Bottom bar, left to right: navigator, timer (+15s, End now), Responses, Notes, connection, End session.
      const order = ['#live-prev', '#live-nav', '#live-next', '#live-timer', '[data-live="addTime"]', '[data-live="endNow"]', '#live-responses', '#live-notes', '#live-link', '[data-live="endSession"]'];
      const xs = [];
      for (const selector of order) {
        const b = await box(teacher.locator(`.live-bar ${selector}`));
        expect(b.top).toBeGreaterThanOrEqual(bar.top); expect(b.bottom).toBeLessThanOrEqual(bar.bottom);
        xs.push(b.left);
      }
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      await expect(teacher.locator('#live-nav')).toHaveText('Question 1 of 2');
      await expect(teacher.locator('#live-timer')).toHaveText(/\d:\d\d/);
      await shot(teacher, `instructor-${size}-answering`);
      await shot(pupil, 'student-1366x768-answering');

      // Responses popup: overlays the question above the bar; everything the old panel held; live.
      await teacher.locator('#live-responses').click();
      const popup = teacher.locator('#live-responses-popup');
      await expect(popup).toBeVisible();
      await expect(popup).toHaveAttribute('role', 'dialog');
      const pop = await box(popup);
      expect(pop.bottom).toBeLessThanOrEqual(bar.top);
      expect(pop.top).toBeGreaterThanOrEqual(0);
      await expect(popup.locator('#live-sort')).toBeVisible();
      await expect(popup).toContainText('1 joined');
      await expect(popup.locator('[data-response="e2e-student-4"]')).toContainText('E2E Student 4selectedB');
      await expect(popup.locator('#live-class')).toBeVisible();
      await popup.locator('.roster-details summary').click();
      await expect(popup.locator('#live-lock')).toBeVisible();
      await expect(popup.locator('#live-roster')).toContainText('E2E Student 4');
      await pupil.locator('[data-lesson-choice="C"]').click();
      await expect(popup.locator('[data-response="e2e-student-4"]')).toContainText('E2E Student 4selectedC');
      await shot(teacher, `instructor-${size}-responses-popup`);
      await teacher.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
      await teacher.locator('#live-responses').click();
      await expect(popup).toBeVisible();
      await teacher.locator('#live-card .lesson-stem').click({ position: { x: 5, y: 5 } });
      await expect(popup).toHaveCount(0);
      await teacher.locator('#live-responses').click();
      await expect(popup).toBeVisible();
      await teacher.locator('#live-responses').click();
      await expect(popup).toHaveCount(0);

      // Reveal: distribution with clickable bars and class results, in the popup.
      await teacher.locator('[data-live="endNow"]').click();
      await phase(pupil, 'REVEALED');
      await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
      await expect(teacher.locator('[data-tool="pen"]')).toBeEnabled();
      await expect(teacher.locator('#live-card [data-lesson-choice="A"] .choice')).toHaveClass(/right/);
      await teacher.locator('#live-responses').click();
      await expect(popup.locator('[data-group="2"]')).toContainText('C1');
      await popup.locator('[data-group="2"]').click();
      await expect(teacher.locator('#live-group')).toContainText('E2E Student 4');
      await teacher.keyboard.press('Escape');
      await expect(teacher.locator('#live-group')).toHaveCount(0);
      await expect(popup).toBeVisible();
      await popup.locator('#live-class').check();
      await expect(pupil.locator('#lesson-content')).toContainText('Class results');
      await teacher.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
      expect(await underJoinCode(teacher)).toEqual([]);

      // Notes drawer: slides in from the right over the question, not over the bar; math renders.
      const notes = teacher.locator('#live-notes-drawer');
      await expect(notes).toBeHidden();
      await teacher.locator('#live-notes').click();
      await expect(notes).toBeVisible();
      await expect(notes).toContainText('E2E_NOTES_MARKER_11B');
      await expect(notes).toContainText('E2E_EXPL_MARKER_SPLIT');
      await expect(notes.locator('.katex')).toHaveCount(1);
      await expect.poll(async () => (await box(notes)).right).toBe(viewport.width);
      const drawn = await box(notes);
      expect(drawn.bottom).toBeLessThanOrEqual(bar.top + 1);
      expect(drawn.top).toBeGreaterThanOrEqual(tools.bottom - 1);
      await shot(teacher, `instructor-${size}-revealed-notes`);
      await notes.getByRole('button', { name: 'Close notes' }).click();
      await expect(notes).toBeHidden();

      // Question 2 (math): Desmos sits in the annotation toolbar; the join code still covers nothing.
      await teacher.locator('#live-next').click();
      await expect(teacher.locator('#live-nav')).toHaveText('Question 2 of 2');
      await expect(teacher.locator('#live-card [data-lesson-choice="C"] .choice')).toHaveClass(/right/);
      await teacher.locator('[data-live="startQuestion"]').click();
      await phase(pupil, 'ANSWERING');
      await expect(teacher.locator('#live-card [data-lesson-choice="C"] .choice')).toHaveClass(/right/);
      await expect(teacher.locator('#live-tools #live-desmos-toggle')).toBeVisible();
      await teacher.locator('#live-tools #live-desmos-toggle').click();
      await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
      const desmos = await box(teacher.locator('#live-desmos'));
      expect(desmos.top).toBeGreaterThanOrEqual(tools.bottom - 1);
      expect(Math.abs(desmos.bottom - bar.top)).toBeLessThanOrEqual(1);
      expect(await underJoinCode(teacher)).toEqual([]);
      await shot(teacher, `instructor-${size}-math-desmos`);
      await teacher.locator('[data-live="endNow"]').click();
      await phase(pupil, 'REVEALED');
      expect(await underJoinCode(teacher)).toEqual([]);

      await teacher.locator('[data-live="endSession"]').click();
      await expect(teacher.locator('#live-timer')).toHaveText('Session ended');
      await leaks.flush();
      expect(leaks.frames.length).toBeGreaterThan(0);
      expect(leaks.violations()).toEqual([]);
    } finally { await student.close().catch(() => {}); await admin.close().catch(() => {}); }
  });
}

test('11b navigator: play Q1–Q3, back to Q1 and forward; nothing re-answered, timers and stats unchanged', async ({ browser }) => {
  test.setTimeout(150000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: LAPTOP });
  const contexts = [];
  try {
    const { sessionId, joinCode } = await room(admin, [
      { question_id: RW, time_limit_sec: 60, notes: '' },
      { question_id: MATH, time_limit_sec: 60, notes: '' },
      { question_id: SPR, time_limit_sec: 60, notes: '' },
      { question_id: SPLIT, time_limit_sec: 60, notes: '' }], 'Task11b navigator');
    const teacher = await teacherPage(admin, sessionId);
    const names = ['E2E Student 2', 'E2E Student 3'];
    const pages = [], captures = [];
    for (const [i, userId] of ['e2e-student-2', 'e2e-student-3'].entries()) {
      const context = await newUserContext(browser, userId); contexts.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, n) => n !== i) }));
      const page = await context.newPage(); pages.push(page);
      await join(page, joinCode);
    }
    const [one, two] = pages;
    const nav = teacher.locator('#live-nav'), drawer = teacher.locator('#live-nav-drawer');

    // Q1 (R&W): one right, one wrong, then a shared highlight.
    await teacher.locator('[data-live="start"]').click();
    for (const page of pages) await phase(page, 'ANSWERING');
    await expect(teacher.locator('#live-prev')).toBeDisabled();
    await expect(teacher.locator('#live-next')).toBeDisabled();
    await nav.click();
    await expect(drawer.locator('[data-nav-index="0"]')).toHaveAttribute('aria-current', 'step');
    for (const i of [1, 2, 3]) await expect(drawer.locator(`[data-nav-index="${i}"]`)).toBeDisabled();
    await teacher.keyboard.press('Escape');
    await one.locator('[data-lesson-choice="A"]').click();
    await two.locator('[data-lesson-choice="B"]').click();
    await expect(teacher.locator('#live-responses')).toHaveText('2 of 2 responses');
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await phase(page, 'REVEALED');
    await teacher.locator('[data-tool="highlight"]').click();
    await selectText(teacher, 'club made');
    for (const page of pages) await expect(page.locator('#lesson-card [data-ann-mark]')).toHaveText('club made');

    // Drawer: every question, number, stem snippet, ID and response count; only played + next unplayed open.
    await nav.click();
    await expect(drawer).toBeVisible();
    const areaLeft = (await box(teacher.locator('.live-area'))).left;
    await expect.poll(async () => (await box(drawer)).left).toBe(areaLeft);
    const drawn = await box(drawer), bar = await box(teacher.locator('.live-bar'));
    expect(drawn.bottom).toBeLessThanOrEqual(bar.top + 1);
    await expect(drawer.locator('[data-nav-index]')).toHaveCount(4);
    await expect(drawer.locator('[data-nav-index="0"]')).toContainText('1Which word best completes the sentence?');
    await expect(drawer.locator('[data-nav-index="0"]')).toContainText(`${RW} · 2 responses`);
    await expect(drawer.locator('[data-nav-index="1"]')).toContainText('What is 3 + 4?');
    await expect(drawer.locator('[data-nav-index="1"]')).toContainText(`${MATH} · 0 responses`);
    await expect(drawer.locator('[data-nav-index="3"]')).toContainText(SPLIT);
    await expect(drawer.locator('[data-nav-index="0"]')).toHaveAttribute('aria-current', 'step');
    await expect(drawer.locator('[data-nav-index="1"]')).toBeEnabled();
    for (const i of [2, 3]) await expect(drawer.locator(`[data-nav-index="${i}"]`)).toBeDisabled();
    await expect(drawer).toHaveCSS('overflow-y', 'auto');
    await shot(teacher, 'instructor-1920x1080-navigator');
    await teacher.locator('#live-card .lesson-stem').click({ position: { x: 5, y: 5 } });
    await expect(drawer).toBeHidden();

    // Q2 (math) through › (Next): a graph after the reveal.
    await teacher.locator('#live-next').click();
    for (const page of pages) { await phase(page, 'READY'); await expect(page.locator('.lesson-position')).toHaveText('Question 2 of 4'); }
    await expect(teacher.locator('#live-next')).toBeDisabled();
    await teacher.locator('[data-live="startQuestion"]').click();
    await one.locator('[data-lesson-choice="C"]').click();
    await expect(teacher.locator('#live-responses')).toHaveText('1 of 2 responses');
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await phase(page, 'REVEALED');
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await teacher.locator('#live-desmos .dcg-new-expression').click();
    await teacher.keyboard.type('y=4242x');
    for (const page of pages) await expect(page.locator('#lesson-desmos .dcg-expressionlist')).toContainText('4242');

    // Q3 (SPR) through the drawer's next unplayed row.
    await nav.click();
    await drawer.locator('[data-nav-index="2"]').click();
    await expect(drawer).toBeHidden();
    for (const page of pages) { await phase(page, 'READY'); await expect(page.locator('.lesson-position')).toHaveText('Question 3 of 4'); }
    await teacher.locator('[data-live="startQuestion"]').click();
    await one.locator('#lesson-grid').fill('3');
    await two.locator('#lesson-grid').fill('4');
    await expect(teacher.locator('#live-responses')).toHaveText('2 of 2 responses');
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await phase(page, 'REVEALED');
    await teacher.locator('#live-responses').click();
    const distribution = await teacher.locator('#live-responses-popup .distribution').innerText();
    await teacher.keyboard.press('Escape');

    // What the room holds after three played questions: answers, locks, times, counts.
    const before = await api(admin, sessionId);
    expect([before.index, before.reached, before.played]).toEqual([2, 2, 3]);
    const stats = s => JSON.stringify(s.responses);
    for (const page of pages) await expect(page.locator('#lesson-clock')).toHaveText('0:00');

    // Back to Q1 through the drawer.
    await nav.click();
    await expect(drawer.locator('[data-nav-index="2"]')).toHaveAttribute('aria-current', 'step');
    for (const i of [0, 1]) await expect(drawer.locator(`[data-nav-index="${i}"]`)).toBeEnabled();
    await expect(drawer.locator('[data-nav-index="3"]')).toBeEnabled();
    await drawer.locator('[data-nav-index="0"]').click();
    await expect(nav).toHaveText('Question 1 of 4');
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    await expect(teacher.locator('#live-timer')).toHaveText('—');
    await expect(teacher.locator('[data-live="startQuestion"], [data-live="endNow"], [data-live="addTime"]')).toHaveCount(0);
    await expect(teacher.locator('#live-prev')).toBeDisabled();
    await expect(teacher.locator('#live-card [data-ann-mark]')).toHaveText('club made');
    for (const page of pages) {
      await expect(page.locator('.lesson-position')).toHaveText('Question 1 of 4');
      await phase(page, 'REVEALED');
      await expect(page.locator('#lesson-clock')).toHaveText('');
      await expect(page.locator('#lesson-card [data-ann-mark]')).toHaveText('club made');
      await expect(page.locator('[data-lesson-choice="A"] .choice')).toHaveClass(/right/);
      for (const letter of ['A', 'B', 'C', 'D']) await expect(page.locator(`[data-lesson-choice="${letter}"]`)).toBeDisabled();
      await expect(page.locator('#lesson-lock')).toBeDisabled();
    }
    await expect(one.locator('#lesson-content')).toContainText('Your answer: A');
    await expect(two.locator('[data-lesson-choice="B"] .choice')).toHaveClass(/wrong/);
    await expect(two.locator('#lesson-content')).toContainText('Your answer: B');
    await teacher.locator('#live-responses').click();
    await expect(teacher.locator('#live-responses-popup [data-group="0"]')).toContainText('A1');
    await expect(teacher.locator('#live-responses-popup [data-group="1"]')).toContainText('B1');
    await teacher.keyboard.press('Escape');
    await shot(teacher, 'instructor-1920x1080-revisit-q1');
    await shot(two, 'student-1366x768-revisit-q1');
    expect(stats(await api(admin, sessionId))).toBe(stats(before));

    // Forward again with ›: Q2 keeps its graph, Q3 its distribution; then › on Q3 is Next.
    await teacher.locator('#live-next').click();
    await expect(nav).toHaveText('Question 2 of 4');
    for (const page of pages) {
      await expect(page.locator('.lesson-position')).toHaveText('Question 2 of 4');
      await phase(page, 'REVEALED');
      await expect(page.locator('#lesson-desmos .dcg-expressionlist')).toContainText('4242');
    }
    await expect(one.locator('[data-lesson-choice="C"] .choice')).toHaveClass(/right/);
    await expect(two.locator('#lesson-content')).toContainText('No answer selected');
    await expect(teacher.locator('#live-desmos .dcg-expressionlist')).toContainText('4242');
    await teacher.locator('#live-next').click();
    await expect(nav).toHaveText('Question 3 of 4');
    for (const page of pages) { await expect(page.locator('.lesson-position')).toHaveText('Question 3 of 4'); await phase(page, 'REVEALED'); }
    await expect(one.locator('#lesson-content')).toContainText('Your answer: 3');
    await expect(one.locator('#lesson-grid')).toBeDisabled();
    await teacher.locator('#live-responses').click();
    expect(await teacher.locator('#live-responses-popup .distribution').innerText()).toBe(distribution);
    await teacher.keyboard.press('Escape');
    const after = await api(admin, sessionId);
    expect(stats(after)).toBe(stats(before));
    expect([after.index, after.reached, after.played, after.revisit]).toEqual([2, 2, 3, false]);

    await teacher.locator('#live-next').click();
    for (const page of pages) { await phase(page, 'READY'); await expect(page.locator('.lesson-position')).toHaveText('Question 4 of 4'); }
    await expect(teacher.locator('[data-live="startQuestion"]')).toBeVisible();
    await expect(teacher.locator('#live-next')).toBeDisabled();
    expect(stats(await api(admin, sessionId))).toBe(stats(before));

    for (const capture of captures) {
      await capture.flush();
      expect(capture.frames.length).toBeGreaterThan(0);
      expect(capture.violations()).toEqual([]);
    }
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('#live-timer')).toHaveText('Session ended');
  } finally { for (const context of contexts) await context.close().catch(() => {}); await admin.close().catch(() => {}); }
});

// Long lessons: the drawer scrolls and its last row can be reached (a short window stands in for a long list).
test('11b navigator drawer scrolls for a long lesson', async ({ browser }) => {
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1366, height: 420 } });
  try {
    const items = [RW, MATH, SPR, SPLIT, 'e2e-ai-rw', 'e2e-unused'].map(question_id => ({ question_id, time_limit_sec: 30, notes: '' }));
    const { sessionId } = await room(admin, items, 'Task11b long');
    const teacher = await teacherPage(admin, sessionId);
    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await teacher.locator('#live-nav').click();
    const drawer = teacher.locator('#live-nav-drawer');
    await expect(drawer.locator('[data-nav-index]')).toHaveCount(6);
    expect(await drawer.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await drawer.locator('[data-nav-index="5"]').scrollIntoViewIfNeeded();
    await expect(drawer.locator('[data-nav-index="5"]')).toBeInViewport();
    expect(await drawer.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('#live-timer')).toHaveText('Session ended');
  } finally { await admin.close().catch(() => {}); }
});
