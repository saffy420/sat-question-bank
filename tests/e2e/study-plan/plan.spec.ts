import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { STUDENT, P, SKILL, fixture, student, openApp, api, planOf, logTest, startLog, markSection, saveLog, stepTitles, setState, current, choice,
  answerSection, endSection, playNext, shot } from './support';

// Study Plan checkpoints (docs/plan/BRIEF.md), one student through three logged practice tests at 1366x768.
// Serial: each test continues from the plan the previous one left.
test.describe.configure({ mode: 'serial' });
let context: BrowserContext, page: Page;
test.beforeAll(async ({ browser }) => {
  await fixture('fixture');
  ({ context, page } = await student(browser));
});
test.afterAll(async () => { await context?.close(); await fixture('cleanup'); });

test('C1 first screen after login: with no plan, a single "Log a Bluebook practice test" button', async () => {
  await openApp(page);
  await expect(page.locator('[data-tab="plan"]')).toHaveClass(/\bon\b/);
  await expect(page.locator('#plan-empty button')).toHaveCount(1);
  await expect(page.locator('#plan-empty button')).toHaveText('Log a Bluebook practice test');
  await shot(page, '01-no-plan');
});

test('C2 logging a test: plan order with the slows tie-break; questions done; misses in the mistake log', async () => {
  await page.locator('#plan-log').click();
  // PT90. Linear functions: 2 misses. Boundaries: 1 miss + 1 slow. Words in Context: 1 miss. Rhetorical Synthesis: slow only.
  // Circles: clean. RW1 #4 has no bank question: it can be marked and counts for nothing.
  // PT90 maps one module-2 variant per section, so no "Not sure" recognition page (recognition.spec.ts covers it).
  await startLog(page, 'PT90', '2026-09-01');
  await markSection(page, 'RW', { RW1: 'WWSW', RW2: 'S' }, false);
  await expect(page.locator('.pl-q[data-m="RW1"][data-n="3"]')).toHaveAttribute('data-unmapped', '1');
  await expect(page.locator('#pl-tally-RW')).toContainText('Wrong: 3 · Slow: 2');
  await shot(page, '02-log-form');
  await page.locator('#pl-next').click();
  await markSection(page, 'Math', { Math1: 'W..', Math2: 'W.' });
  await expect(page.locator('#pl-sum')).toContainText('Wrong: 5 · Slow: 2');   // marks include the unmapped position
  await expect(page.locator('#pl-warn')).toHaveCount(0);
  await saveLog(page);
  expect(await stepTitles(page)).toEqual([
    `Drill · ${SKILL.a}`, `Drill · ${SKILL.b}`, `Drill · ${SKILL.c}`,
    `Consolidate · ${SKILL.a}`, `Consolidate · ${SKILL.b}`, `Consolidate · ${SKILL.c}`, 'Take practice test 91']);
  await expect(page.locator('#plan-next')).toHaveText(`Drill · ${SKILL.a}`);
  await expect(page.locator('#plan-slow')).toContainText(SKILL.e);
  await expect(page.locator('[data-step-row="PT90.t"] .plan-status')).toContainText('Sep 8, 2026');
  await shot(page, '03-plan');

  // Marked done through the shared record path: a Wrong is Red, a Slow (and everything unmarked) Green, tagged with the test.
  const progress = Object.fromEntries((await api(context, '/api/progress')).map(p => [p.question_id, p.marker]));
  expect(progress).toMatchObject({ [P('a1')]: 'Red', [P('a3')]: 'Red', [P('b1')]: 'Red', [P('c1')]: 'Red', [P('b2')]: 'Green', [P('e1')]: 'Green', [P('a2')]: 'Green', [P('d1')]: 'Green', [P('d2')]: 'Green' });
  const attempts = await api(context, '/api/attempts');
  expect(attempts.filter(a => a.plan_step === 'test:PT90').map(a => a.question_id).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'd1', 'd2', 'e1'].map(P).sort());
  expect(attempts.every(a => a.ts.startsWith('2026-09-01'))).toBe(true);
  await page.locator('[data-tab="mistakes"]').click();
  for (const id of ['a1', 'a3', 'b1', 'c1']) await expect(page.locator(`.mk-card[data-id="${P(id)}"] .tag.t-test`)).toHaveText('Practice Test 90');
  await expect(page.locator(`.mk-card[data-id="${P('b2')}"]`)).toHaveCount(0);
  await page.locator('[data-tab="plan"]').click();
});

