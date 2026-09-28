import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';
import { lateJoinSet } from '../../../public/shared/lesson.js';

const artifacts = '.omp/pipeline/lessons-07-self-paced/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
// Student 6, not 1: a finished self-paced set writes practice stats (task 09), and the dashboard
// specs pin student 1's seeded stats.
const names = ['E2E Student 6', 'E2E Student 2', 'E2E Student 3', 'E2E Student 4'];
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', AI = 'e2e-ai-rw';
// Mixed limits (35 s shared clock) so a late joiner's set has to be fitted to the time left.
const ITEMS = [
  { question_id: RW, time_limit_sec: 10, notes: 'E2E_NOTES_MARKER_SELF' },
  { question_id: MATH, time_limit_sec: 10, notes: '' },
  { question_id: SPR, time_limit_sec: 5, notes: '' },
  { question_id: AI, time_limit_sec: 10, notes: '' }
];

async function room(context, items, title) {
  const created = await context.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode: 'self', items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await context.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return await started.json();
}
async function join(page, code) {
  if (!page.url().endsWith('/app')) await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  const socket = page.waitForEvent('websocket', { predicate: ws => roomSocket.test(ws.url()) });
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await socket;
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}
// The student's own countdown is the condition: two ticks guarantee at least one second on the question.
async function dwell(page, ticks = 2) {
  const clock = page.locator('#lesson-clock');
  for (let i = 0; i < ticks; i++) { const text = await clock.textContent(); await expect(clock).not.toHaveText(text); }
}
const seconds = text => { const [m, s] = text.split(':').map(Number); return m * 60 + s; };
const joinBodies = capture => capture.bodies.filter(b => b.url.endsWith('/api/lessons/join')).map(b => JSON.parse(b.body));
async function studentMs(teacher, name) {
  const row = teacher.locator('#self-group p', { hasText: name });
  return Number(await row.getAttribute('data-ms'));
}
async function screenshot(page, name) { await page.screenshot({ path: `${artifacts}/${name}.png` }); }
async function noReveal(page) {
  const content = page.locator('#lesson-content');
  await expect(content).not.toContainText('Correct answer');
  await expect(content).not.toContainText('E2E_EXPL_MARKER');
  await expect(content).not.toContainText('E2E_NOTES_MARKER');
  await expect(content.locator('.choice.right, .choice.wrong, .stage-verdict')).toHaveCount(0);
}

