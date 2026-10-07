import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, RW, SPR, lesson, join, openLive } from '../lessons-11-ui-polish/helpers.js';

for (const mode of ['self', 'instructor']) {
  test(`${mode} end: reflection cancellation writes nothing; summary, answers, annotations, footer and My Lessons`, async ({ browser }) => {
    test.setTimeout(120000);
    const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
    const context = await newUserContext(browser, 'e2e-student-6');
    try {
      const { sessionId, joinCode } = await lesson(admin, 'Reflection cancellation', [RW, SPR], mode, 90);
      const teacher = await openLive(admin, sessionId);
      const student = await context.newPage();
      const submissions: unknown[] = [];
      student.on('request', request => {
        if (new URL(request.url()).pathname === '/api/suggestions' && request.method() === 'POST') submissions.push(request.postDataJSON());
      });
      const rows = async () => {
        const response = await admin.request.get('/api/admin/suggestions?status=all');
        expect(response.status()).toBe(200);
        return (await response.json()).suggestions.filter((row: { session_id: number }) => row.session_id === sessionId);
      };
      await join(student, joinCode);
      await teacher.locator('[data-live="start"]').click();
      await student.locator('[data-lesson-choice="B"]').click();
      if (mode === 'self') {
        const clock = student.locator('#lesson-clock');
        for (let i = 0; i < 2; i++) {
          const value = await clock.textContent();
          await expect(clock).not.toHaveText(value!);
        }
        await student.locator('#self-next').click();
      } else {
        await teacher.locator('[data-live="endNow"]').click();
        await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
        await teacher.locator('#live-card .stage-strike-toggle').click();
        await teacher.locator('#live-card [data-strike="C"]').click();
        await expect(student.locator('#lesson-card .stage-choice[data-choice="C"]')).toHaveClass(/eliminated/);
        await teacher.locator('[data-live="next"]').click();
        await teacher.locator('[data-live="startQuestion"]').click();
      }
      await student.locator('#lesson-grid').fill('3');
      if (mode === 'self') {
        await expect.poll(async () => (await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).grid?.['e2e-student-6']?.[SPR]?.[0]).toBe('3');
        await teacher.locator('[data-live="endSession"]').click();
        await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
        await expect(student.locator('#self-status')).toContainText('Your answers were submitted');
        await expect(student.locator('#lesson-live')).toBeVisible();
        await expect(student.locator('#lesson-reflection')).toHaveCount(0);
        await expect(student.locator('#history-summary')).toHaveCount(0);
        await teacher.locator('#review-target').selectOption(RW);
        await teacher.locator('[data-live="goto"]').click();
        await expect(student.locator('.lesson-phase')).toHaveText('REVIEW');
        await teacher.locator('#live-card .stage-strike-toggle').click();
        await teacher.locator('#live-card [data-strike="C"]').click();
        await expect(student.locator('#lesson-card .stage-choice[data-choice="C"]')).toHaveClass(/eliminated/);
      } else {
        await student.locator('#lesson-pick').click();
        await teacher.locator('[data-live="endNow"]').click();
        await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
      }
      let resultsReady = mode !== 'self';
      const historyURL = `**/api/lesson-history/${sessionId}`;
      if (mode === 'self') await student.route(historyURL, route => resultsReady ? route.continue() : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not ready"}' }));
      await teacher.locator('[data-live="endSession"]').click();
      if (mode === 'self') await expect(teacher.locator('.live-top')).toContainText('SESSION ENDED');
      else await expect(teacher.locator('.live-bar #live-timer')).toHaveText('Session ended');
      await expect(teacher.locator('[data-live="endSession"]')).toBeDisabled();
      await expect(teacher.getByRole('dialog', { name: /^Reflection cancellation .* results$/ })).toBeVisible();
      await expect(teacher.locator('#results-facts')).toContainText(`Session ${String(sessionId).padStart(5, '0')}`);
      if (mode === 'self') {
        await expect(student.locator('#history-loading')).toHaveText('Saving results…');
        await expect(student.locator('#lesson-reflection')).toHaveCount(0);
        resultsReady = true;
      }
      await expect(student.locator('#lesson-reflection')).toBeVisible({ timeout: 35000 });
      await expect(student.locator('#lesson-live')).toBeVisible();
      await expect(student.locator('#history-summary')).toBeVisible();
      await expect(student.locator('#reflection-send')).toBeDisabled();
      await student.locator('[name="reflection-category"][value="other"]').click();
      await student.locator('#reflection-body').fill('Cancelled feedback must not be saved');
      await expect(student.locator('#reflection-send')).toBeEnabled();
      if (mode === 'self') await student.locator('#reflection-close').click();
      else await student.keyboard.press('Escape');
      await expect(student.locator('#lesson-reflection')).toBeHidden();
      expect(submissions).toEqual([]);
      expect(await rows()).toEqual([]);
      await expect(student.locator('#history-score')).toHaveText('Score 1 / 2');
      const wrong = student.locator(`[data-history-row="${RW}"]`);
      await expect(wrong).toHaveAttribute('data-state', 'wrong');
      await expect(wrong.locator('td').nth(1)).toHaveText('B');
      await expect(wrong.locator('td').nth(2)).toHaveText('A');
      await expect(wrong.locator('.history-result')).toHaveText('Wrong');
      await expect(student.locator(`[data-history-row="${SPR}"]`)).toHaveAttribute('data-state', 'correct');
      await expect(student.locator('#history-summary-table th').filter({ hasText: /^Time spent$/ })).toHaveCount(mode === 'self' ? 1 : 0);
      await expect(student.locator('[data-history-row] [data-fact="time"]')).toHaveCount(mode === 'self' ? 2 : 0);
      if (mode === 'self') {
        await expect(wrong.locator('[data-fact="time"]')).toHaveText(/^\d+:\d{2}$/);
        await expect(wrong.locator('[data-fact="time"]')).not.toHaveText('0:00');
      }
      await student.locator(`[data-history-open="${RW}"]`).click();
      await expect(student.locator('#history-summary')).toHaveCount(0);
      await expect(student.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      await expect(student.locator('#history-show')).not.toBeChecked();
      await expect(student.locator('#history-reveal')).toHaveCount(0);
      await expect(student.locator('#lesson-card .choice.right, #lesson-card .choice.wrong, #lesson-card .choice.sel, #lesson-card .stage-choice.eliminated')).toHaveCount(0);
      await expect(student.locator('#history-prev')).toBeDisabled();
      await expect(student.locator('#history-position')).toHaveText('Question 1 of 2');
      await student.locator('#history-show').check();
      await expect(student.locator('#history-correct')).toHaveText('Correct answer: A');
      await expect(student.locator('#history-verdict')).toHaveText('Your answer: B');
      await expect(student.locator('#history-explanation')).toContainText('E2E_EXPL_MARKER_RW');
      await expect(student.locator('#lesson-card .stage-choice[data-choice="C"]')).toHaveClass(/eliminated/);
      await student.locator('#history-show').uncheck();
      await expect(student.locator('#history-reveal')).toHaveCount(0);
      await expect(student.locator('#lesson-card .stage-choice.eliminated')).toHaveCount(0);
      await student.locator('#history-next').click();
      await expect(student.locator('#history-position')).toHaveText('Question 2 of 2');
      await expect(student.locator('#history-next')).toBeDisabled();
      await expect(student.locator('#history-prev')).toBeEnabled();
      await student.locator('#history-prev').click();
      await expect(student.locator('#history-position')).toHaveText('Question 1 of 2');
      await student.locator('#history-position').click();
      await expect(student.locator('#history-navigator')).toBeVisible();
      await expect(student.locator(`[data-history-q="${RW}"]`)).toHaveAttribute('data-state', 'wrong');
      await expect(student.locator(`[data-history-q="${SPR}"]`)).toHaveAttribute('data-state', 'correct');
      await student.locator(`[data-history-q="${SPR}"]`).click();
      await expect(student.locator('#history-position')).toHaveText('Question 2 of 2');
      await student.locator('#history-position').click();
      await student.locator('#history-go-summary').click();
      await expect(student.locator('#history-summary')).toBeVisible();
      await expect(student.locator('.history-footer')).toHaveCount(0);
      if (mode === 'self') await student.locator('#history-close').click();
      else await student.keyboard.press('Escape');
      await expect(student).toHaveURL(/\/app$/);
      await expect(student.locator('#lesson-live')).toBeHidden();
      await student.locator('.nav-i[data-tab="lessons"]').click();
      await student.locator(`#lessons-table tr[data-session="${sessionId}"]`).click();
      await expect(student.locator('#history-summary')).toBeVisible();
      await expect(student.locator('#history-score')).toHaveText('Score 1 / 2');
      await expect(student.locator('#lesson-reflection')).toHaveCount(0);
      await student.locator(`[data-history-open="${RW}"]`).click();
      await expect(student.locator('#history-show')).not.toBeChecked();
      await expect(student.locator('#history-reveal')).toHaveCount(0);
      await student.locator('#history-close').click();
      await expect(student).toHaveURL(/\/app$/);
      await expect(student.locator('#lesson-live')).toBeHidden();
      expect(await rows()).toEqual([]);
    } finally {
      await context.close();
      await admin.close();
    }
  });
}

test('reflection categories submit once, retry failure, Thanks, and admin category/handled filters', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const contexts = [];
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Reflection categories', [RW], 'instructor', 90);
    const teacher = await openLive(admin, sessionId);
    const pages = [];
    for (const id of [2, 3, 4]) {
      const context = await newUserContext(browser, `e2e-student-${id}`);
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await join(page, joinCode);
    }
    await teacher.locator('[data-live="start"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVEALED');
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-bar #live-timer')).toHaveText('Session ended');
    await expect(teacher.locator('[data-live="endSession"]')).toBeDisabled();
    await expect(teacher.getByRole('dialog', { name: /^Reflection categories .* results$/ })).toBeVisible();
    await expect(teacher.locator('#results-facts')).toContainText(`Session ${String(sessionId).padStart(5, '0')}`);
    const bodies = ['teaching', 'app', 'other'].map(category => `Reflection ${sessionId} ${category}`);
    for (const [i, category] of ['teaching', 'app', 'other'].entries()) {
      const page = pages[i];
      await expect(page.locator('#lesson-reflection')).toBeVisible({ timeout: 35000 });
      await expect(page.locator('[name="reflection-category"]')).toHaveCount(3);
      await expect(page.locator('#reflection-send')).toBeDisabled();
      await page.locator('#reflection-body').fill('   ');
      await page.locator(`[name="reflection-category"][value="${category}"]`).click();
      await expect(page.locator('#reflection-send')).toBeDisabled();
      await page.locator('#reflection-body').fill(bodies[i]);
      if (i === 0) {
        await page.route('**/api/suggestions', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"reflection unavailable"}' }));
        await page.locator('#reflection-send').click();
        await expect(page.locator('#reflection-error')).toHaveText('reflection unavailable');
        await expect(page.locator('#reflection-body')).toHaveValue(bodies[i]);
        await expect(page.locator('#reflection-send')).toBeEnabled();
        await page.unroute('**/api/suggestions');
      }
      const request = page.waitForRequest(r => new URL(r.url()).pathname === '/api/suggestions' && r.method() === 'POST');
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/suggestions' && r.request().method() === 'POST');
      await page.locator('#reflection-send').click();
      expect((await request).postDataJSON()).toEqual({ body: bodies[i], category, sessionId });
      expect((await response).status()).toBe(200);
      await expect(page.locator('#reflection-thanks')).toContainText('Thanks');
      await expect(page.locator('#reflection-send')).toHaveCount(0);
      if (i === 2) await expect(page.locator('#lesson-reflection')).toBeHidden({ timeout: 7000 });
      else await page.locator('#reflection-close').click();
      await expect(page.locator('#history-summary')).toBeVisible();
      await page.locator('#history-close').click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.locator('#lesson-live')).toBeHidden();
    }
    const response = await admin.request.get('/api/admin/suggestions?status=all');
    expect(response.status()).toBe(200);
    const rows = (await response.json()).suggestions.filter((row: { session_id: number }) => row.session_id === sessionId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row: { category: string; body: string; user_id: string }) => [row.category, row.body, row.user_id]).sort()).toEqual([
      ['teaching', bodies[0], 'e2e-student-2'], ['app', bodies[1], 'e2e-student-3'], ['other', bodies[2], 'e2e-student-4']
    ].sort());
    const tab = await admin.newPage();
    await tab.goto('/admin');
    await tab.locator('[data-section="Suggestions"]').click();
    await expect(tab.locator('#show-handled')).not.toBeChecked();
    for (const [i, category] of ['teaching', 'app', 'other'].entries()) {
      await tab.locator(`[data-tab="${category}"]`).click();
      await expect(tab.locator(`[data-tab="${category}"]`)).toHaveAttribute('aria-selected', 'true');
      const own = tab.locator('[data-suggestion]').filter({ hasText: bodies[i] });
      await expect(own).toHaveCount(1);
      await expect(own).toHaveAttribute('data-category', category);
      await expect(own).toContainText(`Lesson ${String(sessionId).padStart(5, '0')}`);
      await expect(tab.locator(`[data-suggestion]:not([data-category="${category}"])`)).toHaveCount(0);
      for (const body of bodies.filter(body => body !== bodies[i])) await expect(tab.locator('[data-suggestion]').filter({ hasText: body })).toHaveCount(0);
    }
    await tab.locator('[data-tab="all"]').click();
    for (const body of bodies) await expect(tab.locator('[data-suggestion]').filter({ hasText: body })).toHaveCount(1);
    const teaching = tab.locator('[data-suggestion]').filter({ hasText: bodies[0] });
    await teaching.locator('[data-done]').click();
    await expect(teaching).toHaveCount(0);
    await tab.locator('[data-tab="teaching"]').click();
    await expect(teaching).toHaveCount(0);
    await tab.locator('#show-handled').check();
    await expect(teaching).toHaveAttribute('data-status', 'done');
    await expect(teaching).toHaveAttribute('data-category', 'teaching');
    await tab.locator('[data-tab="app"]').click();
    const app = tab.locator('[data-suggestion]').filter({ hasText: bodies[1] });
    await app.locator('[data-dismiss]').click();
    await expect(app).toHaveAttribute('data-status', 'dismissed');
    await tab.locator('#show-handled').uncheck();
    await expect(app).toHaveCount(0);
    await tab.locator('[data-tab="other"]').click();
    await expect(tab.locator('[data-suggestion]').filter({ hasText: bodies[2] })).toHaveAttribute('data-status', 'new');
  } finally {
    for (const context of contexts) await context.close();
    await admin.close();
  }
});
