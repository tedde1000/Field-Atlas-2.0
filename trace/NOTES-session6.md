# Session 6 (Jul 30 2026) — the sun, the surface, the 3D layout, the racing line, the kit

Two rounds in one sitting. **Field Atlas 1.x is untouched** — read from, never written.
**Nothing committed and nothing pushed**, at Theodor's instruction. The working tree is dirty
and `git diff` is the review.

`node trace/verify.mjs` — **158 checks, 158/158**, was 148. Run three times.
`node trace/bundle.mjs --check` — both `.dc.html` files in sync with the sources.

Round 1 was the four things he asked for overnight. Round 2 was his morning notes: the
standalone files, a sharper globe, a smoother racing line, and the gear sections from 1.x.

---

## The four from round 1

### 1 — the sun comes from the camera

> "Change the direction the sun comes from, so it's always shining on the side that's towards
> me looking at the screen."

**Reverses session 4 on purpose**, and the note over `SUN` in `js/globe.js` says so. Session 4
made the light the real subsolar point in world space, which was correct and was the problem:
the drift and the per-entry look-ats sit over Europe, and at European evening the venue the
page was talking about was on the unlit side.

The light is a fixed direction in **camera** space, `(-0.44, 0.38, 0.81)` normalised. Not
head-on — a light down the camera axis makes every visible normal face it and the disc
flattens into a coin. Offset up and left, the Lambert term still falls away toward the
lower-right limb, so there is a crescent of shadow over the outer fifth and the eye reads a
ball. `terminatorAt()` = `SUN.z` = **0.812**, published as `data-sun-lit`.

- `data-sun-lat/lon` still publish a subsolar point — the one *implied* by a camera-space sun
  (`sunWorld()`, the exact inverse of the rotation `buildSurface()` used to apply). Same two
  fields, opposite invariant. §12d asserts the sun now moves **with** the camera, and that
  `data-sun-lit` is unchanged by the swing, because a sun that merely drifted would pass the
  first test alone.
- ★ **`subsolar()` is gone, and with it the reason the still frame could not be still.** The
  MOTION-off signature carried the subsolar longitude, because a real terminator creeps
  15°/hour whether or not the camera moves. Locked to the camera it cannot change unless the
  camera does. MOTION off is now a genuinely dead canvas.

### 2 — the Earth is a relief map, not a photograph

New module `js/earth.js` bakes one RGBA plate at boot from three sources: elevation (the shape
— every gradient and shadow), Blue Marble (a low-passed colour cast, nothing else), Earth at
Night (the lights, in the alpha channel, so both come out of one bilinear fetch).

**Four bugs, all found by looking at the plate laid out flat rather than wrapped round a
sphere.** That is what `trace/plate.html` is for and it paid for itself in ten minutes. None
of them were visible on the page.

- ★ **A white ring right round the Arctic.** Three of the 892 coastline rings run off one edge
  of the map and back on at the other — Eurasia twice, at 65.0°N and 69.0°N. Joining lon
  +179.9 to −180.0 in raster space is not a 0.1° hop, it is a chord across the entire width,
  and even-odd then filled the band between the two chords as land. Longitudes are unwrapped
  before filling and folded back after. **The plate is a cylinder. Anything that fills it as a
  rectangle will do this again.**
- ★ **The city lights were gated on the wrong colour, and it cost hours.** The extraction
  tested for WARM light, reasoning that street lighting is sodium and mercury vapour. True of
  the light; false of that image. Measured: Tokyo (234,232,232), Moscow (246,246,244),
  Stockholm (224,222,218) — the settlements are rendered essentially **neutral**, and the
  *backdrop* is what is coloured (sea 8,8,16; Sahara 24,24,57; Greenland ice 33,24,57 — all
  blue-dominant by 8 to 33 levels). The warmth test scored Tokyo at 1/255 and the terminator
  rendered dead black with a perfectly good channel behind it. Gated on blue excess now, with
  luminance setting the strength: every settlement probe passes, every backdrop probe reads 0.
- ★ **And they still did not survive the trip.** A city is one to three texels, and the only
  place they show is the crescent at the limb — which is exactly where an orthographic sphere
  compresses a hemisphere into a few pixels. Bilinear dropped them between samples. Bloomed at
  bake time now, spread and multiplied back up, which is also what a city looks like from
  orbit.
