/* ===========================================================================
 * trace/verify.mjs — headless smoke test (CONVENTIONS §10).
 *
 * Serve first:  python3 trace/serve.py
 * Then:         node trace/verify.mjs
 *
 * Selectors are ids and data-* attributes only — never rendered copy, so
 * rewording the page can never break the suite.
 *
 * The browser and puppeteer are found by trace/headless.mjs — see the note there.
 * Neither path is hardcoded to one laptop any more; FA2_CHROME, FA2_PUPPETEER and
 * FA2_BASE override the per-platform defaults.
 * ======================================================================== */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { findChrome, loadPuppeteer, LAUNCH_ARGS } from './headless.mjs';

const puppeteer = await loadPuppeteer(import.meta.url);

/* fileURLToPath, not `new URL(...).pathname` — on Windows the latter yields
   "/C:/Users/…", which path.join then treats as a rooted POSIX path and every
   readFileSync below fails with ENOENT */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FA2_BASE || 'http://localhost:8766/';

/* read the generated data straight off disk so the page is checked against
   its own source of truth, not against numbers retyped into this file */
const atlas = readFileSync(path.join(HERE, '..', 'data', 'atlas.js'), 'utf8');
/* `;\r?\n`, not `;\n` — git checks this repo out with CRLF on Windows, and the
   bare \n form matched nothing there, so the suite died on line one with a null
   dereference before it had opened a browser */
const grab = (name) => {
  const m = atlas.match(new RegExp(`export const ${name} = ([\\s\\S]*?);\\r?\\n`));
  if (!m) { console.error(`data/atlas.js has no "export const ${name}"`); process.exit(2); }
  return JSON.parse(m[1]);
};
const VENUES = grab('VENUES'), TRACKS = grab('TRACKS');
const EVENT_COUNT = VENUES.reduce((n, v) => n + v.events.length, 0);

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: LAUNCH_ARGS,
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param seed  array of [key, value] pairs written to localStorage BEFORE the
 *              page's scripts run. §9 uses it to stand in for Field Atlas 1.x,
 *              which cannot be reached from here: 1.x on :8765 and 2.0 on :8766
 *              are different origins, so the storage they genuinely share in
 *              production does not exist on localhost. Seeding by hand is the
 *              only way to exercise the shared-storage path locally.
 */
async function open(hash = '', vw = 1440, vh = 900, seed = null) {
  const page = await browser.newPage();
  page.__errs = [];
  page.on('pageerror', e => page.__errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.__errs.push(m.text()); });
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  // clear before the page's scripts run, so BASE+hash is the only navigation —
  // visiting BASE first would make the hash a same-document change
  await page.evaluateOnNewDocument((s) => {
    try {
      localStorage.clear();
      if (s) for (const [k, v] of s) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' });
  await sleep(1600);
  return page;
}

/* ------------------------------------------------------------ 1. it boots */
console.log('\n1 · boot + structure');
let p = await open();
ok(p.__errs.filter(e => !/favicon/i.test(e)).length === 0, 'no page errors', p.__errs.join(' | '));
ok(await p.$eval('body', b => b.classList.contains('lit')), 'boot completed (body.lit)');

const counts = await p.evaluate(() => ({
  entries: document.querySelectorAll('.entry').length,
  chips: document.querySelectorAll('.chip').length,
  cat: document.querySelectorAll('#catalogue-grid .cat-cell').length,
  readouts: document.querySelectorAll('.readout').length,
  pick: document.querySelectorAll('#circuit-pick button').length,
  titleChars: document.querySelectorAll('.hero-title .ch').length,
}));
ok(counts.entries === EVENT_COUNT, `${EVENT_COUNT} entries rendered`, JSON.stringify(counts));
ok(counts.chips === EVENT_COUNT, `${EVENT_COUNT} chips rendered`, String(counts.chips));
ok(counts.cat === TRACKS.length, `${TRACKS.length} catalogue cells`, String(counts.cat));
ok(counts.readouts === 3, '3 hero readouts', String(counts.readouts));
ok(counts.pick > 10, 'circuit picker populated', String(counts.pick));
ok(counts.titleChars === 10, 'title split into characters', String(counts.titleChars));

/* --------------------------------------------- 2. the numbers are the data */
console.log('\n2 · page numbers match data/atlas.js');
const gell = VENUES.find(v => v.id === 'gellerasen');
const shown = await p.evaluate(() => {
  const e = document.getElementById('ev-gellerasen-0');
  const rows = {};
  e.querySelectorAll('.spec .row').forEach(r => {
    rows[r.querySelector('.k').textContent.trim()] = r.querySelector('.v').textContent.trim();
  });
  return rows;
});
const digits = (s) => (s || '').replace(/[^\d]/g, '');
ok(digits(shown['LAP']) === String(gell.track.lengthM), 'Gelleråsen lap length', `${shown['LAP']} vs ${gell.track.lengthM}`);
ok(digits(shown['CORNERS']) === String(gell.track.corners), 'Gelleråsen corner count', `${shown['CORNERS']} vs ${gell.track.corners}`);
ok(digits(shown['LONGEST STRAIGHT']) === String(gell.track.straightM), 'Gelleråsen longest straight', shown['LONGEST STRAIGHT']);
ok(/59\.3824/.test(shown['COORDINATES']), 'Gelleråsen coordinates', shown['COORDINATES']);

const est = await p.evaluate(() =>
  [...document.getElementById('ev-linkoping-0').querySelectorAll('.spec .v')].some(v => /est\./.test(v.textContent)));
ok(est, 'Linköping length is flagged as an estimate');

/* ------------------------------------------------------- 3. the countdown */
console.log('\n3 · countdown');
/* scoped per section: §01's roster and §02's entries each carry one countdown
   per date, so a bare [data-cd] sweep counts every date twice */
const cd = await p.evaluate(() => ({
  hero: document.getElementById('readout-next').textContent.trim(),
  perEntry: [...document.querySelectorAll('.entry [data-cd]')].map(n => n.textContent.trim()),
  perRoster: [...document.querySelectorAll('#roster [data-cd]')].map(n => n.textContent.trim()),
}));
ok(/^(T−|IN PROGRESS|SEASON CLOSED)/.test(cd.hero), 'hero shows a live countdown', cd.hero);
ok(cd.perEntry.length === EVENT_COUNT, 'every entry carries a countdown', String(cd.perEntry.length));
ok(cd.perRoster.length === EVENT_COUNT, '§01 lists every date, with a countdown each', String(cd.perRoster.length));
ok([...cd.perEntry, ...cd.perRoster].every(t => /^(T−|COMPLETE|IN PROGRESS)/.test(t)),
   'countdown states are legal', cd.perEntry.concat(cd.perRoster).join(','));
/* Poll for a change rather than sampling once after a fixed wait. The readout
   is driven by setInterval(tick, 1000), and a 1.4s deadline is not something a
   loaded machine owes you — under a saturated main thread (three canvases on a
   software rasteriser) the callback coalesces and slips, which failed this
   check intermittently on a countdown that was ticking perfectly well. What
   matters is that it advances, not that it advances by a stopwatch. */
const before = cd.hero;
let after = before;
for (let i = 0; i < 30 && after === before; i++) {
  await sleep(200);
  after = await p.$eval('#readout-next', n => n.textContent.trim());
}
ok(before !== after || /COMPLETE|CLOSED/.test(after), 'countdown is ticking', `${before} -> ${after}`);

/* --------------------------------------------------------- 4. the two pills */
console.log('\n4 · pills');
await p.click('#pill-theme'); await sleep(400);
ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'day', 'theme pill -> day side');
ok(await p.evaluate(() => localStorage.getItem('fa2.theme')) === 'day', 'theme persists to localStorage');
await p.click('#pill-theme'); await sleep(300);
ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'night', 'theme pill -> night side');
await p.click('#pill-motion'); await sleep(300);
ok(await p.$eval('body', b => b.classList.contains('no-motion')), 'motion pill stops motion');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('.hero-title .ch')).opacity) === '1',
   'title stays legible with motion off');
await p.close();

