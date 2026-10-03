import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { startPractice } from '../bank-bluebook/support';

// app-chrome: /app is light only, the rail carries the Road to 1600 brand, every page links /favicon.svg, no Browse.
const SHOTS = 'docs/app-chrome';
const shot = (page, name, options = {}) => { mkdirSync(SHOTS, { recursive: true }); return page.screenshot({ path: `${SHOTS}/${name}.png`, ...options }); };
const ICON = 'link[rel="icon"][href="/favicon.svg"]';
const BRAND_PROPS = ['width', 'height', 'backgroundColor', 'color', 'borderTopLeftRadius', 'fontSize', 'fontWeight'] as const;
const brandStyle = (page, selector) => page.locator(selector).evaluate((el, props) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(props.map(p => [p, cs[p]]));
}, BRAND_PROPS);
// Perceived brightness of a computed rgb()/rgba() colour, 0 (black) to 255 (white).
const luma = (rgb: string) => { const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number); return 0.299 * r + 0.587 * g + 0.114 * b; };

test('/app stays light with the OS in dark mode: no toggle, no Appearance row, no data-theme', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-1', { colorScheme: 'dark' });
  try {
    // Settings saved when the app had a theme still carry one; it is ignored, not an error.
    await context.addInitScript(() => localStorage.setItem('satq_settings', JSON.stringify({ theme: 'dark', rand: false })));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/app');
    await expect(page.locator('#user-name')).toContainText('E2E Student');
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    for (const sel of ['body', '.board', '.panel']) {
      const bg = await page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
      expect(luma(bg), `${sel} ${bg}`).toBeGreaterThan(200);
    }
    await expect(page.locator('[data-theme-toggle], .theme-toggle, #bank-theme')).toHaveCount(0);
    await expect(page.locator('[data-tab="browse"], #tab-browse')).toHaveCount(0);

    await page.locator('.nav-i[data-tab="settings"]').click();
    await expect(page.locator('#set-body')).toContainText('Account');
    await expect(page.locator('#set-body')).not.toContainText('Appearance');
    await expect(page.locator('#set-body select[data-set="theme"]')).toHaveCount(0);
    // Changing another setting saves without the stale theme.
    const saved = page.waitForRequest(r => r.url().endsWith('/api/settings') && r.method() === 'POST');
    await page.locator('#set-body [data-sw="rand"]').click();
    expect(JSON.parse((await saved).postData()!)).not.toHaveProperty('theme');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('the practice player is light with the OS in dark mode', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-2', { colorScheme: 'dark' });
  try {
    const page = await context.newPage();
    await startPractice(page);
    await expect(page.locator('#bank-theme')).toHaveCount(0);
    const probe = await page.evaluate(() => {
      // The first opaque background at or above the question column: what a student sees behind the text.
      let el: Element | null = document.querySelector('#bank-card');
      while (el && /rgba\(.*, 0\)|transparent/.test(getComputedStyle(el).backgroundColor)) el = el.parentElement;
      return {
        main: el ? getComputedStyle(el).backgroundColor : 'rgb(0, 0, 0)',
        filter: getComputedStyle(document.querySelector('#bank-live .lesson-main')!).filter,
        footer: document.querySelector('#bank-live .lesson-footer')!.getBoundingClientRect().bottom, vh: innerHeight
      };
    });
    expect(luma(probe.main)).toBeGreaterThan(200);
    expect(probe.filter).toBe('none');
    expect(probe.footer).toBe(probe.vh);
    await shot(page, 'practice-light-os-dark');
  } finally { await context.close(); }
});

test('rail brand: the front page r. mark beside Road to 1600, links to /app, survives the narrow rail', async ({ browser, page }) => {
  await page.goto('/');
  const front = await brandStyle(page, 'header .brand-mark');
  expect(front).toMatchObject({ width: '34px', backgroundColor: 'rgb(37, 99, 235)', borderTopLeftRadius: '10px', fontSize: '20px' });

  const context = await newUserContext(browser, 'e2e-student-1', { colorScheme: 'dark' });
  try {
    const app = await context.newPage();
    await app.goto('/app');
    await expect(app.locator('#user-name')).toContainText('E2E Student');
    await expect(app).toHaveTitle('Road to 1600');
    const brand = app.locator('.nav .nav-brand');
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute('href', '/app');
    await expect(brand).toContainText('Road to 1600');
    await expect(brand.locator('.brand-mark')).toHaveText('r.');
    await expect(brand.locator('.brand-mark')).toBeVisible();
    expect(await brandStyle(app, '.nav .brand-mark')).toEqual(front);
    expect(await brand.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    expect(await app.locator('.nav').evaluate(el => el.textContent)).not.toContain('SAT Question Bank');
    await expect(app.locator('.nav .dot')).toHaveCount(0);
    await shot(app, 'rail-expanded', { clip: { x: 0, y: 0, width: 520, height: 768 } });

    // Collapsed rail (≤980px): the mark stays, the words go.
    await app.setViewportSize({ width: 900, height: 700 });
    await expect(brand.locator('.brand-mark')).toBeVisible();
    await expect(brand.locator('.nav-brand-t')).toBeHidden();
    const box = (await brand.locator('.brand-mark').boundingBox())!;
    expect(box.width).toBeCloseTo(34, 0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(66);
    await shot(app, 'rail-collapsed', { clip: { x: 0, y: 0, width: 300, height: 700 } });

    // Phone: the rail becomes a bottom bar; nothing scrolls sideways.
    await app.setViewportSize({ width: 390, height: 780 });
    expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await shot(app, 'mobile-390x780');
  } finally { await context.close(); }
});

test('every page links /favicon.svg and /favicon.svg is served to anyone', async ({ browser, page, request }) => {
  for (const path of ['/', '/login', '/privacy', '/terms', '/no-such-page']) {
    await page.goto(path);
    await expect(page.locator(ICON), path).toHaveCount(1);
  }
  const res = await request.get('/favicon.svg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\/svg\+xml/);
  expect(await res.text()).toContain('<svg');

  const context = await newUserContext(browser, 'e2e-admin');
  try {
    const app = await context.newPage();
    for (const path of ['/app', '/admin', '/admin/questions']) {
      const response = await app.goto(path);
      expect(response!.status(), path).toBe(200);
      await expect(app.locator(ICON), path).toHaveCount(1);
    }
    // The page's CSP lets the tab load the icon, and the fetch comes back as an image.
    const csp = (await (await app.goto('/app'))!.allHeaders())['content-security-policy'];
    expect(csp).toMatch(/img-src [^;]*'self'/);
    const icon = await app.evaluate(async () => { const r = await fetch('/favicon.svg'); return { status: r.status, type: r.headers.get('content-type') }; });
    expect(icon.status).toBe(200);
    expect(icon.type).toMatch(/^image\/svg\+xml/);
  } finally { await context.close(); }
});
