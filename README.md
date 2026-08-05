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
js/globe.js              the Earth on a 2D canvas, lit by the real sun — as an
                         orthographic sphere or as a flat plate, one lighting model
js/earth.js              bakes the three sources into one relief plate, once, at boot
js/starfield.js          the field behind everything
js/circuit.js            §03 — particles round a lap-time-solved racing line, on
                         the 3D stage below
js/loop.js               geometry: corner-radius paths, splines, flattening, corners,
                         resampling, the speed model and the racing-line solver
js/layout3d.js           the track layout on a plane you can turn — the panel's,
                         and §03's
js/scroll.js             progress, hero dissolve, chapter readout, reveal, busy
                         signal, and whether §03 is near enough to paint
js/panel.js              the detail overlay: routing, focus, history
js/gear.js               the 1.x inventory, read-only, plus 2.0's own ticks and
                         the kit recovered from 1.x's git history
data/atlas.js            GENERATED — venues, events, circuits, metrics
data/atlas-extra.js      HAND-MAINTAINED — the only one. Circuits that are plotted
                         on §03's atlas but not measured: a name and a coordinate.
                         Empty on purpose; read its header before adding a row.
data/world.js            GENERATED — land outlines (Natural Earth 50m, simplified)

assets/fonts.css         GENERATED — Outfit, self-hosted, inlined as data: URIs
fonts/                   the woff2 source for the above: Outfit 100-900, 2 subsets
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
trace/fonts.mjs          assets/fonts.css — Outfit, from fonts/, as data: URIs
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
| 00 | Overture | Title, lede, live countdown to the next date, and the globe — as a **picture**, not a control |
| 01 | The Dates | Every booking in the season, one row each, in order |
| 02 | The Season | One entry per date: summary, drawn layout, spec sheet, bars |
| 03 | Anatomy & Atlas | Two tabs in one frame: a **solved** racing line on a 3D stage you can turn, and the atlas — every circuit plotted on a globe that is also a map |
| 04 | The Catalogue | The 16 competition circuits as a reference layer |
| 05 | The Kit | The whole equipment inventory, owned / rental / basic, plus a catalogue to add from |

### The globe is a shaded-relief sphere, lit by the sun that is actually up

`js/earth.js` composes the surface **once, at boot**, out of three equirectangular
sources and hands `js/globe.js` a single 2048×1024 RGBA plate: elevation gives the
shape, tinted hypsometrically and hillshaded by a fixed north-west cartographer's
sun the way a paper atlas does it; Blue Marble contributes a heavily low-passed
colour cast and nothing else, so the Sahara stays sand and the taiga stays dark
without the plate becoming a photograph again; and the alpha channel carries the
city lights. `js/globe.js` then shades the disc per pixel — unproject, sample,
Lambert — and the coastline mask under all of it is filled from the same Natural
Earth vectors the globe strokes on top, not thresholded out of the imagery.

The sun is **the real one, at the reader's clock** — the subsolar point for
`Date.now()`, fixed in world space, so the terminator lies where the Earth's
actually does and Scandinavia is dark at three in the morning. This is the third
position the file has held: session 4 made it real, session 6 locked it to the
camera because the venue the page was talking about kept landing on the unlit side,
session 8 reversed that back on instruction — *"it would be cool if it was live
time, where the sun is shining on the globe."* What makes it survivable this time
is the city-lights channel, which arrived with the relief plate in between: a venue
in shadow sits in the middle of the brightest lit landmass on Earth rather than in
a void, the pins draw over the surface at full opacity regardless, and the night
floor is a little higher than it was. `data-sun-lat`/`-lon` publish where the sun
stands and do not move with the camera; `data-sun-lit` is the lit fraction of the
visible face and does.

Seven things about it are load-bearing:

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
  rest — the surface normal, the fresnel, the coverage alpha, the sampling
  footprint — is a function of the pixel and the camera *latitude*, which only moves
  on a look-at. So the per-pixel geometry is cached and the per-frame loop is a
  texel offset, a fetch and a multiply. That halved the cost (13.2 → 9.7 ms at the
  old size) and is the only reason the raster could be raised from 420 to **700**
  without blowing the 30 Hz budget: the uncached pass at 640 measured 36 ms.
