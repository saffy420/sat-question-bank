import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { lesson, join, openLive } from '../lessons-11-ui-polish/helpers.js';
import { mkdirSync } from 'node:fs';

// Session results (PR 10): End session opens the overview; Library reopens the same data.
const artifacts = '.omp/pipeline/session-results/e2e';
mkdirSync(artifacts, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });
const RW = 'e2e-core-rw', MATH = 'e2e-core-math'; // correct answers A and C

test('instructor-paced session results: overview on End session, per-student breakdown, explain time, Library reopen', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1440, height: 900 } });
  const contexts = [];
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Results', [RW, MATH]);
    const teacher = await openLive(admin, sessionId);
    const pages = [];
    for (const account of ['e2e-student-1', 'e2e-student-2']) {
      const context = await newUserContext(browser, account); contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      await join(page, joinCode);
    }
    const [one, two] = pages;
    await expect(teacher.locator('#live-roster')).toContainText('E2E Student 2');
    // Q1: student 1 right, student 2 wrong; reveal and talk for a few seconds.
    await teacher.locator('[data-live="start"]').click();
    await one.locator('[data-lesson-choice="A"]').click();
    await two.locator('[data-lesson-choice="B"]').click();
    await expect(teacher.locator('#live-responses')).toHaveText('2 of 2 responses');
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    await teacher.waitForTimeout(3000);
    // Q2: both right.
    await teacher.locator('[data-live="next"]').first().click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(one.locator('#lesson-content')).toContainText('ANSWERING');
    await one.locator('[data-lesson-choice="C"]').click();
    await two.locator('[data-lesson-choice="C"]').click();
    await expect(teacher.locator('#live-responses')).toHaveText('2 of 2 responses');
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    await teacher.waitForTimeout(1000);
    await teacher.locator('[data-live="endSession"]').click();

    const results = teacher.locator('#session-results');
    const check = async (page, label) => {
      const r = page.locator('#session-results');
      await expect(r.locator('[data-fact="joined"]')).toHaveText('2 joined', { timeout: 35000 });
      await expect(r.locator('[data-student="e2e-student-1"] [data-fact="score"]')).toHaveText('2 / 2');
      await expect(r.locator('[data-student="e2e-student-2"] [data-fact="score"]')).toHaveText('1 / 2');
      await expect(r.locator('#results-students tbody tr').first()).toHaveAttribute('data-student', 'e2e-student-1');
      await expect(r.locator('[data-fact="average"]')).toContainText('1.5/2');
      await shot(page, `${label}-students`);
      await r.locator('[data-student="e2e-student-2"] button').click();
      const wrong = r.locator(`#results-student [data-q="${RW}"]`);
      await expect(wrong).toHaveAttribute('data-state', 'wrong');
      await expect(wrong).toHaveClass(/missed/);
      await expect(wrong).toContainText('correct A');
      await expect(wrong.locator('[data-fact="time"]')).toHaveText(/^\d+:\d\d \(class \d+:\d\d\)$/);
      await expect(r.locator(`#results-student [data-q="${MATH}"]`)).toHaveAttribute('data-state', 'right');
      await shot(page, `${label}-student-breakdown`);
      await r.locator('[data-tab="questions"]').click();
      const explain = r.locator(`#results-questions [data-q="${RW}"] [data-fact="explain"]`);
      await expect(explain).toHaveText(/^You explained \d+:\d\d$/);
      const [, m, sec] = /(\d+):(\d\d)$/.exec(await explain.textContent());
      expect(Number(m) * 60 + Number(sec)).toBeGreaterThanOrEqual(3);
      await expect(r.locator(`#results-questions [data-q="${RW}"] [data-fact="correct"]`)).toHaveText('50% correct');
      await expect(r.locator(`#results-questions [data-q="${MATH}"] [data-fact="correct"]`)).toHaveText('100% correct');
      await shot(page, `${label}-questions`);
      return explain.textContent();
    };
    await expect(results).toBeVisible();
    const live = await check(teacher, '01-end-session');
    await expect(teacher.locator('#live-timer')).toHaveText('Session ended');

    // Library → View past sessions → the ended row reopens the same results.
    const library = await admin.newPage();
    await library.goto('/admin/lessons');
    const lessonId = (await (await admin.request.get(`/api/admin/lessons`)).json()).find(l => l.title.startsWith('Results '))?.id;
    await library.locator(`[data-past="${lessonId}"]`).click();
    const row = library.locator(`#past-${lessonId} [data-session="${sessionId}"]`);
    await expect(row).toContainText('2 joined');
    await expect(row).toContainText('avg 1.5/2');
    await shot(library, '02-past-sessions');
    await row.click();
    expect(await check(library, '03-library')).toBe(live);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await admin.close().catch(() => {});
  }
});
