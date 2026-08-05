/* ===========================================================================
 * main.js — Field Atlas 2.0
 *
 * Builds every section from data/atlas.js (generated from Field Atlas 1.x by
 * trace/extract.py) and wires the four moving parts: starfield, globe, circuit
 * figure, scroll. Nothing here invents a fact — copy lives in COPY below and is
 * clearly editorial; every number on the page comes from the data module.
 * ======================================================================== */

import { VENUES, TRACKS, HOME } from '../data/atlas.js';
/* ★ The one data module that is NOT generated — read its header before adding a
   row. It is empty on purpose; §03's atlas is built to take it at any length. */
import { EXTRA_TRACKS } from '../data/atlas-extra.js';
import { createStarfield } from './starfield.js';
import { createGlobe, ATLAS_ZOOM_MAX } from './globe.js';
import { createCircuitFigure } from './circuit.js';
import { loopPath, loopLength, layoutPath, hasRadii, flattenPath,
         curvature, numberedCorners, cornerRuns } from './loop.js';
import { initReveal, initScroll } from './scroll.js';
import { createPanel } from './panel.js';
import { stage3d, tierMarks, poseFit, mount as mount3d } from './layout3d.js';
import { packingList, setOverlay, overlay, plan1x, eventKey, GEAR_CATS, kit,
         adopt, addItem, renameItem, setCategory, setRental, setQty, deleteItem,
         GEAR_CATALOGUE, catalogueLeft, addFromCatalogue } from './gear.js';

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
/* ★ THE UNITS ARE SPELT OUT NOW, and one of them was genuinely unreadable.
 *
 * Theodor, on a date's TECHNICAL bar: "13.1 c/km — like, what is that? Ten
 * corners, or what is that?"
 *
 * It was corners per kilometre, and there was nothing on the page that said so.
 * `c/km` is the sort of abbreviation that is obvious to whoever wrote the line and
 * to nobody else: `c` is not a unit anyone has met, and next to `m` two rows below
 * it reads as another length. The bar's whole design is that the index is never
 * taken on trust — the real quantity is printed beside it — and a quantity in a
 * unit the reader has to guess at is not printed at all.
 *
 * `d` for days went the same way, for the same reason and with less excuse. The
 * value column is `auto`, so both simply take the width they need. */
