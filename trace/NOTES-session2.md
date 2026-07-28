# Session 2 (Jul 28 2026) — bugs, tests, and the globe

Picked up a tree where Tasks 0, 1 and 3 had already been **built** but only 0 and 1 had been
**tested**. Most of this session was closing that gap, and the gap turned out to be full of bugs.
**Field Atlas 1.x is still untouched.**

`node trace/verify.mjs` — **70 checks, run three times, 70/70 each time.** Was 37.

## 1. WHAT WAS ALREADY DONE WHEN THIS SESSION STARTED
- **Task 0** (scroll fight) — fixed and covered by §7. `centreChip()` moves the bar's own
  `scrollLeft` and nothing else. Idle drift <4px, all 26 notches ≈260px.
- **Task 1** (5 fps) — offscreen layer caching, packed `Float32Array` point cache, horizon
  clipping, visibility gating. Covered by §8.
- **Task 3** (panel + gear) — `panel.js`, `gear.js`, schedule extraction and all the wiring
  existed and worked. **Zero tests.** `gear.js` even carried a comment claiming
  "trace/verify.mjs §9 asserts it" — §9 did not exist. That comment is now true.

## 2. ★ THE GENERATED DATA HAD DRIFTED FROM ITS GENERATOR
`data/world.js` on disk was **280 rings / 7 158 points**. Running `trace/extract.py` unchanged
produced **892 rings / 19 667 points**. The committed file was stale — coarser than what the
script emits, roughly a tol-0.15 output sitting in a tree whose `LAND_TOL` is 0.05.

`data/atlas.js` regenerated **byte-identical**, so the season data is reproducible. Only the land
had rotted.

★ This is the exact failure the "never hand-edit `data/`" rule exists to prevent, and it is
invisible: the page looked fine, the suite was green, and the next person to run `extract.py`
would have got an unexplained 240KB diff. **Re-run `extract.py` and diff before trusting
`data/`** — a generated file that its generator does not reproduce is a landmine.

Regenerating is a large visible win: at 2560 the fjord coast, Svalbard, Iceland, Britain,
the Mediterranean and the Red Sea all resolve where they were blobs. Theodor confirmed keep.

## 3. THE GLOBE COST OF THAT, AND WHY IT WAS NOT WHAT IT LOOKED LIKE
Regenerating dropped headless fps hard (hero 30→14, §02 →10). Two things were true:

- **The cost is real but it is per-RING, not per-point.** `base` decimation already steps the
  point loop, so 3× the points cost nearly nothing — but 3× the rings cost 3× the `Path2D`
  allocations and `fill()` calls, which are fixed per ring. Raised the too-small-to-see cull
  from 1.5px to **5px**: at the hero disc that is 792 visible rings → 267, two thirds fewer
  fills for 83% of the points.
- ★ **The decimation was cancelling the resolution swap.** `base` was `r > 420 ? 2 : r > 240 ? 3`,
  so the 792px hero ran at step 3 — decimating 50m data straight back down to 110m density.
  Paying for detail and then throwing it away. Breakpoints now `r > 340 ? 2`.

★ **Zero long tasks throughout.** The main thread was never blocked; the whole cost was
software rasterisation in the compositor. Theodor's Mac and phone raster on the GPU. Do not
optimise JS against a number that is measuring swiftshader.

## 4. ★ §8 MEASURED THE WRONG THING, AND MEASURED IT UNRELIABLY
The fps floors were **flaky**: identical code, same viewport, minutes apart, measured the hero
at 14 fps and at 28 fps, and §02 at 10 fps and at **150 fps**. A check that fails at random is
worse than no check — it teaches you to ignore a red run.

Rewritten to assert **repaint discipline** instead. Each canvas publishes a paint counter as
`data-paints`; the checks read the *rate*. That is set by the code's own budgets, not by the
host's graphics stack, so it is identical on a loaded laptop and a quiet one.

★ **Assert the CEILING, not the floor.** rAF is itself rate-limited by the software rasteriser,
so a canvas cannot always reach its own budget — an achieved-rate floor is exactly as flaky as
the fps floor it replaced. "Never paints more than 30 Hz" is the half that is both meaningful
and stable.

It immediately caught a real bug — see §5.

## 5. BUGS FOUND AND FIXED, EACH WITH THE TEST THAT CAUGHT IT
- ★ **The page scrolled behind the open panel.** `body.is-locked { overflow: hidden }` existed
  and did nothing: **`<html>` is the document scroller** (it owns `overflow-x: clip`), so
  clipping `body` clips nothing that matters. Measured 1040px of background scroll in four
  notches with the panel open. Now locked on both elements. Caught by §9.
