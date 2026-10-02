const { test } = require('node:test');
const assert = require('node:assert/strict');
const protocol = () => import('../public/shared/lesson.js');
const box = (over = {}) => ({ type: 'text', id: 't1', a: 's:0~12', x: 0.5, y: -0.25, text: 'Look here', color: '#ffe066', ...over });

test('text marks: a typed box anchored like a pen point', async () => {
  const { validMark } = await protocol();
  assert.equal(validMark(box()), true);
  assert.equal(validMark(box({ a: undefined, x: 0.2, y: 0.9 })), true, 'no anchor = fractions of the card');
  assert.equal(validMark(box({ a: 'i:0', x: 1.5, y: 0.5 })), true, 'figure anchors take fractions');
  assert.equal(validMark(box({ a: 'c:B~3', x: 0, y: 0 })), true);
  assert.equal(validMark(box({ text: 'a\nb\nc\nd\ne\nf' })), true, 'six lines');
  assert.equal(validMark(box({ text: 'x'.repeat(280) })), true);
});

test('text marks: invalid shapes are refused', async () => {
  const { validMark } = await protocol();
  assert.equal(validMark(box({ text: '' })), false, 'empty');
  assert.equal(validMark(box({ text: ' \n ' })), false, 'blank');
  assert.equal(validMark(box({ text: 'x'.repeat(281) })), false, 'too long');
  assert.equal(validMark(box({ text: 'a\nb\nc\nd\ne\nf\ng' })), false, 'seven lines');
  assert.equal(validMark(box({ text: 42 })), false, 'not a string');
  assert.equal(validMark(box({ color: '#000000' })), false, 'colour outside the three');
  assert.equal(validMark(box({ a: 'zz:1~2' })), false, 'bad anchor');
  assert.equal(validMark(box({ a: undefined, x: 2, y: 0 })), false, 'card fractions stay inside the card');
  assert.equal(validMark(box({ x: 401 })), false, 'em offset out of range');
  assert.equal(validMark(box({ x: NaN })), false);
  assert.equal(validMark(box({ y: undefined })), false, 'missing y');
  assert.equal(validMark(box({ id: '' })), false);
  assert.equal(validMark(box({ points: [[0, 0]] })), false, 'extra field');
  const { id, ...noId } = box(); assert.equal(validMark(noId), false);
});

test('a text annotate frame stays under MAX_FRAME even at the limits', async () => {
  const { validAction, MAX_FRAME } = await protocol();
  const worst = box({ id: 'i'.repeat(64), text: '\u0001'.repeat(280), a: 'p:9999~99999', x: -399.9999, y: -399.9999 });
  const frame = { type: 'annotate', questionId: 'q'.repeat(64), op: worst };
  assert.equal(validAction(frame, 'admin'), true);
  assert.ok(new TextEncoder().encode(JSON.stringify(frame)).length < MAX_FRAME);
  assert.equal(validAction(frame, 'student'), false, 'students cannot annotate');
});
