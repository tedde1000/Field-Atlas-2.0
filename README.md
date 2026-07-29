# Field Atlas 2.0

A reading room for the 2026 season. Same facts as Field Atlas 1.x — 7 event venues,
8 dates, 16 competition circuits — set as a scroll-driven editorial page instead of
an app: a globe with every circuit pinned on it, one chapter per section, and a
measured spec sheet for each date.

**This does not replace Field Atlas 1.x.** 1.x is the planner you use in the field
(spots, gear, weather, offline, TWA). 2.0 is the front of house.

---

## Run it

No build step, no backend, no dependencies. It must be served over http — it uses ES
modules, and `file://` blocks them.

```bash
python3 trace/serve.py
```

Use that rather than `python3 -m http.server`. It is the same static server with
`Cache-Control: no-store` on every response — because `http.server` sends no
freshness header at all, and a browser is then free to age assets by its own
heuristic. That produced the worst possible half-state once: the JS reloaded and
`assets/app.css` did not, so the panel opened, locked the page scroll, and
rendered nothing visible. A frozen page, from a fix that was already correct on
disk. `no-store` makes that impossible.

Then open <http://localhost:8766/>. `.claude/launch.json` carries the same config.

---

## Layout

```
index.html               THE MASTER — the shell: chrome, five sections, empty hosts
assets/tokens.css        every colour and face, night + day side
assets/app.css           layout, chrome, sections, motion, the panel
js/main.js               data -> DOM, the editorial copy, wiring
js/globe.js              orthographic Earth on a 2D canvas, with the pins
js/starfield.js          the field behind everything
js/circuit.js            §03 — particles round a traced racing line
js/loop.js               one racing line: 1.x's corner-radius path, splines, flattening
js/scroll.js             progress, hero dissolve, chapter readout, reveal, busy signal
js/panel.js              the detail overlay: routing, focus, history
js/gear.js               the 1.x inventory, read-only, plus 2.0's own ticks
data/atlas.js            GENERATED — venues, events, circuits, metrics
data/world.js            GENERATED — land outlines (Natural Earth 50m, simplified)

Field Atlas 2.0 (standalone-src).dc.html   GENERATED — the whole thing in one file
Field Atlas 2.0.dc.html                    GENERATED — the same, minus the thumbnail

source/                  VENDORED copy of Field Atlas 1.x — see source/README.md
trace/sync-source.py     refresh source/ from 1.x
trace/extract.py         source/ -> data/
trace/serve.py           the dev server, with caching off — use this one
trace/bundle.py          js/ + assets/ + data/ + index.html -> the two .dc.html files
trace/verify.mjs         headless smoke test
trace/shots.mjs          one PNG per chapter, plus mobile and day side
trace/shots/             the captures
PROMPT.md                the brief for the next session (bugs, features, shipping)
```

### The three documents

Same trio Field Atlas 1.x ships, and **the master is the opposite one**. In 1.x
you edit `Field Atlas (standalone-src).dc.html` and `index.html` is generated
from it. Here the modular sources are the master — that is conventions 1 and 3
below, and the reason working on this needs nothing but a static server — so
the arrow points the other way:

```
js/ + assets/ + data/ + index.html          <- edit these
          |
          v   python3 trace/bundle.py
Field Atlas 2.0 (standalone-src).dc.html    <- generated, never hand-edit
Field Atlas 2.0.dc.html                     <- generated, never hand-edit
```

`index.html` stays the served, tested and deployed entry point. The two
`.dc.html` files are the hand-over format: one file each, no server, no origin —
open either straight off the filesystem and the whole page builds, globe
included. Every module is inlined as its own `data:` URL rather than
concatenated, so a module imported twice is still one instance; `trace/bundle.py`
explains why that holds.

```bash
python3 trace/bundle.py            # rebuild both .dc.html files
python3 trace/bundle.py --check    # are they in sync with the sources?
```

The only difference between the two is a `<template id="__bundler_thumbnail">`
block, exactly as in 1.x — and `--check` asserts that, so the pair cannot quietly
drift into being two different pages.

### Chapters

| # | Section | What it is |
|---|---------|-----------|
| 00 | Overture | Title, lede, live countdown to the next date, the globe |
| 01 | The Dates | Every booking in the season, one row each, in order |
| 02 | The Season | One entry per date: summary, drawn layout, spec sheet, bars |
| 03 | Anatomy of a Circuit | A traced racing line with particles and named corners |
| 04 | The Catalogue | The 16 competition circuits as a reference layer |

---

## Where the data comes from

**This project does not need Field Atlas 1.x on disk.** `source/` holds a vendored
copy of everything the data is derived from — the 1.x standalone source, the traced
geometry, all 23 track SVGs, the fonts and the icons, 60 files / 11 MB. Delete, move
or rename the 1.x project and 2.0 still regenerates.

```bash
python3 trace/sync-source.py          # pull the latest 1.x into source/ (read-only on 1.x)
python3 trace/sync-source.py --check  # report drift against source/MANIFEST.json
python3 trace/extract.py              # source/ -> data/atlas.js + data/world.js
python3 trace/bundle.py               # then re-fold the sources into the .dc.html pair
```