- ★ **A world-fixed sun does depend on it, and that is the one thing that cache
  could not absorb.** The naive version of a live terminator rebuilds an `asin` and
  an `atan2` per pixel every frame, sixty times a second, on a globe whose idle
  motion *is* longitude. So the cache holds the **normal** instead of the shading —
  `nx`/`ny`/`nz` as Int16 at 1/30 000, which is the same three arrays at half the
  width — and the sun is rotated into camera space once per frame. What is left per
  pixel is a three-term dot product and three reads from a 1 024-entry table, about
  a fifth of what one plate fetch costs. A theme change no longer discards the
  geometry either: the theme is only in the table now.
- ★ **The plate is band-limited by latitude at bake time.** Theodor: *"you can see a
  bit of artifacting, a bit of stuff moving on islands and on the land."* An
  equirectangular plate spends the same 2 048 texels on every parallel, but a
  parallel at 70°N is a third the length of the equator — so the plate carries three
  times the detail per kilometre there, and the raster reads 1.9 texels per pixel
  where it reads 0.64 at the equator. Past Nyquist, bilinear filtering cannot help:
  *which* detail the raster lands on changes as the planet turns, and Svalbard, the
  Canadian archipelago and the whole Siberian coast shimmer. Every row is low-passed
  along its own length to `sec(φ)` texels — two fractional box passes, so the
  stopband is a triangle's rather than a box's — which throws away nothing anyone
  could have seen and costs nothing at 30 Hz. The unsharp mask on the elevation got
  a threshold in the same pass, so it stops amplifying the JPEG's block ringing into
  texel-scale speckle across Tibet and the ice sheets.
- ★ **And by footprint at draw time, which is the half the bake cannot reach.** Near
  the limb an orthographic sphere is edge-on, so a pixel a tenth of a radius from
  the silhouette covers about three times the ground one at the centre does. That
  compression is a property of the *camera*, so it is measured per pixel from the
  analytic derivatives of the unprojection, per axis — radial compression is almost
  all longitude at the left and right limb and almost all latitude at the top and
  bottom, and one isotropic figure would blur each across the axis that was still
  well sampled. Where the excess is under half a texel, which is 83% of the disc,
  nothing changes and nothing is paid; above it the same four taps spread to the
  width the pixel is actually responsible for.
- **It is rastered and scaled** — 680 while the camera is being moved, 200
  while the disc is dimmed behind the scrim — and its limb carries a sub-texel
  coverage alpha, drawn *outside* the arc clip, because canvas `clip()` is not
  antialiased in Chrome.
- ★ **The ceiling is the plate's own texel count, and it measures itself.** It was
  700, and 700 was still a magnification everywhere that mattered: the disc is
  `r · 2 · dpr` backing pixels across, which is 1 012 on a 412px phone and 1 572 on
  a retina laptop, so the terrain was being blown up 1.45x and 2.25x with a
  full-resolution coastline struck over the top of it. That is Theodor's "it feels
  a bit blurry", and it is arithmetic rather than taste. (It was only half of it —
  the other half was that the raster covered the whole disc rather than the part on
  screen, which is what "still a bit blurry" turned out to be. See *Why it is
  sharper* below.) `RASTER_MAX` is
  `PLATE_W / 2` = **1 024** now — the visible hemisphere carries half the map
  however big the disc is, so past that the raster really would only be magnifying
  the plate's own bilinear filter. It costs 2.1x the pixels of 700, and what makes
  that safe is that the pass **times itself**: two frames over half the 30 Hz
  budget and it steps down `RASTER_LADDER` and stays there for that size and theme.
  One guess for every device on Earth became a measurement per device.
- **The per-ring land fills are gone.** 892 `Path2D` allocations and `fill()` calls
  per frame paid for the surface pass. Only the batched stroke remains.
- ★ **The idle drift only runs where it can be seen, and that is a bug fix.**
  Theodor: "the globe was spinning a lot in the opposite direction when you scroll
  up or down." The drift is eastward and it accumulated on the *target* without
  bound — including past the hero, where the disc is at 0.14 opacity and, while the
  reader is moving, not painting at all. The next per-entry look-at then set the
  target to a real venue longitude and threw all of it away at once, so the camera
  unwound the whole accumulation westward at up to `MAX_TURN`. The size of the
  reverse spin was proportional to how long the reader had been reading, which is
  exactly why it looked random. It is gated on `dim >= DRIFT_DIM` now, and §02's
  per-entry aim is *placed* rather than flown for the same reason the two chapter
  aims already were: below that threshold there is nothing to animate for.

