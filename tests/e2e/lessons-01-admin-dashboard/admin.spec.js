import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

const artifact = '.opencode/pipeline/lessons-01-admin-dashboard/e2e';

test('C1 admin student list, search, sort, zero activity', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-admin');
  try {
    const page = await context.newPage();
    await page.goto('/admin');
    await expect(page.locator('#message')).toContainText('6 club members');
    await expect(page.locator('thead th')).toHaveCount(7);
    for (const heading of ['Name', 'Questions done', 'Overall current accuracy', 'Weakest skill', 'Avg pace vs target', 'Second-guess rate', 'Last active'])
      await expect(page.locator('thead')).toContainText(heading);
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await expect(page.locator('tbody')).toContainText('E2E Student 5');
    await expect(page.locator('tbody tr').filter({ hasText: 'E2E Student 5' })).toContainText('Unavailable');
    await page.screenshot({ path: `${artifact}/C1-list.png` });
    await page.locator('[data-sort="done"]').click();
    await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveText('0');
    const ascending = await page.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(ascending.map(Number)).toEqual(ascending.map(Number).sort((a, b) => a - b));
    await page.locator('[data-sort="done"]').click();
    await expect(page.locator('tbody tr').first().locator('td').nth(1)).toHaveText('4');
    const descending = await page.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(descending.map(Number)).toEqual(descending.map(Number).sort((a, b) => b - a));
    await page.locator('#search').fill('student-1@e2e.test');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('E2E Student 1');
  } finally { await context.close(); }
});

