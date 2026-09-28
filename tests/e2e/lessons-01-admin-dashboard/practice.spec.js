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
    await expect(page.locator('#home-stats .v').first()).toHaveText('8'); // 8 bank questions since the 11b split-layout fixture
    await page.locator('[data-tab="practice"]').click();
    await page.locator('#btn-start').click();
    await expect(page.locator('#view-test')).toBeVisible();
    await expect(page.locator('#pane-a #choices .choice')).toHaveCount(4);
    await expect(page.locator('#pane-a .stem')).toContainText('club made');
    await page.locator('#pane-a .choice[data-letter="A"]').click();
    await page.locator('#pane-a .choice[data-letter="B"]').click();
    await page.locator('#pane-a .choice[data-letter="B"] .chk-btn').click();
    await expect(page.locator('#expl-panel')).toContainText('Your answer: B · Correct answer:');
    await page.locator('#btn-next').click();
    await expect(page.locator('#pane-a .stem')).toContainText('3 + 4');
    await page.locator('#btn-next').click();
    await expect(page.locator('#pane-a #gi')).toBeVisible();
    await page.locator('#pane-a #gi').fill('2');
    await page.locator('#pane-a #gi').dispatchEvent('change');
    await page.locator('#pane-a #gi').fill('3');
    await page.locator('#pane-a #gi-submit').click();
    await expect(page.locator('#pane-a #spr-verdict')).toContainText('Correct');
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
    await page.locator('#btn-dash').click();
    await expect(page.locator('#modal-root')).toContainText('End this practice session?');
    await page.locator('#cm-yes').click();
    await expect(page.locator('#view-home')).toBeVisible();
    const progress = (await (await student.request.get('/api/progress')).json()).filter(x => x.attempts > 0);
    const correct = progress.filter(x => ['Green', 'Orange'].includes(x.marker)).length;
    await expect(page.locator('#home-stats .v').nth(1)).toHaveText(String(progress.length));
    await expect(page.locator('#home-stats .v').nth(2)).toHaveText(`${Math.round(correct / progress.length * 100)}%`);
  } finally { await admin.close(); await student.close(); }
});
