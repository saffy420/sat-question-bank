import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext, ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

// free-03 (docs/perf/FREE-PLAN-BRIEF.md §5): the admin dashboard banner for lesson results a room
// is holding because D1 refused them. The pending state itself is exercised end to end in
// tests/test_budget_flows.cjs (real fault, real registry); here the registry's answer is routed so
// the page is checked in both states. Students see nothing new.
const artifact = '.omp/pipeline/free-03-guardrails/e2e';
const SYNC = '**/api/admin/lesson-sync';

test('admin banner: absent when nothing is pending, shown with the retry time when a room holds results', async ({ browser }) => {
  mkdirSync(artifact, { recursive: true });
  const context = await newUserContext(browser, 'e2e-admin');
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Real endpoint, empty registry.
    const first = page.waitForResponse(r => r.url().endsWith('/api/admin/lesson-sync'));
    await page.goto('/admin');
    const real = await first;
    expect(real.status()).toBe(200);
    expect(await real.json()).toEqual({ pending: [] });
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('.sync-banner')).toHaveCount(0);

    // A room is holding results until just after the 00:00 UTC reset.
    const at = Date.UTC(2026, 8, 29, 0, 1), when = await page.evaluate(at => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }), at);
    await page.route(SYNC, route => route.fulfill({ json: { pending: [{ sessionId: 3, at: at - 3600000, kind: 'overload', since: at - 7200000 }, { sessionId: 9, at, kind: 'quota', since: at - 7200000 }] } }));
    await page.reload();
    const banner = page.locator('.sync-banner');
    await expect(banner).toHaveText(`Lesson results saved locally, will sync after ${when}.`);
    await expect(banner).toHaveAttribute('role', 'status');
    await page.screenshot({ path: `${artifact}/banner-1366.png` });
    // It stays across sections and clears on the next check once the registry is empty.
    await page.locator('[data-section="Lessons"]').click();
    await expect(banner).toBeVisible();
    await page.unroute(SYNC);
    await page.locator('[data-section="Students"]').click();
    await expect(banner).toHaveCount(0);
    // A failed check shows nothing rather than a stale or broken banner.
    await page.route(SYNC, route => route.fulfill({ status: 503, json: { error: 'sync status unavailable' } }));
    await page.reload();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('.sync-banner')).toHaveCount(0);
    // Narrow screen: the banner wraps inside the page.
    await page.route(SYNC, route => route.fulfill({ json: { pending: [{ sessionId: 9, at, kind: 'quota', since: at - 7200000 }] } }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await expect(page.locator('.sync-banner')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('.sync-banner').getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${artifact}/banner-390.png` });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('students: no banner request from the app, and the endpoint refuses them', async ({ browser }) => {
  const context = await newUserContext(browser, 'e2e-student-1');
  try {
    const page = await context.newPage(), asked = [];
    page.on('request', r => { if (r.url().includes('lesson-sync')) asked.push(r.url()); });
    await page.goto('/app');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sync-banner')).toHaveCount(0);
    expect(asked).toEqual([]);
    const res = await context.request.get(ORIGIN + '/api/admin/lesson-sync');
    expect(res.status()).toBe(403);
  } finally { await context.close(); }
});
