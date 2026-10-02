// Saved questions: the player's Mark for Review flag, kept per account (/api/saved) so the Question Bank can filter on it.
// A module store: the page loads it once per account, the Saved filter reads it, and the player writes it through setSaved.
export type AuthHeaders = Record<string, string> | null | undefined;

const ids = new Set<string>();
const subs = new Set<() => void>();
// Writes to one question go out in order, so quickly toggling it on then off cannot land as "on".
const chains = new Map<string, Promise<boolean>>();
const notify = () => subs.forEach(fn => fn());
const apply = (id: string, on: boolean) => { if (on === ids.has(id)) return; if (on) ids.add(id); else ids.delete(id); notify(); };

export const savedIds: ReadonlySet<string> = ids;

export function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }

// Replaces the set with the account's. Guests (no headers) start empty and stay in memory, as guest answers do.
// A failed read leaves it empty rather than showing another account's questions; the next write still upserts safely.
export async function loadSaved(headers: AuthHeaders) {
  chains.clear();
  ids.clear();
  if (headers) {
    try {
      const r = await fetch('/api/saved', { headers });
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) rows.forEach(id => { if (typeof id === 'string') ids.add(id); }); }
    } catch { /* stays empty */ }
  }
  notify();
}

// Applies the change at once and persists it; resolves false (and puts the old state back) if the account refused it.
export async function setSaved(id: string, on: boolean, headers: AuthHeaders): Promise<boolean> {
  const before = ids.has(id);
  apply(id, on);
  if (!headers) return true;
  const run = (chains.get(id) ?? Promise.resolve(true)).then(async () => {
    try {
      const r = await fetch('/api/saved', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ question_id: id, saved: on }), keepalive: true });
      return r.ok;
    } catch { return false; }
  });
  chains.set(id, run);
  const ok = await run;
  const latest = chains.get(id) === run;
  if (latest) chains.delete(id);
  if (!ok && latest) apply(id, before);
  return ok;
}