### The hero's globe is a picture; §03's atlas is the control

> "Remove the interactive thing on the main page where you load in, because that's
> just weird." — and, on where it should go: "in the same section as the anatomy,
> but just a different tab in the same area."

For two sessions the hero's disc was draggable, pinchable and pressable, through
`#globe-hit` — an empty box sharing its geometry at `z-index: 5`, which existed
because the disc has to be **painted under** `#scrim` and **hit above** `main`, and
one element cannot be on both sides of the same layer. Every one of the constraints
that made that hard came from it being a *backdrop*: it needed a line of type to
advertise itself, it could not zoom past 4.2× because eight pins had to stay
separable behind body copy, and on a phone it sat directly under the lede.

So the hero keeps the planet and gives up the control. `#globe-hit`, `#globe-ui`,
`body.globe-hot`, `globe-zoomed`, `globe-turning` and the `fa2.globeHint` key are
all gone. §12a asserts they stay gone; §14b asserts the *behaviour*, which is that a
drag and a ctrl-scroll do nothing to the hero and a click in the middle of the disc
reaches the page.

**§03 is a tab strip now.** `RACING LINE` is the default — every existing assertion
about that chapter queries `#fig-3d`, which is only in the layout while its tab is
open — and `THE ATLAS` is the second. The tab is part of the paint gate rather than
just a class: `applyGates()` runs exactly one of the two canvases, and neither when
the chapter is off screen. The atlas is built lazily, on first open, because
`createGlobe()` allocates a surface canvas, an ImageData and the whole geometry
cache, and doing that at boot would put it in competition with the hero's globe,
the starfield and the relief bake for a stage three screens down.

On the stage the constraints are gone, so:

- **it runs to `ATLAS_ZOOM_MAX` = 40×**, not 4.2 — the old ceiling was set by the
  pins needing to be separable, and here nothing is behind them;
- **the pins carry names**, deconflicted greedily in priority order (a booked date
  outranks a competition circuit outranks a reference pin), so when two collide the
  one that loses is always the less important — at every zoom, rather than whichever
  was later in the array;
- **there is one element, not two.** Nothing is over this canvas, so it takes its own
  pointers and the whole `#globe-hit` problem simply does not arise.

The list beside it is not a second §04. §04 is the reference layer read as prose;
this is the same circuits read as positions, and its only jobs are to find one by
name and fly the camera to it. Both open the identical panel from the identical
route. The filters set the pin set as well as the list, so the two cannot disagree.

Four things carried over from the hero unchanged, because the reasoning was
expensive to find and has not changed:

- **`touch-action: pan-y`, not `none`.** The stage is as tall as a phone and sits in
  the middle of a scrolling page; owning every vertical drag would make it a place
  the page stops.
- **Pointers turn and tap; touch events pinch.** While `touch-action` still permits
  the browser a gesture, Chrome hands the page only the *first* touch point as a
  pointer — measured, a real two-finger spread produced exactly one `pointerdown`.
  `ev.touches` carries both.
- **A plain wheel scrolls the page**; ctrl/⌘-wheel zooms, which is also what a
  trackpad pinch sends.
- **Zoom walks the camera toward the pointer**, so what you lean in on arrives in
  the middle rather than leaving the screen.

★ **And one new trap, which cost a silent feature.** `setPointerCapture` on the
stage retargets every later event — *including the click* — to the capturing
element. GLOBE, MAP and RESET VIEW live inside the stage, so they were drawn,
hit-testable, and did nothing at all: pressing MAP turned the planet a pixel. A
press that begins on `.atlas-bar` is now the chrome's and the globe never hears
about it. This is the mirror image of the bug that made the hero's own RESET VIEW
inert two sessions ago, and just as quiet.

### The globe is also a map, and it is not a second renderer

> "For the globe itself, make that also a map."

The obvious build is a second module. It is a trap: the sun, the terminator, the
twilight ramp and the city lights are ~200 lines of tuned code in `buildLut()` and
the sample loop, and a copy of them drifts from the original the day after it is
written. So `mode` splits `js/globe.js` in exactly three places —

