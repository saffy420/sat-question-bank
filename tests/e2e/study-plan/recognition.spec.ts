import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { MAP, P, fixture, student, openApp, planOf, api, startLog, markSection, saveLog, stepTitles, shot } from './support';

// The log-a-test popup (docs/plan/BRIEF-log-modal.md), at 1366x768: page 1 builds up (test, then the second Reading
// and Writing module, then Math), "Not sure" opens a recognition page per section, then the wrong answers per section
// and the goal page. PT93 maps both module-2 variants in both sections; PT90 maps one. Nothing is saved until P6.
test.describe.configure({ mode: 'serial' });
let context: BrowserContext, page: Page;
test.beforeAll(async ({ browser }) => {
  await fixture('fixture');
  ({ context, page } = await student(browser));
  await openApp(page);
});
test.afterAll(async () => { await context?.close(); await fixture('cleanup'); });

const PT93 = MAP.tests.find(t => t.id === 'PT93')!;
const form = () => page.locator('#plan-log-form');
const onPage = (name: string) => expect(form()).toHaveAttribute('data-page', name);
const opt = (sec: string, c: string) => form().locator(`[data-route="${sec}"] .lg-opt[data-choice="${c}"]`);
const check = (sec: string) => form().locator(`.pl-check[data-route="${sec}"]`);
// A fresh popup (the close button drops an open one).
async function open() {
  if (await form().count()) await page.locator('#pl-cancel').click();
  await page.locator('#plan-log').click();
  await onPage('start');
}
// Answer the recognition question on screen with the variant `route` (found by its question's text, never by a label).
async function pick(sec: 'RW' | 'Math', route: 'easy' | 'hard') {
  const pos = Number(await check(sec).getAttribute('data-pos'));
  await check(sec).locator('.pl-ver', { hasText: PT93[sec][route]![pos - 1]! }).click();
  return pos;
}
const exportFile = (rw: string[], math: string[]) => ({ name: 'questions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([
  { id: 'reading', items: rw.map((n, i) => ({ section: 'Reading', displayNumber: String(i + 1), sequence: i, questionId: 'bb-' + n, externalId: 'ext-' + P(n), metadata: {} })) },
  { id: 'math', items: math.map((n, i) => ({ section: 'Math', displayNumber: String(i + 1), sequence: 81 + i, questionId: 'bb-' + n, externalId: 'ext-' + P(n), metadata: {} })) }])) });

test('P1 page 1 builds up: the test, then the second Reading and Writing module, then Math, then Next', async () => {
  await open();
  await expect(form().locator('.lg-q')).toHaveCount(0);
  await expect(page.locator('#pl-next')).toHaveCount(0);
  await shot(page, '13-log-popup-start');
  await page.locator('#pl-test').selectOption('PT93');
  await expect(form().locator('[data-route="RW"] .lg-qt')).toHaveText('Which second Reading and Writing module did you get?');
  await expect(form().locator('[data-route="RW"] .lg-opt b')).toHaveText(['Easy', 'Hard', 'Not sure']);
  await expect(form().locator('[data-route="Math"]')).toHaveCount(0);
  await opt('RW', 'hard').click();
  await expect(opt('RW', 'hard')).toHaveAttribute('aria-checked', 'true');
  await expect(form().locator('[data-route="Math"] .lg-qt')).toHaveText('Which second Math module did you get?');
  await expect(page.locator('#pl-next')).toHaveCount(0);
  await opt('Math', 'unsure').click();
  await expect(page.locator('#pl-next')).toBeVisible();
  await expect(form().locator('.lg-kicker')).toHaveText('Step 1 of 5');            // start, check-Math, marks x2, details
  await shot(page, '14-log-popup-modules');
  // Phone width: the popup becomes a bottom sheet with one option per row, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  const box = (await form().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, '20-log-popup-phone');
  await page.setViewportSize({ width: 1366, height: 768 });
});