- ★ **Antarctica's coast came out sand-coloured.** Ice sheets are thin at the edge, so their
  coasts sit at the bottom of the hypsometric ramp — lowland green — and the colour-cast
  transfer cannot rescue it, because that transfer moves hue and never lightness, and white
  has no hue to give. Ice is detected separately, where the land cover is **bright and
  neutral**; neutrality is what separates it from the deserts, which are just as bright.

Plus: a sub-texel **coverage alpha** on the limb, drawn *outside* the arc clip (canvas
`clip()` is not antialiased in Chrome, so it was quantising the silhouette and throwing the
coverage away at exactly the edge it was computed for), and a **±1 level ordered dither** to
stop the sea and fresnel ramps banding into contour rings that move as the planet turns.

Relief exaggeration scales by `1/cos(lat)` **floored at 0.35**. Honest hillshading divides by
the cosine outright, and at 85°N that is an elevenfold gain that shatters the ice sheets.

### 3 — the panel's track layout is 3D

`js/layout3d.js` plus a `p3d-*` block in `assets/app.css`. 1.x's venue map brought across:
tilt 56°, rotation −18°, drag to orbit, pinch or scroll to zoom, arrow keys, RESET VIEW, a
one-time reveal. Both the date panel and the circuit sheet.

- **No elevation, deliberately.** `data/atlas.js` has no height in it. Banking and gradient
  would be the only invented numbers on a page that prints its sources under every drawing.
- ★ **The numerals had to leave the SVG.** Flat on a plane turned back 56° a numeral is
  squashed to two fifths of its height, and past ~70° it is a line. They are DOM objects
  standing in the scene now: each rides a post off its own apex and is counter-rotated by
  exactly the stage's rotation (`RX(t)·RZ(r)·RZ(−r)·RX(−t) = I`), so the post leans and the
  number never does.
- ★ **Crowded corners get taller posts.** Gelleråsen has turns 2, 3, 5 and 6 within a fifth of
  the drawing; on posts of one height their labels stacked and the middle two were unreadable.
- ★ **Nothing in the `preserve-3d` chain may flatten it.** `overflow`, `filter`, `opacity`
  under 1, `clip-path`, `mask` or `will-change` on `.p3d-plane`, `.p3d-marks` or `.p3d-mark`
  silently collapses the subtree with no warning. The clipping lives on `.p3d-stage`, which
  carries the perspective and is not part of the chain. **If a post ever renders flat, look
  there first.**
- `createPanel()` gained an `onAfterRender` hook. `onRender()` returns a string, which cannot
  carry a listener; wiring inside `show()` would have worked on open and failed silently on
  `refresh()` — tick a gear item and the layout stops turning, nothing in the console.

### 4 — §03 solves for lap time

Both halves of "more measuring points" were real: resolution was one, the objective was the
other. The minimum-curvature relaxation is now only a starting guess. A point-mass speed model
(`speedProfile()`) drives the line, and a coarse-to-fine descent nudges apex-sized *regions*
wherever the lap time drops. The late apex is not written down anywhere — it falls out.

★ **Moving one node at a time does not work.** One node of 2 600 changes the line by a
fraction of a millimetre: the lap time does not measurably move, every trial is rejected, and
any that are accepted put a one-node spike in that the curvature stencil reads as a hairpin.
What distinguishes a late apex from a geometric one is where twenty metres of road sits.

★ **The first version allocated twenty-six million throwaway arrays** — `localTime()` built
three `[x, y]` arrays per node of a 121-node window, seventy thousand times. It was not slow
because of the arithmetic.

**Measured across all 21 circuits with geometry: the mean apex moves from 0.286 of the way
through a corner to 0.449, and 91 of 228 corners end up past 0.55.** It does not push
everything late, which is correct — a corner feeding another corner should apex early.

---

## Round 2 — his morning notes

### The `.dc.html` files, and Python

`trace/bundle.mjs` and `trace/serve.mjs` are Node ports of the `.py` originals, byte-identical
output, `--check` on either validates the other's build. They exist because there is no Python
on this machine and **the standalone pair is not an optional artefact** — a session that
cannot regenerate it ships a stale standalone silently, because `index.html` goes on working
perfectly. Both `.dc.html` files are regenerated and in sync.

