import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';
import { captureLeaks } from '../lessons-00b-e2e-harness/leaks.js';
import { shapedOrigin, SLOW_3G } from '../lessons-00b-e2e-harness/network.js';

const artifacts = '.omp/pipeline/lessons-06-desmos/e2e';
const TARGET_MS = 500;
const teacherList = page => page.locator('#live-desmos .dcg-expressionlist');
const studentList = page => page.locator('#lesson-desmos .dcg-expressionlist');

// Records CSP violations, lesson ping round trips, and the time a marker first appears in the student panel.
function instrument(context) {
  return context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.__rtt = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols);
        if (String(url).includes('/api/lessons/')) this.addEventListener('message', e => {
          const m = JSON.parse(e.data);
          if (m.type === 'pong') window.__rtt.push(Date.now() - m.sentAt);
        });
      }
    };
    window.__seen = {};
    window.__watch = marker => {
      const check = () => {
        const text = document.querySelector('#lesson-desmos .dcg-expressionlist')?.textContent || '';
        if (text.includes(marker) && !window.__seen[marker]) window.__seen[marker] = Date.now();
      };
      new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      check();
    };
  });
}

async function join(page, code) {
  await page.goto('/app');
  await expect(page.locator('#user-name')).toContainText('E2E Student');
  await page.locator('#join-lesson').click();
  for (const [i, letter] of [...code].entries()) await page.locator('#lesson-code input').nth(i).fill(letter);
  await page.locator('#join-go').click();
  await expect(page.locator('#lesson-connection')).toContainText('Connected');
}

async function lesson(admin, questionId) {
  const created = await admin.request.post('/api/admin/lessons', { headers: { Origin: ORIGIN }, data: {
    title: `Task06 ${questionId} ${Date.now()}`, mode: 'instructor', items: [{ question_id: questionId, time_limit_sec: 60, notes: '' }]
  } });
  expect(created.status(), await created.text()).toBe(200);
  const started = await admin.request.post(`/api/admin/lessons/${(await created.json()).id}/sessions`, { headers: { Origin: ORIGIN } });
  expect(started.status(), await started.text()).toBe(200);
  return started.json();
}

// Types into a new expression row of the instructor's calculator like a person would.
async function typeExpression(teacher, latex) {
  await teacher.locator('#live-desmos .dcg-new-expression').click();
  await teacher.keyboard.type(latex);
  await expect(teacherList(teacher)).toContainText(latex.replace(/^y=/, ''));
}

const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });

