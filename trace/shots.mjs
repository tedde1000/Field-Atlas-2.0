/* ===========================================================================
 * trace/shots.mjs — capture one PNG per chapter, plus a mobile pass.
 *
 * Serve first:  python3 -m http.server 8766 --directory "Field Atlas 2.0"
 * Then:         node trace/shots.mjs [outDir]
 *
 * Selectors are data-* / ids only (CONVENTIONS §10) — never rendered copy.
 * ======================================================================== */
import puppeteer from '/Users/theodor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.FA2_BASE || 'http://localhost:8766/';
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const OUT = process.argv[2] || path.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--window-size=1440,1000', '--force-device-scale-factor=1',
         '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
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
