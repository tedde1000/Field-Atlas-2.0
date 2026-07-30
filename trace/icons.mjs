/* ===========================================================================
 * trace/icons.mjs — GENERATOR for icons/*.png
 *
 *     node trace/icons.mjs
 *
 * The launcher icon is the aperture mark from the `.brand` anchor in
 * index.html — the same two-path glyph, amber (--accent, #c9974f) on the page
 * background (--bg, #07080a). It is NOT 1.x's icon: source/icons/ holds the
 * turquoise instrument mark, which is 1.x's identity and reads as a different
 * app's icon sitting next to 2.0's amber. It also has no maskable variant,
 * which manifest.webmanifest requires.
 *
 * Rasterised by headless Chrome rather than a library, because the repo has no
 * dependencies and is not about to grow one for five PNGs. Chrome is found the
 * same way trace/verify.mjs finds it; override with FA2_CHROME.
 *
 * ★ maskable-512 is drawn SMALLER on purpose. Android crops a maskable icon to
 * whatever shape the launcher uses and only the centre 80% circle is guaranteed
 * to survive. The glyph is sized to sit inside that, so a circular launcher
 * cannot clip the aperture's edges off.
 * ======================================================================== */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'icons');

const BG     = '#07080a';   // assets/tokens.css --bg
const ACCENT = '#c9974f';   // assets/tokens.css --accent

function chrome() {
  if (process.env.FA2_CHROME) return process.env.FA2_CHROME;
  const home = process.env.LOCALAPPDATA || '';
  const cands = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    home && join(home, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = cands.find(p => existsSync(p));
  if (!hit) {
    console.error('no Chrome found — set FA2_CHROME to a Chrome/Chromium binary');
    process.exit(1);
  }
  return hit;
}

/* `scale` is the glyph's width as a fraction of the canvas. `pad` rounds the
   plate's corners for apple-touch, which iOS masks itself. */
function page(size, scale, stroke) {
  // The glyph's own viewBox is 24 wide; centre it and scale to `scale * size`.
  const box = size * scale;
  const off = (size - box) / 2;
  return `<!DOCTYPE html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${BG};overflow:hidden}
  svg{position:absolute;left:${off}px;top:${off}px;width:${box}px;height:${box}px}
</style>
<svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT}"
     stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1.6 12S6 5 12 5s10.4 7 10.4 7-4.4 7-10.4 7S1.6 12 1.6 12Z"></path>
  <circle cx="12" cy="12" r="3.1"></circle>
</svg>`;
}

/* size, filename, glyph fraction of the canvas, stroke width in viewBox units.
   Small sizes get a heavier stroke: 1.3 units at 32px is a third of a pixel. */
const JOBS = [
  [512, 'icon-512.png',        0.68, 1.30],
  [512, 'maskable-512.png',    0.50, 1.45],  // inside the 80% safe circle
  [192, 'icon-192.png',        0.68, 1.45],
  [180, 'apple-touch-icon.png', 0.68, 1.45],
  [ 32, 'favicon.png',         0.80, 2.40],
];

const BIN = chrome();
mkdirSync(OUT, { recursive: true });
const tmp = join(tmpdir(), 'fa2-icons');
mkdirSync(tmp, { recursive: true });

for (const [size, name, scale, stroke] of JOBS) {
  const html = join(tmp, name.replace('.png', '.html'));
  writeFileSync(html, page(size, scale, stroke), 'utf8');
  execFileSync(BIN, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${size},${size}`,
    `--screenshot=${join(OUT, name)}`,
    `--user-data-dir=${join(tmp, 'profile')}`,
    'file:///' + html.replace(/\\/g, '/'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`  icons/${name}  ${size}x${size}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log('done — 5 icons written to icons/');
