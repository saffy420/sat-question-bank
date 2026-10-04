import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';

// Mistakes & Saved: one page, three views (Incorrect, Saved, Both), cards with a rendered two-line teaser and a bookmark.
const STUDENT = 'e2e-student-4';
const SHOTS = 'docs/qbank/filters';
const ORIGIN = 'https://127.0.0.1:8787';
// The seeded questions, re-worded on the wire: /api/saved only accepts ids the bank has.
const EQ = 'e2e-core-math', TABLE = 'e2e-core-spr', FIG = 'e2e-fig-math', PASSAGE = 'e2e-core-rw', UNSEEN = 'e2e-split-rw';
const REWORD: Record<string, { skill: string; stem_html: string }> = {
  [EQ]: { skill: 'Linear equations in one variable', stem_html: '<p>\\(\\frac{12x+28}{4}-\\frac{s}{13}= r(x-8)\\) In the given equation, \\(s\\) and \\(r\\) are constants, and \\(s > 0\\). What is the value of \\(s\\)?</p>' },
  [TABLE]: { skill: 'Inference from sample statistics and margin of error',
    stem_html: '<div class="qtable"><table><tr><th>Talks</th><td>TABLECELL 110</td></tr></table></div><p>In a study of cell phone use, \\(799\\) teens were selected. What is \\(\\frac{110}{799}\\)?</p>' },
  [FIG]: { skill: 'Circles', stem_html: '<div class="qfig"><img src="/qimg/mk-never-fetched.png" alt="circle"></div><p>The circle above has center \\(N\\), and \\(y = 80\\). What is the length of arc \\(JKL\\)?</p><img src="/qimg/mk-never-fetched-2.png">' },
  [PASSAGE]: { skill: 'Words in Context', stem_html: '<h3>Passage</h3><p>PASSAGE_OPENING The mayfly lives only a day.</p><p>Second paragraph.</p><h3>Prompt</h3><p>Which choice completes the text with the most logical and precise word or phrase?</p>' }
};
const progress = (ids: string[], marker: string) => ids.map(question_id => ({ question_id, marker, attempts: 1, corrects: marker === 'Red' ? 0 : 1, time_taken_ms: 30000 }));
const shot = (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const saved = async (context: BrowserContext): Promise<string[]> => (await (await context.request.get('/api/saved')).json()).sort();
const unsaveAll = async (context: BrowserContext) => {
  for (const id of await saved(context)) await context.request.post('/api/saved', { data: { question_id: id, saved: false }, headers: { Origin: ORIGIN } });
};
const card = (page: Page, id: string) => page.locator(`#mk-list .mk-card[data-id="${id}"]`);
const view = (page: Page, v: string) => page.locator(`#mk-view [data-v="${v}"]`);

test('Mistakes & Saved: three views, rendered teasers, and a bookmark that moves the counts', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await newUserContext(browser, STUDENT);
  try {
    await unsaveAll(context);
    const page = await context.newPage();
    const imgs: string[] = [];
    page.on('request', r => { if (r.url().includes('mk-never-fetched')) imgs.push(r.url()); });
    await page.route('**/api/questions', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: (await res.json()).map((q: { id: string }) => ({ ...q, ...REWORD[q.id] })) });
    });
    await page.route('**/api/progress', route => route.fulfill({ json: [...progress([EQ, TABLE, PASSAGE], 'Red'), ...progress([FIG], 'Green')] }));
    await page.route('**/api/attempts', route => route.fulfill({ json: [] }));
    await page.goto('/app');
    await expect(page.locator('#user-name')).toContainText('E2E Student');
    await page.locator('[data-tab="mistakes"]').click();
    await expect(page.locator('.nav-i[data-tab="mistakes"]')).toHaveText('Mistakes & Saved');
    await expect(page.locator('#tab-mistakes')).toBeVisible();

    // Incorrect is the default; nothing is saved yet.
    await expect(view(page, 'wrong')).toHaveText('Incorrect (3)');
    await expect(view(page, 'saved')).toHaveText('Saved (0)');
    await expect(view(page, 'both')).toHaveText('Both (3)');
    await expect(page.locator('#mk-sub')).toBeVisible();
    await expect(page.locator('#mk-list .mk-card')).toHaveCount(3);

    // Math cards: LaTeX is rendered, a table's cells are not flattened into the text, no image is requested.
    const eq = card(page, EQ);
    await expect(eq.locator('.mk-stem .katex').first()).toBeVisible();
    expect(await eq.locator('.mk-stem').textContent()).not.toContain('\\(');
    await expect(eq.locator('.t-wrong')).toHaveText('Incorrect');
    await expect(eq.locator('.t-skill')).toHaveText('Linear equations in one variable');
    const tbl = card(page, TABLE);
    await expect(tbl.locator('.mk-stem .katex').first()).toBeVisible();
    expect(await tbl.locator('.mk-stem').textContent()).not.toContain('TABLECELL');
    expect(await tbl.locator('.mk-stem table, .mk-stem img').count()).toBe(0);
    // Reading and Writing: the passage opening, not the boilerplate prompt.
    const rw = card(page, PASSAGE);
    await expect(rw.locator('.mk-stem')).toContainText('PASSAGE_OPENING');
    await expect(rw.locator('.mk-stem')).toContainText('only a day. Second paragraph');
    await expect(rw.locator('.mk-stem')).not.toContainText('Which choice completes');
    // Two lines at most.
    for (const id of [EQ, TABLE, PASSAGE]) {
      const h = await card(page, id).locator('.mk-stem').evaluate(el => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
      expect(h.h).toBeLessThanOrEqual(h.lh * 2 + 1);
    }
    await shot(page, 'mistakes-saved-incorrect');

    // Bookmark from a card: no question opens, the card and every count move at once.
    const save = eq.locator('.mk-save');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(page.locator('#bank-live')).toBeHidden();
    await expect(page.locator('#view-test')).toBeHidden();
    await expect(card(page, EQ).locator('.t-saved')).toHaveText('Saved');
    await expect(card(page, EQ).locator('.mk-save')).toHaveAttribute('aria-pressed', 'true');
    await expect(view(page, 'saved')).toHaveText('Saved (1)');
    await expect(view(page, 'both')).toHaveText('Both (3)');
    await expect.poll(() => saved(context)).toEqual([EQ]);

    // Saved holds questions never answered or answered right; the dropdowns still apply.
    await context.request.post('/api/saved', { data: { question_id: FIG, saved: true }, headers: { Origin: ORIGIN } });
    await context.request.post('/api/saved', { data: { question_id: UNSEEN, saved: true }, headers: { Origin: ORIGIN } });
    await page.reload();
    await page.locator('[data-tab="mistakes"]').click();
    await expect(view(page, 'saved')).toHaveText('Saved (3)');
    await expect(view(page, 'both')).toHaveText('Both (5)');
    await view(page, 'saved').click();
    await expect(page.locator('#mk-sub')).toBeHidden();
    await expect(page.locator('#mk-list .mk-card')).toHaveCount(3);
    await expect(card(page, FIG).locator('.tag').filter({ hasText: /^Correct$/ })).toHaveCount(1);
    await expect(card(page, UNSEEN).locator('.tag').filter({ hasText: /^Not answered$/ })).toHaveCount(1);
    await expect(card(page, FIG).locator('.mk-stem')).toContainText('length of arc');
    await shot(page, 'mistakes-saved-saved');
    await view(page, 'both').click();
    await expect(page.locator('#mk-list .mk-card')).toHaveCount(5);
    // The section dropdown narrows all three views.
    await page.locator('#md-sec .dd-t').click();
    await page.locator('#md-sec .dd-o[data-v="Math"]').click();     // unticks Math
    await page.keyboard.press('Escape');
    await expect(view(page, 'both')).toHaveText('Both (2)');
    await expect(view(page, 'saved')).toHaveText('Saved (1)');
    await expect(view(page, 'wrong')).toHaveText('Incorrect (1)');

    // Unsaving from the Saved view removes the card and drops the count.
    await page.locator('#md-sec .dd-t').click();
    await page.locator('#md-sec .dd-o[data-v="Math"]').click();
    await page.keyboard.press('Escape');
    await expect(view(page, 'saved')).toHaveText('Saved (3)');
    await view(page, 'saved').click();
    await card(page, FIG).locator('.mk-save').click();
    await expect(card(page, FIG)).toHaveCount(0);
    await expect(view(page, 'saved')).toHaveText('Saved (2)');
    await expect.poll(() => saved(context)).toEqual([EQ, UNSEEN].sort());

    // Drill practises whatever is listed; the card itself opens just its question.
    await page.locator('#mk-drill').click();
    await expect(page.locator('#bank-live')).toBeVisible();
    expect((await page.evaluate(() => window.__qa().S.items.map((q: { id: string }) => q.id))).sort()).toEqual([EQ, UNSEEN].sort());
    await page.locator('#bank-dashboard').click();
    await page.locator('#bank-exit-confirm').click();
    await page.locator('[data-tab="mistakes"]').click();
    await card(page, EQ).locator('.mk-stem').click();
    await expect(page.locator('#bank-live')).toBeVisible();
    expect(await page.evaluate(() => window.__qa().S.items.map((q: { id: string }) => q.id))).toEqual([EQ]);
    expect(imgs).toEqual([]);
  } finally {
    await unsaveAll(context);
    await context.close();
  }
});
