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
assets/app.css           layout, chrome, sections, motion, the panel, the 3D stage
assets/earth-topo-4096.jpg          global elevation — the SHAPE of the surface
assets/earth-blue-marble-2048.jpg   NASA Blue Marble — the land-cover COLOUR only
assets/earth-night-2048.png         NASA Earth at Night — the city LIGHTS only
js/main.js               data -> DOM, the editorial copy, wiring
js/globe.js              orthographic Earth on a 2D canvas, lit from the camera
js/earth.js              bakes the three sources into one relief plate, once, at boot
js/starfield.js          the field behind everything
js/circuit.js            §03 — particles round a lap-time-solved racing line
js/loop.js               geometry: corner-radius paths, splines, flattening, corners,
                         resampling, the speed model and the racing-line solver
js/layout3d.js           the panel's track layout on a plane you can turn
js/scroll.js             progress, hero dissolve, chapter readout, reveal, busy signal
js/panel.js              the detail overlay: routing, focus, history
js/gear.js               the 1.x inventory, read-only, plus 2.0's own ticks and
                         the kit recovered from 1.x's git history
data/atlas.js            GENERATED — venues, events, circuits, metrics
data/world.js            GENERATED — land outlines (Natural Earth 50m, simplified)

manifest.webmanifest     the install manifest — name, colours, `display: standalone`
sw.js                    the service worker: precache the shell, then work offline
icons/                   GENERATED — the launcher icons, by trace/icons.mjs
.nojekyll                Pages serves the tree as-is

Field Atlas 2.0 (standalone-src).dc.html   GENERATED — the whole thing in one file
Field Atlas 2.0.dc.html                    GENERATED — the same, minus the thumbnail

source/                  VENDORED copy of Field Atlas 1.x — see source/README.md
trace/sync-source.py     refresh source/ from 1.x
trace/extract.py         source/ -> data/
trace/serve.py           the dev server, with caching off — use this one
trace/serve.mjs          the same server in Node, for machines with no Python
trace/bundle.py          js/ + assets/ + data/ + index.html -> the two .dc.html files
trace/verify.mjs         headless smoke test
trace/shots.mjs          one PNG per chapter, plus mobile and day side
trace/shots/             the captures
trace/icons.mjs          icons/ — the aperture mark, rasterised by headless Chrome
trace/plate.html         DEV — the baked Earth plate, laid out flat, plus the sphere
trace/figure.html        DEV — §03's racing line on its own, one circuit at a time
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

node trace/bundle.mjs              # the same thing, for machines without Python
node trace/bundle.mjs --check
```

The two bundlers are a **port of each other and produce byte-identical output** —
`--check` on either reports the other's build as clean, which is what will catch
you if you change one and not the other. Same for `trace/serve.py` and
`trace/serve.mjs`. The Node versions exist because a project whose selling point is
"no build step, just serve it" should not be un-runnable for want of an interpreter
it never actually needs, and because the `.dc.html` pair is not an optional
artefact — a session that cannot regenerate it ships a stale standalone silently,
since `index.html` goes on working perfectly.

The only difference between the two is a `<template id="__bundler_thumbnail">`
block, exactly as in 1.x — and `--check` asserts that, so the pair cannot quietly
drift into being two different pages.

### Chapters

| # | Section | What it is |
|---|---------|-----------|
| 00 | Overture | Title, lede, live countdown to the next date, the globe |
| 01 | The Dates | Every booking in the season, one row each, in order |
| 02 | The Season | One entry per date: summary, drawn layout, spec sheet, bars |
| 03 | Anatomy of a Circuit | A **solved** racing line, with the flow paced off its curvature |
| 04 | The Catalogue | The 16 competition circuits as a reference layer |
| 05 | The Kit | The whole equipment inventory, owned / rental / basic |

### The globe is a shaded-relief sphere, lit over the reader's shoulder

`js/earth.js` composes the surface **once, at boot**, out of three equirectangular
sources and hands `js/globe.js` a single 1024×512 RGBA plate: elevation gives the
shape, tinted hypsometrically and hillshaded by a fixed north-west cartographer's
sun the way a paper atlas does it; Blue Marble contributes a heavily low-passed
colour cast and nothing else, so the Sahara stays sand and the taiga stays dark
without the plate becoming a photograph again; and the alpha channel carries the
city lights. `js/globe.js` then shades the disc per pixel — unproject, sample,
Lambert — and the coastline mask under all of it is filled from the same Natural
Earth vectors the globe strokes on top, not thresholded out of the imagery.

The sun is **locked to the camera**, offset up and to the left. Session 4 made it
the real subsolar point in world space and this reverses that on purpose: the drift
and the per-entry look-ats spend most of their time over Europe at European
evening, so the venue the page was talking about was frequently on the unlit side.
It is still a real Lambert term against a real terminator — just one the camera
carries with it. Four fifths of the visible face is lit at any angle
(`data-sun-lit`), and the shadowed crescent at the lower-right limb is where the
city lights show.

Five things about it are load-bearing:

- **All three sources must stay same-origin.** The bake reads each back with
  `getImageData`, and a cross-origin or `file://` image taints the canvas, which
  throws. `index.html` carries them as `#earth-topo`, `#earth-plate` and
  `#earth-night`; `trace/bundle.py` rewrites all three `src`s to `data:` URIs for
  the `.dc.html` files, which is the only reason the standalone globe has a surface
  at all. verify.mjs §11d asserts every one of them.
