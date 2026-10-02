import { test, expect } from '@playwright/test';
import { newUserContext } from '../lessons-00b-e2e-harness/auth.js';
import { INSTRUCTOR, LONG, zoomOpts, lesson, join, openLive, shot, wordCenter, passageWords } from '../lessons-11-ui-polish/helpers.js';

// live-textbox: the presenter's Text tool puts a typed box on the question card. It follows the pen's visibility
// rules (private before the reveal, live after), stays on the words it was placed on at any width and zoom,
// can be edited and erased, survives a reconnect and shows in My Lessons.

const PASSAGE = '#live-card .stage-passage';
const STUDENT_PASSAGE = '#lesson-card .stage-passage';
const boxes = page => page.locator('.lesson-stage .lesson-textbox');

// The box's top-left corner is where the presenter clicked, so it must sit on the clicked word: inside the word's
// rect on both axes (a pixel or two of slack for rounding at fractional zoom).
async function boxOnWord(page, scope, index, n = 0) {
  const word = (await passageWords(page, scope))[index];
  const at = await boxes(page).nth(n).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  expect(at.x, `box left over word "${word.t}"`).toBeGreaterThanOrEqual(word.l - 2);
  expect(at.x).toBeLessThanOrEqual(word.r + 2);
  expect(at.y, 'box top over the word line').toBeGreaterThanOrEqual(word.t0 - 2);
  expect(at.y).toBeLessThanOrEqual(word.b + 2);
  return { word, at };
}

