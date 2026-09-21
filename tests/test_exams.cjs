// Self-check for the exam logic in public/index.html and for public/exams.json.
//   node tests/test_exams.cjs
const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
const block = page.slice(page.indexOf('// --- exam'), page.indexOf('// --- end exam'));
if (!block) throw new Error('exam block not found');
const { MODS, routeOf, CURVE, scaled, scoreRange } = new Function(block + '\nreturn { MODS, routeOf, CURVE, scaled, scoreRange };')();

// The cut decides the route at the boundary, in both sections.
assert.equal(routeOf(0, 16), 'm2hard'); assert.equal(routeOf(0, 15), 'm2easy');
assert.equal(routeOf(2, 13), 'm2hard'); assert.equal(routeOf(2, 12), 'm2easy');

// Every curve is monotone, stays inside 200-800, and tops out at 800 on the hard route.
for (const sec of Object.keys(CURVE)) for (const route of Object.keys(CURVE[sec])) {
  const max = MODS.filter(m => m.sec === sec).reduce((n, m) => n + m.n, 0);
  let last = 0;
  for (let raw = 0; raw <= max; raw++) {
    const s = scaled(sec, route, raw);
    assert.ok(s >= last, `${sec} ${route} dips at raw ${raw}`);
    assert.ok(s >= 200 && s <= 800 && s % 10 === 0, `${sec} ${route} raw ${raw} -> ${s}`);
    last = s;
  }
  assert.equal(scaled(sec, route, max + 5), last, 'over the max is clamped');
  if (route === 'm2hard') assert.equal(last, 800);
}
assert.deepEqual(scoreRange(790), [760, 800]);
assert.deepEqual(scoreRange(210), [200, 240]);

// exams.json: five tests, full modules, no id twice, official tests hold no AI row.
const ex = JSON.parse(fs.readFileSync(__dirname + '/../public/exams.json', 'utf8'));
assert.equal(ex.tests.length, 5);
const seen = new Set();
for (const t of ex.tests) for (const [key, n] of [['rw', 27], ['math', 22]]) for (const m of ['m1', 'm2easy', 'm2hard']) {
  assert.equal(t[key][m].length, n, `${t.id} ${key}.${m}`);
  for (const id of t[key][m]) {
    assert.ok(!seen.has(id), `${id} in two sets`); seen.add(id);
    if (!t.hard) assert.ok(!id.startsWith('ai_'), `${t.id} holds ${id}`);
  }
}
console.log('test_exams: all assertions passed');
