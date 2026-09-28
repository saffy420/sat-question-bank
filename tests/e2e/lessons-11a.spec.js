import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from './lessons-00b-e2e-harness/auth.js';

const artifacts = '.omp/pipeline/lessons-11a-bugfixes/e2e';
const INSTRUCTOR = { viewport: { width: 1920, height: 1080 } };
// Browser zoom at 110% on a 1366×768 screen: a 1242×698 CSS-px viewport drawn at 1.1 device pixels.
const ZOOM_110 = { viewport: { width: 1242, height: 698 }, deviceScaleFactor: 1.1 };

async function lesson(admin, title, questionIds, mode = 'instructor') {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: {
    title: `${title} ${Date.now()}`, mode, items: questionIds.map(question_id => ({ question_id, time_limit_sec: 90, notes: '' }))
  } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
}

async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}

// Client point at the middle of `word` (nth occurrence) inside `scope` of the page.
async function wordCenter(page, scope, word, nth = 0) {
  return page.locator(scope).evaluate((root, [word, nth]) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node, seen = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('.katex')) continue;
      const re = new RegExp(`\\b${word}\\b`, 'g');
      let m;
      while ((m = re.exec(node.data))) {
        if (seen++ < nth) continue;
        const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + word.length);
        range.startContainer.parentElement.scrollIntoView({ block: 'center' });
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    throw Error(`word missing: ${word}`);
  }, [word, nth]);
}

// The word under the centre of the student's laser dot (the dot itself ignores pointer hits).
async function wordUnderDot(page) {
  return page.locator('#lesson-card .lesson-laser').evaluate(dot => {
    dot.scrollIntoView({ block: 'center' });
    const r = dot.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const caret = document.caretPositionFromPoint?.(x, y);
    const node = caret?.offsetNode;
    if (!node || node.nodeType !== 3) return null;
    // Only a hit when the caret's character box actually contains the point.
    for (const at of [caret.offset, caret.offset - 1]) {
      if (at < 0 || at >= node.length) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect();
      if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) {
        const text = node.data;
        let a = at, b = at;
        while (a > 0 && /\w/.test(text[a - 1])) a--;
        while (b < text.length && /\w/.test(text[b])) b++;
        return text.slice(a, b);
      }
    }
    return null;
  });
}

test('A3 laser lands on the same word at 1366×768 and 110% zoom (passage and figure questions)', async ({ browser }) => {
  test.setTimeout(150000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const plain = await newUserContext(browser, 'e2e-student-1');
  const zoomed = await newUserContext(browser, 'e2e-student-2', ZOOM_110);
  // School Wi-Fi delivers the presenter's ~30 Hz laser frames in bursts: hold them and send every 120 ms.
  await admin.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols); this.burst = [];
        setInterval(() => { const burst = this.burst; this.burst = []; for (const frame of burst) if (this.readyState === 1) super.send(frame); }, 120);
      }
      send(frame) { if (String(frame).startsWith('{"type":"laser"')) this.burst.push(frame); else super.send(frame); }
    };
  });
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11a laser', ['e2e-unused', 'e2e-used-other']);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const students = [await plain.newPage(), await zoomed.newPage()];
    for (const page of students) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of students) await expect(page.locator('#lesson-content')).toContainText('REVEALED');
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
    await teacher.locator('[data-tool="laser"]').click();

    // The pointer travels from word to word and rests. Each student's dot must reach the resting word
    // well inside the presenter's 2.5 s idle heartbeat, which used to hide a dropped final frame.
    const check = async (scope, words, label) => {
      for (const word of words) {
        const at = await wordCenter(teacher, scope, word);
        await teacher.mouse.move(at.x, at.y, { steps: 12 });
        for (const page of students) {
          await expect(page.locator('#lesson-card .lesson-laser')).toBeVisible();
          await expect.poll(() => wordUnderDot(page), { message: `${label}: ${word} on ${page === students[0] ? '1366×768' : '110% zoom'}`, timeout: 1500 }).toBe(word);
        }
      }
    };
    await check('#live-card .stage-passage', ['plants', 'another', 'forest', 'defenses', 'seedling'], 'passage');
    await check('#live-card .stage-question', ['conforms', 'Standard'], 'prompt');
    for (const [i, page] of students.entries()) await page.screenshot({ path: `${artifacts}/A3-laser-passage-${i ? 'zoom110' : '1366'}.png` });

    await teacher.locator('[data-tool="laser"]').click();
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of students) await expect(page.locator('#lesson-card img')).toBeVisible();
    await expect(teacher.locator('#live-card img')).toBeVisible();
    await teacher.locator('[data-tool="laser"]').click();
    await check('#live-card .stage-question', ['chart', 'hours', 'goal'], 'figure question');
    for (const [i, page] of students.entries()) await page.screenshot({ path: `${artifacts}/A3-laser-figure-${i ? 'zoom110' : '1366'}.png` });
  } finally { await admin.close(); await plain.close(); await zoomed.close(); }
});

