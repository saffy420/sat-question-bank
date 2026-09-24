const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('data:text/html,chromium-ready');
    if (await page.textContent('body') !== 'chromium-ready') throw new Error('Page content mismatch');
    console.log(`Chromium launch/page/close PASS; browser version ${browser.version()}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
