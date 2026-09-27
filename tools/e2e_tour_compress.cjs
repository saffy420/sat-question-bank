// Compresses the lessons-10 screenshot tour into docs/lessons/tour/ (palette PNGs).
// Run after `npx playwright test tests/e2e/lessons-10-e2e-regression/tour.spec.js`.
// sharp arrives through wrangler -> miniflare; it is not a direct dependency.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const from = path.join(__dirname, '..', '.omp/pipeline/lessons-10-e2e-regression/e2e/tour');
const to = path.join(__dirname, '..', 'docs/lessons/tour');

(async () => {
  const files = fs.readdirSync(from).filter(f => f.endsWith('.png')).sort();
  if (!files.length) throw new Error(`No tour screenshots in ${from}`);
  fs.mkdirSync(to, { recursive: true });
  for (const stale of fs.readdirSync(to).filter(f => f.endsWith('.png'))) fs.unlinkSync(path.join(to, stale));
  let before = 0, after = 0;
  for (const file of files) {
    const source = path.join(from, file), target = path.join(to, file);
    await sharp(source).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toFile(target);
    before += fs.statSync(source).size; after += fs.statSync(target).size;
  }
  console.log(`${files.length} screenshots: ${(before / 1024).toFixed(0)} KiB -> ${(after / 1024).toFixed(0)} KiB`);
})().catch(e => { console.error(e.message); process.exit(1); });
