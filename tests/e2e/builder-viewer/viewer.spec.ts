import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';

const artifact = '.opencode/pipeline/builder-viewer/e2e';
for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`lesson item viewer ${size}`, async ({ browser }) => {
    test.setTimeout(120000);
    mkdirSync(`${artifact}/${size}`, { recursive: true });
    const context = await newUserContext(browser, 'e2e-admin', { viewport });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${artifact}/${size}/${name}.png` });
      };
      await page.goto('/admin/lessons/new');
      await expect(page.locator('#results [data-add]')).toHaveCount(9);
      for (const id of ['e2e-core-rw', 'e2e-core-math', 'e2e-core-spr']) await page.locator(`[data-add="${id}"]`).click();
      await page.locator('#lesson-title').fill(`Viewer lesson ${size}`);
      await page.locator('#save-lesson').click();
      await expect(page.locator('#save-status')).toHaveText('Saved');

      // Rows: skill + difficulty + notes snippet, no raw id text.
      const rows = page.locator('#lesson-items li');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText('1. Words in Context');
      await expect(rows.nth(0)).toContainText('Easy');
      await expect(rows.nth(0)).toContainText('No notes');
      await expect(rows.nth(1)).toContainText('Medium');
      for (const t of await rows.allInnerTexts()) expect(t).not.toContain('e2e-core');
      await shot('rows');

      // Row 2 opens the pop-up on that item.
      await rows.nth(1).locator('.item-title').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-outline="1"]')).toHaveAttribute('aria-current', 'true');
      await expect(dialog.locator('.question-preview')).toContainText('What is');
      await expect(dialog).toContainText('Question 2 of 3');
      await shot('viewer-open');

      // Edit 1:30 + notes, step Next / Previous through the lesson's questions.
      await dialog.locator('[data-time="90"]').click();
      await dialog.locator('#lesson-notes').fill('Check the slope first \\(x^2\\)');
      await expect(dialog.locator('#notes-preview .katex')).toHaveCount(1);
      await dialog.locator('#iv-next').click();
      await expect(dialog.locator('[data-outline="2"]')).toHaveAttribute('aria-current', 'true');
      await expect(dialog.locator('[data-outline="1"]')).not.toHaveAttribute('aria-current', 'true');
      await expect(dialog.locator('.question-preview')).toContainText('Enter the value');
      await expect(dialog.locator('#iv-next')).toBeDisabled();
      await dialog.locator('#iv-prev').click();
      await expect(dialog.locator('#lesson-notes')).toHaveValue('Check the slope first \\(x^2\\)');
      await expect(dialog.locator('[data-time="90"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.locator('[data-outline="1"]')).toContainText('Check the slope first');
      await dialog.locator('#custom-time').fill('0:01');
      await dialog.locator('#custom-time').press('Tab');
      await expect(dialog.locator('#time-error')).toContainText('Use mm:ss');
      await shot('viewer-edited');
      await dialog.locator('#custom-time').fill('1:30');
      await dialog.locator('#custom-time').press('Tab');
      await expect(dialog.locator('#time-error')).toHaveText('');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      // Persisted through autosave + reload.
      await expect(page.locator('#save-status')).toHaveText('Saved');
      await expect(rows.nth(1)).toContainText('Check the slope first');
      await expect(rows.nth(1)).toContainText('1:30');
      await page.reload();
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(1)).toContainText('Check the slope first');
      await rows.nth(1).locator('[data-edit-item]').click();
      await expect(dialog.locator('#lesson-notes')).toHaveValue('Check the slope first \\(x^2\\)');
      await expect(dialog.locator('[data-time="90"]')).toHaveAttribute('aria-pressed', 'true');
      await dialog.locator('#close-editor').click();

      // "Open in lesson" from the bank viewer lands on the matching item.
      await page.locator('[data-preview="e2e-core-spr"]').click();
      await expect(dialog).toContainText('Added');
      await dialog.locator('#qv-open-lesson').click();
      await expect(dialog.locator('[data-outline="2"]')).toHaveAttribute('aria-current', 'true');
      await expect(dialog.locator('.question-preview')).toContainText('Enter the value');
      await shot('open-in-lesson');
      await dialog.locator('#iv-remove').click();
      await expect(rows).toHaveCount(2);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
