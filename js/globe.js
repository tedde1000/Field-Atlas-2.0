/* ===========================================================================
 * globe.js — orthographic Earth on a 2D canvas, with the atlas plotted on it.
 *
 * No WebGL, no map library: a sphere, land rings from Natural Earth, a soft
 * terminator, and one pin per circuit. The globe idles with a slow drift and
 * eases to face whichever venue the page is currently talking about.
 *
 * Coordinates are {lat, lon} everywhere, per Field Atlas CONVENTIONS §3.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE (session 2). The first draft ran at 5 fps because every frame it
 * re-projected 5 123 land points with fresh sin/cos each, re-projected 1 375
 * graticule points, and filled four full-disc radial gradients. Four changes,
 * in the order they paid off:
 *
 *   1. The halo, ocean, terminator, rim and limb do not depend on the camera at
 *      all — only on size and theme. They are rendered once into three offscreen
 *      canvases and blitted. A blit is a memcpy; a radial gradient is evaluated
 *      per pixel. Invalidated on resize and on theme change ONLY.
 *   2. Every point is stored as a unit vector once at module load, so project()
 *      is eleven multiplies and no trigonometry whatsoever. See CACHE below.
 *   3. Each ring carries a bounding cap, so a ring entirely on the far side of
 *      the planet, or under two pixels across, costs one comparison instead of
 *      a path, a fill and a stroke.
 *   4. Past the hero the globe sits at ~0.14 opacity behind the scrim, so it
 *      drops to 15 fps there and stops entirely when effectively invisible.
 *
 * Note what is NOT on that list: throwing away points. See the star in paint().
 *
 * PERFORMANCE (session 3). The globe is a fixed, full-viewport canvas sitting
 * under #scrim and under a topbar that carries a backdrop-filter, so every
 * repaint invalidates a compositor layer that the browser must re-blend across
 * the whole page. Past the hero that buys nothing — the disc is at 0.14 opacity
 * and drifting 0.9°/s — but it lands squarely on the frame budget of whatever
 * the reader is actually doing, which is scrolling. Hence setBusy(): the page
 * tells the canvas when the reader is moving, and the canvas gets out of the
 * way until they stop. See the loop at the bottom.
 * ======================================================================== */
import { LAND } from '../data/world.js';
import { PLATE, PLATE_W, PLATE_H, loadPlate } from './earth.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/* ===================================================== THE SUN, AND WHERE IT IS
 * ★ THE LIGHT IS LOCKED TO THE CAMERA AGAIN, AND THAT IS A DELIBERATE REVERSAL.
 *
 * Theodor: "change the direction the sun comes from, so it's always shining on
 * the side that's towards me looking at the screen."
 *
 * Session 4 did the opposite, on his instruction at the time, and did it
 * properly: the sun became a direction in WORLD space at the real subsolar point
 * for Date.now(), so the terminator sat wherever the Earth's actual day/night
 * line was and the camera could drift out from under it. That was correct and it
 * was also the problem — the drift and the per-entry look-ats spend most of their
 * time over Europe at European evening, so the venue the page was talking about
 * was frequently on the unlit side. A globe you cannot read is not a better globe
 * for being astronomically true.
 *
 * So the light is a direction in CAMERA space and the whole visible face is the
 * day side, by construction, at every camera angle. What is kept from session 4
 * is everything that made it look like a sphere rather than a coin: it is still a
 * real Lambert term against the surface normal, and the terminator is still the
 * great circle where the two are perpendicular. It is simply a great circle that
 * the camera carries with it.
 *
 * ★ IT IS NOT HEAD-ON, AND THAT IS THE WHOLE DIFFERENCE. A light straight down
 * the camera axis makes every surface normal on the visible hemisphere face it,
 * which flattens the disc into a bright circle with no form. Offset up and to the
 * left — the light over the reader's shoulder — the Lambert term still falls off
 * toward the lower-right limb, so there is a crescent of shadow hugging the outer
 * fifth of the radius and the eye reads a ball. Below, `terminatorAt` works out
 * where that crescent starts: with these numbers it is at 0.79 of the radius, so
 * four fifths of the face is unambiguously lit.
 * ========================================================================= */
const SUN = (() => {
  const x = -0.44, y = 0.38, z = 0.81;      // left, up, toward the camera
  const L = Math.hypot(x, y, z);
  return { x: x / L, y: y / L, z: z / L };
})();

/**
 * The fraction of the disc radius inside which nothing can be in shadow —
 * published as data-sun-lit so the suite can assert the reader's face of the
 * planet stays lit whatever the camera does.
 *
 * Solve L = 0 for the earliest radius it is reachable at. The in-plane part of
 * the sun has length t and can contribute at most r·t against the surface, so
 * the terminator first appears where r·t = w·SUN.z with w = √(1−r²); that gives
 * r = SUN.z / √(t² + SUN.z²), and SUN is a unit vector, so the denominator is 1.
 * With the current direction that is 0.81 — four fifths of the face, always lit.
 */
function terminatorAt() {
  return SUN.z;
}

/* How dark the night side gets. Not zero: the globe sits behind body copy at low
   opacity and a hemisphere of pure black reads as a bite taken out of the disc
   rather than as night. Earthshine and airglow are a real thing anyway. */
const NIGHT = 0.085;

/* ★ THE SURFACE RASTER IS CAPPED, AND IT WAS CAPPED TOO LOW.
 *
 * Shading the sphere is per-pixel work: unproject, sample the plate, apply the
 * Lambert term. It used to cap at 420 and get scaled up to whatever the disc
 * actually was — 660 to 1 000 px — and that upscale is most of why Theodor said
 * "the globe is a bit blurry". A 1.6× smooth upscale of the terrain, with a
 * full-resolution coastline struck over the top of it, reads as exactly what it
 * is: a sharp outline round a soft picture.
 *
 * ★ RAISING IT WAS NOT AFFORDABLE UNTIL THE GEOMETRY WAS CACHED. Measured, the
 * old per-pixel pass ran 13 ms at 420 and 36 ms at 640 — past the whole 30 Hz
 * budget, on a page carrying two other canvases and a backdrop-filter. What made
 * it affordable is the observation under GEO below: the unprojection does not
 * depend on the camera's longitude at all, so on a globe whose idle motion IS
 * longitude it can be computed once and reused. That halves the per-frame cost,
 * and 700 then lands at ~20 ms with headroom.
 *
 * ★ AND 700 WAS STILL AN UPSCALE EVERYWHERE IT MATTERED.
 *
 * Theodor, on the phone hero and on the wide page both: "make the Earth a bit
 * brighter, plus add a bit of resolution — it feels like it's a bit blurry."
 *
 * It was, and the arithmetic says exactly how blurry. The disc is `r * 2 * dpr`
 * device pixels across, and `dpr` here is the CANVAS dpr, capped at 2. On a
 * 412px phone `#globe-wrap` is 141vmin, so the disc is 506 CSS px — 1 012
 * backing pixels, fed from a 700px raster: a 1.45x magnification of the terrain
 * with a full-resolution coastline struck over the top of it, which is the exact
 * "sharp outline round a soft picture" the paragraph above says was fixed. On a
 * retina laptop at 1440 it is worse: 1 572 backing pixels off the same 700.
 *
 * So the ceiling is now the PLATE'S OWN texel count rather than a number picked
 * off a stopwatch — `PLATE_W / 2` = 1 024, because the visible hemisphere is half
 * the map however big the disc is, and past that the raster really would only be
 * magnifying the plate's bilinear filter. At the two sizes above that is 1:1 and
 * 1.53x respectively, where it was 1.45x and 2.25x.
 *
 * What makes it affordable is not that it is free — it is 2.1x the pixels of 700
 * — but that it BACKS OFF WHEN IT IS NOT. See rasterCeiling(): the pass times
 * itself, and a machine that cannot hold the budget walks down the ladder and
 * stays there. The old constant was one guess for every device on Earth. */
