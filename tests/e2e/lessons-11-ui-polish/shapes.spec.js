import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, MATH, RW, SPR, lesson, join, openLive, shot, shapeReport, noBoxReport, dismissEnded } from './helpers.js';

// lessons-11-ui-polish, item 2: every control of every student screen uses Bluebook shapes. helpers.shapeReport
// flags any visible button/input/select/summary (and the row, popup and dialog boxes around them) with a visible
// border, a corner radius under 8 px and no circle. Each screen is swept while it is on screen.

async function sweep(page, label, min = 1) {
  // Park the pointer on empty header space so no button shows its hover tint.
  await page.mouse.move(2, 2);
  const report = await shapeReport(page);
  expect(report.checked, `${label}: the sweep examined controls`).toBeGreaterThanOrEqual(min);
  expect(report.violations, `${label}: square-cornered bordered boxes`).toEqual([]);
  // lessons-11 (user requirement): no box around the buttons, no circles.
  const boxes = await noBoxReport(page);
  expect(boxes.problems, `${label}: boxed, filled or circular buttons`).toEqual([]);
  return report;
}

// Solid pills: only the primary action and the question pill are filled, with fully rounded ends.
async function pills(page, label, selectors) {
  for (const selector of selectors) {
    const m = await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return { h: r.height, radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor, border: cs.borderTopWidth + cs.borderBottomWidth + cs.borderLeftWidth + cs.borderRightWidth }; });
    expect(m.h, `${label}: ${selector} is on screen`).toBeGreaterThan(10);
    expect(m.radius, `${label}: ${selector} is a pill`).toBeGreaterThanOrEqual(m.h / 2 - 0.5);
    expect(m.bg, `${label}: ${selector} is a solid pill`).not.toBe('rgba(0, 0, 0, 0)');
    expect(m.border, `${label}: ${selector} has no border`).toBe('0px0px0px0px');
  }
}
// Everything else is plain: no box, no fill.
async function plain(page, label, selectors) {
  for (const selector of selectors) {
    const m = await page.locator(selector).evaluate(el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, sides: ['Top', 'Right', 'Left'].map(s => cs[`border${s}Width`]).join(' '), h: el.getBoundingClientRect().height }; });
    expect(m.h, `${label}: ${selector} is on screen`).toBeGreaterThan(5);
    expect(m.bg, `${label}: ${selector} has no fill`).toBe('rgba(0, 0, 0, 0)');
    expect(m.sides, `${label}: ${selector} has no box`).toBe('0px 0px 0px');
  }
}

async function typeInto(page, root, latex) {
  await page.locator(`${root} .dcg-new-expression`).click();
  await page.keyboard.type(latex);
  await expect(page.locator(`${root} .dcg-expressionlist`)).toContainText(latex.replace(/^y=/, ''));
}

