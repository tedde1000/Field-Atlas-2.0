/* ===========================================================================
 * trace/shots-globe.mjs — the globe on its own, at the sizes where artifacts
 * become visible.
 *
 * Session 2. Theodor says the globe "needs to look like a big globe" and that
 * there are visual bugs, without naming them. This exists so we look at the
 * same pixels instead of guessing: one full frame and one tight crop of the
 * disc at each viewport, night and day.
 *
 * Serve first:  python3 -m http.server 8766 --directory "Field Atlas 2.0"
 * Then:         node trace/shots-globe.mjs   ->  trace/shots/globe/*.png
 * ======================================================================== */
import puppeteer from '/Users/theodor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const OUT = path.join(HERE, 'shots', 'globe');
const BASE = process.env.FA2_BASE || 'http://localhost:8766/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/* The short-and-wide case is the interesting one: #globe-wrap is 88vmin, so at
   1600x700 vmin is height-driven and the globe shrinks to ~616px on a 1600px
   page. If "big" means big, that sizing is the likely complaint. */
const VIEWPORTS = [
  ['1440x900', 1440, 900],
  ['1920x1080', 1920, 1080],
  ['2560x1440', 2560, 1440],
  ['1600x700-wide-short', 1600, 700],
];

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

console.log('globe frames ->', OUT);
const errs = [];

for (const [label, w, h] of VIEWPORTS) {
  for (const theme of ['night', 'day']) {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push(`${label}/${theme}: ${e}`));
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    // seed the theme before boot rather than clicking the pill afterwards, so
    // the cached globe layers are built for the right palette from the start
    await page.evaluateOnNewDocument((t) => {
      try { localStorage.clear(); localStorage.setItem('fa2.theme', t); } catch {}
    }, theme);
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await sleep(2200);

    const name = `${label}-${theme}`;
    await page.screenshot({ path: path.join(OUT, `${name}-full.png`) });

    // tight crop on the disc, clipped to whatever of it is actually on screen
    const box = await page.evaluate(() => {
      const r = document.getElementById('globe').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const clip = {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.round(Math.min(box.w, w - Math.max(0, box.x))),
      height: Math.round(Math.min(box.h, h - Math.max(0, box.y))),
    };
    if (clip.width > 8 && clip.height > 8) {
      await page.screenshot({ path: path.join(OUT, `${name}-crop.png`), clip });
    }
    console.log(`    · ${name.padEnd(26)} disc ${Math.round(box.w)}px, ${clip.width}x${clip.height} visible`);
    await page.close();
  }
}

await browser.close();
console.log(errs.length ? '\nPAGE ERRORS:\n' + errs.join('\n') : '\nno page errors');
