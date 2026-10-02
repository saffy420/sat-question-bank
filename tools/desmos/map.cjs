// Phase 2: map each scraped Prepzy solution to a question in our bank.
//   node tools/desmos/map.cjs [--bank <file> | --local] [--in tools/desmos/solutions.jsonl]
//
// The College Board question ID is `questions.id` (8 hex characters; the printed "Question ID" the
// extractor joins on). `external_id` is not it: the snapshot copies id into it, while active-ids.json
// holds College Board's internal UUID under that name.
//
// Matching order:
//   1. cbId equal to a core questions.id.
//   2. No cbId, or no such id: normalized stem + choices from questionPreview against stem_html and
//      choices_json in both banks (HTML stripped, &nbsp; converted, whitespace collapsed).
// Confirmed: a cbId hit whose text does not contradict it, or a text match at CONFIRM or above that
// beats the runner-up by MARGIN, on a core question. Anything weaker goes to review.csv; nothing
// close goes to unmatched.csv. Only mapping.json is imported.
//
// Writes: mapping.json (tracked; IDs, solution state and credit, no question text), and review.csv /
// unmatched.csv (ignored; they show College Board question text side by side for hand-checking).
const fs = require('fs');
const path = require('path');
const { DIR, loadBank, tokens, plain, similarity, previewParts, ourChoices, testNameOf, csv } = require('./common.cjs');

const CONFIRM = 0.9;     // text match this close is the same question
const MARGIN = 0.1;      // ...and clearly closer than the next-best candidate
const REVIEW = 0.6;      // below this nothing is worth a human look
const CB_CONTRADICT = 0.3; // a cbId hit whose text is this far off is held for review

function score(sol, q) {
  const stem = similarity(sol.stemTokens, q.stemTokens);
  if (!sol.choiceTokens.length && !q.choiceTokens.length) return stem;
  // One side multiple choice and the other a grid-in: not the same question.
  if (!sol.choiceTokens.length || !q.choiceTokens.length) return stem * 0.5;
  return 0.7 * stem + 0.3 * similarity(sol.choiceTokens, q.choiceTokens);
}

function prepare(bank) {
  return bank.filter(q => q.section === 'Math').map(q => ({ ...q,
    stemTokens: tokens(q.stem_html), choiceTokens: ourChoices(q.choices_json).flatMap(c => tokens(c)) }));
}

// Returns { mapping, review, unmatched } for slim scrape records against the bank rows.
function match(solutions, bank) {
  const math = prepare(bank);
  const core = new Map(math.filter(q => q.bank === 'core').map(q => [q.id, q]));
  const allCore = new Map(bank.filter(q => q.bank === 'core').map(q => [q.id, q]));
  const mapping = [], review = [], unmatched = [];
  for (const raw of solutions) {
    const parts = previewParts(raw.questionPreview);
    const sol = { ...raw, stemText: plain(parts.stem), stemTokens: tokens(parts.stem), choiceTokens: parts.choices.flatMap(c => tokens(c)) };
    const row = (q, s, method) => ({ question_id: q.id, cbId: sol.cbId, testName: sol.testName, questionIndex: sol.questionIndex,
      method, score: Math.round(s * 1000) / 1000, credit_name: sol.makerAttribution?.displayName ?? null,
      source_fingerprint: sol.questionFingerprint == null ? null : String(sol.questionFingerprint), state: sol.desmosState });
    const hold = (q, s, reason, second = null) => review.push({ sol, q, s, second: second ? second.s : 0, reason });

    const cbHit = sol.cbId ? (core.get(sol.cbId) || allCore.get(sol.cbId)) : null;
    if (cbHit) {
      const s = cbHit.stemTokens ? score(sol, cbHit) : null;
      if (cbHit.section !== 'Math') hold(cbHit, s ?? 0, `cbId ${sol.cbId} is a ${cbHit.section} question`);
      // An empty preview cannot contradict the ID; a preview that names a different question can.
      else if (sol.stemTokens.length && s < CB_CONTRADICT) hold(cbHit, s, `cbId matches but the text does not (${s.toFixed(2)})`);
      else mapping.push(row(cbHit, s ?? 1, 'cbId'));
      continue;
    }
    // Only now the full ranking: a cbId hit (the common case) never pays for it.
    const [best, second] = math.map(q => ({ q, s: score(sol, q) })).sort((a, b) => b.s - a.s);
    const why = sol.cbId ? `cbId ${sol.cbId} not in the core bank` : 'no cbId on the page';
    if (!best || best.s < REVIEW || !sol.stemTokens.length) { unmatched.push({ sol, best, reason: sol.stemTokens.length ? why : why + '; no stem in questionPreview' }); continue; }
    if (best.q.bank !== 'core') { hold(best.q, best.s, `${why}; best text match is an AI question`, second); continue; }
    if (best.s >= CONFIRM && (!second || best.s - second.s >= MARGIN)) mapping.push(row(best.q, best.s, 'text'));
    else hold(best.q, best.s, `${why}; text match ${best.s.toFixed(2)}, runner-up ${(second ? second.s : 0).toFixed(2)}`, second);
  }

  // One solution per question. Two Prepzy entries landing on one question keep the cbId match (else
  // the better text score); the loser goes to review rather than silently disappearing.
  const byId = new Map();
  for (const m of mapping) {
    const held = byId.get(m.question_id);
    if (!held) { byId.set(m.question_id, m); continue; }
    if (JSON.stringify(held.state) === JSON.stringify(m.state)) continue;
    const keep = (m.method === 'cbId') !== (held.method === 'cbId') ? (m.method === 'cbId' ? m : held) : (m.score > held.score ? m : held);
    const lose = keep === m ? held : m;
    byId.set(m.question_id, keep);
    const sol = solutions.find(x => x.testName === lose.testName && x.questionIndex === lose.questionIndex);
    review.push({ sol: { ...sol, stemText: plain(previewParts(sol.questionPreview).stem) }, q: core.get(lose.question_id), s: lose.score, second: 0,
      reason: `another solution (${keep.testName} #${keep.questionIndex}) already maps to ${lose.question_id}` });
  }
  return { mapping: [...byId.values()].sort((a, b) => a.question_id.localeCompare(b.question_id)), review, unmatched };
}

