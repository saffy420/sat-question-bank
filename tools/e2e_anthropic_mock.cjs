// Local-only stand-in for api.anthropic.com/v1/messages, used by the report-and-suggest e2e specs.
// The Worker only reaches it because src/reports.js refuses any other address while E2E_TEST_MODE=1.
// Specs script replies with POST /__script and read what the Worker sent with GET /__calls.
const { createServer } = require('node:http');
const PORT = 8790, KEY = 'e2e-not-a-real-key';
let queue = [], calls = [];
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = req => new Promise(resolve => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || 'null')); } catch { resolve(null); } }); });
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/__health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/__calls') return send(res, 200, calls);
  if (req.method === 'POST' && path === '/__reset') { queue = []; calls = []; return send(res, 200, { ok: true }); }
  // { replies: [{ json?: object, text?: string, status?: number, stop_reason?: string, delayMs?: number }] }, used in order.
  if (req.method === 'POST' && path === '/__script') { queue = (await read(req))?.replies || []; return send(res, 200, { queued: queue.length }); }
  if (req.method === 'POST' && path === '/v1/messages') {
    const body = await read(req);
    calls.push({ key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body });
    if (req.headers['x-api-key'] !== KEY) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const next = queue.shift() || { json: { action: 'escalate', reason: 'mock: nothing scripted' } };
    if (next.delayMs) await new Promise(r => setTimeout(r, next.delayMs));
    if (next.status && next.status !== 200) return send(res, next.status, { type: 'error', error: { type: 'api_error', message: 'mock failure' } });
    return send(res, 200, { id: 'msg_mock', type: 'message', role: 'assistant', model: body?.model, stop_reason: next.stop_reason || 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: next.text ?? JSON.stringify(next.json) }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log('anthropic mock on ' + PORT));
