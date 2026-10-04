import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { SKILL, fixture, student, planOf, logTest, saveLog, shot } from './support';

// Home (lesson-ui/home): the first screen. Goal, current score and SAT date are the plan JSON's profile, so an edit on
// Home shows on the Study Plan and pre-fills the log popup, and logging a test updates Home. The clock is fixed on
// Sat Oct 31, 2026 a minute before 8:00 AM New York, a day before daylight saving ends.
test.describe.configure({ mode: 'serial' });
let context: BrowserContext, page: Page;
const NOW = '2026-10-31T11:59:00Z';   // the clock runs; Home's minute tick lands at 8:00 AM EDT
test.beforeAll(async ({ browser }) => {
  await fixture('fixture');
  ({ context, page } = await student(browser));
  await page.clock.setSystemTime(new Date(NOW));
});
test.afterAll(async () => { await context?.close(); await fixture('cleanup'); });

const home = (id: string) => page.locator('#tab-home #' + id);
const clock = async () => (await page.locator('#home-clock b').allTextContents()).join(' ');
const tab = (name: string) => page.locator(`[data-tab="${name}"]`).click();

test('H1 Home is the first screen: greeting, no plan yet, the button opens the log popup', async () => {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student 7');
  await expect(page.locator('[data-tab="home"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#tab-home')).toBeVisible();
  await expect(page.locator('.board-h')).toBeHidden();
  await expect(home('home-greet')).toHaveText(/^Good (morning|afternoon|evening), E2E$/);
  await expect(home('home-next')).toHaveText('Log a Bluebook practice test');
  await expect(home('home-sat-set')).toHaveText('Set date');
  await expect(home('home-goal-set')).toHaveText('Set score');
  await expect(home('home-current-set')).toHaveText('Set score');
  await shot(page, 'home-1-empty');
  await home('home-next').click();
  await expect(page.locator('#tab-plan')).toBeVisible();
  await expect(page.locator('#plan-log-form')).toHaveAttribute('data-page', 'start');
  await page.locator('#pl-cancel').click();
  await tab('home');
  await home('home-weekly').click();
  await expect(page.locator('[data-tab="plan"]')).toHaveClass(/\bon\b/);
  await tab('home');
});

test('H2 the SAT countdown runs to 8:00 AM Eastern across the daylight-saving change, and ticks each minute', async () => {
  await home('home-sat-set').click();
  await home('home-sat-select').selectOption('2026-11-07');
  await expect(home('home-sat-date')).toHaveText('Nov 7, 2026');
  // Oct 31 8:00 AM EDT to Nov 7 8:00 AM EST: seven days and one hour.
  await expect.poll(clock).toBe('7 01 00');
  await page.clock.runFor(60000);
  await expect.poll(clock).toBe('7 00 59');
  expect((await planOf(context)).profile).toEqual({ goal: null, satDate: '2026-11-07', emphasis: 'balanced' });
});

test('H3 target and current score: validated inline, saved to the plan, shown on the Study Plan and in the log popup', async () => {
  await home('home-goal-set').click();
  await home('home-goal-input').fill('1455');
  await home('home-goal-save').click();
  await expect(home('home-goal-error')).toHaveText('Your target score must be a multiple of 10 from 400 to 1600.');
  await home('home-goal-input').fill('1450');
  await home('home-goal-input').press('Enter');
  await expect(home('home-goal-value')).toHaveText('1450');
  await home('home-current-set').click();
  await home('home-current-input').fill('390');
  await home('home-current-save').click();
  await expect(home('home-current-error')).toContainText('from 400 to 1600');
  await home('home-current-input').fill('1210');
  await home('home-current-save').click();
  await expect(home('home-current-value')).toHaveText('1210');
  expect((await planOf(context)).profile).toEqual({ goal: 1450, satDate: '2026-11-07', emphasis: 'balanced', current: { score: 1210, date: '2026-10-31' } });
  await shot(page, 'home-2-set');

  await tab('plan');
  await expect(page.locator('#plan-goal')).toHaveText('Goal 1450 · Current 1210 · SAT Nov 7, 2026 (7 days away)');
  await shot(page, 'home-5-plan-empty-goal');
  await page.locator('#plan-log').click();
  // PT90 as in plan.spec C2, taken today: drills Linear functions first.
  await logTest(page, 'PT90', '2026-10-31', { RW1: 'WWSW', RW2: 'S', Math1: 'W..', Math2: 'W.' });
  await expect(page.locator('#pl-goal')).toHaveValue('1450');
  await expect(page.locator('#pl-sat')).toHaveValue('2026-11-07');
  await shot(page, 'home-6-log-prefilled');
  await page.locator('#pl-score-RW').fill('650');
  await page.locator('#pl-score-Math').fill('700');
  await saveLog(page);
});

test('H4 logging a test updates Home; the button starts the next step', async () => {
  await tab('home');
  await expect(home('home-current-value')).toHaveText('1350');
  await expect(home('home-goal-value')).toHaveText('1450');
  await expect(home('home-next')).toHaveText(`Next up: Drill · ${SKILL.a}`);
  await shot(page, 'home-3-plan');
  // Phone width: no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.querySelector('.board-b')!.scrollWidth <= document.querySelector('.board-b')!.clientWidth)).toBe(true);
  await shot(page, 'home-4-phone');
  await page.setViewportSize({ width: 1366, height: 768 });
  await home('home-goal-edit').click();
  await home('home-goal-input').fill('1500');
  await home('home-goal-save').click();
  await expect(home('home-goal-value')).toHaveText('1500');
  await tab('plan');
  await expect(page.locator('#plan-goal')).toContainText('Goal 1500 · Current 1350');
  await shot(page, 'home-7-plan-current');
  await tab('home');
  await home('home-next').click();
  await expect(page.locator('#bank-live')).toBeVisible();
  await expect(page.locator('#bank-segment')).toHaveText('Medium · section 1 of 2');
});
