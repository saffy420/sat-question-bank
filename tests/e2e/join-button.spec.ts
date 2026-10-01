import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from './lessons-00b-e2e-harness/auth.js';

// The nav's Join lesson button stands out: a raised green pill (icon + label on the rail, icon in the narrow rail,
// "Join" tile in the phone tab bar), and it still opens the join dialog.
const SHOTS = 'docs/plan/screens';
for (const [name, viewport, label] of [['desktop', { width: 1366, height: 768 }, 'Join lesson'], ['rail', { width: 900, height: 700 }, ''], ['phone', { width: 390, height: 780 }, 'Join']] as const) {
  test(`Join lesson is a green pill (${name})`, async ({ browser }) => {
    const context = await newUserContext(browser, 'e2e-student-1', { viewport });
    try {
      const page = await context.newPage();
      await page.goto('/app');
      await expect(page.locator('#user-name')).toContainText('E2E Student 1');
      const join = page.locator('#join-lesson');
      await expect(join).toBeVisible();
      await expect(join.locator('svg')).toBeVisible();
      await expect(join).toHaveCSS('background-color', 'rgb(53, 208, 127)');
      const radius = parseFloat(await join.evaluate(el => getComputedStyle(el).borderTopLeftRadius));
      expect(radius).toBeGreaterThanOrEqual(14);
      if (label) expect(await join.evaluate(el => el.innerText || getComputedStyle(el.querySelector('span')!, '::after').content)).toMatch(new RegExp(label));
      mkdirSync(SHOTS, { recursive: true });
      await page.locator('.nav').screenshot({ path: `${SHOTS}/join-button-${name}.png` });
      await join.click();
      await expect(page.locator('#lesson-code input')).toHaveCount(6);
    } finally { await context.close(); }
  });
}
