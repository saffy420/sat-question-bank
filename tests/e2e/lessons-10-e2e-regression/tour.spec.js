import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN, CHROMEBOOK } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';

// Both lesson modes run the way the instructor runs them in class. Students are captured at
// 1366×768 (school Chromebooks), the instructor at 1920×1080 (the instructor's laptop, §13).
// tools/e2e_tour_compress.cjs turns these into docs/lessons/tour/.
const tour = '.omp/pipeline/lessons-10-e2e-regression/e2e/tour';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', AI = 'e2e-ai-rw';
const KEY = { [RW]: 'A', [MATH]: 'C', [SPR]: '3', [AI]: 'A' };

async function room(admin, mode, items, title) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode, items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return await started.json();
}
async function teacherPage(admin, sessionId) {
  const page = await admin.newPage();
  await page.goto(`/admin/live/${sessionId}`);
  await expect(page.locator('#live-link')).toHaveText('Connected');
  return page;
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
// Native selection + pointerup through the real instructor toolbar handler (as in tasks 05 and 08).
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
const LAPTOP = { width: 1920, height: 1080 };
async function shot(page, name) {
  expect(page.viewportSize()).toEqual(name.includes('instructor') && !name.endsWith('-1366') ? LAPTOP : CHROMEBOOK);
  await page.screenshot({ path: `${tour}/${name}.png` });
}
// Visible between the sticky header and the fixed footer, not merely inside the window.
async function onScreen(locator) {
  await expect.poll(() => locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const top = document.querySelector('.lesson-header').getBoundingClientRect().bottom;
    const bottom = document.querySelector('.lesson-footer').getBoundingClientRect().top;
    return r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1;
  })).toBe(true);
}
const settled = page => page.locator('#lesson-live').evaluate(el => new Promise(resolve => {
  const first = el.scrollTop; setTimeout(() => resolve(el.scrollTop === first), 150);
}));
async function clean(captures) {
  for (const capture of captures) {
    await capture.flush();
    expect(capture.frames.length).toBeGreaterThan(0);
    expect(capture.violations()).toEqual([]);
  }
}

