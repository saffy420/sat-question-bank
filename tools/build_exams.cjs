// Builds public/exams.json: five fixed practice exams, ids only, from the two
// local D1 files. Seeded, so a rebuild against the same banks gives the same
// tests; no question appears in two tests.
//
//   node tools/build_exams.cjs
//
// Tests 1-3 draw from the official bank only and follow the College Board domain
// blueprint per module. Tests 4-5 are Hard-only: module 1 is official Hard plus
// AI level 4, the harder module 2 is mostly AI level 4/5.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const D1 = path.join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const MAIN = path.join(D1, '588d9571f32b2bc46c16a0b562c8159b7083c5cdb6cb7d758ef030322bcdc2ee.sqlite');
const AI = path.join(D1, '0ac785e50256c7bd28d88a7cb4506d3cc3e2388ea567885d5b5e222f9f46b5a1.sqlite');
const OUT = path.join(__dirname, '..', 'public', 'exams.json');

const SEED = 20260917;
let seed = SEED;
const rand = () => { // mulberry32
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const rows = (file, extra) => {
  const d = new DatabaseSync(file, { readOnly: true });
  const r = d.prepare(`SELECT id, section, domain, difficulty, skill, choices_json${extra || ''} FROM questions`).all()
    .map(q => ({ id: q.id, section: q.section, domain: q.domain, difficulty: q.difficulty, skill: q.skill,
                 spr: !q.choices_json || q.choices_json === '[]', level: q.level || 0 }));
  d.close();
  return r;
};
const official = rows(MAIN);
const ai = rows(AI, ', level');

const RW = 'Reading & Writing', MATH = 'Math';
const DOM = {
  [RW]: { 'Information and Ideas': 7, 'Craft and Structure': 8, 'Expression of Ideas': 5, 'Standard English Conventions': 7 },
  [MATH]: { 'Algebra': 8, 'Advanced Math': 8, 'Problem-Solving and Data Analysis': 3, 'Geometry and Trigonometry': 3 }
};
const DOM_ORDER = Object.keys(DOM[RW]).concat(Object.keys(DOM[MATH]));
// Difficulty weights per module kind: balanced module 1, an easy-leaning and a
// hard-leaning module 2.
const DIFF = { m1: { Easy: 1, Medium: 1, Hard: 1 }, m2easy: { Easy: 3, Medium: 3, Hard: 1 }, m2hard: { Easy: 1, Medium: 3, Hard: 4 } };
const SPR = 5;   // grid-ins per Math module
const DIFF_RANK = { Easy: 0, Medium: 1, Hard: 2 };

const used = new Set();

// Fill a module: `quota` per domain, difficulties balanced against `weights`,
// SPR grid-ins spread across domains for Math. `pools` is an ordered list of
// candidate lists - the first that can supply a slot wins, so a hard test's
// module 1 takes its AI share first and tops up from official Hard.
function pick(section, kind, pools) {
  const quota = { ...DOM[section] };
  const weights = DIFF[kind];
  const taken = { Easy: 0, Medium: 0, Hard: 0 };
  const out = [];
  const take = (wantSpr) => {
    for (const dom of shuffle(Object.keys(quota).filter(d => quota[d] > 0))) {
      // Prefer the difficulty furthest below its weight share.
      const diffs = Object.keys(weights).sort((a, b) => taken[a] / weights[a] - taken[b] / weights[b]);
      for (const diff of diffs) for (const pool of pools) {
        const q = pool.find(x => !used.has(x.id) && x.domain === dom && x.difficulty === diff && x.spr === wantSpr);
        if (!q) continue;
        used.add(q.id); out.push(q); quota[dom]--; taken[diff]++;
        return true;
      }
    }
    return false;
  };
  if (section === MATH) for (let i = 0; i < SPR; i++) if (!take(true)) throw new Error(`${kind}: no grid-in left`);
  while (Object.values(quota).some(n => n > 0)) if (!take(false)) throw new Error(`${kind}: quota unmet ${JSON.stringify(quota)}`);
  // Reading in domain order, Math easy -> hard, as the real test presents them.
  out.sort((a, b) => section === RW
    ? DOM_ORDER.indexOf(a.domain) - DOM_ORDER.indexOf(b.domain)
    : DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty]);
  return out.map(q => q.id);
}

