import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { MAP, P, fixture, student, openApp, planOf, api, saveLog, shot } from './support';

// The log form's module-2 recognition check (docs/plan/BRIEF-modules.md §3), at 1366x768. PT93 maps both module-2
// variants in both sections; PT90 maps one, so it keeps the radios. Nothing is saved until the last test.
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
const check = (sec: string) => form().locator(`.pl-check[data-route="${sec}"]`);
// A fresh form on a test (Cancel drops the open one).
async function open(testId: string) {
  if (await form().isVisible()) await page.locator('#pl-cancel').click();
  await page.locator('#plan-log').click();
  await page.locator('#pl-test').selectOption(testId);
  await page.locator('#pl-date').fill('2026-09-01');
  await page.locator('#pl-date').dispatchEvent('change');
}
// Answer the question on screen with the variant `route` (found by its question's text, never by a label).
async function pick(sec: 'RW' | 'Math', route: 'easy' | 'hard') {
  const pos = Number(await check(sec).getAttribute('data-pos'));
  const id = PT93[sec][route]![pos - 1]!;
  await check(sec).locator('.pl-ver', { hasText: id }).click();
  return pos;
}
const exportFile = (rw: string[], math: string[]) => ({ name: 'questions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([
  { id: 'reading', items: rw.map((n, i) => ({ section: 'Reading', displayNumber: String(i + 1), sequence: i, questionId: 'bb-' + n, externalId: 'ext-' + P(n), metadata: {} })) },
  { id: 'math', items: math.map((n, i) => ({ section: 'Math', displayNumber: String(i + 1), sequence: 81 + i, questionId: 'bb-' + n, externalId: 'ext-' + P(n), metadata: {} })) }])) });

test('R1 both variants mapped: each section asks which question it saw, with neutral labels; module 2 and Save wait', async () => {
  await open('PT93');
  for (const [sec, name] of [['RW', 'Reading and Writing'], ['Math', 'Math']]) {
    await expect(check(sec)).toHaveAttribute('data-pos', '3');      // the position nearest Q5 first
    await expect(check(sec).locator('.pl-ask')).toHaveText(`Which was question 3 in your second ${name} module?`);
    await expect(check(sec).locator('.pl-ver b')).toHaveText(['Version A', 'Version B']);
    await expect(form().locator(`.pl-q[data-m="${sec}2"]`)).toHaveCount(0);
  }
  await expect(form()).not.toContainText(/Easier|Harder/);
  // Opening lines only: each card is its question's stem, never a choice, answer or explanation.
  const cards = await check('RW').locator('.pl-ver span').allTextContents();
  expect(cards.sort()).toEqual([`Plan fixture ${P('t4')}: the answer is B.`, `Plan fixture ${P('t7')}: the answer is B.`]);
  await expect(page.locator('#pl-save')).toBeDisabled();
  await shot(page, '13-recognition');

  // RW: two agreeing answers settle it; the grid appears. Math is still open, so Save still waits.
  expect(await pick('RW', 'hard')).toBe(3);
  await expect(check('RW').locator('.pl-ask')).toHaveText('Which was question 2 in your second Reading and Writing module?');
  expect(await pick('RW', 'hard')).toBe(2);
  await expect(form().locator('[data-route="RW"] [data-resolved="check"]')).toBeVisible();
  await expect(form().locator('.pl-q[data-m="RW2"]')).toHaveCount(3);
  await expect(page.locator('#pl-save')).toBeDisabled();
  await pick('Math', 'easy'); await pick('Math', 'easy');
  await expect(form().locator('.pl-q[data-m="Math2"]')).toHaveCount(3);
  await expect(page.locator('#pl-save')).toBeEnabled();
  await shot(page, '14-recognition-resolved');
});

test('R2 contradicting answers ask a third position; changing the answers clears that module\'s marks', async () => {
  await open('PT93');
  await pick('RW', 'easy');
  await pick('RW', 'hard');
  await expect(check('RW')).toHaveAttribute('data-pos', '1');
  await expect(check('RW').locator('.pl-check-foot')).toContainText('Question 3 of 3');
  await expect(page.locator('#pl-save')).toBeDisabled();
  await shot(page, '15-recognition-third');
  await pick('RW', 'easy');                                        // 2 of 3 say easy
  await expect(form().locator('[data-route="RW"] [data-resolved="check"]')).toBeVisible();
  await form().locator('.pl-q[data-m="RW2"][data-n="0"]').click();
  await expect(form().locator('.pl-q[data-m="RW2"][data-n="0"]')).toHaveAttribute('data-mark', 'W');
  await form().locator('[data-route="RW"] [data-redo]').click();
  await expect(check('RW')).toHaveAttribute('data-pos', '3');
  await pick('RW', 'hard'); await pick('RW', 'hard');
  await expect(form().locator('.pl-q[data-m="RW2"][data-n="0"]')).toHaveAttribute('data-mark', '.');
});