/* ----------------------------------------------------- 5. deep links + scroll */
console.log('\n5 · deep links and scroll state');
p = await open('#ev-gellerasen-0');
const deep = await p.evaluate(() => {
  const r = document.getElementById('ev-gellerasen-0').getBoundingClientRect();
  return { top: Math.round(r.top), y: Math.round(scrollY), chapter: document.getElementById('chapter-label').textContent };
});
ok(deep.y > 100 && Math.abs(deep.top) < 160, 'deep link lands on the entry', JSON.stringify(deep));
ok(/THE SEASON/.test(deep.chapter), 'chapter readout follows the scroll', deep.chapter);
ok(await p.evaluate(() => document.querySelector('.chip[aria-current="true"]')?.dataset.key === 'gellerasen:0'),
   'the matching chip is marked current');
ok(await p.$eval('#ev-gellerasen-0', e => e.classList.contains('is-in')), 'the entry revealed');
ok(await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('progress')).transform.split(',')[0].replace('matrix(', '')) > 0.05),
   'progress bar advanced');
await p.close();

/* -------------------------------------------------------- 6. no side scroll */
console.log('\n6 · layout holds at every width');
for (const [w, h, label] of [[390, 844, 'mobile'], [768, 1024, 'tablet'], [1440, 900, 'desktop'], [1920, 1080, 'wide']]) {
  const q = await open('', w, h);
  const over = await q.evaluate(() => {
    const win = window.innerWidth;
    // name the widest thing that pokes out, so the cause gets fixed not hidden
    const worst = [...document.querySelectorAll('body *')]
      .map(e => ({ r: Math.round(e.getBoundingClientRect().right), e }))
      .filter(x => x.r > win + 1)
      .sort((a, b) => b.r - a.r)
      .slice(0, 3)
      .map(x => `${x.e.tagName.toLowerCase()}${x.e.id ? '#' + x.e.id : ''}` +
                `${x.e.className && typeof x.e.className === 'string' ? '.' + x.e.className.trim().split(/\s+/)[0] : ''}` +
                `@${x.r}`);
    return { doc: document.documentElement.scrollWidth, win, worst };
  });
  ok(over.doc <= over.win + 1, `${label} ${w}px — no horizontal overflow`, JSON.stringify(over));
  await q.close();
}

/* ------------------------------------------- 7. the page does not fight the scroll
 * Session 2. The §02 entry observer used to end with
 *   chip.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'})
 * and .chips is a sticky, horizontally scrollable bar — scrollIntoView walks EVERY
 * scrollable ancestor including the document, so centring a chip dragged the page
 * vertically, which re-fired the observer, which centred the next chip. Measured
 * with the bug in: −759px of drift in 1.5s on 3 scroll events the reader did not
 * cause, and 8 of 26 wheel notches going backwards by −520 to −780px.
 * Both checks below failed then and pass now. Do not delete them: anything new
 * added to that observer can reintroduce this. */
console.log('\n7 · scroll integrity in §02');
p = await open();

// land partway into §02 and give the observer a beat to do its worst
await p.evaluate(() => {
  const s = document.getElementById('season');
  window.scrollTo({ top: window.scrollY + s.getBoundingClientRect().top + 900, behavior: 'instant' });
});
await sleep(350);

const idle = await p.evaluate(async () => {
  const y0 = window.scrollY;
  let events = 0;
  const h = () => events++;
  window.addEventListener('scroll', h, { passive: true });
  await new Promise(r => setTimeout(r, 1500));
  window.removeEventListener('scroll', h);
  return { drift: Math.round(window.scrollY - y0), events };
});
ok(Math.abs(idle.drift) < 4, 'sitting still in §02 does not move the page', JSON.stringify(idle));

/* Real wheel events, not window.scrollBy: html{scroll-behavior:smooth} animates
   programmatic scrolls, which would measure the harness instead of the page.
   Sample only once scrollY has been still for 3 frames, or one notch's delta
   lands in the next sample and reads as a phantom 0/520 pair. */