const by = (list, f) => shuffle(list.filter(f));
const tests = [];
for (let t = 1; t <= 5; t++) {
  const hard = t >= 4;
  const test = { id: 't' + t, name: hard ? `Hard Test ${t - 3}` : `Practice Test ${t}`, hard };
  for (const [key, sec] of [['rw', RW], ['math', MATH]]) {
    const off = by(official, q => q.section === sec);
    const offHard = by(official, q => q.section === sec && q.difficulty === 'Hard');
    const ai4 = by(ai, q => q.section === sec && q.level === 4);
    const ai45 = by(ai, q => q.section === sec && q.level >= 4);
    // A hard test wants every difficulty slot filled from Hard rows only; give the
    // picker Hard-only weights so it never looks for an Easy row it cannot find.
    if (hard) {
      const H = { Easy: 0, Medium: 0, Hard: 1 };
      DIFF.m1 = H; DIFF.m2easy = H; DIFF.m2hard = H;
      test[key] = {
        // ~30% AI level 4 in module 1: the AI pool is capped by slicing it.
        m1: pick(sec, 'm1', [ai4.slice(0, sec === RW ? 8 : 7), offHard]),
        m2easy: pick(sec, 'm2easy', [offHard]),
        m2hard: pick(sec, 'm2hard', [ai45.slice(0, sec === RW ? 20 : 15), offHard])
      };
      DIFF.m1 = { Easy: 1, Medium: 1, Hard: 1 }; DIFF.m2easy = { Easy: 3, Medium: 3, Hard: 1 }; DIFF.m2hard = { Easy: 1, Medium: 3, Hard: 4 };
    } else {
      test[key] = { m1: pick(sec, 'm1', [off]), m2easy: pick(sec, 'm2easy', [off]), m2hard: pick(sec, 'm2hard', [off]) };
    }
  }
  tests.push(test);
}

// Self-check before writing anything.
const all = new Map([...official, ...ai].map(q => [q.id, q]));
const seen = new Set();
for (const t of tests) for (const key of ['rw', 'math']) for (const m of ['m1', 'm2easy', 'm2hard']) {
  const ids = t[key][m];
  const want = key === 'rw' ? 27 : 22;
  if (ids.length !== want) throw new Error(`${t.id} ${key}.${m}: ${ids.length} ids, want ${want}`);
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${id} appears twice`);
    seen.add(id);
    const q = all.get(id);
    if (!t.hard && q.level) throw new Error(`${t.id} holds AI row ${id}`);
    if (t.hard && q.difficulty !== 'Hard') throw new Error(`${t.id} holds non-Hard row ${id}`);
  }
  if (key === 'math') {
    const spr = ids.filter(id => all.get(id).spr).length;
    if (spr !== SPR) throw new Error(`${t.id} math.${m}: ${spr} grid-ins`);
  }
}

fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), seed: SEED, tests }));
for (const t of tests) {
  const n = (ids) => { const c = { Easy: 0, Medium: 0, Hard: 0, AI: 0 }; ids.forEach(id => { const q = all.get(id); c[q.difficulty]++; if (q.level) c.AI++; }); return `E${c.Easy}/M${c.Medium}/H${c.Hard}${c.AI ? `/ai${c.AI}` : ''}`; };
  console.log(t.id, t.name.padEnd(16), ['rw', 'math'].map(k => `${k}: ${['m1', 'm2easy', 'm2hard'].map(m => `${m}=${n(t[k][m])}`).join(' ')}`).join(' | '));
}
console.log(`${seen.size} ids across ${tests.length} tests -> ${path.relative(process.cwd(), OUT)}`);
