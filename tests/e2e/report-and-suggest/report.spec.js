import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { FIXTURE, FIX, mock, reset, openInPlayer, reportFromDialog, groups, group, post } from './support.js';
import { dismissEnded } from '../lessons-11-ui-polish/helpers.js';

const artifacts = '.omp/pipeline/report-and-suggest/e2e';
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });
const MATH = 'e2e-core-math', RW = 'e2e-core-rw';
const payloadOf = req => req.postDataJSON();

// Fail on the step that hangs, not at the test timeout.
test.use({ actionTimeout: 15000 });

test.beforeAll(() => mkdirSync(artifacts, { recursive: true }));
test.beforeEach(async () => { await reset('fixture'); });
test.afterAll(async () => { await reset('cleanup'); });

test('R1 report from the bank: button next to Mark for Review, modal, payload, Thanks', async ({ browser }) => {
  test.setTimeout(90000);
  await mock.script([{ json: { action: 'escalate', reason: 'Needs a person' } }]);
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await student.newPage();
    await openInPlayer(page, FIXTURE);
    // The button sits in the question bar, directly after Mark for Review.
    const bar = page.locator('#bank-card .stage-strip');
    await expect(bar.locator('#stage-flag + #stage-report')).toHaveText(/Report/);
    await page.locator('#stage-report').click();
    const dialog = page.locator('#rpt-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[name="rpt-category"]')).toHaveCount(4);
    await expect(dialog.locator('label.rpt-opt')).toHaveText(['Formatting / display', 'Wrong answer or explanation', 'Typo', 'Other'].map(t => ` ${t}`).map(t => new RegExp(t.trim())));
    await expect(page.locator('#rpt-send')).toBeDisabled();
    await expect(page.locator('#rpt-note')).toBeVisible(); // optional
    await shot(page, 'R1-modal');
    await dialog.locator('input[value="formatting"]').check();
    await page.locator('#rpt-note').fill('Shows dollar signs instead of math');
    const sent = page.waitForRequest(r => new URL(r.url()).pathname === '/api/reports' && r.method() === 'POST');
    const replied = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reports');
    await page.locator('#rpt-send').click();
    const payload = payloadOf(await sent);
    expect(Object.keys(payload).sort()).toEqual(['category', 'dpr', 'html', 'note', 'question_id', 'seen_in', 'viewport', 'zoom']);
    expect(payload).toMatchObject({ question_id: FIXTURE, category: 'formatting', note: 'Shows dollar signs instead of math', seen_in: 'bank', viewport: { w: 1366, h: 768 } });
    expect(typeof payload.zoom).toBe('number'); expect(payload.dpr).toBeGreaterThan(0);
    expect(payload.html).toContain('Report fixture: what is $3 + 4$?');
    expect(payload.html).not.toMatch(/data:image|<canvas|report-btn/); // rendered HTML only, no screenshot, not its own button
    expect((await replied).status()).toBe(200); // the reply body is asserted in R5 (Playwright cannot read it from the page's fetch here)
    await expect(page.locator('.rpt-thanks')).toContainText('Thanks');
    await shot(page, 'R1-thanks');
    // The triage call carried the report, the stored source fields and the rendered HTML.
    await expect.poll(async () => (await mock.calls()).length).toBe(1);
    const [call] = await mock.calls();
    expect(call).toMatchObject({ key: 'e2e-not-a-real-key', version: '2023-06-01', body: { model: expect.stringMatching(/^claude-/) } });
    const text = call.body.messages[0].content;
    expect(text).toContain('Shows dollar signs instead of math');
    expect(text).toContain('"correct_answer":"C"');
    expect(text).toContain('"stem_html":"<p>Report fixture: what is $3 + 4$?</p>"');
    expect(text).toContain('<rendered>');
    expect(call.body.system).toMatch(/never change correct_answer/i);
  } finally { await student.close(); }
});

