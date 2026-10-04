import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { RW, MATH, SPR, goTo } from '../bank-bluebook/support';

// qbank-home: the Question Bank tab as a React island (lesson-ui/qbank/BankHome.tsx).
// Seeded bank (tools/e2e_core.sql): 9 questions over a handful of skills.
const SHOTS = 'docs/lessons/qbank-home';
const shot = (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const SIZES = { '1366x768': { width: 1366, height: 768 }, '1920x1080': { width: 1920, height: 1080 } };
const STUDENT = 'e2e-student-4';

// The full College Board taxonomy (4 + 10 Reading and Writing rows, 4 + 19 Math rows), for the fit check.
const TAXONOMY: [string, string, string[]][] = [
  ['Reading & Writing', 'Information and Ideas', ['Central Ideas and Details', 'Inferences', 'Command of Evidence']],
  ['Reading & Writing', 'Craft and Structure', ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections']],
  ['Reading & Writing', 'Expression of Ideas', ['Rhetorical Synthesis', 'Transitions']],
  ['Reading & Writing', 'Standard English Conventions', ['Boundaries', 'Form, Structure, and Sense']],
  ['Math', 'Algebra', ['Linear equations in one variable', 'Linear functions', 'Linear equations in two variables', 'Systems of two linear equations in two variables', 'Linear inequalities in one or two variables']],
  ['Math', 'Advanced Math', ['Equivalent expressions', 'Nonlinear equations in one variable', 'Nonlinear functions']],
  ['Math', 'Problem-Solving and Data Analysis', ['Ratios, rates, proportional relationships, and units', 'Percentages', 'One-variable data: Distributions and measures of center and spread', 'Two-variable data: Models and scatterplots', 'Probability and conditional probability', 'Inference from sample statistics and margin of error', 'Evaluating statistical claims: Observational studies and experiments']],
  ['Math', 'Geometry and Trigonometry', ['Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles']]
];

async function openHome(page: Page) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator('#bank-home .qb-cols')).toBeVisible();
}
const matching = async (page: Page) => Number(await page.locator('#start-count [data-matching]').getAttribute('data-matching'));
const questions = (n: number) => `${n.toLocaleString()} question${n === 1 ? '' : 's'}`;

