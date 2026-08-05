# Session 8 — the hero lets go of the Earth, §03 picks it up, and the kit gains a shelf

Four things Theodor reported, plus two bugs found on the way that neither of us was
looking for. **Field Atlas 1.x is untouched.** **Nothing committed and nothing
pushed** — the working tree is dirty and `git diff` is the review.

`node trace/verify.mjs` — **267 checks, 267/267**, was 246.
`node trace/bundle.mjs --check` — both `.dc.html` files in sync with the sources.
`sw.js` `CACHE_VERSION` bumped to `fa2-v4`, and `data/atlas-extra.js` added to the
precache list.

---

## 0 — what was asked, and what was decided

> "Currently I'm checking the Field Atlas app, and the globe is a bit inconsistent.
> Sometimes it spawns in the middle of the screen or in the upper section. When I'm
> zooming in on the globe, I feel like you should be able to maybe have a separate
> section for that. For the globe itself, make that also a map… Remove the
> interactive thing on the main page where you load in, because that's just weird…
> make the spawning or the load-in of the globe consistent and higher quality,
> because I feel like it's still a bit blurry. The lighting on the dark sides of the
> Earth can look weird, and it's just not as sharp, especially not when you move it
> around."

Four decisions taken with him before any of it was written:

- **the atlas is a TAB in §03**, not a new chapter — "in the same section as the
  anatomy, but just a different tab in the same area";
- **globe ⇄ map on a toggle**, both real projections;
- **the hero keeps its planet, purely decorative**;
- **worldwide is the destination but no track data lands this session** — "don't add
  any more tracks because I will take that into my own hands with you later." So
  `data/atlas-extra.js` ships **empty**, with the row shape documented in its header
  and every surface built to take it at any length.

---

## 1 — "sometimes it spawns in the middle of the screen or in the upper section"

Three independent causes. All three had to go, and only the first is the one anyone
would have guessed.

**`top: 40%` under 760px.** Forty per cent of the *viewport height*, which on a
phone is not a constant: hiding the URL bar takes 412×915 to 412×800 and the disc's
centre slides 46px up the screen while the reader does nothing but scroll. Show the
bar again and it slides back. Two resting places, alternating, out of one
declaration — and which one you got depended on how the page had been arrived at.
It is `top: 50%` at every width now, which is a percentage of a height the disc is
then *centred* in and is therefore immune to it changing, and the lift the phone
layout genuinely wants is `--globe-lift` in `vmin`. `vmin` in portrait is the width.
`js/scroll.js` carries the property through the parallax transform, so there is one
expression and no width-specific branch.

**The parallax landed a frame late on a restored scroll.** `initScroll()` ends in
`remeasure()`, so the transform is right from construction — but a browser restores
the scroll offset *after* the first paint, and the disc arrived full-size at its
unscrolled position and then jumped to a 0.54 scale twelve vmin across. One
synchronous `scroll.refresh()` under the same rAF that adds `body.lit`.

**And the plate was still decoding.** `loadPlate()` bakes three images; until it
lands `buildSurface()` paints the plain unlit sphere in its `!px` branch, which the
real Earth then replaced in a single frame. Two arrivals, the first of them wrong,
and on a slow connection the gap is long enough to read as a bug rather than a load.
The disc is composited through `warm` now — `destination-out` over the finished
frame, so the pin pass's own per-pin alpha is not disturbed — held at 0 until
`PLATE.ready`, then eased over 420ms, with a 900ms fallback so a bake that fails
outright still gives the reader a planet.

§14a asserts the disc centre lands at the same *fraction* of the viewport at 915px
and at 800px; §14a′ asserts no frame is ever drawn at strength without a surface
behind it.

---

## 2 — "remove the interactive thing on the main page"

`#globe-hit`, `#globe-ui`, `#globe-hint`, `#globe-reset`, `body.globe-hot`,
`globe-zoomed`, `globe-turning` and the `fa2.globeHint` key are gone, along with
~10 300 characters of pointer, touch and wheel handling in `js/main.js` and the
whole hit-layer block in `app.css`.

