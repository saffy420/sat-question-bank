import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, LONG, zoomOpts, lesson, join, openLive, shot, wordCenter, wordUnderDot, passageWords, inkProbe } from './helpers.js';

// lessons-11-ui-polish, item 4: pen and laser tracking at any zoom, and the same words on every student's screen.
// Zoom is emulated as tests/e2e/lessons-11c.spec.js does (CSS viewport 1366/z x 768/z, deviceScaleFactor z).

const PASSAGE = '#live-card .stage-passage';
const STUDENT_PASSAGE = '#lesson-card .stage-passage';
const ZOOM_110 = zoomOpts(1.1);

// A hand-paced pointer: one move every ~16 ms (a 60 Hz mouse), so the pen's 50 ms chunks hold a few points each.
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

async function revealedRoom(browser, adminOptions, students, title, questions = [LONG]) {
  const admin = await newUserContext(browser, 'e2e-admin', adminOptions);
  const contexts = [];
  for (const [account, options] of students) contexts.push(await newUserContext(browser, account, options));
  const { sessionId, joinCode } = await lesson(admin, title, questions);
  const teacher = await openLive(admin, sessionId);
  const pages = [];
  for (const context of contexts) { const page = await context.newPage(); await join(page, joinCode); pages.push(page); }
  await teacher.locator('[data-live="start"]').click();
  await teacher.locator('[data-live="endNow"]').click();
  for (const page of pages) await expect(page.locator('#lesson-content')).toContainText('REVEALED');
  // The presenter draws privately until the room is REVEALED; a phase change during a stroke ends it, so wait for it.
  await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
  await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();
  for (const page of pages) await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
  return { admin, contexts, teacher, pages, sessionId, close: () => Promise.all([admin.close(), ...contexts.map(c => c.close())]) };
}

// Words of a phrase that sit on one line on the presenter's screen but on two lines on some student's screen (or the
// other way round), so the stroke has to follow the words, not the pixels.
function choosePhrase(perScreen) {
  // Number of text lines a run of words occupies (line spacing is over 20 px, words of one line differ by under 1 px).
  const lineOf = (words, from, len) => { const ys = words.slice(from, from + len).map(w => (w.t0 + w.b) / 2); return { size: Math.max(...ys) - Math.min(...ys) > 10 ? 2 : 1 }; };
  const [teacher, ...students] = perScreen;
  for (const len of [9, 10, 11, 12, 8, 13, 14, 7]) {
    for (let from = 12; from + len < teacher.length - 4; from++) {
      if (lineOf(teacher, from, len).size !== 1) continue;
      const wraps = students.map((words, n) => (lineOf(words, from, len).size > 1 ? n : -1)).filter(n => n >= 0);
      if (wraps.length) return { from, len, wraps };
    }
  }
  return null;
}

// Nine words on one presenter line, for when every screen breaks lines alike.
function onePhrase(words) {
  const ys = words.map(w => (w.t0 + w.b) / 2);
  for (let from = 12; from + 9 < words.length - 4; from++) if (Math.max(...ys.slice(from, from + 9)) - Math.min(...ys.slice(from, from + 9)) <= 10) return { from, len: 9, wraps: [] };
  return null;
}