- **The coastline mask is filled on a cylinder, not a rectangle.** Three rings run
  off one edge of the map and back on at the other, and joining lon +179.9 to
  −180.0 in raster space draws a chord across the whole plate — which under
  even-odd filled the band between two of them as land, a white ring right round
  the Arctic. Longitudes are unwrapped before filling and folded back after.
- **The city lights are gated on BLUE, not on warmth.** The first extraction tested
  for warm light on the reasoning that street lighting is sodium — true of the
  light, false of that image, where Tokyo measures (234,232,232). The backdrop is
  what is coloured. Getting this backwards threw away the four largest light fields
  on Earth and rendered a completely dark terminator.
- **The unprojection does not depend on the camera's longitude**, and that is what
  lets the disc be sharp at all. `λ₀` appears once, as a term added at the end; the
  rest — and the Lambert term, the fresnel, the coverage alpha — is a function of
  the pixel and the camera *latitude*, which only moves on a look-at. So the
  per-pixel geometry is cached and the per-frame loop is a texel offset, a bilinear
  fetch and a multiply. That halved the cost (13.2 → 9.7 ms at the old size) and is
  the only reason the raster could be raised from 420 to **700** without blowing
  the 30 Hz budget: the uncached pass at 640 measured 36 ms.
- **It is rastered and scaled** — at most 700px, 340 while the camera's latitude is
  easing, 200 while the disc is dimmed behind the scrim — and its limb carries a
  sub-texel coverage alpha, drawn *outside* the arc clip, because canvas `clip()`
  is not antialiased in Chrome.
- **The per-ring land fills are gone.** 892 `Path2D` allocations and `fill()` calls
  per frame paid for the surface pass. Only the batched stroke remains.

### §03 solves for lap time, not for geometry

It used to draw the traced **centreline**, then (session 5) the **minimum-curvature**
line — the biggest circle that fits through each corner. Neither is the line a
driver takes. A minimum-curvature line apexes in the geometric middle; a driver
turns in late, clips past the middle and straightens early, giving away the entry to
buy exit speed that is then carried the whole length of the following straight.

So `racingLine()` in `js/loop.js` now runs the minimum-curvature relaxation only as
a starting guess, then **drives** it: a point-mass speed profile (`speedProfile()`,
forward and backward passes over `√(a_lat/κ)`, twice round because a braking zone
can begin before the start line) and a coarse-to-fine descent that nudges whole
apex-sized regions of the line wherever the lap time drops. The late apex is not
written down anywhere — it falls out. Measured across all 21 circuits with geometry,
the mean apex moves from **0.29** of the way through a corner to **0.45**, and 91 of
228 corners end up apexing past 0.55.

Two things make it affordable and one makes it safe. The lap is resampled to
**2 600 evenly spaced nodes** first, because every solver here assumes even spacing
and because at the old density an apex was three nodes and could not be placed late
even in principle. The time test is **windowed** — ±4.5% of the lap, with the end
speeds pinned to the current full-lap answer — since a full lap per trial is fifty
million operations and a visible stall. And the whole lap is measured once at the
end against the line it started from: if the refinement did not actually help, the
minimum-curvature line ships instead and `data-solve` says `curvature` rather than
`lap-time`, so the figure is conservative rather than wrong.

**Every distance in the solver is a fraction of the lap, not a number of nodes** —
the window, the curvature stencil, the trial bump, the stride, and the flow's own
advance and streak length. They were absolute once, and raising the density then
silently changed the meaning of all of them.

