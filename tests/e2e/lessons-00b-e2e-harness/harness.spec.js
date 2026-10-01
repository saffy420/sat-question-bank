import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { CHROMEBOOK, ORIGIN, localURL, newUserContext } from './auth.js';
import { captureLeaks, inspectPayload } from './leaks.js';
import { setOffline, throttle, SLOW_3G } from './network.js';

const artifacts = '.opencode/pipeline/lessons-00b-e2e-harness/e2e';
// In bank order (core rows, then AI). The e2e-used-*/unused rows are the task09 lesson-usage filter fixtures.
const ids = ['e2e-core-rw', 'e2e-core-math', 'e2e-core-spr', 'e2e-used-mine', 'e2e-used-other', 'e2e-unused', 'e2e-split-rw', 'e2e-fig-math', 'e2e-ai-rw'];

async function bank(page, name) {
  const loaded = page.waitForResponse(r => r.url() === localURL('/api/questions') && r.status() === 200);
  const navigation = await page.goto('/app', { waitUntil: 'domcontentloaded' });
  expect(navigation.status()).toBe(200); // Cookie from login must authenticate initial navigation.
  const response = await loaded;
  const questions = await response.json();
  expect(questions.map(q => q.id).sort()).toEqual([...ids].sort());
  expect(questions.some(q => q.source === 'AI')).toBe(true);
  expect(questions.some(q => q.source !== 'AI')).toBe(true);
  await expect(page.locator('#user-name')).toHaveText(name);
  expect(await page.evaluate(() => window.__qa().QS.map(q => q.id).sort())).toEqual([...ids].sort());
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('#home-stats .v')?.textContent === '9' &&
    document.querySelector('[data-tab="plan"]')?.classList.contains('on') &&
    document.querySelector('#tab-practice')?.classList.contains('hide') &&
    !document.querySelector('#tab-plan')?.classList.contains('hide')
  )).toBe(true); // load() completed refresh() and final setTab('plan') (the Study Plan is the first screen), not merely QS assignment.
  return questions;
}

test('C1 admin login cookie opens gated app; core and AI bank render', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-admin');
  try {
    const page = await context.newPage();
    await bank(page, 'E2E Admin');
    await page.locator('[data-tab="browse"]').click();
    await expect(page.locator('#browse-count')).toHaveText('9 questions'); // 7 + the 11b split-layout and figure-viewer fixtures
    await expect(page.locator('#tab-browse #browse-body tr[data-id]')).toHaveCount(9);
    await expect(page.locator('#tab-browse #browse-body')).toContainText('e2e-ai-rw');
    await page.screenshot({ path: `${artifacts}/C1-admin.png` });
  } finally { await context.close(); }
});

test('C2 student separate context; real MC choices and SPR renderer', async ({ browser }) => {
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-1');
  try {
    const adminPage = await admin.newPage();
    const page = await student.newPage();
    await bank(adminPage, 'E2E Admin');
    await bank(page, 'E2E Student 1');
    expect((await admin.cookies(ORIGIN)).find(c => c.name === '__Host-sat_session').value)
      .not.toBe((await student.cookies(ORIGIN)).find(c => c.name === '__Host-sat_session').value);
    expect(page.viewportSize()).toEqual(CHROMEBOOK);
    await page.locator('[data-tab="practice"]').click();
    await expect(page.locator('[data-tab="practice"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#tab-practice #btn-start')).toBeVisible();
    await page.locator('#btn-start').click();
    await expect(page.locator('#bank-live')).toBeVisible();
    for (const id of ids) {
      await expect.poll(() => page.evaluate(() => window.__qa().S?.items[window.__qa().S.i]?.id)).toBe(id);
      if (id === 'e2e-core-spr') {
        await expect(page.locator('#bank-card #lesson-grid')).toBeVisible();
        await expect(page.locator('#bank-card [data-lesson-choice]')).toHaveCount(0);
        await page.screenshot({ path: `${artifacts}/C2-student-SPR.png` });
      } else {
        const choices = await page.locator('#bank-card [data-lesson-choice] .choice').allTextContents();
        expect(choices).toHaveLength(4);
        expect(new Set(choices.map(x => x.trim())).size).toBe(4);
        await expect(page.locator('#bank-card #lesson-grid')).toHaveCount(0);
        if (id === 'e2e-core-rw') await page.screenshot({ path: `${artifacts}/C2-student-MC.png` });
      }
      if (id !== ids.at(-1)) await page.locator('#bank-primary').click();
    }
    await expect(adminPage.locator('#user-name')).toHaveText('E2E Admin');
  } finally { await student.close(); await admin.close(); }
});

