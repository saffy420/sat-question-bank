import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { RW, MATH, startPractice, goTo, current } from '../bank-bluebook/support';

// qbank-filters: Saved is the player's Mark for Review flag, kept on the account (/api/saved) instead of the session.
const STUDENT = 'e2e-student-4';
const SHOTS = 'docs/qbank/filters';
const shot = (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const saved = async (context: BrowserContext): Promise<string[]> => (await (await context.request.get('/api/saved')).json()).sort();
const flag = (page: Page) => page.locator('#bank-card #stage-flag');
const unsaveAll = async (context: BrowserContext) => {
  for (const id of await saved(context)) await context.request.post('/api/saved', { data: { question_id: id, saved: false }, headers: { Origin: 'https://127.0.0.1:8787' } });
};
// Clicks Mark for Review and waits for the account to answer.
async function toggle(page: Page, on: boolean) {
  const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/saved' && r.request().method() === 'POST');
  await flag(page).click();
  expect((await sent).status()).toBe(200);
  await expect(flag(page)).toHaveAttribute('aria-pressed', String(on));
}

test('Mark for Review survives a reload and shows up flagged in a new set; un-flagging removes it', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await newUserContext(browser, STUDENT);
  try {
    await unsaveAll(context);
    const page = await context.newPage();
    await startPractice(page);
    await goTo(page, RW);
    await expect(flag(page)).toHaveAttribute('aria-pressed', 'false');
    await toggle(page, true);
    expect(await saved(context)).toEqual([RW]);
    await expect(page.locator('#bank-nav')).toBeVisible();
    await shot(page, 'saved-flagged-in-player');

    // A reload forgets the session; the account remembers.
    await page.reload();
    await expect(page.locator('#user-name')).toContainText('E2E Student');
    expect(await saved(context)).toEqual([RW]);

    // A new set opened on that question shows it flagged, and its neighbours are not.
    await startPractice(page);
    await goTo(page, RW);
    await expect(flag(page)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#bank-nav').click();
    await expect(page.locator('#bank-navigator [data-bank-q]').first()).toBeVisible();
    await shot(page, 'saved-new-set-navigator');
    await page.keyboard.press('Escape');
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
    expect(await current(page)).not.toBe(RW);
    await expect(flag(page)).toHaveAttribute('aria-pressed', 'false');

    // Un-flag it again: the account forgets it.
    await page.locator('#bank-back').click();
    expect(await current(page)).toBe(RW);
    await toggle(page, false);
    expect(await saved(context)).toEqual([]);
    await page.reload();
    await startPractice(page);
    await goTo(page, RW);
    await expect(flag(page)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await unsaveAll(context);
    await context.close();
  }
});

test('saved questions belong to the account that saved them', async ({ browser }) => {
  const mine = await newUserContext(browser, STUDENT);
  const other = await newUserContext(browser, 'e2e-student-3');
  try {
    await unsaveAll(mine); await unsaveAll(other);
    const page = await mine.newPage();
    await startPractice(page);
    await goTo(page, MATH);
    await toggle(page, true);
    expect(await saved(mine)).toEqual([MATH]);
    expect(await saved(other)).toEqual([]);
  } finally {
    await unsaveAll(mine); await unsaveAll(other);
    await mine.close(); await other.close();
  }
});