function main() {
  const i = process.argv.indexOf('--in');
  const file = i >= 0 ? process.argv[i + 1] : path.join(DIR, 'solutions.jsonl');
  if (!fs.existsSync(file)) { console.error(`no ${file}: run tools/desmos/scrape.cjs first`); process.exit(2); }
  const solutions = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const bank = loadBank(process.argv);
  const { mapping, review, unmatched } = match(solutions, bank);

  fs.writeFileSync(path.join(DIR, 'mapping.json'), JSON.stringify(mapping, null, 1) + '\n');
  fs.writeFileSync(path.join(DIR, 'review.csv'), csv(
    ['testName', 'questionIndex', 'cbId', 'candidate_question_id', 'candidate_bank', 'score', 'runner_up', 'reason', 'prepzy_stem', 'our_stem'],
    review.map(r => [r.sol.testName, r.sol.questionIndex, r.sol.cbId, r.q?.id, r.q?.bank, (r.s ?? 0).toFixed(3), r.second.toFixed(3), r.reason, r.sol.stemText, plain(r.q?.stem_html)])));
  fs.writeFileSync(path.join(DIR, 'unmatched.csv'), csv(
    ['testName', 'questionIndex', 'cbId', 'best_question_id', 'best_score', 'reason', 'prepzy_stem', 'best_stem'],
    unmatched.map(u => [u.sol.testName, u.sol.questionIndex, u.sol.cbId, u.best?.q.id, (u.best?.s ?? 0).toFixed(3), u.reason, plain(previewParts(u.sol.questionPreview).stem), plain(u.best?.q.stem_html)])));

  const tests = [...new Set(solutions.map(s => s.testName))].sort();
  const count = (list, t, f) => list.filter(x => f(x) === t).length;
  console.log('testName | solutions | confirmed (cbId / text) | review | unmatched');
  for (const t of tests) {
    const m = mapping.filter(x => x.testName === t);
    console.log(`${t} | ${count(solutions, t, x => x.testName)} | ${m.length} (${m.filter(x => x.method === 'cbId').length} / ${m.filter(x => x.method === 'text').length}) | ${count(review, t, x => x.sol.testName)} | ${count(unmatched, t, x => x.sol.testName)}`);
  }
  console.log(`total | ${solutions.length} | ${mapping.length} | ${review.length} | ${unmatched.length}`);
  const unknownTests = tests.filter(t => !bank.some(q => q.section === 'Math' && testNameOf(q.skill) === t));
  if (unknownTests.length) console.log(`tests that are not one of our skills: ${unknownTests.join(' | ')}`);
}

if (require.main === module) main();
module.exports = { match, score, CONFIRM, MARGIN, REVIEW };