None of the reasoning in those comments was wrong — the disc genuinely does have to
be painted under `#scrim` and hit above `main`, and one element genuinely cannot be
on both sides of one layer. It was solving a problem the page no longer has.

★ **Every constraint that made the hero's globe awkward came from it being a
backdrop.** It needed a line of type to advertise itself; it could not zoom past
4.2× because eight pins had to stay separable behind body copy; on a phone it sat
under the lede. Moving it to a stage removed all three at once rather than
one at a time, which is why this is a better answer than tuning any of them.

§12a asserts the elements stay gone. §14b asserts the behaviour — a drag and a
ctrl-scroll do nothing to the hero, and `elementFromPoint` at the centre of the disc
returns something in the page.

---

## 3 — §03 is two tabs, and the atlas is the second

`RACING LINE` is the default and that is load-bearing: §12b, §12c and §13c all query
`#fig-3d`, which is only in the layout while its tab is open. Change the default and
three sections start measuring a hidden subtree.

The tab is part of the **paint gate**, not just a class on a div. `applyGates()`
runs exactly one of the two canvases and neither when the chapter is off screen —
half a fix would leave two full-resolution surface passes sharing one frame budget
for the life of the page. The atlas is built lazily on first open, because
`createGlobe()` allocates a surface canvas, an ImageData and the whole geometry
cache, and at boot that competes with the hero's globe, the starfield and the relief
bake for a stage three screens down that may never be opened.

On the stage: 40× rather than 4.2, deconflicted pin labels in priority order (a
booked date outranks a competition circuit outranks a reference pin, so the name
that loses a collision is always the less important one), a searchable and
filterable list that flies the camera, and **one element taking its own pointers**,
because nothing is over this canvas.

★ **`setPointerCapture` ate the chrome, and it took a screenshot to see it.**
GLOBE / MAP / RESET VIEW live inside the stage, so their `pointerdown` bubbles to it
— and capture then retargets every later event, *including the click*, to the
capturing element. The buttons were drawn, were hit-testable to puppeteer, and did
nothing: pressing MAP turned the planet a pixel instead. Exactly the failure the
hero's own RESET VIEW had in session 6 for the mirror-image reason, and just as
silent. A press that starts on `.atlas-bar` is the chrome's now.

---

## 4 — the map, and why it is not a second renderer

`mode` splits `js/globe.js` in three places — `project`/`unproject`, `buildGeo`, and
the chrome `paint()` draws around the edge — and everything between them is shared
byte for byte. `buildGeoMap()` fills the *same* flat arrays in the same units,
including the surface normal in the same camera-space basis `setSun()` rotates the
sun into, so the per-pixel sample loop, the LUT, the plate fetch, the wide tap, the
dither and the city lights never learn the projection changed.

That is the whole design and it is worth being explicit about why: the sun, the
terminator, the twilight ramp and the city lights are two hundred lines of tuned
code, and a second copy of them drifts from the first the day after it is written.
§14d asserts the consequence — the subsolar point either side of the toggle is not
merely close, it is the same number.

Three things about the flat plate:

- **The ±180° seam is a real edge.** A ring crossing it has two consecutive points a
  whole world apart in x, and joined naively Eurasia grows a bar across the map.
  Same class of bug as the land mask in `js/earth.js`, same shape of answer: unwrap
  relative to the camera, break the run at any step over half a world.
- **The fresnel is killed in the LUT, not per pixel** — it is a function of the
  surface turning away from the reader, which on a plate is nothing at all, and left
  on it painted a blue haze down the two meridians 90° from the camera.
- **Switching preserves the ground, not the number.** `zoom` counts divisions of the
  world on one side and multiplies a radius on the other, so what is carried across
  is the visible longitude span — raised, on the map, far enough that
  `mapLatClamp()` still holds the current latitude centred. Preserving the span and
  preserving the place conflict at Swedish latitudes; the place wins. Pressing MAP
  over Sweden and getting the Mediterranean would be a bug.

---

## 5 — "it's still a bit blurry, especially when you move it around"

