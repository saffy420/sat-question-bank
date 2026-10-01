// Manual Playwright CLI integration probes. Excluded from `npm test`.
// Run only against a local dev server with populated local D1 banks/crops.
async page => {
  const parseURL = value => {
    const match = value.match(/^(https?):\/\/(\[[^\]]+\]|[^/:]+)(?::\d+)?([^?#]*)/);
    if (!match) throw new Error('Expected HTTP URL: ' + value);
    return { hostname: match[2], origin: value.slice(0, match[0].length - match[3].length), pathname: match[3] || '/' };
  };
  const base = parseURL(page.url());
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Open a local app URL before running browser probes.');
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const p = await context.newPage();
  p.setDefaultTimeout(10000);
  const results = [], errors = [], writes = [], external = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const probe = async (name, fn) => {
    try { results.push({ name, status: 'PASS', detail: await fn() }); }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }); }
  };
  p.on('pageerror', error => {
    if ((error.stack || '').includes('https://www.desmos.com/')) external.push(error.message);
    else errors.push(error.message);
  });
  p.on('requestfailed', request => {
    if (request.url().startsWith('https://www.desmos.com/')) external.push(request.failure()?.errorText);
  });
  await context.route('**/*', route => {
    const request = route.request(), url = parseURL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      if (url.origin === base.origin) writes.push(request.method() + ' ' + url.pathname);
      return route.abort('blockedbyclient');
    }
    if (url.hostname.endsWith('.supabase.co')) return route.abort('blockedbyclient');
    if (request.isNavigationRequest() && request.frame() === p.mainFrame() && url.origin !== base.origin) return route.abort('blockedbyclient');
    return route.continue();
  });
  await context.addInitScript(() => {
    localStorage.setItem('satq_filters', JSON.stringify({ sec: ['Math'], bank: null, diff: null, skills: null, count: 10, rand: false }));
  });
  const overflow = async selector => {
    await p.locator(selector).waitFor({ state: 'visible' });
    const bad = await p.locator(selector).evaluate(root => {
      const width = document.documentElement.clientWidth;
      return [document.documentElement, root, ...root.querySelectorAll('.panes, .pane, .stem, .choice, .passage, .desmos-panel, .stage-question, .lesson-calc')]
        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
        .filter(el => el.scrollWidth > el.clientWidth + 2 || el.getBoundingClientRect().right > width + 2 || el.getBoundingClientRect().left < -2)
        .map(el => ({ element: el.id || el.className || el.tagName, scroll: el.scrollWidth, width: el.clientWidth }));
    });
    assert(!bad.length, '375px overflow: ' + JSON.stringify(bad));
  };
  const images = async selector => {
    const loc = p.locator(selector + ' img');
    const count = await loc.count();
    for (const img of await loc.all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(el => el.decode());
      assert(await img.evaluate(el => el.complete && el.naturalWidth > 0), 'Broken image: ' + await img.getAttribute('src'));
    }
    return count;
  };
  let questions = [], rootResponse;
  try {
    await probe('local Worker, populated core and AI banks, guest boot', async () => {
      rootResponse = await p.goto(base.origin, { waitUntil: 'networkidle' });
      assert(rootResponse.status() === 200, 'Root status ' + rootResponse.status());
      const response = await p.request.get(base.origin + '/api/questions', { maxRedirects: 0 });
      assert(response.ok(), 'Questions API status ' + response.status());
      const body = await response.json();
      questions = Array.isArray(body) ? body : body.questions;
      assert(questions?.length > 0, 'Local bank empty; restore local DB bindings/data before running.');
      assert(questions.some(q => q.source === 'AI') && questions.some(q => q.source !== 'AI'), 'Both local banks required; AI fallback may hide missing AI_DB.');
      await p.locator('#home-stats .card').first().waitFor({ state: 'attached' });
      await p.getByRole('button', { name: 'Continue as guest', exact: true }).click();
      assert((await p.locator('#user-name').innerText()) === 'Guest', 'Expected isolated guest');
      return { questions: questions.length, ai: questions.filter(q => q.source === 'AI').length };
    });
    for (const tab of ['dash', 'practice', 'browse', 'mistakes', 'exams', 'history', 'settings']) {
      await probe('375px tab navigation: ' + tab, async () => {
        await p.setViewportSize({ width: 375, height: 812 });
        await p.locator(`.nav-i[data-tab="${tab}"]`).click();
        await overflow('#tab-' + tab);
        assert((await p.locator('#tab-' + tab).innerText()).trim().length > 0, 'Empty active tab');
      });
    }
    await probe('real Math player DOM and narrow layout, without grading', async () => {
      await p.locator('.nav-i[data-tab="practice"]').click();
      await p.locator('#btn-start').click();
      await p.locator('#bank-live').waitFor({ state: 'visible' });
      let choiceQuestions = 0, figureCount = 0;
      for (let i = 0; i < 5; i++) {
        const stem = await p.locator('#bank-card .lesson-stem').innerText();
        assert(stem.trim() || await p.locator('#bank-card img, #bank-card svg:not(.katex svg)').count(), 'Player has empty stem');
        const choices = p.locator('#bank-card .choice > span:last-of-type');
        if (await choices.count()) {
          choiceQuestions++;
          assert(await choices.count() === 4, 'Expected four rendered choice bodies');
          const bodies = [];
          for (const choice of await choices.all()) {
            assert((await choice.innerText()).trim() || await choice.locator('img, svg').count(), 'Empty rendered choice body');
            bodies.push(await choice.innerHTML());
          }
          assert(new Set(bodies).size === bodies.length, 'Duplicate rendered choice bodies');
        } else assert(await p.locator('#lesson-grid').isVisible(), 'No choices or grid-in input');
        figureCount += await images('#bank-card');
        assert(await p.locator('#bank-card .katex-error').count() === 0, 'KaTeX error in player');
        await overflow('#bank-live');
        if (i < 4) {
          const position = async () => Number(/Question (\d+) of/.exec(await p.locator('#bank-nav').innerText())[1]);
          const before = await position();
          await p.locator('#bank-primary').click();
          const after = await position();
          assert(after === before + 1, 'Next did not advance exactly one unattempted question');
        }
      }
      assert(choiceQuestions > 0, 'Sample never exercised MCQ DOM');
      return { sampled: 5, choiceQuestions, figureCount };
    });
    await probe('calculator iframe src, CSP, docking and external availability', async () => {
      const csp = rootResponse.headers()['content-security-policy'] || '';
      assert(/(?:^|;)\s*frame-src\s+[^;]*https:\/\/www\.desmos\.com(?:\s|;|$)/.test(csp), 'Root CSP does not allow Desmos frames');
      await p.locator('#bank-calc-toggle').click();
      const frame = p.locator('#lesson-calc iframe');
      await frame.waitFor({ state: 'visible' });
      assert(await frame.getAttribute('src') === 'https://www.desmos.com/testing/collegeboard/graphing', 'Wrong graphing src');
      await overflow('#lesson-calc');
      await overflow('#bank-live');
      let availability;
      try {
        await p.frameLocator('#lesson-calc iframe').locator('.dcg-calculator-api-container').waitFor({ state: 'visible', timeout: 15000 });
        availability = 'graphing calculator UI loaded';
      } catch {
        availability = 'EXTERNAL_UNAVAILABLE_OR_UNVERIFIED: ' + (external.join(', ') || 'Desmos UI not ready within 15s; iframe wiring is not calculator functionality');
      }
      await p.locator('#bank-calc-scientific').click();
      assert(await frame.getAttribute('src') === 'https://www.desmos.com/testing/collegeboard/scientific', 'Wrong scientific src');
      await p.locator('#lesson-calc-close').click();
      assert(await p.locator('#lesson-calc').isHidden(), 'Calculator did not close');
      return availability;
    });
    await probe('representative crop and KaTeX rendering in real Browse previews', async () => {
      await p.goto(base.origin, { waitUntil: 'networkidle' });
      await p.locator('.nav-i[data-tab="browse"]').click();
      const crops = questions.filter(q => /<img[^>]+\/qimg\//.test((q.stem_html || '') + (q.choices_json || ''))).slice(0, 3);
      const math = questions.find(q => /\\[([]/.test(q.stem_html || ''));
      assert(crops.length === 3 && math, 'Need three crop questions and one TeX question in local bank');
      let loaded = 0;
      for (const q of [...new Map([...crops, math].map(q => [q.id, q])).values()]) {
        await p.locator('#browse-q').fill(q.id);
        await p.locator('#browse-body tr[data-id]').filter({ hasText: q.id }).click();
        await p.locator('#pv-close').waitFor({ state: 'visible' });
        loaded += await images('#modal-root');
        assert(await p.locator('#modal-root .katex-error').count() === 0, 'KaTeX error for ' + q.id);
        if (q.id === math.id) assert(await p.locator('#modal-root .katex').count() > 0, 'KaTeX did not render ' + q.id);
        await overflow('#modal-root .modal');
        await p.locator('#pv-close').click();
      }
      assert(loaded >= 3, 'Representative crop probe did not load three images');
      return { ids: [...new Set([...crops, math].map(q => q.id))], loaded };
    });
    await probe('404 response and working home navigation', async () => {
      const response = await p.goto(base.origin + '/browser-probes-missing-page', { waitUntil: 'domcontentloaded' });
      assert(response.status() === 404, 'Missing page returned ' + response.status());
      assert(/404|not found/i.test(await p.locator('body').innerText()), 'Missing custom 404 body');
      await p.locator('a[href="/"]').first().click();
      await p.locator('#view-home').waitFor({ state: 'visible' });
    });
    await probe('token-free auth callback serves guest SPA without redirect', async () => {
      const response = await p.goto(base.origin + '/auth/callback?probe=guest', { waitUntil: 'networkidle' });
      assert(response.status() === 200 && !response.request().redirectedFrom(), 'Callback must serve SPA, not redirect');
      assert(parseURL(response.url()).pathname === '/auth/callback', 'Server callback response path lost');
      assert(parseURL(p.url()).origin === base.origin, 'Callback left local origin');
      assert((await p.locator('#user-name').innerText()) === 'Guest', 'Callback did not render guest');
      await p.locator('#home-stats .card').first().waitFor({ state: 'attached' });
    });
    await probe('guest safety and browser runtime errors', async () => {
      assert(!writes.length, 'Unexpected local writes blocked: ' + writes.join(', '));
      assert(!errors.length, 'Uncaught browser errors: ' + errors.join('; '));
    });
  } finally {
    await context.close();
    console.log(JSON.stringify(results, null, 2));
  }
  const failed = results.filter(r => r.status === 'FAIL');
  if (failed.length) throw new Error(failed.length + ' browser probe(s) failed: ' + JSON.stringify(results));
  return results;
}
