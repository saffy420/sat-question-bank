// free-03 (docs/perf/FREE-PLAN-BRIEF.md §5): D1 failure classes, retry schedule, write-back chunking.
//   node --test tests/test_flush.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const flush = () => import('../src/flush.js');

test('D1 failures: daily limit and overload are told apart from everything else', async () => {
  const { d1Failure } = await flush();
  // Verbatim from https://developers.cloudflare.com/d1/observability/debug-d1/
  for (const m of ["Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC)",
    "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC)"])
    assert.equal(d1Failure(new Error(m)), 'quota', m);
  for (const m of ['D1 DB is overloaded. Requests queued for too long.', 'D1 DB is overloaded. Too many requests queued.', 'Network connection lost.',
    'Replica disconnected from primary.', 'Cannot resolve D1 DB due to transient issue on remote node.',
    'D1 DB storage operation exceeded timeout which caused object to be reset.', 'Internal error while starting up D1 DB storage caused object to be reset.',
    'Internal error in D1 DB storage caused object to be reset.', 'D1 DB reset because its code was updated.',
    "D1 DB's isolate exceeded its memory limit and was reset.", 'D1 DB exceeded its CPU time limit and was reset.'])
    assert.equal(d1Failure(new Error('D1_ERROR: ' + m)), 'overload', m);
  // Storage caps do not clear at midnight; constraint and code errors are not transient.
  for (const m of ["Your account has exceeded D1's maximum account storage limit, please contact Cloudflare to raise your limit", 'Exceeded maximum DB size.',
    'D1_ERROR: UNIQUE constraint failed: x.y', 'D1_TYPE_ERROR: Type undefined is not supported', 'pending D1 flush'])
    assert.equal(d1Failure(new Error(m)), 'other', m);
  assert.equal(d1Failure('Network connection lost.'), 'overload');
  assert.equal(d1Failure(undefined), 'other');
});

test('retry schedule: 5 s for other errors, doubling backoff for overload, quota bounded by the UTC reset', async () => {
  const { retryAt, nextReset } = await flush();
  const noon = Date.UTC(2026, 8, 28, 12, 0, 0), s = 1000, min = 60 * s, h = 60 * min;
  assert.equal(nextReset(noon), Date.UTC(2026, 8, 29));
  assert.equal(nextReset(Date.UTC(2026, 8, 29)), Date.UTC(2026, 8, 30));
  assert.equal(nextReset(Date.UTC(2026, 8, 29) - 1), Date.UTC(2026, 8, 29));
  for (const n of [1, 2, 9, 100]) assert.equal(retryAt('other', n, noon) - noon, 5 * s);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map(n => retryAt('overload', n, noon) - noon), [5 * s, 10 * s, 20 * s, 40 * s, 80 * s, 160 * s, 5 * min, 5 * min]);
  assert.deepEqual([1, 2, 10, 11, 12, 1e6].map(n => retryAt('quota', n, noon) - noon), [5 * s, 10 * s, 2560 * s, h, h, h]);
  // Near midnight the next quota retry is one minute after the reset, never later.
  const late = Date.UTC(2026, 8, 28, 23, 50);
  assert.equal(retryAt('quota', 12, late), Date.UTC(2026, 8, 29, 0, 1));
  assert.equal(retryAt('quota', 1, late), late + 5 * s);
  for (let n = 1; n < 40; n++) for (const now of [noon, late, Date.UTC(2026, 8, 28, 23, 59, 59)]) {
    const at = retryAt('quota', n, now);
    assert.ok(at > now && at <= nextReset(now) + min, `${n} ${now}`);
  }
});

test('chunks: whole groups in order, at most max statements, an oversized group alone', async () => {
  const { chunkGroups, FLUSH_CHUNK } = await flush();
  assert.equal(FLUSH_CHUNK, 500);
  assert.deepEqual(chunkGroups([]), []);
  const g = (id, size) => ({ id, size });
  const sizes = chunks => chunks.map(c => c.map(x => x.id));
  assert.deepEqual(sizes(chunkGroups([g('a', 3), g('b', 3), g('c', 3)], 6)), [['a', 'b'], ['c']]);
  assert.deepEqual(sizes(chunkGroups([g('a', 2), g('big', 9), g('b', 2)], 6)), [['a'], ['big'], ['b']]);
  assert.deepEqual(sizes(chunkGroups([g('a', 6)], 6)), [['a']]);
  // 25 students × 20 questions, self-paced: 60 statements each (+1 finish) → 8 per chunk, 4 chunks.
  const club = Array.from({ length: 25 }, (_, i) => g('s' + i, 61));
  const chunks = chunkGroups(club);
  assert.deepEqual(chunks.map(c => c.length), [8, 8, 8, 1]);
  assert.deepEqual(chunks.flat().map(x => x.id), club.map(x => x.id));
  for (const c of chunks) assert.ok(c.reduce((n, x) => n + x.size, 0) <= 500);
  // 500 students (the room cap) × 20: still bounded batches.
  assert.ok(chunkGroups(Array.from({ length: 500 }, (_, i) => g(i, 61))).every(c => c.reduce((n, x) => n + x.size, 0) <= 500));
});
