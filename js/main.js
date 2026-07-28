/* ===========================================================================
 * main.js — Field Atlas 2.0
 *
 * Builds every section from data/atlas.js (generated from Field Atlas 1.x by
 * trace/extract.py) and wires the four moving parts: starfield, globe, circuit
 * figure, scroll. Nothing here invents a fact — copy lives in COPY below and is
 * clearly editorial; every number on the page comes from the data module.
 * ======================================================================== */

import { VENUES, TRACKS, HOME } from '../data/atlas.js';
import { createStarfield } from './starfield.js';
import { createGlobe } from './globe.js';
import { createCircuitFigure } from './circuit.js';
import { loopPath, loopLength, layoutPath, hasRadii, flattenPath } from './loop.js';
import { initReveal, initScroll } from './scroll.js';
import { createPanel } from './panel.js';
import { packingList, setOverlay, overlay, plan1x, eventKey, GEAR_CATS } from './gear.js';

/* ============================================================ small helpers */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const nf = (n) => new Intl.NumberFormat('sv-SE').format(n);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DISCIPLINE = { karting: 'KARTING', cup: 'CUP + KARTING', airshow: 'AIRSHOW' };
const HUE = { karting: '--karting', cup: '--cup', airshow: '--airshow' };

/* ★ NEVER call scrollIntoView on anything inside .chips.
 * .chips is a sticky, horizontally scrollable bar. scrollIntoView walks EVERY
 * scrollable ancestor including the document, so centring a chip drags the page
 * vertically — which re-fires the entry observer, which centres the next chip.
 * With behavior:'smooth' that is a slow animation actively fighting the reader.
 * Moving the bar's own scrollLeft cannot touch the document scroll. */
function centreChip(chip) {
  const bar = chip.parentElement;                      // .chips
  if (!bar) return;
  const target = chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2;
  const max = bar.scrollWidth - bar.clientWidth;
  if (max <= 0) return;
  bar.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
}

/* Scroll the document to an element, clearing the fixed top bar. Explicit rather
 * than scrollIntoView({block:'start'}) so the target does not land underneath the
 * chrome, and so the only scroller that can ever move is the document. */