test('text box: private until the reveal, then on the same word for every student; edit, erase, reconnect, My Lessons', async ({ browser }) => {
  test.setTimeout(240000);
  const admin = await newUserContext(browser, 'e2e-admin', INSTRUCTOR);
  const plainContext = await newUserContext(browser, 'e2e-student-1'), zoomContext = await newUserContext(browser, 'e2e-student-2', zoomOpts(1.1));
  try {
    const { sessionId, joinCode } = await lesson(admin, 'Textbox', [LONG]);
    const teacher = await openLive(admin, sessionId);
    const plain = await plainContext.newPage(), zoomed = await zoomContext.newPage();
    for (const page of [plain, zoomed]) await join(page, joinCode);
    await teacher.locator('[data-live="start"]').click();
    for (const page of [plain, zoomed]) await expect(page.locator('.lesson-phase')).toHaveText('ANSWERING');
    await expect(teacher.locator('.live-view')).toHaveAttribute('data-phase', 'ANSWERING');
    await expect(teacher.locator('#live-card[data-ready="true"]')).toBeVisible();

    // The Text tool sits right after Strikethrough.
    const order = await teacher.locator('#live-tools [data-tool]').evaluateAll(b => b.map(x => x.dataset.tool));
    expect(order.indexOf('text')).toBe(order.indexOf('strike') + 1);

    // Click a passage word, type, Enter.
    await teacher.locator('[data-tool="text"]').click();
    await expect(teacher.locator('[data-tool="text"]')).toHaveAttribute('aria-pressed', 'true');
    const WORD = 18;
    const first = (await passageWords(teacher, PASSAGE))[WORD];
    await wordCenter(teacher, PASSAGE, first.t, (await passageWords(teacher, PASSAGE)).slice(0, WORD).filter(w => w.t === first.t).length);
    const target = (await passageWords(teacher, PASSAGE))[WORD];
    await teacher.mouse.click((target.l + target.r) / 2, (target.t0 + target.b) / 2);
    const input = teacher.locator('.lesson-textbox-input');
    await expect(input).toBeFocused();
    expect(await input.getAttribute('maxlength')).toBe('280');
    await input.fill('Main idea?');
    await shot(teacher, 'textbox-01-typing');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(boxes(teacher)).toHaveText(['Main idea?']);
    await boxOnWord(teacher, PASSAGE, WORD);

    // Private: nothing for students while ANSWERING, in the DOM or in a fresh copy of the room state.
    await expect.poll(async () => (await (await admin.request.get(`/api/lessons/${sessionId}`)).json()).annotations.map(m => m.type)).toEqual(['text']);
    for (const page of [plain, zoomed]) await expect(boxes(page)).toHaveCount(0);

    // Edit: the Text tool on an existing box reopens it; one box remains, with the new words.
    await boxes(teacher).first().click();
    await expect(input).toHaveValue('Main idea?');
    await input.fill('Main idea:\nthe author shifts tone');
    await input.press('Enter');
    await expect(boxes(teacher)).toHaveCount(1);
    await expect(boxes(teacher)).toHaveText(['Main idea:\nthe author shifts tone']);
    await boxOnWord(teacher, PASSAGE, WORD);
    // Esc cancels: nothing changes.
    await boxes(teacher).first().click();
    await input.fill('discarded');
    await input.press('Escape');
    await expect(boxes(teacher)).toHaveText(['Main idea:\nthe author shifts tone']);
    await expect(teacher.locator('[data-tool="text"]')).toHaveAttribute('aria-pressed', 'true');

    // Reveal: both students get the box over the same word.
    await teacher.locator('[data-live="endNow"]').click();
    for (const page of [plain, zoomed]) await expect(page.locator('#lesson-content')).toContainText('REVEALED');
    for (const page of [plain, zoomed]) await expect(page.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    for (const [label, page] of [['1366×768', plain], ['110% zoom', zoomed]]) {
      await expect(boxes(page), label).toHaveText(['Main idea:\nthe author shifts tone']);
      const { word, at } = await boxOnWord(page, STUDENT_PASSAGE, WORD);
      console.log(`${label}: word "${word.t}" [${word.l.toFixed(1)},${word.t0.toFixed(1)}], box at [${at.x.toFixed(1)},${at.y.toFixed(1)}]`);
      await shot(page, `textbox-02-student-${label.replace(/\W+/g, '')}`);
      // Students click through a box: it never takes the pointer.
      expect(await boxes(page).first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    }
    // The presenter's font size matches the type: a box is smaller than the line it sits on, scaled by em.
    const sizes = await Promise.all([teacher, plain, zoomed].map(async (page, i) => {
      const scope = i ? STUDENT_PASSAGE : PASSAGE;
      const type = await page.locator(scope).evaluate(el => parseFloat(getComputedStyle(el.querySelector('p, li') || el).fontSize));
      const text = await boxes(page).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      return text / type;
    }));
    for (const ratio of sizes) expect(Math.abs(ratio - sizes[0])).toBeLessThan(0.02);

    // Live now: a second box appears for students at once; the Erase tool removes a box for everyone.
    await teacher.locator('[data-tool="text"]').click();
    await expect(teacher.locator('[data-tool="text"]')).toHaveAttribute('aria-pressed', 'false');
    await teacher.locator('[data-tool="text"]').click();
    const second = (await passageWords(teacher, PASSAGE))[WORD + 25];
    await wordCenter(teacher, PASSAGE, second.t, (await passageWords(teacher, PASSAGE)).slice(0, WORD + 25).filter(w => w.t === second.t).length);
    const there = (await passageWords(teacher, PASSAGE))[WORD + 25];
    await teacher.mouse.click((there.l + there.r) / 2, (there.t0 + there.b) / 2);
    await input.fill('second');
    // Leaving the field commits a non-empty box.
    await teacher.mouse.click(37, 700);
    for (const page of [plain, zoomed]) await expect(boxes(page)).toHaveCount(2);
    await boxOnWord(plain, STUDENT_PASSAGE, WORD + 25, 1);
    await teacher.locator('[data-tool="erase"]').click();
    await boxes(teacher).filter({ hasText: 'second' }).click();
    for (const page of [teacher, plain, zoomed]) await expect(boxes(page)).toHaveText(['Main idea:\nthe author shifts tone']);

    // A reconnecting student gets the box with the snapshot.
    await plain.reload(); await join(plain, joinCode);
    await expect(plain.locator('#lesson-card[data-ready="true"]')).toBeVisible();
    await expect(boxes(plain)).toHaveText(['Main idea:\nthe author shifts tone']);
    await boxOnWord(plain, STUDENT_PASSAGE, WORD);

    // End the session: My Lessons shows the box.
    await teacher.locator('[data-live="endSession"]').click();
    await expect.poll(async () => (await plainContext.request.get(`/api/lesson-history/${sessionId}`)).status()).toBe(200);
    await plain.goto('/app');
    await plain.locator('.nav-i[data-tab="lessons"]').click();
    await plain.locator(`#lessons-table tr[data-session="${sessionId}"]`).click({ timeout: 10000 });
    await expect(plain.locator('#lesson-card[data-ready]')).toBeVisible();
    await expect(boxes(plain)).toHaveText(['Main idea:\nthe author shifts tone']);
    await boxOnWord(plain, STUDENT_PASSAGE, WORD);
    await shot(plain, 'textbox-03-history');
  } finally { await admin.close(); await plainContext.close(); await zoomContext.close(); }
});
