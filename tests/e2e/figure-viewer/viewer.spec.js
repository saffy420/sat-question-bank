import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, lesson, join, openLive, inkProbe } from '../lessons-11-ui-polish/helpers.js';

// figure-viewer: one viewer for every math figure (bank practice, lesson student, instructor and history).
// Checkpoints A–D follow the Bluebook screenshots: A 100 % in its frame, B 125 % clipped and draggable,
// C the Full Screen tooltip, D the full-screen overlay at 200 %.
const FIG = 'e2e-fig-math';
const SHOTS = 'docs/lessons/figure-viewer';
const FIXTURE = fileURLToPath(new URL('./scatter.svg', import.meta.url));
const shot = (page, name, options = {}) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png`, ...options }); };

// The seeded question's figure is /qimg/e2e-fig-math.svg; every hit is counted so "no extra requests" is measured.
async function serveFigure(context) {
  const hits = [];
  await context.route('**/qimg/e2e-fig-math.svg', route => { hits.push(route.request().url()); return route.fulfill({ path: FIXTURE, contentType: 'image/svg+xml' }); });
  return hits;
}

// Geometry of one viewer, in client px. `centre` is the point of the figure (as a fraction of the image) under the
// frame's centre, the point zoom must keep fixed.
const geo = (page, scope) => page.locator(scope).evaluate(fv => {
  const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
  const view = fv.querySelector('.fv-view'), img = fv.querySelector('.fv-content > img');
  const g = { frame: r(fv), view: r(view), img: r(img), pct: fv.querySelector('.fv-pct').textContent, overflow: getComputedStyle(view).overflow };
  g.centre = [(g.view.cx - g.img.x) / g.img.w, (g.view.cy - g.img.y) / g.img.h];
  return g;
});
async function drag(page, from, by, steps = 8) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(from[0] + by[0] * k / steps, from[1] + by[1] * k / steps);
  await page.mouse.up();
}
// Where a drag of d should move the image edge: the offset from centred, plus d, clamped so no gap opens.
const moveBy = (g, axis, d) => {
  const [pos, size, c] = axis === 'x' ? ['x', 'w', 'cx'] : ['y', 'h', 'cy'];
  const max = Math.max(0, (g.img[size] - g.view[size]) / 2), offset = g.img[c] - g.view[c];
  return Math.min(max, Math.max(-max, offset + d)) - offset;
};
const near = (a, b, tolerance, message) => expect(Math.abs(a - b), `${message}: ${a} vs ${b}`).toBeLessThanOrEqual(tolerance);

// A (100 %), B (125 %: same frame, bigger clipped image, centre fixed, drag), 200 % pan to both clamps, Reset,
// C (tooltip), D (overlay at 200 % with pan), Esc and X, keyboard. `scope` is the page's single `.fv`.
async function exercise(page, scope, prefix, { touch = false } = {}) {
  const fv = page.locator(scope);
  const button = act => fv.locator(`[data-fv="${act}"]`);

  // A — toolbar order and the fitted figure.
  const labels = await fv.locator('.fv-bar > *').evaluateAll(nodes => nodes.map(n => n.classList.contains('fv-div') ? '|' : n.getAttribute('aria-label') || n.textContent.trim()));
  expect(labels).toEqual(['Zoom in', 'Zoom out', '100%', 'Reset', '|', 'Full Screen']);
  const a = await geo(page, scope);
  expect(a.pct).toBe('100%');
  expect(a.overflow).toBe('hidden');
  for (const [k, edge] of [['x', 'x'], ['y', 'y']]) expect(a.img[k], `image inside the frame (${edge})`).toBeGreaterThanOrEqual(a.view[k] - 0.5);
  expect(a.img.r).toBeLessThanOrEqual(a.view.r + 0.5);
  expect(a.img.b).toBeLessThanOrEqual(a.view.b + 0.5);
  near(a.img.cx, a.view.cx, 1, 'figure centred in its frame (x)');
  near(a.img.cy, a.view.cy, 1, 'figure centred in its frame (y)');
  await fv.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await shot(page, `${prefix}-A-100`);

  // B — 125 %: the frame keeps its size, the image grows 1.25x and is clipped, the centre point stays put.
  await button('in').click();
  await expect(fv.locator('.fv-pct')).toHaveText('125%');
  const b = await geo(page, scope);
  for (const k of ['x', 'y', 'w', 'h']) near(b.frame[k], a.frame[k], 0.5, `frame ${k} unchanged at 125 %`);
  near(b.img.w, a.img.w * 1.25, 1, 'image width at 125 %');
  near(b.img.h, a.img.h * 1.25, 1, 'image height at 125 %');
  expect(b.img.h > b.view.h || b.img.w > b.view.w, 'the zoomed image overflows the frame (clipped)').toBe(true);
  near(b.centre[0] * a.img.w, a.centre[0] * a.img.w, 1, 'centre point x fixed');
  near(b.centre[1] * a.img.h, a.centre[1] * a.img.h, 1, 'centre point y fixed');
  // Drag moves the figure with the pointer (within the clamp).
  await drag(page, [b.view.cx, b.view.cy], [-12, -10]);
  const moved = await geo(page, scope);
  near(moved.img.x - b.img.x, moveBy(b, 'x', -12), 1, 'drag x at 125 % (clamped)');
  near(moved.img.y - b.img.y, moveBy(b, 'y', -10), 1, 'drag y at 125 %');
  expect(Math.abs(moved.img.y - b.img.y), 'the figure really moved').toBeGreaterThan(5);
  await page.mouse.move(1, 1);
  await shot(page, `${prefix}-B-125`);

  // 200 %: pan to each clamp; the image edge meets the frame edge and no gap opens.
  await button('in').click(); await button('in').click(); await button('in').click();
  await expect(fv.locator('.fv-pct')).toHaveText('200%');
  const z2 = await geo(page, scope);
  near(z2.img.w, a.img.w * 2, 1, 'image width at 200 %');
  await drag(page, [z2.view.cx, z2.view.cy], [30, 25]);
  const step = await geo(page, scope);
  near(step.img.x - z2.img.x, moveBy(z2, 'x', 30), 1, 'drag x at 200 %');
  near(step.img.y - z2.img.y, moveBy(z2, 'y', 25), 1, 'drag y at 200 %');
  expect(step.img.x - z2.img.x, 'a 30 px drag at 200 % is not clamped').toBeCloseTo(30, 0);
  await drag(page, [z2.view.cx, z2.view.cy], [900, 900]);
  const topLeft = await geo(page, scope);
  near(topLeft.img.x, Math.max(topLeft.view.x, topLeft.view.cx - topLeft.img.w / 2), 1, 'left clamp');
  near(topLeft.img.y, Math.max(topLeft.view.y, topLeft.view.cy - topLeft.img.h / 2), 1, 'top clamp');
  await drag(page, [z2.view.cx, z2.view.cy], [-900, -900]);
  const bottomRight = await geo(page, scope);
  near(bottomRight.img.r, Math.min(bottomRight.view.r, bottomRight.view.cx + bottomRight.img.w / 2), 1, 'right clamp');
  near(bottomRight.img.b, Math.min(bottomRight.view.b, bottomRight.view.cy + bottomRight.img.h / 2), 1, 'bottom clamp');
  if (touch) {
    // A touch drag pans too (CDP touch input, as on a Chromebook touchscreen).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const t0 = await geo(page, scope), [x, y] = [t0.view.cx, t0.view.cy];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 5 * k, y: y + 4 * k }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const t1 = await geo(page, scope);
    near(t1.img.x - t0.img.x, moveBy(t0, 'x', 30), 1.5, 'touch drag x');
    near(t1.img.y - t0.img.y, moveBy(t0, 'y', 24), 1.5, 'touch drag y');
    expect(Math.hypot(t1.img.x - t0.img.x, t1.img.y - t0.img.y), 'touch moved the figure').toBeGreaterThan(10);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.detach();
  }

  // Reset: 100 %, centred.
  await button('reset').click();
  await expect(fv.locator('.fv-pct')).toHaveText('100%');
  const reset = await geo(page, scope);
  for (const k of ['x', 'y', 'w', 'h']) near(reset.img[k], a.img[k], 0.5, `reset image ${k}`);

  // C — the Full Screen tooltip on hover and on keyboard focus.
  await button('full').hover();
  expect(await button('full').evaluate(el => getComputedStyle(el, '::after').content)).toBe('"Full Screen"');
  await shot(page, `${prefix}-C-tooltip`, { clip: { x: Math.max(0, a.frame.x - 40), y: Math.max(0, a.frame.y - 60), width: a.frame.w + 80, height: Math.min(a.frame.h + 80, 700) } });

  // D — full screen: modal overlay over the whole app, figure larger and centred, toolbar top right with a close X.
  await button('in').click();
  await button('full').click();
  const overlay = page.locator('dialog.fv-overlay');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(d => d.matches(':modal'))).toBe(true);
  const viewport = page.viewportSize();
  const cover = await overlay.evaluate(d => { const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, dim: getComputedStyle(d, '::backdrop').backgroundColor }; });
  expect(cover).toMatchObject({ x: 0, y: 0, w: viewport.width, h: viewport.height });
  expect(cover.dim).toMatch(/rgba\(\d+, \d+, \d+, 0\.\d+\)/);
  const big = await geo(page, 'dialog.fv-overlay .fv');
  expect(big.pct, 'the overlay opens at 100 %').toBe('100%');
  expect(big.img.h, 'larger than in the frame').toBeGreaterThan(a.img.h * 1.3);
  near(big.img.cx, viewport.width / 2, 2, 'overlay figure centred (x)');
  near(big.img.cy, viewport.height / 2, 2, 'overlay figure centred (y)');
  const bar = await overlay.locator('.fv-bar').evaluate(el => { const r = el.getBoundingClientRect(); return { r: r.right, t: r.top }; });
  expect(viewport.width - bar.r).toBeLessThanOrEqual(24);
  expect(bar.t).toBeLessThanOrEqual(24);
  const labels2 = await overlay.locator('.fv-bar > *').evaluateAll(nodes => nodes.map(n => n.classList.contains('fv-div') ? '|' : n.getAttribute('aria-label') || n.textContent.trim()));
  expect(labels2).toEqual(['Zoom in', 'Zoom out', '100%', 'Reset', '|', 'Close full screen']);
  for (let k = 0; k < 4; k++) await overlay.locator('[data-fv="in"]').click();
  await expect(overlay.locator('.fv-pct')).toHaveText('200%');
  const fullZ = await geo(page, 'dialog.fv-overlay .fv');
  near(fullZ.img.w, big.img.w * 2, 1, 'overlay image at 200 %');
  near(fullZ.img.cx, viewport.width / 2, 2, 'overlay 200 % still centred');
  expect(fullZ.img.h, 'at 200 % the figure fills most of the screen').toBeGreaterThan(viewport.height * 0.6);
  await page.mouse.move(2, viewport.height - 2);
  await shot(page, `${prefix}-D-fullscreen-200`);
  // Pan works the same inside: at 300 % the figure overflows the screen and drags, clamped at its edges.
  for (let k = 0; k < 4; k++) await overlay.locator('[data-fv="in"]').click();
  await expect(overlay.locator('.fv-pct')).toHaveText('300%');
  const full3 = await geo(page, 'dialog.fv-overlay .fv');
  await drag(page, [full3.view.cx, full3.view.cy], [-60, -40]);
  const fullMoved = await geo(page, 'dialog.fv-overlay .fv');
  near(fullMoved.img.x - full3.img.x, moveBy(full3, 'x', -60), 1, 'overlay pan x');
  near(fullMoved.img.y - full3.img.y, moveBy(full3, 'y', -40), 1, 'overlay pan y');
  expect(Math.hypot(fullMoved.img.x - full3.img.x, fullMoved.img.y - full3.img.y), 'the overlay figure moved').toBeGreaterThan(30);
  // The frame underneath kept its own zoom.
  await expect(fv.locator('.fv-pct')).toHaveText('125%');

  // Esc closes and returns focus to Full Screen; X closes too.
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.dataset.fv)).toBe('full');
  await expect(fv.locator('.fv-content > img:not([src])'), 'the figure is back in its frame').toHaveCount(0);
  await expect(fv.locator('.fv-content > img')).toHaveJSProperty('complete', true);
  await button('full').click();
  await expect(overlay).toBeVisible();
  await overlay.locator('[data-fv="close"]').click();
  await expect(overlay).toHaveCount(0);
  await button('reset').click();

  // Keyboard: every control is focusable in order; + and - work while the frame has focus; arrows pan when zoomed.
  await button('in').focus();
  const order = [];
  for (let k = 0; k < 5; k++) { order.push(await page.evaluate(() => document.activeElement.dataset.fv || [...document.activeElement.classList].join('.'))); await page.keyboard.press('Tab'); }
  expect(order).toEqual(['in', 'out', 'reset', 'full', 'fv-view']);
  await fv.locator('.fv-view').focus();
  await page.keyboard.press('+');
  await expect(fv.locator('.fv-pct')).toHaveText('125%');
  await page.keyboard.press('-');
  await expect(fv.locator('.fv-pct')).toHaveText('100%');
  await expect(button('out')).toHaveAttribute('aria-disabled', 'true');
  await button('out').focus();
  expect(await page.evaluate(() => document.activeElement.dataset.fv), 'a limit button stays focusable').toBe('out');
  await page.keyboard.press('Equal');
  await expect(fv.locator('.fv-pct')).toHaveText('125%');
  await fv.locator('.fv-view').focus();
  for (let k = 0; k < 10; k++) await page.keyboard.press('+');
  await expect(fv.locator('.fv-pct')).toHaveText('300%');
  await expect(button('in')).toHaveAttribute('aria-disabled', 'true');
  const k0 = await geo(page, scope);
  await page.keyboard.press('ArrowLeft');
  const k1 = await geo(page, scope);
  expect(k1.img.x, 'ArrowLeft pans the figure right').toBeGreaterThan(k0.img.x + 1);
  await button('reset').click();
  await expect(fv.locator('.fv-pct')).toHaveText('100%');
}

test('bank practice: the math figure is in its own frame; A–D, pan at 200 %, touch, Esc, keyboard, no requests, dark', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const hits = await serveFigure(context);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/app');
    await expect(page.locator('#user-name')).toContainText('E2E Student');
    await page.locator('[data-tab="practice"]').click();
    await page.locator('#dd-sec .dd-t').click();
    // From "Both sections" a pick toggles that section off: untick Reading & Writing to leave Math.
    await page.locator('#dd-sec .dd-o[data-v="Reading & Writing"]').click();
    await page.keyboard.press('Escape');
    await page.locator('#btn-start').click();
    await expect(page.locator('#view-test')).toBeVisible();
    const current = () => page.evaluate(() => { const { S } = window.__qa(); return S.items[S.i].id; });
    for (let k = 0; k < 6 && await current() !== FIG; k++) await page.locator('#btn-next').click();
    expect(await current()).toBe(FIG);
    const scope = '#pane-a .fv';
    await expect(page.locator(scope)).toHaveCount(1);
    await expect(page.locator(`${scope} img`)).toHaveJSProperty('complete', true);

    // Placement: one column, frame between the intro and the question, centred on the question column.
    await expect(page.locator('#panes')).toHaveClass(/solo/);
    await expect(page.locator('#pane-a .qfig, #pane-q .fv')).toHaveCount(0);
    const order = await page.locator('#pane-a .stem').evaluate(stem => [...stem.children].map(n => n.tagName === 'P' ? n.textContent.trim().split(/\s/)[0] : n.className));
    expect(order).toEqual(['The', 'fv', 'At']);
    const column = await page.locator('#pane-a .stem').evaluate(el => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; });
    near((await geo(page, scope)).frame.cx, column, 1, 'frame centred on the question column');
    // 1366×768 at 100 %: the figure does not push the first choice off-screen.
    const first = await page.locator('#pane-a .choice[data-letter="A"]').evaluate(el => { const r = el.getBoundingClientRect(), p = document.getElementById('pane-a').getBoundingClientRect(); return { b: r.bottom, pane: p.bottom, vh: innerHeight }; });
    expect(first.b, 'first choice inside the question pane').toBeLessThanOrEqual(Math.min(first.pane, first.vh));

    const before = hits.length;
    expect(before, 'the figure was loaded once').toBe(1);
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    await exercise(page, scope, 'bank', { touch: true });
    expect(requests, 'zoom, pan, Reset and full screen make no requests').toEqual([]);
    expect(hits.length).toBe(before);

    // Authored inline SVG graphs (AI questions) get the same frame, in place, without throwing (found by the audit).
    const svg = await page.evaluate(async () => {
      const R = await import('/shared/renderer.js');
      const out = R.mathStem('<p>Intro</p><svg viewBox="0 0 300 220" role="img" width="100%" style="max-width:300px"><title>Graph</title><rect width="300" height="220"/></svg><p>Question</p>', document);
      const d = document.createElement('div'); d.innerHTML = out.body;
      return { order: [...d.children].map(n => n.tagName === 'P' ? n.textContent : n.className), inFrame: !!d.querySelector('.fv .fv-content > svg[role="img"]'), context: out.context };
    });
    expect(svg).toEqual({ order: ['Intro', 'fv', 'Question'], inFrame: true, context: '' });

    // The old free-zoom lightbox never opens on a math figure.
    await page.locator(`${scope} .fv-view`).click();
    await expect(page.locator('.lb')).toHaveCount(0);

    // Dark theme: white plate under the figure, readable toolbar.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    const dark = await page.locator(scope).evaluate(fv => ({ view: getComputedStyle(fv.querySelector('.fv-view')).backgroundColor, bar: getComputedStyle(fv.querySelector('.fv-bar')).backgroundColor, ink: getComputedStyle(fv.querySelector('.fv-pct')).color, filter: getComputedStyle(fv.querySelector('img')).filter }));
    expect(dark).toEqual({ view: 'rgb(255, 255, 255)', bar: 'rgb(42, 45, 51)', ink: 'rgb(230, 232, 235)', filter: 'none' });
    await page.mouse.move(1, 1);
    await shot(page, 'bank-dark');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('lessons: student A–D, instructor and history viewers, no socket traffic, and an instructor stroke on the figure on two students', async ({ browser }) => {
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const one = await newUserContext(browser, 'e2e-student-2', { viewport: { width: 1366, height: 768 } });
  const two = await newUserContext(browser, 'e2e-student-3', { viewport: { width: 1536, height: 864 } });
  try {
    for (const context of [admin, one, two]) await serveFigure(context);
    const { sessionId, joinCode } = await lesson(admin, 'Figure viewer', [FIG], 'instructor', 60);
    const teacher = await openLive(admin, sessionId);
    const pages = [];
    const sent = [];
    for (const context of [one, two]) {
      const page = await context.newPage();
      page.on('websocket', ws => ws.on('framesent', f => sent.push({ page: pages.length, data: String(f.payload) })));
      await join(page, joinCode); pages.push(page);
    }
    const [s1, s2] = pages;
    await teacher.locator('[data-live="start"]').click();
    for (const page of pages) await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    const scope = '#lesson-card .fv';
    await expect(s1.locator(scope)).toHaveCount(1);
    await expect(s1.locator('#lesson-card .qfig, #lesson-card .stage-passage')).toHaveCount(0);
    await expect(s1.locator('#lesson-card')).toHaveClass(/stage-single/);
    const order = await s1.locator('#lesson-card .lesson-stem').evaluate(stem => [...stem.children].map(n => n.tagName === 'P' ? n.textContent.trim().split(/\s/)[0] : n.className));
    expect(order).toEqual(['The', 'fv', 'At']);

    // 1366×768 at 100 %: the first choice is fully on screen, between the header and the footer, without scrolling.
    const fit = await s1.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { scroll: document.getElementById('lesson-live').scrollTop, top: r('[data-lesson-choice="A"]').top, bottom: r('[data-lesson-choice="A"]').bottom, header: r('.lesson-header').bottom, footer: r('.lesson-footer').top };
    });
    expect(fit.scroll).toBe(0);
    expect(fit.top).toBeGreaterThanOrEqual(fit.header);
    expect(fit.bottom, 'first choice above the footer').toBeLessThanOrEqual(fit.footer);

    // Student A–D; nothing about it goes over the socket.
    const before = sent.length;
    await exercise(s1, scope, 'lesson-student');
    const during = sent.slice(before).map(f => { try { return JSON.parse(f.data).type; } catch { return f.data; } });
    expect(during.filter(type => type !== 'ping'), 'the viewer sends nothing').toEqual([]);

    // The toolbar's "100%" differs per client: it is not selectable and never becomes a text anchor.
    const bar = await s1.locator('#lesson-card').evaluate(async card => {
      const Ink = await import('/shared/annotations.js');
      const pct = card.querySelector('.fv-pct').getBoundingClientRect();
      return { select: getComputedStyle(card.querySelector('.fv-bar')).userSelect, glyph: Ink.locateGlyph(card, pct.x + pct.width / 2, pct.y + pct.height / 2) };
    });
    expect(bar).toEqual({ select: 'none', glyph: null });

    // The instructor's own card has the same viewer, and its zoom is local.
    await expect(teacher.locator('#live-card .fv')).toHaveCount(1);
    await teacher.locator('#live-card [data-fv="in"]').click();
    await expect(teacher.locator('#live-card .fv-pct')).toHaveText('125%');
    await expect(s2.locator(`${scope} .fv-pct`)).toHaveText('100%');
    await teacher.locator('#live-card [data-fv="reset"]').click();

    // Reveal, then the instructor draws across the figure: along the line of best fit, 30 % → 70 % of the image.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'REVEALED');
    for (const page of pages) await expect(page.locator('#lesson-content')).toContainText('REVEALED');
    await teacher.locator('[data-tool="pen"]').click();
    const tImg = await teacher.locator('#live-card .fv img').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const FRACTIONS = [[0.3, 0.3], [0.4, 0.4], [0.5, 0.5], [0.6, 0.6], [0.7, 0.7]];
    const toClient = (img, [fx, fy]) => [img.x + fx * img.w, img.y + fy * img.h];
    const path = [];
    for (let k = 0; k <= 40; k++) { const f = 0.3 + 0.4 * k / 40; path.push(toClient(tImg, [f, f])); }
    await teacher.mouse.move(...path[0]); await teacher.mouse.down();
    for (const p of path.slice(1)) { await teacher.mouse.move(...p); await teacher.waitForTimeout(16); }
    await teacher.mouse.up();
    const layer = () => admin.request.get(`/api/lessons/${sessionId}`).then(r => r.json()).then(s => s.annotations.filter(m => m.type === 'stroke'));
    await expect.poll(async () => (await layer()).length).toBeGreaterThan(0);
    expect(new Set((await layer()).map(m => m.a)), 'a stroke that starts on the figure keeps the figure anchor').toEqual(new Set(['i:0']));

    // Two students at 100 %, different screens: the ink runs through the same figure points, and stays on the figure.
    const imgOf = page => page.locator(`${scope} img`).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
    const onFigure = async (page, img, card = '#lesson-card') => {
      const probe = await inkProbe(page, card, { points: FRACTIONS.map(f => toClient(img, f)), radius: 2.5 });
      return probe && probe.points.every(Boolean) && probe.box.l >= img.x - 4 && probe.box.r <= img.r + 4 && probe.box.t >= img.y - 4 && probe.box.b <= img.b + 4;
    };
    const imgs = [];
    for (const [i, page] of pages.entries()) {
      await expect(page.locator(`${scope} .fv-pct`)).toHaveText('100%');
      const img = await imgOf(page);
      imgs.push(img);
      await expect.poll(() => onFigure(page, img), { message: `student ${i + 1}: stroke on the same figure points`, timeout: 8000 }).toBe(true);
      await page.locator(scope).scrollIntoViewIfNeeded();
      const frame = await page.locator(scope).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      await shot(page, `lesson-stroke-student-${i + 1}-100`, { clip: frame });
    }
    expect(Math.abs(imgs[0].w - imgs[1].w) > 0.5 || Math.abs(imgs[0].x - imgs[1].x) > 0.5, 'the two students lay the figure out differently').toBe(true);
    const teacherImg = await teacher.locator('#live-card .fv img').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
    expect(await onFigure(teacher, teacherImg, '#live-card'), 'the instructor sees the same').toBe(true);

    // Student 1 zooms to 200 % and pans: the ink follows the figure's content and is clipped to the frame.
    // Student 2, at 100 %, is unaffected.
    for (let k = 0; k < 4; k++) await s1.locator(`${scope} [data-fv="in"]`).click();
    const z = await geo(s1, scope);
    await drag(s1, [z.view.cx, z.view.cy], [40, 30]);
    const zoomed = await geo(s1, scope);
    const inside = FRACTIONS.map(f => toClient(zoomed.img, f)).filter(([x, y]) => x > zoomed.view.x + 3 && x < zoomed.view.r - 3 && y > zoomed.view.y + 3 && y < zoomed.view.b - 3);
    expect(inside.length).toBeGreaterThan(0);
    await expect.poll(async () => {
      const probe = await inkProbe(s1, '#lesson-card', { points: inside, radius: 3 });
      return probe.points.every(Boolean) && probe.box.l >= zoomed.view.x - 1 && probe.box.r <= zoomed.view.r + 1 && probe.box.t >= zoomed.view.y - 1 && probe.box.b <= zoomed.view.b + 1;
    }, { message: 'zoomed student: ink on the zoomed figure, clipped to the frame', timeout: 8000 }).toBe(true);
    await s1.mouse.move(1, 1);
    await shot(s1, 'lesson-stroke-student-1-200', { clip: { x: zoomed.frame.x, y: zoomed.frame.y, width: zoomed.frame.w, height: zoomed.frame.h } });
    expect(await onFigure(s2, imgs[1]), 'the other student is unchanged').toBe(true);
    await s1.locator(`${scope} [data-fv="reset"]`).click();
    await expect.poll(() => onFigure(s1, imgs[0]), { message: 'after Reset, back on the 100 % points', timeout: 8000 }).toBe(true);

    // History/review: the session's question opens in My Lessons with the viewer and the saved stroke at 100 %.
    await teacher.locator('[data-live="endSession"]').click();
    await expect(s1.locator('#lesson-live')).toBeHidden();
    await s1.locator('.nav-i[data-tab="lessons"]').click();
    await s1.locator(`#lessons-table tr[data-session="${sessionId}"]`).click();
    await expect(s1.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    await expect(s1.locator(scope)).toHaveCount(1);
    const historyImg = await imgOf(s1);
    await expect.poll(() => onFigure(s1, historyImg), { message: 'history: saved stroke on the figure', timeout: 8000 }).toBe(true);
    await s1.locator(`${scope} [data-fv="in"]`).click();
    await expect(s1.locator(`${scope} .fv-pct`)).toHaveText('125%');
  } finally { await Promise.all([admin.close(), one.close(), two.close()]); }
});