function bars(e) {
  const t = e.venue.track || {};
  const days = e.days || 1;
  const dur = ['DURATION', days / 3 * 100, String(days), days === 1 ? 'day' : 'days'];
  const out = [];
  if (t.corners && t.lengthM) {
    const dens = t.corners / (t.lengthM / 1000);
    out.push(['TECHNICAL', dens / MAX.density * 100, dens.toFixed(1), 'corners/km']);
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

  /* ★ The catalogue is named here, in the chapter, and not only in the panel.
     §05 is the essay about the kit and the panel is the tool, so a shelf of
     equipment that is not in the list yet is a fact about the kit and belongs in
     the essay — and the reader has to know it exists to go and open it. The
     sentence disappears when the shelf is empty rather than reading "0 more". */
  const shelfLeft = catalogueLeft(k.items).length;
  $('#kit-lede').textContent =
    `${owned.length} pieces of equipment I own, ${rental.length} I would hire, and the ` +
    `basics that live in the bag. Every date in §02 draws its packing list from this same ` +
    `inventory — the kit is one list, the weekend is a selection from it.` +
    (shelfLeft ? ` ${shelfLeft} more are on the shelf in EDIT YOUR KIT, a press each.` : '');
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

  /* ★ THE SHELF — see GEAR_CATALOGUE in js/gear.js for what is on it and what was
     deliberately left off. It is a list of things this page does NOT claim he owns,
     which is exactly why it cannot live in the recovered 1.x inventory: that array's
     whole value is that §05 can say "your equipment" and be telling the truth.
     Rows already in the kit are filtered out by name, so the shelf empties as it is
     used and disappears when there is nothing left to offer. */
  const left = catalogueLeft(k.items);
  const shelf = !left.length ? '' : `
    <details class="kit-shelf" ${k.owned ? '' : 'open'}>
      <summary class="mono">ADD FROM CATALOGUE<span class="n num">${left.length}</span></summary>
      <p class="kit-shelf-note">Equipment that is not in the list yet. The tag is what it
      arrives as — glass you would hire, everything else you would buy and keep — and one
      press in the row above flips it either way.</p>
      ${left.map(c => `
        <div class="kit-offer">
          <span class="nm">${esc(c.name)}${c.qty > 1 ? ` <span class="num mono">×${c.qty}</span>` : ''}</span>
          <span class="kit-offer-cat mono">${esc(c.category)}</span>
          <span class="tag mono${c.rental ? '' : ' tag--own'}">${c.rental ? 'RENTAL' : 'OWNED'}</span>
          <button class="kit-add-one" type="button" data-kit="offer" data-offer="${esc(c.id)}"
                  aria-label="Add ${esc(c.name)} to your kit">+</button>
        </div>`).join('')}
    </details>`;

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
    ${shelf}
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

/* ★ THE FIGURE IS SIZED TO THE CIRCUIT, NOT THE CIRCUIT TO THE FIGURE.
 *
 * Theodor: "the circuit is really small for the area itself. What I want is the
 * 3D track map, but with the racing line in that area — so you can interact with
 * it, and you also see the racing line on the track itself."
 *
 * Two separate things were making it small, and only one of them was the box. The
 * other was the fit: the corner numerals used to be drawn into the canvas outside
 * the lap, so js/circuit.js reserved up to 118px on every side for them and the
 * drawing took whatever was left — see ROOM there. With the numbers standing over
 * the drawing on posts, that reserve is gone.
 *
 * What is left is genuinely a box problem, and it is the one poseFit() solves. A
 * plane turned back 56° foreshortens to about 56% of its height, so a 3:1
 * Gelleråsen laid on it projects to roughly a quarter of a fixed 560px stage — the
 * empty graph paper under the drawing was the other three quarters. Rather than
 * magnify the drawing past the width it has, the stage is sized to what the pose
 * actually occupies: the plane takes the width, and the height follows from the
 * projection plus the room the tallest post needs. Nothing is reserved that
 * nothing can use.
 *
 * Everything here is re-run on resize, because every term in it is a length.
 */
function layoutFigure(fig) {
  const host = $('#fig-3d'), plane = $('#fig-plane');
  const stage = host.querySelector('.p3d-stage');
  if (!host || !plane || !stage) return;

  /* the plane's share of the stage — the CSS default is `min(92%, 940px)` and this
     has to agree with it, so both live in one expression and app.css defers */
  const availW = Math.min(stage.clientWidth * 0.92, 940);
  /* the tallest the figure may be. Portrait circuits are limited by this rather
     than by the width — poseFit() inverts for it, and Uddevalla is why: at 3:5 it
     wants a 1 180px plane, and clipped its own turn 6 off the top of the stage
     before the height was fed back in. `1.18` is the breathing room the stage adds
     below, so what poseFit() is given is the room the POSE actually has. */
  const roof = Math.min(window.innerHeight * 0.68, 720);
  const pose = poseFit(fig.aspect(), Math.max(80, availW), roof / 1.12);

  /* ★ THE PLANE'S WIDTH IS WRITTEN IN PIXELS, not left at the CSS percentage.
     A tall circuit's plane has to be NARROWER than the stage, because the Z
     rotation swings its height out sideways — poseFit() is what knows by how much,
     and a percentage width plus an aspect-ratio would put the answer back in the
     browser's hands and let a portrait lap run off both edges. */
  host.style.setProperty('--fig-pw', pose.w.toFixed(1) + 'px');
  plane.style.aspectRatio = `${pose.w.toFixed(2)} / ${pose.h.toFixed(2)}`;
  /* 1.12: the plane is nudged down 8% of its own height before the rotation (see
     .p3d-plane) and the reader can zoom in on it, so the box carries a little more
     than the still pose needs. Floored so a very wide lap still reads as a figure
     rather than a strip and still has room to be dragged, and capped so a portrait
     one cannot eat the viewport. */
  host.style.setProperty('--fig-h',
    Math.round(Math.max(280, Math.min(pose.screenH * 1.12, roof))) + 'px');
  // in real pixels here, where stage3d() works in artboard units — same 0.095
  host.style.setProperty('--lift', (Math.max(pose.w, pose.h) * 0.095).toFixed(2) + 'px');

  /* reading offsetWidth inside resize() flushes the layout above, so the canvas
     measures the plane it has just been given rather than the previous one */
  fig.resize();
  renderFigMarks(fig, pose);
}

/** the corner numbers, as objects standing over their own apexes on the plane */
function renderFigMarks(fig, pose) {
  const box = $('#fig-marks');
  if (!box) return;
  const marks = fig.marks();
  /* tiered in PLANE PIXELS, so "these two corners are crowded" is the same
     judgement here as in the panel — see tierMarks() in js/layout3d.js */
  const ks = tierMarks(marks.map(m => ({ x: m.x * pose.w, y: m.y * pose.h })),
                       Math.max(pose.w, pose.h));
  const pct = (v) => (v * 100).toFixed(3) + '%';
  /* ★ THE NUMBER ONLY — no corner NAME on the post, where the panel's layouts
     carry one. Two reasons and the second is the real one. A name box is five to
     eight times the width of a numeral, and §03's plane on a phone is ~305px
     across: TRÖSKURVAN, EJES KURVA and DEPÅKURVAN alone covered half the circuit
     and each other, which is worse than the crowding the tiers exist to fix. And
     it is redundant here in a way it is not in the panel — #fig-legend, directly
     under this figure, already prints every name against its number and its
     angle. The panel's layout has no legend beneath it, so there the name has
     nowhere else to be. */
  box.innerHTML = marks.map((m, i) => `
    <div class="p3d-mark" style="left:${pct(m.x)};top:${pct(m.y)};--k:${ks[i]}">
      <i class="p3d-post" aria-hidden="true"></i>
      <b class="p3d-no"><span>${m.no}</span></b>
    </div>`).join('');
  box.dataset.marks = String(marks.length);
}

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
    /* ★ load() no longer fits or solves — this does, once, after the stage has
       been resized to the new circuit's shape. Doing it the other way round solved
       the racing line into the OLD circuit's box and then again into the new one:
       two lap-time searches, a fifth of a second each, for one tap. */
    layoutFigure(fig);
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

/* ========================================================= §03 · THE ATLAS
 * ★ WHERE THE GLOBE WENT, AND WHY IT IS BETTER OFF HERE.
 *
 * Theodor: "when I'm zooming in on the globe, I feel like you should be able to
 * maybe have a separate section for that… remove the interactive thing on the
 * main page where you load in, because that's just weird." And, on where it
 * should go instead: "in the same section as the anatomy, but just a different
 * tab in the same area."
 *
 * The hero's globe was a background that turned out to be a control, which is
 * the wrong way round: it had to be discovered, it needed a line of type to
 * advertise itself, it could not be zoomed past 4.2x because eight pins had to
 * stay separable behind a page of body copy, and on a phone it lay directly
 * under the lede. Every one of those constraints came from being a backdrop.
 *
 * Here it is the subject. The stage is its own element, so it takes its own
 * pointers and #globe-hit is gone with the reason for it (see app.css). Nothing
 * is behind it, so it runs to ATLAS_ZOOM_MAX rather than 4.2. And because it has
 * a box rather than a viewport, the raster covers what is on screen instead of a
 * disc mostly hanging off the edge — which is most of why it is sharp.
 *
 * ★ THE LIST IS NOT A SECOND §04. §04 is the reference layer read as prose —
 * shapes, lap lengths, corner counts. This is the same circuits read as
 * POSITIONS, and its only jobs are to find one by name and to fly the camera to
 * it. Both surfaces open the identical panel, from the identical route.
 * ====================================================================== */

/**
 * Every plotted circuit, in one shape, from the three places they come from.
 *
 * ★ `ranked` IS WHETHER THERE IS ANYTHING TO OPEN. A venue and a competition
 * circuit have traced geometry behind them and a panel worth showing; a row from
 * data/atlas-extra.js is a name and a coordinate and nothing else. Rather than
 * open an empty panel and call it a feature, those rows are marked PLOTTED and
 * are not pressable. See the header of that file.
 */
function atlasRows() {
  const rows = [];
  const nx = nextEvent();
  for (const v of VENUES) {
    const e0 = EVENTS.find(x => x.venue.id === v.id);
    rows.push({
      id: v.id, name: v.name, label: (v.short || v.name).replace(/\s*\(.*\)/, ''),
      city: v.city, lat: v.lat, lon: v.lon,
      type: e0?.type || 'karting', accent: v.accent,
      event: true, ranked: true, next: !!nx && nx.venue.id === v.id,
      route: e0 ? 'date/' + e0.key : 'circuit/' + v.id,
    });
  }
  for (const t of TRACKS) {
    rows.push({
      id: t.id, name: t.name, label: t.name.replace(/\s*\(.*\)/, ''),
      city: t.city, lat: t.lat, lon: t.lon,
      type: 'karting', event: false, ranked: true, route: 'circuit/' + t.id,
    });
  }
  for (const x of EXTRA_TRACKS) {
    rows.push({
      id: x.id, name: x.name, label: String(x.name).replace(/\s*\(.*\)/, ''),
      city: x.city, lat: x.lat, lon: x.lon,
      /* an unknown discipline falls back rather than throwing — the file is
         hand-maintained, so a typo there must not take the section down */
      type: DISCIPLINE[x.kind] ? x.kind : 'karting',
      event: false, ranked: false, route: null,
    });
  }
  return rows;
}

function mountAtlas(panel) {
  const host = $('#atlas'), stage = $('#atlas-stage'), cv = $('#atlas-globe');
  if (!host || !stage || !cv) return null;

  const rows = atlasRows();
  const byId = new Map(rows.map(r => [r.id, r]));

  /* Sweden in the middle of the box at a first glance, because that is where the
     season is. The camera is the reader's from the first drag onward. */
  const globe = createGlobe(cv, {
    lon: 15.5, lat: 59, zoomMax: ATLAS_ZOOM_MAX, labels: true,
  });
  globe.setPins(rows.map(r => ({
    id: r.id, lat: r.lat, lon: r.lon, color: r.accent,
    event: r.event, ranked: r.ranked, next: r.next, label: r.label,
  })), HOME);

  /* ---------------------------------------------------- the chrome it owns */
  const meta = $('#atlas-meta'), hintEl = $('#atlas-hint'), srcEl = $('#atlas-src');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  hintEl.textContent = coarse
    ? 'DRAG · PINCH TO ZOOM · TAP A CIRCUIT'
    : 'DRAG · CTRL-SCROLL TO ZOOM · CLICK A CIRCUIT';

  const measured = rows.filter(r => r.ranked).length;
  srcEl.textContent = rows.length === measured
    ? `${measured} CIRCUITS · EVERY ONE MEASURED`
    : `${rows.length} CIRCUITS · ${measured} MEASURED · ${rows.length - measured} PLOTTED`;

  function syncChrome() {
    const z = globe.zoom();
    host.classList.toggle('is-moved', z > 1.02);
    meta.textContent = `${rows.length} PINNED · ${globe.mode().toUpperCase()} · ` +
      `${z < 10 ? z.toFixed(1) : Math.round(z)}×`;
  }
  globe.onZoom = syncChrome;

  /* ---------------------------------------------------------- the two views */
  host.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-atlas]');
    if (!btn) return;
    const what = btn.dataset.atlas;
    if (what === 'reset') { globe.resetView(); syncChrome(); return; }
    globe.setMode(what);
    for (const b of host.querySelectorAll('.atlas-modes button')) {
      b.setAttribute('aria-pressed', String(b.dataset.atlas === globe.mode()));
    }
    syncChrome();
  });

  /* ======================================================= the reader's hands
   * ★ TWO INPUT PATHS, AND THE SPLIT IS FORCED BY `touch-action: pan-y`.
   *
   * Carried over from the hero wholesale, because the reasoning is unchanged and
   * it was expensive to find. Pointer events handle the mouse, the pen and a
   * single finger perfectly, and they do NOT handle the pinch: while
   * `touch-action` still permits the browser a gesture of its own, Chrome hands
   * the page only the FIRST touch point as a pointer — measured, a genuine
   * two-finger spread produced exactly one `pointerdown`. The legacy Touch Events
   * API has no such problem; `ev.touches` carries every contact regardless.
   *
   * And `touch-action: none` is not the fix. This stage is as tall as a phone and
   * sits in the middle of a scrolling page, so owning every vertical drag would
   * make it a place the page stops. Same bargain §03's other stage strikes.
   *
   * ★ WHAT IS DIFFERENT FROM THE HERO: one element. There is no scrim over this
   * canvas, so nothing has to be painted under one layer and hit above another,
   * and the whole #globe-hit apparatus simply does not arise.
   * ==================================================================== */
  const at = (ev) => {
    const r = stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const pinAt = (ev) => {
    const p = at(ev);
    const hit = globe.hitTest(p.x, p.y, coarse ? 18 : 14);
    /* a plotted-only row has no panel behind it, so it is not a target — see
       atlasRows(). It still draws, still labels, and still turns up in the list. */
    return hit && byId.get(hit.id)?.ranked ? hit : null;
  };
  const openPin = (pin) => {
    const row = byId.get(pin.id);
    if (row?.route) panel.openFrom(row.route, cv);
  };

  const down = new Map();
  let moved = 0, downAt = 0, turning = false, pinching = false, pinchSpan = 0;
  const spanOf = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  /* ★ THE BAR IS NOT PART OF THE GLOBE, AND POINTER CAPTURE CANNOT TELL.
     GLOBE / MAP / RESET VIEW sit inside the stage, so their pointerdown bubbles
     to it — and `setPointerCapture` then retargets every later event, INCLUDING
     THE CLICK, to the stage. The buttons were drawn, were hit-testable, and did
     nothing at all: pressing MAP turned the planet a pixel instead. Exactly the
     failure the hero's RESET VIEW had two sessions ago for the mirror-image
     reason, and just as silent. So a press that starts on the chrome is the
     chrome's, and the globe never hears about it. */
  const onChrome = (ev) => !!ev.target.closest('.atlas-bar');

  stage.addEventListener('pointerdown', (ev) => {
    if (onChrome(ev)) return;
    down.set(ev.pointerId, at(ev));
    stage.setPointerCapture(ev.pointerId);
    globe.setGesture(true);
    moved = 0; downAt = performance.now(); turning = false;
  });

  stage.addEventListener('pointermove', (ev) => {
    if (!down.has(ev.pointerId)) {
      stage.classList.toggle('is-over-pin', !onChrome(ev) && !!pinAt(ev));
      return;
    }
    const p = at(ev);
    const prev = down.get(ev.pointerId);
    down.set(ev.pointerId, p);
    if (pinching) { moved = 99; return; }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    moved += Math.hypot(dx, dy);
    /* ★ A few pixels of slop before this becomes a turn. A tap on a pin is never
       perfectly still — least of all a thumb — and treating the first stray pixel
       as a drag would move the planet away from whatever was being pressed. */
    if (moved > 5) {
      turning = true;
      stage.classList.add('is-grabbing');
      globe.turnBy(dx, dy);
      host.classList.add('is-moved');
    }
  });

  const endPointer = (ev) => {
    if (!down.has(ev.pointerId)) return;
    down.delete(ev.pointerId);
    if (down.size) return;
    globe.setGesture(false);
    stage.classList.remove('is-grabbing');
    if (ev.type === 'pointerup' && !turning && !pinching && moved <= 5 &&
        performance.now() - downAt < 600) {
      const pin = pinAt(ev);
      if (pin) openPin(pin);
    }
    turning = false;
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener('touchstart', (ev) => {
    if (ev.touches.length < 2) return;
    pinching = true;
    pinchSpan = spanOf(ev.touches);
    globe.setGesture(true);
  }, { passive: true });

  stage.addEventListener('touchmove', (ev) => {
    if (ev.touches.length < 2) return;
    /* Not passive, and it must not be: two fingers spreading is this stage's own
       gesture, and without claiming it the browser can still decide halfway
       through that it was a scroll. */
    ev.preventDefault();
    const span = spanOf(ev.touches);
    if (pinchSpan > 8 && span > 8) {
      const r = stage.getBoundingClientRect();
      globe.zoomBy(span / pinchSpan,
        (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left,
        (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top);
    }
    pinchSpan = span;
  }, { passive: false });

  const endPinch = (ev) => {
    if (!pinching) return;
    if (ev.touches.length >= 2) { pinchSpan = spanOf(ev.touches); return; }
    if (ev.touches.length) return;
    pinching = false;
    if (!down.size) globe.setGesture(false);
  };
  stage.addEventListener('touchend', endPinch);
  stage.addEventListener('touchcancel', endPinch);

  /* ★ HELD BEHIND A MODIFIER, exactly as §03's other stage is. A stage this tall
     that swallowed the plain wheel would be a hole the reader's scroll falls into
     halfway down the page. ctrl/⌘ is also what a trackpad pinch sends, so the
     gesture that means zoom everywhere else means zoom here.
     0.0012 is measured, not picked: a mouse notch is deltaY ≈ 120, which this
     turns into 1.15x, so a full sweep of the range is a couple of dozen notches
     rather than six. */
  stage.addEventListener('wheel', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const p = at(ev);
    globe.zoomBy(Math.exp(-ev.deltaY * 0.0012), p.x, p.y);
  }, { passive: false });

  /* ★ AND THE KEYBOARD, which the hero never had. The stage is focusable, so it
     has to do something once it is focused — arrows turn, +/− zoom, 0 resets, and
     Enter opens whatever is nearest the middle. Otherwise a tab stop that swallows
     the arrow keys and gives nothing back is worse than no tab stop at all. */
  stage.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 60 : 18;
    let used = true;
    if (ev.key === 'ArrowLeft') globe.turnBy(step, 0);
    else if (ev.key === 'ArrowRight') globe.turnBy(-step, 0);
    else if (ev.key === 'ArrowUp') globe.turnBy(0, -step);
    else if (ev.key === 'ArrowDown') globe.turnBy(0, step);
    else if (ev.key === '+' || ev.key === '=') globe.zoomBy(1.3, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (ev.key === '-' || ev.key === '_') globe.zoomBy(1 / 1.3, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (ev.key === '0') globe.resetView();
    else used = false;
    if (used) { ev.preventDefault(); host.classList.add('is-moved'); syncChrome(); }
  });

  /* ------------------------------------------------- the list, and finding one */
  const listEl = $('#atlas-list'), filterEl = $('#atlas-filters'), searchEl = $('#atlas-search');
  const types = [...new Set(rows.map(r => r.type))];
  const off = new Set();                       // disciplines currently switched OFF

  filterEl.innerHTML = types.map(t =>
    `<button type="button" data-type="${esc(t)}" aria-pressed="true">${esc(DISCIPLINE[t] || t)}</button>`
  ).join('');

  function visible() {
    const q = searchEl.value.trim().toLowerCase();
    return rows.filter(r =>
      !off.has(r.type) &&
      (!q || r.name.toLowerCase().includes(q) || (r.city || '').toLowerCase().includes(q)));
  }

  function renderList() {
    const list = visible();
    listEl.innerHTML = list.length ? list.map(r => `
      <button class="atlas-row" type="button" role="option" aria-selected="false"
              data-row="${esc(r.id)}" style="--k:var(${HUE[r.type] || '--accent'})">
        <span class="dot"></span>
        <span class="nm">${esc(r.name)}</span>
        <span class="cy">${esc(r.ranked ? (r.city || '') : 'PLOTTED')}</span>
      </button>`).join('')
      : '<p class="atlas-empty">Nothing by that name. The atlas holds every circuit ' +
        'in §02 and §04 — try a town instead.</p>';
    /* the pin set follows the filters, so what is on the globe and what is in the
       list are the same answer to the same question and cannot drift apart */
    globe.setPins(list.map(r => ({
      id: r.id, lat: r.lat, lon: r.lon, color: r.accent,
      event: r.event, ranked: r.ranked, next: r.next, label: r.label,
    })), HOME);
  }

  filterEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-type]');
    if (!b) return;
    const t = b.dataset.type;
    off.has(t) ? off.delete(t) : off.add(t);
    b.setAttribute('aria-pressed', String(!off.has(t)));
    renderList();
  });

  searchEl.addEventListener('input', renderList);

  listEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-row]');
    if (!b) return;
    const r = byId.get(b.dataset.row);
    if (!r) return;
    for (const o of listEl.querySelectorAll('[data-row]')) o.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-selected', 'true');
    globe.focus(r.id);
    globe.goTo(r.lat, r.lon);
    host.classList.add('is-moved');
    syncChrome();
  });

  /* a second press on the row already selected opens it — one press to find it on
     the globe, one to read it, which is the same two-step §04's cells are not
     asked to make because they are not also a map */
  listEl.addEventListener('dblclick', (ev) => {
    const b = ev.target.closest('[data-row]');
    const r = b && byId.get(b.dataset.row);
    if (r?.route) panel.openFrom(r.route, b);
  });

  renderList();
  syncChrome();

  return {
    globe,
    resize() { globe.resize(); },
  };
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

