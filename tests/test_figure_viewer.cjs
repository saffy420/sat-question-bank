// Figure viewer geometry: the real functions from public/shared/figure.js (pure, no DOM).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/shared/figure.js');

test('zoom steps are 25 % from 100 % to 300 % and clamp at both ends', async () => {
  const { ZOOM, stepZoom } = await load();
  assert.deepEqual(ZOOM, { min: 1, max: 3, step: 0.25 });
  const seen = [1];
  while (seen.at(-1) < 3) seen.push(stepZoom(seen.at(-1), 1));
  assert.deepEqual(seen, [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]);
  assert.equal(stepZoom(3, 1), 3);
  assert.equal(stepZoom(1, -1), 1);
  assert.equal(stepZoom(2, -1), 1.75);
  // Repeated steps never drift off the 25 % grid.
  let z = 1; for (let i = 0; i < 40; i++) z = stepZoom(z, i % 3 ? 1 : -1);
  assert.equal(z * 4, Math.round(z * 4));
});

test('zooming keeps the content point at the frame centre fixed', async () => {
  const { zoomAbout } = await load();
  // Content centred and scaled about its centre: the point under the view centre is -t/z.
  for (const [t, z, next] of [[0, 1, 1.25], [40, 1.25, 1.5], [-90, 2, 3], [60, 3, 2.75], [30, 1.5, 1]]) {
    assert.equal(+(-zoomAbout(t, z, next) / next).toFixed(9), +(-t / z).toFixed(9));
  }
  assert.equal(zoomAbout(0, 1, 2), 0);
});

test('pan is clamped so no gap opens between the figure and the frame', async () => {
  const { clampPan } = await load();
  // 400 px figure in a 400 px view: nothing to pan at 100 %.
  assert.equal(clampPan(50, 1, 400, 400), 0);
  assert.equal(clampPan(-50, 1, 400, 400), 0);
  // 125 %: 500 px of figure in 400 px, 50 px each way.
  assert.equal(clampPan(80, 1.25, 400, 400), 50);
  assert.equal(clampPan(-80, 1.25, 400, 400), -50);
  assert.equal(clampPan(20, 1.25, 400, 400), 20);
  // 200 %: 200 px each way; a figure narrower than its frame (toolbar min width) pans only once it overflows.
  assert.equal(clampPan(999, 2, 400, 400), 200);
  assert.equal(clampPan(30, 1.25, 300, 400), 0);
  assert.equal(clampPan(-999, 2, 300, 400), -100);
});
