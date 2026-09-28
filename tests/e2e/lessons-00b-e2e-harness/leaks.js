// Scope future lesson assertions to lesson-channel URLs; practice bank deliberately carries answers (G1-A).
const lessonChannel = url => new URL(url).pathname.startsWith('/api/lessons/');
const forbiddenKeys = /^(?:correct(?:_answer|Answer)?|answerKey|explanation(?:_html|Html)?|rationale(?:_html|Html)?|instructorNotes|notes|trap(?:s|_tags|Tags)?)$/i;

const revealedPhase = phase => phase === 'REVEALED' || phase === 'ENDED';
// lessons-11d: before the reveal no instructor annotation, elimination or laser payload may reach a
// student. A frame carries no phase of its own, so `phase` is the phase of the socket's latest snapshot
// (a snapshot is judged by its own phase; unknown counts as not revealed).
export function layerLeaks(parsed, phase) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (parsed.type === 'snapshot') phase = parsed.phase;
  if (revealedPhase(phase)) return [];
  const violations = [];
  if (['annotate', 'laser', 'eliminations'].includes(parsed.type)) violations.push(`${parsed.type} frame before reveal`);
  for (const key of ['annotations', 'eliminations']) if (Array.isArray(parsed[key]) && parsed[key].length) violations.push(`$.${key} before reveal`);
  return violations;
}

export function inspectPayload(body, { marker = /E2E_EXPL_MARKER_|E2E_NOTES_MARKER_/, phaseAware = false, peers = [], phase } = {}) {
  const violations = [];
  const text = typeof body === 'string' ? body : String(body);
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* non-JSON frames still checked for private markers */ }
  const revealed = phaseAware && ['REVEALED', 'ENDED'].includes(parsed?.phase);
  if (phaseAware && !revealed && parsed?.question && typeof parsed.question === 'object' && Object.hasOwn(parsed.question, 'answer')) violations.push('$.question.answer');
  // Self-paced snapshots carry the student's whole set as questions[]; none may carry an answer before reveal.
  if (phaseAware && !revealed && Array.isArray(parsed?.questions) && parsed.questions.some(q => q && typeof q === 'object' && Object.hasOwn(q, 'answer'))) violations.push('$.questions[].answer');
  if (phaseAware ? /E2E_NOTES_MARKER_/.test(text) || (!revealed && /E2E_EXPL_MARKER_/.test(text)) : marker.test(text)) violations.push('private marker');
  if (phaseAware) for (const peer of peers) if (text.includes(peer)) violations.push(`named peer ${peer}`);
  if (phaseAware) violations.push(...layerLeaks(parsed, phase));
  if (!parsed || typeof parsed !== 'object') return violations;
  const visit = (value, path) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.test(key) && (!phaseAware || !revealed || !/^(?:correct(?:_answer|Answer)?|answerKey|explanation(?:_html|Html)?|rationale(?:_html|Html)?)$/i.test(key))) violations.push(`${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(parsed, '$');
  return violations;
}

export function captureLeaks(context, { scope = lessonChannel, marker, phaseAware = false, peers = [] } = {}) {
  const bodies = [];
  const frames = [];
  const errors = [];
  const pending = new Set();
  const seen = new WeakSet();
  const record = (transport, url, body, list, phase) => list.push({ transport, url, body, violations: inspectPayload(body, { marker, phaseAware, peers, phase }) });
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
      let phase;
      ws.on('framereceived', event => {
        try {
          const body = typeof event.payload === 'string' ? event.payload : Buffer.from(event.payload).toString('utf8');
          record('ws', ws.url(), body, frames, phase);
          try { const m = JSON.parse(body); if (m?.type === 'snapshot') phase = m.phase; } catch { /* not JSON */ }
        }
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