/* ============================================================== CHAPTER JUMP
 * ★ THE ONE PIECE OF NAVIGATION THIS PAGE DID NOT HAVE.
 *
 * Theodor: "it's a lot of scrolling on this website — the kit itself, I could just
 * press KIT at the top right and it gives me the kit. Maybe it's good with a main
 * page where all the chapters are."
 *
 * Two readings of that, and the cheap one is right. A home page in front of a page
 * whose entire form is one descent through six chapters would be a second front
 * door onto a building that is already a corridor — and it would put a click
 * between the reader and the hero, which is the best thing here. What KIT actually
 * demonstrated is narrower and it is the thing that was missing: a way OUT of the
 * middle of the scroll, from wherever you happen to be, in the bar that is on
 * screen at every scroll position anyway.
 *
 * So the chapter readout — which has always been in that bar, reporting §03 while
 * you read §03 — opens. It is the same fixture doing the same job with one more
 * verb attached, and the bar grows nothing.
 *
 * ★ THE RUNNING ORDER IS READ FROM THE DOCUMENT, never retyped. Every entry comes
 * from a `section[data-chapter]` and its own `data-chapter`/`data-title`, which are
 * the same two attributes js/scroll.js reads to write the label. Adding §06 to
 * index.html adds it here, correctly numbered, with nothing else touched — and
 * there is no second copy of the running order to fall out of step with the first.
 * ======================================================================== */