const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr';
const roomSocket = /\/api\/lessons\/\d+\/ws/;
const struckFor = page => page.locator('#lesson-card .stage-choice.eliminated').evaluateAll(rows => rows.map(r => r.dataset.choice));
const ownStruck = page => page.locator('#lesson-card .stage-choice.struck').evaluateAll(rows => rows.map(r => r.dataset.choice));

// Every lesson socket of this context goes through a proxy the test can close, as Wi-Fi would.
function proxy(context) {
  const link = { server: null };
  return context.routeWebSocket(roomSocket, ws => { link.server = ws.connectToServer(); }).then(() => link);
}

test('A1 instructor eliminations reach every student, survive reconnect and reach My Lessons; own cross-outs stay private', async ({ browser }) => {
  test.setTimeout(150000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const oneContext = await newUserContext(browser, 'e2e-student-1');
  const twoContext = await newUserContext(browser, 'e2e-student-2', ZOOM_110);
  const link = await proxy(twoContext);
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11a eliminate', [RW, MATH]);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const one = await oneContext.newPage(), two = await twoContext.newPage();
    for (const page of [one, two]) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    for (const page of [one, two]) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');

    // The ABC toggle opens the ⊖ buttons; ⊖ B crosses B out for the class.
    await teacher.locator('#live-card .stage-strike-toggle').click();
    await teacher.locator('#live-card [data-strike="B"]').click();
    await expect(teacher.locator('#live-card .stage-choice[data-choice="B"]')).toHaveClass(/eliminated|struck/);
    for (const page of [one, two]) await expect.poll(() => struckFor(page)).toEqual(['B']);
    await expect(one.locator('#lesson-card .stage-choice[data-choice="B"] .choice')).toHaveCSS('opacity', '0.5');
    await one.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await one.screenshot({ path: `${artifacts}/A1-student-sees-B-struck.png` });
    await teacher.locator('#live-card .choices').scrollIntoViewIfNeeded();
    await teacher.screenshot({ path: `${artifacts}/A1-instructor-strikes-B-1920.png` });

    // A student's own cross-out stays theirs: not on the instructor's card or the other student's.
    await one.locator('#lesson-card .stage-strike-toggle').click();
    await one.locator('#lesson-card [data-strike="C"]').click();
    await expect.poll(() => ownStruck(one)).toEqual(['C']);
    await expect.poll(() => struckFor(one)).toEqual(['B']);
    expect(await ownStruck(two)).toEqual([]);
    expect(await struckFor(two)).toEqual(['B']);
    await expect(teacher.locator('#live-card .stage-choice[data-choice="C"]')).not.toHaveClass(/struck|eliminated/);
    // Their own ⊖ B is untouched by the instructor's.
    await expect(one.locator('#lesson-card [data-strike="B"]')).toHaveAttribute('aria-pressed', 'false');

    // Student two drops off; D is crossed out and B restored while they are away.
    await link.server.close({ code: 1000, reason: 'wifi off' });
    await twoContext.setOffline(true);
    await expect(two.locator('#lesson-connection')).toHaveAttribute('aria-label', 'Reconnecting…');
    await teacher.locator('#live-card [data-strike="D"]').click();
    await teacher.locator('#live-card [data-strike="B"]').click();
    await expect.poll(() => struckFor(one)).toEqual(['D']);
    expect(await struckFor(two)).toEqual(['B']);
    await twoContext.setOffline(false);
    await expect(two.locator('#lesson-connection')).toHaveAttribute('aria-label', 'Connected', { timeout: 20000 });
    await expect.poll(() => struckFor(two)).toEqual(['D']);
    // A full reload and rejoin gets them from the snapshot as well.
    await two.reload(); await join(two, joinCode);
    await expect.poll(() => struckFor(two)).toEqual(['D']);
    await two.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await two.screenshot({ path: `${artifacts}/A1-reconnected-student-110.png` });
    // The instructor's own reload keeps the shared list (the room owns it).
    await teacher.reload();
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    await expect(teacher.locator('#live-card .stage-choice.struck')).toHaveCount(1);
    await expect(teacher.locator('#live-card .stage-choice.struck')).toHaveAttribute('data-choice', 'D');

    // Reveal: the Strikethrough tool on text inside a choice, dragged with the mouse, reaches students.
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of [one, two]) await expect(page.locator('.lesson-phase')).toHaveText('REVEALED');
    await expect.poll(() => struckFor(one)).toEqual(['D']);
    await teacher.locator('[data-tool="strike"]').click();
    const word = await teacher.locator('#live-card [data-ann-node="c:C"]').evaluate(node => {
      node.scrollIntoView({ block: 'center' });
      const range = document.createRange(); range.selectNodeContents(node);
      const r = range.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    await teacher.mouse.move(word.x + 1, word.y); await teacher.mouse.down();
    await teacher.mouse.move(word.x + word.w - 1, word.y, { steps: 6 }); await teacher.mouse.up();
    for (const page of [teacher, one, two]) {
      const mark = page.locator(`${page === teacher ? '#live-card' : '#lesson-card'} [data-ann-node="c:C"] [data-ann-mark]`);
      await expect(mark).toHaveText('vague');
      await expect(mark).toHaveCSS('text-decoration-line', 'line-through');
    }
    await one.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await one.screenshot({ path: `${artifacts}/A1-student-choice-strikethrough.png` });

    // Next saves the question; End session opens My Lessons, where D is still crossed out.
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await oneContext.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await expect(one.locator('#lesson-live')).toBeHidden();
    await one.locator('.nav-i[data-tab="lessons"]').click();
    await one.locator(`#lessons-table tr[data-session="${sessionId}"]`).click({ timeout: 10000 });
    await expect(one.locator('#lesson-card[data-ready]')).toBeVisible();
    await expect.poll(() => struckFor(one)).toEqual(['D']);
    await expect(one.locator('#lesson-card [data-ann-node="c:C"] [data-ann-mark]')).toHaveText('vague');
    await one.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await one.screenshot({ path: `${artifacts}/A1-my-lessons-history.png` });
  } finally { await admin.close(); await oneContext.close(); await twoContext.close(); }
});

test('A1 eliminations sync in self-paced review mode', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const context = await newUserContext(browser, 'e2e-student-4');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11a review eliminate', [RW, MATH], 'self');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const student = await context.newPage(); await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#self-nav')).toHaveText('Question 1 of 2');
    await student.locator('[data-lesson-choice="B"]').click();
    await student.locator('#self-next').click();
    await student.locator('[data-lesson-choice="A"]').click();
    await student.locator('#self-next').click();
    await student.locator('#self-submit').click();
    await student.locator('#self-confirm').click();
    await expect(teacher.locator('#review-summary')).toBeVisible();
    await teacher.locator('#review-target').selectOption(RW);
    await teacher.locator('[data-live="goto"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVIEW');
    await teacher.locator('#live-card .stage-strike-toggle').click();
    await teacher.locator('#live-card [data-strike="C"]').click();
    await expect.poll(() => struckFor(student)).toEqual(['C']);
    await student.locator('#lesson-card .choices').scrollIntoViewIfNeeded();
    await student.screenshot({ path: `${artifacts}/A1-review-mode.png` });
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="endSession"]').click();
  } finally { await admin.close(); await context.close(); }
});