test('task06 Desmos sync: reveal gate, Slow 3G latency, read-only follower, fork, back, reconnect, CSP', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  // The Chromebook student reaches the local server only through a Slow 3G-shaped relay.
  const relay = await shapedOrigin(SLOW_3G);
  const slow = await newUserContext(browser, 'e2e-student-1', { baseURL: relay.origin });
  const forker = await newUserContext(browser, 'e2e-student-2');
  for (const context of [admin, slow, forker]) await instrument(context);
  const leaks = [captureLeaks(slow, { phaseAware: true }), captureLeaks(forker, { phaseAware: true })];
  try {
    const { sessionId, joinCode } = await lesson(admin, 'e2e-core-math');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const student = await slow.newPage();
    await join(student, joinCode);
    const second = await forker.newPage();
    await join(second, joinCode);
    // Math lesson: the API is fetched in the lobby, before any reveal.
    for (const p of [student, second]) await expect.poll(() => p.evaluate(() => typeof window.Desmos?.GraphingCalculator)).toBe('function');

    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('#lesson-content')).toContainText('ANSWERING');
    await teacher.locator('#live-desmos-toggle').click();
    await expect(teacher.locator('#live-desmos .live-desmos-calc[data-ready]')).toBeVisible();
    await expect(teacher.locator('#live-desmos')).toContainText('Students see your graph after the reveal.');
    await typeExpression(teacher, 'y=7777x');
    await shot(teacher, '01-instructor-answering-private-graph');
    // Pre-reveal work stays on the instructor's screen.
    await expect(student.locator('#lesson-desmos')).toHaveCount(0);
    await expect(second.locator('#lesson-desmos')).toHaveCount(0);

    await teacher.locator('[data-live="endNow"]').click();
    for (const p of [student, second]) {
      await expect(p.locator('#lesson-content')).toContainText('REVEALED');
      await expect(p.locator('#lesson-desmos')).toBeVisible();
      await expect(studentList(p)).toContainText('7777');
    }
    for (const capture of leaks) {
      await capture.flush();
      const frames = capture.frames.map(f => JSON.parse(f.body));
      const firstReveal = frames.findIndex(f => f.phase === 'REVEALED');
      expect(firstReveal).toBeGreaterThanOrEqual(0);
      const firstDesmos = frames.findIndex(f => JSON.stringify(f).includes('7777'));
      expect(firstDesmos).toBeGreaterThan(firstReveal);
      expect(capture.bodies.every(b => !b.body.includes('7777'))).toBe(true);
      expect(capture.violations()).toEqual([]);
    }
    await shot(student, '02-student-panel-opened-on-reveal');

    // WebSocket frames really are delayed on the Chromebook profile (not just HTTP).
    const rtts = await student.evaluate(() => window.__rtt.slice(-5));
    expect(Math.min(...rtts)).toBeGreaterThanOrEqual(SLOW_3G.latency);

    // Latency: last keystroke on the instructor laptop → marker rendered in the throttled student panel.
    const samples = [];
    // One reused row, so every marker stays in the rendered part of the student's list.
    await typeExpression(teacher, 'y=x+9000');
    const rows = teacher.locator('#live-desmos .dcg-expressionitem');
    const row = rows.nth(await rows.evaluateAll(els => els.findIndex(el => el.textContent.includes('9000'))));
    for (const marker of ['41', '52', '63', '74', '85']) {
      await student.evaluate(m => window.__watch(m), `90${marker}`);
      await row.locator('.dcg-mq-editable-field').click();
      await teacher.keyboard.press('Control+A');
      await teacher.keyboard.type(`y=x+90${marker[0]}`);
      await teacher.evaluate(() => window.addEventListener('keydown', () => { window.__keyAt = Date.now(); }, { once: true, capture: true }));
      await teacher.keyboard.press(marker[1]);
      const pressed = await teacher.evaluate(() => window.__keyAt);
      await expect.poll(() => student.evaluate(m => window.__seen[m] || 0, `90${marker}`)).toBeGreaterThan(0);
      samples.push(await student.evaluate(m => window.__seen[m], `90${marker}`) - pressed);
    }
    const state = await teacher.evaluate(() => document.querySelector('#live-desmos .dcg-expressionlist')?.textContent.length);
    writeFileSync(`${artifacts}/latency.json`, JSON.stringify({ profile: SLOW_3G, pingRttMs: rtts, samplesMs: samples, targetMs: TARGET_MS, expressionTextChars: state }, null, 2));
    console.log(`Desmos latency under Slow 3G (ms): ${samples.join(', ')}; ping RTT ${rtts.join(', ')}`);
    for (const ms of samples) expect(ms).toBeLessThanOrEqual(TARGET_MS);
    await shot(student, '03-student-slow3g-synced');

    // Following students cannot edit: the calculator is inert and typing changes nothing.
    await expect(student.locator('#lesson-desmos')).toHaveAttribute('data-mode', 'follow');
    const before = await studentList(student).textContent();
    await student.locator('#lesson-desmos .dcg-expressionitem').filter({ hasText: '7777' }).click();
    await student.keyboard.type('5555');
    await student.keyboard.press('Backspace');
    await student.locator('#lesson-desmos .dcg-new-expression').click();
    await student.keyboard.type('y=5555');
    await expect(studentList(student)).toHaveText(before);
    expect(await student.evaluate(() => !!document.activeElement?.closest('#lesson-desmos .lesson-desmos-calc'))).toBe(false);
    // No zoom controls for followers; the instructor's panel has them, so the selector is live.
    await expect(teacher.locator('#live-desmos [aria-label="Zoom In"]')).toHaveCount(1);
    await expect(student.locator('#lesson-desmos [aria-label="Zoom In"]')).toHaveCount(0);

    // Try it yourself: an editable copy whose edits stay local.
    await second.locator('#lesson-desmos-fork').click();
    await expect(second.locator('#lesson-desmos')).toHaveAttribute('data-mode', 'fork');
    await second.locator('#lesson-desmos .dcg-new-expression').click();
    await second.keyboard.type('y=3131');
    await expect(studentList(second)).toContainText('3131');
    await shot(second, '04-student-fork-editing');
    // While forked, instructor updates are held back from this panel but reach others.
    await typeExpression(teacher, 'y=2468');
    await expect(studentList(student)).toContainText('2468');
    await expect(studentList(second)).not.toContainText('2468');
    await expect(teacherList(teacher)).not.toContainText('3131');
    await expect(studentList(student)).not.toContainText('3131');

    // Back to instructor view resyncs to the latest instructor state and drops the fork.
    await second.locator('#lesson-desmos-back').click();
    await expect(second.locator('#lesson-desmos')).toHaveAttribute('data-mode', 'follow');
    await expect(studentList(second)).toContainText('2468');
    await expect(studentList(second)).not.toContainText('3131');
    await second.locator('#lesson-desmos .dcg-new-expression').click();
    await second.keyboard.type('y=6161');
    await expect(studentList(second)).not.toContainText('6161');
    await shot(second, '05-student-back-to-instructor');
    // Clock fields are left out: a serverNow around 1790559313xxx contains "3131" by itself.
    const withoutClock = body => JSON.stringify({ ...JSON.parse(body), serverNow: undefined, sentAt: undefined });
    for (const capture of leaks) { await capture.flush(); expect(capture.frames.some(f => withoutClock(f.body).includes('3131'))).toBe(false); }
    // Still scrollable while following, so rows below the fold stay reachable.
    for (const n of [101, 102, 103, 104, 105]) await typeExpression(teacher, `y=x+${n}`);
    await expect(studentList(student)).toContainText('x+101');
    await expect(studentList(student)).not.toContainText('x+105');
    const scroller = () => student.locator('#lesson-desmos .dcg-expressionlist').evaluate(el => {
      for (let n = el; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return { top: n.scrollTop, overflow: n.scrollHeight - n.clientHeight };
      return null;
    });
    expect((await scroller())?.overflow).toBeGreaterThan(0);
    await studentList(student).hover();
    await student.mouse.wheel(0, 400);
    await expect.poll(async () => (await scroller())?.top).toBeGreaterThan(0);
    await expect(studentList(student)).toContainText('x+105');

    // Reconnect (fresh page load): the snapshot carries the latest graph.
    await join(second, joinCode);
    await expect(second.locator('#lesson-desmos')).toBeVisible();
    await expect(second.locator('#lesson-desmos')).toHaveAttribute('data-mode', 'follow');
    await expect(studentList(second)).toContainText('7777');
    await expect(studentList(second)).toContainText('2468');
    await shot(second, '06-student-reconnect-restored');

    for (const p of [teacher, student, second]) expect(await p.evaluate(() => window.__csp)).toEqual([]);
  } finally {
    await Promise.all([admin.close(), slow.close(), forker.close()]);
    await relay.close();
  }
});

test('task06 non-math lesson never loads the Desmos API', async ({ browser }) => {
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const context = await newUserContext(browser, 'e2e-student-3');
  try {
    const requests = [];
    context.on('request', r => { if (new URL(r.url()).hostname.endsWith('desmos.com')) requests.push(r.url()); });
    const { sessionId, joinCode } = await lesson(admin, 'e2e-core-rw');
    const teacher = await admin.newPage();
    await teacher.goto(`/admin/live/${sessionId}`);
    await expect(teacher.locator('#live-link')).toHaveText('Connected');
    const student = await context.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('#lesson-content')).toContainText('REVEALED');
    await expect(teacher.locator('#live-desmos-toggle')).toHaveCount(0);
    expect(await student.evaluate(() => typeof window.Desmos)).toBe('undefined');
    expect(requests).toEqual([]);
  } finally {
    await Promise.all([admin.close(), context.close()]);
  }
});