const settle = () => p.evaluate(() => new Promise(res => {
  let last = -1, still = 0, n = 0;
  const step = () => {
    const y = window.scrollY;
    still = (y === last) ? still + 1 : 0;
    last = y;
    if (still >= 3 || ++n > 60) res(Math.round(y)); else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));

await p.mouse.move(720, 500);
const notches = [];
let prev = await settle();
for (let i = 0; i < 26; i++) {
  await p.mouse.wheel({ deltaY: 260 });
  const now = await settle();
  notches.push(now - prev);
  prev = now;
}
const offTarget = notches.filter(d => Math.abs(d - 260) > 30);
const backwards = notches.filter(d => d <= 0);
ok(offTarget.length === 0, 'every 260px notch moves ≈260px', `${offTarget.length}/26 off: ${JSON.stringify(offTarget)}`);
ok(backwards.length === 0, 'no notch loses ground', `${backwards.length}/26: ${JSON.stringify(notches)}`);
await p.close();

/* --------------------------------------------------- 8. repaint discipline
 * Session 2. Every position on the page measured 5–6 fps before this work.
 *
 * ★ THIS SECTION USED TO MEASURE FRAME RATE, AND THAT WAS THE WRONG INSTRUMENT.
 * Headless Chrome here runs on swiftshader — a SOFTWARE rasteriser — so an fps
 * number measures how fast a CPU can fill pixels, which is not a thing that
 * ships: Theodor's Mac and phone raster on the GPU. Worse, it was not even
 * stable. On identical code, at the same viewport, minutes apart, this suite
 * measured the hero at 14 fps and at 28 fps, and §02 at 10 fps and at 150 fps.
 * A check that fails at random is worse than no check, because it teaches you
 * to ignore a red run.
 *
 * What actually caused the 5 fps was never raster throughput — it was three
 * canvases repainting sixty times a second when they had no reason to. So that
 * is what is asserted now: each canvas publishes a paint counter as data-paints,
 * and these checks read the RATE off it. That number is set by the code's own
 * budgets, not by the host's graphics stack, so it is identical on a loaded
 * laptop and a quiet one — and it fails the moment someone raises a repaint
 * rate in globe.js, starfield.js or circuit.js, which is the regression the
 * original floor was written to catch.
 */
console.log('\n8 · repaint discipline (rates, not frame rate — see comment)');
p = await open();

/** paints/second for one canvas over `ms`, measured in the page */
const rateOf = async (sel, ms = 1600) => p.evaluate(async (s, d) => {
  const el = document.querySelector(s);
  const a = +(el.dataset.paints || 0), t0 = performance.now();
  await new Promise(r => setTimeout(r, d));
  const b = +(el.dataset.paints || 0);
  return (b - a) / ((performance.now() - t0) / 1000);
}, sel, ms);

const goTo = async (id, offset) => {
  await p.evaluate((i, o) => {
    const s = document.getElementById(i);
    window.scrollTo({ top: window.scrollY + s.getBoundingClientRect().top + o, behavior: 'instant' });
  }, id, offset);
  await sleep(900);
};

/* -- at the hero the globe is the subject: 30 Hz, and NOT 60 -- */
await goTo('overture', 0);
/* ★ A CEILING, NOT A FLOOR. rAF itself is rate-limited by the software
   rasteriser here, so a canvas cannot always reach its own budget and an
   achieved-rate floor would be just as flaky as the fps floors this replaced.
   The budget is a promise never to paint MORE than this, and that is the half
   that is both meaningful and stable. */
const gHero = await rateOf('#globe');
ok(gHero <= 38, 'globe never exceeds its 30 Hz hero budget', `${gHero.toFixed(1)} Hz`);
ok(gHero > 0, 'the globe is actually painting at the hero', `${gHero.toFixed(1)} Hz`);

/* -- past the hero it is at ~0.14 opacity behind the scrim: 8 Hz -- */
await goTo('season', 200);
const gSeason = await rateOf('#globe');
ok(gSeason <= 14, 'globe drops to its dimmed budget past the hero', `${gSeason.toFixed(1)} Hz`);
ok(gSeason < gHero + 1, 'the dimmed globe never repaints faster than the hero globe',
  `${gSeason.toFixed(1)} vs ${gHero.toFixed(1)} Hz`);

/* -- ★ the §03 figure must be IDLE while it is nowhere near the viewport.
      This is the one that regressed to 5 fps: 900 particles integrating behind
      four screens of type nobody was looking at. -- */
await goTo('overture', 0);
const cAway = await rateOf('#flow');
ok(cAway < 2, '★ the §03 figure is gated off while off-screen', `${cAway.toFixed(1)} Hz`);

/* -- and alive again once it is on screen, or the gate is just a bug -- */
await goTo('anatomy', 200);
const cNear = await rateOf('#flow');
ok(cNear > 0 && cNear <= 38, 'the §03 figure runs when it is actually visible, within budget',
  `${cNear.toFixed(1)} Hz`);
ok(cNear > cAway, 'the figure paints strictly more on screen than off it',
  `${cNear.toFixed(1)} vs ${cAway.toFixed(1)} Hz`);

/* -- the starfield only repaints when it has something new to show -- */
const stars = await rateOf('#stars');
ok(stars <= 34, 'the starfield stays within its repaint budget', `${stars.toFixed(1)} Hz`);

/* -- with MOTION off the page must go genuinely still, not quietly keep drawing -- */
await p.click('#pill-motion');
await sleep(700);
const stillGlobe = await rateOf('#globe', 1400);
const stillStars = await rateOf('#stars', 1400);
ok(stillGlobe < 2 && stillStars < 2, 'MOTION off actually stops the canvases',
  `globe ${stillGlobe.toFixed(1)} Hz, stars ${stillStars.toFixed(1)} Hz`);
await p.close();

/* ------------------------------------------------------ 9. the detail panel
 * Session 2, Task 3. §02 entries and §04 cells open a full-screen panel that
 * carries the day plan and the packing list.
 *
 * The accessibility checks here are not decoration. A modal that does not move
 * focus in, trap it, and hand it back leaves a keyboard or screen-reader user
 * stranded at the top of a very long document with no idea where they were —
 * and that failure is invisible to anyone testing with a mouse, which is why
 * it has to be a test rather than a habit.
 *
 * ★ The gear checks seed evhub.* by hand. In production 1.x and 2.0 share
 * localStorage because both are served from https://tedde1000.github.io and
 * localStorage is scoped to an ORIGIN, not a path. On localhost they are :8765
 * and :8766 — different origins, no sharing. So the shared path cannot be
 * observed here; it can only be simulated. Do not "fix" the sharing code
 * because it looks dead locally.
 */
console.log('\n9 · the detail panel');

/* the two key shapes that must not be conflated: 2.0 keys an event by its
   position within the venue, 1.x by its timestamp. Rörken hosts two dates, so
   these genuinely differ and mapping through Date.parse is not optional. */
const EV = [];
for (const v of VENUES) {
  v.events.forEach((e, i) => EV.push({
    key2: `${v.id}:${i}`,                     // 2.0  — gellerasen:0
    key1: `${v.id}:${Date.parse(e.iso)}`,     // 1.x  — gellerasen:1765609200000
  }));
}

p = await open();

/* -- 9a · a §04 catalogue cell opens it, and the URL follows -- */
const cell = await p.evaluate(async () => {
  const c = document.querySelector('#catalogue-grid .cat-cell');
  const route = c.dataset.route;
  c.click();
  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('panel');
  return {
    route,
    open: panel.classList.contains('is-open') && panel.hidden === false,
    hash: decodeURIComponent(location.hash.slice(1)),
    focusInside: panel.contains(document.activeElement),
    rendered: !!document.querySelector('#panel-body .p-head'),
    // both, not just body — <html> is the scroller and is the one that matters
    locked: document.documentElement.classList.contains('is-locked')
         && document.body.classList.contains('is-locked'),
  };
});
ok(cell.open, 'catalogue cell opens the panel', JSON.stringify(cell));
ok(cell.rendered, 'the circuit panel rendered a head');
ok(cell.hash === cell.route, 'the hash matches the route', `${cell.hash} vs ${cell.route}`);
ok(cell.focusInside, 'focus moved into the panel');
ok(cell.locked, 'body.is-locked applied');

/* -- 9b · the page behind must not scroll while it is open -- */
await p.mouse.move(720, 500);
const bgScroll = await p.evaluate(() => window.scrollY);
for (let i = 0; i < 4; i++) await p.mouse.wheel({ deltaY: 260 });
await sleep(320);
const bgAfter = await p.evaluate(() => window.scrollY);
ok(Math.abs(bgAfter - bgScroll) < 4, 'the background does not scroll while the panel is open',
  `moved ${bgAfter - bgScroll}px`);

/* -- 9c · Escape closes it and focus goes back to what opened it -- */
await p.keyboard.press('Escape');
await sleep(420);
const closed = await p.evaluate(() => ({
  open: document.getElementById('panel').classList.contains('is-open'),
  onTrigger: document.activeElement?.classList.contains('cat-cell'),
  locked: document.documentElement.classList.contains('is-locked')
       || document.body.classList.contains('is-locked'),
  hash: location.hash,
}));
ok(!closed.open, 'Escape closes the panel');
ok(closed.onTrigger, 'focus returned to the catalogue cell that opened it');
ok(!closed.locked, 'body.is-locked released on close');
ok(closed.hash === '' || closed.hash === '#', 'closing clears the hash', closed.hash);

/* -- 9d · a §02 entry opens it too, and the whole entry is the target -- */
const entry = await p.evaluate(async () => {
  const e = document.querySelector('#entries .entry');
  // click the entry body, NOT the button — the brief asks for the whole entry
  // to be a target rather than a small link to hunt for
  e.querySelector('.entry-where').click();
  await new Promise(r => setTimeout(r, 300));
  return {
    key: e.dataset.key,
    open: document.getElementById('panel').classList.contains('is-open'),
    hash: decodeURIComponent(location.hash.slice(1)),
    hasPlan: !!document.querySelector('#panel-body .p-sched, #panel-body .p-sec'),
  };
});
ok(entry.open, 'clicking the entry body opens the panel', JSON.stringify(entry));
ok(entry.hash === 'date/' + entry.key, 'the entry route round-trips through the hash',
  `${entry.hash} vs date/${entry.key}`);
ok(entry.hasPlan, 'the date panel rendered its sections');

/* -- 9e · empty storage renders a real state instead of throwing --
   this page was opened with localStorage cleared, so there is no evhub.* at
   all: the fresh-browser case. It must say so and link out to 1.x. */
const empty = await p.evaluate(() => {
  const g = document.getElementById('p-gear');
  return {
    present: !!g,
    empty: !!g?.querySelector('.p-empty'),
    linksOut: !!g?.querySelector('.p-out[href*="Field-Atlas"]'),
    items: g?.querySelectorAll('.p-item').length ?? -1,
  };
});
ok(empty.present, 'the packing list section rendered with no gear data');
ok(empty.empty && empty.linksOut, 'empty storage explains itself and links to 1.x',
  JSON.stringify(empty));
ok(empty.items === 0, 'no gear rows are invented out of an absent inventory');
ok(p.__errs.filter(e => !/favicon/i.test(e)).length === 0,
  'the panel raised no page errors', p.__errs.join(' | '));
await p.close();

/* -- 9f · with 1.x's data present, the real list shows --
   the exact FA.store wrapper shape: {__v, data}, version respected not assumed */
const INV = [
  { id: 'g1', name: 'R5 body',      category: 'Bodies',      status: 'owned',  defaultQty: 1 },
  { id: 'g2', name: '100-500',      category: 'Lenses',      status: 'rental', defaultQty: 1 },
  { id: 'g3', name: 'Spare batts',  category: 'Power & Storage', status: 'owned', defaultQty: 4 },
];
const seedKey = EV[0].key1;
const SEED = [
  ['evhub.gear.inventory', JSON.stringify({ __v: 1, data: INV })],
  ['evhub.bring.' + seedKey, JSON.stringify({ __v: 1, data: { g1: { qty: 1 }, g3: { qty: 4 } } })],
];
p = await open('#date/' + EV[0].key2, 1440, 900, SEED);

const seeded = await p.evaluate(() => {
  const g = document.getElementById('p-gear');
  return {
    open: document.getElementById('panel').classList.contains('is-open'),
    rows: g?.querySelectorAll('.p-item').length ?? -1,
    on: g?.querySelectorAll('.p-item.on').length ?? -1,
    rental: !!g?.querySelector('.p-item .tag'),
  };
});
ok(seeded.open, 'a cold deep link straight into a date panel opens it', JSON.stringify(seeded));
ok(seeded.rows === INV.length, `all ${INV.length} inventory items render`, `got ${seeded.rows}`);
ok(seeded.on === 2, "1.x's picks for this date are ticked", `got ${seeded.on}`);
ok(seeded.rental, 'rental status carries through from the 1.x inventory');

/* -- 9g · ★ 2.0 READS evhub.*, AND NEVER WRITES IT --
   this is the assertion js/gear.js points at. 1.x owns those keys; a 2.0 that
   reshapes or truncates them destroys the gear list Theodor actually maintains,
   and localStorage has no undo. Ticking must land under fa2. and nowhere else. */
const evhubBefore = await p.evaluate(() =>
  Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('evhub.'))));