test('C2 seeded student all eight tabs and real mistake previews', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-admin');
  const observed = await newUserContext(browser, 'e2e-student-1');
  try {
    const progressBefore = await (await observed.request.get('/api/progress')).json();
    const attemptsBefore = await (await observed.request.get('/api/attempts')).json();
    const page = await context.newPage();
    await page.goto('/admin');
    await expect(page.locator('[data-id="e2e-student-1"]')).toBeVisible();
    const detailResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/students/e2e-student-1');
    await page.locator('[data-id="e2e-student-1"]').click();
    const detail = await (await detailResponse).json();
    await expect(page.locator('#message')).toContainText('4 questions done · 50% current accuracy');
    await expect(page.locator('[role="tab"]')).toHaveCount(8);
    await expect(page.locator('#tab-content')).toContainText('Math');
    await expect(page.locator('#tab-content')).toContainText('100% · 2 attempted');
    await expect(page.locator('#tab-content')).toContainText('0% · 1 attempts');
    await page.screenshot({ path: `${artifact}/C2-overview.png` });
    await page.getByRole('tab', { name: 'By skill' }).click();
    await expect(page.locator('#tab-content')).toContainText('Linear Equations in One Variable');
    await expect(page.locator('#tab-content')).toContainText('2 attempted');
    await expect(page.locator('#tab-content .skill-trend svg')).toHaveCount(3);
    await page.getByRole('tab', { name: 'Mistakes' }).click();
    await expect(page.locator('#mistakes [data-question]')).toHaveCount(4);
    await page.locator('#md-domain').selectOption('Algebra');
    await expect(page.locator('#mistakes [data-question]')).toHaveCount(2);
    await page.locator('#md-skill').selectOption('Linear Equations in One Variable');
    await expect(page.locator('#mistakes [data-question]')).toHaveCount(2);
    await page.locator('#md-skill').selectOption('Central Ideas and Details');
    await expect(page.locator('#mistakes')).toContainText('No mistakes for these filters.');
    await page.locator('#md-skill').selectOption('Linear Equations in One Variable');
    await page.locator('#mistakes [data-question="e2e-core-math"]').click();
    await expect(page.locator('#preview .choice')).toHaveCount(4);
    await expect(page.locator('#preview .choice')).toHaveText(['A 5', 'B 6', 'C 7', 'D 8']);
    await expect(page.locator('#preview')).toContainText('Student answer: C · Correct answer: C');
    await expect(page.locator('#preview')).toContainText('E2E_EXPL_MARKER_MATH');
    await expect(page.locator('#preview .katex')).toHaveCount(1);
    await page.screenshot({ path: `${artifact}/C2-mistake-MC.png` });
    await page.locator('#md-diff').selectOption('Easy');
    await expect(page.locator('#mistakes [data-question]')).toHaveCount(1);
    await page.locator('#mistakes [data-question="e2e-core-spr"]').click();
    await expect(page.locator('#preview .choice')).toHaveCount(0);
    await expect(page.locator('#preview .gridin')).toHaveValue('3');
    await expect(page.locator('#preview .gridin')).toBeDisabled();
    await expect(page.locator('#preview')).toContainText('E2E_EXPL_MARKER_SPR');
    await expect(page.locator('#preview')).toContainText('Student answer: 3 · Correct answer: 3');
    await page.screenshot({ path: `${artifact}/C2-mistake-SPR.png` });
    await page.getByRole('tab', { name: 'Traps' }).click();
    await expect(page.locator('#tab-content')).toContainText('opposite claim: 1 · examples: e2e-ai-rw');
    await page.getByRole('tab', { name: 'Pacing' }).click();
    await expect(page.locator('#tab-content')).toContainText('35 with time');
    await expect(page.locator('#tab-content')).toContainText('Math');
    await expect(page.locator('#tab-content')).toContainText('Medium');
    await page.getByRole('tab', { name: 'Second-guessing' }).click();
    await expect(page.locator('#tab-content')).toContainText('Right-to-wrong: 1 · Wrong-to-right: 1');
    await expect(page.locator('#tab-content')).toContainText('Unknown (legacy, blank or unscorable): 32');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('#tab-content')).toContainText('Page 1 of 2 (35 attempts)');
    const history = page.locator('#tab-content');
    await expect(history.locator('p').first()).toContainText('2026-09-23T12:04:00Z');
    await expect(history.locator('p')).toHaveCount(25);
    await page.locator('#h-next').click();
    await expect(history).toContainText('Page 2 of 2 (35 attempts)');
    await expect(history.locator('p')).toHaveCount(10);
    await expect(history.locator('p').first()).toContainText('2026-09-22T10:10:00Z');
    await page.getByRole('tab', { name: 'Lessons' }).click();
    // Task 09 fills the tab: exactly the sessions this detail response listed; only self-paced counts.
    if (detail.lessons.length) {
      await expect(page.locator('#student-lessons tbody tr')).toHaveCount(detail.lessons.length);
      await expect(page.locator('#student-lessons tbody tr td:nth-child(1)')).toHaveText(detail.lessons.map(x => x.paddedId));
      await expect(page.locator('#student-lessons tbody tr td:nth-child(6)')).toHaveText(detail.lessons.map(x => x.mode === 'self' ? 'Yes' : 'No'));
    } else await expect(page.locator('#tab-content')).toContainText('No lessons attended yet.');
    expect(await (await observed.request.get('/api/progress')).json()).toEqual(progressBefore);
    expect(await (await observed.request.get('/api/attempts')).json()).toEqual(attemptsBefore);
    // The student app no longer has a Browse list; the admin Question Bank viewer shows the same preview.
    const browse = await context.newPage();
    await browse.goto('/admin/questions');
    const viewer = browse.locator('dialog.question-viewer');
    await browse.locator('[data-preview="e2e-core-math"]').click();
    await expect(viewer.locator('.choice')).toHaveText(['A 5', 'B 6', 'C 7', 'D 8']);
    await expect(viewer.locator('.qv-question .katex')).toHaveCount(1);
    await expect(viewer).toContainText('E2E_EXPL_MARKER_MATH');
    await viewer.getByRole('button', { name: 'Close' }).click();
    await browse.locator('[data-preview="e2e-core-spr"]').click();
    await expect(viewer.locator('.choice')).toHaveCount(0);
    await expect(viewer).toContainText('The correct answer is 3.');
    await expect(viewer).toContainText('E2E_EXPL_MARKER_SPR');
  } finally { await observed.close(); await context.close(); }
});

test('C3 student and anonymous admin routes gated including unknown and aliases', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await context.newPage();
    for (const path of ['/admin', '/admin.html', '/admin.js']) {
      const response = await page.goto(path);
      expect(response.status()).toBe(403);
    }
    await page.goto('/app');
    await expect(page.locator('#user-name')).not.toHaveText('Guest');
    await expect(page.locator('#admin-link')).toBeHidden();
    for (const path of ['/api/admin/students', '/api/admin/unknown', '/api/admin/students/e2e-student-1/history']) {
      expect((await context.request.get(path)).status()).toBe(403);
    }
    await page.screenshot({ path: `${artifact}/C3-student.png` });
  } finally { await context.close(); }
  const anonymous = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    expect((await anonymous.request.get('/api/admin/unknown')).status()).toBe(401);
    const response = await anonymous.request.get('/admin', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe('/login');
  } finally { await anonymous.close(); }
  const admin = await newUserContext(browser, 'e2e-admin');
  try {
    expect((await admin.request.get('/api/admin/unknown')).status()).toBe(404);
    expect((await admin.request.get('/api/admin/students/not-a-member')).status()).toBe(404);
  } finally { await admin.close(); }
});
