// Sandbox browsers can drop proxied CDN connections under parallel load. Global
// setup downloads the app's pinned jsdelivr assets (and the woff2 files their CSS
// references) once with curl; contexts are then served the same bytes, so SRI still
// verifies. Anything not cached goes to the real network unchanged.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.wrangler/e2e-cdn-cache';
const CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/[^"' )<>]+/g;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const file = url => join(DIR, createHash('sha256').update(url).digest('hex'));
const type = url => TYPES[Object.keys(TYPES).find(ext => new URL(url).pathname.endsWith(ext))] || 'text/javascript';

function download(url) {
  if (existsSync(file(url))) return readFileSync(file(url));
  const body = execFileSync('curl', ['-sSfL', '--retry', '5', '--retry-all-errors', url], { maxBuffer: 1 << 26 });
  writeFileSync(file(url), body);
  return body;
}

export default function globalSetup() {
  mkdirSync(DIR, { recursive: true });
  const pages = readdirSync('public').filter(name => name.endsWith('.html')).map(name => readFileSync(join('public', name), 'utf8'));
  const urls = new Set(pages.flatMap(html => html.match(CDN) || []));
  for (const url of urls) {
    const body = download(url);
    if (!url.endsWith('.css')) continue;
    for (const [, ref] of body.toString().matchAll(/url\(([^)]+\.woff2)\)/g)) download(new URL(ref.replace(/["']/g, ''), url).href);
  }
}

export async function serveCachedCdn(context) {
  await context.route('https://cdn.jsdelivr.net/npm/**', route => {
    const url = route.request().url();
    if (!existsSync(file(url))) return route.continue();
    return route.fulfill({ status: 200, body: readFileSync(file(url)), headers: { 'content-type': type(url), 'access-control-allow-origin': '*' } });
  });
}
