# Session 6 (Jul 30 2026) — the sun, the surface, the 3D layout, and a real racing line

Four things Theodor asked for, in one overnight pass. **Field Atlas 1.x is untouched.**
Nothing committed and nothing pushed, at his instruction — the working tree is dirty and
`git diff` is the review.

`node trace/verify.mjs` **has not been run this session**: puppeteer-core is not installed on
this machine and there is no Python either, so `trace/serve.py` and `trace/bundle.py` cannot
run. Everything below was verified instead by driving headless Chrome directly from the CLI
(`--screenshot`, `--dump-dom`, `--virtual-time-budget`) against a Node port of the dev server.
See **What is not verified** at the bottom, which is the most important section in this file.

---

## 1 — the sun comes from the camera now

> "Change the direction the sun comes from, so it's always shining on the side that's towards
> me looking at the screen."

This **reverses session 4 on purpose**, and the note over `SUN` in `js/globe.js` says so. Session
4 made the light a direction in world space at the real subsolar point, which was correct and
was also the problem: the idle drift and the per-entry look-ats sit over Europe, and at European
evening the venue the page was talking about was on the unlit side.

The light is a fixed direction in **camera** space, offset up and to the left — `(-0.44, 0.38,
0.81)` normalised. Not head-on: a light down the camera axis makes every visible normal face it
and the disc flattens into a bright coin. Offset, the Lambert term still falls away toward the
lower-right limb, so there is a crescent of shadow over the outer fifth of the radius and the eye
still reads a ball.

- `terminatorAt()` returns `SUN.z` = **0.812** — four fifths of the face can never be in shadow.
  Published as `data-sun-lit`.
- `data-sun-lat/lon` still publish a subsolar point, but it is the one **implied** by a
  camera-space sun (`sunWorld()`, the exact inverse of the rotation `buildSurface()` used to
  apply the other way). Same two fields, opposite invariant — see §12d of verify.mjs.
- ★ **`subsolar()` is gone, and with it the reason the still frame could not be still.** The
  MOTION-off signature carried the subsolar longitude, because a real terminator creeps 15°/hour
  whether or not the camera moves. Locked to the camera it cannot change unless the camera does,
  and the camera is already in the signature. MOTION off is now a genuinely dead canvas.

## 2 — the Earth is a relief map, not a photograph

> "Make Earth look a bit more natural — not a satellite image. Shaded relief, with city lights on
> the dark side. And make sure it's smooth and doesn't have buggy artifacting."

New module `js/earth.js` bakes one 1024×512 RGBA plate at boot out of three sources: elevation
(the shape — every gradient and every shadow), Blue Marble (a heavily low-passed colour cast, and
nothing else), and Earth at Night (the lights, in the alpha channel so both come out of one
bilinear fetch). `js/globe.js`'s sampling loop is unchanged; only what it samples changed.

Four bugs found by looking at the plate laid out flat rather than wrapped round a sphere. That is
what `trace/plate.html` is for and it paid for itself in the first ten minutes.

- ★ **A white ring right round the Arctic.** Three of the 892 coastline rings run off one edge of
  the map and back on at the other — Eurasia does it twice, at 65.0°N and 69.0°N. Joining lon
  +179.9 to −180.0 in raster space is not a 0.1° hop, it is a chord across the entire width, and
  the even-odd rule then filled the band between the two chords as land. Fixed by unwrapping each
  ring's longitudes before filling and folding the plane back onto the cylinder afterwards. **The
  plate is a cylinder. Anything that fills it as a rectangle will do this again.**
- ★ **The city lights were gated on the wrong colour, and it cost hours.** The extraction tested
  for WARM light, on the reasoning that street lighting is sodium and mercury vapour. True of the
  light; false of that image. Measured: Tokyo (234,232,232), Moscow (246,246,244), Stockholm
  (224,222,218) — the settlements are rendered essentially **neutral**, and it is the *backdrop*
  that is coloured (sea 8,8,16; Sahara 24,24,57; Greenland ice 33,24,57 — all blue-dominant by 8
  to 33 levels). The warmth test scored Tokyo at 1/255 and the terminator rendered dead black
  with a perfectly good lights channel behind it. Now gated on blue excess, with luminance
  setting the strength: every probe separates cleanly, and every backdrop probe reads exactly 0.
- ★ **And then they still did not survive the trip.** A city is one to three texels, and the only
  place they are visible is the crescent at the limb — which is exactly where an orthographic
  sphere compresses a hemisphere of texels into a few pixels. Bilinear sampling dropped them
  between samples. They are bloomed at bake time now, spread over four or five texels and
  multiplied back up. Which is also what a city looks like from orbit.