test('R2 report from a lesson and from lesson history', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const created = await post(admin, '/api/admin/lessons', { title: 'Report lesson ' + Date.now(), mode: 'instructor', items: [{ question_id: MATH, time_limit_sec: 60, notes: '' }, { question_id: RW, time_limit_sec: 60, notes: '' }] });
    expect(created.status()).toBe(200);
    const started = await post(admin, `/api/admin/lessons/${(await created.json()).id}/sessions`);
    const { sessionId, joinCode } = await started.json();
    const teacher = await admin.newPage(); await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const page = await student.newPage();
    await page.goto(`/app?join=${joinCode}`);
    await expect(page.locator('#lesson-connection')).toHaveText('Connected');
    await teacher.locator('[data-live="start"]').click();
    await expect(page.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    // The lesson student view: Report in the question bar.
    await expect(page.locator('#lesson-card .stage-strip #stage-report')).toBeVisible();
    await shot(page, 'R2-lesson-bar');
    await page.locator('#stage-report').click();
    await expect(page.locator('#rpt-dialog')).toBeVisible();
    const sent = page.waitForRequest(r => new URL(r.url()).pathname === '/api/reports');
    await reportFromDialog(page, { category: 'other', note: 'Choice B looks cut off' });
    const lesson = payloadOf(await sent);
    expect(lesson).toMatchObject({ question_id: MATH, seen_in: 'lesson', session_id: sessionId, category: 'other', viewport: { w: 1366, h: 768 } });
    expect(lesson.html).toContain('What is'); expect(lesson.html).not.toContain('E2E_EXPL_MARKER'); // the student has no explanation yet
    await expect(page.locator('.rpt-thanks')).toContainText('Thanks');
    await page.locator('#rpt-done').click();
    // Run the lesson to its end, then report from My Lessons.
    await teacher.locator('[data-live="endNow"]').click();
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await teacher.locator('[data-live="endNow"]').click();
    await teacher.locator('[data-live="endSession"]').click();
    await dismissEnded(page);
    await expect(page.locator('#lesson-live')).toBeHidden();
    await page.locator('.nav-i[data-tab="lessons"]').click();
    await page.locator(`#lessons-table tr[data-session="${sessionId}"]`).click();
    await expect(page.locator('#history-summary')).toBeVisible();
    await page.locator(`[data-history-open="${MATH}"]`).click();
    await expect(page.locator('#history-show')).not.toBeChecked();
    await expect(page.locator('#history-reveal')).toHaveCount(0);
    await page.locator('#history-show').check();
    await expect(page.locator('#lesson-card[data-ready]')).toBeVisible();
    await page.locator('#history-next').click();
    await expect(page.locator('#history-correct')).toHaveText('Correct answer: A');
    await expect(page.locator('#lesson-card .stage-strip #stage-report')).toBeVisible();
    await page.locator('#stage-report').click();
    const sentHistory = page.waitForRequest(r => new URL(r.url()).pathname === '/api/reports');
    await reportFromDialog(page, { category: 'typo', note: 'Typo in the passage' });
    expect(payloadOf(await sentHistory)).toMatchObject({ question_id: RW, seen_in: 'history', session_id: sessionId, category: 'typo' });
    await expect(page.locator('.rpt-thanks')).toContainText('Thanks');
    await shot(page, 'R2-history');
    const list = await groups(admin);
    expect(list.map(g => [g.questionId, g.reports[0].seen_in, g.reports[0].context.session_id]).sort()).toEqual([[MATH, 'lesson', sessionId], [RW, 'history', sessionId]]);
  } finally { await admin.close(); await student.close(); }
});

