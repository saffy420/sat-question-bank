// Topic selection on the question bank home. F.skills is null for every topic (nothing
// highlighted) or the explicit pick; an empty pick goes back to null, never [].
export type Skills = string[] | null;

export function normalizeSkills(skills: unknown): Skills {
  return Array.isArray(skills) && skills.length ? skills.filter(s => typeof s === 'string') : null;
}

// A skill, a domain's skills or a section's skills: all of them on turns them off, otherwise they all go on.
export function toggleSkills(current: Skills, group: string[]): Skills {
  const next = new Set(current || []);
  const allOn = group.length > 0 && group.every(s => next.has(s));
  group.forEach(s => allOn ? next.delete(s) : next.add(s));
  return next.size ? [...next] : null;
}

// Difficulty and question set chips: nothing picked and everything picked are both null (no filter).
export function toggleOption(current: string[] | null, value: string, all: string[]): string[] | null {
  const next = new Set(current || []);
  if (next.has(value)) next.delete(value); else next.add(value);
  const list = all.filter(v => next.has(v));
  return list.length && list.length < all.length ? list : null;
}

export const allPicked = (current: Skills, group: string[]) => !!current && group.length > 0 && group.every(s => current.includes(s));

// The old Section dropdown (F.sec) becomes the skills it allowed. `sectionSkills` is every
// skill in the bank by section. Both sections, or none, is every topic.
export function migrateSection(f: { sec?: unknown; skills?: unknown }, sectionSkills: Record<string, string[]>): Skills {
  const skills = normalizeSkills(f.skills);
  const secs = Array.isArray(f.sec) ? f.sec : typeof f.sec === 'string' && f.sec !== 'all' ? [f.sec] : [];
  const known = secs.filter(s => Object.hasOwn(sectionSkills, s));
  if (!known.length || Object.keys(sectionSkills).every(s => known.includes(s))) return skills;
  const inSec = new Set(known.flatMap(s => sectionSkills[s]));
  if (!skills) return normalizeSkills([...inSec]);
  return normalizeSkills(skills.filter(s => inSec.has(s)));
}

export type PickState = 'on' | 'part' | 'off';
// A section, domain or skill row's checkbox: every skill of the group picked, some of them, or none.
export function pickState(current: Skills, group: string[]): PickState {
  if (!current || !group.length) return 'off';
  const n = group.filter(s => current.includes(s)).length;
  return n === 0 ? 'off' : n === group.length ? 'on' : 'part';
}

// Accuracy on the home page waits for this many attempted questions, so one miss is not a red 0%.
export const MIN_ATTEMPTS = 5;
export type Level = 'good' | 'ok' | 'low';
// Percent correct, or null while fewer than MIN_ATTEMPTS questions have been attempted.
export const accuracy = (t: { a: number; c: number }): number | null => t.a >= MIN_ATTEMPTS ? Math.round(t.c / t.a * 100) : null;
// The dashboard's thresholds.
export const levelOf = (pct: number): Level => pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'low';