test('question bank home: layout, selection, Review and Start', async ({ browser }) => {
  const context = await newUserContext(browser, STUDENT);
  try {
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await openHome(page);

    // No stat cards, no "Topics" heading, no Section dropdown, no greeting on this tab.
    await expect(page.locator('#home-stats, #topic-list, #dd-sec')).toHaveCount(0);
    await expect(page.locator('#tab-practice').getByRole('heading', { name: 'Topics' })).toHaveCount(0);
    await expect(page.locator('.board-h')).toBeHidden();
    await expect(page.locator('#tab-practice')).not.toContainText('Focus');

    // Reading and Writing on the left, Math on the right.
    const rw = await page.locator('#bank-home .qb-col[data-section="Reading & Writing"]').boundingBox();
    const math = await page.locator('#bank-home .qb-col[data-section="Math"]').boundingBox();
    expect(rw!.x + rw!.width).toBeLessThanOrEqual(math!.x);
    expect(Math.abs(rw!.y - math!.y)).toBeLessThan(1);

    // Clicking a skill's name selects the whole row: aria-pressed and the blue background, and the count narrows.
    const all = await matching(page);
    const skill = page.locator('#bank-home .qb-skill').first();
    const name = await skill.getAttribute('data-skill');
    await expect(skill).toHaveAttribute('aria-pressed', 'false');
    await skill.locator('.qb-name').click();
    await expect(skill).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0); // off the row: hover is its own, darker state
    await expect.poll(() => skill.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(232, 239, 255)');
    await expect(skill.locator('.qb-check')).toHaveAttribute('data-state', 'on');
    const one = await page.evaluate(n => window.__qa().QS.filter((q: { skill?: string }) => q.skill === n).length, name);
    await expect(page.locator('#start-count')).toContainText(`1 skill · ${questions(one)}`);
    await expect(page.locator('#btn-start')).toHaveText(`Practice ${one}`);
    expect(one).toBeLessThan(all);
    // Un-picking the last skill is every topic again.
    await skill.click();
    await expect(skill).toHaveAttribute('aria-pressed', 'false');
    expect(await matching(page)).toBe(all);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satq_filters') || '{}').skills)).toBeNull();

    // A domain row selects every skill under it.
    const domain = page.locator('#bank-home .qb-col[data-section="Math"] .qb-dom').first();
    await domain.click();
    await expect(domain).toHaveAttribute('aria-pressed', 'true');
    await expect(domain.locator('.qb-check')).toHaveAttribute('data-state', 'on');
    await expect(page.locator('#bank-home .qb-col[data-section="Math"] .qb-sec .qb-check')).toHaveAttribute('data-state', /on|part/);
    const domSkills = await page.evaluate(d => [...new Set(window.__qa().QS.filter((q: { domain?: string }) => q.domain === d).map((q: { skill?: string }) => q.skill))], await domain.getAttribute('data-domain'));
    for (const s of domSkills) await expect(page.locator(`#bank-home .qb-skill[data-skill="${s}"]`)).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'home-domain-picked');
    await domain.click();
    await expect(page.locator('#bank-home .qb-row[aria-pressed="true"]')).toHaveCount(0);

    // A section header selects the whole section; Start practice opens the player on exactly that set.
    await page.locator('#bank-home .qb-sec[data-section="Math"]').click();
    const mathIds = await page.evaluate(() => window.__qa().QS.filter((q: { section: string }) => q.section === 'Math').map((q: { id: string }) => q.id));
    await expect(page.locator('#start-count')).toContainText(questions(mathIds.length));
    await page.locator('#qb-count').click();
    await page.locator('#bank-home [data-opt="count"][data-v="0"]').click();
    await expect(page.locator('#qb-count')).toContainText('Questions: All');
    await page.locator('#btn-start').click();
    await expect(page.locator('#bank-live')).toBeVisible();
    expect((await page.evaluate(() => window.__qa().S.items.map((q: { id: string }) => q.id))).sort()).toEqual([...mathIds].sort());
    await page.locator('#bank-dashboard').click();
    await page.locator('#bank-exit-confirm').click();
    await expect(page.locator('#view-home')).toBeVisible();

    // Review replaces Focus: the segment, the button and the modal.
    await page.locator('[data-tab="practice"]').click();
    await page.locator('#bank-home .qb-seg [data-mode="focus"]').click();
    await expect(page.locator('#bank-home .qb-seg [data-mode="focus"]')).toHaveText('Review');
    await expect(page.locator('#btn-start')).toHaveText('Start review set');
    await page.locator('#btn-start').click();
    await expect(page.locator('#modal-root .fx-h')).toHaveText('Review practice');
    await expect(page.locator('#modal-root [data-go]')).toHaveText('Start review set');
    await shot(page, 'home-review-modal');
    await page.locator('#modal-root [data-x]').click();
    await page.locator('#bank-home .qb-seg [data-mode="all"]').click();
    await expect(page.locator('#btn-start')).toHaveText(/^Practice [\d,]+$/);

    // One row of filter chips, no Filters popover; each chip shows its value; Reset filters ends the row.
    await expect(page.locator('#qb-filters')).toHaveCount(0);
    for (const [key, label] of [['diff', 'Difficulty'], ['bank', 'Question set'], ['lesson', 'Lesson questions'], ['bluebook', 'Bluebook tests'], ['timeSpent', 'Time spent'], ['result', 'Result'], ['saved', 'Saved'], ['completed', 'Completed']])
      await expect(page.locator(`#bank-home .qb-chips [data-filter="${key}"]`)).toHaveText(label);
    await expect(page.locator('#qb-reset')).toBeDisabled();
    await page.locator('#qb-diff').click();
    await page.locator('#bank-home [data-opt="diff"][data-v="Medium"]').click();
    await page.locator('#bank-home [data-opt="diff"][data-v="Hard"]').click();
    await expect(page.locator('#qb-diff')).toContainText('Difficulty: Medium, Hard');
    await page.locator('#qb-f-bank').click();
    await page.locator('#bank-home [data-opt="bank"][data-v="ai"]').click();
    await expect(page.locator('#bank-home [data-filter="bank"]')).toContainText('Question set: AI');
    await expect(page.locator('#qb-reset')).toBeEnabled();
    const ai = await page.evaluate(() => window.__qa().QS.filter((q: { ai?: boolean; section: string; difficulty?: string }) => q.ai && q.section === 'Math' && q.difficulty !== 'Easy').length);
    await expect.poll(() => matching(page)).toBe(ai);
    await shot(page, 'home-filters');
    await page.locator('#qb-reset').click();
    await expect(page.locator('#qb-diff')).toHaveText('Difficulty');
    await expect(page.locator('#qb-reset')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bank-home .qb-pop')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`question bank home fits ${size} with every topic and no scroll`, async ({ browser }) => {
    const context = await newUserContext(browser, STUDENT, { viewport });
    try {
      const page = await context.newPage();
      await openHome(page);
      // The seed has a few skills; add one question per skill of the full taxonomy and redraw.
      await page.evaluate(tax => {
        const { QS } = window.__qa();
        tax.forEach(([section, domain, skills]) => skills.forEach((skill, i) =>
          QS.push({ id: `fit-${section}-${skill}`, section, domain, skill, difficulty: ['Easy', 'Medium', 'Hard'][i % 3], choices: [], stem_html: '', explanation_html: '' })));
      }, TAXONOMY);
      await page.locator('#qb-order').click();
      await page.locator('#bank-home [data-opt="order"][data-v="false"]').click();
      // Every taxonomy row is drawn, plus any fixture skill outside it (the seed has one), which only makes the fit harder.
      for (const [section, domain, skills] of TAXONOMY) {
        const col = page.locator(`#bank-home .qb-col[data-section="${section}"]`);
        await expect(col.locator(`.qb-dom[data-domain="${domain}"]`)).toHaveCount(1);
        for (const s of skills) await expect(col.locator(`.qb-skill[data-skill="${s}"]`)).toHaveCount(1);
      }
      expect(await page.locator('#bank-home .qb-col[data-section="Reading & Writing"] .qb-row').count()).toBeGreaterThanOrEqual(1 + 4 + 10);
      expect(await page.locator('#bank-home .qb-col[data-section="Math"] .qb-row').count()).toBeGreaterThanOrEqual(1 + 4 + 19);
      await page.locator('#bank-home .qb-skill[data-skill="Inferences"]').click();

      const fit = await page.evaluate(() => {
        const board = document.querySelector('.board-b')!;
        const rows = [...document.querySelectorAll('#bank-home .qb-row')].map(r => r.getBoundingClientRect());
        return {
          doc: document.scrollingElement!.scrollHeight, inner: innerHeight,
          board: board.scrollHeight, boardClient: board.clientHeight,
          lowest: Math.max(...rows.map(r => r.bottom)), shortest: Math.min(...rows.map(r => r.height))
        };
      });
      expect(fit.doc).toBeLessThanOrEqual(fit.inner);
      expect(fit.board).toBeLessThanOrEqual(fit.boardClient);
      expect(fit.lowest).toBeLessThanOrEqual(fit.inner);
      expect(fit.shortest).toBeGreaterThanOrEqual(22);
      await shot(page, `home-${size}`);
    } finally { await context.close(); }
  });
}

