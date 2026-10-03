// Recommended time per question (public/shared/stats.js targetOf).
//   node tests/test_pace.cjs
const assert = require('assert');
const { pathToFileURL } = require('node:url');

import(pathToFileURL(__dirname + '/../public/shared/stats.js')).then(S => {
  const sec = q => S.targetOf(q) / 1000;
  const q = (skill, difficulty = 'Medium', extra = {}) => ({ skill, difficulty, ...extra });

  // Every bank skill resolves to a table value, including the Nonlinear-equations alias.
  assert.strictEqual(S.SKILL_ORDER.length, 29);
  for (const skill of S.SKILL_ORDER) {
    const row = S.SKILL_TIME_S[skill] ?? Object.entries(S.SKILL_TIME_S).find(([k]) => k.startsWith(skill))?.[1];
    assert.ok(row, `${skill} has no table time`);
    assert.strictEqual(sec(q(skill)), row, `${skill}: Medium is the table value`);
  }
  assert.strictEqual(Object.keys(S.SKILL_TIME_S).length, 29);
  assert.strictEqual(sec(q('Nonlinear equations in one variable')), 105);
  assert.strictEqual(sec(q('Nonlinear equations in one variable and systems of equations in two variables')), 105);

  assert.strictEqual(sec(q('Circles')), 120);
  assert.strictEqual(sec(q('Transitions')), 50);
  assert.strictEqual(sec(q('Transitions', 'Easy')), 40, '37.5 rounds to 40');
  assert.strictEqual(sec(q('Circles', 'Hard')), 155, '156 rounds to 155');

  for (const skill of S.SKILL_ORDER) {
    const t = [q(skill, 'Easy'), q(skill), q(skill, 'Hard'), q(skill, 'Hard', { level: 4 }), q(skill, 'Hard', { level: 5 })].map(S.targetOf);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1], `${skill}: not monotonic ${t}`);
    assert.ok(t[4] > t[2], `${skill}: AI level 5 is above Hard`);
    t.forEach(ms => { assert.strictEqual(ms % 5000, 0, 'multiple of 5 s'); assert.ok(ms >= 30000 && ms <= 240000); });
  }

  // The 30 s floor and 240 s ceiling are never reached by the table (range 40-180 s) but still hold.
  assert.strictEqual(S.targetOf({ skill: 'Boundaries', difficulty: 'Easy', section: 'Reading & Writing' }), 40000);
  assert.strictEqual(S.targetOf({ skill: 'Circles', level: 5, domain: 'x' }), 180000);

  // Unknown skill -> domain average -> section -> 85 s.
  assert.strictEqual(sec({ skill: 'Made up', domain: 'Geometry and Trigonometry', difficulty: 'Medium' }), 110, '111 -> 110');
  assert.strictEqual(sec({ domain: 'Advanced Math' }), 100);
  assert.strictEqual(sec({ section: 'Math' }), 95);
  assert.strictEqual(sec({ section: 'Reading & Writing' }), 70, '71 -> 70');
  assert.strictEqual(sec({}), 85);
  console.log('pace: all cases hold');
}).catch(e => { console.error(e); process.exitCode = 1; });
