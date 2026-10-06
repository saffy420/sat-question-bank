const { test } = require('node:test');
const assert = require('node:assert/strict');

test('stroke eraser hits line segments and dots at the displayed scale', async () => {
  const { strokeAt } = await import('../public/shared/annotations.js');
  const card = { offsetWidth: 1000, clientWidth: 1000, clientHeight: 500,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 2000, height: 1000 }) };
  const line = { type: 'stroke', id: 'chunk1', strokeId: 'gesture1', points: [[0.1, 0.2], [0.5, 0.2]] };
  const dot = { type: 'stroke', id: 'dot', points: [[0.3, 0.2]] };
  assert.equal(strokeAt(card, [line], 700, 250), line, 'middle of a long segment');
  assert.equal(strokeAt(card, [line], 700, 261), line, 'within 12 client pixels at 2x scale');
  assert.equal(strokeAt(card, [line], 700, 263), null, 'outside the eraser radius');
  assert.equal(strokeAt(card, [line, dot], 700, 250), dot, 'topmost stroke first');
  assert.equal(strokeAt(card, [dot], 700, 250), dot, 'single-point stroke');
  assert.equal(strokeAt(card, [{ type: 'text', id: 'text' }], 700, 250), null);
});

test('streamed stroke groups validate while legacy strokes remain supported', async () => {
  const { validMark, validAction, MAX_FRAME } = await import('../public/shared/lesson.js');
  const stroke = { type: 'stroke', id: 'chunk1', strokeId: 'gesture1', color: '#ff7676', points: [[0.1, 0.2]] };
  assert.equal(validMark(stroke), true);
  assert.equal(validMark({ ...stroke, strokeId: undefined }), true);
  for (const strokeId of ['', 123, null, 'x'.repeat(65)]) assert.equal(validMark({ ...stroke, strokeId }), false);
  const frame = { type: 'annotate', questionId: 'q'.repeat(64), op: { ...stroke, id: 'i'.repeat(64), strokeId: 's'.repeat(64), a: 'p:9999~99999', points: Array.from({ length: 32 }, () => [-399.9999, -399.9999]) } };
  assert.equal(validAction(frame, 'admin'), true);
  assert.ok(new TextEncoder().encode(JSON.stringify(frame)).length < MAX_FRAME);
});
