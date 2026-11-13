// Contact sheets for checking the story without rendering it all: frames at the given times, small, in one image.
//   node tools/preview.mjs 3 12.5 26 34 ...      writes out/preview.png (and out/preview-<t>.png for each frame)
//   node tools/preview.mjs --every 4             a frame every 4 seconds
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = new URL('../out/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const args = process.argv.slice(2);
const server = await serve(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 0.5 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${server.address().port}/src/`);
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
const dur = await page.evaluate(() => window.duration);
let times = args.filter((a) => !a.startsWith('--')).map(Number);
const ev = args.indexOf('--every');
if (ev >= 0) { times = []; for (let t = 0.5; t < dur; t += +args[ev + 1]) times.push(+t.toFixed(2)); }
for (const t of times) {
  const shot = await page.evaluate((t) => window.seek(t), t);
  await page.screenshot({ path: `${OUT}preview-${t}.png` });
  console.log(t, shot);
}
await browser.close();
server.close();