Three things keep the drawn line smooth, and the first two are geometry rather than
taste. The trial bump is a raised cosine, which is smooth until the clamp
flat-tops it — so the offsets are **smoothed between sweeps**, inside the descent,
where the next sweep can still overrule it. The corridor is six times the real
track width, which on a tight kart hairpin is **wider than the corner's own
radius**: push an offset past `1/κ` and the curve turns inside out, so each node
carries a per-node bound from the local curvature. And because a curvature estimate
is only ever an estimate, a final pass **measures the offset line as it stands** and
eases back anywhere a segment has lost three quarters of its length. Before that
last one, eight circuits still drew 180° reversals — a line doubling back inside a
hairpin, invisible at a glance and meaningless to the speed model reading it.

The vehicle is chosen by lap length — under 2 km is a kart, Gelleråsen is a car —
and the two genuinely draw different lines, because a kart has more lateral grip and
a fraction of the power. The corridor is still 28px on screen at any zoom, roughly
six times the real track width, and the legend still says so.

### The panel's track layout is 3D

`js/layout3d.js`, and it is 1.x's venue map brought across: the layout on a plane
tilted back 56°, drag to orbit, pinch or scroll to zoom, arrow keys, RESET VIEW, and
a one-time reveal. There is **no elevation** — `data/atlas.js` has no height in it,
so banking and gradient would be the only invented numbers on the page.

The corner numbers are the reason it is not just a CSS transform on the old SVG. A
numeral lying flat on a plane turned back 56° is squashed to two fifths of its
height and past about 70° is a line, so they come out of the drawing and become
objects in the scene: each rides a post rising off its own apex and is
counter-rotated by exactly the stage's rotation, so the post leans and foreshortens
and the number never does. Crowded corners get taller posts — Gelleråsen has four
turns inside a fifth of the drawing, and on posts of one height their labels landed
in an unreadable stack.

### §05 — the kit

`js/gear.js` owns everything about the equipment. The whole inventory is grouped
the way 1.x groups it, with the two distinctions 1.x keeps in the data: what is
**owned**, what would be **rented**, and which entries were only ever a generic
suggestion.

The list is 1.x's. It is not in this repository at runtime — `evhub.gear.inventory`
is localStorage, so the real one lives in the browser on the phone — and on
`tedde1000.github.io` both apps are the same origin and 2.0 reads it live. Anywhere
else, `KIT_1X` stands in: the 29-item inventory recovered from Field-Atlas commit
`dacef4d`, before `7497b37` removed the seed. Session 16's notes describe it as
"real kit + rental options + suggested basics", which is why the badges matter.
**A live inventory always wins, and the page always says which one it is showing.**
2.0 still never writes `evhub.*`.

1.x's hard rule is kept: never seed or suggest flash or strobe.

### Corner numbers, and how the count is reconciled

Panel layouts and §03 both number their turns. `numberedCorners()` finds runs of
same-signed heading change, splits a run that is really two corners at the interior
curvature minimum between them, and then keeps the sharpest `track.corners` of them
— so the numbering agrees with the count in the spec table beside it.

Where the drawing genuinely resolves fewer turns than the OSM centreline
measurement did, **the caption says so** (`14 CORNERS · 12 RESOLVED HERE`) rather
than quietly numbering fewer. 20 of the 22 circuits with a measured count reconcile
exactly. verify.mjs §12c′ asserts a shortfall can never be silent.

The degrees printed in §03's legend are **total heading change through the turn**,
not an included angle, and are not bounded by 180°. Before this session the same
field was the sum of a ±3-node windowed curvature, which counted every segment
about six times and once printed a 1371° corner; §12f pins it to the closed-loop
invariant, which Gelleråsen and Rörken satisfy at exactly 360.0°.

---

## Installable, and what that costs you

`manifest.webmanifest` + `sw.js` make 2.0 an installable PWA, which is what lets it
go on a phone with no browser chrome — either through Chrome's **Add to Home
screen**, or wrapped as a Trusted Web Activity APK the way 1.x is. Either way the
app points at the live URL, so **a `git push` is the deploy** and no rebuild of
anything native is needed.

```bash
node trace/icons.mjs        # regenerate icons/ from the aperture mark
```

Two things about the worker are worth knowing before you change it.

- **Bump `CACHE_VERSION` in `sw.js` on every deploy.** `skipWaiting()` and
  `clients.claim()` are carried over from 1.x for the reason 1.x has them: an
  installed app has no reload button, so a push has to land on the next launch
  rather than sit behind a worker that never activates.