await p.evaluate(async () => {
  document.querySelector('#p-gear .p-item:not(.on)')?.click();   // tick one on
  await new Promise(r => setTimeout(r, 120));
  document.querySelector('#p-gear .p-item.on')?.click();         // and one off
  await new Promise(r => setTimeout(r, 120));
});

const evhubAfter = await p.evaluate(() => ({
  evhub: Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('evhub.'))),
  fa2: Object.keys(localStorage).filter(k => k.startsWith('fa2.bring.')),
}));
ok(JSON.stringify(evhubBefore) === JSON.stringify(evhubAfter.evhub),
  '★ ticking gear does not touch evhub.* — 1.x owns those keys',
  `before ${JSON.stringify(evhubBefore)} after ${JSON.stringify(evhubAfter.evhub)}`);
ok(evhubAfter.fa2.length === 1 && evhubAfter.fa2[0] === 'fa2.bring.' + seedKey,
  "2.0's own ticks are stored under fa2. keyed the 1.x way",
  JSON.stringify(evhubAfter.fa2));
ok(await p.evaluate(() => !!document.getElementById('p-gear')),
  'the panel survived a gear tick and re-render');
await p.close();

/* -- 9h · a hash naming something that does not exist must not open a panel -- */
p = await open('#circuit/not-a-real-circuit');
const bogus = await p.evaluate(() => ({
  open: document.getElementById('panel').classList.contains('is-open'),
  hash: location.hash,
}));
ok(!bogus.open, 'an unknown route does not open an empty panel');
ok(bogus.hash === '' || bogus.hash === '#', 'an unknown route does not leave a dead hash', bogus.hash);
ok(p.__errs.filter(e => !/favicon/i.test(e)).length === 0,
  'an unknown route raises no page errors', p.__errs.join(' | '));
await p.close();

/* =========================================================================
 * 10 · SESSION 3 — the four things that shipped broken, and why none of these
 *      checks could be written as "does it look right".
 *
 * Every fault below passed §1–§9 while it was live. The panel opened, routed,
 * locked the scroll, trapped focus and closed again — with its card 11 169px
 * below the viewport, because it had no CSS. The arrow was clickable, labelled
 * and keyboard-reachable — at 372px square. So these assert RENDERED GEOMETRY,
 * which is the layer the rest of the suite does not look at.
 * ====================================================================== */
console.log('\n10 · rendered geometry (session 3)');

p = await open('', 1440, 900);

/* -- 10a · ★ THE PANEL HAS TO BE ON SCREEN --------------------------------
   The bug: .panel/.panel-card/.panel-scrim/.panel-body and all twenty .p-*
   classes had no rule in app.css, so dropping `hidden` put an unstyled block
   in normal flow at the end of a 13 475px document. Theodor: "when you press
   the arrow, nothing happens." §9 already proves it OPENS; this proves it is
   somewhere a reader can see. */
await p.evaluate(() => {
  const b = document.querySelector('.entry-open');
  window.scrollTo(0, window.scrollY + b.getBoundingClientRect().top - 300);
});
await sleep(700);
await p.evaluate(() => document.querySelector('.entry-open').click());
await sleep(700);

const card = await p.evaluate(() => {
  const c = document.querySelector('.panel-card');
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector('.panel'));
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    w: Math.round(r.width), h: Math.round(r.height),
    position: cs.position, vh: window.innerHeight,
    // is the card the thing you actually hit in the middle of the screen?
    hitsCard: !!document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      ?.closest('.panel-card'),
  };
});
ok(card.position === 'fixed', '★ the panel is fixed to the viewport, not parked in the document flow', card.position);
ok(card.top > -4 && card.top < card.vh, '★ the open panel card is on screen', JSON.stringify(card));
ok(card.h > 200 && card.h <= card.vh, 'the card is sized to the viewport', `${card.h}px in ${card.vh}px`);
ok(card.hitsCard, '★ the middle of the screen is the panel, not the page behind it');

/* -- 10b · the close control is a control, not a full-page graphic -- */
const closeBox = await p.evaluate(() => {
  const s = document.querySelector('.panel-close svg').getBoundingClientRect();
  return [Math.round(s.width), Math.round(s.height)];
});
ok(closeBox[0] > 0 && closeBox[0] <= 40 && closeBox[1] <= 40,
  'the panel close icon is icon-sized', closeBox.join('x'));
await p.evaluate(() => document.querySelector('.panel-close').click());
await sleep(500);

/* -- 10c · ★ AN INLINE <svg> WITH ONLY A viewBox INFLATES TO FILL ITS BOX ---
   That is the whole of the "big arrow": `.entry-open` had no CSS, the icon had
   no width/height attribute, and the result was a 372px arrow in a 388x395
   default grey button. This is a trap any new inline icon can fall into, so
   the check is written against EVERY icon on the page, not just this one. */
const icons = await p.evaluate(() => [...document.querySelectorAll('button svg, a svg')]
  // .shape / .thumb / .p-shape are the track drawings — figures, deliberately
  // large, and sized by their own rules. Everything else in a control is an icon.
  .filter(s => !s.closest('.shape, .thumb, .p-shape'))
  .map(s => {
    const r = s.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             owner: (s.closest('button, a')?.className || '').toString().split(' ')[0] || '?' };
  })
  .filter(i => i.w > 0));
const fat = icons.filter(i => i.w > 48 || i.h > 48);
ok(icons.length > 0, 'there are inline icons to check', String(icons.length));
ok(fat.length === 0, '★ no inline icon has inflated past 48px', JSON.stringify(fat));

const openBtn = await p.evaluate(() => {
  const b = document.querySelector('.entry-open');
  const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  return { h: Math.round(r.height), bg: cs.backgroundColor, cursor: cs.cursor,
           border: cs.borderTopStyle + '/' + cs.borderRightStyle };
});
ok(openBtn.h < 90, 'the open control is a row, not a panel', `${openBtn.h}px tall`);
ok(/rgba\(0, 0, 0, 0\)|transparent/.test(openBtn.bg),
  'the open control is not wearing default button chrome', openBtn.bg);
ok(openBtn.cursor === 'pointer', 'the open control looks pressable', openBtn.cursor);

/* -- 10d · ★ EVERY TRACK LAYOUT DRAWS ITS WHOLE LAP -----------------------
   Theodor: "almost all track layouts have this little cut on the streets …
   the circuits are not full." thumbSvg() summed the perimeter over i = 1…n-1,
   missing the segment Z adds, so stroke-dasharray came up short and the
   shortfall rendered as a gap on the start/finish line: 0.6% of the lap at
   Gelleråsen, 7.4% at Linköping. Compare the DECLARED dash against the path
   length the browser measures — the only reading that cannot be argued with. */