- ★ **Antarctica's coast came out sand-coloured.** The ice sheets are thin at the edge, so their
  coasts sit at the bottom of the hypsometric ramp — lowland green — and the colour-cast transfer
  cannot rescue it, because that transfer moves hue and never lightness, and white has no hue to
  give. Ice is detected separately: where the land cover is **bright and neutral**. Neutrality is
  what separates it from the deserts, which are just as bright and nothing like as grey.

Two smoothness fixes worth keeping:

- The limb carries a sub-texel **coverage alpha** and is drawn **outside** the arc clip. Canvas
  `clip()` is not antialiased in Chrome, so clipping to the arc was quantising the silhouette to
  whole device pixels and throwing the coverage away at exactly the edge it was computed for —
  plus a dark fringe where the 1.6× upscale blended opaque against transparent black. That was
  the most visible artefact the globe had.
- A ±1 level ordered dither on the surface output. The sea ramps from shelf to deep across a
  third of the disc and the fresnel ramps across the limb; at 8 bits both banded into contour
  rings, and a rotating planet turns static rings into moving ones.

Relief exaggeration is scaled by `1/cos(lat)` **floored at 0.35**. Honest hillshading divides by
the cosine outright, and at 85°N that is an elevenfold gain that shatters Greenland and Antarctica
into black-and-white noise.

## 3 — the panel's track layout is 3D

`js/layout3d.js`, plus a `p3d-*` block in `assets/app.css`. 1.x's venue map brought across: tilt
56°, rotation −18°, drag to orbit, pinch or scroll to zoom, arrow keys, RESET VIEW, one-time
reveal. Applies to both the date panel and the circuit sheet.

- **No elevation, deliberately.** `data/atlas.js` has no height in it. Banking and gradient would
  be the only invented numbers on a page that prints its sources under every drawing.
- ★ **The numerals had to leave the SVG.** Flat on a plane turned back 56° a numeral is squashed
  to two fifths of its height, and past ~70° it is a line. They are DOM objects standing in the
  scene now: each rides a post off its own apex and is counter-rotated by exactly the stage's
  rotation (`RX(t)·RZ(r)·RZ(−r)·RX(−t) = I`), so the post leans and the number never does.
- ★ **Crowded corners get taller posts.** Gelleråsen has turns 2, 3, 5 and 6 within a fifth of
  the drawing; on posts of one height their labels landed in a stack and the middle two were
  unreadable at any angle. Three tiers, assigned by distance in the drawing so it is the same
  decision at every zoom.
- ★ **Nothing in the `preserve-3d` chain may flatten it.** `overflow`, `filter`, `opacity` under
  1, `clip-path`, `mask` or `will-change` on `.p3d-plane`, `.p3d-marks` or `.p3d-mark` silently
  collapses the subtree, with no warning anywhere. The clipping lives on `.p3d-stage`, which
  carries the perspective and is not part of the chain. **If a post ever renders flat, look
  there first.**
- The plane is sized **past** the stage box, because tilting squashes it by cos(56°) ≈ 0.56 and a
  plane sized to fit flat used barely half the height.
- `createPanel()` gained an `onAfterRender` hook. `onRender()` returns a string, which cannot
  carry a listener; wiring inside `show()` would have worked on open and failed silently on
  `refresh()` — tick a gear item and the layout stops turning, with nothing in the console.

## 4 — §03 solves for lap time

> "Make a lot more measuring points for the line to be accurate… search up how a normal racing
> line is, how drivers take lines."

Both halves were real. Resolution was half of it; the objective was the other half.

- **1 400 evenly spaced nodes**, resampled by arc length. It was 29–72 for a sampled centreline,
  and unevenly spaced from every source. Every solver in `js/loop.js` assumes even spacing — the
  Laplacian's strength per sweep goes as the square of the node spacing, the curvature stencil is
  a fixed number of nodes, the speed profile integrates `ds` between them. And at the old density
  an apex was three or four nodes, so a late apex could not be *expressed*, let alone found.
- **A speed model.** `speedProfile()`: `√(a_lat/κ)` per node, then backward for braking and
  forward for power, twice round because a braking zone can begin before the start line. Two
  vehicle profiles, chosen by lap length — under 2 km is a kart, Gelleråsen is a car. These are
  the only invented numbers in the project and they never reach the page; no lap time is printed.
- **A minimum-time refinement.** The minimum-curvature relaxation is now only a starting guess.
  A coarse-to-fine descent then nudges apex-sized *regions* of the line — a raised-cosine bump
  over ±13 nodes — wherever the lap time drops.