test('P2 Not sure: one recognition page per section; a split asks a third question; then the marks pages', async () => {
  await open();
  await page.locator('#pl-test').selectOption('PT93');
  await opt('RW', 'unsure').click(); await opt('Math', 'unsure').click();
  await page.locator('#pl-next').click();
  await onPage('check-RW');
  await expect(check('RW')).toHaveAttribute('data-pos', '3');                         // the position nearest Q5 first
  await expect(check('RW').locator('.pl-ver b')).toHaveText(['Version A', 'Version B']);
  const cards = await check('RW').locator('.pl-ver span').allTextContents();          // opening lines only
  expect(cards.sort()).toEqual([`Plan fixture ${P('t4')}: the answer is B.`, `Plan fixture ${P('t7')}: the answer is B.`]);
  await expect(page.locator('#pl-next')).toHaveCount(0);
  await shot(page, '15-log-popup-check');
  await pick('RW', 'hard'); await pick('RW', 'hard');
  await expect(form().locator('[data-resolved="check"]')).toContainText('You had the Hard second Reading and Writing module.');
  await page.locator('#pl-next').click();
  await onPage('check-Math');
  await pick('Math', 'easy'); await pick('Math', 'hard');
  await expect(check('Math')).toHaveAttribute('data-pos', '1');
  await expect(check('Math').locator('.lg-foot-note')).toContainText('Question 3 of 3');
  await pick('Math', 'easy');
  await expect(form().locator('[data-resolved="check"]')).toContainText('Easy');
  await page.locator('#pl-next').click();
  await onPage('marks-RW');
  await expect(form().locator('.lg-instr > b')).toHaveText('Click the number of every question you got wrong.');
  await expect(form().locator('.lg-mod h4')).toHaveText(['Module 1', 'Module 2 Hard']);
  await expect(form().locator('.pl-q[data-m="RW2"]')).toHaveCount(3);
  await form().locator('.pl-q[data-m="RW2"][data-n="0"]').click();
  await page.locator('#pl-back').click();
  await onPage('check-Math');
  await expect(form().locator('[data-resolved="check"]')).toBeVisible();              // answers kept going back
  // Re-tapping the chosen "Not sure" on page 1 changes nothing: the checks and the module-2 marks stay.
  await page.locator('#pl-back').click(); await page.locator('#pl-back').click();
  await onPage('start');
  await opt('RW', 'unsure').click();
  await page.locator('#pl-next').click(); await page.locator('#pl-next').click(); await page.locator('#pl-next').click();
  await onPage('marks-RW');
  await expect(form().locator('.pl-q[data-m="RW2"][data-n="0"]')).toHaveAttribute('data-mark', 'W');
});

test('P3 Not sure on the recognition page points to the test\'s review in Bluebook; Next waits until it is matched', async () => {
  await open();
  await page.locator('#pl-test').selectOption('PT93');
  await opt('RW', 'easy').click(); await opt('Math', 'unsure').click();
  await page.locator('#pl-next').click();
  await onPage('check-Math');
  await pick('Math', 'hard');
  await check('Math').locator('.pl-unsure').click();
  await expect(page.locator('#pl-hint-Math')).toContainText('Practice Test 93');
  await expect(page.locator('#pl-hint-Math')).toContainText('question 2 of your second Math module');
  await expect(page.locator('#pl-next')).toHaveCount(0);
  await shot(page, '16-log-popup-not-sure');
  await form().locator('[data-redo]').click();
  await expect(check('Math')).toHaveAttribute('data-pos', '3');
});

test('P4 a My Practice export fills page 1 in the browser; another test is offered; a bad file is refused', async () => {
  await open();
  const posted: string[] = [];
  const watch = r => { if (r.method() !== 'GET') posted.push(r.url()); };
  page.on('request', watch);
  await page.locator('#pl-file').setInputFiles(exportFile(['t1', 't5', 't6', 't7'], ['p1', 'p2', 'p3', 'p4']));
  await expect(page.locator('#pl-test')).toHaveValue('PT93');
  await expect(page.locator('#pl-upload-msg')).toHaveText('Found your second Reading and Writing and Math modules in the export.');
  await expect(opt('RW', 'hard')).toHaveAttribute('aria-checked', 'true');
  await expect(opt('Math', 'easy')).toHaveAttribute('aria-checked', 'true');
  await expect(form().locator('[data-resolved="file"]')).toHaveCount(2);
  await expect(page.locator('#pl-next')).toBeVisible();
  await shot(page, '17-log-popup-export');
  page.off('request', watch);
  expect(posted).toEqual([]);                                                         // never sent anywhere

  await page.locator('#pl-file').setInputFiles({ name: 'questions.json', mimeType: 'application/json', buffer: Buffer.from('{"not": "an export"}') });
  await expect(page.locator('#pl-upload-msg')).toHaveText('This file is not a My Practice questions.json export.');
  await page.locator('#pl-file').setInputFiles(exportFile(['b1', 'c1', 'b2', 'e1'], ['a1', 'a2', 'd1', 'a3', 'd2']));
  await expect(page.locator('#pl-upload-msg')).toContainText('This export is from Practice Test 90, not the test chosen above.');
  await page.locator('#pl-switch').click();
  await expect(page.locator('#pl-test')).toHaveValue('PT90');
  await expect(opt('RW', 'easy')).toHaveAttribute('aria-checked', 'true');
});