await p.evaluate(async () => {
  for (let y = 0; y <= 4600; y += 300) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
});
await sleep(2400);
const dashes = await p.evaluate(() => [...document.querySelectorAll('.thumb path.line')].map(el => ({
  id: el.closest('.entry')?.dataset.key || '?',
  declared: parseFloat(getComputedStyle(el).getPropertyValue('--len')),
  actual: +el.getTotalLength().toFixed(1),
})));
ok(dashes.length > 0, 'there are traced thumbnails to check', String(dashes.length));
const short = dashes.filter(d => !(d.declared >= d.actual));
ok(short.length === 0,
  '★ every layout dashes its full lap — no cut on the start/finish line',
  JSON.stringify(short));

/* the loops are smooth curves now, not 33-sided polygons: a polyline path
   carries no C command at all, so this is a one-character tell */
const curved = await p.evaluate(() => [...document.querySelectorAll('.thumb path.line, .cat-cell .shape.traced path')]
  .map(el => /C/.test(el.getAttribute('d'))));
ok(curved.length > 0 && curved.every(Boolean),
  '★ traced layouts are drawn as curves, not faceted polylines',
  `${curved.filter(Boolean).length}/${curved.length}`);
await p.close();

/* -- 10e · ★ A DIMMED GLOBE STANDS STILL WHILE THE READER SCROLLS ---------
   Theodor: "when the globe is behind the track layouts and the track facts,
   it's a bit more laggy compared to before." #globe is a fixed, viewport-sized
   canvas under #scrim and a backdrop-filtered topbar, so each repaint forces a
   full-page re-composite — landing on the one frame budget the reader can feel.
   Past the hero there is nothing on it worth that: 0.14 opacity, 0.9°/s drift.
   Asserted as a repaint RATE, per the note in §8: headless frame rate measures
   swiftshader, repaint counts measure the decision this fix actually changed. */
p = await open('', 1440, 900);
const paints = () => p.evaluate(() => ({ n: +document.getElementById('globe').dataset.paints || 0, t: performance.now() }));

/* Jump instantly, not smoothly: `html { scroll-behavior: smooth }` means a
   scrollTo keeps firing scroll events for most of a second afterwards, which is
   the reader still moving as far as this fix is concerned — measuring "at rest"
   inside that window measures the fix, not the baseline. */
const quiet = async (y) => {
  await p.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await sleep(1200);
};
await quiet(3600);
let a = await paints(); await sleep(1600); let b = await paints();
const restHz = (b.n - a.n) / ((b.t - a.t) / 1000);

/* ★ ASSERT THE MECHANISM, NOT A RATE.
 *
 * The obvious check — repaint Hz while scrolling versus at rest — measures
 * headless scheduling as much as the page. Driven through p.mouse.wheel() the
 * input pacing jitters badly (an instrumented run: median gap 42ms, p90 127ms,
 * one stall of 1 999ms — five gaps longer than the 140ms busy tail, each of
 * which correctly let the globe paint), and even driven in-page the ratio sits
 * close enough to the threshold to flip run to run on identical code.
 *
 * What the fix actually promises is narrower and exactly testable: while the
 * gate is closed, a dimmed globe does not repaint at all. So scroll
 * continuously and count repaints only across samples where the globe itself
 * reported `data-busy="1"`. No timing, no ratio, no noise.
 *
 * ★ Paced on a WALL CLOCK, not on requestAnimationFrame. Under swiftshader rAF
 * runs at 5–8 Hz, so frames land 125–200ms apart — longer than the 140ms tail
 * that defines "the reader has stopped". Scrolling once per frame there is not
 * a continuous scroll at all, it is a series of pauses, and the gate correctly
 * reopens in each one. A real trackpad emits every ~16ms; 40ms is comfortably
 * inside the tail and independent of whatever the renderer is managing. */
const busyRun = await p.evaluate(async (ms) => {
  const c = document.getElementById('globe');
  let first = null, last = null, samples = 0, reopened = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    // instant, not smooth: html{scroll-behavior:smooth} turns each scrollBy into
    // an rAF-driven animation, which puts the scroll events back on the 5-8 Hz
    // headless frame clock and straight back outside the busy tail
    window.scrollBy({ top: 10, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 40));
    if (c.dataset.busy === '1') {
      samples++;
      const n = +c.dataset.paints || 0;
      if (first === null) first = n;
      last = n;
    } else if (first !== null) reopened++;
  }
  return { samples, reopened, paintsWhileBusy: last === null ? -1 : last - first };
}, 2400);

await quiet(3600);
a = await paints(); await sleep(1600); b = await paints();
const againHz = (b.n - a.n) / ((b.t - a.t) / 1000);

ok(restHz > 0.5, 'the dimmed globe does paint when the page is still', `${restHz.toFixed(1)} Hz`);
ok(busyRun.samples > 20 && busyRun.reopened <= busyRun.samples * 0.25,
  'the scroll actually held the gate closed', JSON.stringify(busyRun));
ok(busyRun.paintsWhileBusy === 0,
  '★ the dimmed globe does not repaint at all while the reader is scrolling',
  `${busyRun.paintsWhileBusy} repaints across ${busyRun.samples} scrolling samples`);
ok(againHz > 0.5, 'and it comes back once they stop', `${againHz.toFixed(1)} Hz`);
ok(p.__errs.filter(e => !/favicon/i.test(e)).length === 0,
  'session-3 changes raise no page errors', p.__errs.join(' | '));
await p.close();

/* -- 10f · ★ THE LAND OUTLINE IS NOT SAMPLED AWAY ------------------------
   Theodor: "some weird weird stuff in some countries." js/globe.js decimated
   land rings by index (`base = 2` at any normal size) — but the rings arrive
   Douglas-Peucker-simplified from trace/extract.py, and DP output is the exact
   opposite of redundant: every surviving point is one that could not be
   dropped. Taking every other one deleted Italy into the Adriatic and turned
   Cyprus into a rectangle. This asserts the property that was violated —
   at any disc a reader will actually see, the ring is drawn whole. */
p = await open('', 1440, 900);
const decim = await p.evaluate(async () => {
  const res = await fetch('/js/globe.js').then(r => r.text());
  const m = res.match(/const base = ([^;]+);/);
  return m ? m[1].trim() : null;
});
ok(decim !== null, 'globe.js still declares its land decimation', String(decim));
ok(/r > 1[0-9]{2} \? 1/.test(decim || ''),
  '★ land rings are drawn point-for-point at any readable disc size',
  `base = ${decim}`);

/* and the outline that reaches the canvas still carries its full detail */
const landPts = await p.evaluate(async () => {
  const m = await import('/data/world.js');
  const big = m.LAND.filter(r => r.length >= 5);
  return { rings: big.length, points: big.reduce((n, r) => n + r.length, 0) };
});
ok(landPts.points > 15000,
  'the land outline is the simplified 50m set, not something coarser',
  JSON.stringify(landPts));

/* -- 10g · ★ THE ATMOSPHERE IS ROUND -------------------------------------
   Theodor: "the light shape around the globe is a bit squarish — there is a
   small square gradient with atmospheric blue." The halo is painted out to
   HALO x the surface radius, and the disc used to fill the canvas, so the glow
   ran off all four edges and what showed was the corners of its bounding box.
   If any edge pixel is painted, the halo is being clipped by the canvas again. */
const edges = await p.evaluate(() => {
  const c = document.getElementById('globe');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const a = (x, y) => g.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
  return {
    corners: [a(1, 1), a(W - 2, 1), a(1, H - 2), a(W - 2, H - 2)],
    midEdges: [a(W / 2, 1), a(W / 2, H - 2), a(1, H / 2), a(W - 2, H / 2)],
  };
});
ok([...edges.corners, ...edges.midEdges].every(v => v === 0),
  '★ the halo fits inside its canvas — no square edge on the atmosphere',
  JSON.stringify(edges));

/* -- 10h · ★ CIRCUITS COME FROM THE DRAWN ARTWORK ------------------------
   Theodor: "make all the tracks accurate, because it is on the first version …
   in the Field Atlas folder you should be able to find the SVG files." Every
   circuit venue now carries the hand-drawn layout out of source/uploads, and
   the thumbnail draws that rather than a 33-point sampled trace. A layout that
   has fallen back to the trace is a regression in accuracy even though it still
   renders, so this checks the SOURCE, not just that a path exists. */
