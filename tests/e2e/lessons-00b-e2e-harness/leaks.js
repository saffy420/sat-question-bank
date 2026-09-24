// Scope future lesson assertions to lesson-channel URLs; practice bank deliberately carries answers (G1-A).
const lessonChannel = url => new URL(url).pathname.startsWith('/api/lessons/');
const forbiddenKeys = /^(?:correct(?:_answer|Answer)?|answerKey|explanation(?:_html|Html)?|rationale(?:_html|Html)?|instructorNotes|notes|trap(?:s|_tags|Tags)?)$/i;

export function inspectPayload(body, { marker = /E2E_EXPL_MARKER_|E2E_NOTES_MARKER_/ } = {}) {
  const violations = [];
  const text = typeof body === 'string' ? body : String(body);
  if (marker.test(text)) violations.push('private marker');
  let parsed;
  try { parsed = JSON.parse(text); } catch { return violations; }
  const visit = (value, path) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.test(key)) violations.push(`${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(parsed, '$');
  return violations;
}

export function captureLeaks(context, { scope = lessonChannel, marker } = {}) {
  const bodies = [];
  const frames = [];
  const errors = [];
  const pending = new Set();
  const seen = new WeakSet();
  const record = (transport, url, body, list) => list.push({ transport, url, body, violations: inspectPayload(body, { marker }) });
  const attach = page => {
    if (seen.has(page)) return;
    seen.add(page);
    page.on('response', response => {
      if (!scope(response.url())) return;
      const task = response.body().then(bytes => record('http', response.url(), bytes.toString('utf8'), bodies))
        .catch(error => errors.push(`HTTP ${response.url()}: ${error.message}`));
      pending.add(task);
      task.finally(() => pending.delete(task));
    });
    page.on('websocket', ws => {
      if (!scope(ws.url())) return;
      ws.on('framereceived', event => {
        try { record('ws', ws.url(), typeof event.payload === 'string' ? event.payload : Buffer.from(event.payload).toString('utf8'), frames); }
        catch (error) { errors.push(`WS ${ws.url()}: ${error.message}`); }
      });
    });
  };
  context.on('page', attach);
  for (const page of context.pages()) attach(page);
  return {
    bodies, frames, errors,
    async flush() { await Promise.all([...pending]); if (errors.length) throw new Error(errors.join('\n')); },
    violations() { return [...bodies, ...frames].flatMap(item => item.violations.map(violation => ({ url: item.url, transport: item.transport, violation }))); }
  };
}
