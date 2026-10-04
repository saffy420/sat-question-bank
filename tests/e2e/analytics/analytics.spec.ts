import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ORIGIN, newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { fixture, STUDENT, P } from '../study-plan/support';
import { nextProgress } from '../../../public/shared/stats.js';

// analytics: the Analytics tab (rail id `dash`, lesson-ui/analytics) for a signed-out visitor, a new account, the
// seeded e2e-student-1, and e2e-student-7 with a hand-calculated attempt history, at desktop and phone widths.
const SHOTS = 'docs/analytics';
const shot = (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const PHONE = { width: 390, height: 844 };

async function openAnalytics(page: Page) {
  await page.goto('/app');
  await expect(page.locator('[data-tab="dash"]')).toHaveText('Analytics');
  await page.locator('[data-tab="dash"]').click();
  await expect(page.locator('#analytics .an')).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`#analytics [data-card="${id}"]`);
const rows = (page: Page, id: string) => card(page, id).locator('.an-item');
const watchErrors = (page: Page) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); return errors; };
// The board scrolls inside .board-b, so a whole-tab shot grows the viewport to the board's height first.
async function fullShot(page: Page, name: string) {
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => document.querySelector('#analytics')!.scrollHeight + 160);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await shot(page, name);
  await page.setViewportSize(size);
}

