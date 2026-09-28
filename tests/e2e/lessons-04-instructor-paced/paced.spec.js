import { test, expect } from '@playwright/test';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';

const artifacts = '.opencode/pipeline/lessons-04-instructor-paced/e2e';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const names = ['E2E Student 1', 'E2E Student 2', 'E2E Student 3'];

async function room(context) {
  const created = await context.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: {
    title: `Task04 ${Date.now()}`, mode: 'instructor', items: [
      { question_id: 'e2e-core-rw', time_limit_sec: 90, notes: 'E2E_NOTES_MARKER_LIVE <script>alert(1)</script> \\(x+1\\)' },
      { question_id: 'e2e-core-spr', time_limit_sec: 12, notes: '' }
    ]
  } });
  expect(created.status(), await created.text()).toBe(200);
  const lesson = await created.json();
  const started = await context.request.post(`/api/admin/lessons/${lesson.id}/sessions`, { headers: { Origin: ORIGIN } });
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

async function phase(page, text) { await expect(page.locator('#lesson-content')).toContainText(text); }
// 11b: the responses panel became a popup over the question, opened from the bottom bar's
// "n of N responses" button. Reveal and End now are bar clicks, which close it.
async function responses(teacher) {
  if (!await teacher.locator('#live-responses-popup').isVisible()) await teacher.locator('#live-responses').click();
  return teacher.locator('#live-responses-popup');
}
async function snapshot(page, name) { await page.screenshot({ path: `${artifacts}/${name}.png` }); }

