// Home screen logic (lesson-ui/home/home.ts): the SAT countdown across daylight-saving changes, the greeting and the
// primary button.
//
//   node --test tests/test_home.ts        (Node 22.18+ strips the types)
import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedTime, countdown, greeting, firstName, nextLabel } from '../lesson-ui/home/home.ts';

const ms = (iso: string) => Date.parse(iso);

test('8:00 AM New York is 12:00 UTC in daylight time and 13:00 UTC in standard time', () => {
  assert.equal(zonedTime('2026-10-03'), ms('2026-10-03T12:00:00Z'));
  assert.equal(zonedTime('2026-11-07'), ms('2026-11-07T13:00:00Z'));   // after the change on Nov 1
  assert.equal(zonedTime('2026-12-05'), ms('2026-12-05T13:00:00Z'));
  assert.equal(zonedTime('2027-03-06'), ms('2027-03-06T13:00:00Z'));
  assert.equal(zonedTime('2027-05-01'), ms('2027-05-01T12:00:00Z'));   // after the change on Mar 14
  // The change days themselves.
  assert.equal(zonedTime('2026-11-01'), ms('2026-11-01T13:00:00Z'));
  assert.equal(zonedTime('2027-03-14'), ms('2027-03-14T12:00:00Z'));
});

test('countdown across the November change: the hour gained is counted', () => {
  // Sat Oct 31, 8:00 AM EDT to Sat Nov 7, 8:00 AM EST is seven days and one hour.
  assert.deepEqual(countdown('2026-11-07', ms('2026-10-31T12:00:00Z')), { days: 7, hrs: 1, min: 0 });
  // Today (Oct 3) at 3:38 PM EDT to the Nov 7 SAT.
  assert.deepEqual(countdown('2026-11-07', ms('2026-10-03T19:38:00Z')), { days: 34, hrs: 17, min: 22 });
  // Seconds round down to the whole minute.
  assert.deepEqual(countdown('2026-11-07', ms('2026-11-07T12:58:30Z')), { days: 0, hrs: 0, min: 1 });
});

test('countdown across the March change: the hour lost is not counted', () => {
  // Mar 1, 8:00 AM EST to May 1, 8:00 AM EDT is 61 days less an hour.
  assert.deepEqual(countdown('2027-05-01', ms('2027-03-01T13:00:00Z')), { days: 60, hrs: 23, min: 0 });
});

test('countdown stops at zero once the test has started', () => {
  assert.deepEqual(countdown('2026-10-03', ms('2026-10-03T12:00:00Z')), { days: 0, hrs: 0, min: 0 });
  assert.deepEqual(countdown('2026-10-03', ms('2026-10-03T19:00:00Z')), { days: 0, hrs: 0, min: 0 });
});

test('greeting and first name', () => {
  assert.equal(greeting(0), 'morning');
  assert.equal(greeting(11), 'morning');
  assert.equal(greeting(12), 'afternoon');
  assert.equal(greeting(17), 'afternoon');
  assert.equal(greeting(18), 'evening');
  assert.equal(firstName('Leon Chakraborty'), 'Leon');
  assert.equal(firstName('  leon  '), 'leon');
  assert.equal(firstName('student@example.com'), 'student');
  assert.equal(firstName('Guest'), '');
  assert.equal(firstName(''), '');
});

test('the primary button names the next step', () => {
  assert.equal(nextLabel(null), 'Log a Bluebook practice test');
  assert.equal(nextLabel({ kind: 'drill', skill: 'Boundaries' }), 'Next up: Drill · Boundaries');
  assert.equal(nextLabel({ kind: 'consolidate', skill: 'Circles' }), 'Next up: Consolidate · Circles');
  assert.equal(nextLabel({ kind: 'maintain', skill: 'Circles' }), 'Next up: Maintain · Circles');
  assert.equal(nextLabel({ kind: 'test', number: 4 }), 'Next up: Practice Test 4');
});
