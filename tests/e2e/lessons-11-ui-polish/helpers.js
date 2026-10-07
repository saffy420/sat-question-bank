import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

// Shared by the lessons-11-ui-polish specs.
export const ARTIFACTS = '.omp/pipeline/lessons-11-ui-polish/e2e';
export const RW = 'e2e-core-rw', MATH = 'e2e-core-math', SPR = 'e2e-core-spr', LONG = 'e2e-unused', FIGURE = 'e2e-used-other';
export const INSTRUCTOR = { viewport: { width: 1920, height: 1080 } };

// Browser zoom z on a 1366×768 screen, emulated as lessons-11c does: the CSS viewport is 1366/z × 768/z
// and every CSS px is drawn as z device pixels.
export const zoomOpts = z => ({ viewport: { width: Math.round(1366 / z), height: Math.round(768 / z) }, deviceScaleFactor: z });

// The six student viewports of the task text. name -> context options.
export const SIZES = {
  '1366x768': { viewport: { width: 1366, height: 768 } },
  '1536x864': { viewport: { width: 1536, height: 864 } },
  '1920x1080': { viewport: { width: 1920, height: 1080 } },
  z90: zoomOpts(0.9),
  z110: zoomOpts(1.1),
  z125: zoomOpts(1.25)
};

export function artifactDir() { mkdirSync(ARTIFACTS, { recursive: true }); return ARTIFACTS; }
export const shot = (page, name, options = {}) => page.screenshot({ path: `${artifactDir()}/${name}.png`, ...options });

export async function lesson(admin, title, questionIds, mode = 'instructor', seconds = 90) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: {
    title: `${title} ${Date.now()}`, mode, items: questionIds.map(question_id => ({ question_id, time_limit_sec: seconds, notes: '' }))
  } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
}

export async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}

export async function dismissEnded(page) {
  await expect(page.locator('#lesson-reflection')).toBeVisible({ timeout: 35000 });
  await page.locator('#reflection-close').click();
  await expect(page.locator('#lesson-reflection')).toBeHidden();
  await expect(page.locator('#history-summary')).toBeVisible();
  await page.locator('#history-close').click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('#lesson-live')).toBeHidden();
}

export async function openLive(admin, sessionId) {
  const teacher = await admin.newPage();
  await teacher.goto(`/admin/live/${sessionId}`);
  await expect(teacher.locator('#live-link')).toHaveText('Connected');
  return teacher;
}

// Client point at the middle of `word` (nth occurrence) inside `scope`, scrolled into view.
export async function wordCenter(page, scope, word, nth = 0) {
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

export const box = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
export const overlaps = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;

// Every square-cornered bordered box in the student view. A box is an element with a visible border on two
// or more sides and a corner radius under 8 px that is not a circle. Third-party Desmos widgets are outside our styling.
// A control whose only border is one underline (the active tool state of the spec) is reported separately.
export function shapeReport(page) {
  return page.evaluate(() => {
    const root = document.getElementById('lesson-live');
    const chrome = 'button, input, select, summary, textarea, .choice, .poll-option, .self-navigator, .lesson-more>div, .lesson-calc, .lesson-desmos, .lesson-result-track, .stage-strike-letter, .badge';
    const nodes = [...root.querySelectorAll(chrome), ...document.querySelectorAll('dialog.lesson-confirm-dialog')];
    const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const violations = [], underlined = [];
    let checked = 0;
    for (const el of new Set(nodes)) {
      if (el.closest('.lesson-calc-body, .lesson-desmos-calc, .katex')) continue;
      // The question bar's Report control is a small outlined box on purpose (screenshot B, report-and-suggest).
      if (el.matches('.stage-report')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let faded = false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 0.05) faded = true;
      if (faded) continue;
      checked++;
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(s => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && cs[`border${s}Style`] !== 'hidden' && alpha(cs[`border${s}Color`]) > 0.05);
      if (!sides.length) continue;
      const corner = v => { const part = v.split(' ')[0]; return part.endsWith('%') ? parseFloat(part) / 100 * Math.min(r.width, r.height) : parseFloat(part); };
      const radius = Math.min(...['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(c => corner(cs[`border${c}Radius`])));
      const round = radius >= 8 || radius >= Math.min(r.width, r.height) / 2 - 0.5;
      const label = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || '').trim().slice(0, 24)}" radius ${radius}px sides ${sides.join('+')}`;
      if (sides.length === 1 && sides[0] === 'Bottom' && el.closest('.lesson-tools, .stage-strike-toggle, .self-grid, .history-footer')) { underlined.push(label); continue; }
      if (!round) violations.push(label);
    }
    return { checked, violations, underlined };
  });
}

// The word under the centre of the student's laser dot (the dot itself ignores pointer hits).
export async function wordUnderDot(page) {
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
      const b = range.getBoundingClientRect();
      if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) {
        const text = node.data;
        let a = at, z = at;
        while (a > 0 && /\w/.test(text[a - 1])) a--;
        while (z < text.length && /\w/.test(text[z])) z++;
        return text.slice(a, z);
      }
    }
    return null;
  });
}

// Every word of the first paragraph of `scope` in reading order: { i, t, l, r, t0, b } in client px (one rect per word).
export const passageWords = (page, scope) => page.locator(scope).evaluate(root => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('.katex')) continue;
    const re = /[A-Za-z']+/g;
    let m;
    while ((m = re.exec(node.data))) {
      const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      const b = range.getBoundingClientRect();
      out.push({ i: out.length, t: m[0], l: b.left, r: b.right, t0: b.top, b: b.bottom });
    }
  }
  return out;
});