test('task07 self-paced run: navigation, flags, review, submit all, auto-submit, accumulated time, late join', async ({ browser }) => {
  test.setTimeout(150000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const students = [];
  try {
    const { sessionId, joinCode } = await room(admin, ITEMS, 'Task07 self');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const pages = [], captures = [];
    for (const [index, n] of [6, 2, 3].entries()) {
      const context = await newUserContext(browser, `e2e-student-${n}`); students.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, i) => i !== index) }));
      pages.push(await context.newPage());
    }
    const [one, two, late] = pages;
    await join(one, joinCode); await join(two, joinCode);
    await expect(one.locator('#lesson-content')).toContainText('Waiting for the instructor to start…');
    await screenshot(one, '01-lobby');
    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SELF-PACED SET');
    for (const userId of ['e2e-student-6', 'e2e-student-2']) await expect(teacher.locator(`[data-cell="${userId}:${RW}"]`)).toHaveAttribute('data-current', 'true');

    // 1. Next / Back / navigator / flag, and time on Q1 across two visits (checkpoint 6).
    await expect(one.locator('.lesson-header h1')).toContainText('Q 1 / 4');
    await expect(one.locator('#self-nav')).toHaveText('Question 1 of 4');
    await expect(one.locator('#self-back')).toBeDisabled();
    await expect(one.locator('#lesson-clock')).toHaveText(/^0:3\d$/);
    await dwell(one);
    await one.locator('[data-lesson-choice="A"]').click();
    await expect(one.locator('[data-lesson-choice="A"]')).toHaveAttribute('aria-pressed', 'true');
    await noReveal(one);
    await screenshot(one, '02-question');
    await one.locator('#self-next').click();
    await expect(one.locator('#self-nav')).toHaveText('Question 2 of 4');
    await teacher.locator(`[data-col="${RW}"]`).click();
    await expect(teacher.locator('#self-card [data-fact="answered"]')).toHaveText('answered 1/2 assigned');
    await teacher.locator('#self-card [data-group="0"]').click();
    await expect(teacher.locator('#self-group')).toContainText(names[0]);
    await expect.poll(() => studentMs(teacher, names[0])).toBeGreaterThanOrEqual(1000);
    const firstVisit = await studentMs(teacher, names[0]);

    await two.locator('[data-lesson-choice="D"]').click();
    await two.locator('#self-next').click();
    await expect(two.locator('#self-nav')).toHaveText('Question 2 of 4');

    await one.locator('[data-lesson-choice="C"]').click();
    await one.locator('#self-flag').click();
    await expect(one.locator('#self-flag')).toHaveAttribute('aria-pressed', 'true');
    await one.locator('#self-next').click();
    await expect(one.locator('#self-nav')).toHaveText('Question 3 of 4');
    await one.locator('#lesson-grid').fill('3');
    await one.locator('#self-back').click();
    await expect(one.locator('#self-nav')).toHaveText('Question 2 of 4');
    await expect(one.locator('[data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');
    await one.locator('#self-back').click();
    await expect(one.locator('#self-nav')).toHaveText('Question 1 of 4');
    await expect(one.locator('[data-lesson-choice="A"]')).toHaveAttribute('aria-pressed', 'true');
    await dwell(one);
    await one.locator('#self-nav').click();
    const navigator = one.locator('#self-navigator');
    await expect(navigator.locator(`[data-self-q="${RW}"]`)).toHaveAttribute('data-state', 'answered');
    await expect(navigator.locator(`[data-self-q="${MATH}"]`)).toHaveAttribute('data-flagged', 'true');
    await expect(navigator.locator(`[data-self-q="${SPR}"]`)).toHaveAttribute('data-state', 'answered');
    await expect(navigator.locator(`[data-self-q="${AI}"]`)).toHaveAttribute('data-state', 'unanswered');
    await screenshot(one, '03-navigator');
    await navigator.locator(`[data-self-q="${AI}"]`).click();
    await expect(one.locator('#self-nav')).toHaveText('Question 4 of 4');
    await expect.poll(() => studentMs(teacher, names[0])).toBeGreaterThanOrEqual(firstVisit + 1000);
    await screenshot(teacher, '07-card-accumulated-time');

    // 2–3. Review page, then the Submit all modal (Go back keeps editing; Yes locks).
    await one.locator('#self-next').click();
    const review = one.locator('#self-review');
    await expect(review).toContainText('Answered 3 of 4');
    await expect(review.locator(`[data-self-q="${MATH}"]`)).toHaveAttribute('data-flagged', 'true');
    await expect(review.locator(`[data-self-q="${AI}"]`)).toHaveAttribute('data-state', 'unanswered');
    await screenshot(one, '04-review');
    await one.locator('#self-submit').click();
    await expect(one.getByRole('dialog')).toContainText("Have you double checked your answer and made sure it's right?");
    await screenshot(one, '05-submit-modal');
    await one.locator('#self-cancel').click();
    await expect(one.getByRole('dialog')).toBeHidden();
    await review.locator(`[data-self-q="${AI}"]`).click();
    await expect(one.locator('#self-nav')).toHaveText('Question 4 of 4');
    await one.locator('[data-lesson-choice="B"]').click();
    await one.locator('#self-next').click();
    await expect(review).toContainText('Answered 4 of 4');
    await one.locator('#self-submit').click();
    await one.locator('#self-confirm').click();
    await expect(one.locator('#self-status')).toHaveText('Submitted. Waiting for the session to end.');
    await expect(one.locator('[data-lesson-choice]')).toHaveCount(0);
    await noReveal(one);
    await screenshot(one, '06-submitted');
    await expect(teacher.locator('#live-submitted')).toHaveText('Submitted 1');
    const row = (userId, id) => teacher.locator(`[data-cell="${userId}:${id}"]`);
    for (const [id, state] of [[RW, 'right'], [MATH, 'right'], [SPR, 'right'], [AI, 'wrong']]) await expect(row('e2e-student-6', id)).toHaveAttribute('data-state', state);
    await expect(row('e2e-student-2', RW)).toHaveAttribute('data-state', 'wrong');
    await expect(row('e2e-student-2', MATH)).toHaveAttribute('data-current', 'true');
    await expect(row('e2e-student-2', AI)).toHaveAttribute('data-state', 'unreached');
    await noReveal(two);

    // 7. Late join: a smaller set that fits the time the server reported, ░ in the instructor grid.
    await join(late, joinCode);
    await captures[2].flush();
    const [first] = joinBodies(captures[2]);
    const remaining = first.joinRemainingMs, ids = first.assignedQuestionIds;
    const limit = id => ITEMS.find(x => x.question_id === id).time_limit_sec * 1000;
    expect(first.lateJoin).toBe(true);
    expect(remaining).toBeGreaterThan(12000); // enough clock left that a re-join would fit a different set
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(ITEMS.length);
    const used = ids.reduce((n, id) => n + limit(id), 0);
    expect(used).toBeLessThanOrEqual(remaining);
    for (const item of ITEMS.filter(x => !ids.includes(x.question_id))) expect(item.time_limit_sec * 1000).toBeGreaterThan(remaining - used);
    expect(ids).toEqual(ITEMS.map(x => x.question_id).filter(id => ids.includes(id)));
    await expect(late.locator('.lesson-header h1')).toContainText(`Q 1 / ${ids.length}`);
    await expect(late.locator('#self-nav')).toHaveText(`Question 1 of ${ids.length}`);
    await screenshot(late, '09-late-join');
    await expect(teacher.locator('[data-student="e2e-student-3"]')).toContainText('late join');
    await expect(row('e2e-student-3', ids[0])).toHaveAttribute('data-current', 'true');
    for (const item of ITEMS) await expect(row('e2e-student-3', item.question_id)).toHaveAttribute('data-state', ids.includes(item.question_id) ? 'unreached' : 'unassigned');
    await expect(row('e2e-student-3', ITEMS.find(x => !ids.includes(x.question_id)).question_id)).toHaveText('░');
    await screenshot(teacher, '10-grid-late-join');
    await late.locator('[data-lesson-choice="B"]').click();
    await expect(row('e2e-student-3', ids[0])).not.toHaveAttribute('data-state', 'unreached');

    // 8. The stored set is not recomputed on a later re-join, even though the clock would now fit less.
    await expect.poll(async () => seconds(await late.locator('#lesson-clock').textContent()), { timeout: remaining }).toBeLessThanOrEqual(8);
    await late.locator('.lesson-more summary').click();
    await late.locator('#lesson-leave').click();
    await join(late, joinCode);
    await captures[2].flush();
    const second = joinBodies(captures[2])[1];
    expect(second.assignedQuestionIds).toEqual(ids);
    expect(second.joinRemainingMs).toBe(remaining);
    expect(lateJoinSet(ITEMS, second.endsAt - Date.now())).not.toEqual(ids);
    await expect(late.locator('#self-nav')).toHaveText(`Question 1 of ${ids.length}`);
    await expect(late.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await noReveal(late);

    // 4. Auto-submit at the shared end for a student who never pressed Submit all.
    const left = second.endsAt - Date.now();
    await expect(two.locator('#self-status')).toContainText('Time is up. Your answers were submitted automatically.', { timeout: left + 5000 });
    await expect(one.locator('#self-status')).toContainText('Set finished. Your answers were submitted.');
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    await expect(teacher.locator('#live-timer')).toContainText('—');
    await expect(row('e2e-student-2', RW)).toHaveAttribute('data-state', 'wrong');
    await expect(row('e2e-student-2', RW)).toHaveAttribute('title', /^D · /);
    const finished = await (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    expect(finished.status).toBe('review');
    expect(finished.grid['e2e-student-2'][RW][0]).toBe('D');
    expect(finished.grid['e2e-student-3'][ids[0]][0]).toBe('B');
    for (const page of pages) await noReveal(page);
    await screenshot(two, '11-auto-submitted');
    await screenshot(teacher, '12-grid-finished');

    // 5. Nothing answer-bearing reached any student channel, during the set or after it.
    for (const capture of captures) {
      await capture.flush();
      expect(capture.frames.length).toBeGreaterThan(0);
      expect(capture.violations()).toEqual([]);
    }
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SESSION ENDED');
    // Ending the session sends students back to /app (11a A5).
    await expect(one.locator('#lesson-live')).toBeHidden();
  } finally { for (const context of students.reverse()) await context.close().catch(() => {}); await admin.close().catch(() => {}); }
});