test('R3 Not sure points to the test\'s review in Bluebook and keeps module 2 hidden until the student starts over', async () => {
  await open('PT93');
  await pick('Math', 'hard');
  await check('Math').locator('.pl-unsure').click();
  await expect(page.locator('#pl-hint-Math')).toContainText('Practice Test 93');
  await expect(page.locator('#pl-hint-Math')).toContainText('question 2 of your second Math module');
  await expect(form().locator('.pl-q[data-m="Math2"]')).toHaveCount(0);
  await expect(page.locator('#pl-save')).toBeDisabled();
  await shot(page, '16-recognition-not-sure');
  await form().locator('[data-route="Math"] [data-redo]').click();
  await expect(check('Math')).toHaveAttribute('data-pos', '3');
});

test('R4 a My Practice export settles both sections in the browser; another test is offered; a bad file is refused', async () => {
  await open('PT93');
  const posted: string[] = [];
  page.on('request', r => { if (r.method() !== 'GET') posted.push(r.url()); });
  await page.locator('#pl-file').setInputFiles(exportFile(['t1', 't5', 't6', 't7'], ['p1', 'p2', 'p3', 'p4']));
  await expect(page.locator('#pl-upload-msg')).toHaveText('Found your second Reading and Writing and Math modules in the export.');
  await expect(form().locator('[data-route="RW"] [data-resolved="file"]')).toBeVisible();
  await expect(form().locator('[data-route="Math"] [data-resolved="file"]')).toBeVisible();
  await expect(form().locator('.pl-q[data-m="RW2"]')).toHaveCount(3);
  await expect(page.locator('#pl-save')).toBeEnabled();
  await shot(page, '17-export-upload');
  expect(posted).toEqual([]);                                       // never sent anywhere

  await page.locator('#pl-file').setInputFiles({ name: 'questions.json', mimeType: 'application/json', buffer: Buffer.from('{"not": "an export"}') });
  await expect(page.locator('#pl-upload-msg')).toHaveText('This file is not a My Practice questions.json export.');

  await page.locator('#pl-file').setInputFiles(exportFile(['b1', 'c1', 'b2', 'e1'], ['a1', 'a2', 'd1', 'a3', 'd2']));
  await expect(page.locator('#pl-upload-msg')).toContainText('This export is from Practice Test 90, not the test chosen above.');
  await page.locator('#pl-switch').click();
  await expect(page.locator('#pl-test')).toHaveValue('PT90');
  await expect(page.locator('#pl-upload-msg')).toHaveText('Found your second Reading and Writing and Math modules in the export.');
});

test('R5 one variant mapped: the section keeps the radios, the unmapped one disabled', async () => {
  await open('PT90');
  await expect(form().locator('.pl-check')).toHaveCount(0);
  await expect(form().locator('[data-route="Math"] input[value="easy"]')).toBeChecked();
  await expect(form().locator('[data-route="Math"] input[value="hard"]')).toBeDisabled();
  await expect(form().locator('[data-route="RW"] input[value="hard"]')).toBeDisabled();
  await expect(page.locator('#pl-save')).toBeEnabled();
  await shot(page, '18-one-variant-radios');
});

test('R6 the recognised route is what gets logged: the taken variant is recorded, the other is not', async () => {
  await open('PT93');
  await pick('RW', 'hard'); await pick('RW', 'hard');
  await pick('Math', 'easy'); await pick('Math', 'hard'); await pick('Math', 'easy');
  await form().locator('.pl-q[data-m="RW2"][data-n="1"]').click();
  await saveLog(page);
  const log = (await planOf(context)).tests.find(t => t.testId === 'PT93');
  expect(log.route).toEqual({ RW: 'hard', Math: 'easy' });
  expect(log.marks).toEqual({ RW1: '.', RW2: '.W.', Math1: '.', Math2: '...' });
  // The attempts go through the page's retry queue after the form closes, so wait for that write to land.
  await expect.poll(async () => (await api(context, '/api/attempts')).filter(a => a.plan_step === 'test:PT93').map(a => a.question_id).sort())
    .toEqual(['t1', 't5', 't6', 't7', 'p1', 'p2', 'p3', 'p4'].map(P).sort());
});
