import { expect, request as pwRequest } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ORIGIN, newUserContext } from '../lessons-00b-e2e-harness/auth.js';

// Study Plan (docs/plan/BRIEF.md). /api/e2e/plan (src/index.e2e.js) adds the e2e-plan-* questions and wipes
// e2e-student-7's history; this map ties three fixture practice tests to them. Every fixture answer is B.
export const STUDENT = 'e2e-student-7';
export const P = (n: string) => 'e2e-plan-' + n;
const ids = (...n: (string | null)[]) => n.map(x => x && P(x));
export const MAP = { tests: [
  { id: 'PT90', number: 90, name: 'Practice Test 90',
    RW: { m1: ids('b1', 'c1', 'b2', null), easy: ids('e1'), hard: null },
    Math: { m1: ids('a1', 'a2', 'd1'), easy: ids('a3', 'd2'), hard: null } },
  { id: 'PT91', number: 91, name: 'Practice Test 91',
    RW: { m1: ids('b3', 'c2', 'e2'), easy: ids('b4'), hard: null },
    Math: { m1: ids('a4', 'd3'), easy: ids('a5', 'd4'), hard: ids('a5', 'd4') } },
  { id: 'PT92', number: 92, name: 'Practice Test 92',
    RW: { m1: ids('b5', 'c3'), easy: ids('e3'), hard: null },
    Math: { m1: ids('ablk', 'd5'), easy: ids('d6', 'a6'), hard: null } },
  // Both module-2 variants mapped in both sections: the log form asks the recognition check (recognition.spec.ts).
  { id: 'PT93', number: 93, name: 'Practice Test 93',
    RW: { m1: ids('t1'), easy: ids('t2', 't3', 't4'), hard: ids('t5', 't6', 't7') },
    Math: { m1: ids('p1'), easy: ids('p2', 'p3', 'p4'), hard: ids('p5', 'p6', 'p7') } }
] };
// public/practice-tests-ext.json for the map above (bank ID -> College Board externalId), read when an export is uploaded.
export const EXT = Object.fromEntries(MAP.tests.flatMap(t => (['RW', 'Math'] as const).flatMap(s =>
  (['m1', 'easy', 'hard'] as const).flatMap(m => (t[s][m] || []) as (string | null)[]))).filter(Boolean).map(id => [id, 'ext-' + id]));
export const SKILL = { a: 'Linear functions', b: 'Boundaries', c: 'Words in Context', d: 'Circles', e: 'Rhetorical Synthesis' };

export const SHOTS = 'docs/plan/screens';
export const shot = (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png` }); };

export async function fixture(action: 'fixture' | 'cleanup') {
  const api = await pwRequest.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    const r = await api.post('/api/e2e/plan', { headers: { Origin: ORIGIN }, data: { action } });
    expect(r.status(), await r.text()).toBe(200);
  } finally { await api.dispose(); }
}

// The student with the fixture map served in place of public/practice-tests.json, and a clock the spec can move.
export async function student(browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newUserContext(browser, STUDENT);
  await context.route('**/practice-tests.json', route => route.fulfill({ json: MAP }));
  await context.route('**/practice-tests-ext.json', route => route.fulfill({ json: EXT }));
  const page = await context.newPage();
  await page.clock.install();
  return { context, page };
}
export async function openApp(page: Page) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student 7');
  await expect(page.locator('#tab-plan')).toBeVisible();
  await expect(page.locator('#plan-body .panel').first()).toBeVisible();
}
export const api = async (context: BrowserContext, path: string) => (await (await context.request.get(path)).json());
export const planOf = async (context: BrowserContext) => (await api(context, '/api/plan')).state;

// Log a test: marks maps a module key (RW1, RW2, Math1, Math2) to its marks string ('.', 'W', 'S' per question).
export async function logTest(page: Page, testId: string, date: string, marks: Record<string, string>, route: Record<string, string> = {}) {
  const form = page.locator('#plan-log-form');
  await expect(form).toBeVisible();
  await page.locator('#pl-test').selectOption(testId);
  await page.locator('#pl-date').fill(date);
  await page.locator('#pl-date').dispatchEvent('change');
  // Only for sections the form offers as radios (one variant mapped); recognition.spec.ts covers the check.
  for (const [sec, r] of Object.entries(route)) await form.locator(`[data-route="${sec}"] input[value="${r}"]`).check();
  for (const [key, s] of Object.entries(marks)) {
    for (let n = 0; n < s.length; n++) {
      const clicks = s[n] === 'W' ? 1 : s[n] === 'S' ? 2 : 0;
      for (let k = 0; k < clicks; k++) await form.locator(`.pl-q[data-m="${key}"][data-n="${n}"]`).click();
      if (clicks) await expect(form.locator(`.pl-q[data-m="${key}"][data-n="${n}"]`)).toHaveAttribute('data-mark', s[n]);
    }
  }
}
export async function saveLog(page: Page) {
  await page.locator('#pl-save').click();
  await expect(page.locator('#plan-panel')).toBeVisible();
}
export const stepTitles = (page: Page) => page.locator('#plan-steps .plan-st b').allTextContents();
export const setState = (page: Page) => page.evaluate(() => { const { S } = (window as any).__qa(); return S && S.set ? { ids: S.set.run.ids, seg: S.set.run.seg, items: S.items.map(q => q.id) } : null; });
export const current = (page: Page) => page.evaluate(() => { const { S } = (window as any).__qa(); return S.items[S.i].id; });
export const choice = (page: Page, letter: string) => page.locator(`#bank-card [data-lesson-choice="${letter}"]`);

// Answer the questions on screen (answers by question ID; default B, '' leaves it blank) to the end of the section.
export async function answerSection(page: Page, answers: Record<string, string> = {}) {
  const n = (await setState(page))!.items.length;
  const from = await page.evaluate(() => (window as any).__qa().S.i);
  for (let i = from; i < n; i++) {
    await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
    const id = await current(page);
    const a = answers[id] ?? 'B';
    if (a) { await choice(page, a).scrollIntoViewIfNeeded(); await choice(page, a).click(); }
    await expect(page.locator('#bank-primary')).not.toHaveAttribute('data-mode', 'check');
    if (i < n - 1) await page.locator('#bank-primary').click();
  }
}
export async function endSection(page: Page) {
  await page.locator('#bank-primary').click();
  await expect(page.locator('#bank-end-dialog')).toBeVisible();
  await page.locator('#bank-end-confirm').click();
}

// Play whatever "Start practicing" opens to its end: notices accepted, every answer B. Returns the set's question IDs
// (empty when the step had no questions left and was marked done).
export async function playNext(page: Page): Promise<string[]> {
  await page.locator('#plan-start').click();
  const modal = page.locator('#cm-yes');
  await expect(modal.or(page.locator('#bank-live:not(.hide) #bank-card[data-ready="true"]'))).toBeVisible();
  if (await modal.isVisible()) {
    const empty = /no questions left/i.test(await page.locator('#modal-root').innerText());
    await modal.click();
    if (empty) { await expect(page.locator('#plan-panel')).toBeVisible(); return []; }
  }
  const set = (await setState(page))!;
  for (;;) {
    const st = (await setState(page))!;
    await answerSection(page);
    const last = st.seg === (await page.evaluate(() => (window as any).__qa().S.set.run.segs.length)) - 1;
    await endSection(page);
    if (last) break;
  }
  await expect(page.locator('#plan-result')).toBeVisible();
  return set.ids;
}
