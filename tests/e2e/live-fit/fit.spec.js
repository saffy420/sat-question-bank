import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, SIZES, LONG, RW, lesson, join, openLive, shot, wordCenter, wordUnderDot, passageWords, inkProbe } from '../lessons-11-ui-polish/helpers.js';

// live-fit (PR 09): once a question is REVEALED every student's stage is laid out at the presenter's stage width, type
// size and viewport width, then scaled uniformly to the student's column, so line breaks, ink and the laser match the
// presenter's word for word. While answering the stage keeps the fluid Bluebook layout.

const STUDENTS = [['e2e-student-1', '1366x768'], ['e2e-student-2', 'z110'], ['e2e-student-3', 'z125'], ['e2e-student-4', '1920x1080']];
const PRESENTER = { passage: '#live-card .stage-passage', stem: '#live-card .lesson-stem', card: '#live-card' };
const STUDENT = { passage: '#lesson-card .stage-passage', stem: '#lesson-card .lesson-stem', card: '#lesson-card' };

async function trace(page, points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) { await page.mouse.move(x, y); await page.waitForTimeout(16); }
  await page.mouse.up();
}
const line = (from, to, step = 7) => {
  const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
  return Array.from({ length: n }, (_, k) => [from[0] + (to[0] - from[0]) * (k + 1) / n, from[1] + (to[1] - from[1]) * (k + 1) / n]);
};

// Line number of every word in reading order: a word starts a new line when its top is below the current line's by more
// than half its own height (client px, so it holds at any scale).
const lineIndex = words => {
  let n = 0, top = words[0]?.t0;
  return words.map(w => { if (w.t0 - top > (w.b - w.t0) / 2) { n++; top = w.t0; } return n; });
};
const lines = async (page, side) => [...lineIndex(await passageWords(page, side.passage)), -1, ...lineIndex(await passageWords(page, side.stem))];

// The fit state of a student's stage, in the page's CSS px.
const fitState = page => page.evaluate(() => {
  const card = document.getElementById('lesson-card'), fit = card.closest('.stage-fit'), box = card.closest('.stage-fit-box'), main = document.querySelector('.lesson-main');
  const cs = getComputedStyle(main), r = card.getBoundingClientRect();
  const content = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return {
    fitted: !!fit, w: fit ? parseFloat(fit.style.width) : null, transform: fit ? getComputedStyle(fit).transform : 'none',
    varFs: parseFloat(getComputedStyle(card).getPropertyValue('--fs')), fontSize: parseFloat(getComputedStyle(card).fontSize),
    cardW: r.width, cardH: r.height, layoutW: card.offsetWidth, boxH: box.getBoundingClientRect().height, content,
    overflow: document.getElementById('lesson-live').scrollWidth - document.getElementById('lesson-live').clientWidth
  };
});
const presenterView = teacher => teacher.locator('#live-card').evaluate(card => ({ w: Math.round(card.getBoundingClientRect().width), fs: parseFloat(getComputedStyle(card).fontSize) }));

// The word under the centre of a laser dot on any card (helpers.wordUnderDot reads the student card only).
const presenterWordUnderDot = teacher => teacher.locator('#live-card .lesson-laser').evaluate(dot => {
  const r = dot.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const caret = document.caretPositionFromPoint?.(x, y), node = caret?.offsetNode;
  if (!node || node.nodeType !== 3) return null;
  let a = caret.offset, z = caret.offset;
  while (a > 0 && /\w/.test(node.data[a - 1])) a--;
  while (z < node.data.length && /\w/.test(node.data[z])) z++;
  return node.data.slice(a, z);
});