- ★ **MOTION off did not stop the globe.** The camera stops, but the live pin's pulse is driven
  by the clock inside `paint()`, so the canvas went on repainting an all-but-identical frame at
  full budget forever — breaking the README's "with motion off the page is fully static". The
  starfield sat correctly at 0 Hz right beside it, which is what made it obvious. Now signature-
  gated. Caught by the new §8 the same hour it was written.
- **Duplicated ★ comment block** in `globe.js`'s land loop — the same warning written twice in
  slightly different words. Left one.

## 6. ★ THE SPIN-BACK — NOT FIXED, NOT REPRODUCED, DO NOT ASSUME IT IS DONE
Theodor: *"when u scroll up from it disappearing it just spins back to point 1 at max speed."*

**I could not reproduce this headlessly.** Tried: instant jump to top; gradual wheel-up from
§04; a hard trackpad-style flick; a 28-second dwell in §04 to let the 0.9°/s idle drift build up
an angle to unwind. Every scenario measured a calm arrival — 5–17° of total visible travel,
biggest single step ~3°. A/B with the fix disabled showed **no difference**, which means the
scenarios are wrong, not that the bug is absent.

Two fixes went in anyway, both principled, **both unverified against the actual symptom**:
- `MAX_TURN = 34°/s` hard ceiling on camera angular speed. An ease alone cannot fix a whip,
  because an ease is proportional — the further the target, the faster it starts, which is
  precisely the wrong response to a target that just jumped.
- `lookAt(..., {settled: true})` for the chapter-level re-aims (§00, §04): while the globe is
  dimmed there is nothing to animate *for*, so the camera is placed rather than flown and the
  hero fades in already pointing the right way. Animating instead saves the whole traversal up
  and plays it as a spin at the exact moment the globe becomes visible.

★ **Strongest untested lead: mobile.** `@media (max-width:760px)` keeps `#globe` at **.34**
opacity where desktop drops it to **.14**. So on a phone the globe stays clearly visible through
§02, and every one of the eight per-entry `lookAt()` calls that fire while you scroll up is
*visible* — on desktop they happen behind a scrim at 8 Hz and are not. Reproduce at 390px
before touching anything else.

`#globe[data-lon]` / `[data-lat]` now publish the camera (written on paint, not per frame) so
this is measurable at all. That hook is how any of the above was possible.

## 7. THE OTHER GLOBE SUSPECTS — RAISED, NOT CHOSEN
Theodor named "a bit of country shapes are inaccurate", which §2 largely addresses. He did **not**
pick these, so they were left alone:
- **Two light sources.** `SUN = {x:-0.62, y:-0.5, z:0.6}` lights the limb from the top-left while
  the terminator gradient lights the disc from the lower-right. Africa reads lit, Europe dark,
  and the atmospheric glow sits on the night limb.
- **The terminator is not a terminator** — an offset radial, not a great circle. Still the best
  candidate for "make it look like a lit sphere".
- **Lakes fill as land.** `extract.py` emits interior rings separately and `globe.js` fills each
  ring, so the Caspian and the Great Lakes paint as land instead of being punched out.
- **Size on wide-short screens.** `#globe-wrap` is 88vmin → 616px on a 1600×700 page.

## 8. VERIFY — 70 CHECKS
New this session: **§9, 27 checks** covering the panel — opens from a §04 cell and from a §02
entry body, hash round-trips both ways, cold deep link, Escape closes, focus moves in and returns
to the trigger, background does not scroll, unknown route opens nothing and leaves no dead hash,
empty storage renders and links out, and the seeded-1.x path.

★ **§9 seeds `evhub.*` by hand, and must.** 1.x on :8765 and 2.0 on :8766 differ by port, so they
are different origins and share no storage locally — the production sharing cannot be observed
here, only simulated. Do not "fix" the sharing code because it looks dead on localhost.

★ **The one that matters most:** §9 asserts that ticking gear leaves every `evhub.*` key
byte-identical and writes only under `fa2.`. localStorage has no undo, and 1.x's gear list is
real data Theodor maintains.

## 9. NOT DONE / NEXT
- **Phase 2 is entirely untouched** — no self-hosted fonts (index.html still links
  fonts.googleapis.com), no `build.mjs`, no manifest, no service worker, no icons, no deploy.
- ★ **The git clone is still one level too deep.** `.git` and `.gitattributes` are in the nested
  `Field Atlas 2.0/` folder, so the repo tracks nothing. The `mv` in PROMPT.md §7 has **not**
  been run — it needs confirming first. Nothing has been committed or pushed.
- The spin-back (§6) is the first thing to pick up, at 390px.
- `trace/shots/` and `trace/shots/globe/` reshot against the current build.
- `python3 trace/sync-source.py --check` → ok=60.
