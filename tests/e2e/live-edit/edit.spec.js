import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { MATH, INSTRUCTOR, lesson, join, openLive, dismissEnded } from '../lessons-11-ui-polish/helpers.js';

// Edit text: during ANSWERING the presenter fixes the wording of the stem and of a choice in place. Students
// see the new text at once (edits are never hidden), the inline KaTeX stays as it was and prose typing can't
// touch it (a click opens it in the math editor instead: tests/e2e/live-mathtype), a highlight on the edited
// block goes, a student's selection survives, and My Lessons shows the fix.
test.use({ actionTimeout: 15000 });
const artifacts = '.omp/pipeline/live-edit/e2e';
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });
const LOCKED = 'Only text can be changed — math and formatting are locked';

// Native selection of `text` inside `scope` (KaTeX excluded), as a user's drag would leave it.
const selectIn = (page, scope, text) => page.locator(scope).evaluate((root, text) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('.katex')) continue;
    const at = node.data.indexOf(text);
    if (at < 0) continue;
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return;
  }
  throw Error(`text missing: ${text}`);
}, text);
// Caret right after the inline math, i.e. at the start of the text that follows it.
const caretAfterMath = page => page.locator('#live-card .lesson-stem [data-ann-editing]').evaluate(block => {
  const math = block.querySelector('.katex'), walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) if (!node.parentElement.closest('.katex') && math.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) break;
  const range = document.createRange(); range.setStart(node, 0); range.collapse(true);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
});
const stemText = (page, card = '#lesson-card') => page.locator(`${card} .lesson-stem p`).first().evaluate(p => {
  const clone = p.cloneNode(true); clone.querySelectorAll('.katex').forEach(k => k.replaceWith('[math]'));
  return clone.textContent;
});
const tex = (page, card) => page.locator(`${card} .lesson-stem .katex annotation`).allTextContents();