const RASTER_MAX = PLATE_W / 2;

/* ★ THE BACKOFF LADDER, AND WHY IT ONLY EVER GOES DOWN.
 *
 * Changing the raster size reallocates the surface canvas, its ImageData and the
 * whole geometry cache (see GEO) — so a size that oscillates costs far more than
 * the resolution it is chasing. The ladder is therefore sticky: two overruns in a
 * row steps down one rung and it stays there for the life of the current size and
 * theme. resize() and a theme change reset it to the top, because both already
 * throw the caches away and both are the moments where the right answer may
 * genuinely have changed.
 *
 * The budget is half the 30 Hz frame, which is what the surface pass may have:
 * the coastline stroke, the graticule, the pins and the composite share the rest. */
const RASTER_LADDER = [RASTER_MAX, 880, 760, 640, 520, 420];
const SURFACE_BUDGET_MS = 16;

/* While the camera's LATITUDE is still easing, the raster drops to this. See
   GEO: a latitude change is the one thing that invalidates the geometry cache,
   so a 22° look-at would otherwise rebuild it every frame for a second. Motion
   masks detail anyway — this is the same trade setBusy() makes. */
const RASTER_MOVING = 340;

/* ★ HOW FAR THE ATMOSPHERE REACHES PAST THE SURFACE, and therefore how much of
 * the canvas is NOT planet.
 *
 * Theodor: "the light shape around the globe is a bit squarish — there is a
 * small square gradient with atmospheric blue. I want you to round that so it's
 * the same gradient around the whole planet."
 *
 * It was square because the disc filled the canvas. `#globe-wrap` is a square
 * box and the radius was `min(w, h) / 2 - 2`, so a halo painted out to 1.13 × r
 * ran off all four edges — leaving the gradient visible only where the canvas
 * still had room, which is a rectangle with a circle bitten out of it. The
 * glow was never round; it was the corners of its own bounding box.
 *
 * So the halo's reach is a named constant now, the disc is sized to leave
 * exactly that much room, and app.css grows #globe-wrap by the same factor so
 * the planet stays the size it was on the page. If you change this, change the
 * three `#globe-wrap` widths with it — the comment there says so too. */
const HALO = 1.14;

/** signed shortest way round from a to b, in degrees */
const angleDelta = (a, b) => ((b - a + 540) % 360) - 180;

/* ★ THE CAMERA MAY NOT TURN FASTER THAN THIS, in degrees/second.
 *
 * Theodor, on scrolling back up out of the season: "it just spins back to point
 * 1 at max speed." Reproduced — going UP is fast, so §02's per-entry observer
 * re-aims the globe at all eight venues in quick succession, and then §00 aims
 * it home again. Each target change was chased with a 0.155 s time constant, so
 * the camera whipped between them: a ~9° swing landed in about a fifth of a
 * second, and eight of those back to back read as the planet spinning.
 *
 * An ease alone cannot fix this, because an ease is proportional — the further
 * the target, the faster it starts, which is exactly the wrong response to a
 * target that just jumped. A hard ceiling on angular speed is what "not at max
 * speed" actually means, and it costs nothing when the target is near: 34°/s is
 * well above the 0.9°/s idle drift, so idling is untouched. */
const MAX_TURN = 34;

/* Above this wrapper opacity the globe is the SUBJECT; below it, it is a backdrop
   behind the chapters. Two things read it — whether the idle drift runs at all,
   and whether a look-at is flown or simply placed — and they have to agree, or the
   camera can accumulate motion in a state where it is never allowed to spend it.
   See the drift gate in frame() and `settled` in lookAt(). */
const DRIFT_DIM = 0.5;

/* ============================================================ THE POINT CACHE
 * A point's latitude and longitude never change — only the camera does. So each
 * point is stored once as the unit vector
 *      a = cos(lat)·sin(lon)   b = cos(lat)·cos(lon)   c = sin(lat)
 * and the whole projection reduces to multiplies against the camera's own
 * sin/cos, computed once per frame. That removes every sin() and cos() from a
 * 6 500-point inner loop.
 *
 * Each ring also gets a bounding cap: the normalised mean of its vectors, plus
 * the angular radius that covers all of them. Two comparisons per ring then
 * reject anything over the horizon or too small to see.
 * ========================================================================= */
function packRing(pts) {
  const n = pts.length;
  const xyz = new Float32Array(n * 3);
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    const lon = pts[i][0] * RAD, lat = pts[i][1] * RAD;
    const cl = Math.cos(lat);
    const a = cl * Math.sin(lon), b = cl * Math.cos(lon), c = Math.sin(lat);
    xyz[i * 3] = a; xyz[i * 3 + 1] = b; xyz[i * 3 + 2] = c;
    mx += a; my += b; mz += c;
  }
  const len = Math.hypot(mx, my, mz);
  let capA = 0, capB = 0, capC = 1, rho = Math.PI;   // degenerate -> never cull
  if (len > 1e-6) {
    capA = mx / len; capB = my / len; capC = mz / len;
    let minDot = 1;
    for (let i = 0; i < n; i++) {
      const d = capA * xyz[i * 3] + capB * xyz[i * 3 + 1] + capC * xyz[i * 3 + 2];
      if (d < minDot) minDot = d;
    }
    rho = Math.acos(Math.max(-1, Math.min(1, minDot)));
  }
  return {
    n, xyz,
    capA, capB, capC,
    // a ring is entirely on the far side when cos(camera·cap) < -sin(rho);
    // caps wider than a hemisphere can never be culled, hence the -2 sentinel
    cull: rho >= Math.PI / 2 ? -2 : -Math.sin(rho),
    // half-extent as a fraction of the globe radius, for the too-small-to-see test
    span: Math.sin(Math.min(rho, Math.PI / 2)),
  };
}

const LAND_RINGS = LAND.filter(r => r.length >= 5).map(packRing);