const art = await p.evaluate(async () => {
  const m = await import('/data/atlas.js');
  const circuit = m.VENUES.filter(v => !v.track?.runway);
  return { circuits: circuit.length, withArt: circuit.filter(v => v.svg?.d).length,
           missing: circuit.filter(v => !v.svg?.d).map(v => v.id) };
});
ok(art.withArt === art.circuits,
  '★ every circuit venue draws from its hand-drawn layout, not a sampled trace',
  JSON.stringify(art));
await p.close();

/* =========================================================================
 * 11 · THE SINGLE-FILE DOCUMENTS
 *
 * trace/bundle.py folds js/ + assets/ + data/ into the two .dc.html files, so
 * 2.0 hands over the same trio 1.x does. A bundle that does not RUN is worse
 * than no bundle, and "it opened without throwing" is not the bar — so this
 * boots each one and checks it built the same page, then checks the standalone
 * works off `file://` with no server at all, which is the only reason a
 * single-file document exists.
 *
 * `python3 trace/bundle.py --check` is the other half: it re-bundles into
 * memory and diffs, which catches a source edit that was never re-bundled.
 * ====================================================================== */
console.log('\n11 · the single-file documents');

const FILE_ROOT = path.join(HERE, '..');
const DOCS = [
  ['standalone-src', 'Field Atlas 2.0 (standalone-src).dc.html', true],
  ['plain .dc.html', 'Field Atlas 2.0.dc.html', false],
];

/** the shape of the built page, for comparing a bundle against index.html */
const shapeOf = (page) => page.evaluate(() => ({
  lit: document.body.classList.contains('lit'),
  entries: document.querySelectorAll('.entry').length,
  cat: document.querySelectorAll('#catalogue-grid .cat-cell').length,
  pick: document.querySelectorAll('#circuit-pick button').length,
  thumbs: document.querySelectorAll('.thumb path.line').length,
  curved: [...document.querySelectorAll('.thumb path.line')].every(e => /C/.test(e.getAttribute('d'))),
}));

p = await open();
const refShape = JSON.stringify(await shapeOf(p));
await p.close();

for (const [label, file, hasThumb] of DOCS) {
  const page = await browser.newPage();
  page.__errs = [];
  page.on('pageerror', e => page.__errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.__errs.push(m.text()); });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + encodeURIComponent(file), { waitUntil: 'networkidle0' });
  await sleep(1900);

  ok(JSON.stringify(await shapeOf(page)) === refShape,
    `${label} builds the same page as index.html`,
    JSON.stringify(await shapeOf(page)) + ' vs ' + refShape);
  ok(await page.evaluate(() => !!document.getElementById('__bundler_thumbnail')) === hasThumb,
    `${label} ${hasThumb ? 'carries' : 'omits'} the thumbnail block`);
  // one module imported by two others must still be ONE instance — see the note
  // in bundle.py about data: URLs being keyed by their own text
  ok(await page.evaluate(() => document.querySelectorAll('script[type="module"]').length) === 1,
    `${label} loads through a single inlined entry module`);
  ok(page.__errs.filter(e => !/favicon|fonts\.g/i.test(e)).length === 0,
    `${label} raises no page errors`, page.__errs.join(' | '));
  await page.close();
}

/* -- 11c · ★ the standalone must work with NO SERVER ---------------------- */
const filePage = await browser.newPage();
filePage.__errs = [];
filePage.on('pageerror', e => filePage.__errs.push(String(e)));
await filePage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
/* pathToFileURL, not 'file://' + encodeURI(...) — on Windows the manual form
   produces file://C:%5CUsers%5C… and Chrome rejects it as ERR_INVALID_URL, which
   killed the run right at the last check */
await filePage.goto(pathToFileURL(path.join(FILE_ROOT, DOCS[0][1])).href, { waitUntil: 'networkidle0' });
await sleep(2100);
ok(JSON.stringify(await shapeOf(filePage)) === refShape,
  '★ the standalone-src builds the whole page straight off file://, no server',
  JSON.stringify(await shapeOf(filePage)));
ok(filePage.__errs.filter(e => !/favicon|fonts\.g|net::/i.test(e)).length === 0,
  'file:// raises no page errors', filePage.__errs.join(' | '));

/* -- 11d · ★ THE EARTH PLATE MUST SURVIVE THE FILE:// TRIP -----------------
 * The single most breakable thing in this session's work. js/globe.js reads the
 * plate back with getImageData, and a file:// <img> taints the canvas it is drawn
 * into — so if trace/bundle.py ever stops inlining that src as a data: URI, the
 * standalone globe silently loses its surface and falls back to bare coastlines.
 * "Silently" is the problem: every other check in §11 passes either way. */
ok(await filePage.evaluate(() =>
    (document.getElementById('earth-plate')?.src || '').startsWith('data:image/')),
  '★ the standalone inlines the Earth plate as a data: URI',
  (await filePage.evaluate(() => (document.getElementById('earth-plate')?.src || '').slice(0, 40))));
ok(await filePage.evaluate(() => document.getElementById('globe')?.dataset.plate) === 'ready',
  '★ the globe reads the plate off file:// without tainting the canvas',
  await filePage.evaluate(() => document.getElementById('globe')?.dataset.plate));
await filePage.close();

/* ===========================================================================
 * 12 · session 5 — the racing line, numbered corners, the lit globe, and four
 *      things that were taken off the page.
 *
 * Everything here is asserted through data-* and ids, per CONVENTIONS §5, so
 * none of it breaks when the copy is reworded.
 * ======================================================================== */