test('live edit: stem and choice text fixed during ANSWERING reach students at once; math is locked to prose typing; history keeps it', async ({ browser }) => {
  test.setTimeout(180000);
  mkdirSync(artifacts, { recursive: true });
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-1');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Live edit', [MATH], 'instructor', 120);
    const teacher = await openLive(admin, sessionId);
    const student = await studentContext.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await stemText(student)).toBe('What is [math]?');
    const mathBefore = await tex(student, '#lesson-card');
    expect(mathBefore).toEqual(['3 + 4']);

    // The student picks C; the presenter highlights "What" (hidden from students until the reveal).
    await student.locator('#lesson-card [data-lesson-choice="C"]').click();
    await expect(student.locator('#lesson-card [data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(teacher.locator('[data-tool="highlight"]')).toHaveAttribute('aria-pressed', 'true');
    await selectIn(teacher, '#live-card .lesson-stem', 'What');
    await teacher.locator('#live-card .lesson-stem').evaluate(el => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    await expect(teacher.locator('#live-card [data-ann-mark]')).toHaveText(['What']);

    // Edit text: click the stem, the block becomes editable with its math locked.
    await teacher.locator('[data-tool="edit"]').click();
    await expect(teacher.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
    await teacher.locator('#live-card .lesson-stem p').first().click({ position: { x: 4, y: 6 } });
    const editing = teacher.locator('#live-card [data-ann-editing]');
    await expect(editing).toHaveAttribute('data-ann-node', 's:0');
    await expect(editing).toHaveAttribute('contenteditable', /^(plaintext-only|true)$/);
    await expect(editing.locator('.katex')).toHaveAttribute('contenteditable', 'false');
    await expect(editing.locator('.katex')).toHaveAttribute('title', 'Click to edit the math');
    expect(await editing.locator('.katex').evaluate(k => getComputedStyle(k).backgroundColor)).toBe('rgb(230, 230, 230)');
    // The highlight is lifted off the block while it is edited.
    await expect(teacher.locator('#live-card [data-ann-mark]')).toHaveCount(0);
    await shot(teacher, '01-presenter-editing-stem');

    // Backspace from just after the math into it: refused, the math stays.
    await caretAfterMath(teacher);
    await teacher.keyboard.press('Backspace');
    await expect(teacher.locator('#live-edit-note')).toHaveText(LOCKED);
    await expect(editing.locator('.katex')).toHaveCount(1);
    await shot(teacher, '02-presenter-math-locked');

    // Replace "is" with "equals" and commit with Enter.
    await selectIn(teacher, '#live-card [data-ann-editing]', 'is');
    await teacher.keyboard.type('equals');
    await teacher.keyboard.press('Enter');
    await expect(editing).toHaveCount(0);
    await expect(teacher.locator('#live-card .lesson-stem p').first()).not.toHaveAttribute('contenteditable');

    // The student sees the new word at once, the math unchanged, and the stale highlight gone for the presenter.
    await expect.poll(() => stemText(student)).toBe('What equals [math]?');
    expect(await tex(student, '#lesson-card')).toEqual(mathBefore);
    expect(await stemText(teacher, '#live-card')).toBe('What equals [math]?');
    await expect(teacher.locator('#live-card [data-ann-mark]')).toHaveCount(0);
    await expect(student.locator('#lesson-card [data-ann-mark]')).toHaveCount(0);
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await shot(student, '03-student-sees-edit-during-answering');

    // Edit choice C (the student's pick): the selection is kept.
    await teacher.locator('#live-card [data-lesson-choice="C"] [data-ann-node="c:C"]').click();
    await expect(editing).toHaveAttribute('data-ann-node', 'c:C');
    await selectIn(teacher, '#live-card [data-ann-editing]', '7');
    await teacher.keyboard.type('seven');
    await shot(teacher, '04-presenter-editing-choice');
    await teacher.keyboard.press('Enter');
    const choiceC = student.locator('#lesson-card [data-lesson-choice="C"] [data-ann-node="c:C"]');
    await expect(choiceC).toHaveText('seven');
    await expect(student.locator('#lesson-card [data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(student.locator('#lesson-card [data-lesson-choice="C"] .choice')).toHaveClass(/\bsel\b/);
    await shot(student, '05-student-choice-edit-keeps-selection');

    // Esc cancels an edit in progress.
    await teacher.locator('#live-card [data-lesson-choice="A"] [data-ann-node="c:A"]').click();
    await selectIn(teacher, '#live-card [data-ann-editing]', '5');
    await teacher.keyboard.type('five');
    await teacher.keyboard.press('Escape');
    await expect(teacher.locator('#live-card [data-ann-node="c:A"]')).toHaveText('5');
    await expect(teacher.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
    // Turning the tool off puts the presenter's choice buttons back to disabled (they never select here).
    await teacher.locator('[data-tool="edit"]').click();
    await expect(teacher.locator('#live-card [data-lesson-choice="C"]')).toBeDisabled();

    // A student who reconnects gets the edited text from the snapshot.
    await student.reload(); await join(student, joinCode);
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await stemText(student)).toBe('What equals [math]?');
    await expect(choiceC).toHaveText('seven');
    await expect(student.locator('#lesson-card [data-lesson-choice="C"]')).toHaveAttribute('aria-pressed', 'true');

    // The room kept the edits and dropped the highlight; the bank question is untouched.
    const room = await (await admin.request.get(`/api/lessons/${sessionId}`)).json();
    expect(room.annotations.map(m => [m.type, m.nodeId, m.i, m.text])).toEqual([['edit', 's:0', 0, 'What equals '], ['edit', 'c:C', 0, 'seven']]);

    // End the lesson: My Lessons shows the session with the edited text.
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    await teacher.locator('[data-live="endSession"]').click();
    await dismissEnded(student);
    await expect(student.locator('#lesson-live')).toBeHidden();
    await expect.poll(async () => (await studentContext.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await student.locator('.nav-i[data-tab="lessons"]').click();
    await student.locator(`#lessons-table tr[data-session="${sessionId}"]`).click();
    await expect(student.locator('#history-summary')).toBeVisible();
    await student.locator(`[data-history-open="${MATH}"]`).click();
    await expect(student.locator('#history-show')).not.toBeChecked();
    await expect(student.locator('#history-reveal')).toHaveCount(0);
    await student.locator('#history-show').check();
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await stemText(student)).toBe('What equals [math]?');
    expect(await tex(student, '#lesson-card')).toEqual(mathBefore);
    await expect(choiceC).toHaveText('seven');
    await shot(student, '06-history-shows-edit');
    // The practice bank keeps the original wording.
    const bank = await (await studentContext.request.get('/api/questions')).json();
    const original = (bank.questions || bank).find(q => q.id === MATH);
    expect(original.stem_html).toContain('What is');
  } finally {
    await admin.close(); await studentContext.close();
  }
});