test('C3 real flag-unset server rejects login and forged cookie', async ({ request }) => {
  const login = await request.post(localURL('https://127.0.0.1:8788/api/e2e/login'), { data: { account: 'e2e-admin' }, headers: { Origin: 'https://127.0.0.1:8788' } });
  expect(login.status()).toBe(404);
  expect(login.headers()['set-cookie']).toBeUndefined();
  const app = await request.get(localURL('https://127.0.0.1:8788/app'), { headers: { Cookie: '__Host-sat_session=e2e.forged' }, maxRedirects: 0 });
  expect(app.status()).toBe(302);
  expect(app.headers().location).toBe('/login');
  const page = await request.get(localURL('https://127.0.0.1:8788/login'));
  expect(page.status()).toBe(200);
});

test('C4 production entry with test flag has no login or synthetic session bypass', async ({ request }) => {
  const login = await request.post(localURL('https://127.0.0.1:8789/api/e2e/login'), { data: { account: 'e2e-admin' }, headers: { Origin: 'https://127.0.0.1:8789' } });
  expect(login.status()).toBe(404);
  expect(login.headers()['set-cookie']).toBeUndefined();
  const app = await request.get(localURL('https://127.0.0.1:8789/app'), { headers: { Cookie: '__Host-sat_session=e2e.forged' }, maxRedirects: 0 });
  expect(app.status()).toBe(302);
  expect(app.headers().location).toBe('/login');
});

test('offline HTTP failure and recovery, then CDP throttle HTTP smoke', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-2');
  try {
    const page = await context.newPage();
    await bank(page, 'E2E Student 2');
    await setOffline(context, true);
    await expect(page.evaluate(() => fetch('/api/questions').then(r => r.status).catch(() => 'offline'))).resolves.toBe('offline');
    await setOffline(context, false);
    await expect.poll(() => page.evaluate(() => fetch('/api/questions').then(r => r.status).catch(() => 0))).toBe(200);
    const control = await throttle(page);
    try {
      expect(control.profile).toEqual(SLOW_3G);
      const start = Date.now();
      await expect.poll(() => page.evaluate(() => fetch('/api/questions').then(r => r.status).catch(() => 0))).toBe(200);
      expect(Date.now() - start).toBeGreaterThanOrEqual(SLOW_3G.latency - 50);
    } finally { await control.restore(); }
  } finally { await context.close(); }
});

test('scoped leak capture sees real local HTTP and browser-received WS frames; bank exempt', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-3');
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/api/lessons/fixture/leak'
      ? '{"correct_answer":"B","notes":"E2E_NOTES_MARKER_smoke"}' : '{"choice":"B"}');
  });
  const sockets = new WebSocketServer({ server });
  try {
    sockets.on('connection', ws => ws.on('message', message => {
      if (message.toString() === 'probe') {
        ws.send('{"choice":"B"}');
        ws.send('{"answerKey":"B","notes":"E2E_NOTES_MARKER_ws"}');
      }
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const capture = captureLeaks(context);
    const page = await context.newPage();
    await bank(page, 'E2E Student 3'); // Practice answer and explanation are intentional G1-A disclosure.
    const second = await context.newPage();
    await second.goto(origin + '/api/lessons/fixture');
    await second.evaluate(async () => {
      const gotFrames = new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/api/lessons/fixture/ws`);
        const frames = [];
        socket.onopen = () => socket.send('probe');
        socket.onmessage = event => { frames.push(event.data); if (frames.length === 2) { socket.close(); resolve(frames); } };
        socket.onerror = () => reject(new Error('controlled WS failed'));
      });
      await fetch('/api/lessons/fixture/leak');
      await gotFrames;
    });
    await expect.poll(() => capture.frames.length).toBe(2);
    await capture.flush();
    expect(capture.errors).toEqual([]);
    expect(capture.bodies).toHaveLength(2);
    expect(capture.frames.map(x => x.body)).toEqual([
      '{"choice":"B"}', '{"answerKey":"B","notes":"E2E_NOTES_MARKER_ws"}'
    ]);
    expect(capture.violations().map(x => `${x.transport}:${x.violation}`).sort()).toEqual([
      'http:$.correct_answer', 'http:$.notes', 'http:private marker',
      'ws:$.answerKey', 'ws:$.notes', 'ws:private marker'
    ]);
    expect(inspectPayload('{"choice":"B","selection":2}')).toEqual([]);
    expect(inspectPayload('{"stem":"ordinary","correct_answer":"B"}')).toContain('$.correct_answer');
  } finally {
    await context.close();
    for (const ws of sockets.clients) ws.terminate();
    await new Promise(resolve => sockets.close(() => server.close(resolve)));
  }
});