// Ink on the card's canvas, read back in client px. `near(x, y, r)` is true when a painted pixel lies within r CSS px.
export const inkProbe = (page, cardSelector, spec) => page.locator(cardSelector).evaluate((card, spec) => {
  const c = card.querySelector(':scope > canvas.lesson-ink');
  if (!c || !c.width) return null;
  const r = c.getBoundingClientRect(), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const sx = c.width / r.width, sy = c.height / r.height;
  const painted = (px, py) => data[(py * c.width + px) * 4 + 3] > 60;
  // Painted device pixels inside a client rect.
  const inside = ({ l, r: right, t0, b }) => {
    const x0 = Math.max(0, Math.floor((l - r.left) * sx)), x1 = Math.min(c.width - 1, Math.ceil((right - r.left) * sx));
    const y0 = Math.max(0, Math.floor((t0 - r.top) * sy)), y1 = Math.min(c.height - 1, Math.ceil((b - r.top) * sy));
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (painted(x, y)) n++;
    return n;
  };
  const near = (x, y, radius) => {
    const cx = (x - r.left) * sx, cy = (y - r.top) * sy, rr = radius * Math.max(sx, sy);
    for (let py = Math.max(0, Math.floor(cy - rr)); py <= Math.min(c.height - 1, Math.ceil(cy + rr)); py++)
      for (let px = Math.max(0, Math.floor(cx - rr)); px <= Math.min(c.width - 1, Math.ceil(cx + rr)); px++)
        if (painted(px, py) && Math.hypot(px - cx, py - cy) <= rr + 0.75) return true;
    return false;
  };
  let total = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (painted(x, y)) { total++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return {
    total, box: total ? { l: r.left + x0 / sx, r: r.left + (x1 + 1) / sx, t: r.top + y0 / sy, b: r.top + (y1 + 1) / sy } : null,
    words: (spec.words || []).map(w => inside(w) > 0),
    points: (spec.points || []).map(([x, y]) => near(x, y, spec.radius ?? 2)),
    canvas: { w: c.width, h: c.height, cssW: r.width, cssH: r.height }
  };
}, spec);

// Solid filled pills: the one primary action of a screen and the question pill.
export const SOLID_PILLS = '#lesson-lock, #self-next, #history-next, #poll-vote, #self-submit, #lesson-confirm, #self-confirm, #lesson-calc-replace, .lesson-position';

// "No box around the buttons, not circles, not boxes": every visible button of the student view has no border on any side
// (except a bottom underline of at most 3 px on a tool, a toggle or a number cell, the active-state indicator), no fill (except
// the solid pills above), and is not a bordered circle. The cross-out control has no bordered circle either. Choice-row buttons
// ([data-lesson-choice]) draw their box on the inner .choice row, and Desmos internals are third-party.
export function noBoxReport(page) {
  return page.evaluate(solid => {
    const root = document.getElementById('lesson-live');
    const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const problems = [];
    let checked = 0;
    const buttons = [...root.querySelectorAll('button'), ...document.querySelectorAll('dialog.lesson-confirm-dialog button')];
    for (const el of new Set(buttons)) {
      if (el.closest('.lesson-calc-body, .lesson-desmos-calc') || el.matches('[data-lesson-choice], .stage-report')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let faded = false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 0.05) faded = true;
      if (faded) continue;
      checked++;
      const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || '').trim().slice(0, 20)}"`;
      const width = side => parseFloat(cs[`border${side}Width`]) * (cs[`border${side}Style`] === 'none' || cs[`border${side}Style`] === 'hidden' ? 0 : 1);
      for (const side of ['Top', 'Left', 'Right']) if (width(side) > 0) problems.push(`${name}: border-${side.toLowerCase()} ${width(side)}px`);
      const bottom = width('Bottom');
      if (bottom > 0) {
        if (bottom > 3) problems.push(`${name}: border-bottom ${bottom}px is thicker than an underline`);
        else if (!el.closest('.lesson-tools, .stage-strike-toggle, .self-grid, .history-footer') && !el.matches('.stage-strike-toggle')) problems.push(`${name}: border-bottom on something that is not a tool, toggle or number cell`);
      }
      if (alpha(cs.backgroundColor) > 0.02 && !el.matches(solid)) problems.push(`${name}: filled background ${cs.backgroundColor}`);
      const radius = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(c => cs[`border${c}Radius`].split(' ')[0]);
      const circle = radius.every(v => v.endsWith('%') ? parseFloat(v) >= 50 : parseFloat(v) >= Math.min(r.width, r.height) / 2 - 0.5) && Math.abs(r.width - r.height) < 2;
      if (circle && (bottom > 0 || alpha(cs.backgroundColor) > 0.02) && !el.matches(solid)) problems.push(`${name}: a circle`);
    }
    // The cross-out control: a plain button around Bluebook's outlined letter circle, never a box or a filled circle.
    for (const el of root.querySelectorAll('.stage-strike')) {
      const cs = getComputedStyle(el);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') problems.push(`.stage-strike: border-${side.toLowerCase()}`);
    }
    for (const el of root.querySelectorAll('.stage-strike-letter')) if (alpha(getComputedStyle(el).backgroundColor) > 0.02) problems.push('.stage-strike-letter: filled circle');
    return { checked, problems };
  }, SOLID_PILLS);
}
