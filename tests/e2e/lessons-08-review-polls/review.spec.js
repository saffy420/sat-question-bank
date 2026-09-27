import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';

const artifacts = '.omp/pipeline/lessons-08-review-polls/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
// Student 6, not 1: a finished self-paced set writes practice stats (task 09), and the dashboard
// specs pin student 1's seeded stats.
const names = ['E2E Student 6', 'E2E Student 2', 'E2E Student 3', 'E2E Student 4'];
const users = ['e2e-student-6', 'e2e-student-2', 'e2e-student-3', 'e2e-student-4'];
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', AI = 'e2e-ai-rw';
const KEY = { [RW]: 'A', [MATH]: 'C', [SPR]: '3', [AI]: 'A' };
// 35 s shared clock. A student joining right after start is fitted a subset (never SPR: it only
// fits with the whole clock), so per-question denominators differ.
const ITEMS = [
  { question_id: RW, time_limit_sec: 10, notes: '' },
  { question_id: MATH, time_limit_sec: 5, notes: '' },
  { question_id: SPR, time_limit_sec: 5, notes: '' },
  { question_id: AI, time_limit_sec: 15, notes: 'E2E_NOTES_MARKER_REVIEW' }
];
const ORDER = ITEMS.map(x => x.question_id);
const number = id => ORDER.indexOf(id) + 1;

async function room(context) {
  const created = await context.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `Task08 review ${Date.now()}`, mode: 'self', items: ITEMS } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await context.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return await started.json();
}
async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  const socket = page.waitForEvent('websocket', { predicate: ws => roomSocket.test(ws.url()) });
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await socket;
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}
// Answer the student's own set in order, then Submit all from the review page.
async function answerAll(page, ids, answers) {
  for (const [i, id] of ids.entries()) {
    await expect(page.locator('#self-nav')).toHaveText(`Question ${i + 1} of ${ids.length}`);
    if (id === SPR) await page.locator('#lesson-grid').fill(answers[id]);
    else await page.locator(`[data-lesson-choice="${answers[id]}"]`).click();
    await page.locator('#self-next').click();
  }
  await expect(page.locator('#self-review')).toContainText(`Answered ${ids.length} of ${ids.length}`);
  await page.locator('#self-submit').click();
  await page.locator('#self-confirm').click();
}
// Native selection + pointerup through the real instructor toolbar handler (as in task 05).
async function selectText(page, text) {
  await page.locator('#live-card .lesson-stem').evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return;
    }
    throw Error(`Fixture text missing: ${text}`);
  }, text);
}
async function screenshot(page, name) { await page.screenshot({ path: `${artifacts}/${name}.png` }); }
const options = page => page.locator('#poll-pick option').allTextContents();
const pct = x => `${Math.round(x * 100)}%`;