/* ============================================================== THE EARTH PLATE
 * ★ THE SURFACE IS BAKED IN js/earth.js NOW, AND IT IS NOT A PHOTOGRAPH.
 *
 * What was here read NASA Blue Marble into a 1024x512 buffer and sampled it. The
 * plate is sampled in exactly the same way — but it is composed at boot from an
 * elevation raster, hypsometrically tinted and lit by a fixed north-west
 * cartographer's sun, with the land cover contributing only a colour cast and the
 * city lights carried in the alpha channel. Read the header of js/earth.js for
 * why, and for what each of the three sources is used for.
 *
 * ★ THE PLATE AND THE RASTER HAVE TO BE SIZED TOGETHER, and getting that ratio
 * wrong in either direction is visible.
 *
 * The visible hemisphere is always half the plate's width, however big the disc
 * is. Too few texels for the raster and the terrain is magnified out of a source
 * that does not have the detail — soft, which is what 512-across-420 was. Too
 * many and it is undersampled, which bilinear filtering cannot fix at all: every
 * coastline crawls with alias as the planet drifts, and on something rotating at
 * 0.9°/s that is the most visible thing on the page.
 *
 * 2048 wide gives 1024 texels across a raster of at most 700. A mild oversample,
 * in the safe direction, at both ends of the range.
 * ========================================================================= */
loadPlate();

/* the 20° graticule, packed the same way so it draws through the same loop */
const GRATICULE = (() => {
  const out = [];
  for (let lon = -180; lon < 180; lon += 20) {
    const pts = [];
    for (let lat = -80; lat <= 80; lat += 4) pts.push([lon, lat]);
    out.push(packRing(pts));
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
    out.push(packRing(pts));
  }
  return out;
})();

