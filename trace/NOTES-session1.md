# Session 1 (Jul 28 2026) — Field Atlas 2.0, first draft

New project at `/Users/theodor/Documents/Field Atlas 2.0`. **Field Atlas 1.x is untouched.**
Brief: the AEOLUS reference screenshots — dark editorial plate, high-contrast serif display,
mono micro-labels, hairline rules, numbered chapters, a planet in the hero, scroll-driven
reveals — rebuilt around the real 2026 season data.

## 1. ARCHITECTURE
- Static ES modules, no build step, no backend, served over http (`file://` blocks modules).
  Same deploy shape as 1.x: push the folder, Pages serves it.
- `index.html` is a shell — five `<section data-chapter>` blocks with empty hosts. Everything
  inside §02/§03/§04 is built by `js/main.js` from `data/atlas.js`.
- Split by job, not by page: `globe.js`, `starfield.js`, `circuit.js`, `scroll.js`, `main.js`.
- Tokens carried forward in spirit from 1.x `fa-tokens.css`: one `:root` block, a
  `[data-theme=day]` override, no colour literals outside it. The canvases read tokens back
  through `getComputedStyle` so the two themes stay in sync.

## 2. DATA — 1.x IS STILL THE MASTER (CONVENTIONS §9)
`trace/extract.py` parses `Field Atlas (standalone-src).dc.html` and its `trace/*.json`:
- `buildVenues()` → 7 venues / 8 dates; `buildCompetitionTracks()` → 16 circuits;
  `competitionLayouts()` → 10 scorit SVGs; `venueLayouts()` → 6 hand traces (1000×640).
- ★ `grab_block()` must match the METHOD DEFINITION at line start. Matching the bare name
  finds `this.venueLayouts()` at line 1668 — a call site — and returns the wrong block.
- Metrics are computed, not copied: length prefers the measured `lapM`/`loopLen` recorded by
  the 1.x geometry sessions, else haversine; corners come from an 8 m resample walked for
  heading change (≥32° of same-signed turn = one corner); longest straight is the longest run
  under 3.2° curvature. Distance/bearing great-circle from Uppsala.
- ★ Turn detection runs on PLANAR METRES, not lon/lat. The first pass resampled degrees with a
  metre step and hung on a 180-million-point loop.
- Linköping has a trace but no geo fit in 1.x → scaled by the median px/m of the venues that
  have both (4.1834), emitted with `estimated: true`, printed with an `est.` tag.
- Malmen is an airfield: runways, no corners. The OSM extract carries four ways, two of them
  sub-100 m stubs — filtered to >300 m or the spec row reads `410 / 1 796 / 0 / 0 m`.
- Land outline = world-atlas `land-110m` topojson, decoded to rings in the same script.

Sanity: Gelleråsen 2340 m / 10 corners / 360 m straight, Rörken 1223 m / 14, Malmen 1796 m
runway — all match the known circuits.

## 3. THE FOUR MOVING PARTS
- **globe.js** — orthographic projection on a 2D canvas. Ocean gradient lit from a fixed sun
  vector, land rings, 20° graticule, one big offset radial for the terminator, `lighter` rim
  pass, then the pins. Idles with a slow drift; `lookAt()` eases the camera, and §02 calls it
  per entry so the Earth turns to whichever date you are reading.
- **circuit.js** — §03. Resamples the trace, computes curvature, and runs 900 particles whose
  speed is `1/(1+curvature)` — they slow into the corners and release on the straights, which
  is the point of the figure. Corners: real names win where 1.x recorded them (Gelleråsen has
  five), otherwise the four sharpest well-separated turns get numbered callouts.
- **starfield.js** — three depth layers, parallax off the scroll fraction.
- **scroll.js** — one rAF-throttled reader for progress, hero dissolve, globe parallax, chapter
  readout and reticle. Reveal is a separate IntersectionObserver so a page loaded already
  scrolled still shows its content.

## 4. BUGS FOUND AND FIXED THIS SESSION
- ★ **Duplicate `id="catalogue"`** on both the `<section>` and its grid. `$('#catalogue')`
  returned the section, and `innerHTML = ''` wiped the chapter header with it. Everything after
  that line in `boot()` died silently — canvases stayed 300px, `body.lit` never landed. Renamed
  the grid to `#catalogue-grid`.
- ★ **`.wrap` had no `width: 100%`.** `#overture` is a flex container, so `.wrap` shrink-to-fit
  its widest line and drifted right of the plate; on mobile it overflowed the viewport instead.
- `.rise` elements need a `[data-reveal]` ancestor — the hero had none, so the whole hero below
  the kicker sat at `opacity: 0` forever.
- "FIELD ATLAS" is eleven characters. Set on one line it either shrinks to nothing or runs off
  the plate — stacked on two lines it gets bigger and reads better.
- `.entry-name` at `line-height: .94` clipped the ring on Å and the umlaut on Ö. Half the venue
  names carry one. Now 1.02.
- Day side: a lit ocean behind body copy is unreadable → `#globe` drops to 34% opacity there,
  plus a `#scrim` gradient of the page colour over the left two-thirds in both themes.
- Named corners were printing a bogus degree — the value was the local curvature under a
  snapped label, not the corner's total. Now suppressed for named corners.
- ★ **The deep-link scroll has to re-aim.** One `scrollTo` at boot lands thousands of pixels
  short: Bodoni Moda swaps in afterwards and re-flows every entry. `goHash` now re-aims each
  frame for two seconds and stops the instant a wheel/touch/key/pointer event arrives.
- ★ **Puppeteer: use `evaluateOnNewDocument` to clear localStorage, not a pre-navigation.**
  `goto(BASE)` then `goto(BASE + '#ev-x')` is a SAME-DOCUMENT change — the page never reloads,
  so the deep link silently shot the wrong entry and the shots looked fine until compared.
- Malmen's runway row read `410 / 1 796 / 0 / 0 m` until the sub-300 m OSM stubs were filtered.
- Bar values were being cut with `note.split(' ')[0]`, which only survived because `nf()` emits
  a non-breaking space. Values and units are now separate fields.

## 5. VERIFY
`node trace/verify.mjs` — 31 checks, headless Chrome over http. Structure counts, page numbers
compared against `data/atlas.js` on disk (not retyped), countdown legality + ticking, both
pills incl. persistence, deep links, and no horizontal overflow at 390/768/1440/1920.
Selectors are ids and `data-*` only, never rendered copy.

`node trace/shots.mjs` → `trace/shots/*.png`, one per chapter plus day side and two mobile
frames. ★ Both scripts clear `localStorage` before each load — the theme pill persists, and a
leaked day-side setting silently poisons every later frame.

★ Serve over http on 8766 first. Port 8765 is 1.x.

## 6. NOT DONE / NEXT
- Fonts load from Google Fonts. 1.x self-hosts in `fonts/`; do the same here if 2.0 ever needs
  to work offline.
- No service worker, no manifest — this is a page, not an installable app. 1.x keeps that job.
- The copy in `COPY` (js/main.js) is a first draft, one block per date. Facts inside it are
  interpolated from the data at build time so they cannot drift from the spec table beside them.
- Polarica has no OSM geometry in 1.x, so its catalogue cell shows `— m — corners`. Honest, but
  a trace would fill it in.
- §03 picker lists all 21 circuits that have geometry. Fine on desktop, a lot of buttons on
  mobile — consider a select or a scroll row.