test('task08 overview, review polls and review mode', async ({ browser }) => {
  test.setTimeout(180000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const contexts = [];
  try {
    const { sessionId, joinCode } = await room(admin);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const pages = [], captures = [];
    for (const [n, userId] of users.entries()) {
      const context = await newUserContext(browser, userId); contexts.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, i) => i !== n) }));
      pages.push(await context.newPage());
    }
    const [one, two, three, late] = pages;
    for (const page of [one, two, three]) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SELF-PACED SET');
    await join(late, joinCode);
    await captures[3].flush();
    const lateJoin = captures[3].bodies.filter(b => b.url.endsWith('/api/lessons/join')).map(b => JSON.parse(b.body))[0];
    const lateIds = lateJoin.assignedQuestionIds;
    expect(lateJoin.lateJoin).toBe(true);
    expect(lateIds).toContain(AI);
    expect(lateIds).not.toContain(SPR);
    expect(lateIds.length).toBeLessThan(ORDER.length);

    // Answers: AI is missed by the three full-set students, RW by two; the late joiner answers A.
    const answers = {
      [users[0]]: { [RW]: 'A', [MATH]: 'C', [SPR]: '3', [AI]: 'B' },
      [users[1]]: { [RW]: 'B', [MATH]: 'C', [SPR]: '4', [AI]: 'B' },
      [users[2]]: { [RW]: 'B', [MATH]: 'D', [SPR]: '3', [AI]: 'B' },
      [users[3]]: Object.fromEntries(lateIds.map(id => [id, 'A']))
    };
    await Promise.all(pages.map((page, i) => answerAll(page, i === 3 ? lateIds : ORDER, answers[users[i]])));
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    for (const page of pages) await expect(page.locator('#self-status')).toContainText('Set finished. Your answers were submitted.');

    // 1. Overview: most-missed ranked with assigned-only denominators; class summary; student table.
    const stat = id => {
      const takers = users.filter(u => answers[u][id] !== undefined);
      return { assigned: takers.length, wrong: takers.filter(u => answers[u][id] !== KEY[id]).length };
    };
    const ranking = [...ORDER].sort((a, b) => stat(b).wrong - stat(a).wrong || ORDER.indexOf(a) - ORDER.indexOf(b));
    expect(ranking[0]).toBe(AI);
    const missed = teacher.locator('#review-missed li');
    await expect(missed).toHaveCount(ORDER.length);
    for (const [i, id] of ranking.entries()) {
      const { assigned, wrong } = stat(id);
      await expect(missed.nth(i)).toContainText(`Q${number(id)} — ${wrong} of ${assigned} wrong (${pct(wrong / assigned)})`);
    }
    expect(stat(RW).assigned).toBe(4);
    expect(stat(SPR).assigned).toBe(3);
    await expect(missed.nth(0)).toContainText('Central Ideas and Details · Hard');
    const scores = users.map(u => Object.entries(answers[u]).filter(([id, a]) => a === KEY[id]).length / Object.keys(answers[u]).length).sort((a, b) => a - b);
    await expect(teacher.locator('[data-fact="mean"]')).toHaveText(pct(scores.reduce((n, x) => n + x, 0) / 4));
    await expect(teacher.locator('[data-fact="median"]')).toHaveText(pct((scores[1] + scores[2]) / 2));
    await expect(teacher.locator('[data-fact="completed"]')).toHaveText('4 of 4');
    const lateRow = teacher.locator(`#review-students tr[data-student="${users[3]}"]`);
    await expect(lateRow.locator('[data-fact="score"]')).toHaveText(`${lateIds.filter(id => KEY[id] === 'A').length} / ${lateIds.length}`);
    await expect(lateRow.locator('td').nth(3)).toHaveText('yes');
    await teacher.locator(`#review-students tr[data-student="${users[1]}"] th button`).click();
    await expect(teacher.locator(`#review-student [data-q="${SPR}"]`)).toContainText('4');
    await expect(teacher.locator(`#review-student [data-q="${SPR}"] [aria-label="Incorrect"]`)).toHaveCount(1);
    await teacher.locator('[data-sort="score"]').click();
    await expect(teacher.locator('#review-students tbody tr').first()).toHaveAttribute('data-student', users[1]);
    await teacher.locator(`[data-missed="${AI}"]`).click();
    await expect(teacher.locator('#self-card [data-fact="answered"]')).toHaveText('answered 4/4 assigned');
    await screenshot(teacher, '01-overview');
    const before = (await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).overview;

    // 2–4. Poll: labels, option 2 needs a pick, a 2–2 split resolves to most-missed, early close.
    await teacher.locator('[data-live="startPoll"]').click();
    for (const page of pages) await expect(page.locator('#poll')).toBeVisible();
    await expect(one.locator('label', { has: one.locator('#poll-1') })).toContainText(`Q${number(AI)} (${stat(AI).wrong} people missed it)`);
    await screenshot(one, '02-poll');
    await one.locator('#poll-2').click();
    await expect(one.locator('#poll-vote')).toBeDisabled();
    await expect(one.locator('#poll-status')).toHaveText('Pick a question from the list for your vote to count.');
    await expect(teacher.locator('[data-fact="voted"]')).toHaveText('Votes 0 of 4 connected');
    expect(await options(one)).toEqual(['Choose a question…', 'Q1 ✓', 'Q2 ✓', 'Q3 ✓', 'Q4 ✗']);
    await late.locator('#poll-2').click();
    expect(await options(late)).toContain('Q3 not in your set');
    await screenshot(late, '03-poll-dropdown-late');
    await one.locator('#poll-pick').selectOption(RW);
    await one.locator('#poll-vote').click();
    await expect(one.locator('#poll-status')).toHaveText('Vote counted: Q1.');
    await two.locator('#poll-2').click();
    await two.locator('#poll-pick').selectOption(RW);
    await two.locator('#poll-vote').click();
    await three.locator('#poll-1').click();
    await three.locator('#poll-vote').click();
    await expect(teacher.locator('[data-fact="voted"]')).toHaveText('Votes 3 of 4 connected');
    await expect(teacher.locator(`#review-poll [data-pick="${RW}"]`)).toHaveText('Q1 × 2');
    await expect(teacher.locator('#review-poll [data-option="1"]')).toContainText(/\b1$/);
    await screenshot(teacher, '04-poll-instructor');
    const open = await (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    expect(open.phase).toBe('POLL');
    await late.locator('#poll-1').click();
    await late.locator('#poll-vote').click();
    for (const page of pages) await expect(page.locator('#poll-result')).toContainText(`Reviewing Q${number(AI)}`);
    await expect(teacher.locator('#review-result')).toContainText(`Reviewing Q${number(AI)}`);
    const result = (await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).pollResult;
    expect([result.questionId, result.winner, result.one, result.two]).toEqual([AI, 1, 2, 2]);
    expect(open.poll.endsAt - (result.endsAt - 3000)).toBeGreaterThan(10000); // closed early, not at 30 s
    await screenshot(one, '05-poll-result');

    // 7. Review mode: correct answer, own recorded answer, explanation; annotations sync (5).
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVIEW');
    // Review is untimed: no set clock or timer control on screen.
    for (const page of pages) { await expect(page.locator('#lesson-clock')).toHaveText(''); await expect(page.getByRole('button', { name: /timer/ })).toHaveCount(0); }
    await expect(one.locator('.lesson-reveal')).toContainText('Correct answer: A');
    await expect(one.locator('.lesson-verdict')).toContainText('Your answer: B');
    await expect(late.locator('.lesson-verdict')).toContainText('Your answer: A');
    await expect(one.locator('#lesson-card [data-lesson-choice="A"] .choice')).toHaveClass(/right/);
    await one.locator('.lesson-reveal summary').click();
    await expect(one.locator('.lesson-reveal')).toContainText('E2E_EXPL_MARKER_AI');
    await expect(teacher.locator('.instructor-drawer')).toContainText('E2E_NOTES_MARKER_REVIEW');
    await expect(teacher.locator('.response-row')).toHaveCount(4);
    await selectText(teacher, 'The team practiced every day');
    for (const page of pages) await expect(page.locator('#lesson-card [data-ann-mark]')).toHaveText('The team practiced every day');
    await screenshot(one, '06-review-annotation');
    await screenshot(teacher, '07-review-instructor');
    // 8. Reviews change no data: the recorded answer can't be changed.
    await expect(one.locator('#lesson-card [data-lesson-choice="A"]')).toBeDisabled();
    await expect(one.locator('#lesson-lock')).toHaveCount(0);

    // 6. Next → launcher; the reviewed question leaves the next poll.
    await teacher.locator('[data-live="next"]').click();
    await expect(teacher.locator('#review-summary')).toBeVisible();
    await expect(missed.filter({ has: teacher.locator(`[data-missed="${AI}"]`) })).toContainText('reviewed');
    await expect(one.locator('#self-status')).toHaveText('Waiting for the instructor to choose what to review next.');
    await teacher.locator('[data-live="startPoll"]').click();
    const next = ranking[1];
    await expect(one.locator('label', { has: one.locator('#poll-1') })).toContainText(`Q${number(next)} (${stat(next).wrong} people missed it)`);
    await one.locator('#poll-2').click();
    expect(await options(one)).toEqual(['Choose a question…', 'Q1 ✓', 'Q2 ✓', 'Q3 ✓']);
    await screenshot(one, '08-second-poll');
    for (const page of pages) { await page.locator('#poll-1').click(); await page.locator('#poll-vote').click(); }
    for (const page of pages) await expect(page.locator('#poll-result')).toContainText(`Reviewing Q${number(next)}`);
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVIEW');
    await teacher.locator('[data-live="next"]').click();

    // 9. Review a specific question skips the poll; a late joiner sees "Not in your set".
    await teacher.locator('#review-target').selectOption(SPR);
    await teacher.locator('[data-live="goto"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVIEW');
    for (const page of pages) await expect(page.locator('#poll, #poll-result')).toHaveCount(0);
    await expect(late.locator('#lesson-not-in-set')).toHaveText('Not in your set');
    await expect(two.locator('.lesson-reveal')).toContainText('Your answer: 4 · Incorrect');
    await expect(teacher.locator('.response-row')).toHaveCount(3);
    await screenshot(late, '09-review-not-in-set');
    await teacher.locator('[data-live="next"]').click();
    await expect(teacher.locator('#review-summary')).toBeVisible();

    // 8. Recorded results are unchanged by the polls and reviews.
    const after = await (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    expect(after.overview).toEqual(before);
    expect(after.reviewed).toEqual([AI, next, SPR]);
    for (const [i, userId] of users.entries()) for (const [id, answer] of Object.entries(answers[userId])) expect(after.grid[userId][id][0], `${names[i]} ${id}`).toBe(answer);

    // Nothing private reached any student: notes never; answers only for the question under review.
    for (const capture of captures) {
      await capture.flush();
      expect(capture.frames.length).toBeGreaterThan(0);
      expect(capture.violations()).toEqual([]);
    }
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SESSION ENDED');
    for (const page of pages) await expect(page.locator('#self-status')).toHaveText('Session ended.');
  } finally { for (const context of contexts.reverse()) await context.close().catch(() => {}); await admin.close().catch(() => {}); }
});
