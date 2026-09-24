import { expect } from '@playwright/test';

export const ORIGIN = 'https://127.0.0.1:8787';
export const CHROMEBOOK = { width: 1366, height: 768 };
const forbidden = /(?:^|\.)roadto1600\.org$|(?:^|\.)supabase\.co$/i;

export function localURL(url) {
  const parsed = new URL(url, ORIGIN);
  if (parsed.protocol !== 'https:' || parsed.hostname !== '127.0.0.1' || ![8787, 8788, 8789].includes(Number(parsed.port))) throw new Error(`Non-harness URL refused: ${url}`);
  return parsed.href;
}

export async function signIn(context, account) {
  const loginPage = await context.newPage();
  await loginPage.goto('/api/e2e/login'); // GET is 404, but establishes loopback origin for real browser POST.
  const response = await loginPage.evaluate(account => fetch('/api/e2e/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account })
  }).then(async r => ({ status: r.status, body: await r.json() })), account);
  expect(response.status).toBe(200);
  const { token, user } = response.body;
  expect(user.id).toBe(account);
  const cookies = await context.cookies(ORIGIN);
  expect(cookies.find(c => c.name === '__Host-sat_session')?.value).toBe(token);
  await loginPage.close();
  await context.addInitScript(session => {
    const auth = {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: new Error('OAuth is not exercised by local E2E') })
    };
    Object.defineProperty(window, 'supabase', { configurable: true, value: { createClient: () => ({ auth }) } });
  }, { access_token: token, user });
  // CDN script must not overwrite browser-only adapter. Other pinned assets remain real.
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4', route => route.abort());
  return { token, user };
}

export async function newUserContext(browser, account, options = {}) {
  const context = await browser.newContext({ baseURL: ORIGIN, viewport: CHROMEBOOK, ignoreHTTPSErrors: true, ...options });
  try {
    context.on('request', req => {
      if (forbidden.test(new URL(req.url()).hostname)) throw new Error(`Production network request: ${req.url()}`);
    });
    await context.route(url => forbidden.test(url.hostname), route => route.abort('blockedbyclient'));
    await signIn(context, account);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}
