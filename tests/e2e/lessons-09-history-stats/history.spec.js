import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';

const artifacts = '.omp/pipeline/lessons-09-history-stats/e2e';
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr';
const NOTE = 'E2E_NOTES_MARKER_HISTORY';
const pad = id => String(id).padStart(5, '0');
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });

async function room(admin, mode, items, title) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode, items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
}
async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student 6');
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}
async function teacherPage(admin, sessionId) {
  const page = await admin.newPage();
  await page.goto(`/admin/live/${sessionId}`);
  await expect(page.locator('#live-link')).toHaveText('Connected');
  return page;
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
const record = async context => ({ progress: await (await context.request.get('/api/progress')).json(), attempts: await (await context.request.get('/api/attempts')).json() });
const history = (context, id) => context.request.get(`/api/lesson-history/${id}`);
// "Lesson questions" is a three-way choice; clicking an option makes it the only one.
async function usage(page, value) {
  await page.locator('#dd-lesson .dd-t').click();
  await page.locator(`#dd-lesson .dd-o[data-v="${value}"]`).click();
  await page.locator('#tab-practice .panel-h h3').first().click();
}

test('task09 My Lessons, usage badges and filter, self-paced write-back, instructor-paced isolation', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const six = await newUserContext(browser, 'e2e-student-6');
  const leaks = captureLeaks(six, { phaseAware: true });
  try {
    const student = await six.newPage();
    const before = await record(six);

    // A. Instructor-paced: a wrong answer, a highlight and a graph in review, notes as the Breakdown.
    const paced = await room(admin, 'instructor', [
      { question_id: MATH, time_limit_sec: 60, notes: `${NOTE} **Add** the two numbers first.` },
      { question_id: RW, time_limit_sec: 60, notes: '' }], 'Task09 paced');
    let teacher = await teacherPage(admin, paced.sessionId);
    await join(student, paced.joinCode);
    // 6. Nothing opens before the session has ended.
    expect((await history(six, paced.sessionId)).status()).toBe(404);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await student.locator('[data-lesson-choice="A"]').click();
    await expect(teacher.locator('[data-response="e2e-student-6"]')).toContainText('A');
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    await selectText(teacher, 'What is');
    await expect(student.locator('#lesson-card [data-ann-mark]')).toHaveText('What is');
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await teacher.locator('#live-desmos .dcg-new-expression').click();
    await teacher.keyboard.type('y=4242x');
    await expect(student.locator('#lesson-desmos .dcg-expressionlist')).toContainText('4242');
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await student.locator('[data-lesson-choice="B"]').click();
    await expect(teacher.locator('[data-response="e2e-student-6"]')).toContainText('B');
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    expect((await history(six, paced.sessionId)).status()).toBe(404);
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await history(six, paced.sessionId)).status()).toBe(200);
    // 5. An instructor-paced wrong answer changes no practice record.
    expect(await record(six)).toEqual(before);
    await teacher.close();

    // B. Self-paced: a wrong answer is written back to the practice record, tagged with the session.
    const self = await room(admin, 'self', [{ question_id: RW, time_limit_sec: 30, notes: '' }, { question_id: SPR, time_limit_sec: 30, notes: '' }], 'Task09 self');
    teacher = await teacherPage(admin, self.sessionId);
    await join(student, self.joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#self-nav')).toHaveText('Question 1 of 2');
    await student.locator('[data-lesson-choice="B"]').click();
    await student.locator('#self-next').click();
    await student.locator('#lesson-grid').fill('3');
    await student.locator('#self-next').click();
    await expect(student.locator('#self-review')).toContainText('Answered 2 of 2');
    await student.locator('#self-submit').click();
    await student.locator('#self-confirm').click();
    await expect(student.locator('#self-status')).toContainText('Set finished');
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    // Written at set completion (G6), but the history only opens at the final end.
    const written = (await record(six)).attempts.filter(x => x.lesson_session_id === self.sessionId);
    expect(written.map(x => [x.question_id, x.picked, x.correct])).toEqual([[RW, 'B', 0], [SPR, '3', 1]]);
    expect((await history(six, self.sessionId)).status()).toBe(404);
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SESSION ENDED');
    await expect(student.locator('#self-status')).toHaveText('Session ended.');
    await leaks.flush();
    expect(leaks.frames.length).toBeGreaterThan(0);
    expect(leaks.violations()).toEqual([]);
    // Leaving a finished lesson reloads the record, so the mistake shows without a page reload.
    await student.locator('.lesson-more summary').click();
    await student.locator('#lesson-leave').click();
    await student.locator('.nav-i[data-tab="mistakes"]').click();
    const card = student.locator(`#mk-list .mk-card[data-id="${RW}"]`);
    // 4. The self-paced mistake is in the mistake log, tagged with its session.
    await expect(card.locator('.t-lesson')).toHaveText(`Lesson ${pad(self.sessionId)}`);
    await expect(card.locator('.t-wrong')).toHaveText('Incorrect');
    await shot(student, '01-mistakes-lesson-tag');
    const after = await record(six);
    expect(after.progress.find(x => x.question_id === RW).marker).toBe('Red');
    expect(after.attempts.filter(x => x.lesson_session_id === paced.sessionId)).toEqual([]);

    // 1. My Lessons: the list, then the instructor-paced session question by question.
    await student.locator('.nav-i[data-tab="lessons"]').click();
    const rows = student.locator('#lessons-table tbody tr');
    await expect(rows.first().locator('td').first()).toHaveText(pad(self.sessionId));
    await expect(student.locator(`#lessons-table tr[data-session="${paced.sessionId}"] td`).nth(0)).toHaveText(pad(paced.sessionId));
    await expect(student.locator(`#lessons-table tr[data-session="${paced.sessionId}"] td`).nth(3)).toHaveText('Instructor-paced');
    await expect(student.locator(`#lessons-table tr[data-session="${paced.sessionId}"] td`).nth(4)).toHaveText('0 / 2');
    await expect(student.locator(`#lessons-table tr[data-session="${self.sessionId}"] td`).nth(4)).toHaveText('1 / 2');
    await expect(student.locator('#lessons-table tr[data-session="900003"]')).toHaveCount(1);
    await shot(student, '02-my-lessons');
    await student.locator(`#lessons-table tr[data-session="${paced.sessionId}"]`).click();
    await expect(student.locator('#lesson-live')).toBeVisible();
    await expect(student.locator('.history-header h1')).toHaveText(`Lesson ${pad(paced.sessionId)} · ${(await (await six.request.get(`/api/lesson-history/${paced.sessionId}`)).json()).title}`);
    await expect(student.locator('#lesson-card[data-ready]')).toBeVisible();
    await expect(student.locator('#history-verdict')).toHaveText('Your answer: A');
    await expect(student.locator('#history-correct')).toHaveText('Correct answer: C');
    await expect(student.locator('#lesson-card [data-lesson-choice="C"] .choice')).toHaveClass(/right/);
    await expect(student.locator('#lesson-card [data-lesson-choice="A"] .choice')).toHaveClass(/wrong/);
    await expect(student.locator('#history-explanation')).toContainText('E2E_EXPL_MARKER_MATH');
    await expect(student.locator('.history-breakdown h2')).toHaveText('Breakdown');
    await expect(student.locator('#history-breakdown')).toContainText(`${NOTE} Add the two numbers first.`);
    await expect(student.locator('#history-breakdown strong')).toHaveText('Add');
    await expect(student.locator('#lesson-card [data-ann-mark]')).toHaveText('What is');
    await expect(student.locator('#lesson-desmos .dcg-expressionlist')).toContainText('4242');
    await expect(student.locator('#lesson-desmos-fork')).toHaveCount(0);
    await shot(student, '03-history-math-annotation-desmos');
    await student.locator('#history-next').click();
    await expect(student.locator('.lesson-position')).toHaveText('Question 2 · 2 of 2');
    await expect(student.locator('#history-verdict')).toHaveText('Your answer: B');
    await expect(student.locator('#history-correct')).toHaveText('Correct answer: A');
    await expect(student.locator('.history-breakdown')).toContainText('No breakdown for this question.');
    await expect(student.locator('#lesson-desmos')).toHaveCount(0);
    await shot(student, '04-history-rw');
    await student.locator('#history-close').click();
    await expect(student.locator('#lesson-live')).toBeHidden();

    // 2. Badges list the padded session IDs, oldest first.
    const bank = await (await six.request.get('/api/questions')).json();
    const used = Object.fromEntries(bank.map(q => [q.id, q.usedInLesson]));
    expect(used[RW].slice(-2)).toEqual([pad(paced.sessionId), pad(self.sessionId)]);
    expect(used['e2e-used-mine']).toEqual(['900003']);
    await student.locator('.nav-i[data-tab="browse"]').click();
    await expect(student.locator(`#browse-body tr[data-id="${RW}"] .t-used`)).toHaveText(`Lesson ${used[RW].join(', ')}`);
    await expect(student.locator('#browse-body tr[data-id="e2e-used-mine"] .t-used')).toHaveText('Lesson 900003');
    await expect(student.locator('#browse-body tr[data-id="e2e-unused"] .t-used')).toHaveCount(0);
    await shot(student, '05-browse-badges');

    // 3. Each filter option hides exactly the right questions.
    const attended = new Set((await (await six.request.get('/api/lesson-history')).json()).attended);
    expect(attended.has('900003') && !attended.has('900004')).toBe(true);
    const expected = {
      'show-all': bank,
      'hide-attended': bank.filter(q => !q.usedInLesson.some(id => attended.has(id))),
      'hide-all': bank.filter(q => !q.usedInLesson.length)
    };
    await student.locator('.nav-i[data-tab="practice"]').click();
    for (const [mode, label, topics] of [
      ['hide-attended', 'Hide questions from lessons I attended', { Transitions: 0, 'Rhetorical Synthesis': 1, Boundaries: 1 }],
      ['hide-all', 'Hide all lesson questions', { Transitions: 0, 'Rhetorical Synthesis': 0, Boundaries: 1 }],
      ['show-all', 'Show all', { Transitions: 1, 'Rhetorical Synthesis': 1, Boundaries: 1 }]]) {
      await usage(student, mode);
      await expect(student.locator('#dd-lesson .dd-val')).toHaveText(label);
      await expect(student.locator('#start-count')).toHaveText(`${expected[mode].length} matching questions`);
      for (const [skill, n] of Object.entries(topics)) await expect(student.locator(`#topic-list .tl-row[data-s="${skill}"]`)).toHaveCount(n);
      const skills = [...new Set(expected[mode].map(q => q.skill))].sort();
      expect((await student.locator('#topic-list .tl-row').evaluateAll(rows => rows.map(r => r.dataset.s))).sort()).toEqual(skills);
      await shot(student, `06-filter-${mode}`);
    }

    // 7. The instructor sees the session tag in Mistakes and both sessions in the Lessons tab.
    const dash = await admin.newPage();
    await dash.goto('/admin');
    await dash.locator('[data-id="e2e-student-6"]').click();
    await dash.getByRole('tab', { name: 'Mistakes', exact: true }).click();
    await expect(dash.locator('#mistakes .mistake-row').filter({ has: dash.locator(`[data-question="${RW}"]`) })).toContainText(`Lesson ${pad(self.sessionId)}`);
    await dash.getByRole('tab', { name: 'Lessons', exact: true }).click();
    const lessonRow = id => dash.locator('#student-lessons tbody tr').filter({ has: dash.locator('td:first-child', { hasText: pad(id) }) });
    await expect(lessonRow(self.sessionId).locator('td')).toHaveText([pad(self.sessionId), /^Task09 self/, 'Self-paced', /.+/, '1 / 2 (50%)', 'Yes']);
    await expect(lessonRow(paced.sessionId).locator('td')).toHaveText([pad(paced.sessionId), /^Task09 paced/, 'Instructor-paced', /.+/, '0 / 2 (0%)', 'No']);
    await dash.screenshot({ path: `${artifacts}/07-admin-lessons.png` });
  } finally { await six.close().catch(() => {}); await admin.close().catch(() => {}); }
});