test.describe.serial('analytics', () => {
  test.afterAll(async () => { await fixture('cleanup'); });

  test('a guest (signed out) never reaches Analytics: /app sends them to sign in', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      await page.goto('/app');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator('#analytics')).toHaveCount(0);
    } finally { await context.close(); }
  });

  test('the seeded student: lists, rings and the activity chart from the seed', async ({ browser }) => {
    const context = await newUserContext(browser, 'e2e-student-1');
    try {
      const page = await context.newPage();
      const errors = watchErrors(page);
      await openAnalytics(page);
      await page.locator('#db-range [data-r="0"]').click();
      // Read the account's own log and check the one skill with 5+ answers by plain arithmetic.
      const { log, qs } = await page.evaluate(() => { const { LOG, QS } = (window as any).__qa(); return { log: LOG, qs: QS.map((q: any) => ({ id: q.id, skill: q.skill, section: q.section })) }; });
      const skill = new Map(qs.map((q: any) => [q.id, q.skill]));
      const per: Record<string, { a: number; c: number }> = {};
      for (const x of log) { const k = skill.get(x.question_id) as string; if (!k || x.correct == null) continue; (per[k] ||= { a: 0, c: 0 }).a++; if (x.correct) per[k].c++; }
      const top = Object.entries(per).filter(([, v]) => v.a >= 5).sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a);
      await expect(rows(page, 'lowest')).toHaveCount(Math.min(5, top.length));
      const [name, v] = top[0];
      await expect(rows(page, 'lowest').first().locator('.an-name b')).toHaveText(name);
      await expect(rows(page, 'lowest').first().locator('.an-pct b')).toHaveText(`${Math.round(v.c / v.a * 100)}%`);
      await expect(card(page, 'activity').locator('.cbar').first()).toBeVisible();
      await expect(card(page, 'heat').locator('.heat i').first()).toBeVisible();
      await fullShot(page, 'seeded-1366');
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  test('a new account, then a hand-calculated history: both top-5 lists and Practice', async ({ browser }) => {
    test.setTimeout(120000);
    await fixture('fixture');   // wipes e2e-student-7's history and adds the e2e-plan-* questions
    let context: BrowserContext | undefined;
    try {
      context = await newUserContext(browser, STUDENT);
      const page = await context.newPage();
      const errors = watchErrors(page);
      await openAnalytics(page);
      await expect(page.locator('#analytics [data-stat="answered"] .v')).toHaveText('0');
      await expect(card(page, 'lowest').locator('[data-take]')).toHaveText('Answer 5 more to see this.');
      await expect(card(page, 'slowest').locator('.an-empty')).toContainText('time 5 more to see this');
      await expect(card(page, 'sections').locator('.an-dial-c b')).toHaveText(['—', '—']);
      await expect(page.locator('#analytics')).not.toContainText(/(?<!\d)0%/);
      await shot(page, 'new-account-1366');
      // One real answer: a count, and still no percentage.
      await page.locator('[data-tab="practice"]').click();
      await page.locator('#btn-start').click();
      await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
      await page.locator('#bank-card [data-lesson-choice]').first().click();
      await page.locator('#bank-primary').click();
      await page.locator('#bank-dashboard').click();
      await page.locator('#bank-exit-confirm').click();
      await page.locator('[data-tab="dash"]').click();
      await expect(page.locator('#analytics [data-stat="answered"] .v')).toHaveText('1');
      await expect(page.locator('#analytics [data-stat="accuracy"] .v')).toHaveText('\u2014');
      await expect(page.locator('#analytics [data-stat="accuracy"] .s')).toHaveText('answer 4 more to see this');
      await expect(page.locator('#analytics')).not.toContainText(/(?<!\d)0%/);
      await fixture('fixture');   // wipe that answer again, so the history below is the whole log

      // Targets (targetOf): Linear functions Medium 80s; Boundaries Easy 40s; Words in Context Easy 45s, Hard 80s;
      // Circles Easy 90s; Transitions Easy 40s; Percentages Easy 55s.
      const base = Date.now() - 3600000;
      let k = 0;
      const rowsOf = (ids: string[], correct: number[], secs: number[]) => ids.map((id, i) =>
        ({ question_id: P(id), ts: new Date(base + 1000 * k++).toISOString(), correct: correct[i], time_taken_ms: secs[i] * 1000, picked: correct[i] ? 'B' : 'A', changes: 0 }));
      const history = [
        ...rowsOf(['am1', 'am2', 'am3', 'am4', 'am5', 'am6'], [1, 1, 1, 1, 1, 0], [100, 100, 100, 100, 100, 100]),   // 5/6 = 83%; 100s vs 80s
        ...rowsOf(['b1', 'b2', 'b3', 'b4', 'b5'], [1, 0, 0, 0, 1], [60, 60, 60, 60, 60]),                             // 2/5 = 40%; 60s vs 40s
        ...rowsOf(['c1', 'c2', 'c3', 'ch1', 'ch1'], [0, 0, 1, 0, 0], [45, 45, 45, 45, 45]),                           // 1/5 = 20%; 45s vs (3x45 + 2x80)/5 = 59s
        ...rowsOf(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], [1, 1, 1, 0, 0, 0], [135, 135, 135, 135, 135, 135]),          // 3/6 = 50%; 135s vs 90s
        ...rowsOf(['t1', 't2', 't3', 't4', 't5', 't6', 't7'], [1, 1, 1, 1, 1, 1, 0], [30, 30, 30, 30, 30, 30, 30]),   // 6/7 = 86%; 30s vs 40s
        ...rowsOf(['p1', 'p2', 'p3', 'p4', 'p5'], [1, 1, 0, 0, 0], [66, 66, 66, 66, 0]),                              // 2/5 = 40%; 4 timed
        ...rowsOf(['e1', 'e2', 'e3'], [0, 0, 0], [100, 100, 100])                                                     // 3 answers: below the floor
      ];
      // The progress rows the same answers would have left, so "where it stands now" agrees with the log.
      const prog: Record<string, unknown> = {};
      for (const x of history) prog[x.question_id] = nextProgress(prog[x.question_id], x.question_id, x.correct === 1, x.ts, x.time_taken_ms);
      for (const [path, data] of [['/api/attempts', history], ['/api/progress', Object.values(prog)]] as const) {
        const saved = await context.request.post(path, { headers: { Origin: ORIGIN }, data });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      await openAnalytics(page);

      // Lowest accuracy: 20, 40, 40 (equal answers: alphabetical), 50, 83. Transitions (86%) is sixth, Rhetorical Synthesis has 3.
      const low = rows(page, 'lowest');
      await expect(low.locator('.an-name b')).toHaveText(['Words in Context', 'Boundaries', 'Percentages', 'Circles', 'Linear functions']);
      await expect(low.locator('.an-pct b')).toHaveText(['20%', '40%', '40%', '50%', '83%']);
      await expect(low.locator('.an-meta')).toHaveText(['Reading & Writing · 5 answers · 1 right', 'Reading & Writing · 5 answers · 2 right',
        'Math · 5 answers · 2 right', 'Math · 6 answers · 3 right', 'Math · 6 answers · 5 right']);
      await expect(card(page, 'lowest').locator('[data-take]')).toHaveText('Words in Context is your weakest skill: 20% over 5 answers.');

      // Slowest vs target, by percent over: Circles and Boundaries are both +50% (Circles is more seconds over), then
      // Linear functions +25%, Words in Context 225/295 = -24%, Transitions -25%. Percentages has 4 timed answers.
      const slow = rows(page, 'slowest');
      await expect(slow.locator('.an-name b')).toHaveText(['Circles', 'Boundaries', 'Linear functions', 'Words in Context', 'Transitions']);
      await expect(slow.locator('[data-avg]')).toHaveText(['2m 15s', '1m', '1m 40s', '45s', '30s']);
      await expect(slow.locator('[data-target]')).toHaveText(['target 1m 30s', 'target 40s', 'target 1m 20s', 'target 59s', 'target 40s']);
      await expect(slow.locator('[data-over]')).toHaveText(['+45s · +50%', '+20s · +50%', '+20s · +25%', '−14s · −24%', '−10s · −25%']);
      await expect(card(page, 'slowest').locator('[data-take]')).toHaveText('Circles runs 45s (50%) over target.');

      // Sections: R&W 5 + 5 + 7 + 3 = 20 answers, 2 + 1 + 6 + 0 = 9 right = 45%; Math 6 + 6 + 5 = 17, 5 + 3 + 2 = 10 = 59%.
      await expect(card(page, 'sections').locator('.an-dial-c b')).toHaveText(['45%', '59%']);
      await expect(page.locator('#analytics [data-stat="answered"] .v')).toHaveText('37');
      await expect(page.locator('#analytics [data-stat="accuracy"] .v')).toHaveText('51%');
      // Math Hard has no answers: a dash and how many more, never 0%.
      await expect(card(page, 'difficulty-Math').locator('[data-diff="Hard"]')).toContainText('answer 5 more to see this');
      await expect(page.locator('#analytics')).not.toContainText(/(?<!\d)0%/);
      await fullShot(page, 'hand-calculated-1366');

      // Phone width: same numbers, nothing wider than the screen.
      await page.setViewportSize(PHONE);
      await expect(low.locator('.an-pct b')).toHaveText(['20%', '40%', '40%', '50%', '83%']);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('#analytics *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.heat-wrap')).map(el => el.className).slice(0, 5));
      expect(overflow).toEqual([]);
      await fullShot(page, 'hand-calculated-390');
      for (const id of ['difficulty-Math', 'lowest', 'slowest']) { await card(page, id).scrollIntoViewIfNeeded(); await shot(page, `${id}-390`); }
      await page.setViewportSize({ width: 1366, height: 768 });

      // Practice → starts a Review practice set of that skill only.
      await rows(page, 'lowest').first().locator('[data-practice]').click();
      await expect(page.locator('#bank-live')).toBeVisible();
      const set = await page.evaluate(() => { const { S } = (window as any).__qa(); return { focus: S.focus, skills: [...new Set(S.items.map((q: any) => q.skill))], n: S.items.length }; });
      expect(set.focus).toBe(true);
      expect(set.skills).toEqual(['Words in Context']);
      expect(set.n).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally { await context?.close(); }
  });
});