They are now **4.28 MB**, up from ~1 MB, almost all of it the two new Earth sources as base64.
PROMPT.md's Phase 2 note says to speak up past ~1.5 MB, so: this is over it, knowingly. The
sources are what make the globe work off `file://` and they cannot be linked instead.

### The globe is sharp now

He was right that it was soft, and the satellite was only part of it.

- ★ **The raster was capped at 420 and drawn at 660–1000px** — a 1.6× smooth upscale of the
  terrain with a full-resolution coastline struck over the top, which reads as exactly what it
  is: a sharp outline round a soft picture.
- ★ **Raising it was not affordable until the geometry was cached**, and the observation that
  made it affordable is that **the unprojection does not depend on the camera's longitude**.
  `λ₀` appears once, as a term added at the end; everything else is a function of the pixel
  and the camera *latitude*, which only moves on a look-at. Cached, the per-frame loop is a
  texel offset, a bilinear fetch and a multiply. Measured 13.2 → 9.7 ms at the old size; the
  uncached pass at 640 was 36 ms, past the whole 30 Hz budget. **RASTER_MAX is 700 now**, 340
  while the latitude is easing (the one thing that invalidates the cache), 200 while dimmed.
- The plate is **2048×1024**, doubled — 512 texels across a 700px raster was a 1.4×
  *undersample*, blurring the terrain before the raster's own upscale got to it.
- An **unsharp mask on the elevation**, not on the finished colour. The hillshade is a
  derivative of that field, and the derivative of a blurred edge is a wide low bump where the
  eye wants a narrow bright one — every range came out a smudge however many pixels it was
  drawn into. Sharpening the shape makes the shading and the tint both crisp.
- Blue Marble's contribution cut from 0.46 to **0.33** — "I'm thinking satellite's maybe not
  the best." It earns its place only for what the elevation cannot know: that the Sahara is
  sand. Past a third the cast starts doing the drawing.
- ★ Everything in `js/earth.js` that measures a distance in texels now scales with `SCALE`.
  Doubling the plate without that made the relief look switched off — a gradient across one
  texel is half as steep on a plate twice as wide.

### The racing line is smooth

> "much tighter and dense measuring points cus the line are to sharp"

**2 600 nodes**, up from 1 400 — and every distance in the solver is now a *fraction of the
lap* rather than a node count, because raising the density had silently changed the meaning of
the window, the stencil, the bump, the stride and the flow's own speed.

Three fixes, and the first two are geometry rather than taste:

- **Smoothing folded into the descent.** The trial bump is a raised cosine, smooth until the
  clamp flat-tops it — and every circuit solves to a swing of 1.00, so the clamp is biting
  constantly. Two [1 2 1] passes after each sweep, *inside* the loop, so the next sweep
  measures the smoothed line and can overrule it.
- ★ **The corridor is wider than some corners' radius, and the line was folding.** Measured,
  the sharpest joint in the drawn line was **179.8° — a reversal, not a corner.** Push an
  offset past `1/κ` and the curve turns inside out; the corridor is six times the real track
  width, deliberately, and on a tight kart hairpin the drawn radius is smaller than that. Each
  node now carries a bound from the local curvature.
- ★ **And a curvature estimate is only ever an estimate.** Read it over a wide stencil and it
  averages a hairpin away, over a tight one and it reads the sampling — both were tried, and
  after the tight version Kalmar, Gelleråsen and Uddevalla still had segments compressed to
  under a fiftieth of their neighbours'. So a final pass stops predicting the collapse and
  **measures the offset line as it stands**, easing back anywhere a segment has lost three
  quarters of its length. Worst spacing ratio went 0.016 → 0.256.

### §05 · The Kit

> "in the first Field Atlas I had equipment and gear sections… but don't put in random stuff,
> check out my gear in the Field Atlas first."

★ **His gear is not in the 1.x repository.** `evhub.gear.inventory` is localStorage, so the
real list lives in the browser on his phone. 1.x's `initGear()` seeds `[]` today, on purpose:
*"the app used to seed 29 suggested items on first run, which meant the kit opened full of
equipment nobody owned and the real job became deleting things."*

