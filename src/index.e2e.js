import { handleRequest, withTrace } from './index.js';
export { adminStats } from './index.js';
import { traceEnv } from './budget.js';
import { faultOn } from './fault.js';
export { LessonRoom } from './lesson-room.js';
export { LessonSync } from './lesson-sync.js';
import { budgetProbe } from './budget-probe.js';
export { BudgetProbe } from './budget-probe.js';

// e2e-student-6 takes the self-paced lessons: those now write practice stats (§10), and the
// dashboard specs assert student 1's seeded stats exactly.
const accounts = new Set(['e2e-admin', 'e2e-student-1', 'e2e-student-2', 'e2e-student-3', 'e2e-student-4', 'e2e-student-6']);
// Free-plan budget runs (docs/perf/FREE-PLAN-BRIEF.md §4) sign in a 30-student club; only
// tools/budget_seed.cjs gives these accounts the approved membership login requires.
const budgetAccount = account => /^e2e-budget-(?:0[1-9]|[1-3]\d|40)$/.test(account);
const sessions = new Map();
const cookie = '__Host-sat_session';
const loopback = host => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
// Staging (wrangler.toml [env.staging]) serves this entry on workers.dev. Off loopback a
// request needs the STAGING_TEST_TOKEN secret in X-Staging-Test-Token; without the secret
// configured nothing off loopback is served, exactly as before.
const same = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < b.length; i++) d |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i); return d === 0; };
export const stagingAllowed = (req, env) => typeof env.STAGING_TEST_TOKEN === 'string' && env.STAGING_TEST_TOKEN.length >= 32 &&
  typeof req.headers.get('X-Staging-Test-Token') === 'string' && same(req.headers.get('X-Staging-Test-Token'), env.STAGING_TEST_TOKEN);
const allowed = (req, env) => loopback(new URL(req.url).hostname) || stagingAllowed(req, env);
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const tokenOf = req => req.headers.has('Authorization')
  ? req.headers.get('Authorization').match(/^Bearer\s+([^\s]+)$/i)?.[1] || ''
  : (req.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookie + '='))?.slice(cookie.length + 1) || '';

// ponytail: isolate-local memory caps at 64 sessions/one hour; use local durable storage only if reload-mid-test matters.
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const testUser = account => ({ id: account, email: `${account}@e2e.test`, email_confirmed_at: new Date().toISOString(), user_metadata: { full_name: account === 'e2e-admin' ? 'E2E Admin' : `E2E Student ${account.slice(-1)}` } });
// Staging spreads requests over many isolates, so the in-memory map below would forget a
// session between requests. With the staging secret configured, a session is instead a
// stateless token signed with that secret (HMAC-SHA-256). Local runs keep the map.
const hmac = async (env, text) => b64(await crypto.subtle.sign('HMAC',
  await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STAGING_TEST_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(text)));
async function issueSigned(env, account) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const body = `e2e.${b64(new TextEncoder().encode(JSON.stringify({ exp, account })))}`;
  return { token: `${body}.${await hmac(env, body)}`, user: testUser(account) };
}
async function signedIdentity(env, token) {
  const [head, payload, mac] = token.split('.');
  if (head !== 'e2e' || !payload || !mac || !same(mac, await hmac(env, `${head}.${payload}`))) return null;
  let claims; try { claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  if (!Number.isInteger(claims.exp) || claims.exp * 1000 <= Date.now() || !(accounts.has(claims.account) || budgetAccount(claims.account))) return null;
  return testUser(claims.account);
}

function issue(account) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  for (const [key, entry] of sessions) if (entry.exp <= Date.now()) sessions.delete(key);
  while (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
  const token = `e2e.${btoa(JSON.stringify({ exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${crypto.randomUUID()}`;
  const user = testUser(account);
  sessions.set(token, { user, exp: exp * 1000 });
  return { token, user };
}

function identity(req, env) {
  if (env.E2E_TEST_MODE !== '1' || !allowed(req, env)) return null;
  const token = tokenOf(req);
  if (stagingAllowed(req, env)) return signedIdentity(env, token);
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.exp <= Date.now()) { sessions.delete(token); return null; }
  return entry.user;
}

