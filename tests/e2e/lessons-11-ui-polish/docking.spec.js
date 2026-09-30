import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, MATH, zoomOpts, lesson, join, openLive, shot, box } from './helpers.js';

// lessons-11-ui-polish, item 1 (docking) and checkpoint 2: the student's calculator docks left, the instructor's graph
// follower docks right, the question column reflows between them, nothing overlaps and the page never scrolls sideways.

const SIZES = { '1366x768': { viewport: { width: 1366, height: 768 } }, z125: zoomOpts(1.25) };
const COLLIDE = 0.5;

// Elements of the question area that intersect one of the docks (by selector), in the student's window.
const intruders = (page, docks) => page.evaluate(selectors => {
  const rects = selectors.map(s => ({ s, r: document.querySelector(s).getBoundingClientRect() }));
  const out = [];
  for (const el of document.querySelectorAll('.lesson-main *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'contents' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    for (const d of rects) if (r.left < d.r.right - 0.5 && d.r.left < r.right - 0.5 && r.top < d.r.bottom - 0.5 && d.r.top < r.bottom - 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')} ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))} hits ${d.s} ${JSON.stringify([d.r.left, d.r.top, d.r.right, d.r.bottom].map(Math.round))}`);
  }
  return out;
}, docks);

const noSidewaysScroll = async (page, label) => {
  const m = await page.evaluate(() => ({ vw: innerWidth, sw: document.documentElement.scrollWidth, over: document.getElementById('lesson-live').scrollWidth - document.getElementById('lesson-live').clientWidth }));
  expect(m.sw, `${label} scrollWidth`).toBe(m.vw);
  expect(m.over, `${label} #lesson-live overflow`).toBeLessThanOrEqual(0);
};

const between = async page => ({
  header: (await box(page.locator('.lesson-header'))).bottom,
  footer: (await box(page.locator('.lesson-footer'))).y
});

