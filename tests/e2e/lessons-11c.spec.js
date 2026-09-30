import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from './lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from './lessons-00b-e2e-harness/leaks.js';

// lessons-11c: the student's own Desmos calculator (C1) and Try it yourself (C2).
const artifacts = '.omp/pipeline/lessons-11c-student-desmos/e2e';
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const REPLACE_TEXT = 'This will delete everything in your calculator and replace it with your instructor\'s graph.';
const own = page => page.locator('#lesson-calc');
const ownList = page => page.locator('#lesson-calc .dcg-expressionlist');
const followerList = page => page.locator('#lesson-desmos .dcg-expressionlist');
const teacherList = page => page.locator('#live-desmos .dcg-expressionlist');
// The student's own rows as Desmos state would carry them (latex), not bare digits: every frame has
// 13-digit millisecond timestamps that can contain any four-digit run.
const MARKERS = /y=1111x|y=3131|y=6161/;
const LEAK = /y=1111x|y=3131|y=6161|"desmos"|expressions/;
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });

async function room(admin, mode, items) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `Task11c ${mode} ${Date.now()}`, mode, items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
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

// Everything the student's client sends: WebSocket frames and HTTP request bodies.
function outgoing(page) {
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', e => sent.push(typeof e.payload === 'string' ? e.payload : Buffer.from(e.payload).toString('utf8'))));
  page.on('request', r => { const body = r.postData(); if (body) sent.push(body); });
  return sent;
}

async function openCalculator(page) {
  await page.locator('#lesson-calc-toggle').click();
  await expect(own(page)).toBeVisible();
  await expect(page.locator('#lesson-calc .lesson-calc-body[data-ready]')).toBeAttached();
  await expect(page.locator('#lesson-calc .dcg-expressionlist')).toBeVisible();
}

// Types into the calculator's first empty row, like a student would.
async function typeOwn(page, latex) {
  await page.locator('#lesson-calc .dcg-new-expression').click();
  await page.keyboard.type(latex);
  await expect(ownList(page)).toContainText(latex.replace(/^y=/, ''));
}

async function typeTeacher(teacher, latex) {
  await teacher.locator('#live-desmos .dcg-new-expression').click();
  await teacher.keyboard.type(latex);
  await expect(teacherList(teacher)).toContainText(latex.replace(/^y=/, ''));
}

const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
const viewport = page => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

// The question (stem and every choice / the grid-in) is fully visible and clear of the window.
async function questionClear(page) {
  const win = await box(own(page));
  const vp = await viewport(page);
  const parts = page.locator('#lesson-card .lesson-stem, #lesson-card .stage-choice, #lesson-card .gridin-wrap');
  expect(await parts.count()).toBeGreaterThan(0);
  for (const part of await parts.all()) {
    const b = await box(part);
    expect(overlaps(win, b), `window ${JSON.stringify(win)} covers ${JSON.stringify(b)}`).toBe(false);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(vp.w);
  }
}

async function insideViewport(page) {
  const win = await box(own(page));
  const vp = await viewport(page);
  expect(win.x).toBeGreaterThanOrEqual(0);
  expect(win.y).toBeGreaterThanOrEqual(0);
  expect(win.right).toBeLessThanOrEqual(vp.w + 0.5);
  expect(win.bottom).toBeLessThanOrEqual(vp.h + 0.5);
}