console.log('\n12 · session 5 (racing line, corner numbers, satellite globe)');
{
  const page = await open('', 1440, 900);

  /* -- 12a · the four removals. Each one is a thing Theodor asked to be gone, and
        a check that it stays gone is the only thing that stops it drifting back. */
  ok(await page.evaluate(() => !document.getElementById('reticle')),
    '★ the drifting reticle is gone from the document');
  ok(await page.evaluate(() => !document.querySelector('.colophon')),
    'the colophon block is gone from the footer');
  ok(await page.evaluate(() => !document.querySelector('#foot-sig') === false),
    'the footer signature is still there');

  /* the distance readouts. Asserted on the KEY cells of the spec tables rather
     than on a text search of the page, so a venue named "…Uppsala" cannot pass it
     by accident, and the compass suffix is checked too — `183 KM WSW` in a
     catalogue cell was the other place distance appeared. */
  const dist = await page.evaluate(() => {
    const keys = [...document.querySelectorAll('.spec .row .k')].map(k => k.textContent.trim());
    const cells = [...document.querySelectorAll('.cat-cell .km')].map(k => k.textContent.trim());
    return { keys, cells };
  });
  ok(!dist.keys.some(k => /UPPSALA|DISTANCE|FROM /.test(k)),
    '★ no spec row reports distance from home any more', dist.keys.join(','));
  ok(dist.keys.includes('NEAREST CITY'),
    'the spec table names the nearest city instead', dist.keys.join(','));
  /* the compass token must be preceded by WHITESPACE — `183 KM WSW` is the thing
     being banned, and `20.4°E` is the coordinate that replaced it. Matching a bare
     trailing letter flagged every coordinate on the page. */
  ok(!dist.cells.some(c => /\d\s*KM\b/i.test(c) || /\s(N|S|E|W|NE|NW|SE|SW|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW)$/.test(c)),
    'no catalogue cell reports km and a bearing', dist.cells.slice(0, 4).join(' | '));
  ok(dist.cells.length === TRACKS.length && dist.cells.every(c => /°[NS]\s.+°[EW]$/.test(c)),
    'every catalogue cell carries a coordinate instead', dist.cells.slice(0, 3).join(' | '));
  ok(!await page.evaluate(() => [...document.querySelectorAll('.bar .k')]
       .some(b => b.textContent.trim() === 'REACH')),
    'the REACH bar (km from Uppsala) is gone');

  // the city printed has to be the city in the data, not a plausible-looking one
  const cityRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#entries .entry')].map(e => {
      const r = [...e.querySelectorAll('.spec .row')]
        .find(x => x.querySelector('.k')?.textContent.trim() === 'NEAREST CITY');
      return { key: e.dataset.key, city: r?.querySelector('.v')?.textContent.trim() || null };
    });
    return rows;
  });
  const cityOf = (key) => VENUES.find(v => v.id === key.split(':')[0])?.city;
  ok(cityRow.length > 0 && cityRow.every(r => r.city === cityOf(r.key)),
    'every NEAREST CITY equals the city in data/atlas.js',
    JSON.stringify(cityRow.filter(r => r.city !== cityOf(r.key))));

  /* -- 12b · ★ §03 DRAWS A RACING LINE, NOT THE CENTRELINE.
   *
   * The section had been captioned "RACING LINE" since session 1 while drawing the
   * traced centreline with scattered particles. `data-swing` is the largest lateral
   * offset the solver produced as a fraction of the corridor half-width: it is
   * structurally 0 for a centreline and near 1 for a line that actually uses the
   * road, so this check cannot be satisfied by the old code at any threshold. */
  await page.evaluate(() => document.getElementById('anatomy').scrollIntoView());
  await sleep(2200);
  const fig = await page.evaluate(() => ({ ...document.getElementById('flow').dataset }));
  ok(Number(fig.swing) > 0.55,
    '★ the §03 racing line swings across most of the road', `swing=${fig.swing}`);
  ok(Number(fig.swing) <= 1.001,
    'and never leaves it', `swing=${fig.swing}`);

  /* the figure numbers exactly as many corners as the measured data claims — see
     numberedCorners() in js/loop.js for why that is the reconciliation */
  const gel = [...VENUES, ...TRACKS].find(p => p.id === 'gellerasen');
  ok(Number(fig.corners) === gel.track.corners,
    '★ §03 numbers exactly the corner count in the data',
    `figure=${fig.corners} data=${gel.track.corners}`);
  ok(await page.evaluate(() => (document.getElementById('fig-legend').textContent.match(/T\d+/g) || []).length) === gel.track.corners,
    'and the legend lists the same numbered turns');

  /* -- 12c · numbered corners on a panel layout, and no fill inside the lap -- */
  await page.evaluate(() => document.querySelector('.cat-cell').click());
  await sleep(700);
  const shape = await page.evaluate(() => {
    const svg = document.querySelector('#panel .p-shape svg');
    if (!svg) return null;
    const line = svg.querySelector('path.line');
    const road = svg.querySelector('path.road');
    const cs = getComputedStyle(line);
    return {
      nums: [...svg.querySelectorAll('text.c-no')].map(t => t.textContent.trim()),
      glow: !!svg.querySelector('path.glow'),
      lineFill: cs.fill,
      lineW: parseFloat(line.style.strokeWidth),
      roadW: road ? parseFloat(road.style.strokeWidth) : 0,
      sf: !!svg.querySelector('.c-sf'),
    };
  });
  const firstTrack = TRACKS[0];
  ok(shape && shape.nums.length > 0,
    '★ the panel layout numbers its corners',
    shape ? `${shape.nums.length} numbers` : 'no shape');
  ok(shape && shape.nums.join(',') === Array.from({ length: shape.nums.length }, (_, i) => i + 1).join(','),
    'the numbers run 1..n in lap order', shape ? shape.nums.join(',') : '');
  ok(shape && shape.nums.length <= firstTrack.track.corners,
    'and never more of them than the data counts',
    shape ? `${shape.nums.length} vs ${firstTrack.track.corners}` : '');
  ok(shape && shape.sf, 'the layout marks the start/finish line the numbering starts from');
  ok(shape && !shape.glow,
    '★ no path.glow — the accent fill inside the lap is gone');
  ok(shape && (shape.lineFill === 'none' || shape.lineFill === 'rgba(0, 0, 0, 0)'),
    'and the line itself does not fill either', shape ? shape.lineFill : '');
  ok(shape && shape.roadW > shape.lineW && shape.lineW > 0,
    '★ the track is wider than a wire, with a darker bed under the line',
    shape ? `line=${shape.lineW} road=${shape.roadW}` : '');
  await page.keyboard.press('Escape');
  await sleep(400);

  /* -- 12c′ · ★ A SHORT COUNT IS NEVER A SILENT ONE.
   *
   * The corner count in the spec table is measured off the OSM centreline at even
   * 8-metre steps (trace/extract.py); the drawing is a different representation of
   * the same circuit and is sometimes genuinely smoother. Measured over all 16
   * catalogue circuits on the day this was written: 9 reconcile exactly, 6 resolve
   * one to three fewer, and 1 has no measured count at all.
   *
   * So the invariant asserted here is NOT equality — it is that the page never
   * quietly disagrees with itself. Every layout must either number the full
   * measured count, or state in its caption how many it actually resolved.
   * Twelve numerals under a table reading "CORNERS 14", with nothing to explain
   * the gap, is exactly the kind of drift this suite exists to catch. */
  const audit = [];
  for (let i = 0; i < TRACKS.length; i++) {
    await page.evaluate((n) => document.querySelectorAll('.cat-cell')[n].click(), i);
    await sleep(240);
    audit.push(await page.evaluate(() => {
      const svg = document.querySelector('#panel .p-shape svg');
      const rows = [...document.querySelectorAll('#panel .spec .row')];
      const cr = rows.find(r => r.querySelector('.k')?.textContent.trim() === 'CORNERS');
      return {
        id: document.getElementById('panel-title')?.textContent.trim(),
        drawn: svg ? svg.querySelectorAll('text.c-no').length : 0,
        measured: cr ? Number(cr.querySelector('.v').textContent.trim()) : null,
        cap: document.querySelector('#panel .p-cap')?.textContent.replace(/\s+/g, ' ').trim() || '',
      };
    }));
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  const silent = audit.filter(a =>
    a.measured != null && a.drawn > 0 && a.drawn < a.measured &&
    !new RegExp(`${a.drawn}\\s+RESOLVED HERE`).test(a.cap));
  ok(silent.length === 0,
    '★ no layout under-numbers its corners without saying so in its caption',
    silent.map(a => `${a.id}: ${a.drawn}/${a.measured} — "${a.cap}"`).join(' | '));
  ok(audit.every(a => a.measured == null || a.drawn <= a.measured),
    'no layout over-numbers its corners either',
    audit.filter(a => a.measured != null && a.drawn > a.measured).map(a => a.id).join(','));
  ok(audit.every(a => a.measured != null || a.drawn === 0),
    'a circuit with no measured corner count is not numbered at all',
    audit.filter(a => a.measured == null && a.drawn > 0).map(a => a.id).join(','));
  const exact = audit.filter(a => a.measured != null && a.drawn === a.measured).length;
  ok(exact >= Math.ceil(TRACKS.length / 2),
    'at least half the catalogue reconciles exactly with the measured count',
    `${exact}/${TRACKS.length}`);

  /* -- 12c″ · ★ NO LAYOUT MAY EMIT A NON-FINITE NUMBER.
   *
   * Ten of the sixteen drawn layouts carry no `sw` in the data, so `+f.sw` was NaN
   * and `stroke-width:NaN` silently fell back to SVG's default of 1 unit on a
   * 500-unit artboard — which is most of why the panel layouts read as wire. A
   * style attribute swallows NaN without a word; a geometry attribute does not. So
   * assert BOTH: every stroke width is a real positive number, and no attribute
   * anywhere in a layout is NaN. */
  const nan = [];
  for (let i = 0; i < TRACKS.length; i++) {
    await page.evaluate((n) => document.querySelectorAll('.cat-cell')[n].click(), i);
    await sleep(240);
    const bad = await page.evaluate(() => {
      const svg = document.querySelector('#panel .p-shape svg');
      if (!svg) return null;
      const out = [];
      for (const el of svg.querySelectorAll('*')) {
        for (const a of el.attributes) {
          if (/NaN|Infinity|undefined/.test(a.value)) out.push(`${el.tagName}[${a.name}]`);
        }
        if (/NaN|Infinity|undefined/.test(el.getAttribute('style') || '')) out.push(`${el.tagName}[style]`);
      }
      const line = svg.querySelector('path.line');
      const w = line ? parseFloat(line.style.strokeWidth) : NaN;
      return { out, w, title: document.getElementById('panel-title')?.textContent.trim() };
    });
    if (bad && (bad.out.length || !(bad.w > 0))) nan.push(`${bad.title}: ${bad.out.join(',') || 'strokeWidth=' + bad.w}`);
    /* ★ AND EVERY NUMERAL IS INSIDE THE FRAME.
     *
     * `.p-shape svg` is overflow:visible, so a numeral placed outside the viewBox
     * does not clip — it hangs off the bordered box and looks like a mistake, which
     * is exactly what happened while shapeFrame() ignored `pad` for artwork
     * circuits. Asserted on the RENDERED boxes, in the spirit of §10: where things
     * actually land, not what the markup says. */
    const spill = await page.evaluate(() => {
      const svg = document.querySelector('#panel .p-shape svg');
      if (!svg) return [];
      const box = svg.getBoundingClientRect();
      const out = [];
      for (const t of svg.querySelectorAll('text.c-no')) {
        const r = t.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1 ||
            r.top < box.top - 1 || r.bottom > box.bottom + 1) out.push(t.textContent.trim());
      }
      return out;
    });
    if (spill.length) nan.push(`${bad?.title}: numbers outside the frame — ${spill.join(',')}`);
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  ok(nan.length === 0,
    '★ no layout emits a NaN attribute, a missing stroke width, or a numeral outside its frame',
    nan.join(' | '));

  /* -- 12d · ★ THE SUN IS FIXED IN WORLD SPACE.
   *
   * This is the check for "when the earth rotates, the light isn't gonna change
   * only at the earth, because there's light coming from a specific point." The
   * old shading was a screen-space gradient, so it moved with the camera by
   * construction and the terminator never crossed a coastline. The assertion is
   * therefore comparative: over a window in which the camera turns, the subsolar
   * point must NOT turn with it. The sun does move — 15°/hour — so the bound is on
   * how much, not on whether. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1200);
  const g0 = await page.evaluate(() => ({ ...document.getElementById('globe').dataset }));
  ok(g0.plate === 'ready',
    '★ the globe decoded the Blue Marble plate over http', `plate=${g0.plate}`);
  ok(Number(g0.raster) > 0 && Number(g0.raster) <= 420,
    'the surface raster stays inside its cap', `raster=${g0.raster}`);

  /* ★ The camera is MOVED, not waited on.
   *
   * The first version of this check sat at the hero for 2.6 s and asserted the idle
   * drift had carried the camera past half a degree. It had not, and the page was
   * not at fault: `dt` in globe.js is clamped to 0.05 s so a stalled tab cannot
   * teleport the planet, and headless swiftshader schedules rAF at about 3 Hz — so
   * the 0.9°/s drift runs at 0.15°/s under the test and the window was six times
   * too short. Rather than tune a sleep against a software rasteriser, scroll into
   * §02: that fires a deliberate lookAt at the venue (lat − 22, its longitude),
   * which is an 8° swing and does not depend on the frame rate to happen. */
  await page.evaluate(() => {
    const e = document.querySelector('#entries .entry');
    window.scrollTo(0, window.scrollY + e.getBoundingClientRect().top - 80);
  });
  await sleep(2600);
  const g1 = await page.evaluate(() => ({ ...document.getElementById('globe').dataset }));
  const camMoved = Math.hypot(Number(g1.lon) - Number(g0.lon), Number(g1.lat) - Number(g0.lat));
  const sunMoved = Math.hypot(Number(g1.sunLon) - Number(g0.sunLon), Number(g1.sunLat) - Number(g0.sunLat));
  ok(camMoved > 2, 'the camera actually swung across the window', `${camMoved.toFixed(2)}°`);
  ok(sunMoved < 0.2 && sunMoved < camMoved / 5,
    '★ the sun does not turn with the camera — the light is fixed in world space',
    `camera ${camMoved.toFixed(2)}° vs sun ${sunMoved.toFixed(3)}°`);
  // and it is the real sun, not a constant: ±23.44° is the whole range of declination
  ok(Math.abs(Number(g1.sunLat)) <= 23.5,
    'the subsolar latitude is a physically possible declination', `${g1.sunLat}°`);
  /* the sun is not FROZEN either — 15°/hour is 0.0042°/s, so over the ~4 s this
     section has been running it must have moved, just not with the camera */
  ok(sunMoved > 0, 'and it is a live sun, not a baked-in constant', `${sunMoved.toFixed(4)}°`);

  ok(page.__errs.filter(e => !/favicon|fonts\.g/i.test(e)).length === 0,
    'session-5 changes raise no page errors', page.__errs.join(' | '));
  await page.close();
}