test('task10 tour: instructor-paced class — lobby, answering, locked, reveal, annotations, Desmos', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(tour, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: LAPTOP });
  const contexts = [];
  try {
    const { sessionId, joinCode } = await room(admin, 'instructor', [
      { question_id: RW, time_limit_sec: 60, notes: 'E2E_NOTES_MARKER_TOUR Ask why "careful" fits.' },
      { question_id: MATH, time_limit_sec: 60, notes: '' }], 'Tour instructor-paced');
    const teacher = await teacherPage(admin, sessionId);
    const names = ['E2E Student 2', 'E2E Student 3'];
    const pages = [], captures = [];
    for (const [i, userId] of ['e2e-student-2', 'e2e-student-3'].entries()) {
      const context = await newUserContext(browser, userId); contexts.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, n) => n !== i) }));
      const page = await context.newPage(); pages.push(page);
      await join(page, joinCode);
    }
    const [one, two] = pages;

    // Lobby.
    await expect(one.locator('#lesson-content')).toContainText('Waiting for the instructor to start…');
    await expect(teacher.locator('#live-roster')).toContainText(names[1]);
    await shot(one, '01-paced-student-lobby');
    await shot(teacher, '02-paced-instructor-lobby');

    // Answering: a selection shows on the instructor's response list, never its correctness.
    await teacher.locator('[data-live="start"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');
    await one.locator('[data-lesson-choice="B"]').click();
    await two.locator('[data-lesson-choice="A"]').click();
    await expect(one.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(teacher.locator('#body')).toContainText('Responses · 2/2 in');
    await shot(one, '03-paced-student-answering');

    // Locked: the confirmation, then a disabled question and no correctness.
    await one.locator('#lesson-lock').click();
    await expect(one.getByRole('dialog')).toContainText("Have you double checked your answer and made sure it's right?");
    await shot(one, '04-paced-student-lock-confirm');
    await one.locator('#lesson-confirm').click();
    await expect(one.locator('#lesson-content')).toContainText('Answer locked in. Waiting for time to end…');
    await expect(one.locator('[data-lesson-choice="A"]')).toBeDisabled();
    await expect(one.locator('#lesson-content')).not.toContainText('Correct answer');
    // A student on a long passage sees the confirmation without scrolling.
    await onScreen(one.locator('.lesson-locked'));
    await shot(one, '05-paced-student-locked');
    await expect(teacher.locator('[data-response="e2e-student-2"]')).toContainText('lockedB');
    await shot(teacher, '06-paced-instructor-answering');

    // Reveal: correctness, the class chart, the instructor's distribution.
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect(one.locator('[data-lesson-choice="B"] .choice')).toHaveClass(/wrong/);
    await expect(one.locator('[data-lesson-choice="A"] .choice')).toHaveClass(/right/);
    await expect(one.locator('#lesson-content')).toContainText('Correct answer: A');
    await onScreen(one.locator('.lesson-verdict'));
    await shot(one, '07-paced-student-reveal');
    await teacher.locator('#live-class').check();
    await expect(one.locator('#lesson-content')).toContainText('Class results');
    await expect(one.locator('#lesson-content')).not.toContainText(names[1]);
    await onScreen(one.locator('.lesson-results'));
    await shot(one, '08-paced-student-class-results');
    await shot(teacher, '09-paced-instructor-reveal');
    await teacher.locator('#live-class').uncheck();

    // Annotations: highlight and strike from the instructor land on both students.
    await selectText(teacher, 'Which word best completes');
    await teacher.locator('[data-tool="strike"]').click();
    await selectText(teacher, 'The club made');
    for (const page of pages) {
      await expect(page.locator('#lesson-card [data-ann-mark]')).toHaveText(['Which word best completes', 'The club made']);
      await expect(page.locator('#lesson-card [data-ann-mark]', { hasText: 'The club made' })).toHaveCSS('text-decoration-line', 'line-through');
    }
    await teacher.locator('[data-tool="highlight"]').click();
    // Follow me brings the instructor's marks on screen (smooth scroll: wait for it to settle).
    await expect.poll(() => settled(two)).toBe(true);
    await onScreen(two.locator('#lesson-card [data-ann-mark]').last());
    await shot(two, '10-paced-student-annotations');
    await shot(teacher, '11-paced-instructor-annotations');

    // Desmos: the instructor's graph appears read-only in the student panel after the reveal.
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');
    await one.locator('[data-lesson-choice="C"]').click();
    await two.locator('[data-lesson-choice="D"]').click();
    await expect(teacher.locator('#body')).toContainText('Responses · 2/2 in');
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVEALED');
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await teacher.locator('#live-desmos .dcg-new-expression').click();
    await teacher.keyboard.type('y=2x+3');
    for (const page of pages) await expect(page.locator('#lesson-desmos .dcg-expressionlist')).toContainText('2x+3');
    // Wait until the line is plotted (its row gets a colour icon), not just listed.
    for (const page of pages) await expect(page.locator('#lesson-desmos .dcg-expressionitem', { hasText: '2x+3' }).locator('.dcg-colored-icon')).toBeVisible();
    await expect(teacher.locator('#live-desmos .dcg-expressionitem', { hasText: '2x+3' }).locator('.dcg-colored-icon')).toBeVisible();
    await expect(teacher.locator('#live-card .lesson-stem')).toBeVisible();
    await shot(one, '12-paced-student-desmos');
    await shot(teacher, '13-paced-instructor-desmos');

    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('#body')).toContainText('ENDED');
    await clean(captures);
  } finally { for (const context of contexts) await context.close(); await admin.close(); }
});

// 60 s shared clock: room for the screenshots, and a student joining after the start still
// gets a fitted, smaller set. The set ends early once everyone has submitted.
const ITEMS = [
  { question_id: RW, time_limit_sec: 20, notes: '' },
  { question_id: MATH, time_limit_sec: 10, notes: '' },
  { question_id: SPR, time_limit_sec: 10, notes: '' },
  { question_id: AI, time_limit_sec: 20, notes: 'E2E_NOTES_MARKER_TOUR_SELF' }
];
const ORDER = ITEMS.map(x => x.question_id);

