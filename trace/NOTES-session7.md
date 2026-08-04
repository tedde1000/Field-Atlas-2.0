# Session 7 — the Earth's resolution, the reverse spin, and §03 in three dimensions

Three things Theodor reported off screenshots, plus one the suite had been hiding.
**Field Atlas 1.x is untouched.** **Nothing committed and nothing pushed** — the
working tree is dirty and `git diff` is the review.

`node trace/verify.mjs` — **206 checks, 206/206**, was 148 declared and 175 reachable.
`node trace/bundle.mjs --check` — both `.dc.html` files in sync with the sources.
`sw.js` `CACHE_VERSION` bumped to `fa2-v3`.

---

## 0 — the suite had not been finishing, and nobody could tell

Found while running the first check of the session. On Chrome 150 the browser
process dies partway through a run and every `newPage()` after it fails with
`Protocol error (Target.createTarget): Session with given id not found`. It landed
at §10e — so **§11, §12 and §13 never ran at all**, and the script exited on a stack
trace rather than on a FAIL, which is why it read as a crash rather than as an amber
suite.

Not this page and not this session: reproduced with nothing in the loop but open,
wait, close, and against a checkout from several sessions back. Not the GPU either —
`--disable-gpu` and `--disable-gpu-compositing` both survive a bare loop of eighteen
pages and both still die here, so whatever leaks is proportional to what the pages
*do*.

`trace/verify.mjs` therefore stops depending on one browser lasting the run: pages
are counted, the browser is replaced every eight, and one that has died is replaced
on sight. It only ever recycles when nothing of ours is open, because §4 and §11
both hold two pages at once. Nothing is shared between pages anyway — every check
opens with `localStorage` cleared.

★ **Two real failures were sitting behind it.** One is below; the other was the
whole of §12d and §13 being unverified for however long this has been true.

---

## 1 — "make the Earth a bit brighter, plus add a bit of resolution"

Two separate causes, and neither was in the shading.

**Brighter** was one declaration. `#globe` sat at `opacity: .34` under 460px and
`.5` under 1080px, so a planet rendered to be looked at arrived on a phone at a
third of the light it was drawn with, terrain and all. It is held back at all
because at that width `#scrim` is a *vertical* wipe rather than the horizontal one
the wide layout gets — the hero's copy sits over the disc instead of beside it. So
the globe went to `.58` (`.24` on the day side) and the scrim's ramp was pulled up
from 78% to 68% to meet it, which is what buys the last few points back with the
lede still comfortably legible. Checked at 412 / 820 / 1440 in both themes.

**Blurry** was arithmetic. The disc is `r · 2 · dpr` backing pixels across, and the
surface raster was capped at 700 — so on a 412px phone a 700px raster was being
magnified into 1 012 pixels, and on a retina laptop into 1 572, with a
full-resolution coastline struck over the top of it. Exactly the "sharp outline
round a soft picture" session 6 thought it had fixed.

`RASTER_MAX` is `PLATE_W / 2` = **1 024** now, which is not a stopwatch reading but
the plate's own texel count: the visible hemisphere carries half the map however big
the disc is, so past that the raster could only magnify the plate's bilinear filter.
On the phone that is 1:1; on the laptop 1.53x, where it was 2.25x.

★ **And it measures itself.** 1 024 is 2.1x the pixels of 700, so the pass is timed
— *after* the geometry build, which is amortised — and two frames over half the
30 Hz budget steps it down `RASTER_LADDER` for that size and theme. The ladder only
descends; `resize()` and a theme change put it back to the top, because both already
discard every cache it could invalidate. Measured under swiftshader, which is the
slow case: 12–13.5 ms against a 16 ms budget, top rung held at all three widths.
Published as `data-surf-ms` / `data-raster-cap` so a machine stuck on the bottom
rung does not look identical to one that never had to move.

---

## 2 — "the globe was spinning a lot in the opposite direction when you scroll"

Real, and the mechanism explains why it looked random.

The idle drift is eastward and it accumulated on the **target** without bound —
including everywhere it could not be seen. Past the hero the disc is at 0.14 opacity
behind `#scrim` and, while the reader is moving, `setBusy()` stops it painting at
all. Then §02's next per-entry look-at set the target to a real venue longitude and
threw the whole accumulation away in one go, so the camera unwound it **westward** at
up to `MAX_TURN`. The size of the reverse spin was therefore proportional to how long
the reader had been reading, which is exactly why it never showed up in a quick pass
over the page.

Two changes, and both are needed:

- the drift is gated on `state.dim >= DRIFT_DIM` — no accumulation anywhere it
  cannot be seen, so every aim in §02 is now the few degrees between one Swedish
  circuit and the next rather than a minute of unwinding;
- §02's per-entry aim passes `settled: true`, the same option the two chapter aims
  already carried and for the same stated reason: below that threshold there is
  nothing to animate for.

