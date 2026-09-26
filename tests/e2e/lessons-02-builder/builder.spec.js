import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

const artifact = '.opencode/pipeline/lessons-02-builder/e2e';
const ids = ['e2e-core-rw', 'e2e-core-math', 'e2e-core-spr'];
const order = page => page.locator('#lesson-items li').evaluateAll(rows => rows.map(row => row.textContent.match(/e2e-core-[\w-]+/)[0]));

async function openFilter(page, name) {
  const details = page.locator('.multi details').filter({ has: page.locator('summary', { hasText: name }) });
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
}

test('task02 builder: filtered add, drag, remove, custom times, math notes, persistence, usage filter, join code', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-admin');
  try {
    const page = await context.newPage();
    await page.goto('/admin/lessons/new');
    await expect(page.locator('#results [data-add]')).toHaveCount(4);
    await page.locator('#lesson-title').fill(`E2E builder ${Date.now()}`);

    await page.locator('#f-section').selectOption('Reading & Writing');
    await openFilter(page, 'Domain');
    await page.locator('[data-domain="Craft and Structure"]').check();
    await expect(page.locator('[data-skill="Words in Context"]')).toHaveCount(1);
    await openFilter(page, 'Skill');
    await page.locator('[data-skill="Words in Context"]').check();
    await expect(page.locator('#results [data-add]')).toHaveCount(1);
    await expect(page.locator('#results [data-add]')).toHaveAttribute('data-add', ids[0]);
    await page.locator(`[data-add="${ids[0]}"]`).click();
    await expect(page.locator('#total-time')).toHaveText('1:00');
    await page.screenshot({ path: `${artifact}/01-domain-skill.png` });

    await page.locator('#f-section').selectOption('Math');
    await openFilter(page, 'Domain');
    await page.locator('[data-domain="Algebra"]').check();
    await openFilter(page, 'Skill');
    await page.locator('[data-skill="Linear Equations in One Variable"]').check();
    await expect(page.locator('#results [data-add]')).toHaveCount(2);
    await page.locator(`[data-add="${ids[1]}"]`).click();
    await page.locator(`[data-add="${ids[2]}"]`).click();
    await expect(page.locator('#total-time')).toHaveText('4:00');
    expect(await order(page)).toEqual(ids);
    await page.locator('#lesson-items li').nth(2).dragTo(page.locator('#lesson-items li').first());
    await expect.poll(() => order(page)).toEqual([ids[2], ids[0], ids[1]]);
    await page.locator(`[data-remove="1"]`).click();
    expect(await order(page)).toEqual([ids[2], ids[1]]);
    await page.locator('#f-section').selectOption('Reading & Writing');
    await openFilter(page, 'Domain');
    await page.locator('[data-domain="Craft and Structure"]').check();
    await openFilter(page, 'Skill');
    await page.locator('[data-skill="Words in Context"]').check();
    await expect(page.locator(`[data-add="${ids[0]}"]`)).toBeVisible();
    await page.locator(`[data-add="${ids[0]}"]`).click();
    expect(await order(page)).toEqual([ids[2], ids[1], ids[0]]);
    await page.screenshot({ path: `${artifact}/02-reorder-remove.png` });

    await page.locator(`[aria-label="Edit ${ids[2]}"]`).click();
    await page.locator('#custom-time').fill('0:35');
    await page.locator('#custom-time').press('Tab');
    await expect(page.locator('#total-time')).toHaveText('3:05');
    await page.locator('#lesson-notes').fill('**Factor** \\(x^2\\)\n\n- <script>alert(1)</script>');
    await expect(page.locator('#notes-preview strong')).toHaveText('Factor');
    await expect(page.locator('#notes-preview .katex')).toHaveCount(1);
    await expect(page.locator('#notes-preview script')).toHaveCount(0);
    await expect(page.locator('#notes-preview')).toContainText('<script>alert(1)</script>');
    await page.screenshot({ path: `${artifact}/03-notes-math.png` });
    await page.locator('#close-editor').click();
    await page.locator(`[aria-label="Edit ${ids[1]}"]`).click();
    await page.locator('#custom-time').fill('2:05');
    await page.locator('#custom-time').press('Tab');
    await expect(page.locator('#total-time')).toHaveText('3:40');
    await page.locator('#save-lesson').click();
    await expect(page.locator('#save-status')).toHaveText('Saved');
    await expect(page).toHaveURL(/\/admin\/lessons\/\d+\/edit$/);
    const savedURL = page.url();
    await page.screenshot({ path: `${artifact}/04-saved.png` });
    await page.reload();
    await expect(page.locator('#save-status')).toHaveText('Saved');
    await expect(page.locator('#lesson-title')).toHaveValue(/E2E builder \d+/);
    await expect(page.locator('[name="mode"][value="instructor"]')).toBeChecked();
    expect(await order(page)).toEqual([ids[2], ids[1], ids[0]]);
    await expect(page.locator('#total-time')).toHaveText('3:40');
    await page.locator(`[aria-label="Edit ${ids[2]}"]`).click();
    await expect(page.locator('#custom-time')).toHaveValue('0:35');
    await expect(page.locator('#lesson-notes')).toHaveValue('**Factor** \\(x^2\\)\n\n- <script>alert(1)</script>');
    await expect(page.locator('#notes-preview .katex')).toHaveCount(1);
    await page.locator('#close-editor').click();
    await page.locator(`[aria-label="Edit ${ids[1]}"]`).click();
    await expect(page.locator('#custom-time')).toHaveValue('2:05');
    await page.locator('#close-editor').click();
    await page.screenshot({ path: `${artifact}/05-reloaded.png` });

    await page.locator('#f-section').selectOption('Math');
    await openFilter(page, 'Domain');
    await page.locator('[data-domain="Algebra"]').check();
    await openFilter(page, 'Skill');
    await page.locator('[data-skill="Linear Equations in One Variable"]').check();
    await expect(page.locator(`[data-preview="${ids[2]}"]`)).toBeVisible();
    await expect(page.locator(`[data-preview="${ids[2]}"]`).locator('..').locator('.usage-badge')).toHaveText('900001');
    await page.locator('#f-usage').selectOption('hide-all');
    await expect(page.locator('#results [data-add]')).toHaveCount(1);
    await expect(page.locator(`[data-add="${ids[2]}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-add="${ids[1]}"]`)).toBeVisible();
    await page.screenshot({ path: `${artifact}/06-hide-used.png` });

    await page.locator('#save-start').click();
    await expect(page.locator('#join-result .join-code')).toHaveText(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const joinCode = await page.locator('#join-result .join-code').textContent();
    await expect(page.locator('#join-result')).toContainText(`${ORIGIN}/app?join=${joinCode}`);
    await expect(page).toHaveURL(savedURL);
    await page.screenshot({ path: `${artifact}/07-join-code.png` });
    const lessonId = savedURL.match(/\/lessons\/(\d+)\/edit$/)[1];
    const sessions = await (await context.request.get(`/api/admin/lessons/${lessonId}/sessions`)).json();
    expect(sessions.some(s => s.join_code === joinCode && s.status === 'lobby')).toBe(true);
  } finally { await context.close(); }
});
