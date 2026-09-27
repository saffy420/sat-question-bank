import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { setOffline } from '../lessons-00b-e2e-harness/network.js';

// BRIEF §13 checks that no earlier spec covered end to end: the grace window (3), a 20 s outage
// restoring the assigned set and annotations (2), and reusing a lesson (9).
const artifacts = '.omp/pipeline/lessons-10-e2e-regression/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', AI = 'e2e-ai-rw';
const GRACE_MS = 750; // §13 / G2: answer changes are accepted until endsAt + 750 ms.

async function lesson(admin, mode, items, title) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode, items } });
  expect(created.status(), await created.text()).toBe(200);
  return (await created.json()).id;
}
async function start(admin, lessonId) {
  const started = await admin.request.post(`/api/admin/lessons/${lessonId}/sessions`, { headers: { Origin: ORIGIN } });
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
  const ws = await socket;
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
  return ws;
}
// Every lesson socket of this context goes through a proxy the test can close or write to,
// exactly as the browser would: frames from the server are forwarded unchanged.
function proxy(context) {
  const link = { server: null, received: [] };
  return context.routeWebSocket(roomSocket, ws => {
    link.server = ws.connectToServer();
    link.server.onMessage(message => { link.received.push(message); ws.send(message); });
  }).then(() => link);
}
// A real outage: the server side is closed and the browser goes offline for at least 20 s.
async function outage(context, page, link, duringOutage = async () => {}) {
  await link.server.close({ code: 1000, reason: 'wifi off' });
  await setOffline(context, true);
  await expect(page.locator('#lesson-connection')).toHaveAttribute('aria-label', 'Reconnecting…');
  const from = Date.now();
  await duringOutage();
  await expect.poll(() => Date.now() - from, { timeout: 25000 }).toBeGreaterThanOrEqual(20000);
  const offlineMs = Date.now() - from;
  await setOffline(context, false);
  await expect(page.locator('#lesson-connection')).toHaveAttribute('aria-label', 'Connected', { timeout: 20000 });
  return offlineMs;
}
const seconds = text => { const [m, s] = text.split(':').map(Number); return m * 60 + s; };
const room = (admin, sessionId) => admin.request.get(`/api/lessons/${sessionId}`).then(r => r.json());
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
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });

test('§13.3 an answer change after endsAt + 750 ms is rejected; the UI already showed it locked', async ({ browser }) => {
  test.setTimeout(60000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const { sessionId, joinCode } = await start(admin, await lesson(admin, 'instructor', [{ question_id: RW, time_limit_sec: 6, notes: '' }], 'Task10 grace'));
    const teacher = await teacherPage(admin, sessionId);
    const link = await proxy(context);
    const student = await context.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await student.locator('[data-lesson-choice="B"]').click();
    await expect.poll(async () => (await room(admin, sessionId)).responses['e2e-student-2']?.[RW]?.answer).toBe('B');
    const { endsAt } = await room(admin, sessionId);

    // The student's screen freezes at 0:00, before the server's grace window has closed.
    await expect(student.locator('#lesson-clock')).toHaveText('0:00', { timeout: 10000 });
    const frozen = await student.evaluate(() => ({
      phase: document.querySelector('.lesson-phase').textContent,
      disabled: [...document.querySelectorAll('[data-lesson-choice]')].every(b => b.disabled)
    }));
    expect(frozen.disabled).toBe(true);
    await shot(student, 'A1-frozen-at-zero');

    // Past endsAt + 750 ms, a select written straight onto the student's real socket is refused.
    await expect.poll(() => Date.now()).toBeGreaterThan(endsAt + GRACE_MS + 50);
    const before = link.received.length;
    link.server.send(JSON.stringify({ type: 'select', questionId: RW, answer: 'A' }));
    await expect.poll(() => link.received.slice(before).map(m => JSON.parse(m)).find(m => m.type === 'error')?.error).toBe('question closed');
    expect((await room(admin, sessionId)).responses['e2e-student-2'][RW].answer).toBe('B');
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect(student.locator('.lesson-verdict')).toContainText('Your answer: B');
    test.info().annotations.push({ type: 'phase at 0:00', description: frozen.phase });
    await teacher.locator('[data-live="endSession"]').click();
  } finally { await context.close(); await admin.close(); }
});