Measured on a phone with a 25 s hero idle, which is the worst case: 22.5° of drift,
discharged in a **single sample at dim 0.14** — a placement, at 8% effective opacity,
while the canvas is not painting. Everywhere the globe is actually visible the worst
westward step is **−2.7°**, which is the camera settling on to the hero's aim over a
fifth of a second. §13b asserts both halves: that a dimmed globe accumulates no
drift, and that no scroll turns it westward where the reader can see it.

---

## 3 — "the circuit is really small for the area itself"

> "Have the 3D track map, but with the racing line in that area — so you can
> interact with it, and you also see the racing line on the track itself."

§03's figure is now the same stage the panel's layouts use (`js/layout3d.js`), with
the live canvas for its ground instead of an SVG: the solved line, the tarmac it was
solved inside, the flow, and every corner standing over its own apex on a post.

**Two things were making it small and only one of them was the box.** The other was
the fit: the numerals used to be drawn into the canvas *outside* the lap, so `fit()`
reserved up to 118px on every side for them — on a phone, 236px of a 370px canvas
held for text. With the numbers on posts, what is left to clear is the width of the
road and a little air. Measured: the drawing inks **0.77–0.99** of its canvas in both
axes where it inked 0.73 × 0.34.

The box half is `poseFit()`, which inverts the projection rather than guessing at it
— a plane w×h turned by θ about Z and φ about X lands on screen as
`w·|cos θ| + h·|sin θ|` by `(w·|sin θ| + h·|cos θ|)·cos φ`, plus the post headroom.
Both directions are solved, because a portrait lap is height-limited rather than
width-limited: Uddevalla clipped its own turn 6 off the top before the height was fed
back in.

Three deliberate differences from the panel's stage, all because this one is a block
in a scrolling page rather than an overlay:

- **`touch-action: pan-y`**, not `none`. A stage as tall as the phone that owns the
  gesture outright is a place the page stops scrolling.
- **A plain wheel scrolls the page**; ctrl/⌘-wheel zooms, which is also what a
  trackpad pinch sends. `data-wheel="modifier"` in `js/layout3d.js`.
- **No corner names on the posts.** A name box is five to eight times a numeral's
  width and the phone's plane is ~305px across; `#fig-legend` directly underneath
  already prints every name against its number and its angle, which the panel's
  layout has no equivalent of.

★ **`resize()` reads `offsetWidth`, not `getBoundingClientRect()`.** A bounding rect
is the box *after* the transform, so a canvas on a plane turned back 56° measures
itself as two thirds of its own height, resizes into that, re-solves the racing line
for it, and never converges.

★ **`load()` no longer fits or solves.** The caller's very next move is to resize the
plane to the new circuit's aspect and re-fit, so the old order solved the lap-time
line twice for one tap — a fifth of a second each, on a phone.

---

## 4 — the failure the crash was hiding

§12c″ asserts every corner numeral lands inside its stage. It had been failing on
**Alviks Ring, turn 6**, and had not been seen because the run died three sections
earlier. Two causes, and both are fixed rather than either being enough:

- ★ **The pose is animated as registered custom properties now, not as a transform.**
  The reveal was `transition: transform` on the plane, so for its 780ms — and for
  every RESET VIEW — the plane eased toward a pose while `--tilt` and `--rot`, which
  the numerals counter-rotate by, were already at the destination. The numbers were
  billboarded for a pose the plane had not reached. `@property` makes the three
  values interpolable, so the transition lives on the pose itself and everything
  downstream is derived from one set of numbers that is consistent at every frame
  rather than at its two ends. The old transform transition is *gone*, not kept
  alongside, because there must be nothing left to disagree with it.
- **`.p3d-plane` is `min(73%, 600px)`**, was 78%. A numeral is centred on its post,
  so at the edge of the drawing half of it hangs past the plane by construction and
  the margin has to carry that. Swept across all sixteen catalogue circuits: 78%
  fails on one, 74% clears every one, 73% is that with room for a font metric to
  move under it.

---

## What §13 asserts, so none of it comes back

- the globe's computed opacity at 412 / 820 / 1440 — the brightness fix, read as the
  media query actually resolves it rather than off the stylesheet;
- the raster reaches the disc's own device resolution, and the ladder held its budget;
- a dimmed globe accumulates no drift; no scroll turns the camera westward where the
  reader can see it;
- §03's canvas is the ground of the stage, it paints, it inks >70% of its box in both
  axes at 412 and 1440, every corner has a post, none is clipped, and the stage does
  not trap the page scroll;
- it orbits from a drag, RESET VIEW restores it exactly, a plain wheel scrolls the
  page and ctrl-wheel zooms;
- and the sources still say what they do.

---

## Left alone on purpose

- **The panel's stage keeps its fixed height.** `poseFit()` would tighten it the same
  way, but the panel is a card the reader opened on purpose and nothing about it was
  reported. §03 is the biggest single block on the page and was.
- **The corridor is still exaggerated**, and the legend still says so — see the note
  over `CORRIDOR_CAP` in `js/circuit.js` for why solving at true width was tried,
  measured across all 21 circuits, and is wrong.