test('shape rule on every screen of an instructor-paced lesson: lobby, answering, tools, menus, dialogs, locked, reveal, both calculators, grid-in, My Lessons', async ({ browser }) => {
  test.setTimeout(240000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const context = await newUserContext(browser, 'e2e-student-1');
  const counts = {};
  const check = async (page, label, min) => { counts[label] = (await sweep(page, label, min)).checked; };
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11 shapes paced', [MATH, SPR]);
    const teacher = await openLive(admin, sessionId);
    const page = await context.newPage();
    await join(page, joinCode);

    await expect(page.locator('.lesson-lobby')).toBeVisible();
    await check(page, 'lobby', 3);

    // Positive control: the sweep does flag a square bordered control and accepts a rounded one and a circle.
    await page.evaluate(() => {
      const root = document.getElementById('lesson-content');
      for (const [id, style] of [['probe-square', 'border:1px solid #555;border-radius:3px'], ['probe-rounded', 'border:1px solid #555;border-radius:12px'], ['probe-circle', 'border:1px solid #555;border-radius:50%;width:24px;height:24px;padding:0']]) {
        const b = document.createElement('button'); b.id = id; b.textContent = 'x'; b.style.cssText = style; root.append(b);
      }
    });
    const control = await shapeReport(page);
    expect(control.violations.length, 'only the square probe is flagged').toBe(1);
    expect(control.violations[0]).toContain('probe-square');
    // The no-box sweep flags all three bordered probes (any border on a button is a box) and a filled one, and nothing else.
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'probe-filled'; b.textContent = 'x'; b.style.cssText = 'border:0;background:#ddd'; document.getElementById('lesson-content').append(b); });
    const noBox = await noBoxReport(page);
    for (const id of ['probe-square', 'probe-rounded', 'probe-circle', 'probe-filled']) expect(noBox.problems.some(p => p.includes(`#${id}`)), `${id} is flagged`).toBe(true);
    expect(noBox.problems.filter(p => !p.includes('#probe-')), 'nothing else is flagged').toEqual([]);
    await page.evaluate(() => document.querySelectorAll('#probe-square, #probe-rounded, #probe-circle, #probe-filled').forEach(el => el.remove()));

    await teacher.locator('[data-live="start"]').click();
    await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    await check(page, 'answering (math)', 12);
    await pills(page, 'answering', ['.lesson-position', '#lesson-lock']);
    await plain(page, 'answering', ['.lesson-timer button', '#lesson-card .stage-strike-toggle', '#lesson-private']);

    // Tools on: Annotate active, cross-out mode on, a choice picked.
    await page.locator('#lesson-private').click();
    await page.locator('#lesson-card .stage-strike-toggle').click();
    await page.locator('[data-lesson-choice="B"]').click();
    await expect(page.locator('#lesson-card .choice.sel')).toHaveCount(1);
    await check(page, 'answering with Annotate, cross-out mode and a picked choice', 12);
    await page.locator('#lesson-card [data-strike="A"]').click();
    await expect(page.locator('#lesson-card .stage-choice[data-choice="A"]')).toHaveClass(/struck/);
    await check(page, 'answering with a crossed-out choice', 12);
    await page.locator('#lesson-private').click();

    // More menu.
    await page.locator('.lesson-more summary').click();
    await expect(page.locator('#lesson-leave')).toBeVisible();
    await check(page, 'More menu open', 14);
    await page.locator('.lesson-more summary').click();
    await expect(page.locator('#lesson-leave')).toBeHidden();

    // The student's calculator.
    await page.locator('#lesson-calc-toggle').click();
    await expect(page.locator('#lesson-calc .lesson-calc-body[data-ready]')).toBeAttached();
    await expect(page.locator('#lesson-calc .dcg-expressionlist')).toBeVisible();
    await typeInto(page, '#lesson-calc', 'y=1111x');
    await check(page, 'own calculator open', 12);

    // Lock-in confirm dialog, then locked.
    await page.locator('#lesson-lock').click();
    await expect(page.locator('.lesson-confirm-dialog')).toBeVisible();
    await check(page, 'lock-in confirm dialog', 3);
    await pills(page, 'lock-in confirm dialog', ['#lesson-confirm']);
    await plain(page, 'lock-in confirm dialog', ['#lesson-back']);
    await shot(page, 'shapes-lock-confirm');
    await page.locator('#lesson-confirm').click();
    await expect(page.locator('.lesson-locked')).toBeVisible();
    await check(page, 'locked', 8);

    // The instructor's graph and the reveal: results, explanation, follower panel next to the calculator.
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await typeInto(teacher, '#live-desmos', 'y=2468x');
    await teacher.locator('[data-live="endNow"]').click();
    await expect(page.locator('#lesson-desmos')).toBeVisible();
    await expect(page.locator('#lesson-desmos .dcg-expressionlist')).toContainText('2468');
    await expect(page.locator('.lesson-reveal')).toBeVisible();
    await check(page, 'revealed with calculator and instructor graph', 12);

    // Try it yourself on a non-empty calculator asks first.
    await page.locator('#lesson-desmos-fork').click();
    await expect(page.locator('#lesson-calc-confirm')).toBeVisible();
    await check(page, 'Try it yourself confirm dialog', 3);
    await page.locator('#lesson-calc-cancel').click();
    await page.locator('#lesson-calc-close').click();
    await page.locator('.lesson-reveal summary').first().click();
    await check(page, 'revealed, explanation open, calculator closed', 8);

    // Grid-in question.
    await teacher.locator('[data-live="next"]').click();
    await teacher.locator('[data-live="startQuestion"]').click();
    await expect(page.locator('#lesson-grid')).toBeVisible();
    await expect(page.locator('#lesson-content')).toContainText('ANSWERING');
    await check(page, 'answering (grid-in)', 8);
    await page.locator('#lesson-grid').fill('3');
    await page.locator('#lesson-pick').click();
    await check(page, 'grid-in answered', 8);
    await teacher.locator('[data-live="endNow"]').click();
    await expect(page.locator('#lesson-content')).toContainText('REVEALED');
    await check(page, 'revealed (grid-in)', 8);

    // End of session: My Lessons history.
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await context.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await dismissEnded(page);
    await expect(page.locator('#lesson-live')).toBeHidden();
    await page.locator('.nav-i[data-tab="lessons"]').click();
    await page.locator(`#lessons-table tr[data-session="${sessionId}"]`).click({ timeout: 10000 });
    await expect(page.locator('#history-summary')).toBeVisible();
    await check(page, 'My Lessons summary', 3);
    await page.locator(`[data-history-open="${MATH}"]`).click();
    await expect(page.locator('#history-show')).not.toBeChecked();
    await expect(page.locator('#history-reveal')).toHaveCount(0);
    await check(page, 'My Lessons answers hidden', 8);
    await page.locator('#history-show').check();
    await expect(page.locator('#lesson-card[data-ready]')).toBeVisible();
    await expect(page.locator('#history-reveal')).toBeVisible();
    await check(page, 'My Lessons history', 8);
    await pills(page, 'My Lessons', ['#history-next', '.lesson-position']);
    await plain(page, 'My Lessons', ['#history-prev', '#history-close']);
    await shot(page, 'shapes-history');
    console.log('shape sweep (elements examined per screen):', JSON.stringify(counts));
  } finally { await admin.close(); await context.close(); }
});