function scrollToEl(target, extra = 8) {
  if (!target) return;
  const bar = parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--bar-h'), 10) || 54;
  const y = window.scrollY + target.getBoundingClientRect().top - bar - extra;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

/* ================================================================= EDITORIAL
 * One block per event, keyed venueId:index. `desc` is the body paragraph,
 * `plan` is the pull-quote. Facts quoted inside them are read off the data at
 * build time (see fill()), so they cannot drift from the numbers beside them.
 * ========================================================================= */
const COPY = {
  'rasbo:0': {
    desc: `The home circuit, {km} kilometres up the road, and the only date on this list I can
      reach before the light is up. {corners} corners in {lap} metres means the karts are never
      straight for long — the longest run is {straight} metres, roughly two seconds of pan at 1/60.
      Season opener, and the one weekend where arriving early costs nothing.`,
    plan: `Paddock before seven, main bend for practice, and stay on the inside of the last corner
      for the final — the light comes over the trees behind it.`,
  },
  'halla:0': {
    desc: `{corners} corners, {lap} metres, and a longest straight of {straight} metres: the
      tightest thing in the atlas. Everything happens close, which means shorter glass and more
      walking than shooting. First round of the MKR season, when the grids are still finding
      themselves and the racing is scrappy in a way that photographs well.`,
    plan: `Short lens, low angle, and work the exit kerbs. Nothing here is far enough away to need
      reach — pick a fence gap and let the field come to it.`,
  },
  'enkoping:0': {
    desc: `A club circuit with more room than it looks: {lap} metres, {corners} corners, and a
      {straight}-metre straight that finally lets a long lens breathe. The Enköping site carries
      several loops in the OSM trace; the kart ring measured here is the one that gets raced.`,
    plan: `Straight-on compression down the back straight, then swing round for the entry —
      it is the only place on the calendar where 400mm earns its weight.`,
  },
  'jarfalla:0': {
    desc: `{corners} corners inside {lap} metres — a corner every {perCorner} metres, the densest
      layout in the season. Stockholm Race Weekend puts a full paddock onto a small site, so the
      frames get busy, the backgrounds get difficult, and the access gets negotiated.`,
    plan: `Shoot the paddock first while it is still legible. On track, look for the double-apex
      section: it is the only place the karts are visibly working.`,
  },
  'linkoping:0': {
    desc: `One Sunday, {km} kilometres each way, so it is a four-a.m. start or nothing. The layout
      here is a hand trace scaled against the fitted venues rather than a geo fit, so read {lap}
      metres as approximately {lap} metres and do not quote me on the last digit.`,
    plan: `A single day means no second pass at anything. Walk the whole lap before first practice
      and commit to three positions, not eight.`,
  },
  'gellerasen:0': {
    desc: `The only full-size circuit in the atlas: {lap} metres, a {straight}-metre straight, and
      corners old enough to have names — Tröskurvan, Esset, Hårnålen, Depåkurvan. Three days of
      Kanonloppet, the one weekend a year Karlskoga is the loudest place in Värmland. Cars, not
      karts: everything is faster, further away, and less forgiving of a slow shutter.`,
    plan: `Hårnålen for the braking, the Esset for the direction change, and Tröskurvan late in the
      day when the sun is finally behind the grandstand instead of in it.`,
  },
  'malmen:0': {
    desc: `Not a circuit at all — an air base, and the Air Force's hundredth birthday. Two runways,
      01/19 and 08/26, the longer of them {lap} metres of concrete. The subject arrives at
      several hundred knots and does not come back round on a schedule, so the plan inverts: pick
      a display axis, learn it, and then do not move for six hours.`,
    plan: `Spotters day is the Friday before the public days — static aircraft on an empty apron
      and no crowdline. That is the frame you cannot get on Saturday.`,
  },
  'rasbo:1': {
    desc: `The same {lap} metres as April, five months of light later. Late September in Uppland
      gives a low sun all day and a golden hour that arrives while the racing is still running —
      the one date all season where the schedule and the light agree with each other.`,
    plan: `Everything from the west side after three o'clock. Backlit dust off the kerbs is the
      whole reason to come back to a circuit you already shot.`,
  },
};

/* ====================================================================== data */
const EVENTS = [];
for (const v of VENUES) {
  v.events.forEach((e, i) => {
    const start = Date.parse(e.iso);
    const end = start - 9 * 3600e3 + (e.days || 1) * 86400e3;   // 1.x FA.time convention
    EVENTS.push({ ...e, key: `${v.id}:${i}`, venue: v, start, end, idx: i });
  });
}
EVENTS.sort((a, b) => a.start - b.start);
EVENTS.forEach((e, i) => { e.no = String(i + 1).padStart(2, '0'); });

const nextEvent = () => EVENTS.find(e => e.end > Date.now()) || null;

/* atlas-wide maxima, so every bar is scored against the same page */
const ALL = [...VENUES, ...TRACKS];
const MAX = {
  lap: Math.max(...ALL.map(v => v.track?.lengthM || 0)),
  km: Math.max(...ALL.map(v => v.distanceKm || 0)),
  density: Math.max(...ALL.map(v => (v.track?.corners && v.track?.lengthM)
    ? v.track.corners / (v.track.lengthM / 1000) : 0)),
};

/* ================================================================ formatting */
function countdown(e, now = Date.now()) {
  if (e.end <= now) return { text: 'COMPLETE', state: 'past' };
  if (e.start <= now) return { text: 'IN PROGRESS', state: 'live' };
  let s = Math.floor((e.start - now) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (n) => String(n).padStart(2, '0');
  return {
    text: d > 0 ? `T− ${d}d ${p(h)}:${p(m)}:${p(s)}` : `T− ${p(h)}:${p(m)}:${p(s)}`,
    state: 'future',
  };
}

function fill(tpl, e) {
  const t = e.venue.track || {};
  const per = (t.corners && t.lengthM) ? Math.round(t.lengthM / t.corners) : '—';
  return tpl.replace(/\s+/g, ' ').trim().replace(/\{(\w+)\}/g, (_, k) => ({
    km: e.venue.distanceKm,
    lap: t.lengthM != null ? nf(t.lengthM) : '—',
    corners: t.corners ?? '—',
    straight: t.straightM != null ? nf(t.straightM) : '—',
    perCorner: per,
  }[k] ?? '—'));
}

/* the hand-traced layout, when 1.x had one — it carries the real corner names */
function tracedLayout(venue) {
  const L = venue.layout;
  if (!L) return null;
  const tracks = (L.layers || []).filter(l => l.k === 'track');
  if (!tracks.length) return null;
  const main = tracks.reduce((a, b) => ((b.sw || 0) > (a.sw || 0) ? b : a));
  const names = (L.layers || [])
    .filter(l => l.k === 'label' && !/TRACK|RUNWAY|\d\d\/\d\d/.test(l.text))
    .map(l => ({ label: l.text, x: l.x, y: l.y }));
  /* ★ KEEP THE THIRD COMPONENT. Each traced point is [x, y, r] and r is the
     designed corner radius at that vertex — 24 of Rörken's 33 carry one. This
     used to map to [p[0], p[1]], which threw every radius away and left nothing
     to draw but a polygon. See layoutPath() in js/loop.js. */
  return { path: main.pts.map(p => p.slice(0, 3)), cornerNames: names };
}

/* ======================================================= ONE CIRCUIT, RANKED
 * ★ Three representations exist for a circuit, and they are NOT equal. In
 * descending order of how much they actually know about the shape:
 *
 *   1. `svg`   — the hand-drawn layout, real cubic Béziers on a 500x300
 *                artboard. This is what the circuit was drawn as. Every
 *                competition track has had one all along; the six circuit
 *                venues now do too (trace/extract.py, VENUE_ART).
 *   2. `layout`— a hand trace as [x, y, r] with designed corner radii, drawn
 *                the way 1.x draws it: straights plus quadratic corner arcs.
 *   3. `track.path` — a sampled OSM centreline, 29–72 points, no radii. Only
 *                here is a spline the right answer, and only because the
 *                samples really are meant to lie on a smooth curve.
 *
 * Everything that draws a circuit calls this and then `shapeD()`, so the
 * thumbnail, the catalogue cell, the panel hero and the §03 canvas figure can
 * never again disagree about what a track looks like.
 * ========================================================================= */
function circuitFor(place) {
  const traced = tracedLayout(place);
  const names = traced?.cornerNames || null;
  const base = { id: place.id, name: place.name, cornerNames: names,
                 colour: place.accent || null, track: place.track, city: place.city };

  if (place.svg?.d) return { ...base, kind: 'art', art: place.svg };

  const path = traced?.path || place.track?.path;
  if (!path || path.length < 8) return null;
  return { ...base, kind: hasRadii(path) ? 'traced' : 'sampled', path };
}

/** the SVG `d` for a circuit, drawn by whichever rule its geometry deserves */
function shapeD(c) {
  if (c.kind === 'art') return c.art.d;
  return c.kind === 'traced' ? layoutPath(c.path) : loopPath(c.path);
}

/** the same circuit as points, for the §03 canvas — which has no Path2D to follow */
function circuitPoints(c) {
  if (c.kind === 'art') return flattenPath(c.art.d, 2.2);
  if (c.kind === 'traced') return flattenPath(layoutPath(c.path), 2.2);
  return c.path;
}

/** viewBox + stroke weight for a circuit, from the artwork or from its bbox */
function shapeFrame(c, pad) {
  if (c.kind === 'art') return { vb: c.art.vb, sw: c.art.sw };
  return frame(c.path, pad);
}

/* ================================================================ RENDERING */

function renderReadouts() {
  const host = $('#readouts');
  const rows = [
    ['ATLAS', `${ALL.length}`, 'CIRCUITS'],
    ['DATES', `${EVENTS.length}`, `${EVENTS.filter(e => e.end > Date.now()).length} LEFT`],
    ['NEXT', '—', '', 'next'],
  ];
  host.innerHTML = '';
  for (const [k, v, u, id] of rows) {
    const cell = el('div', 'readout');
    cell.innerHTML =
      `<div class="r"><span class="k mono">${k}</span><span class="dots"></span>` +
      `<span class="v num"${id ? ` id="readout-next"` : ''}>${v}${u ? ` <small>${u}</small>` : ''}</span></div><hr>`;
    host.appendChild(cell);
  }
}

/* ============================================================ §01 THE ROSTER
 * Theodor: "the page one where it says you get one pass at the light — there
 * you could just have a list of all the events instead." So §01 stopped being
 * an essay about method and became the thing you actually want at the top of a
 * season: every date, in order, at a glance, each one a link into its entry.
 * The method and provenance notes it replaced were true but they were about how
 * the page was built, which is what README.md is for.
 * ========================================================================= */
function renderRoster() {
  const host = $('#roster');
  if (!host) return;
  host.innerHTML = EVENTS.map((e, i) => {
    const v = e.venue;
    const c = countdown(e);
    const t = v.track || {};
    return `<a class="ro-row rise" style="--d:${(0.04 * i).toFixed(2)}s;--k:${v.accent}"
               href="#ev-${esc(e.key.replace(':', '-'))}" data-jump="ev-${esc(e.key.replace(':', '-'))}">
      <span class="ro-no mono">FA-${e.no}</span>
      <span class="ro-dot" aria-hidden="true"></span>
      <span class="ro-main">
        <b>${esc(v.short)}</b>
        <i>${esc(e.name)} · ${esc(v.city)}, Sweden</i>
      </span>
      <span class="ro-disc mono">${DISCIPLINE[e.type] || ''}</span>
      <span class="ro-len num mono">${t.runway ? '—' : (t.lengthM ? nf(t.lengthM) + ' m' : '—')}</span>
      <span class="ro-date mono">${esc(e.dateLabel || e.fullDateLabel)}</span>
      <span class="ro-cd mono" data-cd="${esc(e.key)}">${esc(c.text)}</span>
    </a>`;
  }).join('');
}

function renderChips() {
  const host = $('#chips');
  host.innerHTML = '';
  EVENTS.forEach((e) => {
    const b = el('button', 'chip');
    b.type = 'button';
    b.dataset.key = e.key;
    b.setAttribute('aria-current', 'false');
    b.textContent = e.venue.short;
    b.addEventListener('click', () => {
      scrollToEl(document.getElementById('ev-' + e.key.replace(':', '-')));
    });
    host.appendChild(b);
  });
  host.appendChild(el('span', 'spacer'));
  host.appendChild(el('span', 'count', `<span id="chip-count">01</span> / ${String(EVENTS.length).padStart(2, '0')}`));
}

/* Three indices per date, each scored 0–100 against the whole atlas, with the real
   quantity printed beside the bar so the index never has to be taken on trust. */
function bars(e) {
  const t = e.venue.track || {};
  const out = [];
  if (t.corners && t.lengthM) {
    const dens = t.corners / (t.lengthM / 1000);
    out.push(['TECHNICAL', dens / MAX.density * 100, dens.toFixed(1), 'c/km']);
  } else {
    out.push(['DURATION', (e.days || 1) / 3 * 100, String(e.days || 1), 'd']);
  }
  if (t.lengthM) out.push(['SCALE', t.lengthM / MAX.lap * 100, nf(t.lengthM), 'm']);
  out.push(['REACH', e.venue.distanceKm / MAX.km * 100, String(Math.round(e.venue.distanceKm)), 'km']);
  return out;
}

function specRows(e) {
  const v = e.venue, t = v.track || {};
  const rows = [
    ['DATE', esc(e.fullDateLabel)],
    ['DURATION', `${e.days || 1}<u>${(e.days || 1) === 1 ? 'day' : 'days'}</u>`],
    ['DISCIPLINE', DISCIPLINE[e.type] || e.type.toUpperCase()],
    ['CLUB', esc(v.club || v.city)],
    ['COORDINATES', esc(v.coordLabel)],
    ['FROM UPPSALA', `${v.distanceKm}<u>km ${v.compass}</u>`],
  ];
  if (t.runway) {
    rows.push(['RUNWAYS', (t.runways || []).map(nf).join(' / ') + '<u>m</u>']);
  } else if (t.lengthM) {
    rows.push([t.runway ? 'RUNWAY' : 'LAP', `${nf(t.lengthM)}<u>m</u>`, t.estimated]);
    if (t.corners) rows.push(['CORNERS', String(t.corners)]);
    if (t.straightM) rows.push(['LONGEST STRAIGHT', `${nf(t.straightM)}<u>m</u>`]);
  }
  return rows;
}

/** bbox of a traced path, padded, so each thumbnail fills its own box */
function frame(path, pad = 0.07) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of path) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const m = Math.max(w, h) * pad;
  return { vb: `${(x0 - m).toFixed(1)} ${(y0 - m).toFixed(1)} ${(w + m * 2).toFixed(1)} ${(h + m * 2).toFixed(1)}`,
           sw: Math.max(w, h) / 150 };   // stroke scales with the box, so every thumb reads the same weight
}