async function answer(page, id, value) {
  if (id === SPR) await page.locator('#lesson-grid').fill(value);
  else await page.locator(`[data-lesson-choice="${value}"]`).click();
}

test('task10 tour: self-paced class — set, grid, submit, overview, poll, review, My Lessons', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(tour, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: LAPTOP });
  const contexts = [];
  // Not student 1 (dashboard specs pin its stats) nor 6 (task 09 pins its stats around an
  // instructor-paced lesson): a finished self-paced set writes practice stats.
  const users = ['e2e-student-2', 'e2e-student-3', 'e2e-student-4'];
  const names = ['E2E Student 2', 'E2E Student 3', 'E2E Student 4'];
  try {
    const { sessionId, joinCode } = await room(admin, 'self', ITEMS, 'Tour self-paced');
    const teacher = await teacherPage(admin, sessionId);
    const pages = [], captures = [];
    for (const [i, userId] of users.entries()) {
      const context = await newUserContext(browser, userId); contexts.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, n) => n !== i) }));
      pages.push(await context.newPage());
    }
    const [lead, peer, late] = pages;
    await join(lead, joinCode); await join(peer, joinCode);
    await expect(lead.locator('#lesson-content')).toContainText('Waiting for the instructor to start…');
    await shot(lead, '14-self-student-lobby');

    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SELF-PACED SET');
    await join(late, joinCode);
    await captures[2].flush();
    const lateIds = captures[2].bodies.filter(b => b.url.endsWith('/api/lessons/join')).map(b => JSON.parse(b.body))[0].assignedQuestionIds;
    expect(lateIds.length).toBeLessThan(ORDER.length);

    // Answering inside the set: navigator with a flag, no correctness anywhere.
    await expect(lead.locator('#self-nav')).toHaveText('Question 1 of 4');
    await answer(lead, RW, 'A');
    await lead.locator('#self-flag').click();
    await expect(lead.locator('#self-flag')).toHaveAttribute('aria-pressed', 'true');
    await expect(lead.locator('#lesson-content')).not.toContainText('Correct answer');
    await lead.locator('[data-lesson-choice="A"]').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await shot(lead, '15-self-student-answering');
    await lead.locator('#self-nav').click();
    await expect(lead.locator(`#self-navigator [data-self-q="${RW}"]`)).toHaveAttribute('data-flagged', 'true');
    await shot(lead, '16-self-student-navigator');
    await lead.locator('#self-nav').click();

    // Instructor grid: current question per student, ░ for the late joiner's unassigned ones.
    const unassigned = ORDER.find(id => !lateIds.includes(id));
    await expect(teacher.locator(`[data-cell="e2e-student-4:${unassigned}"]`)).toHaveText('░');
    await expect(teacher.locator(`[data-cell="e2e-student-2:${RW}"]`)).toHaveAttribute('data-current', 'true');
    await shot(teacher, '17-self-instructor-grid');
    // The same grid on a Chromebook-sized instructor screen.
    await teacher.setViewportSize(CHROMEBOOK);
    await expect(teacher.locator(`[data-cell="e2e-student-4:${unassigned}"]`)).toBeInViewport();
    await shot(teacher, '17b-self-instructor-grid-1366');
    await teacher.setViewportSize(LAPTOP);

    // Everyone answers; AI is the most-missed question. Student 6 finishes from the review page.
    const answers = {
      'e2e-student-2': { [RW]: 'A', [MATH]: 'C', [SPR]: '3', [AI]: 'B' },
      'e2e-student-3': { [RW]: 'B', [MATH]: 'C', [SPR]: '4', [AI]: 'B' },
      'e2e-student-4': Object.fromEntries(lateIds.map(id => [id, id === AI ? 'C' : KEY[id]]))
    };
    await lead.locator('#self-next').click();
    for (const [i, id] of ORDER.slice(1).entries()) {
      await expect(lead.locator('#self-nav')).toHaveText(`Question ${i + 2} of 4`);
      await answer(lead, id, answers['e2e-student-2'][id]);
      await lead.locator('#self-next').click();
    }
    await expect(lead.locator('#self-review')).toContainText('Answered 4 of 4');
    await shot(lead, '18-self-student-review-page');
    await lead.locator('#self-submit').click();
    await expect(lead.getByRole('dialog')).toContainText("Have you double checked your answer and made sure it's right?");
    await shot(lead, '19-self-student-submit-modal');
    await lead.locator('#self-confirm').click();
    for (const [page, userId, ids] of [[peer, 'e2e-student-3', ORDER], [late, 'e2e-student-4', lateIds]]) {
      for (const [i, id] of ids.entries()) {
        await expect(page.locator('#self-nav')).toHaveText(`Question ${i + 1} of ${ids.length}`);
        await answer(page, id, answers[userId][id]);
        await page.locator('#self-next').click();
      }
      await page.locator('#self-submit').click();
      await page.locator('#self-confirm').click();
    }

    // Overview after the set: most-missed first.
    const aiTakers = lateIds.includes(AI) ? 3 : 2;
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    for (const page of pages) await expect(page.locator('#self-status')).toContainText('Set finished. Your answers were submitted.');
    await shot(lead, '20-self-student-set-finished');
    await expect(teacher.locator('#review-missed li').first()).toContainText(`Q${ORDER.indexOf(AI) + 1} — ${aiTakers} of ${aiTakers} wrong`);
    await shot(teacher, '21-self-instructor-overview');

    // Poll → review of the winner, with an instructor highlight synced to students.
    await teacher.locator('[data-live="startPoll"]').click();
    for (const page of pages) await expect(page.locator('#poll')).toBeVisible();
    await lead.locator('#poll-2').click();
    await lead.locator('#poll-pick').selectOption(AI);
    await shot(lead, '22-self-student-poll');
    await lead.locator('#poll-vote').click();
    await expect(lead.locator('#poll-status')).toHaveText(`Vote counted: Q${ORDER.indexOf(AI) + 1}.`);
    await shot(teacher, '23-self-instructor-poll');
    for (const page of [peer, late]) { await page.locator('#poll-1').click(); await page.locator('#poll-vote').click(); }
    for (const page of pages) await expect(page.locator('.lesson-phase')).toHaveText('REVIEW');
    await expect(lead.locator('.lesson-verdict')).toContainText('Your answer: B');
    await expect(lead.locator('.lesson-reveal')).toContainText('Correct answer: A');
    await selectText(teacher, 'The team practiced every day');
    for (const page of pages) await expect(page.locator('#lesson-card [data-ann-mark]')).toHaveText('The team practiced every day');
    await shot(lead, '24-self-student-review');
    await shot(teacher, '25-self-instructor-review');

    // End; the session opens in My Lessons.
    await teacher.locator('[data-live="next"]').click();
    await expect(teacher.locator('#review-summary')).toBeVisible();
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await contexts[0].request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await clean(captures);
    await lead.goto('/app');
    await expect(lead.locator('#user-name')).toContainText('E2E Student 2');
    await lead.locator('.nav-i[data-tab="lessons"]').click();
    const row = lead.locator(`#lessons-table tr[data-session="${sessionId}"]`);
    await expect(row.locator('td').nth(3)).toHaveText('Self-paced');
    await expect(row.locator('td').nth(4)).toHaveText('3 / 4');
    await shot(lead, '26-my-lessons-list');
    await row.click();
    await expect(lead.locator('#lesson-card[data-ready]')).toBeVisible();
    await expect(lead.locator('#history-verdict')).toHaveText('Your answer: A');
    await expect(lead.locator('.history-header h1')).toBeInViewport();
    await shot(lead, '27-my-lessons-history');
    // Q4: the missed question, with the highlight saved from the review.
    for (let i = 0; i < 3; i++) await lead.locator('#history-next').click();
    await expect(lead.locator('#history-verdict')).toHaveText('Your answer: B');
    await expect(lead.locator('#history-correct')).toHaveText('Correct answer: A');
    await expect(lead.locator('#lesson-card [data-ann-mark]')).toHaveText('The team practiced every day');
    await lead.locator('#history-verdict').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await shot(lead, '28-my-lessons-history-missed');
  } finally { for (const context of contexts) await context.close(); await admin.close(); }
});
