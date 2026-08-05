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

/* ★ HOW FAR IN THE READER MAY GO, and why it stops there.
 *
 * Theodor: "if I have my thumb on the globe I could zoom in on it, just to get
 * closer to Sweden and where all the tracks are, and then press them."
 *
 * That is the whole brief and it sets the ceiling by itself. The eight dates sit
 * inside about eight degrees of latitude, which at the hero's radius is 55 px —
 * so at 1x the pins overlap inside one 16 px hit radius and "press them" is not a
 * thing anyone can do reliably. At 4x that spread is 220 px and every circuit is
 * its own target, which is the point at which the feature has done its job.
 *
 * Past 4x the limit stops being the pins and starts being the PLATE: 2 048 texels
 * around the equator is 1 024 across the visible hemisphere, and the raster is
 * capped at the same figure (see RASTER_MAX), so beyond about 2x the disc is
 * magnifying a fixed number of texels however big it gets. 4.2x is where that is
 * still an honest picture of Scandinavia rather than a soft one.
 *
 * ★ THESE ARE DEFAULTS NOW, NOT THE LAW, and §03's atlas overrides both. The
 * ceiling above is the HERO's ceiling and it was derived from the hero's job: eight
 * pins, pressable, behind a page of type. The atlas stage is the tool — it is a box
 * the reader opened on purpose, with the whole catalogue on it — so it runs to
 * ATLAS_ZOOM_MAX, and what stops it going further is no longer the pins but the
 * plate. Past that the surface fades to a flat atlas tint and the vector layer
 * carries the picture; see PLATE_FADE. */
const ZOOM_MIN = 1, ZOOM_MAX = 4.2;

/* ★ THE MAP IS THE SAME EARTH, UNROLLED, AND IT IS NOT A SECOND RENDERER.
 *
 * Theodor: "for the globe itself, make that also a map."
 *
 * The temptation is a separate file, and it is a trap: the sun, the terminator,
 * the twilight ramp and the city lights are two hundred lines of tuned code in
 * buildLut() and the sample loop, and a second copy of them drifts from the first
 * the day after it is written. So `mode` splits this file in exactly three places
 * — the projection, the geometry build, and the chrome around the edge — and
 * everything between them is shared byte for byte. The map is lit by the same real
 * sun as the sphere, at the same instant, BY CONSTRUCTION rather than by agreement.
 *
 * `zoom` means different things either side of that split and both are honest:
 * on the sphere it multiplies the disc's radius; on the map it is how many times
 * the world's width has been divided into the canvas, so zoom 1 is all 360° and
 * zoom 36 is ten degrees. MAP_ZOOM_MAX is 180 — two degrees of longitude, about
 * 150 km at Swedish latitudes, which is closer than any circuit needs. */
const MAP_ZOOM_MIN = 1, MAP_ZOOM_MAX = 180;
/** what §03's atlas stage runs to — exported so the page does not re-guess it */
export const ATLAS_ZOOM_MAX = 40;

/* ★ WHERE THE IMAGERY RUNS OUT, IN TEXELS OF PLATE PER SCREEN PIXEL.
 *
 * 2 048 texels of longitude is 5.7 to the degree, and no amount of zoom invents a
 * sixth. Past this the honest move is not to magnify a photograph — that is the
 * blur — but to stop pretending there is one: the surface cross-fades toward the
 * flat land/sea tint it is already carrying, and the coastline, the graticule and
 * the pins, all of them struck at full resolution, carry the picture instead. The
 * deep view then reads SHARPER than the shallow one, which is the correct outcome
 * and the opposite of what magnifying would give. It is also just the house style:
 * this is an atlas, and an atlas plate at survey scale is line work.
 *
 * ★ THE NUMBERS ARE THE HERO'S, MEASURED, so §00 can never be caught by this.
 * Orthographic compresses toward the limb, so the CENTRE of the disc is the
 * magnified part: at the sub-camera point one device pixel spans
 * `PLATE_W / (2π · r · dpr)` texels, which on the hero disc is 0.64 — a 1.55x
 * magnification, and the sharpest the page has ever been. So the fade may not
 * begin anywhere near there. It starts at 0.33 (3x magnified, where bilinear
 * starts to show) and is complete at 0.14 (7x, where there is nothing left to
 * show), which puts the hero a full octave clear of it at zoom 1 and leaves §00
 * pixel-identical.
 *
 * ★ AND IT NEVER QUITE GOES ALL THE WAY. 0.92 rather than 1, so a trace of the
 * real surface is still under the plate tone and it does not read as a missing
 * texture. The tonal SHAPE is not what this leaves behind — PLATE_RELIEF puts
 * that back deliberately, from the same sample — this is only the last few per
 * cent of the photograph, which stops the flat tones looking printed on. */
const PLATE_FADE_HI = 0.33, PLATE_FADE_LO = 0.14, PLATE_FADE_MAX = 0.92;

/* ★ WHAT IT FADES TO IS TWO TONES, NOT ONE, AND THE FIRST ATTEMPT PROVED WHY.
 *
 * Pulling the sample toward its own luminance was the obvious move and it did not
 * work: desaturating a blurred photograph gives a blurred grey photograph. What
 * makes magnified imagery read as mush is not its colour, it is that every edge in
 * it is four texels wide — so the fix has to REPLACE the picture, not tint it.
 *
 * These are the two facts a survey plate actually needs: this is land, that is
 * sea. The sample decides which by its own blue dominance — the baked plate's
 * ocean is the only thing on it that is decisively blue — and the answer is a flat
 * tone, plus a quarter of the relief's own tonal variation so mountains and shelf
 * still register as shape rather than the whole thing going dead. Struck over the
 * top, the coastline and the graticule are then the only sharp things on screen,
 * which is exactly what an atlas at survey scale looks like.
 *
 * Both themes, because the day side is not an inverted night side anywhere else on
 * this page and is not here either. */
const PLATE_LAND = { night: [56, 50, 40], day: [214, 203, 178] };
const PLATE_SEA = { night: [17, 27, 40], day: [186, 199, 212] };
const PLATE_RELIEF = 0.26;      // how much of the sample's own tone survives

/* Above this wrapper opacity the globe is the SUBJECT; below it, it is a backdrop
   behind the chapters. Two things read it — whether the idle drift runs at all,
   and whether a look-at is flown or simply placed — and they have to agree, or the
   camera can accumulate motion in a state where it is never allowed to spend it.
   See the drift gate in frame() and `settled` in lookAt(). */
const DRIFT_DIM = 0.5;

/* ★ THE PLANET ARRIVES ONCE, RATHER THAN TWICE.
 *
 * Theodor: "make the spawning or the load-in of the globe consistent and higher
 * quality."
 *
 * Part of that was where it lands, which is app.css's problem and is fixed there.
 * This is the other part, and it is a sequencing bug rather than a layout one:
 * js/earth.js bakes the relief plate out of three images that are still decoding
 * when the first frame goes out, so buildSurface() painted a plain unlit sphere —
 * see the `!px` branch — and then, a few hundred milliseconds later, the real
 * Earth replaced it in one frame. Two arrivals, the first of them wrong, and on a
 * slow connection the gap is long enough to look like a bug rather than a load.
 *
 * So nothing is shown until there is something true to show. The disc is
 * composited through `warm`, which stays at 0 until the plate is ready and then
 * eases in over WARM_MS. FALLBACK_MS is the safety catch: a bake that fails
 * outright (a tainted canvas — see loadPlate()) must still give the reader a
 * planet, so the fade starts anyway and what arrives is the honest flat sphere.
 */