export function createGlobe(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const tokens = getComputedStyle(document.documentElement);
  const tok = (n, f) => (tokens.getPropertyValue(n).trim() || f);

  const state = {
    lon: opts.lon ?? 16.5, lat: opts.lat ?? 44,   // current camera centre
    tLon: opts.lon ?? 16.5, tLat: opts.lat ?? 44, // eased target
    drift: 0.9,          // degrees/second of idle rotation
    holdUntil: 0,        // pause the drift for a moment after a look-at
    pins: [], home: null,
    focus: null,         // pin id currently being talked about
    running: true, motion: true,
    dim: 1,              // wrapper opacity, fed in by scroll.js
    busy: false,         // the reader is scrolling right now — see frame()
    w: 0, h: 0, r: 0, cx: 0, cy: 0, dpr: 1,
  };

  /* camera trig, recomputed once per frame rather than once per point */
  const cam = { sLon: 0, cLon: 1, sLat: 0, cLat: 1, a: 0, b: 1, c: 0 };
  function setCam() {
    const p0 = state.lat * RAD, l0 = state.lon * RAD;
    cam.sLon = Math.sin(l0); cam.cLon = Math.cos(l0);
    cam.sLat = Math.sin(p0); cam.cLat = Math.cos(p0);
    // the camera's own unit vector, in the same basis as the packed points
    cam.a = cam.cLat * cam.sLon; cam.b = cam.cLat * cam.cLon; cam.c = cam.sLat;
  }

  /**
   * Where the camera-locked sun is standing over the Earth right now — the
   * subsolar point implied by SUN, in {lat, lon}.
   *
   * Nothing in the render needs this: the shading works in camera space and never
   * leaves it. It exists so the light is FALSIFIABLE from outside the canvas.
   * There is no DOM inside a canvas, so the only handle a test has on the lighting
   * is what paint() writes to data-*, and "the lit face follows the camera" is a
   * claim about the relationship between two published numbers. Publishing the
   * sun in camera space would be trivially constant and would prove nothing.
   *
   * It is the exact inverse of the rotation buildSurface() used to apply the other
   * way round, back when the sun was the real one: both rotations are pairs of
   * planar rotations, so each inverts by its own transpose.
   */
  function sunWorld() {
    const sc = cam.cLat * SUN.y + cam.sLat * SUN.z;          // world z, i.e. sin(lat)
    const SP = cam.cLat * SUN.z - cam.sLat * SUN.y;
    const sa = SUN.x * cam.cLon + SP * cam.sLon;
    const sb = SP * cam.cLon - SUN.x * cam.sLon;
    return {
      lat: Math.asin(Math.max(-1, Math.min(1, sc))) / RAD,
      lon: Math.atan2(sa, sb) / RAD,
    };
  }

  /* ------------------------------------------------------------- sizing */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.dpr = dpr;
    state.w = Math.max(1, Math.round(rect.width));
    state.h = Math.max(1, Math.round(rect.height));
    canvas.width = state.w * dpr;
    canvas.height = state.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.cx = state.w / 2;
    state.cy = state.h / 2;
    // divide by HALO, do not subtract a margin: the atmosphere has to fit INSIDE
    // the canvas or it gets clipped to the canvas rectangle. See HALO above.
    state.r = (Math.min(state.w, state.h) / 2 - 2) / HALO;
    layers.dirty = true;
    /* a different disc is a different sum — re-try from the top of the ladder */
    cost.rung = 0; cost.over = 0; cost.ms = 0;
  }

  /* ================================================= the cached still layer
   * ★ THERE USED TO BE THREE OF THESE AND NOW THERE IS ONE.
   *
   * `below` (halo + a lit ocean gradient), `shade` (the terminator + the limb) and
   * `rim` (additive light on the lit edge) were all fixed in SCREEN space, which is
   * what made the lighting ride along with the camera. The ocean, the terminator
   * and the rim are all functions of the sun direction and the surface normal, so
   * they belong in the per-pixel surface pass — see buildSurface() — and they are
   * there now. What is left is genuinely camera-independent: the ring of
   * atmosphere OUTSIDE the limb, which depends only on the radius and the theme.
   * ====================================================================== */
  const layers = { dirty: true, theme: null, air: null, accent: '', ink: '' };

  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(state.w * state.dpr));
    c.height = Math.max(1, Math.round(state.h * state.dpr));
    const g = c.getContext('2d');
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    return { c, g };
  }

  function buildLayers(isDay) {
    const { cx, cy, r } = state;

    const b = makeLayer();
    const halo = b.g.createRadialGradient(cx, cy, r * 0.965, cx, cy, r * HALO);
    halo.addColorStop(0, isDay ? 'rgba(90,130,160,.30)' : 'rgba(96,158,196,.26)');
    halo.addColorStop(0.45, isDay ? 'rgba(90,130,160,.09)' : 'rgba(80,132,170,.09)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    b.g.fillStyle = halo;
    // fill the DISC the gradient occupies, not a rectangle — a rect fill would
    // put the gradient's transparent tail in the corners and, if the canvas ever
    // gets tighter than HALO again, show the box instead of the atmosphere
    b.g.beginPath(); b.g.arc(cx, cy, r * HALO, 0, TAU); b.g.fill();

    layers.air = b.c;
    // getPropertyValue forces a style read, so the tokens are cached here too
    layers.accent = tok('--accent', '#c9974f');
    layers.ink = tok('--ink', '#ece5d9');
    layers.theme = isDay ? 'day' : 'night';
    layers.dirty = false;
    /* the day side runs a different gain and a different plate cost — re-measure
       rather than carry a night-side verdict across, and see resize() */
    cost.rung = 0; cost.over = 0; cost.ms = 0;
  }

  /* ======================================================= THE SURFACE PASS
   * One ImageData, rebuilt each paint: unproject every pixel inside the limb back
   * to a latitude and longitude, sample the relief plate there, and multiply by
   * the Lambert term against a sun that is fixed in CAMERA space — see the note
   * over SUN at the top of this file for why that direction, and not the real one.
   *
   * The maths, per pixel, with the disc centred and v measured upward:
   *
   *   u, v            the pixel, in units of the globe radius
   *   w = √(1−u²−v²)  the third component of the surface normal, toward the camera
   *   lat = asin(w·sinφ₀ + v·cosφ₀)
   *   lon = λ₀ + atan2(u, w·cosφ₀ − v·sinφ₀)
   *   L   = u·SUN.x + v·SUN.y + w·SUN.z          the Lambert term
   *
   * ★ THE SUN NO LONGER HAS TO BE ROTATED INTO THE CAMERA'S BASIS. It is already
   * expressed there, which deletes eight multiplies and two trig calls per frame
   * and — much more to the point — removes the only remaining reason this pass
   * had to run when nothing had moved. With MOTION off the globe is now genuinely
   * static; before this, the terminator crept 15°/hour and the still-frame
   * signature had to carry the subsolar longitude to let it.
   *
   * ★ IT IS RASTERED SMALL AND SCALED UP. See RASTER_MAX. The vector coastline is
   * still stroked over the top at full resolution, which is where the eye actually
   * reads the edges, so the softness costs nothing.
   *
   * ★ THE ROW SPAN IS COMPUTED, NOT TESTED. For each row, u only reaches
   * ±√(1−v²), so the loop starts and ends there instead of walking the full width
   * and rejecting a fifth of it — and the inner loop then has no branch in it at
   * all except the plate sample.
   * ==================================================================== */
  const surf = { c: null, g: null, img: null, size: 0 };

  /* ★ WHAT THIS MACHINE CAN ACTUALLY AFFORD, measured rather than assumed. See
     RASTER_LADDER. `rung` only ever descends; resize() and buildLayers() put it
     back to 0, because both already discard every cache this could invalidate. */
  const cost = { rung: 0, over: 0, ms: 0 };
  const rasterCeiling = () => RASTER_LADDER[cost.rung];
  function chargeSurface(ms) {
    cost.ms = cost.ms ? cost.ms * 0.7 + ms * 0.3 : ms;
    /* Two in a row, not one: a single long frame is a garbage collection or a
       decode landing, and stepping down on it would cost the reader resolution
       for the life of the page over one unrelated stall. */
    if (cost.ms > SURFACE_BUDGET_MS) {
      if (++cost.over >= 2 && cost.rung < RASTER_LADDER.length - 1) {
        cost.rung++; cost.over = 0; cost.ms = 0;
      }
    } else cost.over = 0;
  }

  function surfaceSize() {
    /* Past the hero the disc is at ~14% opacity behind #scrim, and nobody can see
       a texel there — so it rasters at 200px and the per-pixel cost drops by two
       thirds exactly where it is least worth paying. Above that it is the subject,
       unless the camera's latitude is still easing — see RASTER_MOVING. */
    const cap = state.dim < 0.35 ? 200
      : (Math.abs(state.tLat - state.lat) > 0.04 ? RASTER_MOVING : rasterCeiling());
    return Math.min(cap, Math.max(16, Math.round(state.r * 2 * state.dpr)));
  }

  /* ======================================================= GEO — THE CACHE
   * ★ THE UNPROJECTION DOES NOT DEPEND ON THE CAMERA'S LONGITUDE, AND THAT IS
   * THE WHOLE REASON THE GLOBE CAN AFFORD TO BE SHARP.
   *
   * Read the two expressions in the old inner loop again:
   *
   *     lat = asin(w·sinφ₀ + v·cosφ₀)
   *     lon = λ₀ + atan2(u, w·cosφ₀ − v·sinφ₀)
   *
   * λ₀ — the camera longitude — appears exactly once, as a term ADDED at the end.
   * Everything else is a function of the pixel and of the camera LATITUDE only. So
   * is the Lambert term, because the sun is fixed in camera space now; so is the
   * fresnel, the coverage alpha and the dusk falloff. Every one of those is
   * constant while the planet spins.
   *
   * And spinning is all it normally does: the idle drift is `state.tLon += …`, and
   * the latitude only moves when a look-at aims at a venue. So the per-pixel
   * geometry — two `sqrt`s, an `asin` and an `atan2`, which is the expensive part
   * — is computed once into these flat arrays and then reused for as long as the
   * camera stays at that latitude. Per frame, what is left is a texel offset, one
   * bilinear fetch and a multiply.
   *
   * Measured: 13.2 → 9.7 ms at the old 420, and it is what makes 700 fit in
   * 30 Hz at all (18–20 ms against 36 ms for the uncached pass at 640).
   *
   * ★ ONLY PIXELS THE DISC TOUCHES ARE IN HERE, in a flat run, so the per-frame
   * loop has no bounds test and no branch. `idx` carries each one's byte offset
   * into the output, which is why they can be stored compacted.
   * ==================================================================== */
  const geo = { key: '', n: 0, idx: null, ty: null, xo: null, sh: null, gl: null, du: null, al: null };

  function buildGeo(R, isDay) {
    const cap = R * R;
    if (!geo.idx || geo.idx.length < cap) {
      geo.idx = new Int32Array(cap);
      geo.ty = new Float32Array(cap); geo.xo = new Float32Array(cap);
      geo.sh = new Float32Array(cap); geo.gl = new Float32Array(cap);
      geo.du = new Float32Array(cap); geo.al = new Uint8Array(cap);
    }
    const { idx, ty, xo, sh, gl, du, al } = geo;
    const half = R / 2, inv = 1 / half;
    const { sLat, cLat } = cam;
    const sx = SUN.x, sy = SUN.y, sz = SUN.z;
    const INV_PI = 1 / Math.PI;

    /* The day theme is not an inverted night theme anywhere else on this page and
       it is not here either — see the note at the end of README.md.
       ★ The DAY side needs MORE contrast between lit and unlit, not less. app.css
       holds the disc at 34% opacity there so a lit ocean does not sit behind body
       copy, and at 34% over warm paper a gentle terminator washes out completely —
       the sphere reads as one flat grey coin and the whole point of a real sun is
       lost. */
    const gain = isDay ? 1.30 : 0.95;
    const ambient = isDay ? NIGHT * 1.35 : NIGHT;
    /* How hard the city lights burn on the shadowed crescent. The day theme holds
       the whole disc at 34% opacity over warm paper, where a warm glow on a warm
       ground is just mud, so it gets a third of the night side's. */
    const lampGain = isDay ? 0.34 : 1.0;

    let k = 0;
    for (let py = 0; py < R; py++) {
      const v = -((py + 0.5) - half) * inv;
      const vv = 1 - v * v;
      /* ★ ONE TEXEL PAST THE LIMB, ON PURPOSE — this row bound and the coverage
         below are the antialiasing. The old loop tested `w² > 0` and skipped
         everything else, which gives the disc a hard edge on the RASTER and then
         scales it up: a stair-stepped limb, plus a dark fringe where the scaler
         blended opaque pixels against transparent black. */
      if (vv <= -2 * inv) continue;
      const span = Math.sqrt(Math.max(0, vv));
      const x0 = Math.max(0, Math.ceil(half - span * half - 1.5));
      const x1 = Math.min(R - 1, Math.floor(half + span * half + 0.5));
      // the parts of the unprojection that do not vary along the row
      const vLat = v * cLat, vDen = -v * sLat;

      for (let pxi = x0; pxi <= x1; pxi++) {
        const u = ((pxi + 0.5) - half) * inv;
        const w2 = 1 - u * u - v * v;
        // outside the limb the normal is edge-on rather than undefined; clamping
        // w to 0 keeps the unprojection valid right up to the silhouette
        const w = w2 > 0 ? Math.sqrt(w2) : 0;
        /* coverage: how far inside the limb this texel sits, in texels, offset so
           a texel centred exactly ON the limb is half covered. `1 − w²` is `u² +
           v²`, so its root is the radius — no extra work to get it. */
        const cov = (1 - Math.sqrt(1 - w2)) / inv + 0.5;
        if (cov <= 0) continue;

        const L = u * sx + v * sy + w * sz;
        /* A hard L>0 cut gives a terminator one pixel wide, and the real one is a
           few hundred kilometres of twilight. Softened over ±0.16 of the cosine,
           which is about 9° of arc — close enough to civil twilight to read right. */
        let lit = L <= -0.16 ? 0 : (L >= 0.16 ? 1 : (L + 0.16) / 0.32);
        lit = lit * lit * (3 - 2 * lit);                 // smoothstep

        const lat = Math.asin(w * sLat + vLat);
        const lam = Math.atan2(u, w * cLat + vDen);      // λ₀ is added per frame
        const fres = 1 - w;
        /* ★ THE LIGHTS DO NOT WAIT FOR FULL NIGHT, and they must not. Gated on
           `lit`, which the terminator drives to zero over ±0.16 of the cosine, the
           lights only existed inside a band a few pixels wide at the very edge of
           the disc and were effectively invisible. `dusk` is a second, much wider
           falloff on the same Lambert term — they start showing at about 0.6 of the
           radius and reach full strength at the limb, which is exactly what a city
           looks like from orbit at dusk. */
        const dusk = L >= 0.30 ? 0 : (L <= -0.10 ? 1 : (0.30 - L) / 0.40);

        idx[k] = (py * R + pxi) * 4;
        ty[k] = (0.5 - lat * INV_PI) * PLATE_H;
        xo[k] = (lam * INV_PI * 0.5 + 0.5) * PLATE_W;
        sh[k] = ambient + (gain - ambient) * lit;
        /* Atmosphere: a fresnel term toward the limb, tinted blue and scaled by
           how lit that part of the limb is — the bright crescent is on the day
           edge, wherever the camera has put it. */
        gl[k] = fres * fres * fres * 0.85 * lit;
        du[k] = dusk * dusk * (2 - dusk) * lampGain * 0.0032;
        al[k] = cov >= 1 ? 255 : cov * 255;
        k++;
      }
    }
    geo.n = k;
  }

  function buildSurface(isDay) {
    const R = surfaceSize();
    if (surf.size !== R) {
      surf.c = document.createElement('canvas');
      surf.c.width = surf.c.height = R;
      surf.g = surf.c.getContext('2d');
      surf.img = surf.g.createImageData(R, R);
      surf.size = R;
      geo.key = '';                       // a different raster is different geometry
    }
    /* ★ Quantised to a tenth of a degree. The cache is only invalidated by the
       camera's LATITUDE (and the raster size, and the theme, both of which change
       rarely) — so at the hero, where the latitude is fixed and only the drift
       runs, this is built once for the life of the page. */
    const key = R + '|' + state.lat.toFixed(1) + '|' + (isDay ? 'd' : 'n');
    if (geo.key !== key) { buildGeo(R, isDay); geo.key = key; }

    /* ★ The clock starts AFTER the geometry build, deliberately. buildGeo() is
       amortised — at the hero it runs once for the life of the page — so charging
       it to the frame budget would walk the ladder down over a cost that is not
       paid per frame. What is timed is exactly what repeats: the sample loop and
       the putImageData. */
    const t0 = performance.now();

    const out = surf.img.data;
    out.fill(0);

    const px = PLATE.px;
    const { n, idx, ty, xo, sh, gl, du, al } = geo;
    // the camera's longitude, in texels — the one thing that changes per frame
    const lonTex = state.lon / 360 * PLATE_W;

    if (!px) {
      // the plate has not baked yet, or could not be read — a plain ocean, so the
      // disc is never a hole while the imagery is in flight
      for (let i = 0; i < n; i++) {
        const o = idx[i], s = sh[i], g = gl[i];
        out[o] = 14 * s + 120 * g;
        out[o + 1] = 38 * s + 172 * g;
        out[o + 2] = 58 * s + 214 * g;
        out[o + 3] = al[i];
      }
      surf.g.putImageData(surf.img, 0, 0);
      chargeSurface(performance.now() - t0);
      return surf.c;
    }

    for (let i = 0; i < n; i++) {
      let tx = xo[i] + lonTex;
      tx = tx - Math.floor(tx / PLATE_W) * PLATE_W;      // wrap the seam
      const t = ty[i];

      const ix = tx | 0, iy = t < 0 ? 0 : (t > PLATE_H - 1 ? PLATE_H - 1 : t | 0);
      const fx = tx - ix, fy = t - iy;
      const ix1 = ix + 1 >= PLATE_W ? 0 : ix + 1;
      const iy1 = iy + 1 >= PLATE_H ? PLATE_H - 1 : iy + 1;
      const r0 = (iy * PLATE_W) * 4, r1 = (iy1 * PLATE_W) * 4;
      const a0 = r0 + ix * 4, b0 = r0 + ix1 * 4;
      const a1 = r1 + ix * 4, b1 = r1 + ix1 * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;

      const s = sh[i], g = gl[i], o = idx[i];
      /* ★ The fourth channel of the plate is not opacity, it is CITY LIGHT —
         js/earth.js bakes the emission there so both come out of one bilinear
         fetch. It is sampled with the same four weights, four multiplies. */
      const night = (px[a0 + 3] * w00 + px[b0 + 3] * w10 +
                     px[a1 + 3] * w01 + px[b1 + 3] * w11) * du[i];
      /* ★ A ±1 LEVEL DITHER, and it is not superstition. The sea runs a smooth
         ramp from shelf to deep across a third of the disc and the fresnel runs
         another across the limb; at 8 bits both band into visible contour rings,
         and a rotating planet turns static rings into moving ones. `i` alone gives
         a run of noise along each row, which is all the eye needs it to be. */
      const d = ((i & 7) - 3.5) * 0.30;

      out[o] = (px[a0] * w00 + px[b0] * w10 + px[a1] * w01 + px[b1] * w11) * s +
               120 * g + night * 255 + d;
      out[o + 1] = (px[a0 + 1] * w00 + px[b0 + 1] * w10 + px[a1 + 1] * w01 + px[b1 + 1] * w11) * s +
                   172 * g + night * 202 + d;
      out[o + 2] = (px[a0 + 2] * w00 + px[b0 + 2] * w10 + px[a1 + 2] * w01 + px[b1 + 2] * w11) * s +
                   214 * g + night * 128 + d;
      out[o + 3] = al[i];
    }

    surf.g.putImageData(surf.img, 0, 0);
    chargeSurface(performance.now() - t0);
    return surf.c;
  }

  /* ----------------------------------------------------- the projection */
  /* General form, for the handful of pins. Returns null on the far side. */
  function project(lat, lon) {
    const p = lat * RAD, l = lon * RAD;
    const cl = Math.cos(p);
    return projectVec(cl * Math.sin(l), cl * Math.cos(l), Math.sin(p));
  }

  /* The hot one: a packed unit vector, no trigonometry. */
  function projectVec(a, b, c) {
    const P = b * cam.cLon + a * cam.sLon;
    const cosc = cam.sLat * c + cam.cLat * P;
    if (cosc < 0) return null;
    return {
      x: state.cx + state.r * (a * cam.cLon - b * cam.sLon),
      y: state.cy - state.r * (cam.cLat * c - cam.sLat * P),
      z: cosc,
    };
  }

  /* Append a packed ring to two paths at once: `fillPath` gets a continuous
   * outline, `strokePath` gets only the runs that are actually on this side.
   *
   * ★ HORIZON CLIPPING. The old code just skipped hidden points and let fill()
   * close each visible run implicitly — so a landmass crossing the limb was
   * closed with a straight chord across the disc, and the Americas rendered as
   * a grey wedge over the whole left limb. Very visible at 2560.
   *
   * The fix needs no intersection maths. Orthographic projects the FAR
   * hemisphere onto the same disc, at the correct azimuth but at a radius under
   * r — so pushing a hidden point out to exactly r lands it on the limb, in the
   * right place. Do that for every hidden point and the fill boundary becomes
   * "true coastline while visible, limb arc while hidden", which is precisely
   * the correct silhouette.
   *
   * The stroke must NOT follow the limb, or every continent that crosses it
   * grows a bright false coastline along the edge — hence the two paths.
   *
   * No closePath(): fill() closes each subpath implicitly, which is what we
   * want, while an explicit close would draw the closing segment in the stroke. */
  function ringInto(fillPath, strokePath, ring, step) {
    const { xyz, n } = ring;
    const { cx, cy, r } = state;
    const { sLon, cLon, sLat, cLat } = cam;
    let open = false, started = false;
    for (let i = 0; i < n; i += step) {
      const j = i * 3;
      const a = xyz[j], b = xyz[j + 1], c = xyz[j + 2];
      const P = b * cLon + a * sLon;
      const front = sLat * c + cLat * P >= 0;
      let x = cx + r * (a * cLon - b * sLon);
      let y = cy - r * (cLat * c - sLat * P);

      if (!front) {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 1e-6) { open = false; continue; }   // the exact antipode has no azimuth
        x = cx + dx / d * r;
        y = cy + dy / d * r;
        open = false;                                // break the visible stroke run
      }

      if (fillPath) {
        if (!started) { fillPath.moveTo(x, y); started = true; } else fillPath.lineTo(x, y);
      }
      if (front) {
        if (!open) { strokePath.moveTo(x, y); open = true; } else strokePath.lineTo(x, y);
      }
    }
  }

  /** true when the ring is worth drawing at all */
  function ringVisible(ring, r) {
    const dot = cam.a * ring.capA + cam.b * ring.capB + cam.c * ring.capC;
    if (dot < ring.cull) return false;            // wholly over the horizon
    /* ★ THE SIZE CULL IS THE HOT ONE, because the per-ring cost is fixed — a
     * Path2D allocation and a fill() — and does NOT scale with how big the ring
     * is. 50m coastlines are 892 rings against 110m's 280, and the extra 612 are
     * almost all islands a few pixels across. At the hero disc (r=396) a 1.5px
     * floor keeps 792 rings; a 5px floor keeps 267 — two thirds fewer fills for
     * 83% of the points, i.e. all of the coastline anyone can actually see.
     * That ratio is why the frame rate came back after the 50m swap. */
    return 2 * r * ring.span >= 5;                // or too small to register
  }

  /* ------------------------------------------------------------ painting */
  function paint() {
    const { cx, cy, r, w, h } = state;
    ctx.clearRect(0, 0, w, h);
    if (r <= 4) return;

    const isDay = document.documentElement.dataset.theme === 'day';
    if (layers.dirty || layers.theme !== (isDay ? 'day' : 'night')) buildLayers(isDay);
    const accent = layers.accent;

    setCam();

    // -- the atmosphere ring outside the limb
    ctx.drawImage(layers.air, 0, 0, w, h);

    /* -- the surface: shaded relief, lit from over the reader's shoulder.
     *    Rastered small (see RASTER_MAX) and scaled up here, which is the one
     *    place smoothing is wanted — the alternative is visible raster texels.
     *
     * ★ IT IS DRAWN OUTSIDE THE CLIP, and that is the second half of the limb
     * fix. Canvas `clip()` is not antialiased in Chrome: clipping to an arc
     * quantises the silhouette to whole device pixels, so the sub-texel coverage
     * alpha buildSurface() now writes was being thrown away at exactly the edge
     * it was computed for. The surface carries its own feathered edge, so it
     * needs no clip; the vector work below still does, and gets one. */
    const surface = buildSurface(isDay);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(surface, cx - r, cy - r, r * 2, r * 2);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();

    /* -- the coastline, stroked over the imagery.
     *
     * ★ THE PER-RING FILLS ARE GONE, and that is the change that pays for the
     * surface pass. Filling 892 rings meant a Path2D allocation and a fill() each,
     * separately, because a ring crossing the limb is not a well-formed polygon and
     * batching them made the nonzero winding rule punch holes at random (Europe and
     * the Mediterranean rendered as sea). The plate draws the land now, so there is
     * nothing left to fill — and the STROKE has no winding rule, so the one thing
     * that remains was always safe to batch into a single path.
     *
     * It is kept, quietly, for two reasons: it is a full-resolution edge over an
     * upscaled raster, which is what stops the coastlines looking soft; and this is
     * an atlas, so a struck coastline is the house style.
     *
     * ★ STILL DO NOT INDEX-DECIMATE THESE RINGS. They arrive from trace/extract.py
     * already run through Douglas-Peucker at 0.05°, and DP output is the opposite
     * of uniform: every surviving point is load-bearing, kept precisely because
     * dropping it would move the outline. Taking every *other* one does not halve
     * the detail, it deletes the corners — measured at a 440px disc with the old
     * `base = 2`, Italy disappeared into the Adriatic, Greece and Denmark became
     * blobs, Cyprus became a rectangle, and thin coastal features collapsed into
     * slivers lying in the sea. That is the "weird stuff in some countries" this
     * guard is for; compare trace/shots/globe/*-step1 against the frames beside
     * them. Below ~150px across nothing on the disc resolves anyway. */
    const base = r > 150 ? 1 : 2;
    const outline = new Path2D();
    for (const ring of LAND_RINGS) {
      if (!ringVisible(ring, r)) continue;
      ringInto(null, outline, ring, Math.min(base, Math.max(1, Math.floor(ring.n / 6))));
    }
    ctx.strokeStyle = isDay ? 'rgba(24,22,16,.30)' : 'rgba(226,236,244,.20)';
    ctx.lineWidth = 0.7;
    ctx.stroke(outline);

    // -- graticule, 20°, quiet. Stroke only, so no fill path — a null fillPath
    //    also means it never picks up the limb-hugging segments.
    const grat = new Path2D();
    const gstep = r > 300 ? 1 : 2;
    for (const ring of GRATICULE) {
      if (!ringVisible(ring, r)) continue;
      ringInto(null, grat, ring, gstep);
    }
    ctx.strokeStyle = isDay ? 'rgba(20,20,14,.13)' : 'rgba(236,229,217,.075)';
    ctx.lineWidth = 0.6;
    ctx.stroke(grat);

    ctx.restore();

    // -- the limb itself, struck once, outside the clip so it is not half-cut
    ctx.strokeStyle = isDay ? 'rgba(30,40,50,.35)' : 'rgba(150,200,230,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();

    // -- pins ------------------------------------------------------------
    const t = performance.now() / 1000;
    for (const pin of state.pins) {
      const p = project(pin.lat, pin.lon);
      if (!p) continue;
      const fade = Math.min(1, p.z * 3.2);           // dim toward the limb
      const focus = state.focus === pin.id;
      ctx.globalAlpha = fade * (pin.event ? 1 : 0.62);

      if (pin.event) {
        const r = focus ? 4.4 : 3.2;
        ctx.fillStyle = pin.color;
        ctx.shadowColor = pin.color;
        ctx.shadowBlur = 10 * fade;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        // day side: the accents are light on a light globe, so ring them
        if (isDay) {
          ctx.strokeStyle = 'rgba(12,16,20,.75)'; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 0.8, 0, TAU); ctx.stroke();
        }
        if (pin.next || focus) {                      // the live one breathes
          const k = (t * 0.55 + (pin.next ? 0 : 0.4)) % 1;
          ctx.globalAlpha = fade * (1 - k) * 0.85;
          ctx.strokeStyle = pin.color; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + k * 17, 0, TAU); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = accent; ctx.lineWidth = isDay ? 1.5 : 1.1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.7, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // -- home, drawn as a survey cross rather than another dot
    if (state.home) {
      const p = project(state.home.lat, state.home.lon);
      if (p) {
        ctx.globalAlpha = Math.min(1, p.z * 3.2) * 0.8;
        ctx.strokeStyle = layers.ink; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y);
        ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* --------------------------------------------------------------- loop */
  let last = performance.now();
  let lastPaint = -1e9;
  let raf = 0;
  /* ★ Published as data-paints so verify.mjs §8 can assert the REPAINT RATE
     rather than the frame rate. Frame rate in headless measures swiftshader's
     software rasteriser, which is not what ships and which varied 14–150 fps
     run to run on identical code. What actually matters — and what caused the
     5 fps this work started from — is a canvas repainting when it has no need
     to, and that is exactly what this counter makes measurable. */
  let paints = 0;
  let stillSig = '';        // last frame painted while MOTION was off
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.running) return;

    if (state.motion) {
      const k = 1 - Math.pow(0.0016, dt);            // frame-rate independent ease
      let dLon = angleDelta(state.lon, state.tLon) * k;
      let dLat = (state.tLat - state.lat) * k;

      // ★ clamp the turn rate — see MAX_TURN. Scale both axes by the same factor
      // so a capped turn follows the same arc, just slower, instead of sliding
      // along one axis first and bending toward the target at the end.
      const mag = Math.hypot(dLon, dLat), cap = MAX_TURN * dt;
      if (mag > cap) { const s = cap / mag; dLon *= s; dLat *= s; }

      state.lon += dLon;
      state.lat += dLat;
      /* ★ THE IDLE DRIFT ONLY RUNS WHERE ANYONE CAN SEE IT, AND THAT IS THE FIX
       * FOR THE PLANET SPINNING BACKWARDS.
       *
       * Theodor: "I just saw the globe spinning a lot in the opposite direction
       * when you scroll up or down. Definitely a bug."
       *
       * It is, and it is this line. The drift is eastward and it accumulates on
       * the TARGET, without bound — sit in §02 for half a minute and `tLon` is
       * 25° east of the venue the page is talking about. Then the next thing the
       * reader scrolls past re-aims at an actual venue longitude, which throws all
       * of that away in one go: the camera has to unwind the whole accumulated
       * drift, WESTWARD, at up to MAX_TURN. So the amount of reverse spin was
       * proportional to how long the reader had been reading — which is exactly
       * why it looked random, and why it never showed up in a quick pass over the
       * page. Past the hero none of the drift that caused it was ever visible: the
       * disc is at 0.14 opacity behind #scrim, and setBusy() stops it painting at
       * all while the reader moves. It was invisible going out and expensive
       * coming back.
       *
       * So the drift is gated on the globe being the subject. At the hero it is
       * exactly as it was, 0.9°/s; anywhere below it the camera simply stays where
       * the last look-at put it, and every later aim is then the few degrees
       * between one Swedish circuit and the next rather than a minute of unwinding.
       * DRIFT_DIM is the same 0.5 lookAt() uses to decide "subject or backdrop", on
       * purpose: one threshold, one meaning. */
      if (now > state.holdUntil && state.dim >= DRIFT_DIM) {
        state.tLon += state.drift * dt;              // keep drifting once settled
      }
    } else {
      state.lon = state.tLon; state.lat = state.tLat;

      /* ★ MOTION OFF MUST MEAN STATIC, and it quietly did not. The camera stops
         here, but the live pin's pulse is driven by the clock inside paint() —
         so the globe went on repainting an all-but-identical frame at its full
         budget, forever, with motion off. verify.mjs §8 caught it: the starfield
         sat correctly at 0 Hz while the globe ran at its budget beside it.
         With motion off, paint only when something has genuinely changed. */
      /* ★ THE SUN IS OUT OF THE SIGNATURE AGAIN. It had to be in it while the
         light was fixed in world space: a real terminator creeps 15°/hour whether
         or not the camera moves, so the still frame had to be allowed to repaint
         about fifteen times an hour to keep up with it. Locked to the camera the
         light cannot change unless the camera does, and the camera is already the
         first two fields — so MOTION off is now a genuinely dead canvas. */
      const sig = state.lon.toFixed(2) + '|' + state.lat.toFixed(2) + '|' +
                  state.dim.toFixed(2) + '|' + state.focus + '|' +
                  document.documentElement.dataset.theme + '|' + state.w + 'x' + state.h +
                  '|' + (PLATE.ready ? 1 : 0);
      if (sig === stillSig && !layers.dirty) return;
      stillSig = sig;
    }

    /* A changing canvas layer forces the page to re-composite, and #scrim and the
       topbar's backdrop-filter sit on top of this one — so what matters is how
       OFTEN the globe changes, not how fast it draws. The idle drift is 0.9°/s;
       at a 660px disc that is a fifth of a pixel per frame at 60 Hz. 30 Hz is
       indistinguishable, and past the hero the globe is at ~0.14 opacity behind
       the scrim, where 15 Hz is generous. */
    if (state.dim <= 0.02) return;

    /* ★ WHILE THE READER IS SCROLLING, A DIMMED GLOBE PAINTS NOTHING.
     *
     * Theodor: "when the globe is behind the track layouts and the track facts,
     * it's a bit more laggy compared to before." It is, and the disc itself is
     * not the reason — the compositor is. This canvas is fixed and
     * viewport-sized, #scrim lies over it and the topbar over that with a
     * backdrop-filter, so a repaint here does not just cost its own raster: it
     * dirties a layer that has to be re-blended under everything, and it does
     * that in the middle of the one frame budget the reader can actually feel.
     *
     * Past the hero there is nothing on the disc worth the money. It sits at
     * 0.14 opacity behind the scrim and drifts 0.9°/s, which at a 660px disc is
     * a fifth of a pixel per frame — invisible while the page is moving under
     * it. So it stands still until the reader does, then picks the drift back
     * up. Above dim 0.5 the globe IS the subject and this never applies, so the
     * hero is untouched. */
    if (state.busy && state.dim < 0.5) return;

    const budget = state.dim < 0.25 ? 1000 / 8 : 1000 / 30;
    if (now - lastPaint < budget) return;
    lastPaint = now;

    /* The camera, reflected onto the canvas so the suite can see it. There is no
       DOM inside a canvas, and CONVENTIONS §5 says tests read ids and data-* —
       so the camera is published as data-*, written only on a real paint (8–30
       Hz, not per frame) and rounded, which keeps it off the hot path. */
    canvas.dataset.lon = state.lon.toFixed(1);
    canvas.dataset.lat = state.lat.toFixed(1);
    canvas.dataset.paints = ++paints;
    /* ★ The sun, published for the same reason and now asserting the OPPOSITE
       thing. verify.mjs §12d used to prove the light was fixed in world space by
       moving the camera and watching these two stay put. The light is locked to
       the camera now, so the same two fields have to move WITH it, exactly — the
       sub-solar point implied by a camera-space sun is `sunWorld()` below, and a
       check that turns the planet and asserts the sun turned by the same amount is
       the only way to tell "locked to the camera" from "stuck". `plate` says
       whether the relief actually baked, so a tainted or missing source fails
       loudly instead of quietly degrading to a flat blue ball. */
    const sun = sunWorld();
    canvas.dataset.sunLat = sun.lat.toFixed(2);
    canvas.dataset.sunLon = sun.lon.toFixed(2);
    canvas.dataset.sunLock = 'camera';
    canvas.dataset.sunLit = terminatorAt().toFixed(3);
    canvas.dataset.plate = PLATE.ready ? 'ready' : (PLATE.failed ? 'failed' : 'loading');
    canvas.dataset.plateKind = PLATE.detail || '';

    paint();
    canvas.dataset.raster = String(surf.size);   // set by paint(), so read it after
    /* ★ What the surface pass costs and what the ladder made of it — see
       RASTER_LADDER. Published because "it backs off when it cannot hold the
       budget" is a claim about a number no test can otherwise see, and because a
       machine silently stuck on the bottom rung looks identical to one that never
       needed to move. */
    canvas.dataset.surfMs = cost.ms.toFixed(2);
    canvas.dataset.rasterCap = String(rasterCeiling());
  }

  /* ------------------------------------------------------------- public */
  const api = {
    resize() { resize(); paint(); },
    setPins(pins, home) { state.pins = pins; state.home = home || null; },
    /**
     * Turn the Earth so this coordinate faces the camera.
     *
     * `settled` is for re-aims the reader did not ask for — arriving back at a
     * chapter rather than choosing a date. ★ It is the fix for "when u scroll up
     * from it disappearing it just spins back to point 1 at max speed": while
     * the globe is dimmed behind the scrim there is nothing to animate FOR, so
     * the camera is placed rather than flown, and the hero fades in already
     * pointing the right way. Animating it instead saves the whole traversal up
     * and plays it as a spin at the exact moment the globe becomes visible,
     * which is what he was seeing. Once the globe IS the subject (dim >= .5) a
     * look-at eases normally, so nothing teleports in front of the reader.
     *
     * ★ §02's per-entry aim passes it too now, and that is the other half of the
     * reverse-spin fix — see the drift gate in frame(). Every one of those aims
     * lands with the disc at 0.14 opacity behind the scrim, which is the case this
     * option was written for; flying them was animating something nobody was
     * looking at and then handing the reader whatever was left of it.
     */
    lookAt(lat, lon, { hold = 2600, settled = false } = {}) {
      state.tLat = Math.max(-70, Math.min(70, lat));
      state.tLon = lon;
      state.holdUntil = performance.now() + hold;
      if (settled && state.dim < DRIFT_DIM) {
        state.lat = state.tLat;
        state.lon = state.tLon;
      }
    },
    focus(id) { state.focus = id; },
    /** the wrapper's current opacity, so the paint budget can follow it */
    setDim(v) { state.dim = v; },
    /** true while the reader is actively scrolling — see the star in frame() */
    setBusy(v) {
      if (state.busy === v) return;
      state.busy = v;
      /* Published for the suite, per CONVENTIONS §5 (tests read data-*). The
         check that guards this fix has to assert the MECHANISM — no repaints
         across a window where the gate was continuously closed — because
         asserting a repaint-rate ratio instead measured headless scheduling
         noise and went amber run to run on identical code. */
      canvas.dataset.busy = v ? '1' : '0';
      // coming out of a scroll, repaint at once rather than waiting out the
      // budget, so the drift resumes from where the camera actually is
      if (!v) lastPaint = -1e9;
    },
    /** screen position of a pin right now, or null if it is on the far side */
    pinAt(id) {
      const pin = state.pins.find(x => x.id === id);
      if (!pin) return null;
      setCam();
      return project(pin.lat, pin.lon);
    },
    /** nearest pin within `tol` px of a point in canvas space, or null */
    hitTest(x, y, tol = 14) {
      setCam();
      let best = null, bd = tol * tol;
      for (const pin of state.pins) {
        const p = project(pin.lat, pin.lon);
        if (!p) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = pin; }
      }
      return best;
    },
    setMotion(on) {
      state.motion = on;
      if (!on) { state.lon = state.tLon; state.lat = state.tLat; paint(); }
    },
    pause() { state.running = false; },
    resume() { state.running = true; last = performance.now(); lastPaint = -1e9; },
    destroy() { cancelAnimationFrame(raf); },
  };

  resize();

  /* The plate is very likely still decoding when the first frame goes out, and with
     MOTION off nothing would ever ask for another one — the still signature would
     have already been written. So take a repaint when the imagery lands (or fails),
     which the signature also covers, and clear the layer cache with it. */
  if (!PLATE.ready && !PLATE.failed) {
    PLATE.waiting.push(() => { layers.dirty = true; lastPaint = -1e9; stillSig = ''; });
  }

  raf = requestAnimationFrame(frame);
  return api;
}