let drill: string[] = [];
test('C3 the drill: 10 medium then 5 hard, never seen or untaken-test questions; no checking; soft-timer overtime recorded', async () => {
  // A question in the drilled skill the student has already seen elsewhere (here: answered in the bank).
  await context.request.post('/api/attempts', { headers: { Origin: 'https://127.0.0.1:8787' },
    data: [{ question_id: P('aseen'), ts: '2026-09-02T10:00:00.000Z', correct: 1, time_taken_ms: 30000, picked: 'B', changes: 0 }] });
  await openApp(page);
  await page.locator('#plan-start').click();
  await expect(page.locator('#bank-live')).toBeVisible();
  await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
  const st = (await setState(page))!;
  drill = st.ids;
  expect(drill).toHaveLength(15);
  const meta = await page.evaluate(ids => ids.map(id => { const q = (window as any).__qa().QS.find(x => x.id === id); return [q.skill, q.difficulty]; }), drill);
  expect(meta.slice(0, 10).every(([k, d]) => k === SKILL.a && d === 'Medium')).toBe(true);
  expect(meta.slice(10).every(([k, d]) => k === SKILL.a && d === 'Hard')).toBe(true);
  expect(drill).not.toContain(P('aseen'));
  expect(drill).not.toContain(P('ablk'));   // mapped to PT92, not logged yet
  expect(st.items).toEqual(drill.slice(0, 10));
  await expect(page.locator('#bank-segment')).toHaveText('Medium · section 1 of 2');
  await expect(page.locator('#bank-clock')).toHaveText('10:00');
  await expect(page.locator('#bank-pause')).toHaveCount(0);

  // First medium wrong (A), second left blank, the rest right. Picking never shows a Check or a verdict.
  await choice(page, 'A').click();
  await expect(page.locator('#bank-primary')).toHaveAttribute('data-mode', 'next');
  await expect(page.locator('#bank-card .choice.right, #bank-card .choice.wrong')).toHaveCount(0);
  await expect(page.locator('#bank-reveal')).toHaveCount(0);
  expect(await page.locator('#bank-live').innerText()).not.toMatch(/E2E_PLAN_EXPL|correct answer/i);
  await shot(page, '04-drill');
  await page.locator('#bank-primary').click();
  await page.locator('#bank-primary').click();       // blank
  await answerSection(page, {});                     // questions 3-10: B
  // Soft limit: past 10:00 the clock turns red and counts overtime.
  await page.clock.fastForward('10:30');
  await expect(page.locator('#bank-clock')).toHaveText(/^\+0:3\d$/);
  await expect(page.locator('#bank-clock')).toHaveCSS('color', 'rgb(189, 36, 36)');
  await shot(page, '05-overtime');
  await endSection(page);
  await expect(page.locator('#bank-segment')).toHaveText('Hard · section 2 of 2');
  await expect(page.locator('#bank-clock')).toHaveText('7:30');
  expect((await setState(page))!.items).toEqual(drill.slice(10));
  await answerSection(page, { [drill[14]]: 'A' });
  await endSection(page);

  await expect(page.locator('#plan-result')).toBeVisible();
  await expect(page.locator('#plan-score')).toHaveText('12/15');
  await expect(page.locator('#plan-result [data-seg="Medium"] .plan-over')).toHaveText(/^\+0:3\d over the limit$/);
  await expect(page.locator('#plan-result [data-seg="Hard"] .plan-in')).toBeVisible();
  await shot(page, '06-results');
  const run = (await planOf(context)).plan.steps[0].run;
  expect(run.segs[0].overMs).toBeGreaterThanOrEqual(30000);
  expect(run.segs[0].usedMs - run.segs[0].limitMs).toBe(run.segs[0].overMs);
  expect(run.segs[1].overMs).toBe(0);
  // Recorded once each through the shared path, tagged with the step; the blank is a miss on the score, not an attempt.
  const tagged = (await api(context, '/api/attempts')).filter(a => a.plan_step === 'PT90.d0');
  expect(tagged.map(a => a.question_id).sort()).toEqual(drill.filter(id => id !== drill[1]).sort());
  expect(tagged.find(a => a.question_id === drill[0]).correct).toBe(0);
});

