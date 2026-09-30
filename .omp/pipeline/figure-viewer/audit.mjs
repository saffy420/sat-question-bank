// figure-viewer audit: every math question with a figure, rendered by the real bank player and the real lesson
// student view at 1366×768, 100 %. Local only, no database writes:
//   - the bank player's /api/questions is answered with the recovered snapshot's math-figure questions;
//   - the lesson view is a real e2e session whose student snapshot has its question swapped for each audited one
//     (Playwright WebSocket routing), so it runs lesson-ui's Stage exactly as a student sees it;
//   - /qimg/* crops are served from a local copy.
// Needs: the e2e server on :8787 (`node tools/e2e_server.cjs enabled`, seeded), BANK=<snapshot json>, QIMG=<crop dir>.
// Usage: BANK=... QIMG=... OUT=... node .omp/pipeline/figure-viewer/audit.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { newUserContext } from '../../../tests/e2e/lessons-00b-e2e-harness/auth.js';
import { lesson, join, openLive } from '../../../tests/e2e/lessons-11-ui-polish/helpers.js';

const { BANK, QIMG, OUT = '.omp/pipeline/figure-viewer/e2e/audit' } = process.env;
mkdirSync(OUT, { recursive: true });
const all = JSON.parse(readFileSync(BANK, 'utf8'));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const figureQs = all.filter(q => !only || only.includes(q.id)).filter(q => q.section === 'Math' && (/class="qfig"/.test(q.stem_html || '') || /<svg[^>]*role="img"/.test(q.stem_html || '')));
const expected = q => ((q.stem_html || '').match(/class="qfig"/g) || []).length + ((q.stem_html || '').match(/<svg[^>]*role="img"/g) || []).length;
console.log(`auditing ${figureQs.length} math questions with figures`);

