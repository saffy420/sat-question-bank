// Which lesson rooms hold results D1 has not taken yet (docs/perf/FREE-PLAN-BRIEF.md §5 free-03).
// One object (`getByName('all')`); rooms report on a failed flush and clear on success. It uses
// only its own storage, so the admin banner still works while D1 is refusing writes.
export class LessonSync {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(req) {
    if (req.headers.get('X-Lesson-Internal') !== 'sync') return new Response('not found', { status: 404 });
    if (req.method === 'GET') {
      const held = await this.ctx.storage.list({ prefix: 'session:' });
      return Response.json({ pending: [...held.values()].sort((a, b) => a.sessionId - b.sessionId) });
    }
    if (req.method !== 'POST') return new Response('not found', { status: 404 });
    let m; try { m = await req.json(); } catch { return new Response('invalid', { status: 400 }); }
    if (!Number.isInteger(m?.sessionId) || m.sessionId < 1) return new Response('invalid', { status: 400 });
    const key = 'session:' + m.sessionId;
    if (m.clear) await this.ctx.storage.delete(key);
    else if (Number.isFinite(m.at) && Number.isFinite(m.since) && ['quota', 'overload', 'other'].includes(m.kind))
      await this.ctx.storage.put(key, { sessionId: m.sessionId, at: m.at, kind: m.kind, since: m.since });
    else return new Response('invalid', { status: 400 });
    return Response.json({ ok: true });
  }
}
