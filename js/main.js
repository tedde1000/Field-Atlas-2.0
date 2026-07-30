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
import { loopPath, loopLength, layoutPath, hasRadii, flattenPath,
         curvature, numberedCorners, cornerRuns } from './loop.js';
import { initReveal, initScroll } from './scroll.js';
import { createPanel } from './panel.js';
import { stage3d, mount as mount3d } from './layout3d.js';
import { packingList, setOverlay, overlay, plan1x, eventKey, GEAR_CATS, kit,
         adopt, addItem, renameItem, setCategory, setRental, setQty, deleteItem } from './gear.js';

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

/* One decimal, for the places a coordinate has to fit in a 124px column. Built
   from lat/lon rather than by truncating `coordLabel`, so it cannot go wrong if
   trace/extract.py ever changes that string's format. Every venue in the atlas is
   north and east, but the hemisphere is read off the sign anyway. */
const shortCoord = (p) =>
  `${Math.abs(p.lat).toFixed(1)}°${p.lat < 0 ? 'S' : 'N'} ` +
  `${Math.abs(p.lon).toFixed(1)}°${p.lon < 0 ? 'W' : 'E'}`;

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
 * ★ ONE SENTENCE PER DATE, AND IT HAS TO EARN ITS PLACE.
 *
 * Theodor: "make it maybe a bit cleaner, less text — I don't really need
 * 'short lens, low angle, and work the exit kerbs', those kinds of text …
 * just have a short summary under the name, and of course around them place
 * and country."
 *
 * So the shooting notes are gone and the per-event pull-quote with them. What
 * is left says what the date IS, not how to photograph it — the numbers beside
 * it already say the rest, and every one of them is read off the data at build
 * time through fill(), so a summary can never drift from the spec table
 * printed next to it.
 * ========================================================================= */