test('combined filter chips change counts and Saved only opens the flagged question', async ({ browser }) => {
  const context = await newUserContext(browser, STUDENT);
  const clearSaved = async () => {
    for (const id of await (await context.request.get('/api/saved')).json()) {
      const res = await context.request.post('/api/saved', { headers: { Origin: ORIGIN }, data: { question_id: id, saved: false } });
      expect(res.status()).toBe(200);
    }
  };
  try {
    await clearSaved();
    const page = await context.newPage();
    await page.route('**/practice-tests.json', route => route.fulfill({ json: { tests: [{ RW: { m1: [RW] } }] } }));
    await page.route('**/api/attempts', route => route.fulfill({ json: [] }));
    await page.route('**/api/progress', route => route.fulfill({ json: [
      { question_id: RW, marker: 'Green', attempts: 1, corrects: 1, time_taken_ms: 10000 },
      { question_id: MATH, marker: 'Red', attempts: 1, corrects: 0, time_taken_ms: 90000 },
      { question_id: SPR, marker: 'Orange', attempts: 2, corrects: 1, time_taken_ms: 25000 }
    ] }));
    await openHome(page);
    const all = await matching(page);
    expect(all).toBeGreaterThan(3);
        await page.locator('[data-filter="bluebook"]').click();
    await page.getByRole('radiogroup', { name: 'Bluebook tests' }).getByRole('radio', { name: 'Only', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(1);
    await page.getByRole('radiogroup', { name: 'Bluebook tests' }).getByRole('radio', { name: 'Hide', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(all - 1);
    await page.locator('#qb-reset').click();
    await page.locator('[data-filter="timeSpent"]').click();
    await page.getByRole('slider', { name: 'Longest time' }).focus();
    await page.keyboard.press('Home');
    await expect.poll(() => matching(page)).toBe(1);
    await page.locator('#qb-reset').click();
    await page.locator('[data-filter="result"]').click();
    await page.getByRole('radio', { name: 'Correct only', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(1);
    await page.getByRole('radio', { name: 'Incorrect only', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(2);
    // Completed: hide the three with a marker; with Result: Correct only nothing is left, and the combination is allowed.
    await page.locator('[data-filter="completed"]').click();
    await page.getByRole('radio', { name: 'Hide completed', exact: true }).click();
    await expect(page.locator('[data-filter="completed"]')).toContainText('Completed: Hide completed');
    await expect.poll(() => matching(page)).toBe(0);
    await expect(page.locator('#btn-start')).toBeDisabled();
    await expect(page.locator('#bank-home .qb-empty').first()).toBeVisible();
    await page.locator('[data-filter="result"]').click();
    await page.getByRole('radio', { name: 'All', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(all - 3);
    await page.locator('#qb-reset').click();
    await expect.poll(() => matching(page)).toBe(all);
    await page.keyboard.press('Escape');
    await page.locator('#btn-start').click();
    await goTo(page, RW);
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/saved' && r.request().method() === 'POST');
    await page.locator('#bank-card #stage-flag').click();
    expect((await saved).status()).toBe(200);
    await page.locator('#bank-dashboard').click();
    await page.locator('#bank-exit-confirm').click();
    await page.locator('[data-tab="practice"]').click();
    await page.locator('[data-filter="saved"]').click();
    await page.getByRole('radio', { name: 'Saved only', exact: true }).click();
    await expect.poll(() => matching(page)).toBe(1);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('[data-tab="practice"]').click();
    await expect.poll(() => matching(page)).toBe(1);
    await page.locator('#btn-start').click();
    await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
    expect(await page.evaluate(() => window.__qa().S.items.map((q: { id: string }) => q.id))).toEqual([RW]);
    await expect(page.locator('#bank-card #stage-flag')).toHaveAttribute('aria-pressed', 'true');
  } finally { await clearSaved(); await context.close(); }
});

declare global { interface Window { __qa: () => any } }
