// Lesson flush safety (docs/perf/FREE-PLAN-BRIEF.md §5 free-03). D1 failure classes, the retry
// schedule, and write-back chunking. Messages are Cloudflare's documented D1 errors
// (https://developers.cloudflare.com/d1/observability/debug-d1/).
const QUOTA = /daily row (?:read|write) limit/i;
const OVERLOAD = /D1 DB is overloaded|too many requests queued|requests queued for too long|network connection lost|replica disconnected from primary|transient issue on remote node|caused object to be reset|D1 DB reset because|D1 DB's isolate exceeded|D1 DB exceeded its CPU time/i;
export const d1Failure = e => { const m = String(e?.message || e); return QUOTA.test(m) ? 'quota' : OVERLOAD.test(m) ? 'overload' : 'other'; };

const DAY = 86400000, RETRY = 5000;
// D1's daily caps reset at 00:00 UTC.
export const nextReset = now => (Math.floor(now / DAY) + 1) * DAY;
// `failures` counts this one (1 = first failure). A quota retry never waits past a minute after the reset.
export function retryAt(kind, failures, now) {
  const backoff = cap => Math.min(RETRY * 2 ** Math.min(Math.max(failures, 1) - 1, 20), cap);
  if (kind === 'quota') return Math.min(now + backoff(3600000), nextReset(now) + 60000);
  if (kind === 'overload') return now + backoff(300000);
  return now + RETRY;
}

// Whole groups (one student's statements) in order, at most `max` statements per chunk;
// a group larger than `max` gets a chunk of its own. One chunk is one batch().
export const FLUSH_CHUNK = 500;
export function chunkGroups(groups, max = FLUSH_CHUNK) {
  const chunks = [];
  let chunk = [], size = 0;
  for (const g of groups) {
    if (chunk.length && size + g.size > max) { chunks.push(chunk); chunk = []; size = 0; }
    chunk.push(g); size += g.size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