const COPY = {
  'rasbo:0':      { desc: `Season opener at the home circuit, and the one I know best — {lap} metres and {corners} corners.` },
  'halla:0':      { desc: `First MKR round of the year, and the tightest layout in the atlas: {corners} corners in {lap} metres.` },
  'enkoping:0':   { desc: `A club circuit with more room than it looks — {lap} metres and a {straight}-metre straight.` },
  'jarfalla:0':   { desc: `Stockholm Race Weekend, on the densest layout of the season: a corner every {perCorner} metres.` },
  'linkoping:0':  { desc: `One Sunday, there and back. The length is scaled from a hand trace, so read {lap} metres as approximate.` },
  'gellerasen:0': { desc: `Three days of Kanonloppet on the only full-size circuit here — {lap} metres, cars rather than karts.` },
  'malmen:0':     { desc: `Not a circuit but an air base, for the Air Force's hundredth: two runways, the longer {lap} metres.` },
  'rasbo:1':      { desc: `The same {lap} metres as April, five months of light later — low sun all day by late September.` },
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

/* atlas-wide maxima, so every bar is scored against the same page.
   ★ `km` is gone: nothing on the page reports distance from home any more — see
   the note over placeRows(). `distanceKm`, `bearing` and `compass` are still in
   data/atlas.js because trace/extract.py still computes them and the data module
   is generated; they are simply not printed. */
const ALL = [...VENUES, ...TRACKS];
const MAX = {
  lap: Math.max(...ALL.map(v => v.track?.lengthM || 0)),
  straight: Math.max(...ALL.map(v => v.track?.straightM || 0)),
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

/* ★ TEN OF THE SIXTEEN DRAWN LAYOUTS CARRY NO STROKE WEIGHT, AND THIS IS WHY THE
 * PANEL LAYOUTS LOOKED LIKE WIRE.
 *
 * `VENUE_ART` in trace/extract.py records a measured `sw` for the six circuit
 * venues (2.9–3.48 on their artboards). The ten competition-track SVGs out of
 * `source/uploads` do not carry one at all — they are drawn on a plain 500x300
 * artboard and 1.x styled them from CSS. So `+c.art.sw` was NaN for all ten, and
 * `stroke-width:NaN` is not an error in CSS, it is simply ignored: those laps fell
 * back to SVG's default stroke-width of 1 unit on a 500-unit artboard, i.e. a
 * hairline, while the six venues rendered at their proper weight. That is the
 * "make the track layout itself a bit wider" complaint, at least half of it, and
 * it was a missing-data fallback rather than a styling choice.
 *
 * The fallback now matches how frame() derives a weight for a traced path — the
 * long side over 150 — which on a 500x300 artboard gives 3.33, right in the middle
 * of the range the six measured ones actually use.
 *
 * ★ It also returns a NUMBER, always. Every caller multiplies this, and a NaN
 * propagating into an SVG attribute is the one failure mode that produces no
 * console error in a style attribute and a flood of them in a geometry attribute.
 */
function shapeFrame(c, pad) {
  if (c.kind === 'art') {
    const b = String(c.art.vb || '0 0 500 300').trim().split(/\s+/).map(Number);
    const [x, y, w, h] = [b[0] || 0, b[1] || 0, b[2] || 500, b[3] || 300];
    const long = Math.max(w, h);
    const sw = Number(c.art.sw);
    /* ★ The artwork's own viewBox is exactly its bounding box, so anything drawn
     * OUTSIDE the lap — which is where every corner number goes — lands outside the
     * frame. `.p-shape svg` is overflow:visible, so they did not clip, they simply
     * hung off the bordered box: 3 above it, 1 below it, 12 and 14 out to the right.
     *
     * `pad` defaults to 0 here rather than to frame()'s 0.07, so the §02 thumbnails
     * — which call this with no argument and carry no numbers — render at exactly
     * the size they always did. Only bigLayout() asks for room. */
    const m = long * (pad || 0);
    return {
      vb: `${(x - m).toFixed(1)} ${(y - m).toFixed(1)} ${(w + m * 2).toFixed(1)} ${(h + m * 2).toFixed(1)}`,
      sw: Number.isFinite(sw) && sw > 0 ? sw : long / 150,
    };
  }
  return frame(c.path, pad);
}

/* What the reader is actually looking at. The caption used to say TRACED
   CENTRELINE under everything, which stopped being true the moment the drawn
   layouts arrived — and a label that describes the wrong source is worse than
   no label on a page whose whole claim is that its numbers are honest. */
const SOURCE_LABEL = { art: 'DRAWN LAYOUT', traced: 'HAND TRACE', sampled: 'TRACED CENTRELINE' };
const sourceOf = (c) => (c && SOURCE_LABEL[c.kind]) || 'TRACED CENTRELINE';

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
  const dur = ['DURATION', (e.days || 1) / 3 * 100, String(e.days || 1), 'd'];
  const out = [];
  if (t.corners && t.lengthM) {
    const dens = t.corners / (t.lengthM / 1000);
    out.push(['TECHNICAL', dens / MAX.density * 100, dens.toFixed(1), 'c/km']);
  } else {
    out.push(dur);
  }
  if (t.lengthM) out.push(['SCALE', t.lengthM / MAX.lap * 100, nf(t.lengthM), 'm']);
  /* ★ The third bar was REACH — km from Uppsala. Replaced rather than dropped,
     because two bars read as a truncated set. The longest straight is the index
     that belongs beside the other two: it is about the circuit, not the drive.
     Malmen has neither a straight nor a corner count, so it falls back to
     duration — and `out.includes(dur)` is what stops it printing that twice. */
  if (t.straightM) out.push(['STRAIGHT', t.straightM / MAX.straight * 100, nf(t.straightM), 'm']);
  else if (!out.includes(dur)) out.push(dur);
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
    ['NEAREST CITY', esc(v.city)],
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
  /* no `path.glow` under the line any more — the accent fill inside the lap is
     what Theodor meant by "this inner yellow inside of the track". See .p-shape
     in assets/app.css. */
  return `<svg viewBox="${f.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
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
        <div class="cap mono"><span>${esc(v.name).toUpperCase()}</span><span>${sourceOf(circuitFor(v))}</span></div></div>` : ''}
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
    /* the top-right used to be `183 KM WSW` — distance and bearing from Uppsala.
       It is the coordinate now, at one decimal because the cell is 160px wide at
       the narrow breakpoint and the full four-decimal label from the data does not
       fit without wrapping mid-coordinate. The nearest city keeps the line under
       the name, and the panel prints the coordinate in full. See placeRows(). */
    c.innerHTML = `
      <div class="top mono"><span class="no">${String(i + 1).padStart(2, '0')}</span>
        <span class="km num">${shortCoord(t)}</span></div>
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

/* ============================================================== §05 THE KIT
 * ★ 1.x HAS A GEAR SCREEN AND 2.0 HAD HALF A PACKING LIST.
 *
 * Theodor: "in the first Field Atlas I had equipment and gear sections, which I
 * also want you to make — but don't put in random stuff."
 *
 * Everything 2.0 knew about the kit was buried inside a date's panel, as a list
 * of tick boxes for one weekend. That is the *bringing* list, which is a
 * different question from what the kit IS — and the kit is the thing you look at
 * when you are deciding whether to hire a 70–200 for Kanonloppet.
 *
 * So the whole inventory gets a chapter, grouped the way 1.x groups it, with the
 * two distinctions 1.x carries in the data and this page has no business hiding:
 * what he OWNS, what he would RENT, and which entries were only ever a generic
 * suggestion. See KIT_1X in js/gear.js for where the list comes from and why the
 * provenance line under it is not optional.
 * ========================================================================= */
function renderKit() {
  const host = $('#kit-grid');
  if (!host) return;
  const k = kit();

  if (k.source === 'too-new') {
    host.innerHTML = `<p class="p-empty">The gear data on this device was written by a newer
      Field Atlas 1.x (schema v${esc(String(k.version))}) than this page knows how to read.
      Rather than guess at the shape and show you something wrong, 2.0 is staying out of it.</p>`;
    $('#kit-src').textContent = '';
    return;
  }

  const owned = k.items.filter(i => !i.rental && !i.suggested);
  const rental = k.items.filter(i => i.rental);
  const bodies = k.items.filter(i => i.category === 'Bodies' && !i.rental).length;
  const lenses = k.items.filter(i => i.category === 'Lenses' && !i.rental).length;

  $('#kit-lede').textContent =
    `${owned.length} pieces of equipment I own, ${rental.length} I would hire, and the ` +
    `basics that live in the bag. Every date in §02 draws its packing list from this same ` +
    `inventory — the kit is one list, the weekend is a selection from it.`;
  $('#kit-sub').textContent =
    `${bodies} ${bodies === 1 ? 'BODY' : 'BODIES'} · ${lenses} ${lenses === 1 ? 'LENS' : 'LENSES'} · ` +
    `${k.items.length} ITEMS`;

  const byCat = new Map(GEAR_CATS.map(c => [c, []]));
  for (const it of k.items) byCat.get(it.category)?.push(it);

  host.innerHTML = GEAR_CATS.filter(c => byCat.get(c).length).map((cat, ci) => {
    const rows = byCat.get(cat).map(it => `
      <li class="kit-item${it.rental ? ' is-rental' : ''}${it.suggested ? ' is-sug' : ''}">
        <span class="nm">${esc(it.name)}</span>
        ${it.qty > 1 ? `<span class="q num mono">×${it.qty}</span>` : ''}
        ${it.rental ? '<span class="tag mono">RENTAL</span>'
                    : (it.suggested ? '<span class="tag tag--dim mono">BASIC</span>'
                                    : '<span class="tag tag--own mono">OWNED</span>')}
      </li>`).join('');
    return `<section class="kit-cat rise" style="--d:${(0.05 * ci).toFixed(2)}s">
      <h3 class="mono">${esc(cat)}<span class="n num">${byCat.get(cat).length}</span></h3>
      <ul>${rows}</ul>
    </section>`;
  }).join('');

  /* ★ SAY WHICH LIST THIS IS. Live from 1.x on his phone, recovered from 1.x's
     git history anywhere else — and a reader looking at their own equipment
     deserves to know which, because only one of the two is editable and only one
     of them is current. */
  $('#kit-src').textContent = k.source === 'own'
    ? 'YOUR KIT · EDITED IN FIELD ATLAS 2.0 ON THIS DEVICE'
    : k.source === 'live'
      ? 'READ LIVE FROM FIELD ATLAS 1.x ON THIS DEVICE · READ-ONLY UNTIL YOU EDIT IT'
      : 'FIELD ATLAS 1.x INVENTORY · RECOVERED FROM ITS OWN HISTORY · '
        + 'THIS DEVICE HAS NO LIVE 1.x DATA';
}

/* ================================================== THE KIT, AS A PANEL
 * ★ THE KIT IS A TOOL, AND A TOOL AT THE BOTTOM OF A 12 000-PIXEL PAGE IS NOT ONE.
 *
 * Theodor: "you got to basically decide, and you need to scroll all the way down
 * towards the equipment section and the kit section… it's like you could select
 * gear pretty early in the website."
 *
 * §05 is the sixth of six chapters. Reaching it from the top meant scrolling past
 * the whole season and the whole catalogue, and on a phone, where the grids
 * collapse to one column, further still. Nothing in the chrome linked to it.
 *
 * So the chapter stays exactly where it is — it is the essay about the kit, and it
 * belongs at the end of the argument — and the same list is also a panel, on the
 * existing #panel host, one tap from the topbar at any scroll position. The essay
 * is where you read about the kit; the panel is where you change it.
 * ========================================================================= */
function kitPanel() {
  const k = kit();

  if (k.source === 'too-new') {
    return `<div class="p-head"><h2 id="panel-title" class="p-title">The Kit</h2></div>
      <p class="p-empty">The gear data on this device was written by a newer Field Atlas
      (schema v${esc(String(k.version))}) than this page knows how to read. Rather than guess at the
      shape and show you something wrong, 2.0 is staying out of it.</p>`;
  }

  const n = k.items.length;
  const rentals = k.items.filter(i => i.rental).length;

  /* ★ ADOPTION IS A BUTTON, NEVER A SIDE EFFECT — see the long note in js/gear.js.
   * Until it is pressed this list belongs to 1.x and is shown read-only. Copying
   * 29 recovered items into an editable list the first time someone opened the
   * panel would recreate exactly the thing 1.x deleted its seed to escape. */
  const adoptBlock = k.owned ? '' : `
    <div class="kit-adopt">
      <p>${k.source === 'live'
        ? `This is your Field Atlas 1.x inventory, read live from this device. Editing it here
           makes 2.0 its own copy — <b>1.x is never written to</b>, so the two lists go their own
           way from that moment.`
        : `Field Atlas 1.x has never run in this browser, so this is the last inventory it is
           known to have carried, recovered from its own history. Some of it is generic basics
           rather than equipment anyone owns.`}</p>
      <div class="kit-adopt-do">
        <button class="kit-btn kit-btn--go" type="button" data-kit="adopt-these">
          ${k.source === 'live' ? 'COPY THESE ' + n + ' ITEMS AND EDIT' : 'START FROM THESE ' + n + ' ITEMS'}
        </button>
        <button class="kit-btn" type="button" data-kit="adopt-empty">START EMPTY</button>
      </div>
    </div>`;

  const addForm = !k.owned ? '' : `
    <form class="kit-add" data-kit="add">
      <input class="kit-in" name="name" type="text" maxlength="60" required
             placeholder="Add equipment — e.g. 70–200mm f/2.8" aria-label="Item name">
      <select class="kit-in kit-in--cat" name="category" aria-label="Category">
        ${GEAR_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <label class="kit-rent">
        <input type="checkbox" name="rental"> <span class="mono">RENTAL</span>
      </label>
      <button class="kit-btn kit-btn--go" type="submit">ADD</button>
    </form>`;

  const byCat = new Map(GEAR_CATS.map(c => [c, []]));
  for (const it of k.items) byCat.get(it.category)?.push(it);

  const groups = GEAR_CATS.filter(c => byCat.get(c).length).map(cat => `
    <div class="p-cat">
      <div class="p-cat-h mono">${esc(cat)}<span class="n num">${byCat.get(cat).length}</span></div>
      ${byCat.get(cat).map(it => k.owned ? `
        <div class="kit-row" data-id="${esc(it.id)}">
          <input class="kit-in kit-nm" type="text" value="${esc(it.name)}" maxlength="60"
                 data-kit="rename" aria-label="Name">
          <select class="kit-in kit-in--cat" data-kit="cat" aria-label="Category">
            ${GEAR_CATS.map(c => `<option value="${esc(c)}"${c === it.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          <button class="kit-tag mono${it.rental ? ' is-rental' : ''}" type="button"
                  data-kit="rental" aria-pressed="${it.rental}"
                  title="Owned or rented">${it.rental ? 'RENTAL' : 'OWNED'}</button>
          <div class="kit-qty">
            <button class="kit-step" type="button" data-kit="qty-" aria-label="Fewer">−</button>
            <span class="num mono">${it.qty}</span>
            <button class="kit-step" type="button" data-kit="qty+" aria-label="More">+</button>
          </div>
          <button class="kit-del" type="button" data-kit="del" aria-label="Delete ${esc(it.name)}">✕</button>
        </div>` : `
        <div class="p-item is-static">
          <span class="nm">${esc(it.name)}</span>
          ${it.rental ? '<span class="tag mono">RENTAL</span>' : ''}
          ${it.suggested ? '<span class="tag tag--dim mono">BASIC</span>' : ''}
          <span class="qty num mono">${it.qty > 1 ? '×' + it.qty : ''}</span>
        </div>`).join('')}
    </div>`).join('');

  const empty = n ? '' : `<p class="p-empty">Nothing in the kit yet. Add the first thing above —
    every date's packing list is a selection from this one inventory, so it is worth being
    complete.</p>`;

  const src = k.source === 'own'
    ? `${n} ITEM${n === 1 ? '' : 'S'} · ${rentals} TO HIRE · SAVED ON THIS DEVICE · 1.x UNTOUCHED`
    : k.source === 'live'
      ? `${n} ITEMS · READ LIVE FROM FIELD ATLAS 1.x · READ-ONLY`
      : `${n} ITEMS · RECOVERED FROM FIELD ATLAS 1.x HISTORY · READ-ONLY`;

  return `
    <div class="p-head">
      <div class="p-kicker mono"><span class="dot" style="--k:var(--accent)"></span>
        <span>§05 · THE KIT</span></div>
      <h2 id="panel-title" class="p-title">The Kit</h2>
      <div class="p-where mono">One inventory. Every date packs from it.</div>
    </div>
    ${adoptBlock}
    ${addForm}
    ${groups}
    ${empty}
    <div class="p-src mono">${src}</div>
    <a class="p-out mono" href="#kit" data-jump="kit">READ THE CHAPTER →</a>`;
}

/* ============================================================== THE PANEL
 * Two kinds of detail view, one host. Routes are `date/<venueId>:<index>` and
 * `circuit/<id>`, matching the keys the page already uses everywhere else.
 * ========================================================================= */

const TRACK_BY_ID = new Map([...VENUES, ...TRACKS].map(p => [p.id, p]));

/* ============================================ NUMBERED CORNERS ON A LAYOUT
 * ★ Theodor: "if you go into a circuit, for example, make the tracks have corner
 * numbers." So a panel layout is now annotated: a dot on the apex-side of each
 * turn, a short leader out of the corner, and the number at the end of it.
 *
 * The count is not negotiable — numberedCorners() in js/loop.js keeps exactly as
 * many turns as `track.corners` claims, ranked by how much they actually turn, so
 * T1…T14 beside a table reading "CORNERS 14" is always the same fourteen turns.
 * Read the long note over that function for why it is done that way.
 *
 * Everything is sized off the artboard rather than in pixels, because the three
 * geometry sources have three different viewBoxes — a 500x300 drawing and a
 * 1000x640 hand trace would otherwise get numerals at wildly different sizes.
 * ======================================================================== */
/* The numbered turns for a circuit, and the points they sit on. Memoised because
   bigLayout() and cornerCaption() both need it and a date panel draws the same
   circuit twice — flattening a path and walking it for curvature is not free. */
const CORNER_CACHE = new Map();
function layoutCorners(c) {
  const t = c.track || {};
  if (t.runway) return { pts: null, marks: [] };
  if (CORNER_CACHE.has(c.id)) return CORNER_CACHE.get(c.id);
  const pts = circuitPoints(c);
  let got = { pts: null, marks: [] };
  if (pts && pts.length >= 12) {
    const k = curvature(pts);
    /* ★ "A number for the corners at EVERY single circuit." Where the data
       carries a measured count, numberedCorners() keeps exactly that many so the
       drawing and the spec table agree — that is the whole reason it exists. But
       a circuit with real geometry and no measured count used to get no numbers
       at all rather than the ones its own shape obviously has, which is the
       wrong way round: the count is what should be uncertain, not whether the
       turns are numbered. So it falls back to the runs themselves. */
    got = { pts, marks: t.corners ? numberedCorners(pts, k, t.corners) : cornerRuns(pts, k, 6) };

    /* Real corner names, where 1.x recorded them — Gelleråsen has six. Snapped to
       the nearest NUMBERED corner rather than to the nearest node, so "ESSET"
       always lands on a turn the table actually counted. Same rule js/circuit.js
       uses for §03's legend, so the two can never disagree about which turn a
       name belongs to. */
    if (c.cornerNames?.length && got.marks.length) {
      for (const nm of c.cornerNames) {
        let best = null, bd = Infinity;
        for (const m of got.marks) {
          const p = pts[m.i];
          const dd = (p[0] - nm.x) ** 2 + (p[1] - nm.y) ** 2;
          if (dd < bd) { bd = dd; best = m; }
        }
        if (best && !best.label) best.label = nm.label;
      }
    }
  }
  CORNER_CACHE.set(c.id, got);
  return got;
}

/** bounding box of a flattened path, in its own units */
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/* ★ THE NUMERALS ARE NOT IN THE SVG ANY MORE, and only the apex ticks are.
 *
 * Everything a corner mark used to be — a dot on the apex, a leader out of the
 * turn, and the number at the end of it — was drawn flat into the drawing. That
 * was right while the drawing was flat. It stops being right the moment the
 * layout is turned back 56° in space (see js/layout3d.js): a numeral lying on the
 * ground is foreshortened to two fifths of its height, and past about 70° of tilt
 * it is a horizontal line. The leader is worse, because it points along the
 * ground and the whole point of it was to get the number clear of the road.
 *
 * So this keeps what genuinely belongs ON the tarmac — the apex tick and the
 * start/finish bar — and the number itself becomes a real object standing over
 * its apex on a post, built by stage3d(). What is left here is drawn in the
 * artboard's own units and knows nothing about the third dimension.
 */
function roadMarks(c, sw) {
  const { pts, marks } = layoutCorners(c);
  if (!pts || !marks.length) return '';
  /* Belt and braces after the shapeFrame() NaN: nothing non-finite may reach an
     SVG geometry attribute. `d="MNaN NaN…"` and `r="NaN"` are parse errors Chrome
     logs once per element, and 16 circuits' worth of them buried a real check. */
  if (!Number.isFinite(sw) || sw <= 0) return '';

  const r = (v) => v.toFixed(1);
  const dots = marks.map(m =>
    `<circle class="c-dot" cx="${r(pts[m.i][0])}" cy="${r(pts[m.i][1])}" ` +
    `r="${r(sw * 0.42)}"></circle>`).join('');

  /* the start/finish line, struck across the road at the first node — the same
     convention §03's canvas figure uses, so the numbering starts in the same
     place in both */
  const n = pts.length;
  const p0 = pts[0], p1 = pts[3 % n];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const LL = Math.hypot(dx, dy) || 1;
  const gx = -dy / LL, gy = dx / LL;
  const half = sw * 0.62;
  const sf =
    `<path class="c-sf" d="M${r(p0[0] - gx * half)} ${r(p0[1] - gy * half)}` +
    `L${r(p0[0] + gx * half)} ${r(p0[1] + gy * half)}" ` +
    `stroke-width="${r(sw * 0.22)}"></path>`;

  return `<g class="corners">${sf}${dots}</g>`;
}

/** what the numbering on a layout means, said out loud under the drawing */
function cornerCaption(place) {
  const t = place.track || {};
  if (t.runway) return `${(t.runways || []).length} RUNWAYS · NO CORNERS`;
  if (!t.corners) return 'CORNERS NOT MEASURED';
  const c = circuitFor(place);
  const got = c ? layoutCorners(c).marks.length : 0;
  /* ★ If the drawing resolves fewer turns than the centreline measurement found,
     SAY SO rather than quietly numbering fewer. The count in the spec table is
     measured off the OSM centreline at 8-metre steps; the artwork is a different
     representation and can genuinely be smoother. Both numbers are true, and a
     reader counting the numerals on the drawing deserves to know why they do not
     reach fourteen. */
  if (got && got < t.corners) return `${t.corners} CORNERS · ${got} RESOLVED HERE`;
  return `${t.corners} CORNERS · NUMBERED FROM S/F`;
}

/* ★ THE GROUND UNDER THE LAP, AND IT IS NOT DECORATION.
 *
 * A closed loop turned back in space is genuinely ambiguous: with nothing else in
 * the frame the eye has no way to tell a tilted plan from a plan that has simply
 * been squashed vertically, and the layout reads as a squashed drawing rather
 * than as a thing lying on the floor. A regular grid resolves it in one glance,
 * because a regular grid seen in perspective is the one pattern everybody can
 * read the angle of. 1.x draws one behind its venue map for the same reason.
 *
 * Square cells, sized off the SHORT side and then laid across both, so the ground
 * reads as ground and not as a stretched checkerboard — the drawings run anywhere
 * from 1:1 to 3:1 and a grid derived per-axis would shear differently on each.
 */
function groundGrid(vb) {
  const step = Math.min(vb.w, vb.h) / 6;
  const r = (v) => v.toFixed(1);
  const lines = [];
  for (let x = Math.ceil(vb.x / step) * step; x < vb.x + vb.w; x += step) {
    lines.push(`M${r(x)} ${r(vb.y)}V${r(vb.y + vb.h)}`);
  }
  for (let y = Math.ceil(vb.y / step) * step; y < vb.y + vb.h; y += step) {
    lines.push(`M${r(vb.x)} ${r(y)}H${r(vb.x + vb.w)}`);
  }
  return `<path class="c-grid" d="${lines.join('')}" stroke-width="${r(step * 0.006)}"></path>` +
         `<rect class="c-edge" x="${r(vb.x)}" y="${r(vb.y)}" width="${r(vb.w)}" height="${r(vb.h)}"` +
         ` stroke-width="${r(step * 0.012)}"></rect>`;
}

/** big version of the traced layout, for the top of a circuit panel — in 3D */
function bigLayout(place) {
  const c = circuitFor(place);
  if (!c) return `<div class="p-shape p-shape--none mono">NO TRACED GEOMETRY</div>`;
  const d = shapeD(c);
  /* ★ "Make the track layout itself a bit wider." It was `sw * 0.9`, i.e. a hair
     under the weight the thumbnails use — and NaN for ten of the sixteen, see
     shapeFrame(). The road is now a dark bed at 2.6x with the accent laid down the
     middle of it at 1.9x, which reads as a track with a width rather than as a
     wire, and there is no fill inside the lap at all. */
  const sw = shapeFrame(c, 0).sw;
  const road = sw * 2.6, line = sw * 1.9;

  /* ★ THE BOX IS MEASURED OFF THE GEOMETRY, NOT OFF `art.vb`.
   *
   * Five of the drawn layouts carry a `transform` in the data — a translate/rotate
   * pair — and `art.vb` is the bounding box of the artwork AFTER it. This renderer
   * draws the raw `d` without that transform, so for Siljan, Borås, Piteå, Klippan
   * and Åsum the path genuinely lies outside its own stated viewBox.
   *
   * ★ The margin used to have to clear the corner NUMERALS, which were drawn into
   * the SVG outside the lap. They stand over the drawing now rather than beside
   * it — see roadMarks() and js/layout3d.js — so what is left to clear is the
   * width of the road and a little air, and the drawing gets correspondingly
   * bigger inside the same box. */
  const { pts, marks } = layoutCorners(c);
  let vb;
  if (pts && pts.length > 8) {
    const b = bbox(pts);
    const m = road / 2 + Math.max(b.w, b.h) * 0.05;
    vb = { x: b.x0 - m, y: b.y0 - m, w: b.w + m * 2, h: b.h + m * 2 };
  } else {
    const p = shapeFrame(c, 0.12).vb.split(/\s+/).map(Number);
    vb = { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  const r = (v) => v.toFixed(1);

  const svg = `<svg viewBox="${r(vb.x)} ${r(vb.y)} ${r(vb.w)} ${r(vb.h)}"
       preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${groundGrid(vb)}
      <path class="road" d="${d}" style="stroke-width:${road.toFixed(2)}"></path>
      <path class="line" d="${d}" style="stroke-width:${line.toFixed(2)}"></path>
      ${roadMarks(c, line)}
    </svg>`;

  /* the numbers, as objects in the scene rather than glyphs in the drawing */
  const marks3d = (pts && marks.length)
    ? marks.map((m, i) => ({ no: i + 1, label: m.label || null,
                             x: pts[m.i][0], y: pts[m.i][1] }))
    : [];

  return `<div class="p-shape p-shape--3d">
    ${stage3d(svg, vb, marks3d, `${esc((place.short || place.name).toUpperCase())} · 3D`)}
  </div>`;
}

const rowsHtml = (rows) => rows.map(([k, v, est]) =>
  `<div class="row"><span class="k mono">${k}</span><span class="dots"></span>` +
  `<span class="v num${est ? ' est' : ''}">${v}${est ? '<u>est.</u>' : ''}</span></div>`).join('');

/* ★ WHERE A CIRCUIT IS, WITHOUT SAYING HOW FAR IT IS.
 *
 * Theodor: "how long distance it is from a place — you don't really need to have
 * that. It's enough with saying where it is, like under coordinates. Say, like,
 * closest city." So the FROM UPPSALA row (`{distanceKm} km {compass}`) is gone
 * from both spec tables, the REACH bar with it, and the coordinates are followed
 * by the nearest city instead. A distance is only meaningful from one particular
 * driveway; a coordinate and a town are true for whoever is reading.
 *
 * `distanceKm`, `bearing` and `compass` remain in data/atlas.js — trace/extract.py
 * still computes them and that file is generated, so removing them there is a
 * data-pipeline change, not a page change. Nothing prints them now.
 */
/** the measured facts for any place, venue or reference circuit */
function placeRows(p) {
  const t = p.track || {};
  const rows = [
    ['COORDINATES', esc(p.coordLabel)],
    ['NEAREST CITY', esc(p.city)],
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

  const byCat = new Map(GEAR_CATS.map(c => [c, []]));
  for (const it of list.items) byCat.get(it.category)?.push(it);

  /* ★ PACKED OVER TOTAL, PER CATEGORY AND OVERALL.
   *
   * Theodor: "easier to see what have you packed, what have you not packed."
   *
   * A column of tick boxes answers that only by being counted, and counting a
   * column of tick boxes on a phone is exactly the work the page should be doing.
   * 1.x prints the same `picked / total` on each group header; this is that. */
  const groups = GEAR_CATS.filter(c => byCat.get(c).length).map(cat => {
    const items = byCat.get(cat);
    const picked = items.filter(i => i.on).length;
    return `
    <div class="p-cat"><div class="p-cat-h mono">${esc(cat)}
        <span class="n num${picked === items.length ? ' is-all' : ''}">${picked} / ${items.length}</span>
      </div>
      ${items.map(it => `
        <button class="p-item${it.on ? ' on' : ''}" type="button" data-gear="${esc(it.id)}"
                aria-pressed="${it.on}">
          <span class="tick" aria-hidden="true"></span>
          <span class="nm">${esc(it.name)}</span>
          ${it.rental ? '<span class="tag mono">RENTAL</span>' : ''}
          ${it.suggested ? '<span class="tag tag--dim mono">SUGGESTED</span>' : ''}
          <span class="qty num mono">${it.on ? '×' + it.qty : ''}</span>
        </button>`).join('')}
    </div>`;
  }).join('');

  const onItems = list.items.filter(i => i.on);
  const note = `${onItems.length} OF ${list.items.length} PACKED` +
    (list.total !== onItems.length ? ` · ${list.total} PIECES` : '');

  /* Anything ticked that he does not own has to be booked before the weekend, and
     that is a different kind of task from putting a battery in the bag. 1.x
     surfaces the same thing off bringHasRental. */
  const rentals = onItems.filter(i => i.rental);
  const rentalNote = rentals.length ? `
    <div class="p-rental">
      <b class="mono">ARRANGE RENTAL</b>
      <span>${rentals.map(r => esc(r.name)).join(' · ')}</span>
    </div>` : '';

  /* which inventory these boxes are ticking against — see kit() in js/gear.js */
  const src = list.source === 'own'
    ? 'YOUR KIT · EDITED IN 2.0 · TICKS SAVED PER DATE ON THIS DEVICE'
    : list.source === 'live'
      ? 'INVENTORY READ LIVE FROM FIELD ATLAS 1.x · TICKS SAVED ONLY IN 2.0'
      : 'INVENTORY RECOVERED FROM FIELD ATLAS 1.x · NO LIVE 1.x DATA ON THIS DEVICE'
        + ' · TICKS SAVED ONLY IN 2.0';

  return `<section class="p-sec" id="p-gear">${head}
    <div class="p-gear-sub mono">${note}</div>
    ${rentalNote}
    ${groups}
    <div class="p-src mono">${src}</div>
    <button class="p-out mono" type="button" data-route="gear">EDIT THE WHOLE KIT →</button>
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
          <div class="p-cap mono"><span>${sourceOf(circuitFor(v))}</span>
            <span>${cornerCaption(v)}</span></div>
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
        <div class="p-cap mono"><span>${esc(p.name).toUpperCase()} · ${sourceOf(circuitFor(p))}</span>
          <span>${cornerCaption(p)}</span></div></div>
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
    const sv = fig.solve();
    $('#fig-meta').textContent =
      `${t.lengthM ? nf(t.lengthM) + ' M' : '—'} · ${t.corners ?? '—'} CORNERS · ` +
      `${nf(sv.nodes)} NODES`;
    [...pick.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === o.id)));
    /* Give the canvas a beat to solve the line before reading its corners back.
       ★ The legend states that the road width is exaggerated. It has to: the line
       is solved inside a corridor 28px wide on screen, which at a 1 223 m lap is
       roughly six times the real 10 m track — without that sentence the figure
       looks like it is claiming a measurement it is not. */
    setTimeout(() => {
      const cs = fig.corners();
      /* ★ The degrees are TOTAL HEADING CHANGE through the turn, and the legend has
         to say so. They are not the corner's included angle and they are not
         bounded by 180° — a long same-direction sweep genuinely turns further than
         a hairpin. Verified against the closed-loop invariant: the signed turns
         plus the gentle bends below the threshold sum to the drawing's winding,
         360° at Gelleråsen and Rörken. (Before this session the same field was the
         sum of a ±3-node windowed curvature, which counted every segment about six
         times and once printed a 1371° corner.) */
      const note = o.cornerNames?.length
        ? 'NAMED CORNERS · FIELD ATLAS 1.x'
        : 'TURNS RANKED FROM THE DRAWN LAYOUT';
      /* ★ WHICH LINE THIS IS, SAID OUT LOUD. A minimum-curvature line and a
         minimum-time line look similar and mean different things — one is the
         biggest circle that fits, the other is where the stopwatch says to go, and
         only the second has late apexes in it. Where the lap-time stage could not
         run (no measured length to scale the drawing by, so no metres and no
         physics) the figure is still honest and says `GEOMETRIC` rather than
         quietly showing a different line under the same caption. */
      const s2 = fig.solve();
      const how = s2.mode === 'lap-time'
        ? `MINIMUM LAP TIME · ${esc(s2.car)} GRIP + POWER`
        : 'MINIMUM CURVATURE · NO MEASURED LENGTH TO SCALE BY';
      $('#fig-legend').innerHTML = cs.length
        ? cs.map(c => `<span><b>T${c.no}</b>${c.label ? ` ${esc(c.label)}` : ''}` +
                      `${c.turn != null ? ` · ${c.turn}°` : ''}</span>`).join('')
          + `<span style="color:var(--ink-4)">${note} · ° IS TOTAL HEADING CHANGE` +
            ` · ${how} · ROAD WIDTH EXAGGERATED</span>`
        : `<span style="color:var(--ink-4)">NO CORNERS — ${esc(o.name.toUpperCase())} IS AN AIR BASE</span>`;
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
  renderKit();

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
      if (route === 'gear') return kitPanel();   // one kit, so no id after it
      const slash = route.indexOf('/');
      const kind = route.slice(0, slash), id = route.slice(slash + 1);
      return kind === 'date' ? datePanel(id) : circuitPanel(id);
    },
    // the 3D layout needs live handlers, and the panel's HTML is a string — see
    // the note over createPanel() for why this hook exists rather than doing it
    // inside show()
    onAfterRender(body) { mount3d(body); },
  });

  document.addEventListener('click', (ev) => {
    /* §01's roster jumps to an entry rather than opening a panel. Handled here
       instead of letting the bare href do it, because a native hash jump lands
       the entry under the fixed top bar — and because writing #ev-… into the
       hash would make panel.js treat it as a route it does not recognise. */
    const jump = ev.target.closest('[data-jump]');
    if (jump) {
      ev.preventDefault();
      const target = document.getElementById(jump.dataset.jump);
      /* ★ A jump out of an OPEN panel has to close it first, and then wait. The
         panel locks the document scroll (`is-locked` on <html> and <body>), so
         scrolling while it is up does nothing at all — the click would read as
         dead. close() unlocks on the next hashchange, hence the frame. */
      if (panel.isOpen()) {
        panel.close();
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToEl(target, 18)));
      } else {
        scrollToEl(target, 18);
      }
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

  /* ------------------------------------------------ editing the kit itself
   * Everything here writes fa2.gear.inventory and nothing else. The evhub.* keys
   * are read-only to 2.0 for ever — see the rule at the top of js/gear.js.
   *
   * Three listeners rather than one because the controls are three kinds of
   * thing: a form submit for "add", `change` for the text and select fields
   * (which must NOT fire per keystroke), and `click` for the buttons.
   * ==================================================================== */
  const kitPanelOpen = () => panel.route() === 'gear';
  const idOf = (el) => el.closest('.kit-row')?.dataset.id || null;

  $('#panel').addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-kit="add"]');
    if (!form || !kitPanelOpen()) return;
    ev.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    addItem({ name, category: fd.get('category'), rental: fd.get('rental') != null, qty: 1 });
    panel.refresh();
    // put the cursor back where it was: adding kit is a run of several, not one
    $('#panel').querySelector('.kit-add .kit-nm, .kit-add input[name=name]')?.focus();
  });

  $('#panel').addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-kit]');
    if (!el || !kitPanelOpen()) return;
    const id = idOf(el);
    if (!id) return;
    if (el.dataset.kit === 'rename') {
      /* deliberately NOT refreshing: the field already shows what was typed, and
         re-rendering the panel under a focused input takes the caret with it */
      renameItem(id, el.value);
      renderKit();
      return;
    }
    if (el.dataset.kit === 'cat') { setCategory(id, el.value); panel.refresh(); renderKit(); }
  });

  $('#panel').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-kit]');
    if (!el || !kitPanelOpen()) return;
    const act = el.dataset.kit;

    if (act === 'adopt-these') { adopt(kit().items); panel.refresh(); renderKit(); return; }
    if (act === 'adopt-empty') { adopt([]); panel.refresh(); renderKit(); return; }

    const id = idOf(el);
    if (!id) return;
    const item = kit().items.find(i => i.id === id);
    if (!item) return;

    if (act === 'rental') setRental(id, !item.rental);
    else if (act === 'qty+') setQty(id, item.qty + 1);
    else if (act === 'qty-') setQty(id, item.qty - 1);
    else if (act === 'del') deleteItem(id);
    else return;

    panel.refresh();
    renderKit();          // §05 is showing the same list; keep the two in step
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
    /* §01's roster and §02's entries both carry one of these per date, so this
       runs over 16 nodes a second. Write only what actually changed: the text
       every second, the colour perhaps twice a season. An unconditional
       style.color assignment on every node every tick is a style
       invalidation the page then has to resolve, and it bought nothing. */
    for (const n of cdNodes) {
      const e = EVENTS.find(x => x.key === n.dataset.cd);
      if (!e) continue;
      const c = countdown(e, now);
      if (n.textContent !== c.text) n.textContent = c.text;
      const col = c.state === 'past' ? 'var(--ink-4)'
        : (c.state === 'live' ? 'var(--accent)' : 'var(--ink-2)');
      if (n.dataset.cdCol !== col) { n.style.color = col; n.dataset.cdCol = col; }
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
    `— END OF CATALOGUE · ${ALL.length} CIRCUITS · ${EVENTS.length} DATES · ` +
    `${kit().items.length} ITEMS OF KIT`;

  /* --- the pills --- */
  /* ★ MOTION IS ON BY DEFAULT NOW, AND THE CHOICE IS REMEMBERED.
   *
   * Theodor: "make motion as a standard option, because every time I go in on the
   * side the motion is switched off."
   *
   * He was not forgetting to press it and the pill was not broken. This was
   * `let motion = !prefersStill` and nothing else — the OS media query was read
   * fresh on every single load and the reader's answer was never written down
   * anywhere. Windows reports `prefers-reduced-motion: reduce` whenever Settings
   * → Accessibility → Visual effects → Animation effects is off, which is a
   * common default on a managed machine, so the page booted still every time on
   * both his devices. trace/verify.mjs had already run into the same split
   * between headless Chrome on Windows and on macOS and pinned the media feature
   * in the TEST rather than fixing the app.
   *
   * So the OS preference is now the FIRST-RUN HINT ONLY, and the stored answer
   * wins ever after. Overriding an accessibility setting by default is a real
   * cost and it is paid deliberately, on three conditions: the opt-out is one
   * tap, it is in the topbar on every screen at every width (see the 460px block
   * in app.css, which now drops the chapter readout rather than this control),
   * and it sticks. And on the one cold load where 2.0 overrules a reader who did
   * ask for less motion, the pill wears the accent so the override is something
   * they can see rather than something done quietly behind them. */
  const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let motionSaved = null;
  try { motionSaved = localStorage.getItem('fa2.motion'); } catch {}
  let motion = motionSaved ? motionSaved === 'on' : true;
  const motionPill = $('#pill-motion');
  if (!motionSaved && prefersStill) motionPill.classList.add('pill--flag');
  const applyMotion = () => {
    document.body.classList.toggle('no-motion', !motion);
    motionPill.setAttribute('aria-pressed', String(motion));
    stars.setMotion(motion); globe.setMotion(motion);
    fig.setMotion(motion); scroll.setMotion(motion);
  };
  motionPill.addEventListener('click', () => {
    motion = !motion;
    motionPill.classList.remove('pill--flag');   // answered, either way
    try { localStorage.setItem('fa2.motion', motion ? 'on' : 'off'); } catch {}
    applyMotion();
  });
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