| | globe | map |
|---|---|---|
| `project()` / `unproject()` | orthographic | linear in lon/lat |
| `buildGeo()` | walks the disc | walks the visible rect |
| `paint()` chrome | halo, limb, arc clip | frame, no halo |

— and **everything between them is shared byte for byte**. `buildGeoMap()` fills the
same flat arrays in the same units, including the surface normal in the same
camera-space basis `setSun()` rotates the sun into, so the per-pixel loop never
learns the projection changed. The map is lit by the same sun at the same instant
*by construction* rather than by agreement, and §14d asserts it: the subsolar point
either side of the toggle is not merely close, it is the same number.

Three things are load-bearing about the flat plate:

- **The ±180° seam is a real edge.** A ring crossing it has two consecutive points a
  whole world apart in x; joined naively, Eurasia grows a bar across the map. Rings
  are unwrapped relative to the camera and the run breaks at any step over half a
  world — the same class of bug, and the same shape of answer, as the land mask in
  `js/earth.js`.
- **The fresnel is switched off in the LUT, not per pixel.** It is a function of the
  surface turning away from the reader, which on a sphere is the limb and on a plate
  is nothing; left on, it painted a blue haze down the two meridians 90° from the
  camera, in open map.
- **Switching preserves the ground, not the number.** `zoom` means divisions of the
  world on one side and a radius multiplier on the other, so what is carried across
  is the visible longitude span — and on the map, raised far enough that
  `mapLatClamp()` still holds the current latitude in the middle. Preserving the
  span and preserving the place conflict at Swedish latitudes, and the place wins:
  pressing MAP over Sweden that gave you the Mediterranean would be a bug.

### Why it is sharper, and what happens when the plate runs out

> "It's still a bit blurry… especially not when you move it around."

**The blur was arithmetic, and it was in one line.** `buildSurface()` rastered the
*entire disc* into a buffer capped at `RASTER_MAX` and `paint()` blitted it to
`(cx−r, cy−r, 2r, 2r)`. At 1× that is right — 1 024 is the plate's own texel count
across a hemisphere. At 4× the disc is 3 200 CSS pixels across, three quarters of it
is off screen, and the same 1 024 buffer is stretched over all of it. So the raster
covers the **intersection of the disc with the canvas** now (`viewWindow()`), which
is the same rectangle at zoom 1 — the hero is the same numbers through the same
code — and four times the linear resolution at 4×, for nothing. The window is
rounded *outward*, never to nearest, because it is both what the geometry is built
for and what the result is blitted to, and rounding inward would leave a hairline of
unpainted canvas at the edge.

Three consequences worth writing down:

- **The moving raster doubled**, because the buffer it caps is no longer the whole
  planet. The self-timing `RASTER_LADDER` still arbitrates, so a machine that cannot
  hold it walks down and stays down.
- **The geometry cache's latitude quantum is a screen pixel, not a tenth of a
  degree.** A tenth of a degree of *ground* is three quarters of a pixel at the hero
  and thirty at the atlas's 40× — so the old key would have left the shaded relief
  lying thirty pixels from the coastline struck over it. It tightens by itself now.
- **A zoom counts as moving.** The window is a function of the zoom, so an easing
  pinch invalidates the cache every frame exactly as an easing latitude does; left
  out, the first second of every pinch rebuilt a full-resolution cache per frame.

★ **Past the plate's own detail, it stops being a photograph.** 2 048 texels of
longitude is 5.7 to the degree and no zoom invents a sixth. Fading toward luminance
was tried first and does not work — desaturating a blurred photograph gives a
blurred grey photograph. What magnified imagery lacks is not colour, it is that
every edge in it is four texels wide, so the picture has to be *replaced*: past ~3×
magnification the sample cross-fades to a flat land or sea tone (decided by its own
blue dominance, the same property the city-light extraction turns on) plus a quarter
of the relief's own tonal variation. The coastline and the graticule, struck at full
resolution, then carry it — and the graticule densifies 20° → 5° → 1° → 0.2° with
the zoom, which the fixed 20° rings never did. The deep view reads **sharper** than
the shallow one, which is the correct outcome and the opposite of magnifying.

