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
 * ★ THE LIGHT IS THE REAL ONE — THE ACTUAL SUBSOLAR POINT, AT THE READER'S CLOCK.
 *
 * Theodor: "it would be cool if it was live time, where the sun is shining on the
 * globe — shadows and stuff — and then have city lights as you have in the dark."
 *
 * This is the third position this file has held on the question, so the history
 * matters more than usual. Session 4 made the light a direction in WORLD space at
 * the real subsolar point. Session 6 reversed it to a fixed direction in CAMERA
 * space, because the drift and the per-entry look-ats spend most of their time
 * over Europe at European evening and the venue the page was talking about kept
 * landing on the unlit side. Session 8 reverses it back, asked for directly and in
 * full knowledge of that: the terminator is where the Earth's actually is, so
 * Sweden at three in the morning is dark, and it is dark on purpose.
 *
 * ★ WHAT MAKES THAT AFFORDABLE NOW, WHERE IT WAS NOT IN SESSION 4, is that the
 * night side has something to show. The city lights channel arrived with the
 * relief plate afterwards (js/earth.js), so a venue in shadow sits in the middle
 * of the brightest lit landmass on Earth rather than in a black void — and the
 * pins are drawn over the surface at full opacity regardless. NIGHT below is
 * nudged up a little for the same reason. Read is not the same as lit.
 *
 * ★ AND THE GEOMETRY CACHE SURVIVED IT, which is the whole engineering problem.
 * A world-fixed sun means the Lambert term depends on the camera's LONGITUDE, and
 * longitude is the one thing this globe changes every frame — so the naive version
 * rebuilds GEO (an asin and an atan2 per pixel) sixty times a second. Instead GEO
 * now caches pure geometry, the per-pixel surface NORMAL included, and the sun is
 * rotated into camera space once per frame. What is left per pixel is a three-term
 * dot product and three lookups. See buildGeo() and LUT.
 *
 * The maths is the low-precision solar position from the USNO's Astronomical
 * Almanac — good to about a hundredth of a degree for any date this page will see,
 * which is four hundred times finer than one pixel of terminator. */
const J2000 = 946728000000;                 // 2000-01-01T12:00:00Z, in epoch ms

/**
 * Where the sun stands overhead at `ms`, as {lat, lon} in degrees.
 *
 * `lat` is the solar declination — ±23.44° over the year, and it is what tips the
 * terminator so the Arctic is lit around the clock in June and never in December.
 * `lon` is 15° per hour of UTC, corrected by the equation of time: the orbit is
 * elliptical and the axis is tilted, so apparent noon runs up to ±16 minutes away
 * from mean noon and the sun is not over Greenwich at 12:00 UTC on any day but
 * four of them.
 */
function subsolar(ms) {
  const d = (ms - J2000) / 86400000;                        // days since J2000.0
  const wrap = (deg) => ((deg % 360) + 360) % 360;
  const Lm = wrap(280.460 + 0.9856474 * d);                 // mean longitude, deg
  const g = wrap(357.528 + 0.9856003 * d) * RAD;            // mean anomaly
  const lam = (Lm + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.4393 - 3.563e-7 * d) * RAD;               // obliquity of the ecliptic
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
  /* The equation of time, in degrees of the Earth's own rotation rather than in
     minutes — this is going straight into a longitude, and 4 minutes is 1°. `Lm`
     is reduced first: unreduced it is some ten thousand degrees by 2026 and the
     difference against a right ascension in (−180, 180] is meaningless. */
  const eot = (((Lm - ra) + 540) % 360) - 180;
  const utcH = (ms / 3600000) % 24;
  // Greenwich hour angle is 15°(h − 12) + eot; the sun stands over its negative
  return { lat: dec / RAD, lon: (((-(15 * (utcH - 12) + eot)) + 540) % 360) - 180 };
}

