import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { MATH, startPractice, current, goTo, primary, choice } from '../bank-bluebook/support';

// bank-desmos: the Prepzy community Desmos solution in the practice player. Seeded for e2e-core-math only
// (tools/e2e_core.sql); its answer is C.

test('the Desmos solution appears only once the question is closed, and loads on demand', async ({ browser }) => {
  test.setTimeout(120000);
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await student.newPage();
    const fetches: string[] = [];
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/desmos/')) fetches.push(r.url()); });
    await startPractice(page, { math: true });
    await goTo(page, MATH);
    // Open question, a wrong Check, and the question still open: nothing anywhere.
    await expect(page.locator('#bank-desmos')).toHaveCount(0);
    await choice(page, 'B').click();
    await primary(page).click();
    await expect(page.locator('#bank-status')).toBeVisible();
    await expect(page.locator('#bank-desmos')).toHaveCount(0);
    expect(await page.locator('#bank-live').innerText()).not.toMatch(/desmos solution|via prepzy/i);
    // Right answer closes it: the button shows, but nothing is fetched until it is pressed.
    await choice(page, 'C').click();
    await primary(page).click();
    await expect(page.locator('#bank-reveal')).toBeVisible();
    await expect(page.locator('#bank-desmos-open')).toHaveText('Desmos solution');
    expect(fetches).toEqual([]);
    await page.locator('#bank-desmos-open').click();
    await expect(page.locator('#bank-desmos-calc[data-ready="true"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#bank-desmos-credit')).toHaveText('Solution by E2E Maker via Prepzy');
    await expect(page.locator('#bank-desmos-calc .dcg-graph-outer, #bank-desmos-calc canvas').first()).toBeVisible();
    expect(fetches.length).toBe(1);
    await page.locator('#bank-reveal').screenshot({ path: test.info().outputPath('bank-desmos.png') });
    // The next question has no solution: nothing offered, closed or not.
    await primary(page).click();
    await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
    expect(await current(page)).not.toBe(MATH);
    await expect(page.locator('#bank-desmos')).toHaveCount(0);
  } finally { await student.close(); }
});