async function drag(page, handle, dx, dy) {
  const b = await box(handle);
  const x = b.x + Math.min(40, b.w / 2), y = b.y + b.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

// Latex of every row, read from the rendered expression list (the only place a student sees it).
const rows = list => list.locator('.dcg-expressionitem.dcg-mathitem').evaluateAll(els => els.map(el => el.querySelector('.dcg-mq-root-block')?.textContent || '').filter(Boolean));

test('lessons-11c C1+C2 instructor-paced: own calculator, drag/resize, layout shift, persistence, no payloads; Try it yourself empty and non-empty paths', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const one = await newUserContext(browser, 'e2e-student-2');
  const two = await newUserContext(browser, 'e2e-student-3');
  const leaks = [captureLeaks(one, { phaseAware: true }), captureLeaks(two, { phaseAware: true })];
  const teacherSeen = captureLeaks(admin);
  try {
    const { sessionId, joinCode } = await room(admin, 'instructor', [MATH, RW, SPR].map(question_id => ({ question_id, time_limit_sec: 60, notes: '' })));
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const student = await one.newPage();
    const sent = outgoing(student);
    await join(student, joinCode);
    const second = await two.newPage();
    const sentTwo = outgoing(second);
    await join(second, joinCode);
    // Lobby: no question on screen, so no Calculator button.
    await expect(student.locator('.lesson-lobby')).toBeVisible();
    await expect(student.locator('#lesson-calc-toggle')).toHaveCount(0);

    // Q1 (math): Calculator button in the header tools; the calculator opens docked on the left (lessons-11).
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(student.locator('.lesson-header .lesson-tools #lesson-calc-toggle')).toBeVisible();
    await expect(student.locator('#lesson-calc-toggle')).toHaveAttribute('aria-pressed', 'false');
    await openCalculator(student);
    await expect(student.locator('#lesson-calc-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(student.locator('.lesson-main')).toHaveClass(/with-calc/);
    await insideViewport(student);
    await questionClear(student);
    const home = await box(own(student));
    const headerBottom = await student.locator('.lesson-header').evaluate(el => el.getBoundingClientRect().bottom);
    const footerTop = await student.locator('.lesson-footer').evaluate(el => el.getBoundingClientRect().top);
    // Docked left, between the header (with its phase label) and the footer, and the question column reflowed to its right.
    expect(home.x, 'docked at the left edge').toBeLessThanOrEqual(24);
    expect(home.y).toBeGreaterThanOrEqual(headerBottom);
    expect(home.y - headerBottom, 'directly under the header').toBeLessThanOrEqual(24);
    expect(home.bottom).toBeLessThanOrEqual(footerTop);
    expect(footerTop - home.bottom, 'directly above the footer').toBeLessThanOrEqual(24);
    expect(await student.locator('#lesson-calc').evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    const columnOf = () => box(student.locator('#lesson-card .stage-question'));
    expect((await columnOf()).x, 'the question column starts right of the dock').toBeGreaterThanOrEqual(home.right);
    await typeOwn(student, 'y=1111x');
    // The student can still answer with the calculator open.
    await student.locator('[data-lesson-choice="C"]').click();
    await expect(student.locator('[data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(student, '01-student-calculator-docked-1366');

    // No title-bar dragging any more: dragging the bar moves nothing.
    await drag(student, student.locator('#lesson-calc .lesson-calc-bar'), 300, 40);
    expect(await box(own(student))).toEqual(home);
    // Resizable only by the handle on its right edge: horizontal pointer movement changes the width by the delta, the
    // dock keeps its top and bottom (header to footer) and left edge, and vertical movement does nothing.
    await drag(student, student.locator('#lesson-calc-resize'), 120, -100);
    const sized = await box(own(student));
    expect(Math.round(sized.w - home.w)).toBe(120);
    expect([sized.x, sized.y, sized.h]).toEqual([home.x, home.y, home.h]);
    await expect(ownList(student)).toContainText('1111');
    await questionClear(student);
    expect((await columnOf()).x, 'the column follows the dock edge').toBeGreaterThanOrEqual(sized.right);
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe((await viewport(student)).w);
    await shot(student, '02-student-calculator-resized');
    await drag(student, student.locator('#lesson-calc-resize'), -60, 0);
    expect(Math.round((await box(own(student))).w - sized.w)).toBe(-60);
    // Width is clamped to [280, window width - 528] however far the handle is dragged; the question keeps its room.
    const vp = await viewport(student);
    await drag(student, student.locator('#lesson-calc-resize'), 4000, 4000);
    await insideViewport(student);
    const widest = await box(own(student));
    expect(Math.round(widest.w)).toBe(vp.w - 528);
    expect([widest.x, widest.y, widest.h]).toEqual([home.x, home.y, home.h]);
    await questionClear(student);
    expect((await columnOf()).x).toBeGreaterThanOrEqual(widest.right);
    expect(await student.evaluate(() => document.documentElement.scrollWidth)).toBe(vp.w);
    await drag(student, student.locator('#lesson-calc-resize'), -4000, -4000);
    await insideViewport(student);
    const small = await box(own(student));
    expect(Math.round(small.w)).toBe(280);
    expect([small.x, small.y, small.h]).toEqual([home.x, home.y, home.h]);
    await questionClear(student);

    // Close and reopen: the expressions are still there.
    await student.locator('#lesson-calc-close').click();
    await expect(own(student)).toBeHidden();
    await expect(student.locator('.lesson-main')).not.toHaveClass(/with-calc/);
    await student.locator('#lesson-calc-toggle').click();
    await expect(own(student)).toBeVisible();
    await expect(ownList(student)).toContainText('1111');

    // Q2 (R&W): no Calculator button and the window is hidden; the layout is not shifted.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('#lesson-content')).toContainText('REVEALED');
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(student.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(student.locator('[data-lesson-choice="A"]')).toContainText('careful');
    await expect(student.locator('.lesson-stage')).not.toHaveClass(/stage-math/);
    await expect(student.locator('#lesson-calc-toggle')).toHaveCount(0);
    await expect(own(student)).toBeHidden();
    await expect(student.locator('.lesson-main')).not.toHaveClass(/with-calc/);
    await shot(student, '03-student-rw-no-calculator');

    // Q3 (math, grid-in): the window is back, with the same expressions, at its last position.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('#lesson-content')).toContainText('REVEALED');
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(student.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(student.locator('#lesson-grid')).toBeVisible();
    await expect(own(student)).toBeVisible();
    await expect(ownList(student)).toContainText('1111');
    expect(await box(own(student))).toEqual(small);
    // Back at the default width: the question stays clear of the dock.
    await drag(student, student.locator('#lesson-calc-resize'), home.w - small.w, 0);
    const restored = await box(own(student));
    expect(Math.abs(restored.w - home.w)).toBeLessThanOrEqual(1);
    expect([restored.x, restored.y, restored.h]).toEqual([home.x, home.y, home.h]);
    await questionClear(student);
    await shot(student, '04-student-calculator-kept-next-question');

    // C2: the instructor's graph panel, after the reveal.
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await typeTeacher(teacher, 'y=2468x');
    await typeTeacher(teacher, 'y=x+57');
    await teacher.locator('[data-live="endNow"]').click();
    for (const p of [student, second]) {
      await expect(p.locator('#lesson-desmos')).toBeVisible();
      await expect(followerList(p)).toContainText('2468');
      await expect(p.locator('#lesson-desmos')).toHaveAttribute('data-mode', 'follow');
      // The old in-panel fork is gone.
      await expect(p.locator('#lesson-desmos-back')).toHaveCount(0);
    }
    const instructorRows = await rows(teacherList(teacher));
    expect(instructorRows.length).toBe(2);
    await shot(student, '05-student-reveal-both-panels');

    // Empty path: student 2 never opened the calculator. No question; replaced and opened.
    await expect(own(second)).toHaveCount(0);
    await second.locator('#lesson-desmos-fork').click();
    await expect(second.locator('#lesson-calc-confirm')).toHaveCount(0);
    await expect(own(second)).toBeVisible();
    await expect(ownList(second)).toContainText('2468');
    expect(await rows(ownList(second))).toEqual(instructorRows);
    await shot(second, '06-student-try-empty-replaced');

    // Non-empty path: ask first. Cancel changes nothing.
    await student.locator('#lesson-calc-close').click();
    await student.locator('#lesson-desmos-fork').click();
    const dialog = student.locator('#lesson-calc-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('p')).toHaveText(REPLACE_TEXT);
    await expect(dialog.locator('button')).toHaveText(['Cancel', 'Replace']);
    await shot(student, '07-student-try-confirm');
    await student.locator('#lesson-calc-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(own(student)).toBeHidden();
    await student.locator('#lesson-calc-toggle').click();
    await expect(ownList(student)).toContainText('1111');
    await expect(ownList(student)).not.toContainText('2468');
    // Replace: the student's expression list equals the instructor's.
    await student.locator('#lesson-desmos-fork').click();
    await expect(dialog).toBeVisible();
    await student.locator('#lesson-calc-replace').click();
    await expect(dialog).toHaveCount(0);
    await expect(own(student)).toBeVisible();
    await expect(ownList(student)).toContainText('2468');
    await expect(ownList(student)).not.toContainText('1111');
    expect(await rows(ownList(student))).toEqual(instructorRows);
    await shot(student, '08-student-try-replaced');

    // The student's copy is editable and private; the instructor panel stays read-only and keeps syncing.
    await typeOwn(student, 'y=3131');
    await typeTeacher(teacher, 'y=5757');
    for (const p of [student, second]) await expect(followerList(p)).toContainText('5757');
    await expect(ownList(student)).not.toContainText('5757');
    await expect(followerList(student)).not.toContainText('3131');
    await expect(teacherList(teacher)).not.toContainText('3131');
    const before = await followerList(student).textContent();
    // Focus leaves the student's own calculator first, so keystrokes can only reach the follower.
    await student.locator('.lesson-header h1').click();
    // Docked between header and footer, the follower can have Desmos's own "Trial Key" badge over the middle of the
    // new-expression row: click its left edge instead.
    await student.locator('#lesson-desmos .dcg-new-expression').click({ position: { x: 6, y: 8 } });
    await student.keyboard.type('y=6161');
    await expect(followerList(student)).toHaveText(before);
    await expect(ownList(student)).not.toContainText('6161');

    // No calculator payload ever left either student's client.
    for (const list of [sent, sentTwo]) {
      expect(list.length).toBeGreaterThan(0);
      for (const body of list) {
        expect(body).not.toMatch(LEAK);
      }
    }
    await teacherSeen.flush();
    for (const item of [...teacherSeen.frames, ...teacherSeen.bodies]) expect(item.body).not.toMatch(MARKERS);
    for (const capture of leaks) {
      await capture.flush();
      expect(capture.violations()).toEqual([]);
      // Positive control for the marker format: the instructor's graph does travel, as latex.
      expect(capture.frames.some(f => f.body.includes('"y=2468x"'))).toBe(true);
      for (const item of [...capture.frames, ...capture.bodies]) expect(item.body).not.toMatch(MARKERS);
    }
  } finally {
    await Promise.all([admin.close(), one.close(), two.close()]);
  }
});

// Chrome's 110% page zoom on a 1366×768 Chromebook: a 1242×698 CSS viewport at 1.1 device pixels per px.
const ZOOM_110 = { viewport: { width: 1242, height: 698 }, deviceScaleFactor: 1.1 };

test('lessons-11c C1 self-paced at 110% zoom: button on math only, state kept across questions, question clear', async ({ browser }) => {
  test.setTimeout(120000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const context = await newUserContext(browser, 'e2e-student-4', ZOOM_110);
  try {
    const { sessionId, joinCode } = await room(admin, 'self', [MATH, RW, SPR].map(question_id => ({ question_id, time_limit_sec: 60, notes: '' })));
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const student = await context.newPage();
    const sent = outgoing(student);
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#self-next')).toBeVisible();
    await expect(student.locator('.lesson-stage')).toHaveClass(/stage-math/);
    expect(await viewport(student)).toEqual({ w: 1242, h: 698 });
    await openCalculator(student);
    await insideViewport(student);
    await questionClear(student);
    const win = await box(own(student));
    expect(win.y).toBeGreaterThanOrEqual(await student.locator('.lesson-header').evaluate(el => el.getBoundingClientRect().bottom));
    expect(win.bottom).toBeLessThanOrEqual(await student.locator('.lesson-footer').evaluate(el => el.getBoundingClientRect().top));
    await typeOwn(student, 'y=4242x');
    await shot(student, '09-self-paced-calculator-110-zoom');

    // Q2 (R&W): no button, window hidden.
    await student.locator('#self-next').click();
    await expect(student.locator('.lesson-stage')).not.toHaveClass(/stage-math/);
    await expect(student.locator('#lesson-calc-toggle')).toHaveCount(0);
    await expect(own(student)).toBeHidden();
    // Q3 (math): the window is back with the student's expressions.
    await student.locator('#self-next').click();
    await expect(student.locator('#lesson-grid')).toBeVisible();
    await expect(own(student)).toBeVisible();
    await expect(ownList(student)).toContainText('4242');
    // Back to Q1: still there.
    await student.locator('#self-back').click();
    await student.locator('#self-back').click();
    await expect(student.locator('[data-lesson-choice="C"]')).toBeVisible();
    await expect(ownList(student)).toContainText('4242');
    await questionClear(student);
    await shot(student, '10-self-paced-back-to-q1-110-zoom');
    for (const body of sent) expect(body).not.toMatch(/y=4242x|"desmos"|expressions/);

    // One lesson view only: after Leave view and a rejoin (a shared Chromebook's next student
    // would do the same), the calculator starts empty.
    await student.locator('.lesson-more summary').click();
    await student.locator('#lesson-leave').click();
    await expect(student.locator('#lesson-live')).toBeHidden();
    await join(student, joinCode);
    await expect(student.locator('.lesson-stage')).toHaveClass(/stage-math/);
    await openCalculator(student);
    await expect(ownList(student)).not.toContainText('4242');
  } finally {
    await Promise.all([admin.close(), context.close()]);
  }
});
