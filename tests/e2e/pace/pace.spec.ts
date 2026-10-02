import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { targetOf } from '../../../public/shared/stats.js';
import { startPractice, current, MATH } from '../bank-bluebook/support';

// pace: the practice player shows the recommended time next to the clock and tints the clock amber once the student is over it.
test('the player shows the question target, goes amber past it, and Hide timer hides both', async ({ browser }) => {
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await student.newPage();
    await startPractice(page, { math: true });
    expect(await current(page)).toBe(MATH);
    const row = await page.evaluate(() => { const { S } = window.__qa(); return S.items[S.i]; });
    const sec = targetOf(row) / 1000;
    const label = `Target ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const target = page.locator('#bank-target'), clock = page.locator('#bank-clock');
    await expect(target).toHaveText(label);
    await expect(clock).not.toHaveClass(/late/);

    // Move the question's start past the target; the one-second tick re-renders the clock.
    await page.evaluate(ms => { window.__qa().S.qStart = Date.now() - ms - 3000; }, targetOf(row));
    await expect(clock).toHaveClass(/late/);
    expect(await clock.evaluate(el => getComputedStyle(el).color)).toBe('rgb(180, 95, 6)');
    await page.screenshot({ path: 'docs/pace/over-target.png' });

    await page.locator('#bank-live .lesson-timer button', { hasText: 'Hide' }).click();
    await expect(target).toBeHidden();
    await expect(clock).toBeHidden();
    await page.locator('#bank-live .lesson-timer button', { hasText: 'Show' }).click();
    await expect(target).toBeVisible();
  } finally { await student.close(); }
});