/**
 * The fraction of the visible disc that is in daylight, from the sun's z in
 * CAMERA space — the standard phase term, (1 + cos θ)/2, exactly as for a moon.
 *
 * Published as data-sun-lit. It replaces a constant: while the light was locked to
 * the camera this was a fixed property of one hardcoded direction, and the suite
 * asserted it never moved. It is now the thing that has to MOVE as the camera
 * turns under a sun that does not — which is how §12d tells a world-locked light
 * from a camera-locked one without being able to see inside the canvas.
 */
const litFraction = (sunZ) => (1 + sunZ) / 2;

/* How dark the night side gets. Not zero: the globe sits behind body copy at low
   opacity and a hemisphere of pure black reads as a bite taken out of the disc
   rather than as night. Earthshine and airglow are a real thing anyway.
   ★ Nudged from 0.085. With a real terminator the shadow is no longer a crescent
   hugging the limb — it can be half the face, with a venue somewhere in it — so
   the floor has to carry a little more of the coastline than it used to. */
const NIGHT = 0.105;

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

  /* ★ THE SUN, RESOLVED ONCE PER PAINT AND NOT ONCE PER PIXEL.
   *
   * `sun.world` is where it stands over the Earth — the real subsolar point, in
   * {lat, lon}, published as data-sun-lat/lon so the lighting is FALSIFIABLE from
   * outside the canvas. There is no DOM inside a canvas, so what paint() writes to
   * data-* is the only handle a test has on it, and "the light is fixed in world
   * space" is exactly the claim that these two numbers do NOT move when the camera
   * does. See trace/verify.mjs §12d.
   *
   * `sun.x/y/z` is the same direction in CAMERA space, which is what the surface
   * pass actually shades against: x right, y up, z toward the reader. The rotation
   * is a pair of planar rotations and it is the exact transpose of the one
   * project() applies to a surface point, so a point whose normal is the sun
   * direction lands, by construction, at the brightest pixel on the disc.
   *
   * ★ The solar position is only recomputed when the CLOCK has moved enough to
   * matter. It is eight trig calls, which is nothing next to a million pixels —
   * but the sun travels 0.004° per second, so at 30 Hz all but one frame in
   * seventy is recomputing a number that has not changed in its fourth decimal. */
  const sun = { world: { lat: 0, lon: 0 }, x: 0, y: 0, z: 1, at: -1e12 };

  function setSun(now) {
    if (now - sun.at > 2000) { sun.world = subsolar(Date.now()); sun.at = now; }
    const cd = Math.cos(sun.world.lat * RAD), sd = Math.sin(sun.world.lat * RAD);
    const sl = sun.world.lon * RAD;
    // the same packed basis every point on this globe uses — see packRing()
    const a = cd * Math.sin(sl), b = cd * Math.cos(sl), c = sd;
    const P = b * cam.cLon + a * cam.sLon;
    sun.x = a * cam.cLon - b * cam.sLon;
    sun.y = cam.cLat * c - cam.sLat * P;
    sun.z = cam.sLat * c + cam.cLat * P;
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
   * the Lambert term against the real sun — see the note over subsolar() at the
   * top of this file for where that direction comes from.
   *
   * The maths, per pixel, with the disc centred and v measured upward:
   *
   *   u, v            the pixel, in units of the globe radius
   *   w = √(1−u²−v²)  the third component of the surface normal, toward the camera
   *   lat = asin(w·sinφ₀ + v·cosφ₀)
   *   lon = λ₀ + atan2(u, w·cosφ₀ − v·sinφ₀)
   *   L   = u·sun.x + v·sun.y + w·sun.z          the Lambert term
   *
   * ★ THE THIRD LINE IS CACHED AND THE FOURTH IS NOT, AND THAT SPLIT IS THE WHOLE
   * DESIGN. The unprojection is the expensive half — an asin and an atan2 — and it
   * does not depend on the camera's longitude at all, so it survives the drift (see
   * GEO). The Lambert term against a world-fixed sun does depend on longitude, so
   * it cannot; what it costs instead is a three-term dot product against a normal
   * the same cache already holds, and three reads from a 1 024-entry table. That is
   * about a fifth of what one bilinear plate fetch costs, which is why a real
   * terminator is affordable at 1 024² and a rebuilt GEO would not have been.
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
   * Everything else is a function of the pixel and of the camera LATITUDE only: the
   * surface normal, the fresnel, the coverage alpha and the sampling footprint.
   *
   * And spinning is all the camera normally does: the idle drift is `state.tLon +=
   * …`, and the latitude only moves when a look-at aims at a venue. So the
   * per-pixel geometry — two `sqrt`s, an `asin` and an `atan2`, which is the
   * expensive part — is computed once into these flat arrays and then reused for as
   * long as the camera stays at that latitude.
   *
   * Measured: 13.2 → 9.7 ms at the old 420, and it is what makes 700 fit in
   * 30 Hz at all (18–20 ms against 36 ms for the uncached pass at 640).
   *
   * ★ THE SHADING IS NO LONGER IN HERE, AND THE THEME NO LONGER KEYS IT. A real
   * sun is fixed in WORLD space, so the Lambert term moves with λ₀ and is the one
   * thing that genuinely cannot be cached against latitude. What replaced `sh`,
   * `gl` and `du` is the NORMAL — nx, ny, nz — which is pure geometry, and the
   * per-frame pass dots it against the sun and reads the answer out of LUT below.
   * That costs the same three arrays it used to, at half the width, and it means a
   * theme change no longer throws the whole unprojection away.
   *
   * ★ nx/ny/nz ARE INT16, at 1/30 000 of a unit. The Lambert term feeds a
   * 1 024-entry table, so a thousandth of a unit would do; what the fixed point is
   * really buying is halved memory traffic on the hottest read in the file. The
   * scale is folded into the sun vector at the top of the frame, so nothing is
   * multiplied out per pixel. 30 000 rather than 32 767 because `w` is clamped to
   * zero one texel PAST the limb — see the coverage note below — so the stored
   * normal can be a hair longer than unit there and must not wrap.
   *
   * ★ ONLY PIXELS THE DISC TOUCHES ARE IN HERE, in a flat run, so the per-frame
   * loop has no bounds test and no branch. `idx` carries each one's byte offset
   * into the output, which is why they can be stored compacted.
   * ==================================================================== */
  const N16 = 30000, INV_N16 = 1 / N16;
  /* The sampling footprint, in texels at 1/32 — see FOOTPRINT below. Capped at
     eight: past that the four taps are too far apart to be an average of anything,
     and the honest figure runs to 80-odd texels in the last pixel before the
     silhouette, where a raster pixel really does cover a quarter of the planet.
     Measured over a 1 024² disc at the hero's latitude, 83.4% of it never leaves
     plain bilinear, 15% takes a tap under two texels wide, and 0.11% — a ring
     about a pixel thick, already under the coverage feather and the fresnel — is
     what this clamps. */
  const F16 = 32, INV_F16 = 1 / F16, F_MAX = 8 * F16;
  const geo = {
    key: '', n: 0, idx: null, ty: null, xo: null,
    nx: null, ny: null, nz: null, fx: null, fy: null, al: null,
  };

  function buildGeo(R) {
    const cap = R * R;
    if (!geo.idx || geo.idx.length < cap) {
      geo.idx = new Int32Array(cap);
      geo.ty = new Float32Array(cap); geo.xo = new Float32Array(cap);
      geo.nx = new Int16Array(cap); geo.ny = new Int16Array(cap); geo.nz = new Int16Array(cap);
      geo.fx = new Int16Array(cap); geo.fy = new Int16Array(cap);
      geo.al = new Uint8Array(cap);
    }
    const { idx, ty, xo, nx, ny, nz, fx, fy, al } = geo;
    const half = R / 2, inv = 1 / half;
    const { sLat, cLat } = cam;
    const INV_PI = 1 / Math.PI;
    /* how many plate texels one raster pixel spans at the sub-camera point, per
       axis — the scale the footprint below is measured against. See FOOTPRINT. */
    const pxU = 2 / R, texX = PLATE_W / TAU, texY = PLATE_H / Math.PI;

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

        const lat = Math.asin(w * sLat + vLat);
        const lam = Math.atan2(u, w * cLat + vDen);      // λ₀ is added per frame

        /* ================================================== FOOTPRINT
         * ★ HOW MANY TEXELS THIS ONE PIXEL IS RESPONSIBLE FOR, which is the other
         * half of "a bit of stuff moving on islands and on the land".
         *
         * js/earth.js fixed the surplus detail near the POLES, which is a property
         * of the plate and is dealt with once at boot. This is the surplus near the
         * LIMB, which is a property of the camera and cannot be: an orthographic
         * sphere is edge-on there, so a pixel a tenth of a radius from the
         * silhouette covers about three times the ground a pixel at the centre
         * does, and at the silhouette itself the figure is unbounded. Every one of
         * those texels the bilinear fetch does not land on is detail that changes
         * as the planet turns — which is the crawl, and it is worst on exactly the
         * small high-contrast features the report names.
         *
         * So the footprint is measured properly rather than guessed, per axis,
         * from the analytic derivatives of the unprojection. cos²φ = A² + B² falls
         * straight out of the atan2 above, and ∂w/∂u = −u/w is the only other
         * ingredient. The two axes are kept SEPARATE on purpose: the compression
         * is radial, so at the left and right limb it is almost entirely in
         * longitude and at the top and bottom almost entirely in latitude, and one
         * isotropic figure would blur each of them across the axis that was still
         * perfectly well sampled. That reads as a mushy ring round the disc.
         *
         * What is stored is the EXCESS over what the plate already carries —
         * quadrature, because filter widths add in variance — so it is zero over
         * most of the disc and the per-frame loop pays nothing for it there. In x
         * the plate is already band-limited to sec(φ) texels by the polar
         * prefilter, which is why that term and not 1 is what is subtracted. */
        const A = u, B = w * cLat + vDen;
        /* A² + B² is cos²(lat) identically — the atan2 above is
           atan2(cosφ·sinΔλ, cosφ·cosΔλ) — so the cosine the derivatives need is
           already paid for, and taking it this way keeps it exact at the poles
           where cos(asin(…)) loses its last digits. */
        const c2 = A * A + B * B, cp = Math.sqrt(c2);
        let ex = 0, ey = 0;
        if (w > 1e-4 && cp > 1e-4) {
          const iw = 1 / w;
          const dLatU = -sLat * u * iw / cp;                    // ∂lat/∂u
          const dLatV = (cLat - sLat * v * iw) / cp;            // ∂lat/∂v
          const dLonU = (B + A * cLat * u * iw) / c2;           // ∂lon/∂u
          const dLonV = A * (cLat * v * iw + sLat) / c2;        // ∂lon/∂v

          const fxT = pxU * texX * Math.hypot(dLonU, dLonV);
          const fyT = pxU * texY * Math.hypot(dLatU, dLatV);
          const sec = 1 / cp;                        // what the prefilter left in x
          ex = Math.sqrt(Math.max(0, fxT * fxT - sec * sec)) / 2;
          ey = Math.sqrt(Math.max(0, fyT * fyT - 1)) / 2;
        }
        /* Under half a texel there is nothing a wider tap could recover, and the
           per-frame branch is written so that a zero here costs one comparison. */
        const exq = ex < 0.5 ? 0 : Math.min(F_MAX, Math.round(ex * F16));
        const eyq = ey < 0.5 ? 0 : Math.min(F_MAX, Math.round(ey * F16));

        idx[k] = (py * R + pxi) * 4;
        ty[k] = (0.5 - lat * INV_PI) * PLATE_H;
        xo[k] = (lam * INV_PI * 0.5 + 0.5) * PLATE_W;
        nx[k] = u * N16; ny[k] = v * N16; nz[k] = w * N16;
        fx[k] = exq; fy[k] = eyq;
        al[k] = cov >= 1 ? 255 : cov * 255;
        k++;
      }
    }
    geo.n = k;
  }

  /* ================================================== LUT — THE SHADING TABLE
   * Everything the Lambert term drives is a function of that ONE number, so all of
   * it is tabulated over L ∈ [−1, 1] once per theme and read back with a multiply
   * and a truncation. It replaces three smoothsteps and six branches per pixel per
   * frame, which is what a world-fixed sun would otherwise have cost — see the
   * note over GEO. 1 024 entries puts 164 of them inside the ±0.16 twilight band,
   * so the terminator is smooth to well under a level of output.
   * ==================================================================== */
  const LUT_N = 1024, LUT_MAX = LUT_N - 1, LUT_K = LUT_MAX / 2;
  const lut = {
    theme: null,
    sh: new Float32Array(LUT_N), gl: new Float32Array(LUT_N), du: new Float32Array(LUT_N),
  };

  /** L ∈ [−1, 1] to a table row. Clamped, and it has to be: `w` is pinned to zero
   *  one texel PAST the limb so the coverage alpha can feather there, which leaves
   *  the stored normal a thousandth longer than unit and L a thousandth over 1. */
  function lutAt(L) {
    const i = (L + 1) * LUT_K;
    return i < 0 ? 0 : (i > LUT_MAX ? LUT_MAX : i | 0);
  }

  function buildLut(isDay) {
    /* The day theme is not an inverted night theme anywhere else on this page and
       it is not here either — see the note at the end of README.md.
       ★ The DAY side needs MORE contrast between lit and unlit, not less. app.css
       holds the disc at 34% opacity there so a lit ocean does not sit behind body
       copy, and at 34% over warm paper a gentle terminator washes out completely —
       the sphere reads as one flat grey coin and the whole point of a real sun is
       lost. */
    const gain = isDay ? 1.30 : 0.95;
    const ambient = isDay ? NIGHT * 1.35 : NIGHT;
    /* How hard the city lights burn on the shadowed side.
     * ★ TURNED DOWN BY NEARLY HALF, AND THE REAL SUN IS WHY.
     * This was 1.0, and 1.0 was right for what it was tuned against: a shadowed
     * CRESCENT hugging the limb, a few pixels wide, where the surface is
     * foreshortened to nothing and the fresnel haze is doing most of the drawing.
     * A world-fixed sun makes that crescent a whole hemisphere, and the same gain
     * across a hemisphere at normal incidence is a different picture entirely.
     * Measured at 23:00 UTC with the camera on Europe: the lights peaked at 101%
     * of the daylit ground's own peak and their mean ran three times the day
     * side's, so the night half of the disc was the BRIGHTER half and the
     * terminator stopped being an event. Cities are meant to read as a glow in the
     * haze, not as a second daylight.
     * The day theme keeps its third of whatever this is: it holds the whole disc
     * at 34% opacity over warm paper, where a warm glow on warm ground is mud. */
    const lampGain = isDay ? 0.19 : 0.58;

    for (let i = 0; i < LUT_N; i++) {
      const L = i / LUT_K - 1;
      /* A hard L>0 cut gives a terminator one pixel wide, and the real one is a
         few hundred kilometres of twilight. Softened over ±0.16 of the cosine,
         which is about 9° of arc — close enough to civil twilight to read right. */
      let lit = L <= -0.16 ? 0 : (L >= 0.16 ? 1 : (L + 0.16) / 0.32);
      lit = lit * lit * (3 - 2 * lit);                   // smoothstep
      /* ★ THE LIGHTS DO NOT WAIT FOR FULL NIGHT, and they must not. Gated on
         `lit`, which the terminator drives to zero over ±0.16 of the cosine, the
         lights only existed inside a band a few pixels wide and were effectively
         invisible. `dusk` is a second, much wider falloff on the same Lambert
         term, so they come up through the evening the way a city actually does
         from orbit. With a real sun that band now sweeps Europe every night. */
      const dusk = L >= 0.30 ? 0 : (L <= -0.10 ? 1 : (0.30 - L) / 0.40);

      lut.sh[i] = ambient + (gain - ambient) * lit;
      /* Atmosphere: the fresnel toward the limb is per-pixel and stays there; what
         belongs to L is how LIT that part of the limb is, so the bright crescent
         sits on the day edge wherever the sun has actually put it. */
      lut.gl[i] = 0.85 * lit;
      lut.du[i] = dusk * dusk * (2 - dusk) * lampGain * 0.0032;
    }
    lut.theme = isDay ? 'day' : 'night';
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
    /* ★ Quantised to a tenth of a degree, and the THEME IS NO LONGER IN THE KEY —
       the shading moved to LUT, so a day/night switch now costs a 1 024-entry
       table rather than a million unprojections. The cache is invalidated by the
       camera's LATITUDE and the raster size only, so at the hero, where the
       latitude is fixed and only the drift runs, it is built once for the life of
       the page — with a world-fixed sun turning over the top of it. */
    const key = R + '|' + state.lat.toFixed(1);
    if (geo.key !== key) { buildGeo(R); geo.key = key; }
    if (lut.theme !== (isDay ? 'day' : 'night')) buildLut(isDay);

    /* ★ The clock starts AFTER the geometry build, deliberately. buildGeo() is
       amortised — at the hero it runs once for the life of the page — so charging
       it to the frame budget would walk the ladder down over a cost that is not
       paid per frame. What is timed is exactly what repeats: the sample loop and
       the putImageData. */
    const t0 = performance.now();

    const out = surf.img.data;
    out.fill(0);

    const px = PLATE.px;
    const { n, idx, ty, xo, nx, ny, nz, fx, fy, al } = geo;
    const LSH = lut.sh, LGL = lut.gl, LDU = lut.du;
    // the camera's longitude, in texels — the one thing that changes per frame
    const lonTex = state.lon / 360 * PLATE_W;
    /* ★ The 1/30 000 that turns the packed Int16 normal back into a unit vector is
       folded into the sun here, once, rather than into three multiplies a pixel. */
    const sux = sun.x * INV_N16, suy = sun.y * INV_N16, suz = sun.z * INV_N16;

    if (!px) {
      // the plate has not baked yet, or could not be read — a plain ocean, so the
      // disc is never a hole while the imagery is in flight
      for (let i = 0; i < n; i++) {
        const li = lutAt(nx[i] * sux + ny[i] * suy + nz[i] * suz);
        const o = idx[i], s = LSH[li];
        const f = 1 - nz[i] * INV_N16, g = f * f * f * LGL[li];
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

      let a0, b0, a1, b1, w00, w10, w01, w11;
      const ex = fx[i], ey = fy[i];
      if (ex | ey) {
        /* ★ THE WIDE TAP, and it is the same four fetches. See FOOTPRINT in
           buildGeo(): this pixel covers more than one texel of plate, so instead
           of interpolating BETWEEN two adjacent texels it averages four spread to
           the width it is actually responsible for. A box rather than a triangle,
           which is the wrong reconstruction filter to magnify with and the right
           one to MINIFY with — and minifying is the only thing that ever gets
           here, because the excess is zero everywhere the disc is not compressed.
           Equal weights, so nothing has to be normalised. */
        const hx = ex * INV_F16, hy = ey * INV_F16;
        let xa = tx - hx, xb = tx + hx;
        xa -= Math.floor(xa / PLATE_W) * PLATE_W;
        xb -= Math.floor(xb / PLATE_W) * PLATE_W;
        const ya = t - hy < 0 ? 0 : (t - hy > PLATE_H - 1 ? PLATE_H - 1 : t - hy);
        const yb = t + hy < 0 ? 0 : (t + hy > PLATE_H - 1 ? PLATE_H - 1 : t + hy);
        const rA = (ya | 0) * PLATE_W * 4, rB = (yb | 0) * PLATE_W * 4;
        const cA = (xa | 0) * 4, cB = (xb | 0) * 4;
        a0 = rA + cA; b0 = rA + cB; a1 = rB + cA; b1 = rB + cB;
        w00 = w10 = w01 = w11 = 0.25;
      } else {
        const ix = tx | 0, iy = t < 0 ? 0 : (t > PLATE_H - 1 ? PLATE_H - 1 : t | 0);
        const gx = tx - ix, gy = t - iy;
        const ix1 = ix + 1 >= PLATE_W ? 0 : ix + 1;
        const iy1 = iy + 1 >= PLATE_H ? PLATE_H - 1 : iy + 1;
        const r0 = (iy * PLATE_W) * 4, r1 = (iy1 * PLATE_W) * 4;
        a0 = r0 + ix * 4; b0 = r0 + ix1 * 4;
        a1 = r1 + ix * 4; b1 = r1 + ix1 * 4;
        w00 = (1 - gx) * (1 - gy); w10 = gx * (1 - gy);
        w01 = (1 - gx) * gy; w11 = gx * gy;
      }

      /* ★ The sun, per pixel: one dot product against the cached normal and three
         table reads. Everything else about the lighting was resolved once, either
         in buildGeo() (the normal, the fresnel) or in buildLut() (the terminator,
         the twilight, the theme's gain). See the note over GEO. */
      const li = lutAt(nx[i] * sux + ny[i] * suy + nz[i] * suz);
      const o = idx[i], s = LSH[li];
      const fres = 1 - nz[i] * INV_N16;
      const g = fres * fres * fres * LGL[li];
      /* ★ The fourth channel of the plate is not opacity, it is CITY LIGHT —
         js/earth.js bakes the emission there so both come out of one fetch. It is
         sampled with the same four weights, four multiplies. */
      const night = (px[a0 + 3] * w00 + px[b0 + 3] * w10 +
                     px[a1 + 3] * w01 + px[b1 + 3] * w11) * LDU[li];
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
    // the camera moved, so the sun's direction IN CAMERA SPACE did too — even
    // though the sun itself has not. setSun() rotates one; the clock moves the
    // other, twice a minute at most. See the note over `sun`.
    setSun(performance.now());

    // -- the atmosphere ring outside the limb
    ctx.drawImage(layers.air, 0, 0, w, h);

    /* -- the surface: shaded relief, lit by the sun that is actually up.
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
      /* ★ THE SUN IS BACK IN THE SIGNATURE, because it is a real one again. A
         world-fixed terminator creeps 15°/hour whether or not the camera moves, so
         a still frame that ignored it would freeze the planet at the moment MOTION
         was switched off and drift further from the truth all evening.
         At a tenth of a degree that is a repaint every twenty-four seconds — two
         and a half a minute against verify.mjs §8's ceiling of two per SECOND, so
         "MOTION off actually stops the canvases" still holds by two orders of
         magnitude, and the shadow still arrives where the reader expects it. */
      const sig = state.lon.toFixed(2) + '|' + state.lat.toFixed(2) + '|' +
                  state.dim.toFixed(2) + '|' + state.focus + '|' +
                  document.documentElement.dataset.theme + '|' + state.w + 'x' + state.h +
                  '|' + (PLATE.ready ? 1 : 0) + '|' + subsolar(Date.now()).lon.toFixed(1);
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
    canvas.dataset.plate = PLATE.ready ? 'ready' : (PLATE.failed ? 'failed' : 'loading');
    canvas.dataset.plateKind = PLATE.detail || '';

    paint();
    canvas.dataset.raster = String(surf.size);   // set by paint(), so read it after
    /* ★ The sun, published for the same reason and asserting the OPPOSITE thing
       again — see the history over subsolar(). The light is fixed in WORLD space,
       so `sunLat`/`sunLon` are the real subsolar point and must NOT follow the
       camera: they move 0.004° a second and nothing the reader does changes them.
       What does move is `sunLit`, the lit fraction of the visible face, because
       turning the planet carries the reader's face in and out of the day side.
       One pair still, one pair moving — which is how verify.mjs §12d tells a real
       sun from a camera-locked one without being able to see inside the canvas.
       ★ Read AFTER paint() for the same reason `raster` is: the camera-space sun
       is resolved inside it, and publishing a frame-old direction would make the
       lit fraction disagree with the pixels it is supposed to describe. */
    canvas.dataset.sunLat = sun.world.lat.toFixed(2);
    canvas.dataset.sunLon = sun.world.lon.toFixed(2);
    canvas.dataset.sunLock = 'world';
    canvas.dataset.sunLit = litFraction(sun.z).toFixed(3);
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