### The load-in, and where the planet lands

> "Sometimes it spawns in the middle of the screen or in the upper section… make the
> spawning or the load-in of the globe consistent and higher quality."

Three causes, all fixed, none of them the same bug:

- **`top: 40%` under 760px** is forty per cent of a viewport height a phone's URL bar
  rewrites twice a scroll: 412×915 and 412×800 put the disc's centre 46px apart. It
  is `top: 50%` at every width now — a percentage of a height the disc is then
  centred in, so it is immune to that height changing — and the lift the phone
  layout genuinely wants is `--globe-lift`, in `vmin`, which in portrait is the
  width and does not move. `js/scroll.js` carries it through the parallax transform.
- **The parallax landed a frame late on a restored scroll.** One synchronous
  `scroll.refresh()` under the same rAF that lights the page resolves the disc to
  the position the scroll position implies before anything is shown.
- **The plate was still decoding.** `loadPlate()` bakes three images, so the first
  frames painted a plain unlit sphere which the real Earth then replaced in one
  frame — two arrivals, the first of them wrong. The disc is composited through
  `warm` now: nothing until the plate is ready, then a 420ms fade, with a 900ms
  fallback so a failed bake still gives the reader a planet. §14a′ asserts no frame
  is ever shown at strength without a surface behind it.

★ **And a latent NaN, found by the atlas and fixed for both.** A `requestAnimationFrame`
callback is handed the time the *frame* began, which can be earlier than the
`performance.now()` read when a globe was constructed — the hero never showed it
because it is built before the first frame exists, but §03's atlas is built from a
click handler and its first `dt` was reliably −18ms. A negative `dt` is harmless in
the eases; in the `MAX_TURN` clamp it makes `cap` negative, so a camera that is not
moving at all fails `mag > cap` and is scaled by `cap / 0` — −Infinity times −0 is
NaN, and both angles were NaN from the second frame on. No surface, no pins, no sun,
one frame after construction, silently. `dt` is floored at zero and the clamp takes
`mag > 0`; either fix alone leaves the other reachable.

### The night side

> "The lighting on the dark sides of the Earth can look weird."

Two causes, and both were in `buildLut()`:

- **The city lights were burning on the day side.** `dusk` ran to `L = 0.30`, which
  is ~17° of arc *past* the terminator and well into daylight, so every lit city was
  also glowing on ground the sun was standing over. The top of the ramp is inside
  the twilight band now.
- **The unlit hemisphere was one flat number.** `ambient` was a constant, so an unlit
  *ocean* — which has no hillshade of its own to give it away — came out as a dead
  slab with a hard edge at the limb, and the sphere stopped being a sphere on the
  half of it that was dark. `L` already runs −1 at the antisolar point to 0 at the
  terminator, so a gentle ramp along it costs nothing and gives the dark half its
  roundness back.

And the lamp compensation is keyed to **magnification** rather than to `zoom`. The
glow is baked at a fixed radius in texels, so magnifying the plate magnifies every
light with it — `zoom` was only ever a proxy for that, a good one while the raster
covered the whole disc. Once it covers the window, and once `zoom` means two
different things in two projections, the honest term is texels per screen pixel.

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

### The track layouts are 3D — the panel's, and §03's racing line with them

`js/layout3d.js`, and it is 1.x's venue map brought across: the layout on a plane
tilted back 56°, drag to orbit, pinch or scroll to zoom, arrow keys, RESET VIEW, and
a one-time reveal. There is **no elevation** — `data/atlas.js` has no height in it,
so banking and gradient would be the only invented numbers on the page.

★ **§03's figure is the same stage**, with a live canvas for its ground instead of
an SVG. Theodor: "have the 3D track map, but with the racing line in that area — so
you can interact with it, and you also see the racing line on the track itself." So
the solved line, the tarmac it is solved inside and the 900 particles pacing
themselves off the speed profile all lie on a plane the reader can turn. Three
things about §03's stage differ from the panel's, and each is because it is a block
in a scrolling page rather than an overlay the reader opened:

- **`touch-action: pan-y`, not `none`.** A stage as tall as the phone that owns the
  gesture outright is a place the page stops scrolling. Vertical drags go back to
  the page; horizontal drags and pinches are the orbit and the zoom.
