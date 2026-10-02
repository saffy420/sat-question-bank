import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { LONG, lesson, join, openLive } from '../lessons-11-ui-polish/helpers.js';

// PR 08: the presenter's Projector button opens the class view in its own window, with its own read-only socket.
const ARTIFACTS = '.omp/pipeline/projector/e2e';
const shot = (page, name) => { mkdirSync(ARTIFACTS, { recursive: true }); return page.screenshot({ path: `${ARTIFACTS}/${name}.png` }); };
const red = card => card.evaluate(el => {
  const c = el.querySelector(':scope > canvas.lesson-ink');
  if (!c || !c.width) return false;
  const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < p.length; i += 4) if (p[i] === 255 && p[i + 1] === 118 && p[i + 2] === 118 && p[i + 3] > 0) return true;
  return false;
});

test('projector window: join code lobby, student view without answers, ink and laser after reveal, session end', async ({ browser }) => {
  test.setTimeout(150000);
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1600, height: 900 } });
  const studentContext = await newUserContext(browser, 'e2e-student-1');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Projector', [LONG]);
    const teacher = await openLive(admin, sessionId);
    const opened = admin.waitForEvent('page');
    await teacher.locator('#live-projector').click();
    const projector = await opened;
    await projector.setViewportSize({ width: 1280, height: 720 });
    await expect(projector).toHaveURL(new RegExp(`/admin/live/${sessionId}/projector$`));
    // Lobby: the code, how to join, the count. No admin chrome.
    await expect(projector.locator('#projector-code')).toHaveText(joinCode);
    await expect(projector.locator('.projector-lobby')).toContainText('roadto1600.org');
    await expect(projector.locator('.projector-lobby')).toContainText('Join lesson');
    await expect(projector.locator('#projector-count')).toHaveText('0 students joined');
    await expect(projector.locator('#side')).toHaveCount(0);
    await expect(projector.locator('#projector-fullscreen')).toBeVisible();
    await expect(teacher.locator('#live-link')).toHaveText('Connected');

    const student = await studentContext.newPage();
    await join(student, joinCode);
    await expect(projector.locator('#projector-count')).toHaveText('1 student joined');
    await shot(projector, '01-projector-lobby');
    // The projector is nobody's seat: the presenter still counts one student.
    await expect(teacher.locator('#live-link')).toHaveText('Connected');

    // Start: the question as students see it, without the answer, explanation or anyone's choice.
    await teacher.locator('[data-live="start"]').click();
    const card = projector.locator('#lesson-card');
    await expect(projector.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    await expect(projector.locator('#lesson-content')).toContainText('ANSWERING');
    await expect(projector.locator('.lesson-reveal')).toHaveCount(0);
    await expect(projector.locator('#lesson-lock')).toBeHidden();
    await expect(projector.locator('#projector-badge')).toContainText(joinCode);
    await expect(projector.locator('#projector-badge')).toContainText('roadto1600.org');
    const leak = await projector.evaluate(() => document.body.innerText);
    expect(leak).not.toMatch(/Correct answer|Official explanation|E2E Student/);
    await shot(projector, '02-projector-question');

    // Reveal, then the presenter draws and points.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(projector.locator('#lesson-content')).toContainText('REVEALED');
    await expect(projector.locator('.lesson-reveal')).toContainText('Correct answer');
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
    await teacher.locator('[data-tool="pen"]').click();
    const start = await teacher.locator('#live-card .lesson-stem p').first().evaluate(p => {
      const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5);
      const r = range.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await teacher.mouse.move(start.x, start.y);
    await teacher.mouse.down();
    await teacher.mouse.move(start.x + 80, start.y + 35, { steps: 8 });
    await teacher.mouse.up();
    await expect.poll(() => red(card)).toBe(true);
    await teacher.locator('[data-tool="laser"]').click();
    const box = await teacher.locator('#live-card').boundingBox();
    await teacher.mouse.move(box.x + 260, box.y + 120);
    await expect(projector.locator('#lesson-card .lesson-laser')).toBeVisible();
    await shot(projector, '03-projector-revealed-ink-laser');
    await expect(teacher.locator('#live-link')).toHaveText('Connected');

    // End: the projector says so.
    await teacher.locator('[data-live="endSession"]').click();
    await expect(projector.locator('.projector-ended')).toHaveText('Session ended');
    await shot(projector, '04-projector-ended');
  } finally {
    await Promise.all([admin.close(), studentContext.close()]);
  }
});