async function drag(page, handle, dx) {
  const b = await box(handle);
  const x = b.x + b.w / 2, y = b.cy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

for (const [name, options] of Object.entries(SIZES)) {
  test(`docking at ${name}: calculator left, instructor graph right, column between them, nothing overlaps`, async ({ browser }) => {
    test.setTimeout(180000);
    const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
    const student = await newUserContext(browser, 'e2e-student-1', options);
    try {
      const { sessionId, joinCode } = await lesson(admin, `Task11 docking ${name}`, [MATH]);
      const teacher = await openLive(admin, sessionId);
      const page = await student.newPage();
      await join(page, joinCode);
      await teacher.locator('[data-live="start"]').click();
      await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const before = await box(page.locator('#lesson-card .stage-question'));
      await noSidewaysScroll(page, `${name} before`);

      // --- Calculator: docked left between header and footer, the column moves right of it.
      await page.locator('#lesson-calc-toggle').click();
      await expect(page.locator('#lesson-calc .lesson-calc-body[data-ready]')).toBeAttached();
      await expect(page.locator('#lesson-calc .dcg-expressionlist')).toBeVisible();
      await expect(page.locator('.lesson-main')).toHaveClass(/with-calc/);
      const limits = await between(page);
      const calc = await box(page.locator('#lesson-calc'));
      expect(await page.locator('#lesson-calc').evaluate(el => getComputedStyle(el).position), name).toBe('fixed');
      expect(calc.x, `${name} calculator at the left edge`).toBeLessThanOrEqual(24);
      expect(calc.y, `${name} calculator under the header`).toBeGreaterThanOrEqual(limits.header);
      expect(calc.bottom, `${name} calculator above the footer`).toBeLessThanOrEqual(limits.footer);
      expect(calc.right, `${name} calculator is a side dock, not the whole window`).toBeLessThanOrEqual(0.5 * vp.w);
      expect(calc.w, `${name} calculator is usable`).toBeGreaterThanOrEqual(280);
      const withCalc = await box(page.locator('#lesson-card .stage-question'));
      expect(withCalc.x, `${name} column right of the dock`).toBeGreaterThanOrEqual(calc.right);
      expect(withCalc.right, `${name} column inside the window`).toBeLessThanOrEqual(vp.w);
      expect(withCalc.w, `${name} column does not grow`).toBeLessThanOrEqual(before.w + 0.5);
      expect(withCalc.x, `${name} column moved right`).toBeGreaterThan(before.x);
      expect(await intruders(page, ['#lesson-calc']), `${name} calculator overlaps question content`).toEqual([]);
      await noSidewaysScroll(page, `${name} with calculator`);
      await shot(page, `student-${name}-calculator`);

      // A wide dock narrows the column instead of covering it.
      const homeWidth = calc.w;
      await drag(page, page.locator('#lesson-calc-resize'), 4000);
      const wide = await box(page.locator('#lesson-calc'));
      expect(wide.w).toBeGreaterThan(homeWidth + 100);
      const narrowed = await box(page.locator('#lesson-card .stage-question'));
      expect(narrowed.w, `${name} column narrower beside a wide dock`).toBeLessThan(before.w - 20);
      expect(narrowed.w, `${name} column still usable`).toBeGreaterThanOrEqual(280);
      expect(narrowed.x, `${name} column right of the wide dock`).toBeGreaterThanOrEqual(wide.right);
      expect(await intruders(page, ['#lesson-calc']), `${name} wide calculator overlaps question content`).toEqual([]);
      await noSidewaysScroll(page, `${name} with wide calculator`);
      await shot(page, `student-${name}-calculator-wide`);
      await drag(page, page.locator('#lesson-calc-resize'), homeWidth - wide.w);
      expect(Math.abs((await box(page.locator('#lesson-calc'))).w - homeWidth)).toBeLessThanOrEqual(1);

      // Closing gives the column its place back.
      await page.locator('#lesson-calc-close').click();
      await expect(page.locator('.lesson-main')).not.toHaveClass(/with-calc/);
      expect((await box(page.locator('#lesson-card .stage-question'))).x).toBeCloseTo(before.x, 0);
      await page.locator('#lesson-calc-toggle').click();
      await expect(page.locator('.lesson-main')).toHaveClass(/with-calc/);

      // --- Instructor's graph after the reveal, next to the calculator.
      await teacher.locator('#live-desmos-toggle').click();
      await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
      await teacher.locator('#live-desmos .dcg-new-expression').click();
      await teacher.keyboard.type('y=2468x');
      await expect(teacher.locator('#live-desmos .dcg-expressionlist')).toContainText('2468');
      await teacher.locator('[data-live="endNow"]').click();
      await expect(page.locator('#lesson-desmos')).toBeVisible();
      await expect(page.locator('#lesson-desmos .dcg-expressionlist')).toContainText('2468');
      await expect(page.locator('.lesson-reveal')).toBeVisible();
      await expect(page.locator('.lesson-main')).toHaveClass(/with-desmos/);
      await expect(page.locator('.lesson-main')).toHaveClass(/with-calc/);
      const dockL = await box(page.locator('#lesson-calc')), dockR = await box(page.locator('#lesson-desmos'));
      const both = await box(page.locator('#lesson-card .stage-question'));
      expect(await page.locator('#lesson-desmos').evaluate(el => getComputedStyle(el).position), name).toBe('fixed');
      expect(dockR.right, `${name} instructor graph docked at the right edge`).toBeGreaterThanOrEqual(vp.w - 24);
      expect(dockR.right, name).toBeLessThanOrEqual(vp.w);
      expect(dockR.y, `${name} instructor graph under the header`).toBeGreaterThanOrEqual(limits.header);
      expect(dockR.bottom, `${name} instructor graph above the footer`).toBeLessThanOrEqual(limits.footer);
      expect(dockR.x, `${name} instructor graph is a side dock`).toBeGreaterThanOrEqual(0.5 * vp.w);
      expect(dockL.right, `${name} the two docks do not touch`).toBeLessThanOrEqual(dockR.x);
      expect(both.x, `${name} column right of the calculator`).toBeGreaterThanOrEqual(dockL.right);
      expect(both.right, `${name} column left of the instructor graph`).toBeLessThanOrEqual(dockR.x);
      expect(both.w, `${name} column between the docks is usable`).toBeGreaterThanOrEqual(300);
      expect(await intruders(page, ['#lesson-calc', '#lesson-desmos']), `${name} a dock overlaps question content`).toEqual([]);
      await noSidewaysScroll(page, `${name} with both docks`);
      await shot(page, `student-${name}-both-docks`);

      // The instructor graph alone.
      await page.locator('#lesson-calc-close').click();
      await expect(page.locator('.lesson-main')).not.toHaveClass(/with-calc/);
      const alone = await box(page.locator('#lesson-card .stage-question'));
      expect(alone.right, `${name} column left of the instructor graph`).toBeLessThanOrEqual(dockR.x);
      expect(alone.x).toBeGreaterThanOrEqual(0);
      expect(await intruders(page, ['#lesson-desmos']), `${name} instructor graph overlaps question content`).toEqual([]);
      await noSidewaysScroll(page, `${name} with instructor graph`);
      await shot(page, `student-${name}-instructor-graph`);
    } finally { await admin.close(); await student.close(); }
  });
}
