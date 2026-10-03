// Question bank home: topic selection, the old Section dropdown's migration, and the extra-filter hook.
//
//   node --test tests/test_qbank_home.ts        (Node 22.18+ strips the types)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleSkills, toggleOption, normalizeSkills, migrateSection, allPicked } from '../lesson-ui/qbank/selection.ts';
import { applyExtraFilters } from '../lesson-ui/qbank/filterTypes.ts';
import type { FilterDef, FilterCtx } from '../lesson-ui/qbank/filterTypes.ts';

const RW_DOMAIN = ['Central Ideas and Details', 'Inferences'];
const SECTION_SKILLS = { 'Reading & Writing': [...RW_DOMAIN, 'Transitions'], Math: ['Linear functions', 'Circles'] };

test('a skill click picks it alone from every topic; un-picking the last one is every topic again', () => {
  const one = toggleSkills(null, ['Inferences']);
  assert.deepEqual(one, ['Inferences']);
  assert.deepEqual(toggleSkills(one, ['Circles']), ['Inferences', 'Circles']);
  assert.equal(toggleSkills(one, ['Inferences']), null);
});

test('a domain or section click picks all its skills, and clears them when all were picked', () => {
  const dom = toggleSkills(['Inferences'], RW_DOMAIN);
  assert.deepEqual(dom!.sort(), [...RW_DOMAIN].sort());
  assert.ok(allPicked(dom, RW_DOMAIN));
  assert.equal(toggleSkills(dom, RW_DOMAIN), null);
  const sec = toggleSkills(['Circles'], SECTION_SKILLS['Reading & Writing']);
  assert.deepEqual(sec!.sort(), ['Circles', ...SECTION_SKILLS['Reading & Writing']].sort());
  assert.deepEqual(toggleSkills(sec, SECTION_SKILLS['Reading & Writing']), ['Circles']);
  assert.ok(!allPicked(null, RW_DOMAIN), 'every topic (null) highlights nothing');
});

test('a stored [] is every topic', () => {
  assert.equal(normalizeSkills([]), null);
  assert.equal(normalizeSkills(undefined), null);
  assert.deepEqual(normalizeSkills(['Circles']), ['Circles']);
});

test('difficulty and question-set chips: none or all picked is no filter', () => {
  const all = ['Easy', 'Medium', 'Hard'];
  assert.deepEqual(toggleOption(null, 'Hard', all), ['Hard']);
  assert.equal(toggleOption(['Hard'], 'Hard', all), null);
  assert.equal(toggleOption(['Easy', 'Hard'], 'Medium', all), null);
  assert.deepEqual(toggleOption(['Hard'], 'Easy', all), ['Easy', 'Hard'], 'kept in display order');
});

test('F.sec migration: a section with every topic becomes that section\'s skills', () => {
  assert.deepEqual(migrateSection({ sec: ['Math'], skills: null }, SECTION_SKILLS), SECTION_SKILLS.Math);
  assert.deepEqual(migrateSection({ sec: 'Math', skills: null }, SECTION_SKILLS), SECTION_SKILLS.Math, 'old single-value string');
});

test('F.sec migration: an explicit pick keeps only the skills that section allowed', () => {
  assert.deepEqual(migrateSection({ sec: ['Reading & Writing'], skills: ['Inferences', 'Circles'] }, SECTION_SKILLS), ['Inferences']);
});

test('F.sec migration: no section, both sections or an unknown one changes nothing', () => {
  assert.equal(migrateSection({ sec: null, skills: null }, SECTION_SKILLS), null);
  assert.equal(migrateSection({ sec: 'all', skills: [] }, SECTION_SKILLS), null);
  assert.deepEqual(migrateSection({ sec: ['Math', 'Reading & Writing'], skills: ['Circles'] }, SECTION_SKILLS), ['Circles']);
  assert.equal(migrateSection({ sec: ['Science'], skills: null }, SECTION_SKILLS), null);
});

test('applyExtraFilters runs active filters only, with the stored value or the initial one', () => {
  const ctx: FilterCtx = { prog: { q1: { marker: 'Red', attempts: 1 } }, log: [], ptmap: { tests: [] } };
  const seen: unknown[] = [];
  const wrongOnly: FilterDef<boolean> = {
    key: 'wrong', label: 'Wrong', initial: false,
    isActive: v => v, summary: () => 'Wrong only',
    test: (q, v, c) => { seen.push(v); return c.prog[q.id]?.marker === 'Red'; },
    Control: () => null
  };
  const q1 = { id: 'q1', section: 'Math' }, q2 = { id: 'q2', section: 'Math' };
  assert.equal(applyExtraFilters([wrongOnly], q2, undefined, ctx), true, 'inactive initial value passes everything');
  assert.equal(applyExtraFilters([wrongOnly], q2, {}, ctx), true);
  assert.equal(seen.length, 0, 'an inactive filter is never tested');
  assert.equal(applyExtraFilters([wrongOnly], q1, { wrong: true }, ctx), true);
  assert.equal(applyExtraFilters([wrongOnly], q2, { wrong: true }, ctx), false);
  assert.equal(applyExtraFilters([], q2, { wrong: true }, ctx), true, 'no defs, no filtering');
});
