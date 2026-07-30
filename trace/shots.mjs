/* ===========================================================================
 * trace/shots.mjs — capture one PNG per chapter, plus a mobile pass.
 *
 * Serve first:  python3 trace/serve.py
 * Then:         node trace/shots.mjs [outDir]
 *
 * Selectors are data-* / ids only (CONVENTIONS §10) — never rendered copy.
 *
 * The browser and puppeteer are found by trace/headless.mjs; FA2_CHROME,
 * FA2_PUPPETEER and FA2_BASE override the per-platform defaults.
 * ======================================================================== */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, loadPuppeteer, LAUNCH_ARGS } from './headless.mjs';

const puppeteer = await loadPuppeteer(import.meta.url);

const BASE = process.env.FA2_BASE || 'http://localhost:8766/';
/* fileURLToPath, not `new URL(...).pathname` — the latter yields "/C:/Users/…" on
   Windows, which path.join then treats as a rooted POSIX path */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: [...LAUNCH_ARGS, '--window-size=1440,1000', '--force-device-scale-factor=1'],
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shoot(name, { hash = '', vw = 1440, vh = 900, wait = 2600, then } = {}) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  // Every shot starts on the night side — the theme pill persists to localStorage,
  // and a leaked day-side setting silently poisons every later frame. This runs
  // before the page's own scripts, so there is still exactly ONE navigation:
  // visiting BASE first and then BASE+hash would be a same-document change, and
  // the deep link would never re-run.
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
  await sleep(wait);
  if (then) await then(page);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  await page.close();
  console.log(`  ${errs.length ? 'ERR ' : '  · '}${name.padEnd(20)}${errs.join(' | ')}`);
  return errs;
}

console.log('shots ->', OUT);
let bad = 0;
bad += (await shoot('00-overture')).length;
bad += (await shoot('01-mandate', { hash: '#mandate' })).length;
bad += (await shoot('02-season', { hash: '#season' })).length;
bad += (await shoot('02-entry-1', { hash: '#ev-rasbo-0' })).length;
bad += (await shoot('02-entry-gell', { hash: '#ev-gellerasen-0' })).length;
bad += (await shoot('02-entry-malmen', { hash: '#ev-malmen-0' })).length;
bad += (await shoot('03-anatomy', { hash: '#anatomy', wait: 4200 })).length;
bad += (await shoot('04-catalogue', { hash: '#catalogue' })).length;
bad += (await shoot('05-day', {
  then: async (p) => { await p.click('#pill-theme'); await sleep(900); },
})).length;
bad += (await shoot('06-mobile-hero', { vw: 390, vh: 844 })).length;
bad += (await shoot('07-mobile-season', { hash: '#ev-gellerasen-0', vw: 390, vh: 844 })).length;
bad += (await shoot('08-mid-scroll', {
  then: async (p) => { await p.evaluate(() => window.scrollTo(0, innerHeight * 0.55)); await sleep(700); },
})).length;

await browser.close();
console.log(bad ? `\n${bad} page error(s)` : '\nno page errors');
process.exit(bad ? 1 : 0);
