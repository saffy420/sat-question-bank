import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

const artifacts = '.opencode/pipeline/lessons-05-annotations/e2e';
const questionId = 'e2e-core-rw';
const highlighted = 'Careful readers compare evidence';
const struck = 'question assumptions';
const marks = page => page.locator('#lesson-card [data-ann-mark]');
const teacherMarks = page => page.locator('#live-card [data-ann-mark]');

async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}

// Select authored text via native Selection; dispatch pointerup to exercise actual toolbar handler,
// not an injected annotation frame. Stable regardless of font metrics and viewport width.
async function selectText(page, paragraph, text) {
  await page.locator(`#live-card .lesson-stem p`).nth(paragraph).evaluate((el, text) => {
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

async function texts(page) { return (await marks(page).allTextContents()).sort(); }
async function screenshot(page, name) { await page.screenshot({ path: `${artifacts}/${name}.png` }); }

// Real seeded DO/WS and independent signed-in contexts; no mocked state or annotation fan-out.
test('task05 shared highlight, strike, pen, laser, follow, reconnect and student write denial', async ({ browser }) => {
  test.setTimeout(120000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const normal = await newUserContext(browser, 'e2e-student-1');
  const zoomed = await newUserContext(browser, 'e2e-student-2');
  try {
    const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: {
      title: `Task05 ${Date.now()}`, mode: 'instructor', items: [{ question_id: questionId, time_limit_sec: 90, notes: '' }]
    } });
    expect(created.status(), await created.text()).toBe(200);
    const lesson = await created.json();
    const started = await admin.request.post(`/api/admin/lessons/${lesson.id}/sessions`, { headers: { Origin: ORIGIN } });
    expect(started.status(), await started.text()).toBe(200);
    const { sessionId, joinCode } = await started.json();
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    await normal.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url, protocols) { super(url, protocols); if (String(url).includes('/api/lessons/')) window.__lessonWire = this; }
      };
    });
    const student = await normal.newPage(); await join(student, joinCode);
    const second = await zoomed.newPage(); await join(second, joinCode);
    await second.evaluate(() => { document.documentElement.style.zoom = '110%'; });
    expect(student.viewportSize()).toEqual({ width: 1366, height: 768 });
    expect(second.viewportSize()).toEqual({ width: 1366, height: 768 });
    expect(await second.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe('1.1');
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#lesson-content')).toContainText('ANSWERING');
    await teacher.locator('[data-live="endNow"]').click();
    // 11b: the instructor's phase badge is gone; the live view carries the phase instead.
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    for (const p of [student, second]) await expect(p.locator('#lesson-content')).toContainText('REVEALED');
    await expect(student.locator('#lesson-follow')).toBeChecked();
    await expect(second.locator('#lesson-follow')).toBeChecked();
    await screenshot(teacher, '01-instructor-1920x1080-before');

    await selectText(teacher, 1, highlighted);
    await expect.poll(() => texts(student)).toEqual([highlighted]);
    await expect.poll(() => texts(second)).toEqual([highlighted]);
    await expect(teacherMarks(teacher)).toHaveText(highlighted);
    await screenshot(teacher, '02-instructor-1920x1080-highlight');
    await screenshot(student, '03-student-1366x768-highlight');
    await screenshot(second, '04-student-1366x768-110pct-highlight');

    await teacher.locator('[data-tool="strike"]').click();
    await selectText(teacher, 1, struck);
    for (const p of [student, second]) {
      await expect.poll(() => texts(p)).toEqual([highlighted, struck]);
      await expect(marks(p).filter({ hasText: struck })).toHaveCSS('text-decoration-line', 'line-through');
    }
    await screenshot(second, '05-student-110pct-strike');

    const beforeFollow = await student.locator('#lesson-live').evaluate(el => el.scrollTop);
    const target = student.locator('#lesson-card .lesson-stem p').last();
    expect(await target.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(768);
    await teacher.locator('[data-tool="highlight"]').click();
    await selectText(teacher, 24, 'Each detail helps explain');
    await expect.poll(() => texts(student)).toEqual([highlighted, 'Each detail helps explain', struck]);
    await expect.poll(() => student.locator('#lesson-live').evaluate(el => el.scrollTop)).toBeGreaterThan(beforeFollow);
    await screenshot(student, '06-student-follow-long-passage');
    await student.locator('#lesson-follow').uncheck();
    // The follow scroll above is smooth, so it can still be animating when the
    // poll at line 103 resolves. Wait for it to settle before capturing the
    // frozen baseline; the exact toBe assertion below is unchanged.
    await expect.poll(() => student.locator('#lesson-live').evaluate(el => new Promise(resolve => {
      const first = el.scrollTop; setTimeout(() => resolve(el.scrollTop === first ? 'settled' : 'moving'), 150);
    }))).toBe('settled');
    const frozenScroll = await student.locator('#lesson-live').evaluate(el => el.scrollTop);
    await selectText(teacher, 23, 'Careful readers compare evidence');
    await expect.poll(() => texts(student)).toHaveLength(4);
    await expect(student.locator('#lesson-follow')).not.toBeChecked();
    expect(await student.locator('#lesson-live').evaluate(el => el.scrollTop)).toBe(frozenScroll);

    const card = teacher.locator('#live-card');
    await teacher.locator('[data-tool="pen"]').click();
    const box = await card.boundingBox();
    // Start the stroke on the first word of the stem: pen marks are anchored to content, so every
    // client must draw it on that word even though their stage widths differ.
    const start = await teacher.locator('#live-card .lesson-stem p').first().evaluate(p => {
      const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5);
      const r = range.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await teacher.mouse.move(start.x, start.y);
    await teacher.mouse.down();
    await teacher.mouse.move(start.x + 80, start.y + 35, { steps: 8 });
    await teacher.mouse.up();
    const layer = () => admin.request.get(`/api/lessons/${sessionId}`).then(r => r.json()).then(s => s.annotations);
    await expect.poll(async () => (await layer()).filter(m => m.type === 'stroke').length).toBeGreaterThan(0);
    const strokeVisible = () => student.locator('#lesson-card canvas.lesson-ink').evaluate(el => {
      const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i+1] === 118 && pixels[i+2] === 118 && pixels[i+3] > 0) return true;
      return false;
    });
    await expect.poll(strokeVisible).toBe(true);
    await screenshot(student, '07-student-live-pen');
    // Offset (unzoomed CSS px) of the stroke's first point from the first word, as each client draws it.
    const wordOffset = (page, stroke) => page.locator(page === teacher ? '#live-card' : '#lesson-card').evaluate(async (card, stroke) => {
      const Ink = await import('/shared/annotations.js');
      const [x, y] = Ink.strokePoints(card, stroke)[0];
      const p = card.querySelector('.lesson-stem p');
      const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5);
      const word = range.getBoundingClientRect(), rect = card.getBoundingClientRect(), scale = rect.width / card.offsetWidth;
      return { x: x - (word.left - rect.left) / scale, y: y - (word.top - rect.top) / scale };
    }, stroke);
    const stroke = (await layer()).find(m => m.type === 'stroke');
    expect(stroke.a).toMatch(/^s:0@\d+$/);
    const teacherWord = await wordOffset(teacher, stroke);
    for (const page of [student, second]) {
      await expect.poll(async () => {
        const word = await wordOffset(page, stroke);
        return Math.max(Math.abs(word.x - teacherWord.x), Math.abs(word.y - teacherWord.y));
      }).toBeLessThan(2);
    }

    await teacher.locator('[data-tool="laser"]').click();
    const dot = student.locator('#lesson-card .lesson-laser');
    await teacher.mouse.move(box.x + 260, box.y + 120);
    await expect(dot).toBeVisible();
    // Idle presenter: the dot stays put (heartbeat), and hides only when the pointer leaves the stage.
    await student.waitForTimeout(3500);
    await expect(dot).toBeVisible();
    await screenshot(student, '08-student-live-laser');
    await teacher.mouse.move(2, 2);
    await expect(dot).toBeHidden();
    await teacher.mouse.move(box.x + 260, box.y + 120);
    await expect(dot).toBeVisible();
    await teacher.locator('[data-tool="laser"]').click();
    await expect(dot).toBeHidden();

    const persisted = await layer();
    expect(persisted.map(m => m.type)).toEqual(expect.arrayContaining(['highlight', 'strike', 'stroke']));
    await student.reload();
    await join(student, joinCode);
    await expect.poll(() => texts(student)).toEqual([highlighted, highlighted, 'Each detail helps explain', struck].sort());
    await expect.poll(strokeVisible).toBe(true);
    expect((await layer()).map(m => m.id)).toEqual(persisted.map(m => m.id));
    await screenshot(student, '09-student-reconnected');

    await expect(student.locator('[data-tool]')).toHaveCount(0);
    const unauthorized = { type: 'annotate', questionId, op: { type: 'stroke', id: crypto.randomUUID(), color: '#ff7676', points: [[0.5, 0.5]] } };
    const denied = student.evaluate(m => new Promise(resolve => {
      const ws = window.__lessonWire;
      const onMessage = e => { const data = JSON.parse(e.data); if (data.type === 'error') { ws.removeEventListener('message', onMessage); resolve(data.error); } };
      ws.addEventListener('message', onMessage); ws.send(JSON.stringify(m));
    }), unauthorized);
    expect(await denied).toBe('invalid action');
    expect((await layer()).map(m => m.id)).toEqual(persisted.map(m => m.id));
    await screenshot(student, '10-student-write-denied');

    await teacher.locator('[data-tool="erase"]').click();
    // The strike wraps across lines, so the union bounding box center can land
    // on a neighbouring mark. Click the middle of its first line fragment instead.
    const strikePoint = await teacherMarks(teacher).filter({ hasText: struck }).first().evaluate(el => {
      const r = el.getClientRects()[0]; return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await teacher.mouse.click(strikePoint.x, strikePoint.y);
    await expect.poll(() => texts(student)).toEqual([highlighted, highlighted, 'Each detail helps explain']);
    await expect.poll(() => texts(second)).toEqual([highlighted, highlighted, 'Each detail helps explain']);
    expect((await layer()).some(m => m.type === 'stroke')).toBe(true);
    await screenshot(student, '11-student-strike-erased');
    await teacher.locator('[data-tool="clear"]').click();
    await teacher.getByRole('dialog').getByRole('button', { name: 'Clear all', exact: true }).click();
    for (const p of [teacher, student, second]) await expect(p.locator(p === teacher ? '#live-card [data-ann-mark]' : '#lesson-card [data-ann-mark]')).toHaveCount(0);
    await expect.poll(async () => (await layer()).length).toBe(0);
    await student.reload();
    await join(student, joinCode);
    await expect(marks(student)).toHaveCount(0);
    await screenshot(student, '12-student-clear-reconnected');
  } finally { await zoomed.close(); await normal.close(); await admin.close(); }
});