test('shape rule on every screen of a self-paced lesson: answering, navigator, review page, submit-all modal, submitted, poll, dropdown, result, review', async ({ browser }) => {
  test.setTimeout(240000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const context = await newUserContext(browser, 'e2e-student-2');
  const counts = {};
  const check = async (page, label, min) => { counts[label] = (await sweep(page, label, min)).checked; };
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Task11 shapes self', [MATH, RW, SPR], 'self');
    const teacher = await openLive(admin, sessionId);
    const page = await context.newPage();
    await join(page, joinCode);
    await check(page, 'self-paced lobby', 3);
    await teacher.locator('[data-live="start"]').click();
    await expect(page.locator('#self-nav')).toHaveText('Question 1 of 3');
    await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    await check(page, 'self-paced answering', 10);
    await pills(page, 'self-paced answering', ['#self-nav', '#self-next']);
    await plain(page, 'self-paced answering', ['.lesson-timer button', '#self-back']);

    // A wrong answer (the key is C), a flag, the navigator and the calculator.
    await page.locator('[data-lesson-choice="A"]').click();
    await page.locator('#self-flag').click();
    await expect(page.locator('#self-flag')).toHaveAttribute('aria-pressed', 'true');
    await check(page, 'self-paced answering, picked and flagged', 10);
    await page.locator('#lesson-calc-toggle').click();
    await expect(page.locator('#lesson-calc .lesson-calc-body[data-ready]')).toBeAttached();
    await check(page, 'self-paced with calculator open', 10);
    await page.locator('#lesson-calc-close').click();
    await page.locator('#self-nav').click();
    await expect(page.locator('#self-navigator')).toBeVisible();
    await check(page, 'question navigator open', 14);
    await shot(page, 'shapes-navigator');
    await page.locator('#self-nav').click();
    await expect(page.locator('#self-navigator')).toHaveCount(0);
    await page.locator('.lesson-more summary').click();
    await check(page, 'self-paced More menu open', 10);
    await page.locator('.lesson-more summary').click();

    // Q2 reading, Q3 grid-in, then the review page.
    await page.locator('#self-next').click();
    await expect(page.locator('#self-nav')).toHaveText('Question 2 of 3');
    await page.locator('[data-lesson-choice="B"]').click();
    await check(page, 'self-paced reading question', 10);
    await page.locator('#self-next').click();
    await expect(page.locator('#lesson-grid')).toBeVisible();
    await page.locator('#lesson-grid').fill('3');
    await check(page, 'self-paced grid-in', 8);
    await page.locator('#self-next').click();
    await expect(page.locator('#self-review')).toBeVisible();
    await check(page, 'review page', 10);
    await pills(page, 'review page', ['#self-nav', '#self-submit']);
    await plain(page, 'review page', ['#self-back']);
    await shot(page, 'shapes-review-page');
    await page.locator('#self-submit').click();
    await expect(page.locator('#self-confirm')).toBeVisible();
    await check(page, 'submit-all modal', 3);
    await pills(page, 'submit-all modal', ['#self-confirm']);
    await plain(page, 'submit-all modal', ['#self-cancel']);
    await shot(page, 'shapes-submit-modal');
    await page.locator('#self-confirm').click();
    await expect(page.locator('#self-status')).toContainText('Your answers were submitted');
    await check(page, 'submitted notice', 2);

    // Review poll: options, dropdown, result, review mode.
    await expect(teacher.locator('#review-summary')).toBeVisible();
    await teacher.locator('[data-live="startPoll"]').click();
    await expect(page.locator('#poll')).toBeVisible();
    await check(page, 'poll', 4);
    await pills(page, 'poll', ['#poll-vote']);
    await page.locator('#poll-2').click();
    await expect(page.locator('#poll-pick')).toBeVisible();
    await check(page, 'poll with the question dropdown', 5);
    await shot(page, 'shapes-poll');
    await page.locator('#poll-1').click();
    await page.locator('#poll-vote').click();
    await expect(page.locator('#poll-result')).toBeVisible();
    await check(page, 'poll result', 2);
    await expect(page.locator('.lesson-phase')).toHaveText('REVIEW');
    await expect(page.locator('.lesson-reveal')).toBeVisible();
    await check(page, 'review mode', 8);
    await page.locator('.lesson-reveal summary').first().click();
    await check(page, 'review mode, explanation open', 8);
    console.log('shape sweep (elements examined per screen):', JSON.stringify(counts));
  } finally { await admin.close(); await context.close(); }
});