// report-and-suggest triage: only a loopback mock (tools/e2e_anthropic_mock.cjs) is ever called from this entry. Anything
// else, or nothing configured, points at a dead loopback port, so the triage ends as an escalation instead of a real call.
export const claudeTarget = env => {
  try { if (['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.ANTHROPIC_API_URL).hostname)) return env.ANTHROPIC_API_URL; } catch { /* dead address below */ }
  return 'http://127.0.0.1:9/v1/messages';
};
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!allowed(req, env)) return reply({ error: 'not found' }, 404);
    if (url.pathname === '/api/e2e/budget-probe') return budgetProbe(req, env);
    // free-03 quota-failure test (src/fault.js): loopback only, never staging, and only when the
    // local run sets D1_FAULT_INJECTION=1 as well as E2E_TEST_MODE=1.
    if (url.pathname === '/api/e2e/d1-fault') {
      if (env.E2E_TEST_MODE !== '1' || !faultOn(env) || !loopback(url.hostname) || req.method !== 'POST') return reply({ error: 'not found' }, 404);
      if (req.headers.get('Origin') !== url.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({ error: 'forbidden origin' }, 403);
      if (Number(req.headers.get('Content-Length') || 0) > 1024) return reply({ error: 'invalid body' }, 400);
      let body; try { body = await req.json(); } catch { return reply({ error: 'invalid body' }, 400); }
      if (!Number.isInteger(body?.sessionId) || body.sessionId < 1) return reply({ error: 'invalid body' }, 400);
      return env.LESSON_ROOM.getByName(String(body.sessionId)).fetch(new Request('https://lesson.internal/', { method: 'POST',
        headers: { 'X-Lesson-Internal': 'fault', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: body.kind ?? null, after: body.after ?? 0 }) }));
    }
    // report-and-suggest: reset the daily limits and triage state between specs, and add or remove the one broken-formatting
    // question they report (a permanent row would change the bank count other specs assert). Local runs only.
    if (url.pathname === '/api/e2e/reports') {
      if (env.E2E_TEST_MODE !== '1' || !loopback(url.hostname) || req.method !== 'POST') return reply({ error: 'not found' }, 404);
      if (req.headers.get('Origin') !== url.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({ error: 'forbidden origin' }, 403);
      let body; try { body = await req.json(); } catch { return reply({ error: 'invalid body' }, 400); }
      if (!['reset', 'fixture', 'cleanup'].includes(body?.action)) return reply({ error: 'invalid body' }, 400);
      const statements = [env.DB.prepare('DELETE FROM question_reports'), env.DB.prepare('DELETE FROM question_triage'), env.DB.prepare('DELETE FROM feature_suggestions')];
      if (Number.isInteger(body.calls) && body.calls > 0 && body.calls <= 1000) statements.push(env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
        INSERT INTO question_triage (question_id, kind, reason, called, status) SELECT 'cap-fill-' || i, 'escalation', 'fill', 1, 'dismissed' FROM n`).bind(body.calls));
      if (body.action === 'fixture') statements.push(env.DB.prepare(`INSERT OR REPLACE INTO questions (id,external_id,section,domain,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source)
        VALUES ('e2e-report-fmt','e2e-report-fmt','Math','Algebra','Easy','Report fixture skill','<p>Report fixture: what is $3 + 4$?</p>',
        '[{"letter":"A","content":"5"},{"letter":"B","content":"6"},{"letter":"C","content":"7"},{"letter":"D","content":"8"}]','C','<p>E2E_EXPL_MARKER_REPORT: 3 + 4 = 7.</p>','College Board')`));
      if (body.action === 'cleanup') statements.push(env.DB.prepare("DELETE FROM questions WHERE id='e2e-report-fmt'"));
      await env.DB.batch(statements);
      return reply({ ok: true });
    }
    if (url.pathname === '/api/e2e/login') {
      if (env.E2E_TEST_MODE !== '1') return reply({ error: 'not found' }, 404);
      if (req.method !== 'POST') return reply({ error: 'not found' }, 404);
      if (req.headers.get('Origin') !== url.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({ error: 'forbidden origin' }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type') || '') || Number(req.headers.get('Content-Length') || 0) > 1024) return reply({ error: 'invalid body' }, 400);
      let body;
      try {
        const reader = req.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024) { await reader.cancel(); return reply({ error: 'invalid body' }, 400); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch { return reply({ error: 'invalid body' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !(accounts.has(body.account) || budgetAccount(body.account))) return reply({ error: 'not found' }, 404);
      // Local seed must contain account and approved membership before issuing access.
      if (!env.DB) return reply({ error: 'service unavailable' }, 503);
      let member;
      try { member = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(body.account).first(); }
      catch { return reply({ error: 'service unavailable' }, 503); }
      if (member?.status !== 'approved') return reply({ error: 'not found' }, 404);
      const { token, user } = stagingAllowed(req, env) ? await issueSigned(env, body.account) : issue(body.account);
      const response = reply({ token, user_id: user.id, user });
      // Cookie precedes first /app navigation; SPA still bootstraps its own Bearer session.
      response.headers.set('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
      return response;
    }
    const t = traceEnv(env, 'worker', req.method + ' ' + url.pathname);
    let res;
    try { res = await handleRequest(req, t.env, identity, ctx, { apiUrl: claudeTarget(t.env) }); }
    catch { res = reply({ error: 'service unavailable' }, 503); }
    return withTrace(res, t);
  }
};