But those 29 items are still in git. `KIT_1X` in `js/gear.js` is `seedGear()` as it stood at
Field-Atlas commit **`dacef4d`**, before `7497b37` removed it — Sony A7 III, Tamron 28–75 f/2.8,
monopod, CPL, NP-FZ100 ×3, the lot. Session 16's notes call it "real kit + rental options +
suggested basics", which is why the page prints all three distinctions rather than flattening
them. **A live `evhub.gear.inventory` wins outright**, and the page says which of the two it is
showing, on both §05 and every date's packing list. 1.x's hard rule is kept: no flash, ever.

This also removed the packing list's `none` state — there is always a real kit now, so the
panel no longer renders an apology on every device where 1.x has never run, which in
development is every device.

### One page-wide bug found on the way

★ **With MOTION off, the globe never dimmed.** The whole hero-dissolve block sat inside
`if (state.motion)`, and `setMotion(false)` cleared `globeWrap.style.opacity` back to 1 — so
with the pill pressed, or on any machine asking for reduced motion, the globe stayed at **full
brightness behind every chapter**. `#scrim` only covers the left 62% of the viewport, because
the layout assumes the disc has faded to 14% by then. Measured at every chapter:
`wrap-opacity 1.00` all the way down. The rise, drift and scale are animation and stay gated;
**how visible the globe is behind body copy is legibility and now holds either way.**

---

## The suite

**158/158, three runs.** Was 148 checks. What changed:

| § | was | now |
|---|---|---|
| all | whatever the host's accessibility settings said | `prefers-reduced-motion` pinned to `no-preference` |
| 8 | a stalled sample scored as a failure | an overrun past the busy tail is discarded, not scored |
| 9e | empty storage renders an apology and links to 1.x | the recovered kit renders, and says it is not the live list |
| 11d | `#earth-plate` inlines as a `data:` URI | all **three** Earth sources do |
| 12b′ | *(new)* | `data-nodes` ≥ 1000 and `data-solve` = `lap-time` |
| 12c | numerals are `text.c-no` in the SVG | `.p3d-no > span` in the 3D stage |
| 12c | *(new)* | the stage orbits from the keyboard, and RESET restores the pose exactly |
| 12c″ | numerals inside the **SVG's** box | inside the **stage's** box, which actually clips |
| 12d | the raster cap is 420 | 700 |
| 12d | the sun does **not** turn with the camera | it **does**, and `data-sun-lit` is unchanged by the swing |
| 12e | `globe.js` computes a subsolar point | it carries a camera-space `SUN` and a `sunWorld()` |

★ **Two of those caught real bugs I would not have found by looking.** §12c″ found four corner
numbers clipped off Uddevalla's stage and one off Alvik's — a clipped number does not look
wrong, it looks absent. Chasing it turned up the cause: `max-height: 78%` on the plane was
resolving against a default `auto` grid track, which is an *indefinite* height, so the clamp
was silently ignored. `grid-template: 100% / 100%` on the stage fixes it.

★ **And the suite was testing a different page on this machine than it was written for.**
Headless Chrome reports `prefers-reduced-motion: reduce` on Windows and `no-preference` on
macOS, and `js/main.js` boots MOTION off when asked. So on Windows the globe never drifted,
§8's repaint-rate checks measured a deliberately static canvas and read 0.0 Hz, and §4's pill
click turned motion *on* while asserting it had turned it off. Pinned in `open()` now.

## Carry forward

- The `.dc.html` pair is **4.28 MB**. If that matters, the night-lights PNG (410 KB) is the
  cheapest thing to re-encode, and the topo could drop from 4096 to 3072 with little loss.
- The corridor is still ~6× the real track width. Everything about the line's *shape* is
  right; its absolute speeds are high because an exaggerated road allows radii no real kart
  has. **No lap time is printed anywhere, which is why that is acceptable — do not start
  printing one.**
- §8's busy-gate check is inherently timing-sensitive under headless. It discards its own
  stalls now, but if it ever goes amber again, `paintsWhileBusy` is the invariant that matters
  and the sample count is only a guard on the test's own validity.
- `data/atlas.js` still carries `distanceKm`, `bearing` and `compass`, still unused.
- The day theme was checked after the relief landed and reads fine, but it has not been tuned
  since; the disc is brighter than it was and `app.css` holds it at 34% there.
