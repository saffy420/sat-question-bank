import { request as pwRequest, expect } from '@playwright/test';
import { ORIGIN } from '../lessons-00b-e2e-harness/auth.js';

// The Anthropic API is always the local mock (tools/e2e_anthropic_mock.cjs); the Worker refuses any other address in test mode.
const MOCK = 'http://127.0.0.1:8790';
const call = (path, init) => fetch(MOCK + path, init);
export const FIXTURE = 'e2e-report-fmt';
export const mock = {
  reset: () => call('/__reset', { method: 'POST' }),
  script: replies => call('/__script', { method: 'POST', body: JSON.stringify({ replies }) }),
  calls: async () => (await call('/__calls')).json()
};
// Reset the limits and triage state; optionally add the broken-formatting question or fill the monthly call count.
export async function reset(action = 'reset', extra = {}) {
  const api = await pwRequest.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  try {
    const r = await api.post('/api/e2e/reports', { headers: { Origin: ORIGIN }, data: { action, ...extra } });
    expect(r.status(), await r.text()).toBe(200);
  } finally { await api.dispose(); }
  await mock.reset();
}
export const FIX = { action: 'fix', reason: 'Dollar signs are not math delimiters', patch: { stem_html: '<p>Report fixture: what is \\(3 + 4\\)?</p>' } };

// Open the fixture (or any question) in the practice player.
export async function openInPlayer(page, id) {
  await page.goto('/app');
  await page.locator('[data-tab="practice"]').click();
  await page.locator('#btn-start').click();
  await expect(page.locator('#view-test')).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => window.__qa().S?.items[window.__qa().S.i]?.id) === id) return;
    await page.locator('#btn-next').click();
  }
  throw new Error('question not reached: ' + id);
}
export async function reportFromDialog(page, { category = 'formatting', note = '' } = {}) {
  await page.locator('#rpt-dialog').waitFor();
  await page.locator(`#rpt-dialog input[value="${category}"]`).check();
  if (note) await page.locator('#rpt-note').fill(note);
  await page.locator('#rpt-send').click();
}
export async function groups(admin) { return (await (await admin.request.get('/api/admin/reports')).json()).groups; }
// The triage runs after the student's reply, so the admin list is polled, not read once.
export async function group(admin, id, ready = g => g.items.length > 0) {
  let found;
  await expect.poll(async () => { found = (await groups(admin)).find(g => g.questionId === id); return !!found && ready(found); }, { timeout: 15000 }).toBe(true);
  return found;
}
export const post = (context, path, data) => context.request.post(path, { headers: { Origin: ORIGIN }, data });