test('A2 every presenter tool shows its own indicator', async ({ browser }) => {
  test.setTimeout(90000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  try {
    const { sessionId } = await lesson(admin, 'Task11a tools', [RW]);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await teacher.locator('[data-live="start"]').click();
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('#live-tools')).toBeVisible();
    const card = teacher.locator('#live-card');
    // Highlight and Strikethrough cursors carry their own icon's path (lesson.css); pen, eraser and
    // laser point with a crosshair. The pressed button shows the tool's own icon.
    const signature = { pen: 'crosshair', highlight: 'M3 29.5h11', strike: 'M16 4H9', erase: 'crosshair', laser: 'crosshair' };
    for (const [tool, path] of Object.entries(signature)) {
      await teacher.locator(`[data-tool="${tool}"]`).click();
      await expect(teacher.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(teacher.locator('#live-tools [aria-pressed="true"][data-tool]')).toHaveCount(1);
      await expect(teacher.locator(`[data-tool="${tool}"] svg`)).toHaveClass(new RegExp(`lucide-${{ pen: 'pen-line', highlight: 'highlighter', strike: 'strikethrough', erase: 'eraser', laser: 'focus' }[tool]}\\b`));
      const cursor = decodeURIComponent(await card.evaluate(el => getComputedStyle(el).cursor)).replace(/\\/g, '');
      expect(cursor, tool).toContain(path);
      if (path === 'crosshair') expect(cursor, tool).toBe('crosshair');
      for (const other of ['highlight', 'strike']) if (other !== tool) expect(cursor, `${tool} shows ${other}`).not.toContain(signature[other]);
      if (tool === 'strike') await teacher.screenshot({ path: `${artifacts}/A2-strikethrough-selected.png`, clip: await teacher.locator('#live-tools').boundingBox() });
    }
    // Text under Highlight and Strikethrough takes the I-beam; turning the tool off clears the indicator.
    for (const tool of ['highlight', 'strike']) {
      await teacher.locator(`[data-tool="${tool}"]`).click();
      expect(decodeURIComponent(await card.locator('[data-ann-node="s:0"]').evaluate(el => getComputedStyle(el).cursor))).toContain('M5 3h10M5 29h10M10 3v26');
      await teacher.locator(`[data-tool="${tool}"]`).click();
    }
    await expect(teacher.locator('#live-tools [aria-pressed="true"][data-tool]')).toHaveCount(0);
    expect(await card.evaluate(el => getComputedStyle(el).cursor)).toBe('auto');
  } finally { await admin.close(); }
});

test('A4 builder filter panels: checkbox beside a wrapped label, no clipping, no sideways scroll, on screen at 1366', async ({ browser }) => {
  test.setTimeout(60000);
  const admin = await newUserContext(browser, 'e2e-admin');
  try {
    const page = await admin.newPage();
    for (const path of ['/admin/lessons/new', '/admin/questions']) {
      await page.goto(path);
      await expect(page.locator('#results [data-preview]').first()).toBeVisible();
      for (const name of ['Domain', 'Skill', 'Difficulty']) {
        const details = page.locator('.multi details').filter({ has: page.locator('summary', { hasText: name }) });
        await details.locator('summary').click();
        const panel = details.locator('.options');
        await expect(panel).toBeVisible();
        const m = await details.evaluate(d => {
          const panel = d.querySelector('.options'), trigger = d.querySelector('summary').getBoundingClientRect(), box = panel.getBoundingClientRect();
          return { trigger: trigger.width, box: { left: box.left, right: box.right, width: box.width }, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, vw: document.documentElement.clientWidth,
            labels: [...panel.querySelectorAll('label')].map(label => {
              const input = label.querySelector('input').getBoundingClientRect(), text = document.createRange();
              text.selectNodeContents(label); text.setStartAfter(label.querySelector('input'));
              const rects = [...text.getClientRects()], l = label.getBoundingClientRect();
              return { text: label.textContent, label: { left: l.left, right: l.right }, input: { left: input.left, right: input.right, width: input.width },
                textLeft: Math.min(...rects.map(r => r.left)), textRight: Math.max(...rects.map(r => r.right)), lines: new Set(rects.map(r => Math.round(r.top))).size, overflow: label.scrollWidth - label.clientWidth };
            }) };
        });
        const where = `${path} ${name}`;
        expect(m.labels.length, where).toBeGreaterThan(0);
        expect(m.scrollWidth, where).toBe(m.clientWidth);
        expect(m.box.width, where).toBeGreaterThanOrEqual(m.trigger - 0.5);
        expect(m.box.left, where).toBeGreaterThanOrEqual(0);
        expect(m.box.right, where).toBeLessThanOrEqual(m.vw);
        for (const l of m.labels) {
          expect(l.input.width, `${where} ${l.text}`).toBeLessThanOrEqual(20);
          expect(l.input.left - l.label.left, `${where} ${l.text} checkbox at the left`).toBeLessThanOrEqual(12);
          expect(l.textLeft - l.input.right, `${where} ${l.text} label beside checkbox`).toBeLessThanOrEqual(14);
          expect(l.textLeft, `${where} ${l.text}`).toBeGreaterThan(l.input.right);
          expect(l.textRight, `${where} ${l.text} inside panel`).toBeLessThanOrEqual(m.box.right);
          expect(l.label.right, `${where} ${l.text} inside panel`).toBeLessThanOrEqual(m.box.right);
          expect(l.overflow, `${where} ${l.text} not cut off`).toBeLessThanOrEqual(0);
        }
        if (path === '/admin/lessons/new') await page.screenshot({ path: `${artifacts}/A4-${name.toLowerCase()}-panel-1366.png` });
        await details.locator('summary').click();
      }
    }
  } finally { await admin.close(); }
});

async function outage(context, page, link) {
  await link.server.close({ code: 1000, reason: 'wifi off' });
  await context.setOffline(true);
  await expect(page.locator('#lesson-connection')).toHaveAttribute('aria-label', 'Reconnecting…');
}

test('A5 End session sends connected and offline students to /app (instructor-paced)', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const onContext = await newUserContext(browser, 'e2e-student-1');
  const offContext = await newUserContext(browser, 'e2e-student-2');
  const link = await proxy(offContext);
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11a end', [RW, MATH]);
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    const on = await onContext.newPage(), off = await offContext.newPage();
    for (const page of [on, off]) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await on.locator('[data-lesson-choice="A"]').click();
    await off.locator('[data-lesson-choice="C"]').click();
    const room = async () => (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    await expect.poll(async () => (await room()).responses['e2e-student-2']?.[RW]?.answer).toBe('C');
    await expect.poll(async () => (await room()).responses['e2e-student-1']?.[RW]?.answer).toBe('A');
    await outage(offContext, off, link);
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('#body')).toContainText('ENDED');
    // Connected: back on /app with the lesson view closed.
    await expect(on.locator('#lesson-live')).toBeHidden();
    expect(new URL(on.url()).pathname).toBe('/app');
    await expect(on.locator('#join-lesson')).toBeVisible();
    await on.screenshot({ path: `${artifacts}/A5-connected-student-released.png` });
    // Offline through the end: released as soon as the reconnect reaches the ended room.
    await expect(off.locator('#lesson-live')).toBeVisible();
    await offContext.setOffline(false);
    await expect(off.locator('#lesson-live')).toBeHidden({ timeout: 20000 });
    expect(new URL(off.url()).pathname).toBe('/app');
    await off.screenshot({ path: `${artifacts}/A5-offline-student-released.png` });
    // Answers saved as before: each student's final answer is in their lesson history.
    for (const [context, answer] of [[onContext, 'A'], [offContext, 'C']]) {
      await expect.poll(async () => (await context.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
      const history = await (await context.request.get(`/api/lesson-history/${sessionId}`)).json();
      expect(history.questions.find(q => q.question.id === RW).answer).toBe(answer);
    }
  } finally { await admin.close(); await onContext.close(); await offContext.close(); }
});

test('A5 End session sends self-paced students to /app, including one reconnecting', async ({ browser }) => {
  test.setTimeout(120000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const onContext = await newUserContext(browser, 'e2e-student-3');
  const offContext = await newUserContext(browser, 'e2e-student-4');
  const link = await proxy(offContext);
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11a self end', [RW, SPR], 'self');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    const on = await onContext.newPage(), off = await offContext.newPage();
    for (const page of [on, off]) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    for (const page of [on, off]) await expect(page.locator('#self-nav')).toHaveText('Question 1 of 2');
    await on.locator('[data-lesson-choice="A"]').click();
    await off.locator('[data-lesson-choice="B"]').click();
    const room = async () => (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    await expect.poll(async () => (await room()).grid?.['e2e-student-4']?.[RW]?.[0]).toBe('B');
    await expect.poll(async () => (await room()).grid?.['e2e-student-3']?.[RW]?.[0]).toBe('A');
    // First End session finishes the set (review); students stay for the review.
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SET FINISHED');
    await expect(on.locator('#self-status')).toContainText('Your answers were submitted');
    await outage(offContext, off, link);
    // Second End session ends it: everyone goes to /app.
    await teacher.locator('[data-live="endSession"]').click();
    await expect(teacher.locator('.live-top')).toContainText('SESSION ENDED');
    await expect(on.locator('#lesson-live')).toBeHidden();
    expect(new URL(on.url()).pathname).toBe('/app');
    await offContext.setOffline(false);
    await expect(off.locator('#lesson-live')).toBeHidden({ timeout: 20000 });
    expect(new URL(off.url()).pathname).toBe('/app');
    for (const [context, answer] of [[onContext, 'A'], [offContext, 'B']]) {
      await expect.poll(async () => (await context.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
      const history = await (await context.request.get(`/api/lesson-history/${sessionId}`)).json();
      expect(history.questions.find(q => q.question.id === RW).answer).toBe(answer);
    }
  } finally { await admin.close(); await onContext.close(); await offContext.close(); }
});