test('R3 a valid mocked fix waits in Reports, is approved, and the student then sees the fixed question', async ({ browser }) => {
  test.setTimeout(120000);
  await mock.script([{ json: FIX }]);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await student.newPage();
    await openInPlayer(page, FIXTURE);
    await expect(page.locator('#bank-card .lesson-stem')).toContainText('$3 + 4$');
    await expect(page.locator('#bank-card .lesson-stem .katex')).toHaveCount(0);
    await page.locator('#stage-report').click();
    await reportFromDialog(page, { note: 'Math is not rendering' });
    await expect(page.locator('.rpt-thanks')).toBeVisible();
    const g = await group(admin, FIXTURE);
    expect(g).toMatchObject({ state: 'fix', items: [{ kind: 'fix', changed: ['stem_html'] }] });
    // Pending, not applied.
    const bankStem = async () => (await (await student.request.get('/api/questions')).json()).find(q => q.id === FIXTURE).stem_html;
    expect(await bankStem()).toContain('$3 + 4$');
    const tab = await admin.newPage();
    await tab.goto('/admin');
    await tab.locator('[data-section="Reports"]').click();
    const card = tab.locator(`[data-question="${FIXTURE}"]`);
    await expect(card).toHaveAttribute('data-state', 'fix');
    await expect(card).toContainText('Dollar signs are not math delimiters');
    await expect(card).toContainText('Math is not rendering');
    // Before / after through the real renderer: literal dollars before, KaTeX after.
    await expect(card.locator('[data-side="before"] .question-preview')).toContainText('$3 + 4$');
    await expect(card.locator('[data-side="before"] .katex')).toHaveCount(0);
    await expect(card.locator('[data-side="after"] .katex').first()).toBeVisible();
    await expect(card.locator('[data-side="after"] .question-preview')).not.toContainText('$3 + 4$');
    await shot(tab, 'R3-reports-tab');
    await card.locator('[data-approve]').click();
    await expect(tab.locator('.report-groups')).toHaveCount(0);
    await expect(tab.getByText('No open reports.')).toBeVisible();
    expect(await groups(admin)).toEqual([]);
    // The student sees the fix straight away: the bank feed and the player.
    expect(await bankStem()).toContain('\\(3 + 4\\)');
    await openInPlayer(page, FIXTURE);
    await expect(page.locator('#bank-card .lesson-stem .katex').first()).toBeVisible();
    await expect(page.locator('#bank-card .lesson-stem')).not.toContainText('$3 + 4$');
    // The report is closed, so the student may report this question again.
    await page.locator('#stage-report').click();
    await reportFromDialog(page, { note: 'second look' });
    await expect(page.locator('.rpt-thanks')).toBeVisible();
    // Answer key untouched.
    const q = (await (await student.request.get('/api/questions')).json()).find(x => x.id === FIXTURE);
    expect(q.correct_answer).toBe('C');
  } finally { await admin.close(); await student.close(); }
});

test('R4 a mocked fix that changes the answer or the choice order is rejected and shown as an escalation', async ({ browser }) => {
  test.setTimeout(120000);
  await mock.script([
    { json: { action: 'fix', reason: 'The key is wrong', patch: { correct_answer: 'B', stem_html: '<p>Report fixture: what is \\(3 + 4\\)?</p>' } } },
    { json: { action: 'fix', reason: 'Reorder', patch: { choices_json: '[{"letter":"C","content":"7"},{"letter":"B","content":"6"},{"letter":"A","content":"5"},{"letter":"D","content":"8"}]' } } }
  ]);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const before = await (await student.request.get('/api/questions')).json();
    const page = await student.newPage();
    await openInPlayer(page, FIXTURE);
    await page.locator('#stage-report').click();
    await reportFromDialog(page, { category: 'formatting' });
    await expect(page.locator('.rpt-thanks')).toBeVisible();
    await openInPlayer(page, MATH);
    await page.locator('#stage-report').click();
    await reportFromDialog(page, { category: 'formatting' });
    await expect(page.locator('.rpt-thanks')).toBeVisible();
    const key = await group(admin, FIXTURE);
    expect(key.state).toBe('escalation');
    expect(key.items[0]).toMatchObject({ kind: 'escalation', after: null, rejected: ['correct_answer', 'stem_html'] });
    expect(key.items[0].reason).toMatch(/rejected: correct_answer may not be changed/);
    const order = await group(admin, MATH);
    expect(order.state).toBe('escalation');
    expect(order.items[0].reason).toMatch(/letters or order/);
    const tab = await admin.newPage();
    await tab.goto('/admin/reports');
    const card = tab.locator(`[data-question="${FIXTURE}"]`);
    await expect(card).toHaveAttribute('data-state', 'escalation');
    await expect(card).toContainText('A proposed fix was rejected');
    await expect(card.locator('[data-approve]')).toHaveCount(0);
    await shot(tab, 'R4-escalation');
    await expect(tab.locator('[data-question]')).toHaveCount(2);
    // Nothing was written.
    const after = await (await student.request.get('/api/questions')).json();
    for (const id of [FIXTURE, MATH]) expect(after.find(q => q.id === id)).toMatchObject({ correct_answer: 'C' });
    expect(after.filter(q => q.id !== FIXTURE)).toEqual(before.filter(q => q.id !== FIXTURE));
    // Closing an escalation closes its reports.
    await card.locator('[data-reject]').click();
    await expect(tab.locator('[data-question]')).toHaveCount(1);
  } finally { await admin.close(); await student.close(); }
});