/* -- 12f · ★ THE ANGLES IN §03'S LEGEND ARE REAL DEGREES.
 *
 * They were not. `curvature()` reports heading change over a ±3-node window, so
 * adding it up over a run counts every segment about six times — and the legend
 * printed the sum verbatim, claiming a 1371° corner at Gelleråsen. The turn is now
 * the sum of per-segment heading deltas, each wrapped into (−π, π].
 *
 * The check is the closed-loop invariant, run against js/loop.js directly rather
 * than through the page: the signed per-segment turns around any closed lap must
 * total exactly the drawing's winding number × 360°. That is a hard geometric
 * identity, so it catches a re-inflation by any factor at all — a 6x error shows up
 * as 2160° and cannot hide. */
{
  const loop = await import(pathToFileURL(path.join(HERE, '..', 'js', 'loop.js')).href);
  const TAUd = Math.PI * 2;
  const totalTurn = (pts) => {
    const n = pts.length;
    const head = (i) => {
      const a = pts[i % n], b = pts[(i + 1) % n];
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    };
    let sum = 0, prev = head(0);
    for (let j = 1; j <= n; j++) {
      const h = head(j); let d = h - prev;
      while (d > Math.PI) d -= TAUd;
      while (d < -Math.PI) d += TAUd;
      sum += d; prev = h;
    }
    return sum * 180 / Math.PI;
  };

  const probes = ['gellerasen', 'rasbo'].map(id => [...VENUES, ...TRACKS].find(p => p.id === id));
  for (const p of probes) {
    const pts = p.svg?.d ? loop.flattenPath(p.svg.d, 2.2) : loop.loopSample(p.track.path, 3.2);
    const total = totalTurn(pts);
    ok(Math.abs(Math.abs(total) - 360) < 1,
      `${p.id}'s drawn lap closes at 360° — the turn summation is sound`, `${total.toFixed(1)}°`);

    const marks = loop.numberedCorners(pts, loop.curvature(pts), p.track.corners);
    const deg = marks.map(c => c.turn * 180 / Math.PI);
    /* every numbered turn must be a plausible single turn, and their signed sum
       must not exceed the lap's own winding — a windowed sum would blow both */
    ok(deg.every(d => Math.abs(d) >= 2 && Math.abs(d) <= 360),
      `${p.id}'s corner angles are all inside one revolution`,
      deg.map(d => Math.round(d)).join(' '));
    const signed = deg.reduce((a, b) => a + b, 0);
    ok(Math.abs(signed) <= Math.abs(total) + 90,
      `${p.id}'s corner turns do not exceed the lap's own winding`,
      `corners ${signed.toFixed(0)}° vs lap ${total.toFixed(0)}°`);
  }
}

/* -- 12e · the sources still say what they do ------------------------------- */
{
  const globe = readFileSync(path.join(HERE, '..', 'js', 'globe.js'), 'utf8');
  const loop = readFileSync(path.join(HERE, '..', 'js', 'loop.js'), 'utf8');
  ok(/function subsolar/.test(globe) && !/const SUN = \{/.test(globe),
    'globe.js computes a subsolar point instead of carrying a screen-space SUN');
  ok(/racingLine/.test(loop) && /minimum curvature/i.test(loop),
    'loop.js still documents how the racing line is solved');
  const css = readFileSync(path.join(HERE, '..', 'assets', 'app.css'), 'utf8');
  ok(!/#reticle\s*\{/.test(css), 'app.css no longer styles a reticle');
  ok(!/\.p-shape path\.glow/.test(css), 'app.css no longer fills the inside of a lap');
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
