import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, MATH, SPR, lesson, join, openLive, shot, box } from './helpers.js';

// lessons-11-ui-polish, item 5: the instructor's Desmos panel has a drag handle on its left edge. Its width is
// clamped to [280, min(720, stage width - 360)], remembered in localStorage["lessons.desmosWidth"] (admin origin only)
// through close/reopen, next question and reload; what students receive does not change.

const KEY = 'lessons.desmosWidth';
const panel = page => page.locator('#live-desmos');
const handle = page => page.locator('#live-desmos-handle');
const width = async page => Math.round((await box(panel(page))).w);
const stored = page => page.evaluate(key => localStorage.getItem(key), KEY);
const stageWidth = page => page.evaluate(() => document.querySelector('.live-body').clientWidth);

// Pointer travel is limited to the window: a "far" drag ends at the window's edge, which is still past every clamp.
async function dragBy(page, dx) {
  const b = await box(handle(page));
  const vw = page.viewportSize().width;
  const to = Math.min(vw - 2, Math.max(1, b.cx + dx));
  await page.mouse.move(b.cx, b.cy);
  await page.mouse.down();
  await page.mouse.move((b.cx + to) / 2, b.cy, { steps: 5 });
  await page.mouse.move(to, b.cy, { steps: 5 });
  await page.mouse.up();
}

async function openPanel(page) {
  if (!(await panel(page).count())) await page.locator('#live-desmos-toggle').click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
}

test('instructor Desmos panel: handle on the left edge, drag changes the width, clamped, kept through close/reopen, next question and reload; students unaffected', async ({ browser }) => {
  test.setTimeout(240000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-1');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11 desmos width', [MATH, SPR]);
    let teacher = await openLive(admin, sessionId);
    const student = await studentContext.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#lesson-card[data-ready="true"]')).toBeVisible();

    // Nothing stored yet; the panel opens at its default width with the handle on its left edge.
    expect(await stored(teacher)).toBeNull();
    await openPanel(teacher);
    expect(await width(teacher), 'default width').toBe(420);
    const edge = await box(panel(teacher)), grip = await box(handle(teacher));
    expect(Math.abs(grip.cx - edge.x), 'handle straddles the left edge').toBeLessThanOrEqual(6);
    expect(grip.h, 'handle runs the panel height').toBeGreaterThanOrEqual(edge.h - 2);
    expect(grip.y).toBeLessThanOrEqual(edge.y + 1);
    await expect(handle(teacher)).toHaveAttribute('role', 'separator');
    expect(await handle(teacher).evaluate(el => getComputedStyle(el).cursor)).toBe('ew-resize');

    // Dragging the handle to the left widens the panel by the pointer distance; the question gives way.
    const stageBefore = (await box(teacher.locator('#live-stage'))).w;
    await dragBy(teacher, -150);
    expect(await width(teacher), 'dragged 150 px to the left').toBe(570);
    expect(Number(await stored(teacher)), 'stored width').toBe(570);
    expect((await box(teacher.locator('#live-stage'))).w, 'question column gave the space').toBeLessThan(stageBefore - 100);
    await dragBy(teacher, 70);
    expect(await width(teacher), 'dragged 70 px to the right').toBe(500);
    expect(Number(await stored(teacher))).toBe(500);

    // Keyboard: the arrow keys move by 20 px.
    await handle(teacher).focus();
    await teacher.keyboard.press('ArrowLeft');
    expect(await width(teacher), 'ArrowLeft widens by 20').toBe(520);
    await teacher.keyboard.press('ArrowRight');
    await teacher.keyboard.press('ArrowRight');
    expect(await width(teacher), 'ArrowRight narrows by 20').toBe(480);
    expect(Number(await stored(teacher))).toBe(480);

    // Clamped: at most min(720, stage width - 360), at least 280.
    const wideMax = Math.min(720, await stageWidth(teacher) - 360);
    expect(wideMax, 'a 1920 px window is limited by the 720 px cap').toBe(720);
    await dragBy(teacher, -3000);
    expect(await width(teacher), 'maximum width').toBe(wideMax);
    expect(Number(await stored(teacher))).toBe(wideMax);
    expect((await box(teacher.locator('#live-stage'))).w, 'the question keeps at least 360 px').toBeGreaterThanOrEqual(359);
    await shot(teacher, 'instructor-desmos-wide');
    await dragBy(teacher, 3000);
    expect(await width(teacher), 'minimum width').toBe(280);
    expect(Number(await stored(teacher))).toBe(280);
    await shot(teacher, 'instructor-desmos-narrow');
    await dragBy(teacher, -220);
    expect(await width(teacher)).toBe(500);
    expect(Number(await stored(teacher))).toBe(500);

    // The graph still works at the new width, and students receive it after the reveal at their own fixed dock width.
    await teacher.locator('#live-desmos .dcg-new-expression').click();
    await teacher.keyboard.type('y=2468x');
    await expect(teacher.locator('#live-desmos .dcg-expressionlist')).toContainText('2468');
    await expect(student.locator('#lesson-desmos')).toHaveCount(0);
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('#lesson-desmos')).toBeVisible();
    await expect(student.locator('#lesson-desmos .dcg-expressionlist')).toContainText('2468');
    const dock = await box(student.locator('#lesson-desmos'));
    expect(Math.abs(dock.w - Math.min(440, Math.max(280, 0.28 * 1366))), 'student dock width is its own clamp of the window').toBeLessThanOrEqual(1);
    expect(await student.evaluate(key => localStorage.getItem(key), KEY), 'the width is not stored on students').toBeNull();
    // Resizing while the graph is live changes nothing on the student; the synced expression still arrives.
    await dragBy(teacher, -100);
    expect(await width(teacher)).toBe(600);
    await teacher.locator('#live-desmos .dcg-new-expression').click();
    await teacher.keyboard.type('y=x+57');
    await expect(student.locator('#lesson-desmos .dcg-expressionlist')).toContainText('57');
    expect(Math.round((await box(student.locator('#lesson-desmos'))).w)).toBe(Math.round(dock.w));
    expect(await student.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
    await dragBy(teacher, 100);
    expect(await width(teacher)).toBe(500);

    // Close and reopen.
    await teacher.locator('#live-desmos-toggle').click();
    await expect(panel(teacher)).toHaveCount(0);
    expect(Number(await stored(teacher)), 'stored while closed').toBe(500);
    await teacher.locator('#live-desmos-toggle').click();
    await expect(panel(teacher)).toBeVisible();
    expect(await width(teacher), 'width after close and reopen').toBe(500);

    // Next question (also a Math question): the width is still 500.
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(student.locator('#lesson-grid')).toBeVisible();
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
    await openPanel(teacher);
    expect(await width(teacher), 'width on the next question').toBe(500);
    expect(Number(await stored(teacher))).toBe(500);
    await teacher.locator('#live-desmos-toggle').click();
    await expect(panel(teacher)).toHaveCount(0);
    await teacher.locator('#live-desmos-toggle').click();
    await expect(panel(teacher)).toBeVisible();
    expect(await width(teacher), 'width on the next question after close and reopen').toBe(500);

    // Page reload: the width comes back from localStorage.
    await teacher.reload();
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    expect(Number(await stored(teacher)), 'stored across the reload').toBe(500);
    await openPanel(teacher);
    expect(await width(teacher), 'width after a page reload').toBe(500);
    await dragBy(teacher, -60);
    expect(await width(teacher)).toBe(560);
    await teacher.reload();
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    await openPanel(teacher);
    expect(await width(teacher), 'a second reload keeps the new width').toBe(560);
    await teacher.close();
    // A brand new page in the same browser profile (another tab) starts from the stored width too.
    teacher = await openLive(admin, sessionId);
    await openPanel(teacher);
    expect(await width(teacher)).toBe(560);
  } finally { await admin.close(); await studentContext.close(); }
});