- **A plain wheel scrolls the page** (`data-wheel="modifier"`); ctrl/⌘-wheel zooms,
  which is also what a trackpad pinch sends.
- **The stage is sized to the circuit, not the circuit to the stage.** `poseFit()`
  inverts the projection: a plane w×h turned by θ about Z and φ about X lands on
  screen as `w·|cos θ| + h·|sin θ|` by `(w·|sin θ| + h·|cos θ|)·cos φ`, plus the
  room the tallest post needs. A 3:1 Gelleråsen in a fixed 560px box used a quarter
  of it — that empty three quarters was "the circuit is really small for the area
  itself". Both directions are solved, because a portrait lap is height-limited
  rather than width-limited and Uddevalla clipped its own turn 6 off the top before
  the height was fed back in.

The other half of that complaint was in `js/circuit.js` and was not about the box
at all: the numerals used to be drawn into the canvas *outside* the lap, so `fit()`
reserved up to 118px on every side for them. On a phone that is 236px of a 370px
canvas held for text. With the numbers on posts the reserve is the width of the road
and a little air, and the drawing measures 0.77–0.99 of its canvas in both axes
where it measured 0.73 × 0.34.

★ **The pose is animated as registered custom properties, not as a transform.** The
reveal used to be `transition: transform` on the plane, so for its 780ms the plane
eased toward a pose while `--tilt` and `--rot` — which the numerals counter-rotate
by — were already at the destination. The numbers swung out over the drawing, and
Alviks Ring's turn 6 left the stage entirely. `@property` makes the three pose
values interpolable, so everything downstream is derived from one set of numbers
that is consistent at every frame rather than at its two ends.

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

**New equipment goes in `GEAR_CATALOGUE`, never in `KIT_1X`.** That array's whole
value is that §05 can print "your equipment" and be telling the truth; appending a
tripod nobody owns to it turns that sentence into a guess, silently, on every
device. So the eighteen additions live in a separate list the kit panel offers one
press at a time — `catalogueLeft()` filters out anything already in the kit by name,
`addFromCatalogue()` moves one across, adopting the list on screen first if it has
to. Nothing is ever added automatically. What is on it, and what was deliberately
left off it, is written down over the array.

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

**Offline is complete, and the page makes zero cross-origin requests.** The shell,
the data, the earth imagery, the icons and the typeface are all either precached or
inlined, so a cold launch on a phone that has never seen the site — and has no signal
— renders correctly, Outfit included. Verified with the dev server stopped outright
rather than with a throttling toggle: 18 resources, none of them off-origin, none of
them failed.

The worker therefore has **no cross-origin branch at all**, which is a property of the
page rather than an omission. It used to carry a `fonts.gstatic.com` cache, and that
was the hole: the typeface only arrived on the *second* load. If anything here ever
needs a CDN again, that is the regression to catch.

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

246 checks in headless Chrome: no page errors, every section renders the right
number of things, the numbers on the page equal the numbers in `data/atlas.js`,
the countdown ticks, both pills work and persist, deep links land, nothing
overflows sideways at 390 / 768 / 1440 / 1920, the panel routes and traps focus,
gear ticks never touch 1.x's storage — and, from §10 on, **rendered geometry**.

★ **The browser is recycled every eight pages, and without that the suite does not
finish.** On Chrome 150 the browser process dies partway through a run and every
`newPage()` after it fails with `Protocol error (Target.createTarget): Session with
given id not found` — which reads like a puppeteer fault and is not one.
Reproduced with nothing in the loop but open, wait, close, and against a checkout
from several sessions back, so it is neither this page nor the GPU (`--disable-gpu`
and `--disable-gpu-compositing` both survive a bare loop of eighteen and both still
die here). It was landing at §10e, leaving §11, §12 and §13 unrun — and exiting on
a **stack trace rather than a FAIL**, so a run that checked three quarters of the
page looked like a crash rather than like an amber suite. Two real failures were
sitting behind it: a numeral clipped off Alviks Ring's stage, and the whole of §12d
and §13.