test('R5 limits: one open report per question, one Claude call per question per day, 10 reports a day, the monthly cap', async ({ browser }) => {
  test.setTimeout(180000);
  await mock.script([{ json: { action: 'escalate', reason: 'Needs a person' } }]);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const three = await newUserContext(browser, 'e2e-student-3');
  const four = await newUserContext(browser, 'e2e-student-4');
  const report = (context, id, category = 'other') => post(context, '/api/reports', { question_id: id, category, note: '', seen_in: 'bank', viewport: { w: 1366, h: 768 }, zoom: 1, dpr: 1, html: '<p>x</p>' });
  try {
    // One open report per user per question, shown to the student.
    const page = await three.newPage();
    await openInPlayer(page, FIXTURE);
    await page.locator('#stage-report').click();
    await reportFromDialog(page);
    await expect(page.locator('.rpt-thanks')).toBeVisible();
    await page.locator('#rpt-done').click();
    await page.locator('#stage-report').click();
    await reportFromDialog(page);
    await expect(page.locator('#rpt-dialog .rpt-status')).toContainText('already have an open report');
    await shot(page, 'R5-duplicate');
    await page.locator('#rpt-cancel').click();
    // A second student on the same question inside the day: stored, no second Claude call.
    const second = await report(four, FIXTURE);
    expect([second.status(), await second.json()]).toEqual([200, { ok: true }]); // the reply says nothing about the triage
    const g = await group(admin, FIXTURE);
    expect(g.reports).toHaveLength(2);
    await expect.poll(async () => (await mock.calls()).length).toBe(1);
    await new Promise(r => setTimeout(r, 500));
    expect((await mock.calls()).length).toBe(1);
    // 10 reports per user per day: student 3 has made one. Closing a report frees the question but not the day's count.
    for (let n = 2; n <= 10; n++) {
      const r = await report(three, MATH);
      expect(r.status(), `report ${n}`).toBe(200);
      await post(admin, '/api/admin/reports/decision', { question_id: MATH, decision: 'reject' });
    }
    const eleventh = await report(three, RW);
    expect([eleventh.status(), await eleventh.json()]).toEqual([429, { error: 'daily report limit reached' }]);
    await openInPlayer(page, RW);
    await page.locator('#stage-report').click();
    await reportFromDialog(page);
    await expect(page.locator('#rpt-dialog .rpt-status')).toContainText('limit for reports');
    await shot(page, 'R5-daily-limit');
    // Monthly cap: once the count is used up a report is stored and escalated, with no call.
    await reset('fixture', { calls: 300 });
    expect((await report(four, MATH)).status()).toBe(200);
    const capped = await group(admin, MATH);
    expect(capped.items[0]).toMatchObject({ kind: 'escalation', called: false });
    expect(capped.items[0].reason).toMatch(/monthly limit/);
    expect(await mock.calls()).toEqual([]);
    const usage = await (await admin.request.get('/api/admin/reports')).json();
    expect(usage.usage).toEqual({ calls: 300, cap: 300 });
  } finally { await admin.close(); await three.close(); await four.close(); }
});

