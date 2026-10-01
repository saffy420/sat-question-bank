import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';

const artifact = '.opencode/pipeline/lessons-01-admin-dashboard/e2e';

test('C4 practice MC and SPR choices persist exact history and admin direction; legacy stays unknown', async ({ browser }) => {
  const student = await newUserContext(browser, 'e2e-student-3');
  const admin = await newUserContext(browser, 'e2e-admin');
  try {
    const before = (await (await student.request.get('/api/attempts')).json()).map(x => `${x.question_id}|${x.ts}`);
    const directionBefore = (await (await admin.request.get('/api/admin/students/e2e-student-3')).json()).directions;
    const page = await student.newPage();
    await page.goto('/app');
    await expect(page.locator('#home-stats .v').first()).toHaveText('9'); // 9 bank questions since the figure-viewer math figure fixture
    await page.locator('[data-tab="practice"]').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#bank-live')).toBeVisible();
    await expect(page.locator('#bank-card [data-lesson-choice]')).toHaveCount(4);
    await expect(page.locator('#bank-card .lesson-stem')).toContainText('club made');
    await page.locator('#bank-card [data-lesson-choice="A"]').click();
    await page.locator('#bank-card [data-lesson-choice="B"]').click();
    await page.locator('#bank-primary').click(); // Check B: wrong, recorded once; the question stays open (retry until correct)
    await expect(page.locator('#bank-card [data-lesson-choice="B"] .choice')).toHaveClass(/wrong/);
    await expect(page.locator('#bank-reveal')).toHaveCount(0);
    await page.locator('#bank-card [data-lesson-choice="A"]').click();
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-verdict')).toContainText('Correct');
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-card .lesson-stem')).toContainText('3 + 4');
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-card #lesson-grid')).toBeVisible();
    await page.locator('#bank-card #lesson-grid').fill('2');
    await page.locator('#bank-card #lesson-grid').dispatchEvent('change');
    await page.locator('#bank-card #lesson-grid').fill('3');
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-verdict')).toContainText('Correct');
    await expect.poll(async () => {
      const response = await student.request.get('/api/attempts');
      if (!response.ok()) return [];
      return (await response.json()).filter(x => !before.includes(`${x.question_id}|${x.ts}`) && ['e2e-core-rw', 'e2e-core-spr'].includes(x.question_id));
    }).toHaveLength(2);
    const attempts = (await (await student.request.get('/api/attempts')).json()).filter(x => !before.includes(`${x.question_id}|${x.ts}`) && ['e2e-core-rw', 'e2e-core-spr'].includes(x.question_id));
    expect(attempts.map(x => [x.question_id, x.picked, x.correct, JSON.parse(x.answer_history_json).map(h => h.answer)])).toEqual([
      ['e2e-core-rw', 'B', 0, ['A', 'B']], ['e2e-core-spr', '3', 1, ['2', '3']]
    ]);
    await page.screenshot({ path: `${artifact}/C4-student-SPR.png` });
    const adminPage = await admin.newPage();
    await adminPage.goto('/admin');
    await expect(adminPage.locator('[data-id="e2e-student-3"]')).toBeVisible();
    await adminPage.locator('[data-id="e2e-student-3"]').click();
    await adminPage.getByRole('tab', { name: 'Second-guessing' }).click();
    const after = (await (await admin.request.get('/api/admin/students/e2e-student-3')).json()).directions;
    expect(after['right-to-wrong'] - directionBefore['right-to-wrong']).toBe(1);
    expect(after['wrong-to-right'] - directionBefore['wrong-to-right']).toBe(1);
    expect(after.unknown).toBe(directionBefore.unknown);
    await expect(adminPage.locator('#tab-content')).toContainText(`Right-to-wrong: ${after['right-to-wrong']} · Wrong-to-right: ${after['wrong-to-right']}`);
    await expect(adminPage.locator('#tab-content')).toContainText(`Unknown (legacy, blank or unscorable): ${after.unknown}`);
    await adminPage.screenshot({ path: `${artifact}/C4-directions.png` });
    await adminPage.locator('#back').click();
    await adminPage.locator('[data-id="e2e-student-1"]').click();
    await adminPage.getByRole('tab', { name: 'Second-guessing' }).click();
    await expect(adminPage.locator('#tab-content')).toContainText('Unknown (legacy, blank or unscorable): 32');
    await page.locator('#bank-dashboard').click();
    await expect(page.locator('#bank-exit-dialog')).toContainText('End this practice session?');
    await page.locator('#bank-exit-confirm').click();
    await expect(page.locator('#view-home')).toBeVisible();
    const progress = (await (await student.request.get('/api/progress')).json()).filter(x => x.attempts > 0);
    const correct = progress.filter(x => ['Green', 'Orange'].includes(x.marker)).length;
    await expect(page.locator('#home-stats .v').nth(1)).toHaveText(String(progress.length));
    await expect(page.locator('#home-stats .v').nth(2)).toHaveText(`${Math.round(correct / progress.length * 100)}%`);
  } finally { await admin.close(); await student.close(); }
});
