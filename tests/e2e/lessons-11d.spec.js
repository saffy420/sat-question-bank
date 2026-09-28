import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from './lessons-00b-e2e-harness/auth.js';
import { captureLeaks, layerLeaks } from './lessons-00b-e2e-harness/leaks.js';

// lessons-11d: while students work, the instructor's pen, highlight, strikethrough, eliminations and laser
// stay on the instructor's screen. The reveal (timer at 0, End now) publishes them all at once; from then
// on they are live. Instructor at 1920×1080, students at 1366×768.
const artifacts = '.omp/pipeline/lessons-11d-private-annotations/e2e';
const INSTRUCTOR = { viewport: { width: 1920, height: 1080 } };
const RW = 'e2e-core-rw', MATH = 'e2e-core-math';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const highlighted = 'Careful readers compare evidence';
const later = 'Each detail helps explain';

async function lesson(admin, title, items) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: { title: `${title} ${Date.now()}`, mode: 'instructor', items } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
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
// Native selection + pointerup through the real instructor toolbar handler (as in tasks 05, 10 and 11b).
async function selectText(page, text, nth = 0) {
  await page.locator('#live-card .lesson-stem').evaluate((el, [text, nth]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, seen = 0;
    while (node = walker.nextNode()) {
      const start = node.textContent.indexOf(text);
      if (start < 0 || seen++ < nth) continue;
      node.parentElement.scrollIntoView({ block: 'center' });
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      return;
    }
    throw Error(`Fixture text missing: ${text}`);
  }, [text, nth]);
}
// Select a toolbar tool (clicking a pressed tool turns it off; highlight is the default).
async function useTool(page, tool) {
  const button = page.locator(`[data-tool="${tool}"]`);
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
// A pen gesture goes out as several stroke chunks; compare the kinds of mark.
const kinds = layer => [...new Set(layer.map(m => m.type))].sort();
const marks = page => page.locator('#lesson-card [data-ann-mark]');
const markTexts = async page => (await marks(page).allTextContents()).sort();
const eliminated = page => page.locator('#lesson-card .stage-choice.eliminated').evaluateAll(rows => rows.map(r => r.dataset.choice));
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });
// Any pixel of the default pen colour (#ff7676) on the student's ink canvas.
const inked = page => page.locator('#lesson-card canvas.lesson-ink').evaluate(el => {
  const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 118 && pixels[i + 2] === 118 && pixels[i + 3] > 0) return true;
  return false;
});
// A pen stroke across the first word of the stem, drawn with the real mouse.
async function penStroke(teacher) {
  await teacher.locator('[data-tool="pen"]').click();
  const start = await teacher.locator('#live-card .lesson-stem p').first().evaluate(p => {
    p.scrollIntoView({ block: 'center' });
    const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5);
    const r = range.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  await teacher.mouse.move(start.x, start.y); await teacher.mouse.down();
  await teacher.mouse.move(start.x + 80, start.y + 35, { steps: 8 }); await teacher.mouse.up();
}
// Ordering barrier: the room handles one message at a time and sends each socket's frames in order, so once
// this student's selection is acknowledged, every frame the instructor's earlier actions produced for them has
// arrived. Returns that frame count.
async function acknowledged(page, capture, letter) {
  const before = capture.frames.length;
  await page.locator(`#lesson-card [data-lesson-choice="${letter}"]`).click();
  await expect.poll(async () => { await capture.flush(); return capture.frames.slice(before).some(f => { try { const m = JSON.parse(f.body); return m.type === 'snapshot' && m.ownSelection === letter; } catch { return false; } }); }).toBe(true);
}
// Every instructor payload this capture received, in order.
const layerFrames = capture => capture.frames.map(f => { try { return JSON.parse(f.body); } catch { return null; } })
  .filter(m => m && (['annotate', 'laser', 'eliminations'].includes(m.type) || m.annotations?.length || m.eliminations?.length));

test('11d leak helper: instructor annotation, elimination and laser payloads before reveal are violations', () => {
  const mark = { type: 'highlight', id: 'm', nodeId: 's:1', startOffset: 0, endOffset: 4, color: '#ffe066' };
  for (const phase of ['READY', 'ANSWERING', undefined]) {
    expect(layerLeaks({ type: 'annotate', questionId: 'q', op: mark }, phase)).toEqual(['annotate frame before reveal']);
    expect(layerLeaks({ type: 'laser', questionId: 'q', hide: true }, phase)).toEqual(['laser frame before reveal']);
    expect(layerLeaks({ type: 'eliminations', questionId: 'q', letters: [] }, phase)).toEqual(['eliminations frame before reveal']);
  }
  expect(layerLeaks({ type: 'snapshot', phase: 'ANSWERING', annotations: [mark], eliminations: ['B'] }, 'REVEALED')).toEqual(['$.annotations before reveal', '$.eliminations before reveal']);
  expect(layerLeaks({ type: 'snapshot', phase: 'ANSWERING', annotations: [], eliminations: [] }, undefined)).toEqual([]);
  for (const phase of ['REVEALED', 'ENDED']) {
    expect(layerLeaks({ type: 'annotate', questionId: 'q', op: mark }, phase)).toEqual([]);
    expect(layerLeaks({ type: 'snapshot', phase, annotations: [mark], eliminations: ['B'] }, 'ANSWERING')).toEqual([]);
  }
});

test('11d checkpoint: highlight and strike while the timer runs stay private; at 0 both appear on every student on the same text; reconnects before and after', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const oneContext = await newUserContext(browser, 'e2e-student-1'), twoContext = await newUserContext(browser, 'e2e-student-2');
  const leaks = [captureLeaks(oneContext, { phaseAware: true }), captureLeaks(twoContext, { phaseAware: true })];
  try {
    // Long enough for the private work below; the reveal is the timer reaching 0, not End now.
    const { sessionId, joinCode } = await lesson(admin, 'Task11d timer', [{ question_id: RW, time_limit_sec: 40, notes: '' }]);
    const teacher = await teacherPage(admin, sessionId);
    const one = await oneContext.newPage(), two = await twoContext.newPage();
    for (const page of [one, two]) { await join(page, joinCode); expect(page.viewportSize()).toEqual({ width: 1366, height: 768 }); }
    await teacher.locator('[data-live="start"]').click();
    for (const page of [one, two]) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'ANSWERING');
    await expect(teacher.locator('.live-hidden')).toHaveText('Hidden until reveal');
    for (const tool of ['pen', 'highlight', 'strike', 'erase', 'clear', 'laser']) await expect(teacher.locator(`[data-tool="${tool}"]`)).toBeEnabled();

    // Highlight a phrase, cross out B, draw a pen stroke and point the laser, all while the timer runs.
    await useTool(teacher, 'highlight');
    await selectText(teacher, highlighted, 1);
    await expect(teacher.locator('#live-card [data-ann-mark]')).toHaveText([highlighted]);
    await teacher.locator('#live-card .stage-strike-toggle').click();
    await teacher.locator('#live-card [data-strike="B"]').click();
    await expect(teacher.locator('#live-card .stage-choice[data-choice="B"]')).toHaveClass(/struck/);
    await penStroke(teacher);
    const layer = async () => (await (await admin.request.get(`/api/lessons/${sessionId}`)).json());
    await expect.poll(async () => kinds((await layer()).annotations)).toEqual(['highlight', 'stroke']);
    await teacher.locator('[data-tool="laser"]').click();
    const card = await teacher.locator('#live-card').boundingBox();
    await teacher.mouse.move(card.x + 300, card.y + 140); await teacher.mouse.move(card.x + 320, card.y + 150, { steps: 4 });
    await expect(teacher.locator('#live-card .lesson-laser')).toBeVisible();
    await teacher.locator('[data-tool="laser"]').click();
    await expect(teacher.locator('.live-hidden')).toBeVisible();
    await teacher.locator('#live-card .choices').scrollIntoViewIfNeeded();
    await shot(teacher, 'D1-instructor-private-1920');

    // Students see none of it.
    await acknowledged(one, leaks[0], 'A'); await acknowledged(two, leaks[1], 'C');
    for (const [i, page] of [one, two].entries()) {
      await expect(marks(page)).toHaveCount(0);
      expect(await eliminated(page)).toEqual([]);
      expect(await inked(page)).toBe(false);
      await expect(page.locator('#lesson-card .lesson-laser')).toBeHidden();
      expect(layerFrames(leaks[i])).toEqual([]);
      await page.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
      await shot(page, `D1-student${i + 1}-before-reveal-1366`);
    }
    // A student who reconnects before the reveal still gets nothing.
    await two.reload(); await join(two, joinCode);
    await expect(two.locator('.lesson-phase')).toHaveText('ANSWERING');
    await acknowledged(two, leaks[1], 'D');
    await expect(marks(two)).toHaveCount(0);
    expect(await eliminated(two)).toEqual([]);
    expect(layerFrames(leaks[1])).toEqual([]);
    // The laser comes to rest on the stage and stays there through the reveal.
    const stage = await teacher.locator('#live-stage').boundingBox();
    await useTool(teacher, 'laser');
    await teacher.mouse.move(stage.x + 400, stage.y + 200); await teacher.mouse.move(stage.x + 420, stage.y + 210, { steps: 4 });
    await expect(teacher.locator('#live-card .lesson-laser')).toBeVisible();
    await acknowledged(one, leaks[0], 'B');
    await expect(one.locator('#lesson-card .lesson-laser')).toBeHidden();
    for (const capture of leaks) { await capture.flush(); expect(capture.violations()).toEqual([]); }

    // At 0 the whole layer lands on every student, on the instructor's text, and the resting laser dot with it.
    for (const page of [one, two]) await expect(page.locator('.lesson-phase')).toHaveText('REVEALED', { timeout: 45000 });
    for (const page of [one, two]) await expect(page.locator('#lesson-card .lesson-laser')).toBeVisible();
    await teacher.mouse.move(2, 2);
    for (const page of [one, two]) await expect(page.locator('#lesson-card .lesson-laser')).toBeHidden();
    await teacher.locator('[data-tool="laser"]').click();
    await expect(teacher.locator('[data-tool="laser"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(teacher.locator('.live-hidden')).toHaveCount(0);
    for (const [i, page] of [one, two].entries()) {
      await expect.poll(() => markTexts(page)).toEqual([highlighted]);
      // Same passage paragraph as the instructor's (the phrase repeats in every paragraph).
      expect(await marks(page).evaluate(el => [...el.closest('.lesson-stem').querySelectorAll('p')].indexOf(el.closest('p')))).toBe(
        await teacher.locator('#live-card [data-ann-mark]').evaluate(el => [...el.closest('.lesson-stem').querySelectorAll('p')].indexOf(el.closest('p'))));
      await expect.poll(() => eliminated(page)).toEqual(['B']);
      await expect.poll(() => inked(page)).toBe(true);
      await marks(page).scrollIntoViewIfNeeded();
      await shot(page, `D1-student${i + 1}-at-reveal-1366`);
      await page.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
      await shot(page, `D1-student${i + 1}-at-reveal-choices-1366`);
    }
    // One snapshot published everything: no annotate/eliminations frame was needed for it.
    for (const capture of leaks) {
      await capture.flush();
      const frames = layerFrames(capture);
      expect(frames[0]).toMatchObject({ type: 'snapshot', phase: 'REVEALED', eliminations: ['B'] });
      expect(kinds(frames[0].annotations)).toEqual(['highlight', 'stroke']);
      expect(capture.violations()).toEqual([]);
    }

    // From the reveal on it is live: a new highlight and a new cross-out reach students straight away.
    await useTool(teacher, 'highlight');
    await selectText(teacher, later, 3);
    await teacher.locator('#live-card [data-strike="D"]').click();
    for (const page of [one, two]) {
      await expect.poll(() => markTexts(page)).toEqual([highlighted, later].sort());
      await expect.poll(() => eliminated(page)).toEqual(['B', 'D']);
    }
    await teacher.locator('[data-tool="laser"]').click();
    await teacher.mouse.move(card.x + 300, card.y + 140); await teacher.mouse.move(card.x + 320, card.y + 150, { steps: 4 });
    await expect(one.locator('#lesson-card .lesson-laser')).toBeVisible();
    await teacher.locator('[data-tool="laser"]').click();
    // A student who reconnects after the reveal gets the full set.
    await one.reload(); await join(one, joinCode);
    await expect.poll(() => markTexts(one)).toEqual([highlighted, later].sort());
    await expect.poll(() => eliminated(one)).toEqual(['B', 'D']);
    await expect.poll(() => inked(one)).toBe(true);
    await one.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await shot(one, 'D1-student-reconnected-after-reveal-1366');
    await teacher.locator('#live-card .choices').scrollIntoViewIfNeeded();
    await shot(teacher, 'D1-instructor-revealed-1920');
    for (const capture of leaks) { await capture.flush(); expect(capture.violations()).toEqual([]); }
  } finally { await admin.close(); await oneContext.close(); await twoContext.close(); }
});

test('11d End now publishes; the next question is private again; a revisit shows the published layer and stays live', async ({ browser }) => {
  test.setTimeout(150000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-3');
  const leaks = captureLeaks(studentContext, { phaseAware: true });
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11d end now', [
      { question_id: RW, time_limit_sec: 90, notes: '' }, { question_id: MATH, time_limit_sec: 90, notes: '' }]);
    const teacher = await teacherPage(admin, sessionId);
    const pupil = await studentContext.newPage();
    await join(pupil, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(pupil.locator('.lesson-phase')).toHaveText('ANSWERING');
    await useTool(teacher, 'highlight');
    await selectText(teacher, highlighted, 2);
    await teacher.locator('#live-card .stage-strike-toggle').click();
    await teacher.locator('#live-card [data-strike="C"]').click();
    await expect(teacher.locator('#live-card .stage-choice[data-choice="C"]')).toHaveClass(/struck/);
    await acknowledged(pupil, leaks, 'B');
    expect(layerFrames(leaks)).toEqual([]);
    await expect(marks(pupil)).toHaveCount(0);

    // End now publishes it.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(pupil.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect.poll(() => markTexts(pupil)).toEqual([highlighted]);
    await expect.poll(() => eliminated(pupil)).toEqual(['C']);

    // Q2: READY and ANSWERING are private again (the indicator is back).
    await teacher.locator('[data-live="next"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'READY');
    await expect(teacher.locator('.live-hidden')).toHaveText('Hidden until reveal');
    await teacher.locator('#live-card [data-strike="A"]').click();
    await expect(teacher.locator('#live-card .stage-choice[data-choice="A"]')).toHaveClass(/struck/);
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(pupil.locator('.lesson-phase')).toHaveText('ANSWERING');
    await penStroke(teacher);
    await expect.poll(async () => kinds((await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).annotations)).toEqual(['stroke']);
    await acknowledged(pupil, leaks, 'B');
    expect(await eliminated(pupil)).toEqual([]);
    expect(await inked(pupil)).toBe(false);
    await leaks.flush(); expect(leaks.violations()).toEqual([]);
    await teacher.locator('[data-live="endNow"]').click();
    await expect(pupil.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect.poll(() => eliminated(pupil)).toEqual(['A']);
    await expect.poll(() => inked(pupil)).toBe(true);

    // Revisit Q1 (11b navigator): the published layer comes back, and new marks on it are live.
    await teacher.locator('#live-prev').click();
    await expect(pupil.locator('#lesson-card .lesson-stem')).toContainText('Which word best completes');
    await expect.poll(() => markTexts(pupil)).toEqual([highlighted]);
    await expect.poll(() => eliminated(pupil)).toEqual(['C']);
    await expect(teacher.locator('.live-hidden')).toHaveCount(0);
    await useTool(teacher, 'highlight');
    await selectText(teacher, later, 1);
    await teacher.locator('#live-card [data-strike="D"]').click();
    await expect.poll(() => markTexts(pupil)).toEqual([highlighted, later].sort());
    await expect.poll(() => eliminated(pupil)).toEqual(['C', 'D']);
    await pupil.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await shot(pupil, 'D1-student-revisit-live-1366');
    await leaks.flush(); expect(leaks.violations()).toEqual([]);
  } finally { await admin.close(); await studentContext.close(); }
});