function thumbSvg(place) {
  const c = circuitFor(place);
  if (!c) return '';
  const d = shapeD(c);
  const f = shapeFrame(c);
  /* The dash has to cover the WHOLE path or the tail renders as a cut on the
     start/finish line. Measure the flattened geometry rather than the control
     points — a curve is longer than the polygon through it — and add 4% so the
     dash can only ever run long. A surplus just means the line finishes
     fractionally early, which nobody can see; coming up short is the visible
     failure, so err in that direction deliberately. */
  const len = Math.ceil(loopLength(flattenPath(d, 4)) * 1.04);
  return `<svg viewBox="${f.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="glow" d="${d}"></path>
      <path class="line" d="${d}" style="--len:${len};stroke-width:${(+f.sw).toFixed(2)}"></path>
    </svg>`;
}

function renderEntries() {
  const host = $('#entries');
  host.innerHTML = '';
  EVENTS.forEach((e) => {
    const v = e.venue;
    const copy = COPY[e.key] || { desc: '', plan: '' };
    const hue = `var(${HUE[e.type] || '--accent'})`;

    const sec = el('article', 'entry');
    sec.id = 'ev-' + e.key.replace(':', '-');
    sec.dataset.key = e.key;
    sec.dataset.reveal = '';
    sec.style.setProperty('--k', v.accent);
    sec.style.setProperty('--k2', hue);

    const left = el('div');
    left.innerHTML = `
      <div class="entry-id mono rise">
        <span class="dot" style="--k:${v.accent}"></span>
        <span>FA-${e.no} · ${DISCIPLINE[e.type] || ''}</span>
        <span style="color:var(--ink-4)">·</span>
        <span data-cd="${e.key}" style="color:var(--ink-2)">—</span>
      </div>
      <h2 class="entry-name rise" style="--d:.06s">${esc(v.short)}</h2>
      <div class="entry-where mono rise" style="--d:.1s">${esc(e.name)} · ${esc(v.city)}, Sweden</div>
      <div class="entry-desc rise" style="--d:.16s"><p>${fill(copy.desc, e)}</p></div>
      <div class="forecast rise" style="--d:.22s">
        <div class="lab mono">PLAN · ISSUED THIS CYCLE</div>
        <p>${fill(copy.plan, e)}</p>
      </div>
      <button class="entry-open mono rise" style="--d:.26s" type="button"
              data-route="date/${esc(e.key)}">
        <span>OPEN THIS DATE — DAY PLAN, GEAR, PACKING LIST</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <path d="M5 12h13M13 6l6 6-6 6"></path></svg>
      </button>`;

    const right = el('div');
    const thumb = thumbSvg(v);
    const rows = specRows(e).map(([k, val, est]) =>
      `<div class="row"><span class="k mono">${k}</span><span class="dots"></span>` +
      `<span class="v num${est ? ' est' : ''}">${val}${est ? '<u>est.</u>' : ''}</span></div>`).join('');
    const barRows = bars(e).map(([k, pct, val, unit], i) =>
      `<div class="bar"><span class="k mono">${k}</span>` +
      `<span class="track"><span class="fill" style="--w:${Math.max(3, Math.min(100, Math.round(pct)))}%;--d:${(0.2 + i * 0.11).toFixed(2)}s"></span></span>` +
      `<span class="v num">${val}<u>${unit}</u></span></div>`).join('');

    right.innerHTML = `
      ${thumb ? `<div class="thumb rise" style="--d:.1s">${thumb}
        <div class="cap mono"><span>${esc(v.name).toUpperCase()}</span><span>TRACED CENTRELINE</span></div></div>` : ''}
      <div class="spec rise" style="--d:.16s">${rows}</div>
      <div class="bars rise" style="--d:.2s">${barRows}</div>`;

    sec.append(left, right);
    host.appendChild(sec);
  });
}

