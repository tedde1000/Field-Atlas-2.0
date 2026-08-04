/* ===========================================================================
 * trace/headless.mjs — find a browser and a puppeteer, on whatever machine this is.
 *
 * ★ BOTH OF THESE USED TO BE HARDCODED, IN TWO PLACES.
 *
 * verify.mjs and shots.mjs each opened with
 *
 *     import puppeteer from '/Users/theodor/node_modules/puppeteer-core/…'
 *     executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
 *
 * which meant the suite ran on exactly one laptop and threw MODULE_NOT_FOUND
 * anywhere else — so "148/148 green" was a claim that could only be checked from
 * that machine, and the repo's own definition of done could not be verified by
 * anyone who cloned it. Both are resolved per-platform now, with env overrides:
 *
 *     FA2_CHROME      path to a Chrome/Chromium binary
 *     FA2_PUPPETEER   path to puppeteer-core's ESM entry point
 *     FA2_BASE        where the site is served (default http://localhost:8766/)
 *
 * puppeteer-core is deliberately NOT a dependency of this repo — CONVENTIONS §1 is
 * that the site has no build step and no packages. It is a tool the test harness
 * borrows, so it is resolved from wherever it happens to be and named in an error
 * message when it is not there.
 * ======================================================================== */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const CHROMES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

/** the browser to drive, or exit(2) saying how to point at one */
export function findChrome() {
  if (process.env.FA2_CHROME) return process.env.FA2_CHROME;
  for (const p of (CHROMES[process.platform] || [])) if (p && existsSync(p)) return p;
  console.error('no Chrome found — set FA2_CHROME to a Chrome/Chromium binary');
  process.exit(2);
}

/** puppeteer-core, from FA2_PUPPETEER, node_modules, or the old hardcoded path */
export async function loadPuppeteer(fromUrl) {
  const tries = [];
  if (process.env.FA2_PUPPETEER) tries.push(process.env.FA2_PUPPETEER);
  const req = createRequire(fromUrl || import.meta.url);
  for (const spec of ['puppeteer-core', 'puppeteer']) {
    try { tries.push(req.resolve(spec + '/lib/esm/puppeteer/puppeteer-core.js')); } catch {}
    try { tries.push(req.resolve(spec)); } catch {}
  }
  tries.push('/Users/theodor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js');
  for (const t of tries) {
    try {
      const m = await import(t.startsWith('file:') ? t : pathToFileURL(t).href);
      return m.default || m;
    } catch {}
  }
  console.error('puppeteer-core not found — set FA2_PUPPETEER to its ESM entry point');
  process.exit(2);
}

/** the flags both scripts launch with, so a shot and a check render the same page */
export const LAUNCH_ARGS = [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  /* ★ --disable-gpu-compositing, AND THE SUITE DOES NOT FINISH WITHOUT IT.
   *
   * On Chrome 150 the GPU process dies partway through a run and takes the
   * browser with it: every newPage() after that fails with `Protocol error
   * (Target.createTarget): Session with given id not found`, which reads like a
   * puppeteer fault and is not one. Reproduced with nothing but open-page,
   * wait, close-page in a loop — no assertions, no scrolling, and against the
   * page as it stood several sessions ago, so it is neither this work nor any
   * other. It dies on the eighth page, every time, after logging
   * `SharedImageManager::ProduceSkia: Trying to Produce a Skia representation
   * from a non-existent mailbox` on each of the preceding closes.
   *
   * verify.mjs opens fourteen pages, so it was failing at §10e with four
   * sections unrun — silently amber rather than red, because what it printed
   * was a stack trace and not a FAIL.
   *
   * The mailbox in that message is a shared GPU texture handed to the
   * compositor, so taking the compositor off the GPU is what removes the
   * object being mishandled. Swiftshader stays for everything else, which
   * matters: the flags here have to render the same page shots.mjs captures.
   * Measured with it: 18 pages of 18, and `data-raster` unchanged at 786.
   * `--disable-gpu` also survives; this is the smaller hammer. */
  '--disable-gpu',
];