test('§13.2 a 20 s outage mid-set restores the question, remaining time, selection and assigned set', async ({ browser }) => {
  test.setTimeout(120000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const early = await newUserContext(browser, 'e2e-student-3');
  const context = await newUserContext(browser, 'e2e-student-4');
  try {
    // 120 s shared clock; the late joiner is fitted a smaller set.
    const items = [RW, MATH, SPR, AI].map(question_id => ({ question_id, time_limit_sec: 30, notes: '' }));
    const { sessionId, joinCode } = await start(admin, await lesson(admin, 'self', items, 'Task10 outage self'));
    const teacher = await teacherPage(admin, sessionId);
    await join(await early.newPage(), joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SELF-PACED SET');

    const link = await proxy(context);
    const student = await context.newPage();
    const joined = student.waitForResponse(r => r.url().endsWith('/api/lessons/join'));
    await join(student, joinCode);
    const assigned = (await (await joined).json()).assignedQuestionIds;
    expect(assigned.length).toBeLessThan(items.length);
    const navigatorIds = () => student.locator('#self-navigator [data-self-q]').evaluateAll(els => els.map(el => el.dataset.selfQ));

    // Answer the first question of the set, move on, pick an answer on the second.
    const choose = async id => id === SPR ? student.locator('#lesson-grid').fill('3') : student.locator('[data-lesson-choice="B"]').click();
    await expect(student.locator('#self-nav')).toHaveText(`Question 1 of ${assigned.length}`);
    await choose(assigned[0]);
    await student.locator('#self-next').click();
    await expect(student.locator('#self-nav')).toHaveText(`Question 2 of ${assigned.length}`);
    await choose(assigned[1]);
    await expect.poll(async () => (await room(admin, sessionId)).grid['e2e-student-4']?.[assigned[1]]?.[0]).toBe(assigned[1] === SPR ? '3' : 'B');
    await student.locator('#self-nav').click();
    expect(await navigatorIds()).toEqual(assigned);
    await student.locator('#self-nav').click();
    const clockBefore = await student.locator('#lesson-clock').textContent();

    const offlineMs = await outage(context, student, link);
    await expect(student.locator('#self-nav')).toHaveText(`Question 2 of ${assigned.length}`);
    if (assigned[1] === SPR) await expect(student.locator('#lesson-grid')).toHaveValue('3');
    else await expect(student.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    const clockAfter = await student.locator('#lesson-clock').textContent();
    expect(seconds(clockBefore) - seconds(clockAfter)).toBeGreaterThanOrEqual(Math.floor(offlineMs / 1000) - 2);
    await student.locator('#self-nav').click();
    expect(await navigatorIds()).toEqual(assigned);
    await student.locator('#self-nav').click();
    await student.locator('#self-back').click();
    await expect(student.locator('#self-nav')).toHaveText(`Question 1 of ${assigned.length}`);
    if (assigned[0] === SPR) await expect(student.locator('#lesson-grid')).toHaveValue('3');
    else await expect(student.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(student, 'A2-self-after-outage');
    await teacher.locator('[data-live="endSession"]').click();
  } finally { await context.close(); await early.close(); await admin.close(); }
});

test('§13.2 annotations made during a 20 s outage are there on reconnect, with the selection', async ({ browser }) => {
  test.setTimeout(90000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const { sessionId, joinCode } = await start(admin, await lesson(admin, 'instructor', [{ question_id: RW, time_limit_sec: 60, notes: '' }], 'Task10 outage paced'));
    const teacher = await teacherPage(admin, sessionId);
    const link = await proxy(context);
    const student = await context.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await student.locator('[data-lesson-choice="C"]').click();
    await expect.poll(async () => (await room(admin, sessionId)).responses['e2e-student-2']?.[RW]?.answer).toBe('C');
    // Annotations are shared from the reveal on (§7.1), so the drop happens there.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    await selectText(teacher, 'Which word best completes');
    await expect(student.locator('#lesson-card [data-ann-mark]')).toHaveText(['Which word best completes']);

    await outage(context, student, link, async () => {
      await teacher.locator('[data-tool="strike"]').click();
      await selectText(teacher, 'The club made');
      await expect.poll(async () => (await room(admin, sessionId)).annotations.length).toBe(2);
    });
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect(student.locator('#lesson-card [data-ann-mark]')).toHaveText(['Which word best completes', 'The club made']);
    await expect(student.locator('#lesson-card [data-ann-mark]', { hasText: 'The club made' })).toHaveCSS('text-decoration-line', 'line-through');
    await expect(student.locator('[data-lesson-choice="C"] .choice')).toHaveClass(/wrong/);
    await expect(student.locator('.lesson-verdict')).toContainText('Your answer: C');
    await shot(student, 'A2-paced-annotations-after-outage');
    await teacher.locator('[data-live="endSession"]').click();
  } finally { await context.close(); await admin.close(); }
});

test('§13.9 reusing a lesson creates a new session, code and ID; old results are unchanged', async ({ browser }) => {
  test.setTimeout(90000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const lessonId = await lesson(admin, 'instructor', [{ question_id: RW, time_limit_sec: 60, notes: 'E2E_NOTES_MARKER_REUSE' }], 'Task10 reuse');
    const student = await context.newPage();
    const run = async answer => {
      const session = await start(admin, lessonId);
      const teacher = await teacherPage(admin, session.sessionId);
      await join(student, session.joinCode);
      await teacher.locator('[data-live="start"]').click();
      await student.locator(`[data-lesson-choice="${answer}"]`).click();
      await expect.poll(async () => (await room(admin, session.sessionId)).responses['e2e-student-2']?.[RW]?.answer).toBe(answer);
      await teacher.locator('[data-live="endNow"]').click();
      await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
      await teacher.locator('[data-live="endSession"]').click();
      await expect.poll(async () => (await context.request.get(`/api/lesson-history/${session.sessionId}`)).status()).toBe(200);
      await teacher.close();
      return session;
    };
    const history = id => context.request.get(`/api/lesson-history/${id}`).then(r => r.json());

    const first = await run('B');
    const firstHistory = await history(first.sessionId);
    expect(firstHistory.questions.map(q => q.answer)).toEqual(['B']);
    const second = await run('A');

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.joinCode).not.toBe(first.joinCode);
    const sessions = await (await admin.request.get(`/api/admin/lessons/${lessonId}/sessions`)).json();
    const rows = sessions.map(s => [s.id, s.join_code, s.status]);
    expect(rows).toEqual([[second.sessionId, second.joinCode, 'ended'], [first.sessionId, first.joinCode, 'ended']]);
    // The first run's results are exactly what they were; the second run has its own.
    expect(await history(first.sessionId)).toEqual(firstHistory);
    expect((await history(second.sessionId)).questions.map(q => q.answer)).toEqual(['A']);
    // The old code no longer admits anyone.
    const stale = await context.request.post('/api/lessons/join', { headers: { Origin: ORIGIN }, data: { code: first.joinCode } });
    expect(stale.status()).toBe(404);
  } finally { await context.close(); await admin.close(); }
});