If you add a check that needs two pages open at once — §4 and §11 both do — nothing
special is required: `newPage()` only recycles when nothing of ours is open.

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
emits a `NaN` attribute or a numeral outside its frame, and — §12d — that the sun is
the real one: its subsolar longitude tracks UTC to inside the equation of time, it
does *not* move when the camera swings 8°, and the lit fraction of the face does.
§14 covers session 8: the chapter jump reaches every `section[data-chapter]` in
document order and survives 360px, no index bar prints `c/km` again, and — §14c —
the globe is actually in the reader's hands.

★ **The first check in §14c is not about zooming.** It is one `elementFromPoint`
asserting that a point on the disc hit-tests to the globe, and it would have caught
either of the two silent failures above on its own — as would the one beside it,
which asserts the disc is still *painted* under `#scrim` and `main` while being
*hit* above them. Prefer a behavioural check to a source-level grep here: a third
bug nearly shipped behind those two, an unterminated comment in `app.css` that ate
the `z-index` rule without a word, and a grep for the selector would have passed
it. A malformed comment in `index.html` did the same thing again a few minutes
later and put its own prose on the phone hero.

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

- **Fonts are self-hosted** — **Outfit**, one variable file over weights 100–900, and
  nothing else. Session 4 replaced the original trio (Bodoni Moda display, Newsreader
  body, JetBrains Mono labels) with a single geometric sans, so the page now separates its
  registers by weight and tracking rather than by changing face. Two things follow from
  that and are documented where they bite: `--font-mono` and the `.mono` class kept their
  names but no longer mean monospaced, and every column that used to stay put because the
  pitch was fixed — the ticking countdown above all — now asks for `tabular-nums`
  explicitly.

  `fonts/*.woff2` is the committed source, 46 KB over the two subsets Google
  publishes; `assets/fonts.css` is **generated** from it by `trace/fonts.mjs` and is
  what `index.html` actually links.

  ```bash
  node trace/fonts.mjs            # regenerate assets/fonts.css from fonts/
  node trace/fonts.mjs --fetch    # re-download the woff2 from Google first
  ```

  ★ **The faces go in as base64 `data:` URIs, and that is not an optimisation.** The
  same stylesheet has to be correct in three places that disagree about what a
  relative `url()` means: served, it sits in `assets/`; inlined by `trace/bundle.mjs`
  it resolves against the repo root; and inside the `.dc.html` pair it is opened off
  `file://` with no sibling `fonts/` at all. A `data:` URI has no base to be relative
  to, so it is right in all three. That is also why it is a separate sheet rather than
  a block in `tokens.css` — 61 KB of base64 would bury the one file whose whole job is
  to be read.

  ★ **Do not write a stylesheet `<link>` tag out in prose inside `index.html`.**
  `trace/bundle.mjs` finds them with a regex that cannot tell a comment from markup,
  and will try to open whatever stands in the `href`. A comment explaining the font
  link is what caught this, and the build died on a file named `…`.
- **Motion is on by default, and the choice is remembered** in `fa2.motion`. It used to
  be `motion = !matchMedia('(prefers-reduced-motion: reduce)').matches` and nothing else
  — the OS setting was re-read on every load and the reader's answer was never stored
  anywhere, so on Windows, which reports `reduce` whenever *Accessibility → Visual
  effects → Animation effects* is off, the page booted still every single time and the
  pill appeared not to work. `prefers-reduced-motion` is now the **first-run hint only**;
  after that the stored answer wins. Overriding an accessibility setting by default is a
  real cost, paid on three conditions: the opt-out is one tap, it is in the topbar at
  every width (the ≤460px block trims the brand's tracking and the chapter title, and
  keeps every control), and it persists — and on the one cold load where 2.0 overrules
  a reader who did ask for less motion, the pill wears the accent so the override is
  visible. The MOTION pill is the single authority: `body.no-motion` is how it is
  expressed and there is no `@media (prefers-reduced-motion)` block left in `app.css`
  to disagree with it.
  With motion off the page is fully static and everything is legible — with one
  deliberate exception: the globe's still-frame signature carries the subsolar
  longitude to a tenth of a degree, so the lighting is allowed to update about every
  twenty-four seconds rather than freezing at whatever it was when MOTION went off.
  A real terminator creeps 15°/hour whether or not anyone is scrolling, and a still
  globe showing this morning's shadow at midnight is wrong in a way a static page is
  not. verify.mjs §8's ceiling is two repaints per *second*; this is two and a half a
  minute.
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
