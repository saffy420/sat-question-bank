import { handleRequest } from './index.js';
export { LessonRoom } from './lesson-room.js';

// e2e-student-6 takes the self-paced lessons: those now write practice stats (§10), and the
// dashboard specs assert student 1's seeded stats exactly.
const accounts = new Set(['e2e-admin', 'e2e-student-1', 'e2e-student-2', 'e2e-student-3', 'e2e-student-4', 'e2e-student-6']);
const sessions = new Map();
const cookie = '__Host-sat_session';
const loopback = host => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const tokenOf = req => req.headers.has('Authorization')
  ? req.headers.get('Authorization').match(/^Bearer\s+([^\s]+)$/i)?.[1] || ''
  : (req.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookie + '='))?.slice(cookie.length + 1) || '';

// ponytail: isolate-local memory caps at 64 sessions/one hour; use local durable storage only if reload-mid-test matters.
function issue(account) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  for (const [key, entry] of sessions) if (entry.exp <= Date.now()) sessions.delete(key);
  while (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
  const token = `e2e.${btoa(JSON.stringify({ exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${crypto.randomUUID()}`;
  const user = { id: account, email: `${account}@e2e.test`, email_confirmed_at: new Date().toISOString(), user_metadata: { full_name: account === 'e2e-admin' ? 'E2E Admin' : `E2E Student ${account.slice(-1)}` } };
  sessions.set(token, { user, exp: exp * 1000 });
  return { token, user };
}

function identity(req, env) {
  if (env.E2E_TEST_MODE !== '1' || !loopback(new URL(req.url).hostname)) return null;
  const token = tokenOf(req);
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.exp <= Date.now()) { sessions.delete(token); return null; }
  return entry.user;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!loopback(url.hostname)) return reply({ error: 'not found' }, 404);
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
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !accounts.has(body.account)) return reply({ error: 'not found' }, 404);
      // Local seed must contain account and approved membership before issuing access.
      if (!env.DB) return reply({ error: 'service unavailable' }, 503);
      let member;
      try { member = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(body.account).first(); }
      catch { return reply({ error: 'service unavailable' }, 503); }
      if (member?.status !== 'approved') return reply({ error: 'not found' }, 404);
      const { token, user } = issue(body.account);
      const response = reply({ token, user_id: user.id, user });
      // Cookie precedes first /app navigation; SPA still bootstraps its own Bearer session.
      response.headers.set('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
      return response;
    }
    try { return await handleRequest(req, env, identity); }
    catch { return reply({ error: 'service unavailable' }, 503); }
  }
};