// One real room; three isolated account sessions. No lesson state or WS frames injected by tests.
test('task04 full instructor-paced lesson, three students, secrecy and normalized SPR', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin');
  const students = [];
  try {
    const { sessionId, joinCode } = await room(admin);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const pages = [];
    const captures = [];
    for (let i = 1; i <= 3; i++) {
      const context = await newUserContext(browser, `e2e-student-${i}`); students.push(context);
      captures.push(captureLeaks(context, { phaseAware: true, peers: names.filter((_, n) => n !== i-1) }));
      const page = await context.newPage(); pages.push(page);
      await join(page, joinCode);
    }
    const [one, two, three] = pages;
    await expect(teacher.locator('#live-roster')).toContainText(names[2]);
    await snapshot(teacher, '01-lobby');
    await teacher.locator('[data-live="start"]').click();
    for (const page of pages) { await phase(page, 'ANSWERING'); await expect(page.locator('#lesson-clock')).not.toBeEmpty(); }
    await expect(teacher.locator('#live-responses')).toHaveText('0 of 3 responses');
    // Notes and the student list start closed.
    await expect(teacher.locator('#live-notes')).toHaveAttribute('aria-expanded', 'false');
    await expect(teacher.locator('#live-notes-drawer')).toBeHidden();
    const panel = await responses(teacher);
    await expect(panel.locator('[data-response="e2e-student-3"]')).toContainText('nothing');
    await expect(panel.locator('details.roster-details')).not.toHaveAttribute('open', '');
    await teacher.locator('#live-notes').click();
    await expect(teacher.locator('#live-notes-drawer')).toContainText('E2E_NOTES_MARKER_LIVE');
    expect(await teacher.locator('#body script').count()).toBe(0);
    await teacher.locator('#live-notes').click();
    await responses(teacher);
    await one.locator('[data-lesson-choice="B"]').click();
    await expect(teacher.locator('#live-responses')).toHaveText('1 of 3 responses');
    await expect(teacher.locator('[data-response="e2e-student-1"]')).toContainText('E2E Student 1selectedB');
    await expect(teacher.locator('[data-response] [aria-label="Incorrect"]')).toHaveCount(0);
    await snapshot(one, '02-selected');
    await one.locator('#lesson-lock').click();
    await expect(one.getByRole('dialog')).toContainText("Have you double checked your answer and made sure it's right?");
    await snapshot(one, '03-confirmation');
    await one.locator('#lesson-back').click({ timeout: 5000 });
    await expect(one.locator('[data-lesson-choice="B"]')).toHaveAttribute('aria-pressed', 'true');
    await one.locator('[data-lesson-choice="A"]').click();
    await expect(teacher.locator('[data-response="e2e-student-1"]')).toContainText('E2E Student 1selectedA');
    await expect(teacher.locator('[data-response] [aria-label="Correct"]')).toHaveCount(0);
    await one.locator('#lesson-lock').click();
    await one.locator('#lesson-confirm').click();
    await expect(one.locator('#lesson-content')).toContainText('Answer locked in. Waiting for time to end…');
    await expect(one.locator('[data-lesson-choice="B"]')).toBeDisabled();
    await expect(one.locator('#lesson-content')).not.toContainText('Correct answer:');
    await expect(teacher.locator('[data-response="e2e-student-1"]')).toContainText('E2E Student 1lockedA');
    await snapshot(one, '03-locked');
    await two.locator('[data-lesson-choice="B"]').click();
    await expect(teacher.locator('[data-response="e2e-student-2"]')).toContainText('E2E Student 2selectedB');
    await snapshot(teacher, '04-responses');
    await teacher.locator('[data-live="addTime"]').click();
    const afterAdd = await admin.request.get(`/api/lessons/${sessionId}`);
    expect(afterAdd.status()).toBe(200);
    const extended = (await afterAdd.json()).endsAt;
    expect(extended).toBeGreaterThan(Date.now() + 15000);
    await expect(teacher.locator('#live-timer')).not.toBeEmpty();
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    for (const page of pages) await phase(page, 'REVEALED');
    await responses(teacher);
    await expect(one.locator('[data-lesson-choice="A"] .choice')).toHaveClass(/right/);
    await expect(two.locator('[data-lesson-choice="B"] .choice')).toHaveClass(/wrong/);
    await expect(two.locator('[data-lesson-choice="A"] .choice')).toHaveClass(/right/);
    await expect(two.locator('#lesson-content')).toContainText('Correct answer: A');
    await expect(teacher.locator('[data-group="0"]')).toContainText('A1');
    await expect(teacher.locator('[data-group="1"]')).toContainText('B1');
    await expect(teacher.locator('[data-group="4"]')).toContainText('blank1');
    await expect(teacher.locator('[data-group="0"] .track > span')).toHaveAttribute('style', /width: 33\.333/);
    await expect(teacher.locator('[data-group="0"] [aria-label="Correct choice"]')).toBeVisible();
    await expect(teacher.locator('[data-response="e2e-student-1"] [aria-label="Correct"]')).toBeVisible();
    await expect(teacher.locator('[data-response="e2e-student-2"] [aria-label="Incorrect"]')).toBeVisible();
    await teacher.locator('[data-group="1"]').click();
    await expect(teacher.locator('#live-group')).toContainText('E2E Student 2');
    await expect(teacher.locator('#live-group')).not.toContainText('E2E Student 1');
    await expect(teacher.locator('#live-group')).toContainText(/\d+s/);
    await teacher.locator('[data-group="4"]').click();
    await expect(teacher.locator('#live-group')).toContainText('E2E Student 3');
    await expect(one.locator('#lesson-content')).not.toContainText('Class results');
    await teacher.locator('#live-class').check();
    await expect(one.locator('#lesson-content')).toContainText('Class results');
    await expect(one.locator('#lesson-content')).not.toContainText(names[1]);
    await snapshot(teacher, '05-reveal-distribution');
    await snapshot(two, '06-reveal-chart');
    await teacher.locator('#live-class').uncheck();
    await expect(two.locator('#lesson-content')).not.toContainText('Class results');
    await teacher.locator('[data-live="next"]').click();
    await phase(one, 'READY');
    await expect(teacher.locator('[data-live="startQuestion"]')).toBeEnabled();
    await teacher.locator('[data-live="startQuestion"]').click();
    await phase(three, 'ANSWERING');
    await expect(three.locator('#lesson-grid')).toBeEnabled();
    await one.locator('#lesson-grid').fill('1/2');
    await two.locator('#lesson-grid').fill('2/4');
    await three.locator('#lesson-grid').fill('.5');
    await expect(teacher.locator('#live-responses')).toHaveText('3 of 3 responses');
    await responses(teacher);
    await expect(teacher.locator('[data-response="e2e-student-3"]')).toContainText('E2E Student 3selected.5');
    await snapshot(three, '07-spr-answering');
    await expect(three.locator('#lesson-clock')).toHaveText('0:00', { timeout: 18000 });
    await expect(three.locator('#lesson-grid')).toBeDisabled();
    await phase(three, 'REVEALED');
    await responses(teacher);
    await expect(teacher.locator('[data-group="0"]')).toContainText('0.53');
    await expect(teacher.locator('[data-group="0"] .track > span')).toHaveAttribute('style', /width: 100%/);
    await teacher.locator('[data-group="0"]').click();
    for (const name of names) await expect(teacher.locator('#live-group')).toContainText(name);
    await expect(one.locator('#lesson-content')).toContainText('Your answer: 1/2');
    await expect(one.locator('#lesson-content')).toContainText('Incorrect');
    expect((await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).responses['e2e-student-1']['e2e-core-spr'].answer).toBe('1/2');
    await snapshot(teacher, '08-spr-distribution');
    for (const capture of captures) {
      await capture.flush();
      expect(capture.bodies.length).toBeGreaterThan(0);
      expect(capture.frames.length).toBeGreaterThan(0);
      expect(capture.violations()).toEqual([]);
    }
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('#live-timer')).toHaveText('Session ended');
  } finally { for (const context of students.reverse()) await context.close().catch(() => {}); await admin.close().catch(() => {}); }
});