async function serveCrops(context) {
  await context.route('**/qimg/**', route => {
    const file = pathJoin(QIMG, decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/qimg\//, '')));
    return existsSync(file) ? route.fulfill({ path: file, contentType: { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }[file.split('.').pop()] || 'image/webp' }) : route.fulfill({ status: 404, body: '' });
  });
}

// Checks shared by both views. `stem` is the stem container, `choice` the first answer control (or grid-in),
// `limit` the bottom edge the first choice must clear (pane bottom / footer top).
const check = (page, { card, stem, choice, limit, scroller }) => page.evaluate(async ({ card, stem, choice, limit, scroller }) => {
  const root = document.querySelector(card), body = root.querySelector(stem);
  const r = el => el.getBoundingClientRect();
  const frames = [...root.querySelectorAll('.fv')];
  await Promise.all(frames.map(f => { const i = f.querySelector('img'); return i && !i.complete ? new Promise(ok => { i.onload = i.onerror = ok; }) : null; }));
  // The bank fits its figures once they have decoded (a microtask after load): let that land.
  await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const problems = [];
  if (root.querySelectorAll('.qfig:not(.choice .qfig)').length) problems.push('stray .qfig outside a viewer');
  const colR = r(body);
  for (const [k, f] of frames.entries()) {
    const media = f.querySelector('.fv-content > img, .fv-content > svg'), fr = r(f), mr = media ? r(media) : null, view = r(f.querySelector('.fv-view'));
    if (!f.querySelector('.fv-bar [data-fv="full"]')) problems.push(`frame ${k}: toolbar missing`);
    if (!media) { problems.push(`frame ${k}: no figure`); continue; }
    if (media.tagName === 'IMG' && !(media.naturalWidth > 0)) problems.push(`frame ${k}: image failed to load`);
    if (mr.width < 40 || mr.height < 30) problems.push(`frame ${k}: figure tiny (${Math.round(mr.width)}x${Math.round(mr.height)})`);
    if (mr.left < view.left - 0.5 || mr.right > view.right + 0.5 || mr.top < view.top - 0.5 || mr.bottom > view.bottom + 0.5) problems.push(`frame ${k}: figure overflows its frame at 100%`);
    if (fr.left < colR.left - 0.5 || fr.right > colR.right + 0.5) problems.push(`frame ${k}: frame wider than the column`);
    if (Math.abs((fr.left + fr.right) / 2 - (colR.left + colR.right) / 2) > 1.5) problems.push(`frame ${k}: not centred`);
    if (media.tagName === 'IMG' && mr.width > media.naturalWidth + 0.5) problems.push(`frame ${k}: upscaled past natural size`);
    if (f.parentElement !== body) problems.push(`frame ${k}: not a direct block of the stem`);
  }
  const first = root.querySelector(choice), lim = document.querySelector(limit);
  // Same rule as figure.js fitFigures: the first choice's first 80 px (a picture choice may be taller than the screen).
  const firstVisible = first ? Math.min(r(first).bottom, r(first).top + 80) <= Math.min(lim ? r(lim)[limit.includes('footer') ? 'top' : 'bottom'] : innerHeight, innerHeight) + 0.5 : null;
  const hscroll = document.documentElement.scrollWidth > innerWidth + 0.5;
  if (hscroll) problems.push('horizontal page scroll');
  const tallest = Math.max(0, ...frames.map(f => r(f).height));
  const capped = frames.some(f => f.style.getPropertyValue('--fv-h'));
  return { frames: frames.length, problems, firstVisible, capped, tallest: Math.round(tallest), scroll: scroller ? document.querySelector(scroller)?.scrollTop : null };
}, { card, stem, choice, limit, scroller });

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const results = { bank: [], lesson: [] };
try {
  // ---- bank practice player ----
  const bankCtx = await newUserContext(browser, 'e2e-student-4', { viewport: { width: 1366, height: 768 } });
  await serveCrops(bankCtx);
  await bankCtx.route('**/api/questions', route => route.fulfill({ json: figureQs }));
  const page = await bankCtx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/app');
  await page.waitForFunction(() => window.__qa && window.__qa().QS.length > 0);
  await page.locator('[data-tab="practice"]').click();
  await page.locator('#dd-count .dd-t').click();
  await page.locator('#dd-count .dd-o[data-v="0"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#btn-start').click();
  await page.waitForSelector('#view-test:not(.hide)');
  const n = await page.evaluate(() => window.__qa().S.items.length);
  for (let i = 0; i < n; i++) {
    const id = await page.evaluate(() => { const { S } = window.__qa(); return S.items[S.i].id; });
    const q = figureQs.find(x => x.id === id);
    const res = await check(page, { card: '#pane-a', stem: '.stem', choice: q.choices_json && JSON.parse(q.choices_json).length ? '.choice' : '#gi', limit: '#pane-a' });
    if (res.frames !== expected(q)) res.problems.push(`${res.frames} frames for ${expected(q)} figures`);
    results.bank.push({ id, ...res });
    if (res.problems.length || !res.firstVisible) await page.screenshot({ path: `${OUT}/bank-${id}.png` });
    if (i < n - 1) await page.locator('#btn-next').click();
  }
  results.bankErrors = errors;
  await bankCtx.close();

  // ---- lesson student view ----
  const admin = await newUserContext(browser, 'e2e-admin', { viewport: { width: 1920, height: 1080 } });
  const student = await newUserContext(browser, 'e2e-student-4', { viewport: { width: 1366, height: 768 } });
  await serveCrops(student); await serveCrops(admin);
  await student.route('**/qimg/e2e-fig-math.svg', route => route.fulfill({ path: 'tests/e2e/figure-viewer/scatter.svg', contentType: 'image/svg+xml' }));
  const { sessionId, joinCode } = await lesson(admin, 'Figure audit', ['e2e-fig-math'], 'instructor', 600);
  let socket, snap;
  await student.routeWebSocket(/\/api\/lessons\/\d+\/ws/, route => {
    socket = route;
    const server = route.connectToServer();
    server.onMessage(m => { try { const d = JSON.parse(m); if (d.type === 'snapshot' && d.question) snap = d; } catch {} route.send(m); });
    route.onMessage(m => server.send(m));
  });
  const teacher = await openLive(admin, sessionId);
  const sp = await student.newPage();
  const lessonErrors = []; sp.on('pageerror', e => { lessonErrors.push(e.message); console.log('pageerror', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
  await join(sp, joinCode);
  await teacher.locator('[data-live="start"]').click();
  await sp.waitForSelector('#lesson-card[data-ready="true"]');
  await sp.waitForFunction(() => true);
  for (const q of figureQs) {
    const choices = (() => { try { return JSON.parse(q.choices_json || '[]'); } catch { return []; } })();
    const question = { id: q.id, section: q.section, stem_html: q.stem_html, choices: choices.map(c => ({ letter: c.letter, content: c.content || '', img: c.img || '' })), spr: !choices.length };
    socket.send(JSON.stringify({ ...snap, questionId: q.id, question, annotations: [], eliminations: [], serverNow: Date.now() }));
    try {
      await sp.waitForFunction(id => document.querySelector('#lesson-card')?.dataset.ready === 'true' && document.querySelector('#lesson-card .lesson-stem') && window.__auditLast !== id && (window.__auditLast = id), q.id, { timeout: 15000 });
    } catch (e) {
      await sp.screenshot({ path: `${OUT}/lesson-timeout-${q.id}.png` });
      console.log('timeout', q.id, JSON.stringify(await sp.evaluate(() => ({ ready: document.querySelector('#lesson-card')?.dataset.ready, stem: document.querySelector('#lesson-card .lesson-stem')?.textContent.slice(0, 60), last: window.__auditLast, imgs: [...document.querySelectorAll('#lesson-card img')].map(i => [i.src.slice(-30), i.complete, i.naturalWidth]) }))));
      results.lesson.push({ id: q.id, frames: 0, problems: ['lesson view never became ready'], firstVisible: null });
      continue;
    }
    await sp.waitForTimeout(30);
    const res = await check(sp, { card: '#lesson-card', stem: '.lesson-stem', choice: choices.length ? '[data-lesson-choice]' : '#lesson-grid', limit: '.lesson-footer', scroller: '#lesson-live' });
    if (res.frames !== expected(q)) res.problems.push(`${res.frames} frames for ${expected(q)} figures`);
    results.lesson.push({ id: q.id, ...res });
    if (res.problems.length || !res.firstVisible) await sp.screenshot({ path: `${OUT}/lesson-${q.id}.png` });
    if (process.env.STEMSHOTS) await sp.locator('#lesson-card .lesson-stem').screenshot({ path: `${OUT}/stem-${q.id}.png` });
  }
  results.lessonErrors = lessonErrors;
  await admin.close(); await student.close();
} finally { await browser.close(); }

writeFileSync(`${OUT}/audit.json`, JSON.stringify(results, null, 1));
for (const view of ['bank', 'lesson']) {
  const rows = results[view];
  const bad = rows.filter(r => r.problems.length);
  const hidden = rows.filter(r => r.firstVisible === false);
  console.log(`${view}: ${rows.length} audited, ${bad.length} with problems, ${rows.filter(r => r.capped).length} shrunk to fit, ${hidden.length} with the first choice below the fold${hidden.length ? ': ' + hidden.map(r => r.id).join(' ') : ''}`);
  for (const r of bad) console.log(`  ${r.id}: ${r.problems.join('; ')}`);
}
console.log('page errors', results.bankErrors, results.lessonErrors);