★ **Moving one node at a time does not work, and it is worth knowing why.** One node of 1 400
changes the line by a fraction of a millimetre over a metre and a half of track: the lap time
does not measurably move, every trial is rejected, and any that are accepted put a one-node spike
in the line that the curvature stencil then reads as a hairpin. What distinguishes a late apex
from a geometric one is where twenty metres of road sits, not one point.

★ **And the first version allocated twenty-six million throwaway arrays.** `localTime()` built
three little `[x, y]` arrays per node of a 121-node window, seventy thousand times. It was not
slow because of the arithmetic. Everything in there is scalars over flat typed arrays now.

**Measured, across all 21 circuits with geometry:** the mean apex position moves from **0.286** of
the way through a corner to **0.449**, and 91 of 228 corners end up past 0.55. It does not push
everything late, which is correct — a corner feeding into another corner should apex early. The
whole solve is ~90 ms per circuit, once, when the reader picks one.

The figure's flow is paced off **speed** rather than curvature now. They agree in a corner and
come apart exactly where the figure is interesting: a driver is still braking where the road has
gone straight, and already accelerating where it has not finished bending.

Two smaller fixes fell out:

- The particle advance was one node per frame. At 1 400 nodes instead of a few hundred that would
  have made the flow three or four times slower on every circuit. It is laps per second now.
- ★ **MOTION off did not mean fully drawn.** The road and the line jumped to complete, but the
  apex ticks and corner numbers are held back on `reveal`, which is a clock and went on running —
  so the figure came up complete and then grew its numbers 1.5 s later, with the pill that turns
  animations off pressed. Fixed in both `load()` and `setMotion()`.

---

## Tooling added

- `trace/serve.mjs` — the dev server in Node. `serve.py` is unchanged and they are
  interchangeable; this exists because there is no Python on every machine this gets opened on,
  and a project whose selling point is "no build step, just serve it" should not be un-runnable
  for want of an interpreter it never needs.
- `trace/plate.html` — the baked Earth plate laid out flat: the relief, the lights channel on its
  own, the land mask, and the whole sphere at a camera the query string picks. **Every globe bug
  in this session was found here and none of them were visible on the page.**
- `trace/figure.html` — §03's figure on a bare canvas, one circuit at a time, printing what the
  solver decided. §03 sits behind a scroll reveal and an IntersectionObserver, which makes it
  nearly impossible to capture headlessly.

## What is not verified — read this first

- ★ **`node trace/verify.mjs` has not been run.** puppeteer-core is not installed here. The suite
  was **edited** for the contracts that changed (see below) and syntax-checks clean, but not one
  check has been executed. **Run it before trusting any of this**, and expect the edited checks
  to need a nudge.
- ★ **The two `.dc.html` files are stale.** `trace/bundle.py` needs Python, which is not
  installed. They still carry the old globe, the old figure and no `js/earth.js` or
  `js/layout3d.js` at all. `python3 trace/bundle.py` regenerates them; until then `index.html`
  is the only correct build.
- `trace/shots/` has not been reshot for the same reason (`shots.mjs` needs puppeteer).
- `trace/extract.py` and `sync-source.py` were not run and did not need to be — no data changed.

### Checks edited in verify.mjs, none executed

| § | was | now |
|---|---|---|
| 11d | `#earth-plate` inlines as a `data:` URI | all **three** Earth sources do |
| 12b′ | *(new)* | `data-nodes` ≥ 1000 and `data-solve` = `lap-time` |
| 12c | numerals are `text.c-no` in the SVG | `.p3d-no > span` in the 3D stage |
| 12c | *(new)* | the stage orbits from the keyboard, and RESET restores the pose exactly |
| 12c″ | numerals inside the **SVG's** box | inside the **stage's** box, which actually clips |
| 12d | the sun does **not** turn with the camera | it **does**, and `data-sun-lit` is unchanged by the swing |

### Carry forward

- The corridor is still ~6× the real track width. Everything about the line's *shape* is right;
  its absolute speeds are high because the exaggerated road allows radii no real kart has. No lap
  time is printed anywhere, which is why that is acceptable — do not start printing one.
- The day theme was checked once at 1500×1000 and holds up — the relief sits on the warm paper
  and the type still wins — but it has not been checked at any other width, and the day pass runs
  its own `gain` / `ambient` / `lampGain`. The city lights are at a third strength there, on the
  reasoning that a warm glow on warm paper at 34% opacity is mud. Untested at other sizes.
- `data/atlas.js` still has `distanceKm`, `bearing` and `compass` in it, still unused.