`data/world.js` is Natural Earth land-50m, Douglas-Peucker simplified at 0.05°
to 892 rings / 19 667 points. **The simplification is why `js/globe.js` must not
sample those rings by index.** DP output is the opposite of redundant — every
surviving point is one that could not be dropped — so taking every second point
does not halve the detail, it deletes the corners. It did: at a 440px disc,
Italy vanished into the Adriatic, Denmark and Greece became blobs, and Cyprus
became a rectangle. That was Theodor's "weird stuff in some countries". There is
a check for it in `trace/verify.mjs` §10f.

Season facts are still **mastered in 1.x** (CONVENTIONS §9) while it exists: fix a
date there, re-sync, re-extract. If 1.x is ever retired, `source/` becomes the master.
**Never hand-edit the files in `data/`** — the next run overwrites them.

What the script computes, rather than copies:

- **Lap length** — measured lengths recorded by the 1.x geometry sessions where they
  exist (`fit-new.json` `lapM`, `fits.json` `loopLen`), otherwise haversine over the
  OSM centreline.
- **Corner count** — the centreline is resampled to even 8-metre steps, then walked
  for heading change. A run of same-signed turn totalling ≥ 32° counts as one corner,
  so sweepers score one and chicanes score two.
- **Longest straight** — the longest run under 3.2° of curvature.
- **Distance and bearing** — great-circle from Uppsala (`HOME` in `extract.py`).

Linköpings Motorstadion has a hand trace but no geo fit in 1.x, so its length is
scaled by the median px-per-metre of the venues that have both. It is marked `est.`
on the page and in the data.

### Which geometry a circuit is drawn from

Three representations exist and they are **not** equal. `circuitFor()` in
`js/main.js` picks in this order, and the caption under each layout names which
one it got:

1. **`svg` — the drawn layout.** Real cubic Béziers on a 500x300 artboard, out of
   `source/uploads`. This is what the circuit was actually drawn as, and every
   circuit venue plus ten competition tracks have one. Preferred always.
2. **`layout` — a hand trace as `[x, y, r]`,** where `r` is the designed corner
   radius at that vertex. Drawn with `layoutPath()`, ported unchanged from 1.x:
   straight runs plus one quadratic per corner. ★ `tracedLayout()` used to drop
   the third component, which threw every radius away and left a 33-sided
   polygon — that was "the circuits are not accurate".
3. **`track.path` — a sampled OSM centreline,** 29–72 points, no radii. Only here
   is a spline correct, and `loopPath()` uses centripetal Catmull-Rom because
   uniform overshoots on a straight-then-hairpin spacing mix.

Malmen is an air base, not a circuit: it reports runway lengths and no corners.

---

## Conventions carried over from 1.x

1. **No build step.** Plain ES modules, served static. Deployable to Pages as-is.
2. **Coordinates are `{lat, lon}`.** `[lng, lat]` arrays only at the GeoJSON boundary.
3. **Colours come from tokens.** No colour literals in JS-built DOM — `tokens.css` is
   the only place a hex appears, and the canvases read them back through
   `getComputedStyle`.
4. **Generated files say so** in their first line, and name their generator.
5. **Verification uses `data-*` and ids**, never rendered copy, so rewording the page
   cannot break the suite.

---

## Verify

```bash
node trace/verify.mjs
```

100 checks in headless Chrome: no page errors, every section renders the right
number of things, the numbers on the page equal the numbers in `data/atlas.js`,
the countdown ticks, both pills work and persist, deep links land, nothing
overflows sideways at 390 / 768 / 1440 / 1920, the panel routes and traps focus,
gear ticks never touch 1.x's storage — and, from §10 on, **rendered geometry**.

That last section exists because of what session 3 found. The panel opened,
routed, locked the scroll, trapped focus and closed again — with its card 11 169
pixels below the viewport, because none of its classes had any CSS. Every
behavioural check passed the entire time. So §10 asserts where things actually
land: that the open panel is on screen, that no inline icon has inflated past
48px (a `<svg>` with only a `viewBox` fills its box — that is how the open
control ended up with a 372px arrow), that every track layout dashes its whole
lap, that the dimmed globe backs off while the reader scrolls, and that land
rings reach the canvas point-for-point. §11 boots both `.dc.html` files and
proves they build the same page, including off `file://`.

```bash
node trace/shots.mjs
```

Writes `trace/shots/*.png` — one per chapter, plus a day-side and two mobile frames.

---

## Notes

- **Fonts** load from Google Fonts — **Outfit**, one variable file over weights 300–800,
  and nothing else. Session 4 replaced the original trio (Bodoni Moda display, Newsreader
  body, JetBrains Mono labels) with a single geometric sans, so the page now separates its
  registers by weight and tracking rather than by changing face. Two things follow from
  that and are documented where they bite: `--font-mono` and the `.mono` class kept their
  names but no longer mean monospaced, and every column that used to stay put because the
  pitch was fixed — the ticking countdown above all — now asks for `tabular-nums`
  explicitly. 1.x self-hosts its faces in `fonts/`; if 2.0 ever needs to work offline, do
  the same here (PROMPT.md task 4 — now one family to download instead of three).
- **Motion** respects `prefers-reduced-motion`, and the MOTION pill overrides it either
  way. With motion off the page is fully static and everything is legible.
- **Day side** is not an inverted night side — the paper warms and the amber darkens so
  the mono labels keep their weight. The globe drops to 34% opacity because a lit ocean
  behind body copy is unreadable.