test('C4 review: drill misses (retry until correct, then the explanation), then the original test misses', async () => {
  await page.locator('#plan-review').click();
  await expect(page.locator('#bank-live')).toBeVisible();
  const items = await page.evaluate(() => (window as any).__qa().S.items.map(q => q.id));
  // Drill misses in set order (wrong, blank, the wrong hard), then the practice-test misses in this skill.
  expect(items).toEqual([drill[0], drill[1], drill[14], P('a1'), P('a3')]);
  await choice(page, 'A').click();
  await page.locator('#bank-primary').click();       // Check: wrong, question stays open
  await expect(page.locator('#bank-status')).toBeVisible();
  await expect(page.locator('#bank-reveal')).toHaveCount(0);
  await choice(page, 'B').click();
  await page.locator('#bank-primary').click();       // Check: right, closes
  await expect(page.locator('#bank-reveal details[open]')).toContainText('E2E_PLAN_EXPL');
  // A right first try still opens the explanation in a plan review.
  for (let i = 1; i < 4; i++) {
    await page.locator('#bank-primary').click();
    await choice(page, 'B').click();
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-reveal details[open]')).toContainText('E2E_PLAN_EXPL ' + items[i]);
  }
  await shot(page, '07-review');
  const reviewed = (await api(context, '/api/attempts')).filter(a => a.plan_step === 'PT90.d0.r');
  expect(reviewed.map(a => a.question_id).sort()).toEqual(items.slice(0, 4).sort());
  await page.locator('#bank-dashboard').click();
  await page.locator('#bank-exit-confirm').click();
  await expect(page.locator('#plan-panel')).toBeVisible();
});

test('C5 "Start practicing" follows the plan order; opening a later step does not move it', async () => {
  await expect(page.locator('#plan-next')).toHaveText(`Drill · ${SKILL.b}`);
  // Open a later step out of order, answer one question and leave: it is kept in progress, the button still follows the plan.
  await page.locator('[data-step="PT90.d2"]').click();
  const notice = page.locator('#cm-yes');
  await expect(notice).toBeVisible();
  await expect(page.locator('#modal-root')).toContainText('shorter');
  await notice.click();
  await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
  await expect(page.locator('#bank-segment')).toHaveText('1 hard');
  await choice(page, 'B').click();
  await page.locator('#bank-dashboard').click();
  await page.locator('#bank-exit-confirm').click();
  await expect(page.locator('[data-step-row="PT90.d2"] .plan-status')).toContainText('In progress · 1 of 1 answered');
  await expect(page.locator('#plan-next')).toHaveText(`Drill · ${SKILL.b}`);
  // Start practicing opens Boundaries: a short pool (2 medium, 1 hard), so the set shrinks and says so.
  const ids = await playNext(page);
  expect(ids).toEqual(expect.arrayContaining([P('bm1'), P('bm2'), P('bh1')]));
  expect(ids).toHaveLength(3);
  await expect(page.locator('#plan-next')).toHaveText(`Drill · ${SKILL.c}`);
  // The step left in progress resumes with its answer.
  await page.locator('#plan-start').click();
  await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
  await expect(page.locator('#bank-card [data-lesson-choice="B"] .choice')).toHaveClass(/\bsel\b/);
  await endSection(page);
  await expect(page.locator('#plan-next')).toHaveText(`Consolidate · ${SKILL.a}`);
});

