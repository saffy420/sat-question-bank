// Free-plan budget tests (docs/perf/FREE-PLAN-BRIEF.md §5 free-03). One local run of every flow in
// docs/perf/free-plan-budget.md through the real Worker, Durable Objects and Miniflare D1
// (tools/budget_measure.cjs, budget seed, BUDGET_TRACE=1), then one assertion set per flow
// against tests/budget_limits.cjs. After the flows, the quota-recovery e2e: D1's daily write
// limit (injected with the test-only fault flag, src/fault.js) hits a 25 × 20 self-paced
// write-back, then clears; every attempt must land exactly once.
// Needs wrangler (devDependency) and free local ports 8791/9240. About two minutes.
//   node --test tests/test_budget_flows.cjs
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { measure } = require('../tools/budget_measure.cjs');
const LIMITS = require('./budget_limits.cjs');

let run;
before(async () => {
  run = await measure({ target: 'local', warm: true, faults: true, quota: true, port: 8791, inspector: 9240,
    persist: '.wrangler/state-budget-test', seedDir: '.wrangler/budget-test', log: () => {} });
}, { timeout: 900000 });

const metrics = flow => {
  const inv = flow.invocations, worker = inv.filter(i => i.kind === 'worker').length;
  return {
    queriesPerInvocation: Math.max(0, ...inv.map(i => i.queries + i.batches)),
    statementsPerBatch: Math.max(0, ...inv.flatMap(i => i.batchStatements)),
    rowsRead: inv.reduce((n, i) => n + i.rowsRead, 0),
    rowsWritten: inv.reduce((n, i) => n + i.rowsWritten, 0),
    workerInvocations: worker,
    doInvocations: inv.length - worker
  };
};

test('every measured flow has a budget, and every budget was measured', () => {
  assert.deepEqual(Object.keys(run.flows).sort(), Object.keys(LIMITS).sort());
});

for (const [name, limit] of Object.entries(LIMITS)) {
  test(`budget: ${name}`, () => {
    const flow = run.flows[name];
    assert.ok(flow, `${name} was not measured`);
    assert.equal(flow.error, undefined, `${name} failed: ${flow.error}`);
    assert.ok(flow.invocations.length > 0, `${name} produced no traces`);
    const got = metrics(flow);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(limit).sort());
    const over = Object.keys(limit).filter(k => got[k] > limit[k]).map(k => `${k} ${got[k]} > ${limit[k]}`);
    assert.deepEqual(over, [], `${name} over budget: ${over.join(', ')}`);
    for (const inv of flow.invocations) assert.deepEqual(inv.errors, [], `${name} ${inv.kind} ${inv.label}: D1 errors`);
  });
}

test('e2e: D1 daily write limit during a 25 × 20 self-paced write-back loses nothing and duplicates nothing', () => {
  const q = run.quota;
  assert.ok(q, 'quota-recovery phase did not run');
  assert.deepEqual([q.students, q.questions], [25, 20]);
  assert.deepEqual(q.injected, { fault: { kind: 'quota', after: 1 } });
  // During the outage: the first chunk landed whole, the rest is held by the room, and the admin
  // banner's registry names the session with a quota retry no later than a minute past 00:00 UTC.
  assert.equal(q.held.length, 1);
  assert.equal(q.held[0].kind, 'quota');
  assert.ok(q.held[0].at > q.held[0].since && q.held[0].at <= (Math.floor(q.held[0].since / 86400000) + 1) * 86400000 + 60000);
  assert.ok(q.during.responses > 0 && q.during.responses < 500, `partial landing: ${q.during.responses}`);
  assert.equal(q.during.responses % 20, 0, 'a chunk lands whole students');
  assert.equal(q.during.attempts, q.during.scorable);
  assert.equal(q.during.status, 'live');
  // After the limit clears: every response and every attempt exactly once, each practice record moved once.
  assert.deepEqual(q.cleared, { fault: null });
  assert.equal(q.after.responses, 500);
  assert.equal(q.after.scorable, 500, 'the budget seed questions are all scorable');
  assert.equal(q.after.attempts, q.after.scorable);
  assert.equal(q.after.distinctAttempts, q.after.attempts);
  assert.equal(q.after.progressAttempts - q.before.progressAttempts, q.after.scorable);
  assert.equal(q.after.finished, 25);
  assert.equal(q.after.status, 'review');
  assert.deepEqual(q.afterPending, [], 'the banner clears once D1 has everything');
});
