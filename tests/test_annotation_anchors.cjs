const { test } = require('node:test');
const assert = require('node:assert/strict');
const protocol = () => import('../public/shared/lesson.js');
const stroke = (a, points) => ({ type: 'stroke', id: 's1', color: '#ff7676', points, ...(a === undefined ? {} : { a }) });

test('em glyph anchors (~) validate: offsets in em, bounded', async () => {
  const { validMark } = await protocol();
  assert.equal(validMark(stroke('s:3~120', [[0, 0], [12.5, -1.25], [-3, 2]])), true);
  assert.equal(validMark(stroke('c:B~4', [[0.001, 0.5]])), true);
  assert.equal(validMark(stroke('p:0~0', [[400, -400]])), true);
  assert.equal(validMark(stroke('p:0~0', [[401, 0]])), false, 'em offsets beyond 400 are not a stroke on this stage');
  assert.equal(validMark(stroke('p:0~0', [[Infinity, 0]])), false);
});
test('legacy px glyph anchors (@) and element/card anchors still validate', async () => {
  const { validMark } = await protocol();
  assert.equal(validMark(stroke('s:3@120', [[350, -20]])), true);
  assert.equal(validMark(stroke('s:3@120', [[4001, 0]])), false);
  assert.equal(validMark(stroke('i:0', [[0.25, 1.4]])), true);
  assert.equal(validMark(stroke('P', [[-3.9, 4.9]])), true);
  assert.equal(validMark(stroke(undefined, [[0.5, 0.5]])), true);
  assert.equal(validMark(stroke(undefined, [[1.5, 0.5]])), false);
});
test('malformed anchors are rejected', async () => {
  const { validMark } = await protocol();
  for (const a of ['s:3~', 's:3~x', 's:3~1~2', 's:3@1@2', '~5', 'x:3~5', 's:3#5', 'p:99999~5', 's:3~123456', 'c:E~1']) assert.equal(validMark(stroke(a, [[0, 0]])), false, a);
});
test('laser frames use the same anchor forms', async () => {
  const { validAction } = await protocol();
  const laser = (a, x, y) => ({ type: 'laser', questionId: 'q', x, y, ...(a ? { a } : {}) });
  assert.equal(validAction(laser('p:1~33', 1.5, -0.4), 'admin'), true);
  assert.equal(validAction(laser('p:1@33', 40, -8), 'admin'), true);
  assert.equal(validAction(laser('p:1~33', 1.5, 500), 'admin'), false);
  assert.equal(validAction(laser('p:1~33', 1.5, -0.4), 'student'), false);
});