for (const [label, instructor] of [['instructor at 125% zoom', zoomOpts(1.25)], ['instructor on a 1920×1080 screen', INSTRUCTOR]]) {
  test(`pen: a stroke over a phrase covers the same words on the ${label}, on a 1366×768 student and on a 110% zoom student, wherever the lines break`, async ({ browser }) => {
    test.setTimeout(180000);
    const room = await revealedRoom(browser, instructor, [['e2e-student-1', undefined], ['e2e-student-2', ZOOM_110]], 'Task11 pen words');
    const { teacher, pages: [plain, zoomed] } = room;
    try {
      await teacher.locator('[data-tool="pen"]').click();
      await expect(teacher.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
      const screens = [[teacher, PASSAGE], [plain, STUDENT_PASSAGE], [zoomed, STUDENT_PASSAGE]];
      const measured = await Promise.all(screens.map(([page, scope]) => passageWords(page, scope)));
      expect(new Set(measured.map(w => w.length)).size, 'every screen shows the same passage').toBe(1);
      // Revealed students lay the stage out as the presenter does (live-fit), so normally no phrase wraps differently;
      // one that does is still preferred, else any phrase on one presenter line. The ink must follow the words either way.
      const phrase = choosePhrase(measured) || onePhrase(measured[0]);
      expect(phrase, 'a phrase on one presenter line exists in the passage').not.toBeNull();
      const wanted = Array.from({ length: phrase.len }, (_, k) => phrase.from + k);
      console.log(`${label}: words ${wanted[0]}..${wanted.at(-1)} "${measured[0].slice(phrase.from, phrase.from + phrase.len).map(w => w.t).join(' ')}" wrap on screen(s) ${phrase.wraps.map(n => ['1366', '110%'][n]).join(', ') || 'none'}`);

      // Scroll the first word into view on the presenter, measure again, and underline the phrase along its line.
      await wordCenter(teacher, PASSAGE, measured[0][phrase.from].t, measured[0].slice(0, phrase.from).filter(w => w.t === measured[0][phrase.from].t).length);
      const words = await passageWords(teacher, PASSAGE);
      const first = words[phrase.from], last = words[phrase.from + phrase.len - 1], y = (first.t0 + first.b) / 2;
      await trace(teacher, [[first.l + 2, y], ...line([first.l + 2, y], [last.r - 2, y])]);

      // Every screen, including the presenter's own, paints ink over exactly the phrase's words, the ones that wrap included.
      for (const [page, scope, card] of [[teacher, PASSAGE, '#live-card'], [plain, STUDENT_PASSAGE, '#lesson-card'], [zoomed, STUDENT_PASSAGE, '#lesson-card']]) {
        const name = page === teacher ? 'presenter' : page === plain ? '1366×768 student' : '110% zoom student';
        await expect.poll(async () => {
          const all = await passageWords(page, scope);
          const probe = await inkProbe(page, card, { words: all });
          return probe ? all.filter((w, i) => probe.words[i]).map(w => w.i) : [];
        }, { message: `${label}: words under the ink on the ${name}`, timeout: 8000 }).toEqual(wanted);
      }
      await shot(teacher, `ink-${label.includes('125') ? 'z125' : '1920'}-instructor`);
      await shot(plain, `ink-${label.includes('125') ? 'z125' : '1920'}-student-1366`);
      await shot(zoomed, `ink-${label.includes('125') ? 'z125' : '1920'}-student-z110`);
    } finally { await room.close(); }
  });
}

for (const z of [0.8, 1, 1.1, 1.25, 1.5]) {
  test(`pen: the stroke starts under the pointer and follows it at ${Math.round(z * 100)}% zoom`, async ({ browser }) => {
    test.setTimeout(120000);
    const room = await revealedRoom(browser, zoomOpts(z), [], `Task11 pen start ${z}`);
    const { teacher, admin, sessionId } = room;
    try {
      const dpr = await teacher.evaluate(() => devicePixelRatio);
      expect(dpr).toBeCloseTo(z, 5);
      await teacher.locator('[data-tool="pen"]').click();
      const at = await wordCenter(teacher, PASSAGE, 'seedling');
      const start = [at.x, at.y], mid = [at.x + 150, at.y + 4], end = [at.x + 150, at.y + 44];
      const path = [start, ...line(start, mid), ...line(mid, end)];
      await trace(teacher, path);

      const layer = () => admin.request.get(`/api/lessons/${sessionId}`).then(r => r.json()).then(s => s.annotations.filter(m => m.type === 'stroke'));
      await expect.poll(async () => (await layer()).length).toBeGreaterThan(0);
      // The first stored point maps back to the pointer-down position within 2 px.
      const first = (await layer())[0];
      const client = await teacher.locator('#live-card').evaluate(async (card, mark) => {
        const Ink = await import('/shared/annotations.js');
        const rect = card.getBoundingClientRect(), s = Ink.scaleOf(card, rect), [x, y] = Ink.strokePoints(card, mark)[0];
        return [rect.left + x * s, rect.top + y * s];
      }, first);
      expect(Math.hypot(client[0] - start[0], client[1] - start[1]), `first point vs pointer at ${z}`).toBeLessThanOrEqual(2);

      // The painted ink starts under the pointer and stays under it along the whole path.
      const samples = [start, ...path.filter((_, i) => i % 6 === 0), mid, end];
      await expect.poll(async () => (await inkProbe(teacher, '#live-card', { points: samples, radius: 2 }))?.points.every(Boolean), { message: `ink under the pointer along its path at ${z}`, timeout: 8000 }).toBe(true);
      const probe = await inkProbe(teacher, '#live-card', { points: [start], radius: 2 });
      expect(probe.points[0], `ink under the pointer-down point at ${z}`).toBe(true);
      // No ink strays from the pointer's path by more than the pen's half width: the ink box hugs the path.
      const xs = path.map(p => p[0]), ys = path.map(p => p[1]);
      expect(probe.box.l, `ink starts at the pointer's left extreme (${z})`).toBeGreaterThanOrEqual(Math.min(...xs) - 4);
      expect(probe.box.l).toBeLessThanOrEqual(Math.min(...xs) + 1);
      expect(probe.box.r).toBeLessThanOrEqual(Math.max(...xs) + 4);
      expect(probe.box.t).toBeGreaterThanOrEqual(Math.min(...ys) - 4);
      expect(probe.box.t).toBeLessThanOrEqual(Math.min(...ys) + 1);
      expect(probe.box.b).toBeLessThanOrEqual(Math.max(...ys) + 4);
      expect(probe.box.b).toBeGreaterThanOrEqual(Math.max(...ys) - 1);
      await shot(teacher, `ink-pen-start-z${Math.round(z * 100)}`, { clip: { x: Math.max(0, at.x - 120), y: Math.max(0, at.y - 60), width: 360, height: 160 } });
    } finally { await room.close(); }
  });
}

for (const z of [0.8, 1.5]) {
  test(`laser: the presenter's dot is under the pointer and students' dots are over the same word at ${Math.round(z * 100)}% zoom`, async ({ browser }) => {
    test.setTimeout(150000);
    const room = await revealedRoom(browser, zoomOpts(z), [['e2e-student-1', undefined], ['e2e-student-2', ZOOM_110]], `Task11 laser ${z}`);
    const { teacher, pages } = room;
    try {
      await teacher.locator('[data-tool="laser"]').click();
      await expect(teacher.locator('[data-tool="laser"]')).toHaveAttribute('aria-pressed', 'true');
      const targets = [[PASSAGE, 'forest'], [PASSAGE, 'seedling'], [PASSAGE, 'defenses'], ['#live-card .stage-question', 'conforms']];
      for (const [scope, word] of targets) {
        const at = await wordCenter(teacher, scope, word);
        await teacher.mouse.move(at.x, at.y, { steps: 12 });
        // The presenter's own dot: its centre is within 2 px of the pointer (the dot glides for 50 ms, so poll).
        await expect.poll(async () => teacher.locator('#live-card .lesson-laser').evaluate((dot, p) => {
          const r = dot.getBoundingClientRect();
          return Math.round(Math.hypot(r.left + r.width / 2 - p.x, r.top + r.height / 2 - p.y) * 10) / 10;
        }, at), { message: `presenter dot vs pointer over "${word}" at ${z}`, timeout: 4000 }).toBeLessThanOrEqual(2);
        for (const [n, page] of pages.entries()) {
          await expect(page.locator('#lesson-card .lesson-laser')).toBeVisible();
          await expect.poll(() => wordUnderDot(page), { message: `student ${n ? '110% zoom' : '1366×768'} dot over "${word}" (presenter at ${z})`, timeout: 4000 }).toBe(word);
        }
      }
      await shot(teacher, `ink-laser-z${Math.round(z * 100)}-instructor`);
      await shot(pages[0], `ink-laser-z${Math.round(z * 100)}-student-1366`);
    } finally { await room.close(); }
  });
}

test('resize and zoom mid-question: the canvas re-fits the card and keeps every stroke', async ({ browser }) => {
  test.setTimeout(180000);
  const room = await revealedRoom(browser, INSTRUCTOR, [['e2e-student-1', undefined]], 'Task11 refit');
  const { teacher, pages: [student], contexts: [context] } = room;
  try {
    await teacher.locator('[data-tool="pen"]').click();
    const words = await passageWords(teacher, PASSAGE);
    const from = words.findIndex(w => w.t === 'seedling'), to = words.findIndex(w => w.t === 'shade');
    const wanted = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    await wordCenter(teacher, PASSAGE, 'seedling');
    const shown = await passageWords(teacher, PASSAGE);
    // Underline "seedling ... shade" on its line(s); a phrase across a break gets one stroke per line.
    const rows = [];
    for (const w of shown.slice(from, to + 1)) { const row = rows.find(r => Math.abs(r.y - (w.t0 + w.b) / 2) < 6); if (row) row.last = w; else rows.push({ y: (w.t0 + w.b) / 2, first: w, last: w }); }
    for (const row of rows) await trace(teacher, [[row.first.l + 2, row.y], ...line([row.first.l + 2, row.y], [row.last.r - 2, row.y])]);
    const covered = async () => {
      const all = await passageWords(student, STUDENT_PASSAGE);
      const probe = await inkProbe(student, '#lesson-card', { words: all });
      return probe ? all.filter((w, i) => probe.words[i]).map(w => w.i) : [];
    };
    await expect.poll(covered, { message: 'ink over the phrase before any resize', timeout: 8000 }).toEqual(wanted);

    const session = await context.newCDPSession(student);
    const setWindow = (width, height, deviceScaleFactor) => session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    // The canvas is exactly the card's box, and its backing store is that box in device pixels, rounded once.
    const fitted = async label => {
      const m = await student.locator('#lesson-card').evaluate(card => {
        const c = card.querySelector(':scope > canvas.lesson-ink'), r = card.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return { card: [r.width, r.height], canvas: [cr.width, cr.height], store: [c.width, c.height], dpr: devicePixelRatio, vw: innerWidth };
      });
      expect(Math.abs(m.canvas[0] - m.card[0]), `${label}: canvas CSS width vs card`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.canvas[1] - m.card[1]), `${label}: canvas CSS height vs card`).toBeLessThanOrEqual(0.5);
      expect(m.store, `${label}: backing store is round(css size x dpr) at dpr ${m.dpr}`).toEqual([Math.round(m.card[0] * m.dpr), Math.round(m.card[1] * m.dpr)]);
      return m;
    };
    const before = await fitted('1366×768 at 100%');
    expect(before.dpr).toBe(1);

    // Same CSS size, only the pixel ratio changes (browser zoom step on an unchanged layout box).
    await setWindow(1366, 768, 1.25);
    await expect.poll(async () => (await student.evaluate(() => devicePixelRatio)), { timeout: 5000 }).toBe(1.25);
    await expect.poll(async () => { const m = await fitted('pixel ratio only'); return m.store[0]; }, { message: 'backing store follows the pixel ratio', timeout: 5000 }).toBe(Math.round(before.card[0] * 1.25));
    await expect.poll(covered, { message: 'ink kept after a pixel ratio change', timeout: 8000 }).toEqual(wanted);

    // Browser zoom to 125% and 90% (new CSS size and ratio together), a plain window resize, and back.
    for (const [w, h, dpr, label] of [[1093, 614, 1.25, 'zoom 125%'], [1518, 853, 0.9, 'zoom 90%'], [1366, 768, 1, 'back to 100%']]) {
      await setWindow(w, h, dpr);
      await expect.poll(() => student.evaluate(() => [innerWidth, Math.round(devicePixelRatio * 1000) / 1000]), { timeout: 5000 }).toEqual([w, dpr]);
      await expect.poll(async () => { try { await fitted(label); return true; } catch { return false; } }, { message: `canvas re-fitted at ${label}`, timeout: 8000 }).toBe(true);
      await fitted(label);
      await expect.poll(covered, { message: `ink kept at ${label}`, timeout: 8000 }).toEqual(wanted);
      await shot(student, `ink-refit-${label.replace(/\W+/g, '-')}`);
    }
    await student.setViewportSize({ width: 1200, height: 700 });
    await expect.poll(async () => { try { await fitted('setViewportSize 1200×700'); return true; } catch { return false; } }, { message: 'canvas re-fitted after setViewportSize', timeout: 8000 }).toBe(true);
    await expect.poll(covered, { message: 'ink kept after setViewportSize', timeout: 8000 }).toEqual(wanted);
    await session.detach();
  } finally { await room.close(); }
});