function renderCatalogue() {
  const host = $('#catalogue-grid');
  host.innerHTML = '';
  TRACKS.forEach((t, i) => {
    // a real <button>, not a div with a click handler: this is the whole point of
    // §04 now, and it has to be reachable by keyboard and announced as pressable
    const c = el('button', 'cat-cell');
    c.type = 'button';
    c.dataset.route = `circuit/${t.id}`;
    let shape = '';
    const cc = circuitFor(t);
    if (t.svg) {
      shape = `<div class="shape"><svg viewBox="${t.svg.vb}" aria-hidden="true">
        <path d="${t.svg.d}"${t.svg.t ? ` transform="${t.svg.t}"` : ''}></path></svg></div>`;
    } else if (cc) {
      const d = shapeD(cc);
      const f = shapeFrame(cc);
      shape = `<div class="shape traced"><svg viewBox="${f.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
        `<path d="${d}" style="stroke-width:${(+f.sw * 0.85).toFixed(2)}"></path></svg></div>`;
    } else {
      shape = `<div class="shape"></div>`;
    }
    const m = t.track || {};
    c.innerHTML = `
      <div class="top mono"><span class="no">${String(i + 1).padStart(2, '0')}</span>
        <span class="km num">${Math.round(t.distanceKm)} KM ${t.compass}</span></div>
      ${shape}
      <h3>${esc(t.name)}</h3>
      <div class="where mono">${esc(t.city)}</div>
      <div class="facts mono num">
        <span><b>${m.lengthM ? nf(m.lengthM) : '—'}</b> m</span>
        <span><b>${m.corners ?? '—'}</b> corners</span>
      </div>`;
    host.appendChild(c);
  });
  $('#cat-sub').textContent = `${TRACKS.length} COMPETITION CIRCUITS · REFERENCE LAYER`;
}

/* ============================================================== THE PANEL
 * Two kinds of detail view, one host. Routes are `date/<venueId>:<index>` and
 * `circuit/<id>`, matching the keys the page already uses everywhere else.
 * ========================================================================= */

const TRACK_BY_ID = new Map([...VENUES, ...TRACKS].map(p => [p.id, p]));

/** big version of the traced layout, for the top of a circuit panel */
function bigLayout(place) {
  const c = circuitFor(place);
  if (!c) return `<div class="p-shape p-shape--none mono">NO TRACED GEOMETRY</div>`;
  const d = shapeD(c);
  const f = shapeFrame(c, 0.1);
  return `<div class="p-shape"><svg viewBox="${f.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="glow" d="${d}"></path>
      <path class="line" d="${d}" style="stroke-width:${(+f.sw * 0.9).toFixed(2)}"></path>
    </svg></div>`;
}

const rowsHtml = (rows) => rows.map(([k, v, est]) =>
  `<div class="row"><span class="k mono">${k}</span><span class="dots"></span>` +
  `<span class="v num${est ? ' est' : ''}">${v}${est ? '<u>est.</u>' : ''}</span></div>`).join('');

/** the measured facts for any place, venue or reference circuit */
function placeRows(p) {
  const t = p.track || {};
  const rows = [
    ['COORDINATES', esc(p.coordLabel)],
    ['FROM UPPSALA', `${p.distanceKm}<u>km ${p.compass}</u>`],
  ];
  if (t.runway) rows.push(['RUNWAYS', (t.runways || []).map(nf).join(' / ') + '<u>m</u>']);
  else if (t.lengthM) {
    rows.push(['LAP', `${nf(t.lengthM)}<u>m</u>`, t.estimated]);
    if (t.corners) rows.push(['CORNERS', String(t.corners)]);
    if (t.straightM) rows.push(['LONGEST STRAIGHT', `${nf(t.straightM)}<u>m</u>`]);
    if (t.corners && t.lengthM) {
      rows.push(['CORNER EVERY', `${Math.round(t.lengthM / t.corners)}<u>m</u>`]);
    }
  }
  return rows;
}

/* ------------------------------------------------------------ the day plan */
function scheduleHtml(e) {
  // a custom plan saved in 1.x overrides the event-type default, exactly as 1.x
  // does it — so a plan Theodor edited over there shows here too
  const custom = plan1x(eventKey(e.venue.id, e.iso));
  const rows = custom.value && custom.value.length ? custom.value : (e.schedule || []);
  const source = custom.value && custom.value.length
    ? 'CUSTOM PLAN · FIELD ATLAS 1.x' : 'DEFAULT DAY PLAN · FIELD ATLAS 1.x';

  if (!rows.length) {
    return `<section class="p-sec"><h3 class="mono">PLAN FOR THE DAY</h3>
      <p class="p-empty">No day plan set for this date. Field Atlas 1.x carries a default plan
      for karting rounds; this one has none, so there is nothing here to show rather than a
      schedule invented on the page.</p></section>`;
  }
  return `<section class="p-sec"><h3 class="mono">PLAN FOR THE DAY</h3>
    <ol class="p-sched">${rows.map(s => `<li${s.gold ? ' class="gold"' : ''}>
        <span class="t mono num">${esc(s.time || '')}</span>
        <span class="b"><b>${esc(s.title || '')}</b>${s.note ? `<i>${esc(s.note)}</i>` : ''}</span>
      </li>`).join('')}</ol>
    <div class="p-src mono">${source}</div></section>`;
}

/* ----------------------------------------------------------- the gear list */
function packingHtml(e) {
  const key = eventKey(e.venue.id, e.iso);
  const list = packingList(key);

  const head = `<h3 class="mono">PACKING LIST</h3>`;

  if (list.state === 'too-new') {
    return `<section class="p-sec" id="p-gear">${head}
      <p class="p-empty">The gear data on this device was written by a newer Field Atlas 1.x
      (schema v${esc(String(list.version))}) than this page knows how to read. Rather than guess at
      the shape and show you something wrong, 2.0 is staying out of it. Open 1.x instead.</p>
      </section>`;
  }

  if (list.state === 'none') {
    // a fresh browser has no evhub.* at all — say so, do not render an empty box
    return `<section class="p-sec" id="p-gear">${head}
      <p class="p-empty">No gear inventory on this device yet. The kit list lives in
      <b>Field Atlas 1.x</b> — add your bodies, lenses and the rest there once and every date in
      this atlas will show it.</p>
      <p class="p-empty p-note">In development this is expected: 1.x on <code>:8765</code> and
      2.0 on <code>:8766</code> are different origins, so they do not share storage. In production
      both are served from <code>tedde1000.github.io</code> and do.</p>
      <a class="p-out mono" href="https://tedde1000.github.io/Field-Atlas/" target="_blank"
         rel="noopener">OPEN FIELD ATLAS 1.x →</a></section>`;
  }

  const byCat = new Map(GEAR_CATS.map(c => [c, []]));
  for (const it of list.items) byCat.get(it.category)?.push(it);

  const groups = GEAR_CATS.filter(c => byCat.get(c).length).map(cat => `
    <div class="p-cat"><div class="p-cat-h mono">${esc(cat)}</div>
      ${byCat.get(cat).map(it => `
        <button class="p-item${it.on ? ' on' : ''}" type="button" data-gear="${esc(it.id)}"
                aria-pressed="${it.on}">
          <span class="tick" aria-hidden="true"></span>
          <span class="nm">${esc(it.name)}</span>
          ${it.rental ? '<span class="tag mono">RENTAL</span>' : ''}
          ${it.suggested ? '<span class="tag tag--dim mono">SUGGESTED</span>' : ''}
          <span class="qty num mono">${it.on ? '×' + it.qty : ''}</span>
        </button>`).join('')}
    </div>`).join('');

  const note = list.hadKey
    ? `${list.total} ITEM${list.total === 1 ? '' : 'S'} · 1.x LIST + THIS DEVICE`
    : `${list.total} ITEM${list.total === 1 ? '' : 'S'} · NOTHING PICKED IN 1.x FOR THIS DATE`;

  return `<section class="p-sec" id="p-gear">${head}
    <div class="p-gear-sub mono">${note}</div>
    ${groups}
    <div class="p-src mono">INVENTORY READ FROM FIELD ATLAS 1.x · TICKS SAVED ONLY IN 2.0</div>
  </section>`;
}

/* ------------------------------------------------------------ the two views */
function datePanel(key) {
  const e = EVENTS.find(x => x.key === key);
  if (!e) return null;
  const v = e.venue;
  const c = countdown(e);
  const hasCircuit = !!circuitFor(v);

  return `
    <div class="p-head">
      <div class="p-kicker mono">
        <span class="dot" style="--k:${v.accent}"></span>
        <span>FA-${e.no} · ${DISCIPLINE[e.type] || ''}</span>
        <span class="cd" data-panel-cd="${e.key}">${esc(c.text)}</span>
      </div>
      <h2 id="panel-title" class="p-title">${esc(v.short)}</h2>
      <div class="p-where mono">${esc(e.name)} · ${esc(v.city)}, Sweden</div>
    </div>
    <div class="p-grid">
      <div>
        ${scheduleHtml(e)}
        ${packingHtml(e)}
      </div>
      <div>
        <section class="p-sec"><h3 class="mono">THE DATE</h3>
          <div class="spec">${rowsHtml([
            ['DATE', esc(e.fullDateLabel)],
            ['DURATION', `${e.days || 1}<u>${(e.days || 1) === 1 ? 'day' : 'days'}</u>`],
            ['DISCIPLINE', DISCIPLINE[e.type] || e.type.toUpperCase()],
            ['CLUB', esc(v.club || v.city)],
            ...placeRows(v),
          ])}</div>
        </section>
        ${hasCircuit ? `<section class="p-sec"><h3 class="mono">THE CIRCUIT</h3>
          ${bigLayout(v)}
          <a class="p-out mono" href="#circuit/${esc(v.id)}" data-route="circuit/${esc(v.id)}">
            OPEN CIRCUIT SHEET →</a></section>` : ''}
      </div>
    </div>`;
}

function circuitPanel(id) {
  const p = TRACK_BY_ID.get(id);
  if (!p) return null;
  // a venue with dates has them; a reference circuit honestly has none
  const dates = EVENTS.filter(e => e.venue.id === id);

  return `
    <div class="p-head">
      <div class="p-kicker mono">
        <span class="dot" style="--k:${p.accent || 'var(--accent)'}"></span>
        <span>CIRCUIT SHEET</span>
      </div>
      <h2 id="panel-title" class="p-title">${esc(p.short || p.name)}</h2>
      <div class="p-where mono">${esc(p.name)} · ${esc(p.city)}, Sweden</div>
    </div>
    <div class="p-grid">
      <div>${bigLayout(p)}
        <div class="p-cap mono">${esc(p.name).toUpperCase()} · TRACED CENTRELINE</div></div>
      <div>
        <section class="p-sec"><h3 class="mono">MEASURED</h3>
          <div class="spec">${rowsHtml(placeRows(p))}</div>
        </section>
        <section class="p-sec"><h3 class="mono">${dates.length ? 'BOOKED' : 'NOT BOOKED'}</h3>
          ${dates.length
            ? `<div class="p-dates">${dates.map(e => `
                <a class="p-out mono" href="#date/${esc(e.key)}" data-route="date/${esc(e.key)}">
                  FA-${e.no} · ${esc(e.fullDateLabel)} →</a>`).join('')}</div>`
            : `<p class="p-empty">No date booked here this season. This one is in the atlas as a
               reference layer — somewhere a free weekend could go, with the geometry already
               measured for when it does.</p>`}
        </section>
      </div>
    </div>`;
}

/* ============================================================ §03 the figure */
function renderFigure(fig) {
  const pick = $('#circuit-pick');
  /* `kind`, not `path`: an artwork circuit has no point list of its own until
     circuitPoints() flattens one, and filtering on `path` silently dropped
     every venue the moment they gained real drawn layouts. */
  const options = [
    ...VENUES.map(v => ({ ...circuitFor(v) || {}, place: v, mine: true })).filter(o => o.kind),
    ...TRACKS.map(t => ({ ...circuitFor(t) || {}, place: t, mine: false })).filter(o => o.kind),
  ];
  pick.innerHTML = '';
  let active = options.find(o => o.id === 'gellerasen') || options[0];

  const show = (o) => {
    active = o;
    // hand the canvas the flattened geometry, so §03 draws the same circuit the
    // SVG layouts do rather than re-deriving one from a coarser source
    fig.load({ ...o, path: circuitPoints(o), dense: o.kind !== 'sampled' });
    $('#fig-label').textContent =
      `FIG. 3.1 — RACING LINE, ${o.name.toUpperCase()}`;
    const t = o.track || {};
    $('#fig-meta').textContent =
      `${t.lengthM ? nf(t.lengthM) + ' M' : '—'} · ${t.corners ?? '—'} CORNERS · INTEGRATING`;
    [...pick.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === o.id)));
    // give the canvas a beat to find its corners before reading them back
    setTimeout(() => {
      const cs = fig.corners();
      $('#fig-legend').innerHTML = cs.length
        ? cs.map(c => `<span><b>${esc(c.label)}</b>${c.turn != null ? ` · ${c.turn}°` : ''}</span>`).join('')
          + `<span style="color:var(--ink-4)">${o.cornerNames?.length ? 'NAMED CORNERS · FIELD ATLAS 1.x' : 'TURNS DETECTED FROM THE TRACE'}</span>`
        : '';
    }, 40);
  };

  options.forEach(o => {
    const b = el('button');
    b.type = 'button';
    b.dataset.id = o.id;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = (o.mine ? '· ' : '') + (o.place.short || o.place.name).replace(/\s*\(.*\)/, '');
    b.addEventListener('click', () => show(o));
    pick.appendChild(b);
  });
  show(active);
}

/* ==================================================================== TITLE */
function splitTitle() {
  const h = $('#hero-title');
  const text = h.dataset.text || '';
  const mark = h.querySelector('.hero-mark');
  h.textContent = '';
  [...text].forEach((ch, i) => {
    if (ch === '\n') { h.appendChild(document.createElement('br')); return; }
    if (ch === ' ') { h.appendChild(el('span', 'sp')); return; }
    const s = el('span', 'ch', esc(ch));
    s.style.setProperty('--d', (0.06 + i * 0.045).toFixed(3) + 's');
    h.appendChild(s);
  });
  if (mark) h.appendChild(mark);
}

/* ====================================================================== BOOT */
function boot() {
  splitTitle();
  renderReadouts();
  renderRoster();
  renderChips();
  renderEntries();
  renderCatalogue();

  const stars = createStarfield($('#stars'));
  const globe = createGlobe($('#globe'), { lon: 16.5, lat: 42 });
  const fig = createCircuitFigure($('#flow'));

  /* pins: the eight dates first, then the reference layer */
  const nx = nextEvent();
  globe.setPins([
    ...VENUES.map(v => ({
      id: v.id, lat: v.lat, lon: v.lon, color: v.accent, event: true,
      next: !!nx && nx.venue.id === v.id,
    })),
    ...TRACKS.map(t => ({ id: t.id, lat: t.lat, lon: t.lon, event: false })),
  ], HOME);

  renderFigure(fig);
  initReveal();

  const scroll = initScroll({
    hero: $('#hero'),
    globeWrap: $('#globe-wrap'),
    progress: $('#progress'),
    reticle: $('#reticle'),
    chapterLabel: $('#chapter-label'),
    stars,
    onChapter(id) {
      /* `settled: true` — these two are re-aims the reader did not ask for, they
         just arrived at a chapter. While the globe is dim they are placed, not
         flown, so scrolling back up to the hero does not spin the planet home in
         front of you. See globe.lookAt(). */
      if (id === 'overture') globe.lookAt(46, 14, { hold: 1200, settled: true });
      if (id === 'catalogue') globe.lookAt(62, 17, { hold: 1200, settled: true });
    },
    onGlobeDim: (v) => {
      globe.setDim(v);
      // pins are only clickable while the globe is the hero's subject. Past that
      // it is a fixed layer at z-index 1 lying over §02 and §04, and making it
      // hit-testable there would eat clicks meant for the page.
      document.body.classList.toggle('globe-hot', v > 0.55);
    },
    // the reader is moving: a dimmed globe stops repainting until they stop, so
    // its compositor cost is off the scroll's frame budget. See globe.setBusy().
    onBusy: (v) => { globe.setBusy(v); stars.setBusy(v); },
  });

  /* --- paint gating -------------------------------------------------------
   * Two independent reasons a canvas should stop: the tab is hidden, and the
   * §03 figure is nowhere near the viewport. They have to be combined in one
   * place, or returning to the tab resumes a figure that is still off-screen.
   * ---------------------------------------------------------------------- */
  const gate = { hidden: false, figOff: true };
  const applyGates = () => {
    const awake = !gate.hidden;
    awake ? stars.resume() : stars.pause();
    awake ? globe.resume() : globe.pause();
    (awake && !gate.figOff) ? fig.resume() : fig.pause();
  };

  if ('IntersectionObserver' in window) {
    const figIo = new IntersectionObserver(([x]) => {
      gate.figOff = !x.isIntersecting;
      applyGates();
    }, { rootMargin: '250px 0px 250px 0px' });
    figIo.observe($('.figure'));
  } else {
    gate.figOff = false;
  }
  applyGates();

  /* --- the globe follows whichever date you are reading --- */
  const entries = [...document.querySelectorAll('.entry')];
  const chips = [...document.querySelectorAll('.chip')];
  if ('IntersectionObserver' in window && entries.length) {
    const io = new IntersectionObserver((list) => {
      const vis = list.filter(x => x.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!vis) return;
      const key = vis.target.dataset.key;
      const e = EVENTS.find(x => x.key === key);
      if (!e) return;
      globe.lookAt(e.venue.lat - 22, e.venue.lon, { hold: 5200 });
      globe.focus(e.venue.id);
      chips.forEach(c => c.setAttribute('aria-current', String(c.dataset.key === key)));
      const n = EVENTS.indexOf(e) + 1;
      const cc = $('#chip-count'); if (cc) cc.textContent = String(n).padStart(2, '0');
      const chip = chips.find(c => c.dataset.key === key);
      if (chip) centreChip(chip);
    }, { rootMargin: '-30% 0px -40% 0px', threshold: [0.05, 0.3, 0.6] });
    entries.forEach(x => io.observe(x));
  }

  /* ================================================== the detail panel
   * One delegated click handler drives every trigger, because they are all just
   * `data-route` carriers: the §04 catalogue cells, the per-entry open button,
   * the cross-links inside the panel itself, and the globe pins.
   * ================================================================ */
  const panel = createPanel({
    root: $('#panel'),
    onRender(route) {
      const slash = route.indexOf('/');
      const kind = route.slice(0, slash), id = route.slice(slash + 1);
      return kind === 'date' ? datePanel(id) : circuitPanel(id);
    },
  });

  document.addEventListener('click', (ev) => {
    /* §01's roster jumps to an entry rather than opening a panel. Handled here
       instead of letting the bare href do it, because a native hash jump lands
       the entry under the fixed top bar — and because writing #ev-… into the
       hash would make panel.js treat it as a route it does not recognise. */
    const jump = ev.target.closest('[data-jump]');
    if (jump) {
      ev.preventDefault();
      scrollToEl(document.getElementById(jump.dataset.jump), 18);
      return;
    }
    const hit = ev.target.closest('[data-route]');
    if (!hit) return;
    ev.preventDefault();
    panel.openFrom(hit.dataset.route, hit);
  });

  /* The whole entry is a target, not just the button — but only when the reader
     is not selecting text, and never when they clicked something interactive. */
  $('#entries').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-route], a, button')) return;
    if ((window.getSelection()?.toString() || '').length) return;
    const entry = ev.target.closest('.entry');
    if (!entry) return;
    panel.openFrom('date/' + entry.dataset.key, entry.querySelector('.entry-open'));
  });

  /* Ticking a gear item writes ONLY to fa2.*, never to evhub.* — see js/gear.js.
     Re-render in place so the count and the ×qty stay honest. */
  $('#panel').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-gear]');
    if (!btn) return;
    const route = panel.route() || '';
    if (!route.startsWith('date/')) return;
    const e = EVENTS.find(x => x.key === route.slice(5));
    if (!e) return;
    const key = eventKey(e.venue.id, e.iso);
    const list = packingList(key);
    const item = list.items.find(i => i.id === btn.dataset.gear);
    if (!item) return;
    const map = { ...overlay(key) };
    // an explicit `removed` tombstone, so unticking something 1.x put on the
    // list is remembered instead of falling back to 1.x's value on next read
    if (item.on) map[item.id] = { qty: item.qty, removed: true };
    else map[item.id] = { qty: item.qty };
    setOverlay(key, map);
    panel.refresh();
  });

  /* Globe pins. The canvas stays pointer-events:none for everything except the
     hero, where there is no body copy under it — otherwise a fixed layer at
     z-index 1 would sit on top of §02 and §04 and swallow clicks meant for the
     entries and the catalogue cells. */
  const globeCanvas = $('#globe');
  const pinAt = (ev) => {
    const r = globeCanvas.getBoundingClientRect();
    return globe.hitTest(ev.clientX - r.left, ev.clientY - r.top, 16);
  };
  globeCanvas.addEventListener('click', (ev) => {
    const pin = pinAt(ev);
    if (!pin) return;
    const ev0 = EVENTS.find(x => x.venue.id === pin.id);
    panel.openFrom(ev0 ? 'date/' + ev0.key : 'circuit/' + pin.id, globeCanvas);
  });
  globeCanvas.addEventListener('pointermove', (ev) => {
    globeCanvas.style.cursor = pinAt(ev) ? 'pointer' : '';
  });

  /* --- the ticking bits: hero readout, rails, per-entry countdowns --- */
  const cdNodes = [...document.querySelectorAll('[data-cd]')];
  function tick() {
    const now = Date.now();
    const nxt = nextEvent();
    const out = $('#readout-next');
    if (out) {
      if (nxt) {
        const c = countdown(nxt, now);
        out.innerHTML = `${c.text} <small>${esc(nxt.venue.short.toUpperCase())}</small>`;
      } else out.innerHTML = 'SEASON CLOSED';
    }
    for (const n of cdNodes) {
      const e = EVENTS.find(x => x.key === n.dataset.cd);
      if (!e) continue;
      const c = countdown(e, now);
      n.textContent = c.text;
      n.style.color = c.state === 'past' ? 'var(--ink-4)'
        : (c.state === 'live' ? 'var(--accent)' : 'var(--ink-2)');
    }
    // the open panel carries the same countdown, so it must tick too
    const pcd = document.querySelector('[data-panel-cd]');
    if (pcd) {
      const pe = EVENTS.find(x => x.key === pcd.dataset.panelCd);
      if (pe) pcd.textContent = countdown(pe, now).text;
    }
    const t = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const utc = `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
    $('#rail-right').textContent =
      `UTC ${utc} · ${HOME.lat.toFixed(4)}° N · ${HOME.lon.toFixed(4)}° E · ` +
      (nxt ? countdown(nxt, now).text.replace('− ', '−') : 'SEASON CLOSED');
  }
  tick();
  setInterval(tick, 1000);

  $('#kicker-right').textContent =
    `VOL. II · ${EVENTS.length} DATES · ${ALL.length} CIRCUITS`;
  $('#foot-sig').innerHTML =
    `— END OF CATALOGUE · ${ALL.length} CIRCUITS · ${EVENTS.length} DATES`;

  /* --- the two pills --- */
  const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let motion = !prefersStill;
  const motionPill = $('#pill-motion');
  const applyMotion = () => {
    document.body.classList.toggle('no-motion', !motion);
    motionPill.setAttribute('aria-pressed', String(motion));
    stars.setMotion(motion); globe.setMotion(motion);
    fig.setMotion(motion); scroll.setMotion(motion);
  };
  motionPill.addEventListener('click', () => { motion = !motion; applyMotion(); });
  applyMotion();

  const themePill = $('#pill-theme');
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    themePill.setAttribute('aria-pressed', String(t === 'night'));
    themePill.querySelector('span').textContent = t === 'night' ? 'NIGHT SIDE' : 'DAY SIDE';
    document.querySelector('meta[name=theme-color]')
      ?.setAttribute('content', t === 'night' ? '#07080a' : '#e8e3d8');
    try { localStorage.setItem('fa2.theme', t); } catch {}
  };
  themePill.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night');
  });
  let saved = null;
  try { saved = localStorage.getItem('fa2.theme'); } catch {}
  setTheme(saved === 'day' ? 'day' : 'night');

  /* --- resize + visibility --- */
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { stars.resize(); globe.resize(); fig.resize(); scroll.refresh(); }, 120);
  });
  document.addEventListener('visibilitychange', () => {
    gate.hidden = document.hidden;
    applyGates();
  });

  /* Deep link. Sections and individual dates are addressable, but the targets only
     exist once the entries are built — so the hash is honoured here, not on load.
     It then has to be re-applied: the display face swapping in changes every entry
     height, and a one-shot scroll lands hundreds of pixels short. Re-aiming stops
     the moment the reader touches the page. */
  let userMoved = false;
  const MOVE_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  const markMoved = () => { userMoved = true; };
  // Re-armable, NOT once:true. hashchange sets userMoved back to false, so a
  // one-shot listener would leave the next re-aim loop unstoppable — two seconds
  // of the page yanking itself back while the reader is trying to scroll away.
  MOVE_EVENTS.forEach(t => window.addEventListener(t, markMoved, { passive: true }));

  // Re-aim every frame for two seconds rather than scrolling once: the display face
  // swapping in re-flows every entry, and a single shot lands thousands of pixels
  // short on a long page. Any real input ends it immediately.
  const goHash = (deadline) => {
    if (userMoved) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target) return;
    const bar = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--bar-h'), 10) || 54;
    const delta = target.getBoundingClientRect().top - bar - 8;
    if (Math.abs(delta) > 2) {
      const prev = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, window.scrollY + delta);
      document.documentElement.style.scrollBehavior = prev;
      scroll.refresh();
    }
    if (performance.now() < deadline) requestAnimationFrame(() => goHash(deadline));
  };
  const aim = () => goHash(performance.now() + 2000);

  requestAnimationFrame(() => {
    fig.resize(); globe.resize();
    document.body.classList.add('lit');
    panel.sync();          // honour #date/… or #circuit/… already in the URL
    aim();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(aim);
  window.addEventListener('load', aim, { once: true });
  window.addEventListener('hashchange', () => { userMoved = false; aim(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
