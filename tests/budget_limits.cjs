// Free-plan budget constants (docs/perf/FREE-PLAN-BRIEF.md §5 free-03). The report they come from:
// docs/perf/free-plan-budget.md ("Per-flow table", "free-03: guardrails").
//
// Each value is the post-free-02 local measurement + 20%, rounded down (counts are whole numbers),
// measured by `tools/budget_measure.cjs` on the budget seed (three full runs gave identical numbers).
// The one exception is the self-paced end's largest batch: free-03 chunks the write-back
// (src/flush.js FLUSH_CHUNK), so its pinned base is the chunked 488 statements, not 1,526.
// tests/test_budget_flows.cjs fails when any flow goes over. Never raise a value to make it pass:
// a real, reviewed change of cost updates the report first, then this file, with the reason.
//
// Per flow (all [local], one fresh run of every flow in order, as tests/test_budget_flows.cjs runs them):
//   queriesPerInvocation  worst single invocation: D1 queries + batches (a batch counts as one query)
//   statementsPerBatch    largest single batch()
//   rowsRead / rowsWritten  D1 rows over the whole flow (meta.rows_read / rows_written)
//   workerInvocations / doInvocations  Worker requests and Durable Object events in the flow
module.exports = {
  "student-boot": { queriesPerInvocation: 7, statementsPerBatch: 0, rowsRead: 13183, rowsWritten: 1, workerInvocations: 12, doInvocations: 0 },
  //   free-02: 6 / 0 / 10986 / 1 / 10 / 0
  "student-boot@warm": { queriesPerInvocation: 4, statementsPerBatch: 0, rowsRead: 8623, rowsWritten: 1, workerInvocations: 12, doInvocations: 0 },
  //   free-02: 4 / 0 / 7186 / 1 / 10 / 0
  "bank-filter": { queriesPerInvocation: 9, statementsPerBatch: 0, rowsRead: 4368, rowsWritten: 0, workerInvocations: 4, doInvocations: 0 },
  //   free-02: 8 / 0 / 3640 / 0 / 4 / 0
  "bank-filter@warm": { queriesPerInvocation: 8, statementsPerBatch: 0, rowsRead: 288, rowsWritten: 0, workerInvocations: 4, doInvocations: 0 },
  //   free-02: 7 / 0 / 240 / 0 / 4 / 0
  "practice-answer": { queriesPerInvocation: 7, statementsPerBatch: 1, rowsRead: 494, rowsWritten: 8, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 6 / 1 / 412 / 7 / 2 / 0
  "admin-students": { queriesPerInvocation: 7, statementsPerBatch: 36, rowsRead: 57790, rowsWritten: 0, workerInvocations: 37, doInvocations: 0 },
  //   free-02: 6 / 30 / 48159 / 0 / 31 / 0
  "admin-students@warm": { queriesPerInvocation: 7, statementsPerBatch: 36, rowsRead: 2043, rowsWritten: 0, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 6 / 30 / 1703 / 0 / 2 / 0
  "admin-student-detail": { queriesPerInvocation: 18, statementsPerBatch: 1, rowsRead: 12015, rowsWritten: 0, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 15 / 1 / 10013 / 0 / 2 / 0
  "admin-student-detail@warm": { queriesPerInvocation: 15, statementsPerBatch: 1, rowsRead: 7935, rowsWritten: 0, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 13 / 1 / 6613 / 0 / 2 / 0
  "builder-search-save": { queriesPerInvocation: 9, statementsPerBatch: 26, rowsRead: 4719, rowsWritten: 171, workerInvocations: 4, doInvocations: 0 },
  //   free-02: 8 / 22 / 3933 / 143 / 4 / 0
  "instructor-lesson": { queriesPerInvocation: 30, statementsPerBatch: 30, rowsRead: 424, rowsWritten: 1363, workerInvocations: 62, doInvocations: 2012 },
  //   free-02: 25 / 25 / 354 / 1136 / 52 / 1677
  "self-paced-end": { queriesPerInvocation: 31, statementsPerBatch: 585, rowsRead: 11310, rowsWritten: 5450, workerInvocations: 62, doInvocations: 2042 },
  //   free-02: 26 / 488 / 9425 / 4542 / 52 / 1702   (statementsPerBatch: free-03 chunks, was 1,526)
  "poll-review": { queriesPerInvocation: 1, statementsPerBatch: 25, rowsRead: 3, rowsWritten: 51, workerInvocations: 0, doInvocations: 69 },
  //   free-02: 1 / 21 / 3 / 43 / 0 / 58
  "my-lessons": { queriesPerInvocation: 33, statementsPerBatch: 0, rowsRead: 9608, rowsWritten: 0, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 28 / 0 / 8007 / 0 / 2 / 0
  "my-lessons@warm": { queriesPerInvocation: 33, statementsPerBatch: 0, rowsRead: 9608, rowsWritten: 0, workerInvocations: 2, doInvocations: 0 },
  //   free-02: 28 / 0 / 8007 / 0 / 2 / 0
};