test('instructor Desmos panel: on a narrow window the maximum is the stage width minus 360 px, and the width setting survives shrinking the window', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1024, height: 768 } });
  try {
    const { sessionId } = await lesson(admin, 'Task11 desmos narrow', [MATH]);
    const teacher = await openLive(admin, sessionId);
    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
    await openPanel(teacher);
    const stage = await stageWidth(teacher);
    const max = Math.min(720, stage - 360);
    expect(max, 'this window is narrow enough for the stage rule to bind').toBeLessThan(720);
    expect(max).toBeGreaterThan(280);
    await dragBy(teacher, -3000);
    expect(await width(teacher), 'maximum on a narrow window').toBe(max);
    expect((await box(teacher.locator('#live-stage'))).w, 'the question keeps at least 360 px').toBeGreaterThanOrEqual(359);
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dragBy(teacher, 3000);
    expect(await width(teacher), 'minimum').toBe(280);
    await shot(teacher, 'instructor-desmos-narrow-window');
    // A wide choice made on a big window is drawn clamped on a small one and kept as chosen.
    await teacher.evaluate(key => localStorage.setItem(key, '700'), KEY);
    await teacher.reload();
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    await openPanel(teacher);
    expect(await width(teacher), 'stored 700 drawn clamped on a narrow window').toBe(Math.min(720, (await stageWidth(teacher)) - 360));
    expect((await box(teacher.locator('#live-stage'))).w).toBeGreaterThanOrEqual(359);
  } finally { await admin.close(); }
});