- ★ **The caching strategy is split on `?v=`, and that is load-bearing.** A URL
  stamped by `trace/bundle.mjs` is immutable — its hash *is* its bytes — so it is
  served cache-first forever, which is where the launch actually costs something
  (three earth images, both stylesheets, the entry module). Everything else
  same-origin is network-first, because the `js/*.js` specifiers live inside
  JavaScript where the stamper cannot reach them, and serving *those* stale would
  recreate exactly the half-state the stamping exists to prevent — a fresh
  `index.html` beside a module from the previous deploy. They are small; the round
  trip is worth it, and offline still works because the precache is complete rather
  than partial.

**Offline is complete except for the typeface.** The shell, the data, the earth
imagery and the icons are all precached, and Outfit is cached from Google Fonts on
the second load — so a cold first launch with no signal falls back to the system
sans until the fonts have been seen once. PROMPT.md task 4 (self-host Outfit into
`fonts/`) is what closes that, and is still open.

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
  **Still computed, no longer printed.** Session 5 took distance off the page —
  Theodor: "how long distance it is from a place, you don't really need to have
  that; it's enough with saying where it is, like under coordinates, say closest
  city." So the `FROM UPPSALA` rows, the `REACH` bar and the `183 KM WSW` in each
  catalogue cell are gone, replaced by the coordinate and the nearest city. The
  fields stay in `data/atlas.js` because that file is generated and dropping them
  is a pipeline change, not a page change.

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

It runs anywhere now. The puppeteer and Chrome paths used to be hardcoded to one
laptop (`/Users/theodor/node_modules/…`, `/Applications/Google Chrome.app/…`), so
"green" could not be checked from any other machine. Both are resolved
per-platform, with env overrides:

```bash
FA2_CHROME=…      a Chrome/Chromium binary   (auto-detected on macOS/Windows/Linux)
FA2_PUPPETEER=…   puppeteer-core's ESM entry (resolved from node_modules if present)
FA2_BASE=…        where the site is served   (default http://localhost:8766/)
```

148 checks in headless Chrome: no page errors, every section renders the right
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
proves they build the same page, including off `file://` — and that the Earth plate
survives the trip as a `data:` URI, which is the one thing in §11 that fails
silently. §12 covers session 5: that the racing line actually swings across the
road, that no layout under-numbers its corners without saying so, that no layout
emits a `NaN` attribute or a numeral outside its frame, and that the sun does not
turn with the camera.

One trap worth knowing before you tune a sleep against it: **the idle globe drift is
frame-rate-limited under headless.** `dt` in `js/globe.js` is clamped to 0.05 s so a
stalled tab cannot teleport the planet, and swiftshader schedules `rAF` at about
3 Hz — so the 0.9°/s drift runs at roughly 0.15°/s under the suite. §12d moves the
camera with a real `lookAt` instead of waiting for the drift.

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
- **Motion is on by default, and the choice is remembered** in `fa2.motion`. It used to
  be `motion = !matchMedia('(prefers-reduced-motion: reduce)').matches` and nothing else
  — the OS setting was re-read on every load and the reader's answer was never stored
  anywhere, so on Windows, which reports `reduce` whenever *Accessibility → Visual
  effects → Animation effects* is off, the page booted still every single time and the
  pill appeared not to work. `prefers-reduced-motion` is now the **first-run hint only**;
  after that the stored answer wins. Overriding an accessibility setting by default is a
  real cost, paid on three conditions: the opt-out is one tap, it is in the topbar at
  every width (the ≤460px block drops the chapter readout rather than this control), and
  it persists — and on the one cold load where 2.0 overrules a reader who did ask for
  less motion, the pill wears the accent so the override is visible. The MOTION pill is
  the single authority: `body.no-motion` is how it is expressed and there is no
  `@media (prefers-reduced-motion)` block left in `app.css` to disagree with it.
  With motion off the page is fully static and everything is legible — with one
  deliberate exception: the globe's still-frame signature carries the subsolar
  longitude rounded to the whole degree, so the lighting is allowed to update about
  fifteen times an hour rather than freezing at whatever it was when MOTION went off.
  One degree of subsolar longitude is four minutes.
- **There is no reticle.** A 34px crosshair used to ease toward a per-chapter
  sightline on its own `rAF` loop, wobbling on two out-of-phase sine waves. Removed
  at Theodor's request — it read as a cursor the reader did not control, and it held
  a `requestAnimationFrame` loop open for the life of the page to animate decoration.
  The crosshair still visible beside the hero title is `.hero-mark`, which is part of
  the `<h1>` and does not move.
- **There is no colophon.** The provenance paragraph that used to sit in the footer is
  in this file, which is where it belongs.
- **Day side** is not an inverted night side — the paper warms and the amber darkens so
  the mono labels keep their weight. The globe drops to 34% opacity because a lit ocean
  behind body copy is unreadable.