test('P5 one variant mapped: the other and Not sure cannot be picked', async () => {
  await open();
  await page.locator('#pl-test').selectOption('PT90');
  await expect(opt('RW', 'hard')).toBeDisabled();
  await expect(opt('RW', 'unsure')).toBeDisabled();
  await opt('RW', 'easy').click();
  await expect(opt('Math', 'hard')).toBeDisabled();
  await expect(opt('Math', 'unsure')).toBeDisabled();
  await expect(opt('Math', 'hard')).toContainText('Not mapped yet');
});

test('P6 the last page: goal, scores, SAT date and emphasis; Create plan saves them and puts that subject first', async () => {
  await open();
  await startLog(page, 'PT93', '2026-09-01', { RW: 'hard', Math: 'easy' });
  // Transitions (RW) misses 2, Percentages (Math) 1: balanced would drill Transitions first.
  await markSection(page, 'RW', { RW1: 'W', RW2: '.W.' });
  await markSection(page, 'Math', { Math2: 'W..' });
  await onPage('details');
  await expect(form().locator('.lg-kicker')).toHaveText('Step 4 of 4');
  await page.locator('#pl-goal').fill('1450');
  await page.locator('#pl-score-RW').fill('655');
  await page.locator('#pl-score-Math').fill('700');
  await page.locator('#pl-sat').selectOption('2026-12-05');
  await expect(page.locator('#pl-sat-days')).toContainText('days away');
  await form().locator('.lg-seg-b[data-emph="Math"]').click();
  await expect(form().locator('.lg-seg-b[data-emph="Math"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#pl-save').click();
  await expect(page.locator('#pl-error')).toHaveText('Your Reading and Writing score must be a multiple of 10 from 200 to 800.');
  await page.locator('#pl-score-RW').fill('650');
  await expect(page.locator('#pl-total')).toHaveText('1350');
  await expect(page.locator('#pl-save')).toHaveText('Create plan');
  await shot(page, '18-log-popup-details');
  await saveLog(page);

  const st = await planOf(context);
  expect(st.profile).toEqual({ goal: 1450, satDate: '2026-12-05', emphasis: 'Math' });
  const log = st.tests.find(t => t.testId === 'PT93');
  expect(log.route).toEqual({ RW: 'hard', Math: 'easy' });
  expect(log.score).toEqual({ RW: 650, Math: 700 });
  expect(log.marks).toEqual({ RW1: 'W', RW2: '.W.', Math1: '.', Math2: 'W..' });
  expect((await stepTitles(page)).filter(t => t.startsWith('Drill'))).toEqual(['Drill · Percentages', 'Drill · Transitions']);
  await expect(page.locator('#plan-goal')).toContainText('Goal 1450 · Last test 1350 · SAT Dec 5, 2026');
  await expect(page.locator('#plan-goal')).toContainText('Math first');
  await shot(page, '19-plan-with-goal');
  // The attempts go through the page's retry queue after the popup closes, so wait for that write to land.
  await expect.poll(async () => (await api(context, '/api/attempts')).filter(a => a.plan_step === 'test:PT93').map(a => a.question_id).sort())
    .toEqual(['t1', 't5', 't6', 't7', 'p1', 'p2', 'p3', 'p4'].map(P).sort());
});