test('C6 two cycles: consolidation, next test (warned when too soon), maintenance entry; a third test sends 2 misses back to drilling and keeps 1 miss in maintenance, due', async () => {
  // Finish cycle 1: consolidation in each drilled skill.
  for (const skill of [SKILL.a, SKILL.b, SKILL.c]) {
    await expect(page.locator('#plan-next')).toHaveText(`Consolidate · ${skill}`);
    const ids = await playNext(page);
    expect(ids.every(id => !drill.slice(0, 10).includes(id))).toBe(true);
  }
  await expect(page.locator('#plan-next')).toHaveText('Take practice test 91');
  await shot(page, '08-cycle1-done');

  // Cycle 2: PT91 three days later (warned, saved). Only Boundaries missed; Circles and Rhetorical Synthesis are clean
  // for the second time running, so they enter maintenance (not due this cycle).
  await page.locator('#plan-start').click();
  await logTest(page, 'PT91', '2026-09-04', { RW1: 'W..', RW2: '.', Math1: '..', Math2: '..' }, { Math: 'hard' });
  await expect(page.locator('#pl-warn')).toContainText('3 days');
  await saveLog(page);
  expect(await stepTitles(page)).toEqual([`Drill · ${SKILL.b}`, `Consolidate · ${SKILL.b}`, 'Take practice test 92']);
  await expect(page.locator('#plan-maint')).toContainText(SKILL.d);
  await expect(page.locator('#plan-maint')).toContainText(SKILL.e);
  await expect(page.locator(`#plan-skills tr[data-skill="${SKILL.d}"]`)).toContainText('Maintenance');
  await shot(page, '09-cycle2-plan');
  for (let i = 0; i < 2; i++) await playNext(page);
  await expect(page.locator('#plan-next')).toHaveText('Take practice test 92');

  // PT92: Circles misses 2 (back to drilling), Rhetorical Synthesis misses 1 (stays in maintenance, due anyway).
  // Its questions were blocked from every set until now (the medium Linear functions one among them).
  const p = await planOf(context);
  const served = p.plan.steps.flatMap(s => s.run ? s.run.ids : []);
  expect(served).not.toContain(P('ablk'));
  await page.locator('#plan-start').click();
  await logTest(page, 'PT92', '2026-09-11', { RW1: '..', RW2: 'W', Math1: '.W', Math2: 'W.' });
  await expect(page.locator('#pl-warn')).toHaveCount(0);
  await saveLog(page);
  expect(await stepTitles(page)).toEqual([`Drill · ${SKILL.d}`, `Consolidate · ${SKILL.d}`, `Maintain · ${SKILL.e}`, 'Take practice test 93']);
  const state = await planOf(context);
  expect(state.skills[SKILL.d]).toMatchObject({ status: 'drilling', clean: 0, misses: 2 });
  expect(state.skills[SKILL.e]).toMatchObject({ status: 'maintenance', clean: 0, misses: 1 });
  expect(state.tests.map(t => t.testId)).toEqual(['PT90', 'PT91', 'PT92']);
  await shot(page, '10-cycle3-plan');
  // A phone-width screen: the plan stays readable, with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, '12-phone');
  await page.setViewportSize({ width: 1366, height: 768 });
  // Linear functions is now clean twice too, so the newly unblocked medium can only reach a later drill.
  expect(state.skills[SKILL.a]).toMatchObject({ status: 'maintenance', clean: 2 });
});

test('C7 the plan is per account: another student sees no plan', async ({ browser }) => {
  const { newUserContext } = await import('../lessons-00b-e2e-harness/auth.js');
  const other = await newUserContext(browser, 'e2e-student-2');
  try {
    const r = await other.request.get('/api/plan');
    expect((await r.json()).state?.tests?.map(t => t.testId) || []).not.toContain('PT92');
  } finally { await other.close(); }
  expect(STUDENT).toBe('e2e-student-7');
});
