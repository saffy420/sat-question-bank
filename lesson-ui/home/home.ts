// Home screen logic (lesson-ui/home/Home.tsx): the greeting, the SAT countdown and the primary button's label.
// Pure functions over plain data, type-stripping safe like plan.ts. Unit tests: tests/test_home.ts.

// The SAT starts at 8:00 AM Eastern; the IANA zone keeps daylight saving right on both sides of a change.
export const SAT_ZONE = 'America/New_York';
export const SAT_HOUR = 8;

export const greeting = (hour: number) => hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
// The rail shows the account's full name, or its email when it has none. 'Guest' is no name.
export function firstName(name: string) {
  const t = String(name || '').trim();
  if (!t || t === 'Guest') return '';
  return t.split(/\s+/)[0].split('@')[0];
}

// Minutes `zone` is ahead of UTC at the instant `ms`.
function zoneOffset(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return (Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(ms / 60000) * 60000) / 60000;
}
// The instant (ms since epoch) of `hour`:00 local time in `zone` on the day 'YYYY-MM-DD'.
export function zonedTime(date: string, hour = SAT_HOUR, zone = SAT_ZONE) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  // The offset at the wall time read as UTC is right unless a change falls between the two; one more pass settles it.
  let at = wall - zoneOffset(wall, zone) * 60000;
  at = wall - zoneOffset(at, zone) * 60000;
  return at;
}

export type Countdown = { days: number; hrs: number; min: number };
// Whole days, hours and minutes left until 8:00 AM Eastern on the SAT date; zeros once it has started.
export function countdown(date: string, now: number): Countdown {
  const left = Math.max(0, Math.floor((zonedTime(date) - now) / 60000));
  return { days: Math.floor(left / 1440), hrs: Math.floor(left / 60) % 24, min: left % 60 };
}

export type NextStep = { kind: 'drill' | 'consolidate' | 'maintain' | 'test'; skill?: string; number?: number };
const KIND = { drill: 'Drill', consolidate: 'Consolidate', maintain: 'Maintain' } as const;
// The primary button: the plan's next step, or logging a first test when there is no plan.
export function nextLabel(step: NextStep | null) {
  if (!step) return 'Log a Bluebook practice test';
  if (step.kind === 'test') return `Next up: Practice Test ${step.number}`;
  return `Next up: ${KIND[step.kind]} · ${step.skill}`;
}
