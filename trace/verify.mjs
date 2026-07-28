/* ===========================================================================
 * trace/verify.mjs — headless smoke test (CONVENTIONS §10).
 *
 * Serve first:  python3 -m http.server 8766 --directory "Field Atlas 2.0"
 * Then:         node trace/verify.mjs
 *
 * Selectors are ids and data-* attributes only — never rendered copy, so
 * rewording the page can never break the suite.
 * ======================================================================== */
import puppeteer from '/Users/theodor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const BASE = process.env.FA2_BASE || 'http://localhost:8766/';

/* read the generated data straight off disk so the page is checked against
   its own source of truth, not against numbers retyped into this file */
const atlas = readFileSync(path.join(HERE, '..', 'data', 'atlas.js'), 'utf8');
const grab = (name) => JSON.parse(atlas.match(new RegExp(`export const ${name} = ([\\s\\S]*?);\\n`))[1]);
const VENUES = grab('VENUES'), TRACKS = grab('TRACKS');
const EVENT_COUNT = VENUES.reduce((n, v) => n + v.events.length, 0);

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
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
const before = cd.hero;
await sleep(1400);
const after = await p.$eval('#readout-next', n => n.textContent.trim());
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
await filePage.goto('file://' + encodeURI(path.join(FILE_ROOT, DOCS[0][1])), { waitUntil: 'networkidle0' });
await sleep(2100);
ok(JSON.stringify(await shapeOf(filePage)) === refShape,
  '★ the standalone-src builds the whole page straight off file://, no server',
  JSON.stringify(await shapeOf(filePage)));
ok(filePage.__errs.filter(e => !/favicon|fonts\.g|net::/i.test(e)).length === 0,
  'file:// raises no page errors', filePage.__errs.join(' | '));
await filePage.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