test('task07 self-paced set ends early once every joined student submitted', async ({ browser }) => {
  test.setTimeout(90000);
  const admin = await newUserContext(browser, 'e2e-admin');
  const students = [];
  try {
    const { sessionId, joinCode } = await room(admin, [{ question_id: RW, time_limit_sec: 10, notes: '' }, { question_id: SPR, time_limit_sec: 10, notes: '' }], 'Task07 early');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const pages = [];
    for (const n of [4, 3]) {
      const context = await newUserContext(browser, `e2e-student-${n}`); students.push(context);
      const page = await context.newPage(); pages.push(page);
      await join(page, joinCode);
    }
    const [four, three] = pages;
    await teacher.locator('[data-live="start"]').click();
    await four.locator('[data-lesson-choice="A"]').click();
    await four.locator('#self-next').click();
    await four.locator('#lesson-grid').fill('3');
    await four.locator('#self-next').click();
    await expect(four.locator('#self-review')).toContainText('Answered 2 of 2');
    await four.locator('#self-submit').click();
    await four.locator('#self-confirm').click();
    await expect(four.locator('#self-status')).toHaveText('Submitted. Waiting for the session to end.');
    await expect(teacher.locator('#live-submitted')).toHaveText('Submitted 1');
    await expect(teacher.locator('.live-top')).toContainText('SELF-PACED SET');
    await three.locator('#self-nav').click();
    await three.locator('#self-go-review').click();
    await expect(three.locator('#self-review')).toContainText('Answered 0 of 2');
    await three.locator('#self-submit').click();
    await three.locator('#self-confirm').click();
    for (const page of pages) await expect(page.locator('#self-status')).toContainText('Set finished. Your answers were submitted.');
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    const state = await (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    expect(state.status).toBe('review');
    expect(state.endsAt - Date.now()).toBeGreaterThan(5000);
    expect(state.grid['e2e-student-3'][RW][0]).toBeNull();
  } finally { for (const context of students.reverse()) await context.close().catch(() => {}); await admin.close().catch(() => {}); }
});