test('R6 suggestion round trip: bank and lesson menus, newest first, done and dismiss, 5 a day', async ({ browser }) => {
  test.setTimeout(150000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await student.newPage();
    await openInPlayer(page, MATH);
    await page.locator('#bank-live .lesson-more summary').click();
    await page.locator('#bank-suggest').click();
    await expect(page.locator('#sug-dialog')).toBeVisible();
    await expect(page.locator('#sug-send')).toBeDisabled();
    await expect(page.locator('#sug-area option')).toHaveText(['Not sure', 'Question bank', 'Lessons', 'Study plan', 'Other']);
    await page.locator('#sug-body').fill('Add a dark mode timer');
    await page.locator('#sug-area').selectOption('bank');
    await shot(page, 'R6-modal');
    const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/suggestions');
    await page.locator('#sug-send').click();
    expect((await sent).status()).toBe(200);
    await expect(page.locator('.rpt-thanks')).toContainText('Thanks');
    await page.locator('#sug-done').click();
    // From a lesson.
    const created = await post(admin, '/api/admin/lessons', { title: 'Suggest lesson ' + Date.now(), mode: 'instructor', items: [{ question_id: MATH, time_limit_sec: 60, notes: '' }] });
    const lessonId = (await created.json()).id;
    const { sessionId, joinCode } = await (await post(admin, `/api/admin/lessons/${lessonId}/sessions`)).json();
    const teacher = await admin.newPage(); await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    // A running practice session asks before the tab leaves /app, so the lesson gets a tab of its own.
    await page.close({ runBeforeUnload: false });
    const lessonPage = await student.newPage();
    await lessonPage.goto(`/app?join=${joinCode}`);
    await expect(lessonPage.locator('#lesson-connection')).toHaveText('Connected');
    await lessonPage.locator('.lesson-more summary').click();
    await lessonPage.locator('#lesson-suggest').click();
    await lessonPage.locator('#sug-body').fill('Let me revisit the last poll');
    await lessonPage.locator('#sug-area').selectOption('lessons');
    await lessonPage.locator('#sug-send').click();
    await expect(lessonPage.locator('.rpt-thanks')).toContainText('Thanks');
    await lessonPage.locator('#sug-done').click();
    // Three more by API reach the limit of five; the sixth is refused.
    for (const n of [3, 4, 5]) {
      const r = await post(student, '/api/suggestions', { body: `Idea ${n}` });
      expect([r.status(), await r.json()]).toEqual([200, { ok: true }]);
    }
    const sixth = await post(student, '/api/suggestions', { body: 'Idea 6' });
    expect([sixth.status(), (await sixth.json()).error]).toEqual([429, 'daily suggestion limit reached']);
    // Admin tab: newest first.
    const tab = await admin.newPage();
    await tab.goto('/admin');
    await tab.locator('[data-section="Suggestions"]').click();
    await tab.locator('[data-tab="app"]').click();
    await expect(tab.locator('[data-tab="app"]')).toHaveAttribute('aria-selected', 'true');
    const items = tab.locator('[data-suggestion][data-category="app"] .suggestion-body');
    await expect(items).toHaveText(['Idea 5', 'Idea 4', 'Idea 3', 'Let me revisit the last poll', 'Add a dark mode timer']);
    await expect(tab.locator('.suggestion').nth(3)).toContainText('Lessons');
    await expect(tab.locator('.suggestion').nth(4)).toContainText('Question bank');
    await shot(tab, 'R6-suggestions');
    // Mark done / dismiss: they leave the default list and show in "Show done and dismissed".
    await tab.locator('.suggestion').first().locator('[data-done]').click();
    await tab.locator('.suggestion').first().locator('[data-dismiss]').click();
    await expect(items).toHaveText(['Idea 3', 'Let me revisit the last poll', 'Add a dark mode timer']);
    await tab.locator('#show-handled').check();
    await expect(items).toHaveCount(5);
    await expect(tab.locator('.suggestion').nth(0)).toHaveAttribute('data-status', 'done');
    await expect(tab.locator('.suggestion').nth(1)).toHaveAttribute('data-status', 'dismissed');
    // A student cannot read or change the list.
    expect((await student.request.get('/api/admin/suggestions')).status()).toBe(403);
    // Leave no live room behind: end the lesson the student joined.
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await (await admin.request.get(`/api/admin/lessons/${lessonId}/sessions`)).json()).find(x => x.id === sessionId)?.status).toBe('ended');
  } finally { await admin.close(); await student.close(); }
});