**Arithmetic again, and in one line.** `buildSurface()` rastered the *entire disc*
into a buffer capped at `RASTER_MAX` and `paint()` blitted it to
`(cx−r, cy−r, 2r, 2r)`. At 1× that is exactly right — 1 024 is the plate's own texel
count across a hemisphere, which is what session 7 fixed. At 4× the disc is 3 200 CSS
pixels across, three quarters of it is off screen, and the same 1 024 buffer is
stretched over all of it.

`viewWindow()` returns the intersection of the disc with the canvas, `buildGeo()`
walks it, `paint()` blits to the matching rect. **At zoom 1 with the disc inside the
box the window is [−1,1]² and it is the same numbers through the same code**, so §00
cannot regress. At 4× it is four times the linear resolution for the same pixel
count. Rounded *outward*, never to nearest, because the window is both what the
geometry is built for and what the result is blitted to — inward would leave a
hairline of unpainted canvas at the viewport edge.

Three consequences:

- **`RASTER_MOVING` doubled**, because the buffer it caps is no longer the whole
  planet. The ladder still times itself.
- **The geometry cache's latitude quantum is a screen pixel now.** `lat.toFixed(1)`
  is a tenth of a degree of *ground*: three quarters of a pixel at the hero, thirty
  at 40×. It would have left the relief lying thirty pixels from the coastline
  struck over it.
- **A zoom counts as moving.** The window is a function of the zoom, so an easing
  pinch invalidates the cache every frame exactly as an easing latitude does.

★ **Past the plate's own detail, stop pretending there is a photograph.** Fading
toward luminance was the first attempt and it does not work — desaturating a blurred
photograph gives a blurred grey photograph. What magnified imagery lacks is not
colour, it is that every edge in it is four texels wide. So past ~3× magnification
the sample cross-fades to a flat **land or sea** tone, decided by the sample's own
blue dominance (the same property `js/earth.js` turns on to find the city lights),
plus a quarter of the relief's tonal variation so shape still registers. The
coastline and the graticule carry the picture, and the graticule densifies
20° → 5° → 1° → 0.2° with the zoom, which the fixed 20° packed rings never did. The
deep view reads *sharper* than the shallow one.

The thresholds are the hero's, measured: at the sub-camera point one device pixel
spans `PLATE_W / (2π · r · dpr)` texels, which on the hero disc is 0.64. The fade
starts at 0.33 and completes at 0.14, so §00 is a full octave clear of it.

---

## 6 — the night side

Two causes, both in `buildLut()`:

- **The city lights were burning on the day side.** `dusk` ran to `L = 0.30`, which
  is ~17° of arc past the terminator and well into daylight, so every lit city was
  also glowing on ground the sun was standing over. 0.12 puts the top of the ramp
  inside the twilight band the terminator is drawn over.
- **The unlit hemisphere was one flat number.** `ambient` was a constant, so an
  unlit *ocean* — with no hillshade of its own to give it away — came out as a dead
  slab with a hard edge at the limb, and the sphere stopped being a sphere on the
  dark half. `L` already runs −1 at the antisolar point to 0 at the terminator, so a
  ramp along it costs nothing and gives the roundness back.

And the lamp compensation is keyed to **magnification** rather than to `zoom`. The
glow is baked at a fixed radius in texels; `zoom` was only ever a proxy for how far
the plate is being blown up, and a good one while the raster covered the whole disc.
It is not one once the raster covers the window, and it is not one at all once
`zoom` means two different things in two projections.

---

## 7 — ★ the latent NaN, which the atlas found and both globes needed

A `requestAnimationFrame` callback is handed the time the **frame** began, which can
be earlier than the `performance.now()` read when the globe was constructed. The
hero never showed it — it is built at boot, before the first frame exists. §03's
atlas is built from a click handler, so its first `now` was reliably 18ms in the
past and `dt` was negative.

A negative `dt` is harmless in the eases, which multiply a zero difference by it. It
is not harmless in the `MAX_TURN` clamp: `cap = MAX_TURN * dt` goes negative, the
test `mag > cap` passes for a camera that is not moving at all, and the scale factor
is `cap / 0` — which is −Infinity, and −Infinity times the −0 it is scaling is NaN.
Both angles were NaN from the second frame onward and every number downstream of the
camera went with them: no surface, no pins, no sun, no terminator.

