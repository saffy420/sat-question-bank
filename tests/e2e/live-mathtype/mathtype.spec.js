import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { MATH, RW, INSTRUCTOR, zoomOpts, lesson, join, openLive } from '../lessons-11-ui-polish/helpers.js';

// live-mathtype: on a math question the presenter's Text tool types math the Desmos way (MathQuill), `"` first
// makes a plain-text note, Reading & Writing keeps the plain box. A box being typed reaches students live once
// the question is revealed (never before), Esc clears the draft, and the Edit tool opens a formula in the same
// editor and sends the change to students at once.
test.use({ actionTimeout: 15000 });

const boxes = page => page.locator('.lesson-stage .lesson-textbox');
const stemText = page => page.locator('#live-card .lesson-stem p').first();
const mathEditor = page => page.locator('.lesson-mathbox-input');
const latexOf = editor => editor.locator('[data-latex]').getAttribute('data-latex');
const roomAnnotations = async (context, sessionId) => (await (await context.request.get(`/api/lessons/${sessionId}`)).json()).annotations;
const tex = (page, card) => page.locator(`${card} .lesson-stem .katex annotation`).allTextContents();
// The drawn formula (KaTeX's .katex-html; its hidden MathML copy is what a click on .katex itself would aim at).
const clickFormula = page => page.locator('#live-card .lesson-stem .katex .katex-html').click();

async function keys(page, steps) {
  for (const step of steps) {
    if (step.startsWith('#')) await page.keyboard.press(step.slice(1));
    else await page.keyboard.type(step);
  }
}

