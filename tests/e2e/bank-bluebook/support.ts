import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// bank-bluebook: the practice player on the lesson-ui screen. Seeded questions (tools/e2e_core.sql), in bank order:
//   e2e-core-rw   MC, answer A, explanation marker E2E_EXPL_MARKER_RW     e2e-core-math  MC, answer C
//   e2e-core-spr  grid-in, answer 3, marker E2E_EXPL_MARKER_SPR           e2e-fig-math   MC with the scatterplot figure
export const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', FIG = 'e2e-fig-math';
export const SHOTS = 'docs/lessons/bank-bluebook';
export const shot = (page, name, options = {}) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png`, ...options }); };
export const SIZES = { '1366x768': { width: 1366, height: 768 }, '1920x1080': { width: 1920, height: 1080 } };

// The practice player with the default set (every seeded question, bank order), or Math only.
export async function startPractice(page, { math = false } = {}) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('[data-tab="practice"]').click();
  if (math) {
    await page.locator('#dd-sec .dd-t').click();
    // From "Both sections" a pick toggles that section off: untick Reading & Writing to leave Math.
    await page.locator('#dd-sec .dd-o[data-v="Reading & Writing"]').click();
    await page.keyboard.press('Escape');
  }
  await page.locator('#btn-start').click();
  await expect(page.locator('#bank-live')).toBeVisible();
  await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
}
export const current = page => page.evaluate(() => { const { S } = window.__qa(); return S.items[S.i].id; });
export async function goTo(page, id) {
  for (let k = 0; k < 12 && await current(page) !== id; k++) {
    await page.locator('#bank-primary').click();
    await expect(page.locator('#bank-card[data-ready="true"]')).toBeVisible();
  }
  expect(await current(page)).toBe(id);
}
export const primary = page => page.locator('#bank-primary');
export const choice = (page, letter) => page.locator(`#bank-card [data-lesson-choice="${letter}"]`);
export const choiceBox = (page, letter) => page.locator(`#bank-card [data-lesson-choice="${letter}"] .choice`);

// Attempts written since `before` (a snapshot of "question_id|ts" keys), for the given questions.
export const snapshot = async student => (await (await student.request.get('/api/attempts')).json()).map(x => `${x.question_id}|${x.ts}`);
export async function attemptsSince(student, before, ids) {
  const all = await (await student.request.get('/api/attempts')).json();
  return all.filter(x => !before.includes(`${x.question_id}|${x.ts}`) && ids.includes(x.question_id));
}
export async function progressOf(student, id) { return (await (await student.request.get('/api/progress')).json()).find(x => x.question_id === id); }

// Everything that would answer the open question, anywhere on the screen or in what "Copy for AI" exports.
export async function expectNoLeak(page, { marker, answerText } = {}) {
  await expect(page.locator('#bank-card .choice.right')).toHaveCount(0);
  await expect(page.locator('#bank-reveal')).toHaveCount(0);
  await expect(page.locator('#bank-show-explanation')).toHaveCount(0);
  const html = await page.locator('#bank-live').evaluate(el => el.innerHTML);
  const text = await page.locator('#bank-live').evaluate(el => el.innerText);
  if (marker) { expect(html, 'explanation text in the DOM').not.toContain(marker); expect(text).not.toContain(marker); }
  expect(text, 'a "Correct answer" line').not.toMatch(/correct answer/i);
  expect(text, 'an explanation heading').not.toMatch(/official explanation/i);
  if (answerText) expect(html).not.toContain(answerText);
}
export async function exportedText(page) {
  await page.locator('#bank-live .lesson-more summary').click();
  await page.locator('#bank-export').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  await page.locator('#bank-live .lesson-more summary').click();
  return text;
}