Silent, total, one frame after construction. `dt` is floored at zero and the clamp
takes `mag > 0` as well as `mag > cap`; either fix alone leaves the other reachable.

---

## 8 — the kit gained a shelf

Asked to choose the scope rather than take every category offered — "I feel like
it's maybe gonna be too much if it's all of them" — the rule applied was: it goes in
if it extends something already in the bag, or closes a real gap in a full race
weekend. **Eighteen items**, in `GEAR_CATALOGUE`.

★ **They could not go into `KIT_1X`.** That array is the inventory Field Atlas 1.x is
*known* to have carried, recovered from commit `dacef4d`, and its whole value is
that §05 can print "your equipment" and be telling the truth. Append a tripod nobody
owns and that sentence becomes a guess, silently, on every device. So the catalogue
is a separate list the panel offers one press at a time; `catalogueLeft()` filters
by name, so the shelf empties as it is used and disappears when it is done.

`addFromCatalogue()` adopts the list already on screen if it has to. That is the one
place adoption happens without its own button, and it is deliberate: pressing + beside
a named piece of equipment *is* an explicit act, and making the reader press ADOPT,
read a paragraph about 1.x and then find their place again would be ceremony rather
than consent. Nothing appears or disappears at that moment; the only visible change
is the thing they asked for.

**In:** the five lenses he picked by name (50, 85, 150–600, 1.4× TC, tubes — all
RENTAL, the sign he asked for on gear he wants and does not have), eight accessories
that follow from a monopod and a CPL, and five power-and-storage items, because one
128 GB card and one power bank is not a weekend.

**Out, deliberately:** a tripod, because he shoots motorsport off a monopod and it
would sit in the list unused; the stool / headlamp / first aid / multi-tool group,
because he already carries the three that matter and the rest is exactly the
generic-basics category 1.x deleted its seed to escape; and video, drone and press
gear, which he did not choose. **No flash or strobe** — 1.x's standing rule, kept.

§14f asserts `evhub.*` is byte-identical across an add, extending §9g to the one new
code path that creates inventory rows.

---

## What §14 asserts, so none of it comes back

- the disc lands at the same fraction of the viewport at 915px and at 800px, and is
  centred on a wide page;
- no frame is shown at strength before the plate has baked, and the fade finishes;
- a drag and a ctrl-scroll do nothing to the hero, and its centre hands clicks back;
- §03 opens on the racing line; the open tab paints and the hidden one does not;
- the map and the globe report the same subsolar point, the camera survives the
  swap and the same ground is under the reader after it, and dragging the plate west
  moves the camera east;
- the atlas zooms past 4.2×, what is on screen is rastered at the resolution it is
  shown at, labels appear, the grid tightens, RESET VIEW appears and works;
- the list flies the camera to a named circuit and the pin under it opens that
  circuit;
- adding from the gear catalogue leaves 1.x byte-identical and the item leaves the
  shelf;
- and the MOTION pill reaches the atlas, which is a third canvas built *after*
  `applyMotion()` last ran and is therefore exactly the kind of thing that goes on
  drifting while the pill says everything has stopped.

---

## Left alone on purpose

- **`data/atlas-extra.js` is empty.** Asked for directly. The section, the plotting,
  the labels, the filters, the search and the panel routing are all finished and all
  take the array at whatever length it reaches.
- **The hero's globe keeps its 4.2× ceiling in the constants**, unused now that
  nothing zooms it. It is the default `zoomMax` and the atlas overrides it, so the
  number that documents *why* 4.2 was chosen stays where its reasoning is.
- **The 20° packed `GRATICULE` rings are still used at world scale.** They are
  already packed and already right; the dynamic grid only takes over below them.
- **The land/sea split at deep zoom follows the blurred sample, not the coastline.**
  It is soft by a texel or two where the imagery is soft, and the full-resolution
  coastline struck over the top is what carries the edge. Solving it properly would
  mean a second land mask sampled at draw time, for something no one can see under a
  1px stroke.