function initChapterNav() {
  const trigger = $('#chapter-jump');
  const menu = $('#chapter-menu');
  const sections = [...document.querySelectorAll('section[data-chapter]')];
  if (!trigger || !menu || !sections.length) return { mark() {} };

  const items = sections.map((sec) => {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.id = sec.id;
    b.setAttribute('aria-current', 'false');
    b.innerHTML = `<span class="n">${esc(sec.dataset.chapter || '')}</span>` +
                  `<span class="t">${esc(sec.dataset.title || sec.id)}</span>` +
                  `<span class="at" aria-hidden="true"></span>`;
    /* focus goes back to the trigger, not to the destination. The row is about to
       be `display:none` and focus would fall to <body>, which strands a keyboard
       reader at the top of a page they just asked to be moved down; the trigger is
       in the fixed bar, so it is on screen wherever the jump landed. */
    b.addEventListener('click', () => { close(true); scrollToEl(sec, 8); });
    menu.appendChild(b);
    return b;
  });

  let open = false;
  let opened = -1e9;              // when, for the scroll-dismiss grace window

  /* `hidden` is toggled on either side of the transition rather than instead of
     it: `display:none` cannot animate, and a menu that is only faded out still
     answers the pointer and still takes tab focus. One frame's delay on the way in
     is what lets the opening transform run at all. */
  function show() {
    if (open) return;
    open = true;
    opened = performance.now();
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close(focusTrigger) {
    if (!open) return;
    open = false;
    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    /* No motion means no transitionend — app.css turns the transition off wholesale
       for `body.no-motion` — so the hide is on a timer that beats it either way. */
    setTimeout(() => { if (!open) menu.hidden = true; }, 200);
    if (focusTrigger) trigger.focus();
  }

  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    open ? close() : show();
  });
  /* Down-arrow from the closed trigger opens and lands on the first row, which is
     what a reader who is already on the keyboard will try before anything else. */
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      show();
      requestAnimationFrame(() => items[ev.key === 'ArrowUp' ? items.length - 1 : 0].focus());
    }
  });

  menu.addEventListener('keydown', (ev) => {
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const d = ev.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length].focus();
    } else if (ev.key === 'Home') { ev.preventDefault(); items[0].focus(); }
    else if (ev.key === 'End') { ev.preventDefault(); items[items.length - 1].focus(); }
  });

  /* Escape and a click anywhere else, on the document rather than on a scrim: the
     panel already owns a full-screen overlay and a second one under the topbar
     would eat the very clicks — a pill, a link in the page — that ought to close
     this and do their own job in the same gesture. `capture` so it still fires
     when the click lands on something that stops propagation on the way up. */
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && open) close(true); });
  document.addEventListener('click', (ev) => {
    /* `contains`, not `===`: the trigger wraps a span and an svg, so a click on the
       chevron has the PATH as its target and an identity test would read it as an
       outside click — close here, reopen in the trigger's own handler a moment
       later, and the menu would refuse to shut when you pressed the arrow. */
    if (open && !menu.contains(ev.target) && !trigger.contains(ev.target)) close();
  }, true);
  /* Tabbing out closes it. `aria-haspopup` promises a menu and a menu that stayed
     open behind the reader while they tabbed on into the page would go on covering
     §00 with six buttons nobody could see the purpose of. `focusout` fires before
     the new element takes focus, hence the frame. */
  menu.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (open && a !== trigger && !menu.contains(a)) close();
    });
  });
  /* The reader scrolled: the readout under the menu is about to say something
     else, and a popover anchored to a label that has changed reads as stuck. The
     grace window is for the scroll the menu ITSELF starts — scrollToEl is smooth,
     so its events arrive after close() has already run, but a deep-link re-aim or
     a fling still in flight when the menu opens would otherwise shut it at once. */
  window.addEventListener('scroll', () => {
    if (open && performance.now() - opened > 400) close();
  }, { passive: true });

  return {
    /** paint the row for the chapter the reader is actually in */
    mark(id) {
      items.forEach(b => b.setAttribute('aria-current', String(b.dataset.id === id)));
    },
  };
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
  /* §03's stage is in index.html rather than in a panel string, so it is wired
     once, here — the panel's own layouts are wired per render in onAfterRender */
  mount3d(document);
  initReveal();

  /* --- paint gating -------------------------------------------------------
   * Two independent reasons a canvas should stop: the tab is hidden, and the
   * §03 figure is nowhere near the viewport. They have to be combined in one
   * place, or returning to the tab resumes a figure that is still off-screen.
   *
   * ★ Declared BEFORE initScroll rather than after it. The scroll reader answers
   * the second of those questions now (see `onNear` in js/scroll.js) and it
   * answers it once during its own construction, so a `const` below this point
   * would be read inside its own temporal dead zone.
   * ---------------------------------------------------------------------- */
  /* ★ AND A THIRD REASON NOW: §03 HOLDS TWO CANVASES AND ONLY ONE MAY RUN.
     The racing line and the atlas share a chapter and a tab strip, so at any
     moment one of them is `hidden` — out of the layout, invisible, and with a
     full-resolution surface pass it would still be paying for every frame. The
     tab is therefore part of the gate rather than only a class on a div: both are
     off when the chapter is away, and exactly one is on when it is here. */
  let atlas = null;
  const gate = { hidden: false, figOff: true, tab: 'line' };
  const applyGates = () => {
    const awake = !gate.hidden;
    awake ? stars.resume() : stars.pause();
    awake ? globe.resume() : globe.pause();
    const near = awake && !gate.figOff;
    (near && gate.tab === 'line') ? fig.resume() : fig.pause();
    if (atlas) (near && gate.tab === 'atlas') ? atlas.globe.resume() : atlas.globe.pause();
  };

  const chapterNav = initChapterNav();

  const scroll = initScroll({
    hero: $('#hero'),
    globeWrap: $('#globe-wrap'),
    progress: $('#progress'),
    chapterLabel: $('#chapter-label'),
    stars,
    /* §03's figure paints only while the reader is within a third of a viewport
       of the chapter it lives in — see the note over `onNear` in js/scroll.js for
       why this is not an IntersectionObserver any more. */
    nearId: 'anatomy',
    onNear: (v) => { gate.figOff = !v; applyGates(); },
    onChapter(id) {
      /* `settled: true` — these two are re-aims the reader did not ask for, they
         just arrived at a chapter. While the globe is dim they are placed, not
         flown, so scrolling back up to the hero does not spin the planet home in
         front of you. See globe.lookAt(). */
      if (id === 'overture') globe.lookAt(46, 14, { hold: 1200, settled: true });
      if (id === 'catalogue') globe.lookAt(62, 17, { hold: 1200, settled: true });
      chapterNav.mark(id);
    },
    /* Only the paint budget now. `body.globe-hot` used to be toggled here too, to
       make the disc hit-testable while it was the hero's subject; the hero's
       planet is not a control any more, so there is nothing to switch on and
       nothing downstream that reads the class. See the note in app.css. */
    onGlobeDim: (v) => globe.setDim(v),
    // the reader is moving: a dimmed globe stops repainting until they stop, so
    // its compositor cost is off the scroll's frame budget. See globe.setBusy().
    onBusy: (v) => { globe.setBusy(v); stars.setBusy(v); },
  });

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
      /* `settled: true` for the same reason the two chapter aims carry it, and it
         is the visible half of the reverse-spin fix — see the drift gate in
         js/globe.js. Every aim from this observer happens while the disc is at
         0.14 opacity behind #scrim and, while the reader is actually moving, while
         it is not painting at all. There is nothing to animate for; flying it only
         guaranteed that some of the swing was still in flight when the globe came
         back into view. Placed, the camera is already pointing at the venue by the
         time anybody looks. */
      globe.lookAt(e.venue.lat - 22, e.venue.lon, { hold: 5200, settled: true });
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

    /* ★ ONE PRESS, EVEN FROM THE READ-ONLY STATE. addFromCatalogue() adopts the
       list already on screen first if it has to — see the note over it in
       js/gear.js. The alternative was making the reader press ADOPT, read a
       paragraph about Field Atlas 1.x and then find their place in the shelf
       again, which is ceremony rather than consent. Nothing appears or disappears
       at that moment; the only visible change is the thing they asked for. */
    if (act === 'offer') {
      addFromCatalogue(el.dataset.offer, kit().items);
      panel.refresh(); renderKit();
      return;
    }

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

  /* ================================================ §03's TWO INSTRUMENTS
   * ★ THE ATLAS IS BUILT LAZILY, AND THAT IS NOT AN OPTIMISATION FOR ITS OWN SAKE.
   * createGlobe() allocates a surface canvas, an ImageData and the whole geometry
   * cache, and it does it on the reader's very first frame if it is called at
   * boot — competing with the hero's own globe, the starfield, the relief bake and
   * the fonts, all for a stage that is three screens down and may never be opened.
   * So the tab builds it the first time it is chosen, and the strip works from the
   * first paint either way because the racing line is the default.
   * ==================================================================== */
  const tabs = [...document.querySelectorAll('[data-figtab]')];
  const panes = { line: $('#pane-line'), atlas: $('#pane-atlas') };

  function showTab(which, focus) {
    const want = panes[which] ? which : 'line';
    gate.tab = want;
    for (const t of tabs) {
      const on = t.dataset.figtab === want;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const k of Object.keys(panes)) panes[k].hidden = k !== want;
    $('#anatomy-sub').textContent = want === 'atlas'
      ? 'THE ATLAS · EVERY CIRCUIT, PLOTTED'
      : 'RACING LINE · LIVE INTEGRATION';
    if (want === 'atlas' && !atlas) {
      atlas = mountAtlas(panel);
      /* ★ a canvas born after the MOTION pill was last pressed has not heard it.
         Read from the body class rather than from a captured variable, because
         that class IS the page's answer — see the note over applyMotion(). */
      if (atlas) atlas.globe.setMotion(!document.body.classList.contains('no-motion'));
    }
    /* the stage has just come out of `display: none`, so it had no size to
       measure until this moment — both canvases need telling */
    if (want === 'atlas' && atlas) atlas.resize();
    if (want === 'line') { layoutFigure(fig); }
    applyGates();
    scroll.refresh();
    try { localStorage.setItem('fa2.figTab', want); } catch {}
  }

  for (const t of tabs) {
    t.addEventListener('click', () => showTab(t.dataset.figtab));
    /* left/right move between tabs, which is what a tablist is required to do and
       is the only reason the inactive one carries tabIndex -1 above */
    t.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const i = tabs.indexOf(t);
      showTab(tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.figtab, true);
    });
  }

  /* ★ A REMEMBERED CHOICE IS RESTORED, BUT NEVER ON A DEEP LINK INTO §03.
     Landing on #anatomy from a shared URL should show what the link is about, and
     what the chapter is titled after is the racing line. A reader who chose the
     atlas last time and then arrives by scrolling gets the atlas. */
  let wantTab = 'line';
  try { wantTab = localStorage.getItem('fa2.figTab') || 'line'; } catch {}
  if (location.hash.slice(1) === 'anatomy') wantTab = 'line';
  if (wantTab === 'atlas') showTab('atlas');

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
    /* ★ AND THE ATLAS, WHICH IS A THIRD CANVAS THE PILL HAS TO REACH. It is built
       lazily, so it may not exist when this first runs — and showTab() is not a
       place to remember to repeat this, so the pill is re-applied there instead of
       the atlas being special-cased here. A canvas that goes on drifting after
       MOTION is pressed is the pill lying, which is the one thing §4b of the suite
       exists to stop happening again. */
    if (atlas) atlas.globe.setMotion(motion);
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
    // layoutFigure(), not fig.resize(): every term in the stage's height is a
    // length, so a width change re-derives the pose before the canvas is re-fitted
    rt = setTimeout(() => {
      stars.resize(); globe.resize(); layoutFigure(fig);
      if (atlas) atlas.resize();
      scroll.refresh();
    }, 120);
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
    layoutFigure(fig); globe.resize();
    if (atlas) atlas.resize();
    /* ★ AND THE PARALLAX IS PUT ON BEFORE ANYTHING IS SHOWN, which is the second
       half of "sometimes it spawns in the middle of the screen".
       initScroll() ends in remeasure(), so the transform is correct from the
       moment it is constructed — but on a RESTORED scroll position the browser
       restores the offset after the first paint, and the disc arrived at its
       unscrolled resting place, full size, then jumped to a 0.54 scale twelve vmin
       across as the first scroll frame landed. One synchronous refresh here, under
       the same rAF that lights the page, resolves it to the position the scroll
       position actually implies before the reader is shown anything. */
    scroll.refresh();
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

/* ------------------------------------------------------------- the worker
 * Registered after boot rather than before it, and off the `load` event, so
 * installing the worker — which fetches the whole shell, earth images and all
 * — cannot compete with the page's own first paint for bandwidth.
 *
 * Guarded three ways. `serviceWorker` is absent in older browsers; secure
 * contexts only, which is https and localhost and nothing else; and the two
 * .dc.html files run off file://, where `./sw.js` resolves to a path that does
 * not exist and registration would throw on every open. See trace/bundle.mjs —
 * the standalone pair is a single file on purpose and has nothing to cache.
 * ---------------------------------------------------------------------- */
if ('serviceWorker' in navigator && window.isSecureContext &&
    location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('[fa2] service worker did not register:', err);
    });
  }, { once: true });
}
