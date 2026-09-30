import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, SIZES, MATH, SPR, LONG, lesson, join, openLive, shot, box, shapeReport, noBoxReport } from './helpers.js';

// lessons-11-ui-polish, items 1-3: the student lesson view keeps Bluebook's proportions (screenshot A) at every
// size and zoom of the task text. Zoom is emulated as tests/e2e/lessons-11c.spec.js does.

const pct = (n, of) => Math.round(1000 * n / of) / 10;

// Everything measured in the page, in CSS px.
const measure = page => page.evaluate(() => {
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; };
  const q = s => document.querySelector(s);
  const live = document.getElementById('lesson-live');
  const style = (el, ...props) => Object.fromEntries(props.map(p => [p, getComputedStyle(el)[p]]));
  const tool = el => {
    const svg = el.querySelector('svg'), label = el.querySelector('span');
    return { box: rect(el), svg: rect(svg), label: rect(label), text: label.textContent.trim(), style: style(el, 'backgroundColor', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomColor', 'borderTopLeftRadius') };
  };
  return {
    vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
    liveOverflow: live.scrollWidth - live.clientWidth,
    header: rect(q('.lesson-header')), footer: rect(q('.lesson-footer')), footerPosition: getComputedStyle(q('.lesson-footer')).position,
    title: rect(q('.lesson-header h1')), phase: rect(q('.lesson-phase')), phaseText: q('.lesson-phase').textContent,
    clock: rect(q('#lesson-clock')), hide: rect(q('.lesson-timer button')), hideStyle: { backgroundColor: getComputedStyle(q('.lesson-timer button')).backgroundColor, borders: ['Top', 'Right', 'Bottom', 'Left'].map(s => getComputedStyle(q('.lesson-timer button'))[`border${s}Width`]) },
    tools: [q('#lesson-calc-toggle'), q('#lesson-private'), q('.lesson-follow-tool'), q('.lesson-more summary')].map(tool),
    followInput: q('#lesson-follow') && style(q('#lesson-follow'), 'opacity'),
    name: rect(q('.lesson-footer>span:first-child')), nameText: q('.lesson-footer>span:first-child').textContent,
    pill: rect(q('.lesson-position')), pillText: q('.lesson-position').textContent, pillStyle: style(q('.lesson-position'), 'backgroundColor', 'borderTopLeftRadius', 'color'),
    submit: rect(q('#lesson-lock')), submitStyle: style(q('#lesson-lock'), 'backgroundColor', 'borderTopLeftRadius'),
    column: rect(q('#lesson-card .stage-question')), stem: q('#lesson-card .lesson-stem') && parseFloat(getComputedStyle(q('#lesson-card .lesson-stem')).fontSize),
    columns: document.querySelectorAll('#lesson-card .stage-question').length
  };
});

const radiusPx = value => parseFloat(value);

test.describe('student view proportions', () => {
  for (const [name, options] of Object.entries(SIZES)) {
    test(`layout at ${name}: one centred column, Bluebook header and footer, pills, strike outside the row, no sideways scroll`, async ({ browser }) => {
      test.setTimeout(180000);
      const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
      const student = await newUserContext(browser, 'e2e-student-1', options);
      try {
        const { sessionId, joinCode } = await lesson(admin, `Task11 layout ${name}`, [MATH, LONG, SPR]);
        const teacher = await openLive(admin, sessionId);
        const page = await student.newPage();
        await join(page, joinCode);
        await teacher.locator('[data-live="start"]').click();
        await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
        await expect(page.locator('[data-lesson-choice="D"]')).toBeVisible();
        const m = await measure(page);
        const where = `${name} (${m.vw}x${m.vh}, dpr ${m.dpr})`;

        // The window is exactly the requested CSS size.
        expect([m.vw, m.vh], where).toEqual([options.viewport.width, options.viewport.height]);
        expect(m.dpr, where).toBeCloseTo(options.deviceScaleFactor || 1, 5);

        // No horizontal scroll anywhere.
        expect(m.scrollWidth, `${where} document scrollWidth`).toBe(m.vw);
        expect(m.bodyScrollWidth, `${where} body scrollWidth`).toBeLessThanOrEqual(m.vw);
        expect(m.liveOverflow, `${where} #lesson-live overflow`).toBeLessThanOrEqual(0);

        // One question column, about 46 % of the window, centred, with a maximum width.
        expect(m.columns, where).toBe(1);
        expect(pct(m.column.w, m.vw), `${where} column % of window`).toBeGreaterThanOrEqual(40);
        expect(pct(m.column.w, m.vw), `${where} column % of window`).toBeLessThanOrEqual(52);
        expect(m.column.w, `${where} column max width`).toBeLessThanOrEqual(960.5);
        expect(Math.abs(m.column.cx - m.vw / 2), `${where} column centred`).toBeLessThanOrEqual(0.02 * m.vw);

        // Type scales with the window: ~17.5 px at 1366, ~19 px at 1920, at least 16 px at 125 % zoom.
        if (name === '1366x768') { expect(m.stem, where).toBeGreaterThanOrEqual(16.5); expect(m.stem, where).toBeLessThanOrEqual(18.5); }
        if (name === '1920x1080') { expect(m.stem, where).toBeGreaterThanOrEqual(18); expect(m.stem, where).toBeLessThanOrEqual(20.5); }
        if (name === 'z125') expect(m.stem, where).toBeGreaterThanOrEqual(16);

        // Header takes at most 12 % of the height, footer at most 9 %; the footer sits on the window's bottom edge.
        expect(pct(m.header.h, m.vh), `${where} header % of height`).toBeLessThanOrEqual(12);
        expect(pct(m.footer.h, m.vh), `${where} footer % of height`).toBeLessThanOrEqual(9);
        expect(m.header.y, where).toBeCloseTo(0, 0);
        expect(m.footerPosition, where).toBe('fixed');
        expect(m.footer.bottom, where).toBeCloseTo(m.vh, 0);

        // Header: title left with the phase label under it; timer and Hide pill in the centre; four tools on the right.
        expect(m.title.x, `${where} title at the left`).toBeLessThanOrEqual(0.08 * m.vw);
        expect(m.phaseText, where).toBe('ANSWERING');
        expect(m.phase.y, `${where} phase label under the title`).toBeGreaterThanOrEqual(m.title.bottom - 1);
        expect(Math.abs(m.phase.x - m.title.x), where).toBeLessThanOrEqual(2);
        expect(m.phase.bottom, `${where} phase label inside the header`).toBeLessThanOrEqual(m.header.bottom + 1);
        for (const part of [m.clock, m.hide]) expect(Math.abs(part.cx - m.vw / 2), `${where} timer group centred`).toBeLessThanOrEqual(0.04 * m.vw);
        expect(m.hide.y, `${where} Hide under the clock`).toBeGreaterThanOrEqual(m.clock.y);
        // Hide is plain text: no box, no fill, no circle.
        expect(m.hideStyle.backgroundColor, `${where} Hide has no fill`).toBe('rgba(0, 0, 0, 0)');
        expect(m.hideStyle.borders, `${where} Hide has no border`).toEqual(['0px', '0px', '0px', '0px']);

        expect(m.tools.map(t => t.text), where).toEqual(['Calculator', 'Annotate', 'Follow me', 'More']);
        for (const [i, t] of m.tools.entries()) {
          const id = `${where} tool ${t.text}`;
          expect(t.box.cx, `${id} on the right half`).toBeGreaterThan(0.55 * m.vw);
          expect(t.box.right, `${id} inside the window`).toBeLessThanOrEqual(m.vw);
          if (i) expect(t.box.x, `${id} after the previous tool`).toBeGreaterThanOrEqual(m.tools[i - 1].box.right - 1);
          // Icon over label, both centred on the tool.
          expect(t.svg.bottom, `${id} icon above label`).toBeLessThanOrEqual(t.label.y + 2);
          expect(Math.abs(t.svg.cx - t.label.cx), `${id} icon centred over label`).toBeLessThanOrEqual(3);
          // No boxed or filled background.
          expect(t.style.backgroundColor, `${id} background`).toBe('rgba(0, 0, 0, 0)');
          expect(radiusPx(t.style.borderTopWidth) + radiusPx(t.style.borderLeftWidth) + radiusPx(t.style.borderRightWidth), `${id} no border box`).toBe(0);
        }
        // Follow me is an invisible checkbox laid over its tool, not a square box.
        expect(Number(m.followInput.opacity), where).toBe(0);

        // Footer: name left, dark pill in the centre, blue pill on the right.
        expect(m.name.x, `${where} name at the left`).toBeLessThanOrEqual(0.08 * m.vw);
        expect(m.nameText, where).toContain('E2E Student 1');
        expect(m.pillText, where).toBe('Question 1 of 3');
        expect(Math.abs(m.pill.cx - m.vw / 2), `${where} question pill centred`).toBeLessThanOrEqual(0.02 * m.vw);
        expect(radiusPx(m.pillStyle.borderTopLeftRadius), `${where} question pill radius`).toBeGreaterThanOrEqual(m.pill.h / 2 - 0.5);
        const rgb = c => c.match(/\d+/g).slice(0, 3).map(Number);
        for (const channel of rgb(m.pillStyle.backgroundColor)) expect(channel, `${where} question pill is dark`).toBeLessThan(60);
        expect(m.submit.cx, `${where} Submit on the right`).toBeGreaterThan(0.85 * m.vw);
        expect(m.submit.right, where).toBeLessThanOrEqual(m.vw);
        expect(radiusPx(m.submitStyle.borderTopLeftRadius), `${where} Submit pill`).toBeGreaterThanOrEqual(m.submit.h / 2 - 0.5);
        const [r, g, b] = rgb(m.submitStyle.backgroundColor);
        expect(b, `${where} Submit is blue`).toBeGreaterThan(r + 60);
        expect(b, `${where} Submit is blue`).toBeGreaterThan(g + 40);

        // Active tool state is subtle: still no fill and no box (the spec's accent colour plus underline).
        await page.locator('#lesson-private').click();
        await expect(page.locator('#lesson-private')).toHaveAttribute('aria-pressed', 'true');
        const active = await page.locator('#lesson-private').evaluate(el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, box: ['Top', 'Left', 'Right'].map(s => parseFloat(cs[`border${s}Width`])), color: cs.color }; });
        expect(active.bg, `${where} active tool background`).toBe('rgba(0, 0, 0, 0)');
        expect(active.box, `${where} active tool has no box`).toEqual([0, 0, 0]);
        await page.locator('#lesson-private').click();

        // Choice rows: rounded, full width of the column less the strike gutter, letter in a circle.
        await page.locator('#lesson-card .stage-strike-toggle').click();
        await expect(page.locator('#lesson-card [data-strike="A"]')).toBeVisible();
        const rows = await page.locator('#lesson-card .stage-choice').evaluateAll(list => list.map(row => {
          const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom, cy: b.y + b.height / 2 }; };
          const choice = row.querySelector('.choice'), badge = row.querySelector('.badge'), strike = row.querySelector('[data-strike]');
          return { letter: row.dataset.choice, choice: r(choice), badge: r(badge), strike: r(strike), radius: parseFloat(getComputedStyle(choice).borderTopLeftRadius), badgeRadius: parseFloat(getComputedStyle(badge).borderTopLeftRadius), strikeVisible: getComputedStyle(strike).visibility };
        }));
        expect(rows.map(x => x.letter), where).toEqual(['A', 'B', 'C', 'D']);
        // The cross-out control has no bordered circle or box, and no button of the screen is boxed, filled or round (pills aside).
        const strikeStyle = await page.locator('#lesson-card .stage-strike-letter').first().evaluate(el => { const cs = getComputedStyle(el); return { borders: ['Top', 'Right', 'Bottom', 'Left'].map(s => cs[`border${s}Width`]), bg: cs.backgroundColor }; });
        expect(strikeStyle.borders, `${where} cross-out letter has no circle`).toEqual(['0px', '0px', '0px', '0px']);
        expect(strikeStyle.bg, where).toBe('rgba(0, 0, 0, 0)');
        await page.mouse.move(2, 2);
        expect((await noBoxReport(page)).problems, `${where} boxed, filled or circular buttons`).toEqual([]);
        for (const [i, row] of rows.entries()) {
          const id = `${where} choice ${row.letter}`;
          expect(row.radius, `${id} rounded row`).toBeGreaterThanOrEqual(10);
          expect(row.choice.w, `${id} full width of the column`).toBeGreaterThanOrEqual(0.85 * m.column.w);
          expect(row.choice.x, `${id} inside the column`).toBeGreaterThanOrEqual(m.column.x - 1);
          expect(Math.abs(row.badge.w - row.badge.h), `${id} letter badge is round`).toBeLessThanOrEqual(1);
          expect(row.badgeRadius, `${id} letter circle`).toBeGreaterThanOrEqual(row.badge.w / 2 - 0.5);
          expect(row.badge.x, `${id} letter inside its row`).toBeGreaterThanOrEqual(row.choice.x);
          expect(row.badge.right, `${id} letter inside its row`).toBeLessThanOrEqual(row.choice.right);
          expect(row.strikeVisible, id).toBe('visible');
          expect(row.strike.x, `${id} strike control right of the row`).toBeGreaterThanOrEqual(row.choice.right - 0.5);
          expect(row.strike.right, `${id} strike control inside the column`).toBeLessThanOrEqual(m.column.right + 1);
          expect(Math.abs(row.strike.cy - row.choice.cy), `${id} strike control level with the row`).toBeLessThanOrEqual(6);
          expect(row.strike.x < row.choice.right - 0.5 && row.choice.x < row.strike.right && row.strike.y < row.choice.bottom && row.choice.y < row.strike.bottom, `${id} row overlaps its strike control`).toBe(false);
          if (i) expect(row.choice.y, `${id} rows do not overlap`).toBeGreaterThanOrEqual(rows[i - 1].choice.bottom + 4);
        }
        await shot(page, `student-${name}-math`);

        // A picked choice keeps the round shape; the cross-out control sits on the picked row too.
        await page.locator('[data-lesson-choice="B"]').click();
        await expect(page.locator('#lesson-card .choice.sel')).toHaveCount(1);
        expect(radiusPx(await page.locator('#lesson-card .choice.sel').evaluate(el => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(10);
        expect((await shapeReport(page)).violations, `${where} square boxes on the answering screen`).toEqual([]);

        // Reading question with a long passage (split layout) and the grid-in: still no sideways scroll.
        for (const [id, marker] of [[LONG, '#lesson-card.stage-split'], [SPR, '#lesson-card #lesson-grid']]) {
          await teacher.locator('[data-live="endNow"]').click();
          await expect(page.locator('#lesson-content')).toContainText('REVEALED');
          await teacher.locator('[data-live="next"]').click();
          await teacher.locator('[data-live="startQuestion"]').click();
          await expect(page.locator('#lesson-content')).toContainText('ANSWERING');
          await expect(page.locator(marker)).toBeVisible();
          const s = await page.evaluate(() => ({ vw: innerWidth, sw: document.documentElement.scrollWidth, over: document.getElementById('lesson-live').scrollWidth - document.getElementById('lesson-live').clientWidth }));
          expect(s.sw, `${where} ${id} scrollWidth`).toBe(s.vw);
          expect(s.over, `${where} ${id} #lesson-live overflow`).toBeLessThanOrEqual(0);
          if (id === LONG) await shot(page, `student-${name}-passage`);
          else {
            await page.locator('#lesson-grid').fill('12');
            const grid = await box(page.locator('#lesson-grid'));
            expect(radiusPx(await page.locator('#lesson-grid').evaluate(el => getComputedStyle(el).borderTopLeftRadius)), `${where} grid-in`).toBeGreaterThanOrEqual(10);
            expect(grid.right, where).toBeLessThanOrEqual(s.vw);
            await shot(page, `student-${name}-gridin`);
          }
        }
      } finally { await admin.close(); await student.close(); }
    });
  }

  test('the column has a maximum width on a very wide window', async ({ browser }) => {
    test.setTimeout(120000);
    const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
    const student = await newUserContext(browser, 'e2e-student-1', { viewport: { width: 2560, height: 1300 } });
    try {
      const { sessionId, joinCode } = await lesson(admin, 'Task11 wide', [MATH]);
      const teacher = await openLive(admin, sessionId);
      const page = await student.newPage();
      await join(page, joinCode);
      await teacher.locator('[data-live="start"]').click();
      await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
      const m = await measure(page);
      expect(m.scrollWidth).toBe(m.vw);
      expect(m.column.w, 'column does not keep growing with the window').toBeLessThanOrEqual(960.5);
      expect(m.column.w, 'column stays wide').toBeGreaterThanOrEqual(700);
      expect(Math.abs(m.column.cx - m.vw / 2)).toBeLessThanOrEqual(0.02 * m.vw);
    } finally { await admin.close(); await student.close(); }
  });
});
