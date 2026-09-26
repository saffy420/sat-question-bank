import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { setOffline } from '../lessons-00b-e2e-harness/network.js';

const artifacts = '.opencode/pipeline/lessons-03-realtime-core/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;

async function makeRoom(context) {
  const title = `E2E live ${Date.now()}`;
  const created = await context.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title, mode: 'instructor', items: [
    { question_id: 'e2e-core-rw', time_limit_sec: 55, notes: 'E2E_NOTES_MARKER_LIVE' },
    { question_id: 'e2e-core-math', time_limit_sec: 7, notes: '' },
    { question_id: 'e2e-core-spr', time_limit_sec: 6, notes: '' }
  ] } });
  expect(created.status(), await created.text()).toBe(200);
  const lesson = await created.json();
  const started = await context.request.post(`/api/admin/lessons/${lesson.id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status()).toBe(200);
  return { title, ...await started.json() };
}

async function studentPage(context) {
  const page = await context.newPage();
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  return page;
}

async function join(page, code, paste = false) {
  await page.locator('#join-lesson').click();
  const boxes = page.locator('#lesson-code input');
  if (paste) await boxes.first().evaluate((input, value) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text', value);
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, code);
  else for (const [index, char] of [...code].entries()) await boxes.nth(index).fill(char);
  await expect.poll(() => boxes.evaluateAll(inputs => inputs.map(i => i.value).join(''))).toBe(code.toUpperCase());
  await page.locator('#join-go').click();
}

async function socketFor(page) {
  return await page.waitForEvent('websocket', { predicate: ws => roomSocket.test(ws.url()), timeout: 15000 });
}

async function connected(page) {
  const indicator = page.locator('#lesson-connection');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveText(/^Connected$/);
  await expect(indicator.locator('svg')).toBeVisible();
}

test('task03 nav join, live lobby, after-start admission, physical outage recovery, tab replacement, join lock', async ({ browser }) => {
  test.setTimeout(150000); // Includes deliberate 20-second offline interval and four account bootstraps.
  const admin = await newUserContext(browser, 'e2e-admin');
  const students = [];
  try {
    const room = await makeRoom(admin);
    const preflight = await admin.request.get(`/api/lessons/${room.sessionId}`);
    if (!preflight.ok()) {
      const failingPage = await admin.newPage();
      await failingPage.goto(`/admin/live/${room.sessionId}`);
      await expect(failingPage.locator('#message')).toContainText('service unavailable');
      await failingPage.screenshot({ path: `${artifacts}/00-room-unavailable.png` });
    }
    expect(preflight.status(), await preflight.text()).toBe(200);
    const teacher = await admin.newPage();
    const adminSocket = socketFor(teacher);
    await teacher.goto(`/admin/live/${room.sessionId}`);
    await adminSocket;
    await expect(teacher.locator('.join-code')).toHaveText(room.joinCode);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    await teacher.screenshot({ path: `${artifacts}/01-instructor-lobby.png` });

    const first = await newUserContext(browser, 'e2e-student-1'); students.push(first);
    const one = await studentPage(first);
    await one.locator('#join-lesson').click();
    for (const [i, char] of [...'ABCDEF'].entries()) await one.locator('#lesson-code input').nth(i).fill(char);
    await one.locator('#join-go').click();
    await expect(one.locator('#join-error')).toContainText('wrong or ended code');
    await expect(one.locator('#lesson-live')).toHaveClass(/hide/);
    await one.screenshot({ path: `${artifacts}/02-wrong-code.png` });
    await one.locator('#join-cancel').click();
    const oneSocket = socketFor(one);
    await join(one, room.joinCode.toLowerCase());
    const initialSocket = await oneSocket;
    await connected(one);
    await expect(one.locator('#lesson-content')).toContainText(room.title);
    await expect(one.locator('#lesson-content')).toContainText('Waiting for the instructor to start');
    await expect(teacher.locator('#live-roster')).toContainText('E2E Student 1');
    await one.screenshot({ path: `${artifacts}/03-student-lobby.png` });
    await teacher.screenshot({ path: `${artifacts}/04-live-roster.png` });

    const second = await newUserContext(browser, 'e2e-student-2'); students.push(second);
    const two = await studentPage(second);
    const twoSocket = socketFor(two);
    await join(two, room.joinCode.toLowerCase(), true);
    await twoSocket;
    await connected(two);
    await expect(teacher.locator('#live-roster')).toContainText('E2E Student 2');
    await expect(one.locator('#lesson-content')).toContainText('2 joined');

    await teacher.locator('[data-live="start"]').click();
    await expect(one.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(one.locator('#lesson-content')).toContainText('Which word best completes');
    await expect(one.locator('#lesson-clock')).not.toHaveText('');
    await one.locator('[data-lesson-choice="B"]').click();
    await expect(one.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await (await admin.request.get(`/api/lessons/${room.sessionId}`)).json()).responses['e2e-student-1']?.['e2e-core-rw']?.answer).toBe('B');
    await one.screenshot({ path: `${artifacts}/05-answering.png` });

    const late = await newUserContext(browser, 'e2e-student-3'); students.push(late);
    let upstream;
    await late.routeWebSocket(roomSocket, route => { upstream = route.connectToServer(); });
    const three = await studentPage(late);
    const threeSocket = socketFor(three);
    await join(three, room.joinCode, true);
    await threeSocket;
    await expect(three.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(three.locator('#lesson-content')).toContainText('Which word best completes');
    await expect(three.locator('#lesson-clock')).not.toHaveText('');
    await expect(teacher.locator('#live-roster')).toContainText('E2E Student 3');
    const clockBeforeDrop = await three.locator('#lesson-clock').textContent();
    expect(clockBeforeDrop).toMatch(/^0:[1-5]\d$/); // 55-second question, still answering before outage.
    await three.screenshot({ path: `${artifacts}/06-after-start.png` });

    // Close real proxied server socket, not merely Chromium offline flag; verify browser transport closed.
    await three.locator('[data-lesson-choice="C"]').click();
    await expect.poll(async () => (await (await admin.request.get(`/api/lessons/${room.sessionId}`)).json()).responses['e2e-student-3']?.['e2e-core-rw']?.answer).toBe('C');
    const transport = await threeSocket;
    await upstream.close({ code: 1000, reason: 'offline test' });
    await setOffline(late, true);
    await expect.poll(() => transport.isClosed()).toBe(true);
    await expect(three.locator('#lesson-connection')).toHaveText('Reconnecting…');
    const disconnectedAt = Date.now();
    await expect.poll(() => Date.now() - disconnectedAt, { timeout: 24000 }).toBeGreaterThanOrEqual(20000);
    const offlineMs = Date.now() - disconnectedAt;
    expect(transport.isClosed()).toBe(true);
    await setOffline(late, false);
    await connected(three);
    await expect(three.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(three.locator('#lesson-content')).toContainText('Which word best completes');
    await expect(three.locator('[data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(three.locator('#lesson-clock')).not.toHaveText('');
    const clockAfterRecovery = await three.locator('#lesson-clock').textContent();
    const seconds = clock => { const [min, sec] = clock.split(':').map(Number); return min * 60 + sec; };
    expect(seconds(clockBeforeDrop) - seconds(clockAfterRecovery)).toBeGreaterThanOrEqual(Math.floor(offlineMs / 1000) - 2);
    await three.screenshot({ path: `${artifacts}/07-reconnected.png` });

    const otherTab = await first.newPage();
    await otherTab.goto('/app');
    await expect(otherTab.locator('#user-name')).toContainText('E2E Student 1');
    const otherSocket = socketFor(otherTab);
    await join(otherTab, room.joinCode);
    await otherSocket;
    await expect.poll(() => initialSocket.isClosed()).toBe(true);
    await expect(one.locator('#lesson-content')).toHaveText('Opened in another tab.');
    await connected(otherTab);
    await expect(otherTab.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await connected(otherTab);
    await otherTab.screenshot({ path: `${artifacts}/08-second-tab.png` });

    await teacher.locator('#live-lock').check();
    await expect(teacher.locator('#live-lock')).toBeChecked();
    await expect.poll(async () => (await (await admin.request.get(`/api/lessons/${room.sessionId}`)).json()).lockedJoin).toBe(true);
    const newcomer = await newUserContext(browser, 'e2e-student-4'); students.push(newcomer);
    const blocked = await studentPage(newcomer);
    await join(blocked, room.joinCode);
    await expect(blocked.locator('#join-error')).toContainText('joining locked');
    await expect(blocked.locator('#lesson-live')).toHaveClass(/hide/);
    await connected(otherTab);
    await blocked.screenshot({ path: `${artifacts}/09-joining-locked.png` });
  } finally { for (const context of students.reverse()) await context.close(); await admin.close(); }
});