test('math boxes: Desmos keys, " makes a note, R&W stays plain; private until the reveal', async ({ browser }) => {
  test.setTimeout(180000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-1'), zoomContext = await newUserContext(browser, 'e2e-student-2', zoomOpts(1.25));
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Math boxes', [MATH, RW], 'instructor', 300);
    const teacher = await openLive(admin, sessionId);
    const student = await studentContext.newPage(), zoomed = await zoomContext.newPage();
    await join(student, joinCode);
    await join(zoomed, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await teacher.locator('[data-tool="text"]').click();
    const editor = mathEditor(teacher);

    // Each case: a new box on the stem, keys typed, the editor's LaTeX read, Esc.
    const typed = async steps => {
      await stemText(teacher).click({ position: { x: 6, y: 8 } });
      await expect(editor).toBeVisible();
      await expect(teacher.locator('textarea.lesson-textbox-input')).toHaveCount(0);
      await keys(teacher, steps);
      const value = await latexOf(editor);
      await teacher.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      return value;
    };
    const cases = [
      [['sqrt', 'x', '#ArrowRight', '+1'], '\\sqrt{x}+1'],
      [['cbrt', '8'], '\\sqrt[3]{8}'],
      [['x^2', '#ArrowRight', '+1'], 'x^{2}+1'],
      [['x_1', '#ArrowRight', '+y'], 'x_{1}+y'],
      [['(x+1)/2'], '\\frac{\\left(x+1\\right)}{2}'],
      [['12x/3'], '\\frac{12x}{3}'],
      [['/'], '\\frac{ }{ }'],
      // Left from after the radical goes back into it; Up/Down move between numerator and denominator.
      [['sqrt', 'x', '#ArrowRight', '#ArrowLeft', '#ArrowLeft', 'y'], '\\sqrt{yx}'],
      [['1/2', '#ArrowUp', '3', '#ArrowDown', '4'], '\\frac{13}{24}'],
      // `)` steps over the auto `)`; brackets and absolute value close themselves.
      [['(x', ')', '+1'], '\\left(x\\right)+1'],
      [['|x', '#ArrowRight', '+[y', '#ArrowRight', '+{z'], '\\left|x\\right|+\\left[y\\right]+\\left\\{z\\right\\}'],
      [['pi', '*theta', '<=', 'sin', 'x', '>=', 'infinity'], '\\pi\\cdot\\theta\\le\\sin x\\ge\\infty'],
      // Backspace removes an empty structure instead of getting stuck in it.
      [['/', '#Backspace', 'z'], 'z'],
      [['sqrt', '#Backspace', 'z'], 'z'],
    ];
    for (const [steps, expected] of cases) expect(await typed(steps), steps.join(' ')).toBe(expected);
    await expect(teacher.locator('[data-tool="text"]')).toHaveAttribute('aria-pressed', 'true');

    // Pasting LaTeX (with or without \( \)) parses it into editable math.
    await stemText(teacher).click({ position: { x: 6, y: 8 } });
    await teacher.locator('.lesson-mathbox-input textarea').evaluate(area => {
      const data = new DataTransfer();
      data.setData('text/plain', '\\(\\frac{1}{2}+\\sqrt{x}\\)');
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => latexOf(editor)).toBe('\\frac{1}{2}+\\sqrt{x}');
    // It is structure, not text: Left from the end goes into the radical.
    await teacher.keyboard.press('ArrowLeft');
    await teacher.keyboard.type('y');
    await expect.poll(() => latexOf(editor)).toBe('\\frac{1}{2}+\\sqrt{xy}');
    await teacher.keyboard.press('Escape');
    await expect(boxes(teacher)).toHaveCount(0);

    // `"` first: a plain-text box, exactly like today's (textarea, Enter commits).
    await stemText(teacher).click({ position: { x: 6, y: 8 } });
    await teacher.keyboard.type('"');
    const area = teacher.locator('textarea.lesson-textbox-input');
    await expect(area).toBeFocused();
    await expect(editor).toHaveCount(0);
    await expect(area).toHaveValue('');
    await teacher.keyboard.type('Look here');
    await teacher.keyboard.press('Enter');
    await expect(boxes(teacher)).toHaveText(['Look here']);

    // A math box: Enter commits; the presenter sees it drawn with KaTeX.
    await stemText(teacher).click({ position: { x: 300, y: 8 } });
    await keys(teacher, ['x^2', '#ArrowRight', '+1']);
    await teacher.keyboard.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(boxes(teacher)).toHaveCount(2);
    const math = boxes(teacher).nth(1);
    await expect(math).toHaveAttribute('data-tex', 'x^{2}+1');
    await expect(math.locator('.katex annotation')).toHaveText('x^{2}+1');
    expect((await roomAnnotations(admin, sessionId)).map(m => [m.type, m.text ?? null, m.tex ?? null])).toEqual([['text', 'Look here', null], ['text', null, 'x^{2}+1']]);

    // Private before the reveal: nothing in the student's DOM or in their copy of the room state.
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    await expect(boxes(student)).toHaveCount(0);
    const before = await studentContext.request.get(`/api/lessons/${sessionId}`);
    expect(before.status()).toBe(200);
    const body = await before.text();
    expect(JSON.parse(body).annotations).toEqual([]);
    expect(body).not.toContain('x^{2}+1');
    expect(body).not.toContain('Look here');

    // The reveal shows both boxes, the math one drawn with KaTeX, on the same spot of the stem at any zoom
    // (the presenter clicked 300 px into the stem line: a fraction of that block).
    await teacher.locator('[data-live="endNow"]').click();
    const spot = async (page, card) => {
      const p = await page.locator(`${card} .lesson-stem p`).first().evaluate(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
      const b = await page.locator(`${card} .lesson-textbox[data-tex="x^{2}+1"]`).evaluate(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top }; });
      return [(b.l - p.l) / p.w, (b.t - p.t) / p.h];
    };
    const presenterSpot = await spot(teacher, '#live-card');
    for (const page of [student, zoomed]) {
      await expect(page.locator('.lesson-phase')).toHaveText('REVEALED');
      await expect(page.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
      await expect(boxes(page)).toHaveCount(2);
      await expect(boxes(page).filter({ hasText: 'Look here' })).toHaveCount(1);
      await expect(page.locator('.lesson-textbox[data-tex="x^{2}+1"] .katex annotation')).toHaveText('x^{2}+1');
      const [x, y] = await spot(page, '#lesson-card');
      expect(Math.abs(x - presenterSpot[0])).toBeLessThan(0.02);
      expect(Math.abs(y - presenterSpot[1])).toBeLessThan(0.1);
    }
    // TeX KaTeX can't draw shows as typed instead of breaking the box (the shared renderer, run on the student page).
    const drawn = await student.evaluate(async () => {
      const Ink = await import('/shared/annotations.js');
      const card = document.createElement('div');
      card.style.cssText = 'position:relative;width:400px;height:200px';
      document.body.append(card);
      Ink.textBoxes(card, [{ type: 'text', id: 'bad', x: 0.1, y: 0.1, tex: '\\frac{1}{', color: '#ffe066' }, { type: 'text', id: 'good', x: 0.5, y: 0.5, tex: '\\sqrt{2}', color: '#ffe066' }]);
      const out = [...card.querySelectorAll('.lesson-textbox')].map(b => ({ id: b.dataset.textMark, text: b.textContent, katex: !!b.querySelector('.katex'), hidden: b.hidden }));
      card.remove();
      return out;
    });
    expect(drawn).toEqual([{ id: 'bad', text: '\\frac{1}{', katex: false, hidden: false }, expect.objectContaining({ id: 'good', katex: true, hidden: false })]);

    // Reading & Writing: the plain box, where `"` is just a character.
    await teacher.locator('#live-next').click();
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await teacher.locator('[data-tool="text"]').click();
    await stemText(teacher).click({ position: { x: 6, y: 8 } });
    await expect(area).toBeFocused();
    await expect(editor).toHaveCount(0);
    await teacher.keyboard.type('"careful"');
    await expect(area).toHaveValue('"careful"');
    await teacher.keyboard.press('Escape');
    await expect(area).toHaveCount(0);
  } finally {
    await admin.close(); await studentContext.close(); await zoomContext.close();
  }
});

test('drafts: a box typed across the reveal reaches students before Enter; Esc clears or restores it for everyone', async ({ browser }) => {
  test.setTimeout(180000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-1');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Math drafts', [MATH], 'instructor', 15);
    const teacher = await openLive(admin, sessionId);
    const student = await studentContext.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await teacher.locator('[data-tool="text"]').click();
    const editor = mathEditor(teacher);
    await stemText(teacher).click({ position: { x: 6, y: 8 } });
    await teacher.keyboard.type('x');
    await expect.poll(() => latexOf(editor)).toBe('x');

    // While answers are open the draft stays with the presenter.
    await teacher.waitForTimeout(400);
    await expect(boxes(student)).toHaveCount(0);
    expect(await roomAnnotations(studentContext, sessionId)).toEqual([]);
    expect(await roomAnnotations(admin, sessionId)).toEqual([]);

    // Time runs out with the editor still open: the draft appears for the student at the reveal.
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED', { timeout: 30000 });
    await expect(editor).toBeVisible();
    const box = student.locator('.lesson-textbox');
    await expect(box).toHaveAttribute('data-tex', 'x');
    // Typing goes on: the student sees each change before Enter.
    await keys(teacher, ['^2']);
    await expect(box).toHaveAttribute('data-tex', 'x^{2}');
    await expect(box.locator('.katex annotation')).toHaveText('x^{2}');
    await expect(editor).toBeVisible();
    // Esc: the new box goes for everyone.
    await teacher.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(boxes(student)).toHaveCount(0);
    await expect(boxes(teacher)).toHaveCount(0);

    // A new box, committed.
    await stemText(teacher).click({ position: { x: 6, y: 8 } });
    await teacher.keyboard.type('y');
    await expect(box).toHaveAttribute('data-tex', 'y');
    await teacher.keyboard.press('Enter');
    await expect(boxes(teacher)).toHaveAttribute('data-tex', 'y');
    await expect(boxes(student)).toHaveCount(1);

    // Editing it: live for the student, and Esc puts the committed box back for everyone.
    await boxes(teacher).first().click();
    await expect(editor).toBeVisible();
    expect(await latexOf(editor)).toBe('y');
    await teacher.keyboard.type('+1');
    await expect(box).toHaveAttribute('data-tex', 'y+1');
    await teacher.keyboard.press('Escape');
    await expect(box).toHaveAttribute('data-tex', 'y');
    await expect(boxes(teacher)).toHaveAttribute('data-tex', 'y');
    // Edited and committed: still one box, same place, new math.
    await boxes(teacher).first().click();
    await teacher.keyboard.type('+2');
    await expect(box).toHaveAttribute('data-tex', 'y+2');
    await teacher.keyboard.press('Enter');
    await expect(boxes(student)).toHaveCount(1);
    await expect(box).toHaveAttribute('data-tex', 'y+2');
    expect((await roomAnnotations(admin, sessionId)).map(m => [m.type, m.tex])).toEqual([['text', 'y+2']]);

    // A reconnecting student gets the committed box.
    await student.reload(); await join(student, joinCode);
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    await expect(box).toHaveAttribute('data-tex', 'y+2');
  } finally {
    await admin.close(); await studentContext.close();
  }
});

test('edit math: a formula opens in the math editor; 3 + 4 → 3 + 5 reaches students during ANSWERING; history keeps it', async ({ browser }) => {
  test.setTimeout(180000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const studentContext = await newUserContext(browser, 'e2e-student-1');
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Math edit', [MATH], 'instructor', 120);
    const teacher = await openLive(admin, sessionId);
    const student = await studentContext.newPage();
    await join(student, joinCode);
    await teacher.locator('[data-live="start"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('#live-card')).toHaveAttribute('data-ready', 'true');
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await tex(student, '#lesson-card')).toEqual(['3 + 4']);

    await teacher.locator('[data-tool="edit"]').click();
    await clickFormula(teacher);
    const formula = teacher.locator('.lesson-formula-input');
    await expect(formula).toBeVisible();
    expect(await latexOf(formula)).toBe('3+4');
    // Esc cancels: nothing changes.
    await teacher.keyboard.press('Backspace');
    await teacher.keyboard.type('9');
    expect(await latexOf(formula)).toBe('3+9');
    await teacher.keyboard.press('Escape');
    await expect(formula).toHaveCount(0);
    await expect(teacher.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await tex(teacher, '#live-card')).toEqual(['3 + 4']);

    // Edit and commit with Enter.
    await clickFormula(teacher);
    await expect(formula).toBeVisible();
    await teacher.keyboard.press('Backspace');
    await teacher.keyboard.type('5');
    expect(await latexOf(formula)).toBe('3+5');
    await teacher.keyboard.press('Enter');
    await expect(formula).toHaveCount(0);
    expect(await tex(teacher, '#live-card')).toEqual(['3+5']);
    // The student sees it during ANSWERING; the prose around it is unchanged.
    await expect.poll(() => tex(student, '#lesson-card')).toEqual(['3+5']);
    await expect(student.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(student.locator('#lesson-card .lesson-stem p').first()).toContainText('What is');
    expect((await roomAnnotations(admin, sessionId)).map(m => [m.type, m.nodeId, m.k, m.tex])).toEqual([['edit-math', 's:0', 0, '3+5']]);
    expect((await roomAnnotations(studentContext, sessionId)).map(m => [m.type, m.tex])).toEqual([['edit-math', '3+5']]);

    // It opens again from the edited math.
    await clickFormula(teacher);
    await expect(formula).toBeVisible();
    expect(await latexOf(formula)).toBe('3+5');
    await teacher.keyboard.press('Escape');

    // A formula the editor can't take without loss (an environment) stays locked, with a note.
    await teacher.locator('#live-card .lesson-stem .katex annotation').evaluate(n => { n.textContent = '\\begin{array}{c}1\\\\2\\end{array}'; });
    await clickFormula(teacher);
    await expect(teacher.locator('#live-edit-note')).toHaveText("This formula can't be edited here");
    await expect(formula).toHaveCount(0);

    // Reconnect, reveal, end: the student and My Lessons keep the edited math.
    await student.reload(); await join(student, joinCode);
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await tex(student, '#lesson-card')).toEqual(['3+5']);
    await teacher.locator('[data-live="endNow"]').click();
    await expect(student.locator('.lesson-phase')).toHaveText('REVEALED');
    expect(await tex(student, '#lesson-card')).toEqual(['3+5']);
    await teacher.locator('[data-live="endSession"]').click();
    await expect(student.locator('#lesson-live')).toBeHidden();
    await expect.poll(async () => (await studentContext.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await student.locator('.nav-i[data-tab="lessons"]').click();
    await student.locator(`#lessons-table tr[data-session="${sessionId}"]`).click();
    await expect(student.locator('#lesson-card')).toHaveAttribute('data-ready', 'true');
    expect(await tex(student, '#lesson-card')).toEqual(['3+5']);
  } finally {
    await admin.close(); await studentContext.close();
  }
});