const WARM_MS = 420, WARM_FALLBACK_MS = 900;

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
  /* ★ AND THE DEGREES THEMSELVES, FOR THE MAP. The sphere never needs them back —
     that is the whole point of the packed basis — but an equirectangular plate is
     linear in lon/lat, so drawing the same coastline flat means reading the angles
     rather than rotating a vector. Two floats a point against the three already
     here, and it buys the map the identical outline the globe strokes rather than
     a second, subtly different one. */
  const ll = new Float32Array(n * 2);
  let latMin = 90, latMax = -90;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    const lon = pts[i][0] * RAD, lat = pts[i][1] * RAD;
    const cl = Math.cos(lat);
    const a = cl * Math.sin(lon), b = cl * Math.cos(lon), c = Math.sin(lat);
    xyz[i * 3] = a; xyz[i * 3 + 1] = b; xyz[i * 3 + 2] = c;
    ll[i * 2] = pts[i][0]; ll[i * 2 + 1] = pts[i][1];
    if (pts[i][1] < latMin) latMin = pts[i][1];
    if (pts[i][1] > latMax) latMax = pts[i][1];
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
    n, xyz, ll, latMin, latMax,
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
    /* ★ `r0` is the disc the LAYOUT gives us and `r` is the disc actually drawn —
       r0 × zoom. Splitting them this way is what keeps the zoom to a dozen lines:
       every projection, hit test, ring cull and clip downstream already reads
       `state.r`, so all of it follows the reader in without being touched. Only
       the halo layer needs r0, because it is baked once and scaled at blit. */
    w: 0, h: 0, r0: 0, r: 0, cx: 0, cy: 0, dpr: 1,
    zoom: 1, tZoom: 1,   // eased, and what it is easing toward
    gesture: false,      // a finger or a button is down on the disc right now
    /* ★ 'globe' or 'map' — see MAP_ZOOM_MAX. The same Earth, the same sun, the
       same plate; only the projection, the geometry build and the chrome differ. */
    mode: opts.mode === 'map' ? 'map' : 'globe',
    /* the ceiling is a property of the INSTANCE, because the hero and the atlas
       are answering different questions with the same object — see ZOOM_MAX */
    zMax: opts.zoomMax || ZOOM_MAX,
    /* pins carry names on the atlas and do not behind the hero, where there is no
       room and no reason. Deconflicted per frame — see paintLabels(). */
    labels: !!opts.labels,
    /* ★ HOW FAR IN THE ARRIVAL IS — see the note over WARM_MS. 0 until the plate
       has baked, then eased to 1, and the whole canvas is composited through it.
       This is the second half of "make the load-in consistent and higher quality". */
    warm: 0,
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
    state.r0 = (Math.min(state.w, state.h) / 2 - 2) / HALO;
    state.r = state.r0 * state.zoom;
    layers.dirty = true;
    /* a different disc is a different sum — re-try from the top of the ladder */
    cost.rung = 0; cost.over = 0; cost.ms = 0;
  }

  /* ---------------------------------------------- the two projections' scales
   * ★ ONE `zoom` NUMBER, TWO MEANINGS, AND BOTH ARE THE OBVIOUS ONE. See the note
   * over MAP_ZOOM_MAX. On the sphere it multiplies the radius; on the map it is
   * how many times the world's 360° has been divided into the canvas width. Every
   * caller downstream — the pins, the hit test, the ease, the reader's own pinch —
   * reads these two functions rather than the raw number, so nothing else in the
   * file has to know which projection it is standing in. */
  const isMap = () => state.mode === 'map';
  /** pixels per DEGREE on the flat map */
  const mppd = () => state.w * state.zoom / 360;
  const zoomCeiling = () => (isMap() ? MAP_ZOOM_MAX : state.zMax);
  const zoomFloor = () => (isMap() ? MAP_ZOOM_MIN : ZOOM_MIN);

  /** the camera latitude the map may not pan past, so the plate never leaves the box */
  function mapLatClamp() {
    const halfSpan = state.h / 2 / mppd();
    return Math.max(0, 90 - halfSpan);
  }

  /* ★ WHAT IS ACTUALLY ON SCREEN, AND WHY THE WHOLE BLUR WAS HERE.
   *
   * Theodor: "it's still a bit blurry… especially not when you move it around."
   *
   * buildSurface() rastered the ENTIRE disc into an R×R buffer and paint() blitted
   * it to (cx−r, cy−r, 2r, 2r). At 1x that is right and RASTER_MAX is the plate's
   * own texel count, so it is exactly right. Zoomed to 4x it is a disaster: the
   * disc is 3 200 CSS pixels across, three quarters of it is off screen, and the
   * same 1 024 raster is stretched over all of it — every one of the reader's
   * pixels magnified four times out of a buffer sized for a picture a quarter that
   * big. That is the blur, and it is arithmetic rather than taste.
   *
   * So the raster covers the INTERSECTION of the disc with the canvas and nothing
   * else. The window is in disc-normalised units (u right, v up, the limb at ±1)
   * on the sphere and in degrees on the map, and the same pixel budget then buys
   * four times the linear resolution at 4x, for nothing.
   *
   * ★ AT 1x WITH THE DISC INSIDE THE CANVAS THIS RETURNS EXACTLY [−1,1]², WHICH IS
   * WHAT IT ALWAYS WAS. The hero cannot regress: it is the same numbers through the
   * same code. Quantised to a 256th so a sub-pixel drift does not invalidate the
   * geometry cache every frame — see geo.key.
   *
   * ★ IT IS ROUNDED OUTWARD, never to nearest. The window is what the geometry is
   * built for AND what the result is blitted to, so the two can never disagree —
   * but a window rounded inward would leave a hairline of unpainted canvas at the
   * edge of the viewport, which is the one error that would be visible.
   */
  const qOut = (v, up) => (up ? Math.ceil(v * 256) : Math.floor(v * 256)) / 256;

  function viewWindow() {
    if (isMap()) {
      const ppd = mppd();
      const dLon = state.w / 2 / ppd, dLat = state.h / 2 / ppd;
      return { lon0: -dLon, lon1: dLon, lat0: state.lat - dLat, lat1: state.lat + dLat };
    }
    const { cx, cy, r, w, h } = state;
    const u0 = Math.max(-1, qOut((0 - cx) / r, false)), u1 = Math.min(1, qOut((w - cx) / r, true));
    const v0 = Math.max(-1, qOut((cy - h) / r, false)), v1 = Math.min(1, qOut(cy / r, true));
    return { u0, u1, v0, v1 };
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
  const layers = { dirty: true, theme: null, air: null, accent: '', ink: '', mono: '' };

  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(state.w * state.dpr));
    c.height = Math.max(1, Math.round(state.h * state.dpr));
    const g = c.getContext('2d');
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    return { c, g };
  }

  function buildLayers(isDay) {
    /* ★ r0, NOT r. This is the one thing on the canvas that is not re-derived per
       frame — a full-disc radial gradient evaluated per pixel — so it is baked at
       the UNZOOMED radius and blitted back scaled in paint(). The gradient is
       radially symmetric about the centre the zoom scales about, so a scaled blit
       is the same image the rebuild would have produced, for the price of a memcpy
       instead of a million gradient stops per pinch frame. */
    const { cx, cy, r0: r } = state;

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
    // the pins' names are set in the page's own mono face — see paintLabels()
    layers.mono = tok('--font-mono', 'ui-monospace, monospace');
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
  const surf = { c: null, g: null, img: null, gw: 0, gh: 0 };

  /** the window, as a cache key — see buildSurface() */
  const winKey = (w) => (w.u0 !== undefined
    ? w.u0 + ',' + w.u1 + ',' + w.v0 + ',' + w.v1
    : w.lon0.toFixed(4) + ',' + w.lon1.toFixed(4) + ',' + (w.lat1 - w.lat0).toFixed(4));

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

  /* Is the camera being moved right now, by a hand or by an ease it has not
     finished. ★ A ZOOM COUNTS, and it did not before: the window is a function of
     the zoom (see viewWindow()), so an easing pinch invalidates the geometry cache
     every frame exactly the way an easing latitude does. Left out, the first
     second of every pinch rebuilt a full-resolution cache per frame. */
  const isMoving = () => state.gesture ||
    Math.abs(state.tLat - state.lat) > 0.04 ||
    Math.abs(state.tZoom - state.zoom) > 0.002;

  /**
   * How big a buffer to raster the WINDOW into — see viewWindow() for why it is
   * the window and no longer the whole disc.
   *
   * Returns {gw, gh}: the window's own aspect, at device resolution, under
   * whichever cap applies. Both axes are capped by the same figure, so a wide
   * short window is not silently given more pixels than a tall one.
   */
  function surfaceSize(win) {
    /* the window's size on screen, in device pixels — what a 1:1 raster would be */
    const wantW = isMap()
      ? state.w * state.dpr
      : (win.u1 - win.u0) * state.r * state.dpr;
    const wantH = isMap()
      ? state.h * state.dpr
      : (win.v1 - win.v0) * state.r * state.dpr;

    /* Past the hero the disc is at ~14% opacity behind #scrim, and nobody can see
       a texel there — so it rasters at 200px and the per-pixel cost drops by two
       thirds exactly where it is least worth paying. Above that it is the subject,
       unless the camera's latitude is still easing — see RASTER_MOVING. */
    let cap;
    if (state.dim < 0.35) cap = 200;
    else if (isMoving()) {
      /* ★ A DRAG COUNTS AS MOVING, and the existing test cannot see one. It reads
         `tLat - lat`, which is the gap an EASE has left to close — and a drag closes
         that gap itself every frame, by setting both (see turnBy: direct
         manipulation, no lag between the finger and the planet). So a hand-turned
         globe looked stationary to this function, took the full raster, and rebuilt
         the whole geometry cache — an asin and an atan2 a pixel over 800 000 pixels
         — inside every frame of the drag. That is the one place on this canvas where
         a stall is unmissable, because the reader is holding the thing that stalls.

         ★ AND IT IS TWICE WHAT IT WAS, because the buffer it caps is no longer the
         whole planet. viewWindow() cut the rastered area to what is on screen, so
         at any zoom past 1 the same figure now buys several times the resolution it
         used to — a drag on the atlas stage is sharp where a drag on the hero was
         soft, out of the same budget. The ladder still measures the result: a
         machine that cannot hold it walks down and stays down. */
      cap = Math.min(760, Math.round(RASTER_MOVING * 2 * Math.sqrt(state.zoom)));
    } else cap = rasterCeiling();

    const k = Math.min(1, cap / Math.max(1, Math.max(wantW, wantH)));
    return {
      gw: Math.max(16, Math.round(wantW * k)),
      gh: Math.max(16, Math.round(wantH * k)),
    };
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

  function buildGeo(gw, gh, win) {
    const cap = gw * gh;
    if (!geo.idx || geo.idx.length < cap) {
      geo.idx = new Int32Array(cap);
      geo.ty = new Float32Array(cap); geo.xo = new Float32Array(cap);
      geo.nx = new Int16Array(cap); geo.ny = new Int16Array(cap); geo.nz = new Int16Array(cap);
      geo.fx = new Int16Array(cap); geo.fy = new Int16Array(cap);
      geo.al = new Uint8Array(cap);
    }
    if (isMap()) return buildGeoMap(gw, gh, win);

    const { idx, ty, xo, nx, ny, nz, fx, fy, al } = geo;
    const { sLat, cLat } = cam;
    const INV_PI = 1 / Math.PI;
    /* ★ THE STEP IS THE WINDOW'S NOW, NOT THE DISC'S. It was `2 / R` — the disc
       spans 2 in u, so a full-disc raster of R pixels stepped by that. The raster
       covers only what is on screen (see viewWindow()), so the step is the
       window's own, and at zoom 1 with the whole disc visible the window IS
       [−1,1]² and this is `2 / R` again, exactly. */
    const du = (win.u1 - win.u0) / gw, dv = (win.v1 - win.v0) / gh;
    const dr = (du + dv) / 2;                    // for the limb coverage, in pixels
    const texX = PLATE_W / TAU, texY = PLATE_H / Math.PI;

    let k = 0;
    for (let py = 0; py < gh; py++) {
      const v = win.v1 - (py + 0.5) * dv;
      const vv = 1 - v * v;
      /* ★ ONE TEXEL PAST THE LIMB, ON PURPOSE — this row bound and the coverage
         below are the antialiasing. The old loop tested `w² > 0` and skipped
         everything else, which gives the disc a hard edge on the RASTER and then
         scales it up: a stair-stepped limb, plus a dark fringe where the scaler
         blended opaque pixels against transparent black. */
      if (vv <= -2 * dv) continue;
      const span = Math.sqrt(Math.max(0, vv));
      const x0 = Math.max(0, Math.ceil((-span - win.u0) / du - 2));
      const x1 = Math.min(gw - 1, Math.floor((span - win.u0) / du + 1));
      // the parts of the unprojection that do not vary along the row
      const vLat = v * cLat, vDen = -v * sLat;

      for (let pxi = x0; pxi <= x1; pxi++) {
        const u = win.u0 + (pxi + 0.5) * du;
        const w2 = 1 - u * u - v * v;
        // outside the limb the normal is edge-on rather than undefined; clamping
        // w to 0 keeps the unprojection valid right up to the silhouette
        const w = w2 > 0 ? Math.sqrt(w2) : 0;
        /* coverage: how far inside the limb this texel sits, in texels, offset so
           a texel centred exactly ON the limb is half covered. `1 − w²` is `u² +
           v²`, so its root is the radius — no extra work to get it. */
        const cov = (1 - Math.sqrt(1 - w2)) / dr + 0.5;
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

          /* ★ THE TWO STEPS ARE SEPARATE, and at zoom 1 they are the same number.
             The window can be any shape the viewport is, so a pixel is du wide and
             dv tall rather than 2/R square, and each derivative is weighted by the
             step it belongs to. Put du = dv = 2/R back in and this is the
             expression it replaced, term for term. */
          const fxT = texX * Math.hypot(dLonU * du, dLonV * dv);
          const fyT = texY * Math.hypot(dLatU * du, dLatV * dv);
          const sec = 1 / cp;                        // what the prefilter left in x
          ex = Math.sqrt(Math.max(0, fxT * fxT - sec * sec)) / 2;
          ey = Math.sqrt(Math.max(0, fyT * fyT - 1)) / 2;
        }
        /* Under half a texel there is nothing a wider tap could recover, and the
           per-frame branch is written so that a zero here costs one comparison. */
        const exq = ex < 0.5 ? 0 : Math.min(F_MAX, Math.round(ex * F16));
        const eyq = ey < 0.5 ? 0 : Math.min(F_MAX, Math.round(ey * F16));

        idx[k] = (py * gw + pxi) * 4;
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

  /* ================================================ THE SAME EARTH, UNROLLED
   * ★ EVERY ARRAY THIS FILLS IS THE ONE buildGeo() ABOVE FILLS, IN THE SAME UNITS.
   * That is the entire design of the map: the per-frame sample loop, the LUT, the
   * plate fetch, the wide tap, the dither and the city lights never learn that the
   * projection changed, so the map cannot be lit differently from the sphere by
   * accident — there is only one piece of code that lights anything.
   *
   * The normal is written in the SAME camera-space basis setSun() rotates the sun
   * into, so the Lambert dot product downstream is unchanged. A dot product is
   * invariant under rotation, so expressing both in the camera's frame gives the
   * true world answer — and the terminator lands on the map exactly where the
   * sphere puts it, at the same instant, without a second line of solar maths.
   *
   * `xo` holds longitude RELATIVE to the camera and the per-frame loop adds
   * `lonTex`, exactly as on the sphere — so panning east and west costs nothing
   * and never rebuilds this. Panning north and south does, because latitude is in
   * both `ty` and the normal, which is the same bargain the sphere already makes
   * with its look-ats.
   * ====================================================================== */
  function buildGeoMap(gw, gh, win) {
    const { idx, ty, xo, nx, ny, nz, fx, fy, al } = geo;
    const { sLat, cLat } = cam;
    const dLon = (win.lon1 - win.lon0) / gw, dLat = (win.lat1 - win.lat0) / gh;
    const texX = PLATE_W / TAU, texY = PLATE_H / Math.PI;
    /* constant over the whole plate: an equirectangular pixel is the same number
       of texels wide and tall wherever it lands. Only `sec` below varies. */
    const fxT = texX * dLon * RAD, fyT = texY * dLat * RAD;
    const eyq0 = (() => {
      const ey = Math.sqrt(Math.max(0, fyT * fyT - 1)) / 2;
      return ey < 0.5 ? 0 : Math.min(F_MAX, Math.round(ey * F16));
    })();

    let k = 0;
    for (let py = 0; py < gh; py++) {
      const lat = win.lat1 - (py + 0.5) * dLat;
      if (lat > 90 || lat < -90) continue;          // past the pole there is no Earth
      const p = lat * RAD;
      const cp = Math.cos(p), sp = Math.sin(p);
      const row = (0.5 - lat / 180) * PLATE_H;
      /* the x footprint is the plate's own polar prefilter subtracted in
         quadrature, the same term and for the same reason as on the sphere */
      const sec = 1 / Math.max(1e-4, Math.abs(cp));
      const ex = Math.sqrt(Math.max(0, fxT * fxT - sec * sec)) / 2;
      const exq = ex < 0.5 ? 0 : Math.min(F_MAX, Math.round(ex * F16));
      const rowOff = py * gw * 4;

      for (let pxi = 0; pxi < gw; pxi++) {
        const dlon = win.lon0 + (pxi + 0.5) * dLon;
        const dl = dlon * RAD;
        const a = cp * Math.sin(dl), P = cp * Math.cos(dl);

        idx[k] = rowOff + pxi * 4;
        ty[k] = row;
        xo[k] = (dlon / 360 + 0.5) * PLATE_W;
        nx[k] = a * N16;
        ny[k] = (cLat * sp - sLat * P) * N16;
        nz[k] = (sLat * sp + cLat * P) * N16;
        fx[k] = exq; fy[k] = eyq0;
        al[k] = 255;                                // a plate has no limb to feather
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

  function buildLut(isDay, forMap) {
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
         from orbit. With a real sun that band now sweeps Europe every night.
         ★ AND THEY STOP AT THE TERMINATOR NOW. The upper bound was 0.30, which is
         seventeen degrees of arc PAST the terminator and well into daylight — so
         every lit city was also glowing on ground the sun was standing over, which
         is most of what "the lighting on the dark sides looks weird" is. 0.12 puts
         the top of the ramp inside the twilight band the terminator itself is
         drawn over, where a city coming up genuinely is what you would see. */
      const dusk = L >= 0.12 ? 0 : (L <= -0.10 ? 1 : (0.12 - L) / 0.22);

      /* ★ THE NIGHT SIDE IS NOT ONE FLAT NUMBER ANY MORE.
         `ambient` was a constant, so every unlit pixel got exactly the same
         light — and an unlit OCEAN, which has no hillshade of its own to give it
         away, came out as a dead slab with a hard edge at the limb. The sphere
         stopped being a sphere on the half of it that was dark, which is a fair
         part of "the lighting on the dark sides of the Earth can look weird".
         `L` on the night side already runs −1 at the antisolar point to 0 at the
         terminator, so a gentle ramp along it is free: the deep night is a little
         darker than it was and the hour or two either side of the terminator a
         little brighter, which is both what an atmosphere actually does with
         scattered light and what gives the dark half its roundness back. */
      const dark = 0.74 + 0.26 * Math.min(1, Math.max(0, L + 1));
      lut.sh[i] = ambient * dark + (gain - ambient * dark) * lit;
      /* Atmosphere: the fresnel toward the limb is per-pixel and stays there; what
         belongs to L is how LIT that part of the limb is, so the bright crescent
         sits on the day edge wherever the sun has actually put it.
         ★ ZERO ON THE MAP. The fresnel is a function of the surface turning away
         from the reader, which on a sphere is the limb and on a flat plate is
         nothing at all — left on, it painted a blue haze down the two meridians
         ninety degrees from the camera, in the middle of open map. Killed here
         rather than per pixel, so the map pays nothing for not having a limb. */
      lut.gl[i] = forMap ? 0 : 0.85 * lit;
      lut.du[i] = dusk * dusk * (2 - dusk) * lampGain * 0.0032;
    }
    lut.theme = (isDay ? 'day' : 'night') + (forMap ? '|map' : '');
  }

  function buildSurface(isDay, win) {
    const { gw, gh } = surfaceSize(win);
    if (surf.gw !== gw || surf.gh !== gh) {
      surf.c = document.createElement('canvas');
      surf.c.width = gw; surf.c.height = gh;
      surf.g = surf.c.getContext('2d');
      surf.img = surf.g.createImageData(gw, gh);
      surf.gw = gw; surf.gh = gh;
      geo.key = '';                       // a different raster is different geometry
    }
    /* ★ Quantised, and the THEME IS NO LONGER IN THE KEY — the shading moved to
       LUT, so a day/night switch now costs a 1 024-entry table rather than a
       million unprojections. What invalidates it is the camera's LATITUDE, the
       raster size and the window; at the hero all three are fixed and only the
       drift runs, so it is built once for the life of the page with a world-fixed
       sun turning over the top of it.

       ★ THE QUANTUM IS A PIXEL, NOT A TENTH OF A DEGREE, and that is a bug fix
       rather than a tuning. `state.lat.toFixed(1)` is a tenth of a degree of
       GROUND, which at the hero is three quarters of a screen pixel and at the
       atlas stage's 40x is thirty of them — so a cache that was invisible at zoom
       1 would have left the shaded relief lying up to thirty pixels away from the
       coastline struck over the top of it. The tolerance that matters is on
       screen, so that is where it is expressed, and it tightens by itself as the
       reader leans in. */
    const latQ = isMap()
      ? Math.max(1e-5, 0.3 / mppd())
      : Math.max(1e-5, 0.1 / state.zoom);
    const key = gw + 'x' + gh + '|' + (Math.round(state.lat / latQ) * latQ).toFixed(5) +
                '|' + winKey(win);
    if (geo.key !== key) { buildGeo(gw, gh, win); geo.key = key; }
    const lutKey = (isDay ? 'day' : 'night') + (isMap() ? '|map' : '');
    if (lut.theme !== lutKey) buildLut(isDay, isMap());

    /* ★ The clock starts AFTER the geometry build, deliberately. buildGeo() is
       amortised — at the hero it runs once for the life of the page — so charging
       it to the frame budget would walk the ladder down over a cost that is not
       paid per frame. What is timed is exactly what repeats: the sample loop and
       the putImageData. */
    const t0 = performance.now();

    const out = surf.img.data;
    out.fill(0);

    /* ★ HOW MUCH PLATE ONE SCREEN PIXEL IS GETTING, in texels, where the picture
       is most magnified. On the sphere that is the SUB-CAMERA POINT and not the
       average: orthographic compresses toward the limb, so the centre of the disc
       is the part being blown up and the limb is the part being squeezed. On the
       map it is uniform, because a plate carrée is uniform. Everything that has to
       know how far past its source the imagery has been pushed — the city lights
       above, the fade below — reads this one number. */
    const texPerPx = isMap()
      ? PLATE_W / (state.zoom * state.w * state.dpr)
      : PLATE_W / (TAU * state.r * state.dpr);

    const px = PLATE.px;
    const { n, idx, ty, xo, nx, ny, nz, fx, fy, al } = geo;
    const LSH = lut.sh, LGL = lut.gl, LDU = lut.du;
    // the camera's longitude, in texels — the one thing that changes per frame
    const lonTex = state.lon / 360 * PLATE_W;
    /* ★ The 1/30 000 that turns the packed Int16 normal back into a unit vector is
       folded into the sun here, once, rather than into three multiplies a pixel. */
    const sux = sun.x * INV_N16, suy = sun.y * INV_N16, suz = sun.z * INV_N16;
    /* ★ THE CITY LIGHTS DIM AS THE READER LEANS IN, and that is not a fudge — it
       is the only honest answer available to a glow that is baked at a fixed size
       in TEXELS. Magnify the plate and every light magnifies with it, so a night
       side that reads as points at 1x reads as fog at 4x, over exactly the ground
       the reader zoomed in to look at. Their apparent area goes as zoom², so
       holding the total light constant would want 1/zoom² and would extinguish
       them; ^-0.75 keeps them plainly lit while handing the terrain back.
       Folded into the three channel constants, so it costs nothing per pixel.

       ★ IT IS KEYED TO THE MAGNIFICATION NOW, NOT TO `zoom`, AND THAT IS A BUG THE
       WINDOW RASTER WOULD OTHERWISE HAVE INTRODUCED. What has to be compensated is
       how far the plate is being blown up, and `zoom` was only ever a proxy for
       that — a good one while the raster covered the whole disc and the two moved
       together. They no longer do: the map's `zoom` counts divisions of the world,
       the sphere's multiplies a radius, and the same number means a different
       magnification in each. `mag` is measured from the plate instead, so one
       expression is right in both projections and stays right if either scale is
       ever retuned. */
    const mag = Math.max(1, PLATE_FADE_HI / Math.max(1e-6, texPerPx));
    const lampZ = Math.pow(mag, -0.75);
    const nR = 255 * lampZ, nG = 202 * lampZ, nB = 128 * lampZ;

    /* ★ PAST THE PLATE'S OWN DETAIL, STOP PRETENDING THERE IS A PHOTOGRAPH.
       See PLATE_FADE_HI. Zero at the hero and for the whole of §00 — the branch
       below is not taken at all there — and it comes up only where the imagery is
       genuinely being invented, handing the picture to the coastline, the
       graticule and the pins, all of which are struck at full resolution. */
    const fadeK = texPerPx >= PLATE_FADE_HI ? 0 : PLATE_FADE_MAX *
      Math.min(1, (PLATE_FADE_HI - texPerPx) / (PLATE_FADE_HI - PLATE_FADE_LO));
    const landT = PLATE_LAND[isDay ? 'day' : 'night'];
    const seaT = PLATE_SEA[isDay ? 'day' : 'night'];

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

      let sr = px[a0] * w00 + px[b0] * w10 + px[a1] * w01 + px[b1] * w11;
      let sg = px[a0 + 1] * w00 + px[b0 + 1] * w10 + px[a1 + 1] * w01 + px[b1 + 1] * w11;
      let sb = px[a0 + 2] * w00 + px[b0 + 2] * w10 + px[a1 + 2] * w01 + px[b1 + 2] * w11;
      /* ★ ONE PREDICTABLE BRANCH, AND AT THE HERO IT IS NEVER TAKEN. See fadeK.
         Past the plate's own detail the land cover is no longer information, it is
         four texels smeared over a hundred pixels — so it is pulled toward its own
         luminance and the tonal shape of the relief is what survives. The picture
         then comes from the line work over the top, which has no resolution limit
         at all, and the deep view reads sharper than the shallow one. */
      if (fadeK !== 0) {
        /* land or sea, off the sample's own blue dominance — the baked plate's
           ocean is the one thing on it that is decisively blue, which is the same
           property js/earth.js's city-light extraction turns on */
        const t = sb > sr * 1.12 ? seaT : landT;
        const L = (0.30 * sr + 0.59 * sg + 0.11 * sb - 116) * PLATE_RELIEF;
        sr += (t[0] + L - sr) * fadeK;
        sg += (t[1] + L - sg) * fadeK;
        sb += (t[2] + L - sb) * fadeK;
      }

      out[o] = sr * s + 120 * g + night * nR + d;
      out[o + 1] = sg * s + 172 * g + night * nG + d;
      out[o + 2] = sb * s + 214 * g + night * nB + d;
      out[o + 3] = al[i];
    }

    surf.g.putImageData(surf.img, 0, 0);
    chargeSurface(performance.now() - t0);
    return surf.c;
  }

  /* ----------------------------------------------------- the projection */
  /* General form, for the handful of pins. Returns null on the far side. */
  function project(lat, lon) {
    if (isMap()) {
      const ppd = mppd();
      const dl = angleDelta(state.lon, lon);
      return {
        x: state.cx + dl * ppd,
        y: state.cy - (lat - state.lat) * ppd,
        /* the flat plate has no far side, so nothing is ever behind anything. `z`
           is what the pin loop fades against, and 1 means "fully facing you" —
           which on a map every place on it is. */
        z: 1,
      };
    }
    const p = lat * RAD, l = lon * RAD;
    const cl = Math.cos(p);
    return projectVec(cl * Math.sin(l), cl * Math.cos(l), Math.sin(p));
  }

  /* The other way: a canvas point back to a place on the sphere, or null if the
   * point missed the disc. Exactly the unprojection buildGeo() runs per pixel —
   * see the maths over THE SURFACE PASS — evaluated once for a fingertip.
   * setCam() first; the api wrapper does it. */
  function unproject(x, y) {
    if (isMap()) {
      const ppd = mppd();
      const lat = state.lat - (y - state.cy) / ppd;
      if (lat > 90 || lat < -90) return null;      // above the pole is off the plate
      const lon = state.lon + (x - state.cx) / ppd;
      return { lat, lon: ((lon % 360) + 540) % 360 - 180 };
    }
    const u = (x - state.cx) / state.r, v = -(y - state.cy) / state.r;
    const w2 = 1 - u * u - v * v;
    if (w2 <= 0) return null;                        // outside the limb: empty space
    const w = Math.sqrt(w2);
    const lat = Math.asin(Math.max(-1, Math.min(1, w * cam.sLat + v * cam.cLat))) / RAD;
    const lon = state.lon + Math.atan2(u, w * cam.cLat - v * cam.sLat) / RAD;
    return { lat, lon: ((lon + 540) % 360) - 180 };
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
    if (isMap()) return ringIntoMap(strokePath, ring, step);
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

  /* ★ THE SAME COASTLINE, FLAT — AND THE SEAM IS THE WHOLE OF THE WORK.
   *
   * On the sphere a ring that runs off one edge of the map simply carries on round
   * the back, which is why the packed unit vectors never had to think about it. On
   * a plate the ±180° meridian is a real edge, and a ring crossing it has two
   * consecutive points a whole world apart in x — joined naively, Eurasia grows a
   * horizontal bar straight across the map. This is the same class of bug
   * js/earth.js's land mask hit when it filled the plate as a rectangle, and it
   * has the same shape of answer: unwrap relative to the camera, and break the run
   * wherever the unwrapped step is more than half a world.
   *
   * There is no fill path here. The sphere fills nothing either — the plate draws
   * the land and only the stroke remains (see the star in paint()) — so the map
   * inherits a decision rather than making a different one.
   */
  function ringIntoMap(strokePath, ring, step) {
    const { ll, n } = ring;
    const { cx, cy } = state;
    const ppd = mppd();
    const lon0 = state.lon, lat0 = state.lat;
    /* one screen's worth either side is all that can be drawn; anything past it is
       clipped by the canvas anyway and costs a lineTo to find that out */
    const halfW = state.w / 2 + 40, halfH = state.h / 2 + 40;
    let open = false, prevX = 0;
    for (let i = 0; i < n; i += step) {
      const dl = angleDelta(lon0, ll[i * 2]);
      const x = cx + dl * ppd;
      const y = cy - (ll[i * 2 + 1] - lat0) * ppd;
      /* a jump of more than half the world in one step is the seam, not a coastline */
      if (open && Math.abs(x - prevX) > state.w * 0.5 + 180 * ppd * 0.5) open = false;
      prevX = x;
      if (Math.abs(x - cx) > halfW || Math.abs(y - cy) > halfH) { open = false; continue; }
      if (!open) { strokePath.moveTo(x, y); open = true; } else strokePath.lineTo(x, y);
    }
  }

  /** true when the ring is worth drawing at all */
  function ringVisible(ring, r) {
    if (isMap()) {
      /* Latitude only, and deliberately: longitude wraps, so a lon-extent test has
         to reason about the seam to be correct and would reject real coastline the
         first time it got that wrong. A latitude band is unambiguous, it is the
         axis a zoomed map is actually narrow in, and the size test below still
         throws away every island too small to register. */
      const ppd = mppd();
      const halfLat = state.h / 2 / ppd + 2;
      if (ring.latMin > state.lat + halfLat || ring.latMax < state.lat - halfLat) return false;
      return 2 * ring.span * (180 / Math.PI) * ppd >= 5;
    }
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

  /** how far past the plate's own detail we are, 0..1 — see PLATE_FADE_HI */
  function plateGone() {
    const t = isMap()
      ? PLATE_W / (state.zoom * state.w * state.dpr)
      : PLATE_W / (TAU * state.r * state.dpr);
    if (t >= PLATE_FADE_HI) return 0;
    return Math.min(1, (PLATE_FADE_HI - t) / (PLATE_FADE_HI - PLATE_FADE_LO));
  }

  /* ============================================== THE GRID, AT WHATEVER SCALE
   * ★ IT USED TO BE A CONSTANT 20° AND THAT IS ONLY RIGHT AT ONE ZOOM.
   *
   * The packed GRATICULE is built once at module load at 20°, which is exactly
   * what a whole planet wants and is nothing at all once the reader is inside
   * Sweden: at the atlas stage's deeper zooms not one of its lines is on screen,
   * so the survey grid — the thing that says how far apart two circuits are —
   * simply vanished at the moment it started to mean something.
   *
   * So the step is chosen from what is actually visible, off a 1-2-5 ladder, aimed
   * at six or so lines across the box. It is drawn through project(), which means
   * one implementation covers both projections and the sphere's far side falls out
   * of project() returning null. The 20° rings are still used at world scale,
   * where they are already packed and already right.
   * ====================================================================== */
  const GRAT_STEPS = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02];

  function paintGraticule(rEff, isDay, map) {
    /* degrees across the shorter axis of the box */
    const spanDeg = Math.min(state.w, state.h) / (rEff * RAD);
    let step = 20;
    for (const s of GRAT_STEPS) { if (spanDeg / s > 7) break; step = s; }

    const g = new Path2D();
    if (step === 20 && !map) {
      // the packed rings, unchanged — no allocation, and the cull is a dot product
      const gstep = rEff > 300 ? 1 : 2;
      for (const ring of GRATICULE) {
        if (!ringVisible(ring, rEff)) continue;
        ringInto(null, g, ring, gstep);
      }
    } else {
      const c = viewWindow();
      const lat0 = map ? c.lat0 : state.lat - spanDeg, lat1 = map ? c.lat1 : state.lat + spanDeg;
      const lon0 = map ? state.lon + c.lon0 : state.lon - spanDeg;
      const lon1 = map ? state.lon + c.lon1 : state.lon + spanDeg;
      const snap = (v) => Math.ceil(v / step) * step;
      const fine = step / 6;
      // parallels
      for (let la = snap(Math.max(-89.9, lat0)); la <= Math.min(89.9, lat1); la += step) {
        let open = false;
        for (let lo = lon0; lo <= lon1 + fine; lo += fine) {
          const p = project(la, lo);
          if (!p) { open = false; continue; }
          if (!open) { g.moveTo(p.x, p.y); open = true; } else g.lineTo(p.x, p.y);
        }
      }
      // meridians
      for (let lo = snap(lon0); lo <= lon1; lo += step) {
        let open = false;
        for (let la = Math.max(-89.9, lat0); la <= Math.min(89.9, lat1) + fine; la += fine) {
          const p = project(la, lo);
          if (!p) { open = false; continue; }
          if (!open) { g.moveTo(p.x, p.y); open = true; } else g.lineTo(p.x, p.y);
        }
      }
    }
    ctx.strokeStyle = isDay ? 'rgba(20,20,14,.13)' : 'rgba(236,229,217,.075)';
    ctx.lineWidth = 0.6;
    ctx.stroke(g);
    canvas.dataset.grid = String(step);
  }

  /* ==================================================== NAMES ON THE PINS
   * ★ ONLY WHERE THERE IS ROOM, AND THE ORDER IS THE POINT.
   *
   * A worldwide pin set is a label set, and a label set with nothing arbitrating
   * it is a smear. The rule here is one greedy pass in PRIORITY order — a booked
   * date outranks a competition circuit, which outranks a reference pin — so when
   * two names collide the one that loses is always the less important of the two,
   * at every zoom, rather than whichever happened to be later in the array.
   * Boxes are compared against those already placed, so the cost is quadratic in
   * what is ON SCREEN and labelled, which is a few dozen at the very most.
   *
   * Nothing is labelled at all until the pins have actually separated: below this
   * there is not a name on Earth that would land beside its own dot.
   *
   * ★ TWO THRESHOLDS, BECAUSE `zoom` MEANS TWO THINGS. On the sphere 2.2 is a
   * little over twice the disc, which is where the eight dates stop overlapping.
   * The map's number counts divisions of the world, so the same 2.2 would be 160°
   * of longitude across the box — a hemisphere, labelled. 8 is 45°, which is about
   * where the Nordics stop being one smudge.
   */
  const LABEL_FROM_GLOBE = 2.2, LABEL_FROM_MAP = 8;

  function paintLabels(isDay, rEff) {
    if (!state.labels) return;
    if (state.zoom < (isMap() ? LABEL_FROM_MAP : LABEL_FROM_GLOBE)) return;
    const rows = [];
    for (const pin of state.pins) {
      if (!pin.label) continue;
      const p = project(pin.lat, pin.lon);
      if (!p || p.z <= 0.06) continue;
      if (p.x < -60 || p.x > state.w + 60 || p.y < -30 || p.y > state.h + 30) continue;
      rows.push({ pin, p, rank: pin.event ? 0 : (pin.ranked ? 1 : 2) });
    }
    rows.sort((a, b) => a.rank - b.rank);

    ctx.font = '600 10px ' + (layers.mono || 'ui-monospace, monospace');
    ctx.textBaseline = 'middle';
    const placed = [];
    for (const row of rows) {
      const text = row.pin.label;
      const tw = ctx.measureText(text).width;
      const x = row.p.x + 8, y = row.p.y;
      const box = { x0: x - 2, y0: y - 7, x1: x + tw + 3, y1: y + 7 };
      let clash = false;
      for (const b of placed) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { clash = true; break; }
      }
      if (clash) continue;
      placed.push(box);
      /* struck twice: the page colour under the type first, so a name over a lit
         continent is as readable as one over open sea */
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = isDay ? 'rgba(248,245,238,.85)' : 'rgba(7,8,10,.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = row.pin.event ? (row.pin.color || layers.accent)
                                    : (isDay ? 'rgba(24,22,16,.78)' : 'rgba(236,229,217,.72)');
      ctx.fillText(text, x, y);
    }
    canvas.dataset.labels = String(placed.length);
  }

  /* ------------------------------------------------------------ painting */
  function paint() {
    const { cx, cy, r, w, h } = state;
    ctx.clearRect(0, 0, w, h);
    if (!isMap() && r <= 4) return;

    const isDay = document.documentElement.dataset.theme === 'day';
    if (layers.dirty || layers.theme !== (isDay ? 'day' : 'night')) buildLayers(isDay);
    const accent = layers.accent;

    setCam();
    // the camera moved, so the sun's direction IN CAMERA SPACE did too — even
    // though the sun itself has not. setSun() rotates one; the clock moves the
    // other, twice a minute at most. See the note over `sun`.
    setSun(performance.now());

    const win = viewWindow();
    const map = isMap();

    /* -- the atmosphere ring outside the limb, scaled about the centre the zoom
     *    scales about — see buildLayers(). Skipped outright once its inner edge
     *    has left the canvas: past about 1.5x there is no ring on screen to draw,
     *    and a 4x upscale blit of a full-viewport image every frame is not free.
     *    A flat plate has no limb for it to sit outside of, so the map has none. */
    const zoomed = state.zoom;
    if (!map && state.r0 * zoomed * 0.965 < Math.hypot(w, h) / 2) {
      if (zoomed === 1) ctx.drawImage(layers.air, 0, 0, w, h);
      else ctx.drawImage(layers.air, cx - cx * zoomed, cy - cy * zoomed, w * zoomed, h * zoomed);
    }

    /* -- the surface: shaded relief, lit by the sun that is actually up.
     *    Rastered small (see RASTER_MAX) and scaled up here, which is the one
     *    place smoothing is wanted — the alternative is visible raster texels.
     *
     * ★ IT IS DRAWN OUTSIDE THE CLIP, and that is the second half of the limb
     * fix. Canvas `clip()` is not antialiased in Chrome: clipping to an arc
     * quantises the silhouette to whole device pixels, so the sub-texel coverage
     * alpha buildSurface() now writes was being thrown away at exactly the edge
     * it was computed for. The surface carries its own feathered edge, so it
     * needs no clip; the vector work below still does, and gets one.
     *
     * ★ AND IT IS BLITTED TO THE WINDOW IT WAS BUILT FOR, not to the whole disc.
     * The two are the same rectangle at zoom 1 — see viewWindow(), which rounds
     * outward precisely so this can never leave a hairline unpainted. */
    const surface = buildSurface(isDay, win);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (map) {
      ctx.drawImage(surface, 0, 0, w, h);
    } else {
      ctx.drawImage(surface,
        cx + r * win.u0, cy - r * win.v1,
        r * (win.u1 - win.u0), r * (win.v1 - win.v0));
    }

    ctx.save();
    if (map) { ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); }
    else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip(); }

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
    /* ★ ONE SCALE FOR BOTH PROJECTIONS. Every heuristic below — how far to
       decimate a ring, how fine to draw the grid, how big a pin is — is really
       asking "how many pixels is a radian of ground here", and on the sphere that
       is `r` by definition. The map's answer is its own, and expressing it this way
       means not one of those thresholds had to be retuned or duplicated. */
    const rEff = map ? mppd() * (180 / Math.PI) : r;

    const base = rEff > 150 ? 1 : 2;
    const outline = new Path2D();
    for (const ring of LAND_RINGS) {
      if (!ringVisible(ring, rEff)) continue;
      ringInto(null, outline, ring, Math.min(base, Math.max(1, Math.floor(ring.n / 6))));
    }
    /* ★ THE LINE WORK EARNS ITS KEEP AS THE IMAGERY GIVES UP. Deep in, the plate
       has been faded back to a tonal ground (see fadeK) precisely so this can carry
       the picture — so it is drawn a little firmer there rather than staying at the
       weight it needs when it is a hairline over a photograph. */
    const ink = Math.min(1, 0.30 + 0.34 * plateGone());
    ctx.strokeStyle = isDay ? `rgba(24,22,16,${ink})` : `rgba(226,236,244,${(ink * 0.72).toFixed(3)})`;
    ctx.lineWidth = 0.7;
    ctx.stroke(outline);

    paintGraticule(rEff, isDay, map);

    ctx.restore();

    // -- the limb itself, struck once, outside the clip so it is not half-cut.
    //    A plate has no silhouette, so the map draws none.
    if (!map) {
      ctx.strokeStyle = isDay ? 'rgba(30,40,50,.35)' : 'rgba(150,200,230,.22)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    }

    // -- pins ------------------------------------------------------------
    const t = performance.now() / 1000;
    for (const pin of state.pins) {
      const p = project(pin.lat, pin.lon);
      if (!p) continue;
      /* ★ OFF THE BOX IS OFF THE BOX. On the sphere a pin on the far side is
         already `null`, so this never mattered; on the map every pin on Earth
         projects to a finite point and several hundred of them would be stroked
         off-canvas every frame for nothing. Cheap, and it is what lets the pin set
         grow to a worldwide one without the frame budget noticing. */
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
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

    paintLabels(isDay, rEff);

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

    /* ★ THE ARRIVAL, APPLIED TO THE WHOLE FRAME AT ONCE AND LAST — see WARM_MS.
       Composited rather than set as a globalAlpha, because the pin pass runs its
       own alpha per pin and would overwrite one. `destination-out` scales every
       pixel's alpha uniformly, which is exactly a fade, and it is one fill for the
       third of a second the fade lasts and nothing at all afterwards. */
    if (state.warm < 1) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${(1 - state.warm).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* --------------------------------------------------------------- loop */
  let last = performance.now();
  let lastPaint = -1e9;
  let raf = 0;
  const born = performance.now();     // when this globe was made — see WARM_MS
  let warmFrom = -1;                  // when its fade started, or -1 for not yet
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
    /* ★ FLOORED AT ZERO, AND THAT IS A REAL BUG RATHER THAN A BELT AND BRACES.
     *
     * A requestAnimationFrame callback is handed the time the FRAME began, which
     * can be earlier than the `performance.now()` read when this globe was
     * constructed — the constructor runs inside a frame that had already started.
     * The hero never showed it because it is built at boot, before the first frame
     * exists; §03's atlas is built from a click handler, so its very first `now`
     * was reliably 18ms in the past.
     *
     * A negative dt is harmless in the eases, which multiply a zero difference by
     * it. It is not harmless in the MAX_TURN clamp below: `cap` goes negative, the
     * test `mag > cap` passes for a camera that is not moving at all, and the scale
     * factor is `cap / 0` — which is −Infinity, and −Infinity times the −0 it is
     * scaling is NaN. Both angles were NaN from the second frame onward, and every
     * number downstream of the camera went with them: no surface, no pins, no sun.
     * Silent, total, and one frame after construction. */
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (!state.running) return;

    /* ★ THE ARRIVAL — see WARM_MS. Advanced before every early return below, and
       driven off the CLOCK rather than off dt, so a tab that was backgrounded
       during the bake comes back with the planet already there rather than with a
       fade waiting to be played. `warmFrom` is set once, by whichever of the two
       conditions lands first: the plate baking, or the fallback expiring. */
    if (state.warm < 1) {
      if (warmFrom < 0 && (PLATE.ready || PLATE.failed || now - born > WARM_FALLBACK_MS)) {
        warmFrom = now;
      }
      state.warm = warmFrom < 0 ? 0 : Math.min(1, (now - warmFrom) / WARM_MS);
      /* it is a fade, so every frame of it is a different picture — take them all
         rather than letting the still-frame signature below decide there is
         nothing new to draw */
      lastPaint = -1e9; stillSig = '';
    }

    /* ★ THE ZOOM EASES OUTSIDE THE MOTION GATE, ON PURPOSE. Everything else in
       here is decoration the MOTION pill is entitled to switch off — an idle
       drift, a flown look-at. A zoom is not: it is the reader's own hand, and a
       control that stops responding because animation is off is a broken control,
       not a still one. With motion off it snaps instead of easing, which is the
       same answer the pill gives everywhere else on the page. */
    if (state.zoom !== state.tZoom) {
      if (state.motion) {
        const kz = 1 - Math.pow(0.0006, dt);
        state.zoom += (state.tZoom - state.zoom) * kz;
        if (Math.abs(state.tZoom - state.zoom) < 0.002) state.zoom = state.tZoom;
      } else state.zoom = state.tZoom;
      state.r = state.r0 * state.zoom;
    }

    /* ★ THE MAP MAY NOT PAN OFF THE TOP OF THE WORLD. On the sphere the poles are
       just places and ±85° is a comfort limit; on a plate there is nothing above
       90° at all, so the camera is held far enough in that the box stays full of
       Earth. Applied to both the camera and its target, because a zoom out widens
       the box and can leave a perfectly legal latitude suddenly illegal. */
    if (isMap()) {
      const lim = mapLatClamp();
      state.lat = Math.max(-lim, Math.min(lim, state.lat));
      state.tLat = Math.max(-lim, Math.min(lim, state.tLat));
    }

    if (state.motion) {
      const k = 1 - Math.pow(0.0016, dt);            // frame-rate independent ease
      let dLon = angleDelta(state.lon, state.tLon) * k;
      let dLat = (state.tLat - state.lat) * k;

      // ★ clamp the turn rate — see MAX_TURN. Scale both axes by the same factor
      // so a capped turn follows the same arc, just slower, instead of sliding
      // along one axis first and bending toward the target at the end.
      /* `mag > 0` as well as `mag > cap`: a camera sitting exactly on its target
         has nothing to scale, and dividing by its zero is how the negative dt
         above turned a still globe into NaN. Cheap, and it is the second half of
         that fix — either one alone leaves the other reachable. */
      const mag = Math.hypot(dLon, dLat), cap = MAX_TURN * dt;
      if (mag > cap && mag > 0) { const s = cap / mag; dLon *= s; dLat *= s; }

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
                  '|' + (PLATE.ready ? 1 : 0) + '|' + subsolar(Date.now()).lon.toFixed(1) +
                  /* the reader's own zoom, so a pinch with MOTION off still draws */
                  '|' + state.zoom.toFixed(3) + '|' + state.mode;
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
    /* the reader's own view, published for the same reason the camera is: it is
       the only handle a test has on a gesture that happens inside a canvas */
    canvas.dataset.zoom = state.zoom.toFixed(2);
    canvas.dataset.plate = PLATE.ready ? 'ready' : (PLATE.failed ? 'failed' : 'loading');
    canvas.dataset.plateKind = PLATE.detail || '';
    /* published so "it arrives once, and only with a real surface" is a claim a
       test can make about a canvas it cannot see inside — see WARM_MS */
    canvas.dataset.warm = state.warm.toFixed(3);

    paint();
    // set by paint(), so read it after. Two numbers now, because the raster is the
    // WINDOW's shape rather than a square disc — see viewWindow().
    canvas.dataset.raster = surf.gw + 'x' + surf.gh;
    canvas.dataset.mode = state.mode;
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
    /**
     * The whole plotted set. Rows may carry, beyond {id, lat, lon}:
     *   event   a booked date — filled, coloured, allowed to pulse
     *   ranked  a circuit with real geometry behind it, so pressing it opens a panel
     *   label   a name to draw beside it once the pins have separated
     *   color   an accent, for `event` rows
     * Nothing here is per-frame work, so the set may be as large as the atlas
     * wants; paint() culls to the box and paintLabels() deconflicts what is left.
     */
    setPins(pins, home) {
      state.pins = pins;
      state.home = home || null;
      canvas.dataset.pins = String(pins.length);
    },
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
    setDim(v) {
      state.dim = v;
      /* ★ LEAVING THE HERO PUTS THE ZOOM BACK. Below DRIFT_DIM the disc is a
         backdrop at 14% behind #scrim and the pointer is off it (see the
         `globe-hot` rule in app.css), so a reader who zoomed in and scrolled away
         would have no way to undo it and nothing to undo it FOR — just a fragment
         of sphere the size of the viewport sitting behind the catalogue. It eases
         out rather than snapping, because they may only have scrolled a little. */
      if (v < DRIFT_DIM && state.tZoom !== 1) { state.tZoom = 1; api.onZoom?.(1); }
    },

    /** set by the page — called whenever the TARGET zoom moves, and not otherwise */
    onZoom: null,

    /* ================================================= the reader's own hands
     * Three verbs, driven by js/main.js, which owns the pointers and the wheel.
     * Split this way because the gesture plumbing — pinch bookkeeping, tap versus
     * drag, which modifier means zoom — is DOM work that belongs beside the other
     * listeners, while what a turn or a zoom MEANS is spherical geometry and
     * belongs here with the projection it has to stay consistent with.
     * ====================================================================== */

    /** how far in the reader currently is, for the page's own chrome */
    zoom() { return state.tZoom; },
    /** the ceiling that applies right now — it differs by instance and by mode */
    zoomMax() { return zoomCeiling(); },
    /** which projection is on screen */
    mode() { return state.mode; },

    /**
     * Swap the projection under the reader, keeping the ground where it is.
     *
     * ★ THE CAMERA IS CARRIED OVER, NOT RESET, and that is the whole reason the
     * toggle is worth having rather than being two separate pictures. `zoom` means
     * different things either side (see MAP_ZOOM_MAX), so what is preserved is the
     * thing the reader actually cares about — how much GROUND is in the box — by
     * matching the visible longitude span across the swap. Press MAP over Sweden
     * and you get Sweden, at the size you were looking at it.
     */
    setMode(next) {
      const want = next === 'map' ? 'map' : 'globe';
      if (want === state.mode) return;
      /* degrees of longitude across the box, in the projection we are leaving */
      const spanNow = isMap()
        ? 360 / state.tZoom
        : Math.min(180, state.w / (state.r0 * state.tZoom) / RAD);
      state.mode = want;
      let z = isMap()
        ? 360 / Math.max(2, spanNow)
        : Math.min(state.zMax, Math.max(1, state.w / (state.r0 * spanNow * RAD)));
      /* ★ AND ON A PLATE, FAR ENOUGH IN THAT THE POLE IS NOT IN THE BOX.
         A sphere can be looked at from over the pole; an equirectangular plate
         ends there, so the camera is held back by mapLatClamp() — and at a whole-
         world zoom that clamp is 40°, which would have thrown a reader looking at
         Sweden down to the Mediterranean the instant they pressed MAP. Preserving
         the SPAN and preserving the PLACE conflict at high latitude, and the place
         is what they were looking at, so the span gives way: this is the shallowest
         zoom that still holds the current latitude in the middle. */
      if (isMap()) {
        const need = Math.abs(state.lat);
        if (need < 89) {
          z = Math.max(z, state.h / 2 / (90 - need) * 360 / state.w);
        }
      }
      state.zoom = state.tZoom = Math.max(zoomFloor(), Math.min(zoomCeiling(), z));
      state.r = state.r0 * state.zoom;
      /* every cache below is keyed on geometry that has just changed its meaning */
      geo.key = ''; lut.theme = null; layers.dirty = true;
      cost.rung = 0; cost.over = 0; cost.ms = 0;
      lastPaint = -1e9; stillSig = '';
      api.onZoom?.(state.tZoom);
    },

    /**
     * Turn the planet under a drag of (dx, dy) canvas pixels.
     *
     * Both the camera AND its target are set, which is the whole difference
     * between dragging a globe and asking one to go somewhere: an eased target
     * would leave the planet trailing the finger by a tenth of a second, and at
     * that point the reader is no longer turning it, they are steering it.
     *
     * dx is divided by cos(latitude) because a degree of longitude is that much
     * narrower on the ground up there — without it Scandinavia turns at half the
     * speed of the equator under the same finger. Floored at 0.4 so the last few
     * degrees before the pole do not become a slingshot.
     */
    turnBy(dx, dy) {
      if (isMap()) {
        /* ★ A MAP IS DRAGGED, NOT TURNED, and the sign is the difference. Pulling
           the plate left moves the camera east by exactly the ground under the
           finger — no cos(lat) correction, because a plate carrée spends the same
           pixels on a degree of longitude at every latitude, which is the one thing
           it gets wrong about the world and the one thing that makes it easy to
           drag. The clamp is applied in frame(), where a zoom can invalidate a
           latitude that was legal when it was set. */
        const ppd = mppd();
        state.tLon = state.lon - dx / ppd;
        state.tLat = state.lat + dy / ppd;
        state.lon = state.tLon; state.lat = state.tLat;
        state.holdUntil = performance.now() + 2400;
        return;
      }
      const k = 1 / RAD / state.r;
      state.tLon = state.lon - dx * k / Math.max(0.4, Math.cos(state.lat * RAD));
      state.tLat = Math.max(-85, Math.min(85, state.lat + dy * k));
      state.lon = state.tLon; state.lat = state.tLat;
      state.holdUntil = performance.now() + 2400;   // do not drift out from under them
    },

    /**
     * Scale by `k` about the canvas point (x, y), clamped to ZOOM_MIN..ZOOM_MAX.
     *
     * ★ IT ALSO WALKS THE CAMERA TOWARD WHATEVER IS UNDER THE FINGERS, and that is
     * what makes it feel like zooming rather than like magnifying. The disc centre
     * sits well to the right of the viewport — #globe-wrap is deliberately hung
     * off the edge — so a zoom purely about that centre would drive whatever the
     * reader was actually looking at off the screen, fastest at exactly the moment
     * they leant in. Instead the point they pinched is unprojected to a real
     * lat/lon and the camera moves a fraction of the way to it: `1 − z0/z1`, which
     * is nothing for a small nudge and asymptotically all of it as the zoom
     * builds. Pinch on Sweden and Sweden arrives in the middle.
     */
    zoomBy(k, x, y) {
      const z0 = state.tZoom;
      const z1 = Math.max(zoomFloor(), Math.min(zoomCeiling(), z0 * k));
      if (z1 === z0) return;
      state.tZoom = z1;
      if (z1 > z0 && x != null) {
        setCam();
        const t = unproject(x, y);
        if (t) {
          const f = 1 - z0 / z1;
          state.tLat = Math.max(-85, Math.min(85, state.tLat + (t.lat - state.tLat) * f));
          state.tLon += angleDelta(state.tLon, t.lon) * f;
        }
      }
      state.holdUntil = performance.now() + 2400;
      api.onZoom?.(z1);
    },

    /**
     * Go to a place at a stated closeness, for the list beside the atlas.
     *
     * `close` is 0..1 rather than a zoom number, because the two projections
     * measure zoom differently (see MAP_ZOOM_MAX) and a list row that means "show
     * me this circuit" should not have to know which one is on screen. It is
     * geometric between the floor and the ceiling, so 0.5 is the same *apparent*
     * step in either.
     */
    goTo(lat, lon, close = 0.62) {
      const lo = zoomFloor(), hi = zoomCeiling();
      const z = lo * Math.pow(hi / lo, Math.max(0, Math.min(1, close)));
      state.tZoom = z;
      if (!state.motion) { state.zoom = z; state.r = state.r0 * z; }
      state.tLat = Math.max(-85, Math.min(85, lat));
      state.tLon = lon;
      state.holdUntil = performance.now() + 6000;
      api.onZoom?.(z);
    },

    /** back to the whole planet, without moving where it is pointing */
    resetView() {
      state.tZoom = 1;
      state.holdUntil = performance.now() + 1200;
      api.onZoom?.(1);
    },

    /**
     * A pointer is down on the disc, or is not.
     *
     * The raster drops while it is — see surfaceSize(). Held rather than inferred
     * because a drag sets the camera and its target together, so there is no
     * easing gap left for the existing "is it moving" test to notice.
     */
    setGesture(on) {
      if (state.gesture === on) return;
      state.gesture = on;
      canvas.dataset.gesture = on ? '1' : '0';
      if (!on) {
        // a new disc size deserves a fresh run at the ladder — same as resize()
        cost.rung = 0; cost.over = 0; cost.ms = 0;
        lastPaint = -1e9;                    // and a sharp frame immediately
      }
    },

    /** canvas point to {lat, lon}, or null if it missed the planet */
    unproject(x, y) { setCam(); return unproject(x, y); },
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