test('presenter fit: revealed students share the presenter layout, ink and laser words; answering stays fluid', async ({ browser }) => {
  test.setTimeout(300000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const contexts = [];
  for (const [account, size] of STUDENTS) contexts.push(await newUserContext(browser, account, SIZES[size]));
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Live fit', [LONG, RW]);
    const teacher = await openLive(admin, sessionId);
    const pages = [];
    for (const context of contexts) { const page = await context.newPage(); await join(page, joinCode); pages.push(page); }
    const named = pages.map((page, i) => [STUDENTS[i][1], page]);

    // ANSWERING: today's fluid layout (no fit wrapper, no scale, the card fills the column).
    await teacher.locator('[data-live="start"]').click();
    for (const [name, page] of named) {
      await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      const f = await fitState(page);
      expect([f.fitted, f.transform], `${name} answering is fluid`).toEqual([false, 'none']);
      expect(Math.abs(f.cardW - f.content), `${name} answering card fills the column`).toBeLessThanOrEqual(1);
      expect(f.overflow, name).toBeLessThanOrEqual(0);
    }
    await shot(pages[0], 'live-fit-answering-1366');

    // REVEALED: every student lays the stage out at the presenter's width and type size, scaled to its column.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
    const view = await presenterView(teacher);
    for (const [name, page] of named) {
      await expect(page.locator('#lesson-content')).toContainText('REVEALED');
      await expect.poll(async () => (await fitState(page)).w, { message: `${name} gets the presenter width`, timeout: 8000 }).toBe(view.w);
      const f = await fitState(page);
      expect(f.fitted, name).toBe(true);
      expect(f.varFs, `${name} --fs is the presenter's`).toBeCloseTo(view.fs, 3);
      expect(f.fontSize, `${name} question type is the presenter's`).toBeCloseTo(view.fs, 3);
      expect(f.layoutW, `${name} card laid out at the presenter width`).toBe(view.w);
      // Scaled uniformly to the column, centred (it fills it), and the box takes the scaled height so the page scrolls.
      expect(Math.abs(f.cardW - f.content), `${name} scaled card fills the column`).toBeLessThanOrEqual(1);
      expect(Math.abs(f.boxH - f.cardH), `${name} box height is the scaled card height`).toBeLessThanOrEqual(1);
      expect(f.overflow, `${name} no sideways scroll`).toBeLessThanOrEqual(0);
    }

    // The same line for every word of the passage and the stem.
    const presenterLines = await lines(teacher, PRESENTER);
    expect(Math.max(...presenterLines), 'the passage runs over several lines').toBeGreaterThan(4);
    for (const [name, page] of named) expect(await lines(page, STUDENT), `${name} line of every word`).toEqual(presenterLines);
    for (const [name, page] of named) await shot(page, `live-fit-revealed-${name}`);
    await shot(teacher, 'live-fit-revealed-presenter');

    // Pen: a stroke under one presenter line covers exactly the same words on every student.
    await teacher.locator('[data-tool="pen"]').click();
    await expect(teacher.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
    const measured = await passageWords(teacher, PRESENTER.passage), at = lineIndex(measured);
    const from = measured.findIndex((w, i) => i >= 12 && at[i + 7] === at[i] && at[i - 1] !== at[i]);
    expect(from, 'a presenter line of eight words').toBeGreaterThanOrEqual(0);
    const wanted = Array.from({ length: 8 }, (_, k) => from + k);
    await wordCenter(teacher, PRESENTER.passage, measured[from].t, measured.slice(0, from).filter(w => w.t === measured[from].t).length);
    const shown = await passageWords(teacher, PRESENTER.passage), first = shown[from], last = shown[from + 7], y = (first.t0 + first.b) / 2;
    await trace(teacher, [[first.l + 2, y], ...line([first.l + 2, y], [last.r - 2, y])]);
    const covered = async (page, side) => {
      const all = await passageWords(page, side.passage);
      const probe = await inkProbe(page, side.card, { words: all });
      return probe ? all.filter((w, i) => probe.words[i]).map(w => w.i) : [];
    };
    await expect.poll(() => covered(teacher, PRESENTER), { message: 'presenter ink', timeout: 8000 }).toEqual(wanted);
    for (const [name, page] of named) await expect.poll(() => covered(page, STUDENT), { message: `${name} words under the ink`, timeout: 8000 }).toEqual(wanted);
    for (const [name, page] of named) await shot(page, `live-fit-ink-${name}`);

    // Laser: each student's dot sits on the word under the presenter's dot.
    await teacher.locator('[data-tool="laser"]').click();
    await expect(teacher.locator('[data-tool="laser"]')).toHaveAttribute('aria-pressed', 'true');
    for (const [scope, word] of [[PRESENTER.passage, 'forest'], [PRESENTER.passage, 'seedling'], [PRESENTER.passage, 'defenses'], ['#live-card .stage-question', 'conforms']]) {
      const point = await wordCenter(teacher, scope, word);
      await teacher.mouse.move(point.x, point.y, { steps: 12 });
      await expect.poll(() => presenterWordUnderDot(teacher), { message: `presenter dot over "${word}"`, timeout: 4000 }).toBe(word);
      for (const [name, page] of named) {
        await expect(page.locator('#lesson-card .lesson-laser')).toBeVisible();
        await expect.poll(() => wordUnderDot(page), { message: `${name} dot over "${word}"`, timeout: 4000 }).toBe(word);
      }
    }
    await teacher.locator('[data-tool="laser"]').click();

    // A presenter resize sends a new view: students follow it and still break lines as the presenter does.
    await teacher.setViewportSize({ width: 1600, height: 900 });
    await expect.poll(async () => (await presenterView(teacher)).w, { timeout: 5000 }).not.toBe(view.w);
    const resized = await presenterView(teacher);
    for (const [name, page] of named) await expect.poll(async () => (await fitState(page)).w, { message: `${name} follows the presenter resize`, timeout: 8000 }).toBe(resized.w);
    const resizedLines = await lines(teacher, PRESENTER);
    for (const [name, page] of named) {
      expect((await fitState(page)).fontSize, `${name} type after the resize`).toBeCloseTo(resized.fs, 3);
      expect(await lines(page, STUDENT), `${name} line of every word after the presenter resize`).toEqual(resizedLines);
    }

    // Next question: back to the fluid layout while answering, then fitted again at its reveal.
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    for (const [name, page] of named) {
      await expect(page.locator('#lesson-content')).toContainText('ANSWERING');
      await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      const f = await fitState(page);
      expect([f.fitted, f.transform], `${name} next question is fluid`).toEqual([false, 'none']);
      expect(Math.abs(f.cardW - f.content), `${name} next question card fills the column`).toBeLessThanOrEqual(1);
    }
    await shot(pages[0], 'live-fit-next-answering-1366');
    await teacher.locator('[data-live="endNow"]').click();
    for (const [name, page] of named) {
      await expect(page.locator('#lesson-content')).toContainText('REVEALED');
      await expect.poll(async () => (await fitState(page)).fitted, { message: `${name} fitted at the next reveal`, timeout: 8000 }).toBe(true);
    }
  } finally { await admin.close(); await Promise.all(contexts.map(c => c.close())); }
});
