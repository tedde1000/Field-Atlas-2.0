/* ===========================================================================
 * earth.js — the surface plate the globe is shaded from, baked once at boot.
 *
 * ★ THE PLANET IS NOT A SATELLITE PHOTOGRAPH ANY MORE.
 *
 * Theodor: "make Earth look a bit more natural — not a satellite image, maybe.
 * Shaded relief, with city lights on the dark side. And make sure it's smooth
 * and doesn't have buggy artifacting."
 *
 * What was here was NASA Blue Marble drawn straight onto the sphere. It is a
 * beautiful image and it is the wrong image for this page: it is a photograph,
 * so it carries the sun angle it was shot under, the sensor's own colour, and a
 * flatness that fights the Lambert term laid over it — the terrain has no form,
 * because a nadir satellite composite has no shadows in it. Next to hand-drawn
 * circuit layouts and a struck coastline it read as a stock texture.
 *
 * So the surface is a RELIEF MAP now, in the cartographic sense: elevation,
 * tinted hypsometrically and lit by a fixed north-west cartographer's sun, the
 * way a paper atlas does it. That is a drawing rather than a photograph, which
 * is what this page is, and it gives the terrain the shadows the sphere needs.
 *
 * It is composed here, at boot, into ONE 2048x1024 RGBA plate:
 *
 *     R G B   the relief, day side          (hypsometric tint x hillshade,
 *                                            land-cover chroma, sea by depth)
 *     A       the city lights, night side   (emission only — see NIGHT below)
 *
 * Both in one plate on purpose: js/globe.js samples it bilinearly per pixel of
 * the disc, and one four-channel fetch costs a handful of multiplies more than
 * a three-channel one, where a second plate would cost a whole second fetch.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE THREE SOURCES COME FROM, and what each is used FOR — which is not
 * the same question:
 *
 *   #earth-topo    a global elevation raster. THE SHAPE. Every gradient, every
 *                  ridge and every shadow on the finished plate comes from here
 *                  and from nowhere else.
 *   #earth-plate   NASA Blue Marble, still here, demoted. THE COLOUR CAST only,
 *                  and heavily low-passed first — see chroma() below. It is what
 *                  keeps the Sahara sand-coloured and the taiga dark rather than
 *                  painting every lowland on Earth the same green.
 *   #earth-night   NASA Earth at Night. THE LIGHTS, and only the lights: the
 *                  terrain backdrop composited into that image is rejected.
 *
 * All three must stay SAME-ORIGIN. Every one of them is read back with
 * getImageData, and a cross-origin or file:// image taints the canvas and
 * throws — see the comment beside the tags in index.html.
 * ======================================================================== */
import { LAND } from '../data/world.js';

/* ★ 2048x1024, DOUBLED FROM 1024x512 — see RASTER_MAX in js/globe.js.
 *
 * The plate's width is what caps how sharp the disc can ever be: the visible
 * hemisphere gets half of it, so 1024 texels across a 700-pixel raster is a
 * comfortable oversample where 512 was a 1.4x UNDERSAMPLE and blurred the terrain
 * before the raster's own upscale got to it. Four times the texels, 8 MB, and one
 * pass at boot.
 *
 * ★ EVERYTHING BELOW THAT MEASURES A DISTANCE IN TEXELS SCALES WITH `SCALE`.
 * The blur radii, the relief exaggeration and the sharpening radius are all
 * tuned in texels, and every one of them means something different at a
 * different resolution — a gradient across one texel is half as steep on a plate
 * twice as wide, so a hillshade that is not scaled quietly goes flat. Doubling
 * the plate without this made the relief look like it had been switched off. */
export const PLATE_W = 2048, PLATE_H = 1024;
const SCALE = PLATE_W / 1024;

/* The finished plate, and the flags the globe reports through data-plate.
   `detail` names which source failed, because "the globe went flat" with no
   further information is the failure mode this file is most able to produce. */
export const PLATE = { px: null, ready: false, failed: false, waiting: [], detail: '' };

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

/* ===================================================== THE HYPSOMETRIC RAMP
 * Land colour by ELEVATION, which is the oldest convention in atlas cartography
 * and the reason a relief map reads as terrain without being a photograph:
 * green lowland, tan through brown as it rises, bare rock, then snow.
 *
 * These stops are pulled toward the page rather than toward a school atlas —
 * the greens are greyed and the browns warmed, so the disc sits with the amber
 * accent and the warm ink of assets/tokens.css instead of shouting over them.
 * Colour literals are allowed here for the same reason js/starfield.js has
 * them: this is imagery, not chrome, and there is no token for "3 400 m".
 * ======================================================================== */
const HYPSO = [
  [0.00, 52, 66, 50],       // lowland green — olive, not emerald
  [0.07, 66, 78, 52],
  [0.16, 92, 96, 60],       // dry grassland
  [0.28, 120, 110, 72],     // steppe / sand
  [0.42, 136, 110, 78],     // brown upland
  [0.56, 130, 106, 86],
  [0.68, 128, 122, 115],    // bare rock
  [0.80, 168, 170, 168],
  [0.90, 212, 215, 215],    // permanent snow
  [1.00, 240, 243, 244],
];

/* ★ HOW MUCH COLOUR IS LEFT IN AT THE END. The first pass through this ramp came
   out looking like a games console's idea of a planet: the lowland stops were a
   vivid green, the land-cover transfer below multiplied that by Blue Marble's
   already-saturated equatorial greens, and the equator ended up a band of
   fluorescent lime with the type sitting on top of it. Everything is pulled 28%
   of the way back toward its own luminance at the end of the land branch — which
   is a desaturation, not a darkening, so the relief keeps every bit of its form
   and simply stops shouting. */
const SAT = 0.66;

/* Sea by depth. There is no bathymetry in the elevation source worth the name,
   so "depth" here is DISTANCE FROM LAND, taken off a heavily blurred coastline
   mask — which is what a shelf actually correlates with at this scale, and
   which is inherently smooth, so it can never band or step. */
const SEA_SHELF = [24, 58, 80];
const SEA_DEEP = [7, 22, 38];

function ramp(stops, t) {
  const x = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0] || i === stops.length - 1) {
      const a = stops[i - 1], b = stops[i];
      const k = (x - a[0]) / ((b[0] - a[0]) || 1);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [stops[0][1], stops[0][2], stops[0][3]];
}

/* ========================================================== reading a source
 * Every source is decoded into a 2048x1024 (or smaller) RGBA buffer through a
 * canvas, because that is the only way to get pixels out of an <img>.
 *
 * ★ imageSmoothingQuality:'high' is doing real work here, not decoration. The
 * elevation source is 4096 wide and lands at 2048 — a 2x reduction, which the
 * browser's high-quality path box-filters properly and the default path does
 * not. A nearest-ish reduction of an elevation map is the single easiest way to
 * get a hillshade full of JPEG block edges, and blocky shadows on a rotating
 * planet are exactly the "buggy artifacting" this bake exists to avoid.
 */
function readImage(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/* ============================================================== THE LAND MASK
 * ★ COASTLINES COME FROM THE VECTORS, NOT FROM THE IMAGERY, and that is what
 * makes the finished plate clean.
 *
 * The obvious way to decide land from sea is to threshold the elevation raster.
 * It does not work: a JPEG of an elevation map has ringing along every coast, so
 * a threshold produces a fringe of speckle round every continent that then
 * crawls as the planet turns. data/world.js already carries the exact Natural
 * Earth 50m coastline the globe strokes on top, so the mask is FILLED FROM THAT
 * — one canvas fill, antialiased by the rasteriser, which means the land/sea
 * transition is a genuine sub-texel edge rather than a decision made per pixel.
 *
 * ★ evenodd, not nonzero. The topojson decode emits interior rings separately,
 * so the Caspian and the Great Lakes arrive as rings sitting inside other rings.
 * Under nonzero they fill as land; under even-odd a ring inside a ring punches a
 * hole, which is the correct answer and costs nothing when there is no nesting.
 *
 * ★ ANTARCTICA IS A CLIPPED POLYGON. In Natural Earth it stops at about 84.4°S
 * and closes along that parallel, so filling the rings alone leaves the bottom
 * ~5° of the plate as ocean — which renders as a bright band across the south
 * limb. Everything below 83.5°S is Antarctica, without exception, so the rows
 * under it are filled outright.
 */
let MASK = null;
function buildLandMask() {
  if (MASK) return MASK;
  const W = PLATE_W, H = PLATE_H;

  /* ★ THE PLATE IS A CYLINDER, AND FILLING IT AS A RECTANGLE PUT TWO WHITE
   * STRIPES ROUND THE WHOLE PLANET.
   *
   * Three of the 892 rings run off one edge of the map and back on at the other:
   * Eurasia, which reaches 180°E in Chukotka (twice — at 65.0°N and 69.0°N),
   * Wrangel Island, and Antarctica. Drawn straight, the segment joining
   * lon +179.9 to lon −180.0 is not a 0.1° hop across the date line, it is a
   * chord across the ENTIRE WIDTH of the raster. Two of those, at 65°N and
   * 69°N, and the even-odd rule then filled the four-degree band between them
   * as land — a solid white ring right round the Arctic, and a matching one at
   * 71°N off Wrangel. Both were plainly visible on the sphere.
   *
   * The fix is to stop pretending the seam is an edge. Each ring's longitudes
   * are UNWRAPPED first — every step taken as the short way round, accumulated,
   * so a ring that crosses the date line simply keeps going past ±180 instead of
   * teleporting. That makes every ring a continuous polygon on a plane, which is
   * a thing Path2D can fill correctly. The plane is then folded back onto the
   * cylinder by taking, for each column, the greatest of the three copies one
   * map-width apart — the union of the polygon's images, which is exactly the
   * region it covers on the cylinder.
   *
   * The canvas is three maps wide, drawn with a one-map offset, so a ring may
   * wander a full turn either side of where it started before anything is lost.
   * Eurasia unwrapped spans about 375°, the widest of them, well inside that. */
  const PAD = W;                                  // one map-width of headroom
  const c = document.createElement('canvas');
  c.width = W * 3; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, W * 3, H);

  const X = (lon) => PAD + (lon + 180) / 360 * W;
  const Y = (lat) => (90 - lat) / 180 * H;
  /** the short way round, in degrees — never more than half a turn */
  const step = (from, to) => ((to - from + 540) % 360) - 180;

  const p = new Path2D();
  for (const ring of LAND) {
    if (ring.length < 4) continue;
    let lon = ring[0][0];
    p.moveTo(X(lon), Y(ring[0][1]));
    for (let i = 1; i < ring.length; i++) {
      lon += step(ring[i - 1][0], ring[i][0]);
      p.lineTo(X(lon), Y(ring[i][1]));
    }
    p.closePath();
  }
  /* ★ evenodd, not nonzero. The topojson decode emits interior rings separately,
     so the Caspian and the Great Lakes arrive as rings sitting inside other
     rings. Under nonzero they fill as land; under even-odd a ring inside a ring
     punches a hole, which is the right answer and costs nothing where there is
     no nesting. */
  g.fillStyle = '#fff';
  g.fill(p, 'evenodd');

  /* ★ ANTARCTICA IS A CLIPPED POLYGON. Natural Earth stops it at about 84.4°S
     and closes it along that parallel, so the rings alone leave the bottom of
     the plate as ocean — which renders as a bright band across the south limb.
     Everything below 83.5°S is Antarctica, without exception, so those rows are
     filled outright, across all three copies. */
  g.fillRect(0, Y(-83.5), W * 3, H - Y(-83.5));

  const px = g.getImageData(0, 0, W * 3, H).data;
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W, row3 = y * W * 3;
    for (let x = 0; x < W; x++) {
      // fold the plane back onto the cylinder: the union of the three copies
      const a = px[(row3 + x) * 4], b = px[(row3 + x + W) * 4], d = px[(row3 + x + W * 2) * 4];
      mask[row + x] = Math.max(a, b, d) / 255;
    }
  }
  MASK = mask;
  return mask;
}

/** the land mask, for trace/plate.html. Not used by the page. */
export const _landMask = () => buildLandMask();

/* Separable box blur on a scalar field, wrapping in x and clamping in y —
   which is what an equirectangular plate is: a cylinder, not a rectangle. Three
   passes approximate a Gaussian closely enough that nothing downstream can tell,
   and a box pass is O(n) in the radius rather than O(n·r). */
function blurField(src, radius, passes = 3) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const W = PLATE_W, H = PLATE_H, r = Math.max(1, Math.round(radius));
  const inv = 1 / (r * 2 + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + ((k % W) + W) % W];
      for (let x = 0; x < W; x++) {
        b[row + x] = sum * inv;
        sum += a[row + ((x + r + 1) % W)] - a[row + ((x - r + W) % W)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum * inv;
        sum += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  return a;
}

/* ============================================ THE POLAR PREFILTER
 * ★ THE PLATE CARRIES DETAIL NEAR THE POLES THAT NO ORTHOGRAPHIC SPHERE CAN EVER
 * SHOW, AND THAT SURPLUS IS WHAT WAS CRAWLING.
 *
 * Theodor: "you can see a bit of artifacting, a bit of stuff moving on islands
 * and on the land."
 *
 * This is the other half of it, and it is a sampling fault rather than a drawing
 * one. An equirectangular plate spends the same 2 048 texels on every parallel,
 * but a parallel at latitude φ is only cos(φ) as long as the equator — so a texel
 * at 60°N covers HALF the ground a texel at 0° does, at 70°N a third, at 80°N a
 * sixth. The sphere, meanwhile, is drawn at one uniform scale. js/globe.js reads
 * about 0.64 texels per raster pixel at the equator, which is a comfortable
 * oversample; at 60°N that is 1.3 texels per pixel and at 70°N 1.9 — past Nyquist,
 * where bilinear filtering does not help and cannot. The plate has real detail the
 * raster has to skip over, so which detail it lands on changes as the planet
 * turns: Svalbard, Novaya Zemlya, the Canadian archipelago and the whole Siberian
 * coast shimmered, which is precisely the "islands" in the report.
 *
 * The fix belongs HERE, not in the render loop, because it costs nothing at 30 Hz
 * and it throws away nothing anyone could have seen. Each row is low-passed along
 * its own length until it carries the same detail PER KILOMETRE OF GROUND as the
 * equator does — sec(φ) texels wide. Below about 45° that is under a texel and the
 * row is left alone; at 80° it is a six-texel average; at the pole the row
 * collapses toward one colour, which is the correct answer, because the pole IS
 * one point however many texels the projection spends on it.
 *
 * Two passes rather than one: a single box leaks a fifth of the amplitude straight
 * back through its first sidelobe, and leaked amplitude at exactly the frequency
 * being removed is the crawl. Convolving two boxes gives a triangle, whose
 * stopband is that squared. Half-widths add in variance, so each pass runs at
 * √(sec²−1)/(2√2) — the √(sec²−1) being what is needed ON TOP of the texel's own
 * one-wide footprint, rather than instead of it.
 *
 * All four channels together, city lights included: the lights alias for the same
 * reason the coastlines do, and Tromsø has as much right not to flicker as Oslo.
 * ========================================================================= */

/** One box pass along one CHANNEL of one row, wrapping at the date line.
 *
 * The half-width is FRACTIONAL and that matters more than it looks: rounding it to
 * whole texels quantises the filter to nothing at all below 60° and then to a
 * five-texel smear at 70°, which shows up as a hard latitude band right across
 * Siberia. The integer core runs on a sliding sum; the fractional remainder is one
 * weighted sample at each end.
 *
 * ★ De-interleaved, and the index wraps with a comparison rather than a modulo.
 * This is 14 million inner iterations over the finished plate and the obvious
 * version — a closure over the RGBA buffer doing `((x % W) + W) % W` — measured
 * several times this one. `r` is capped at W/8 below, so an index can never be
 * more than one map-width out and a single `if` is a complete wrap. */
function boxRow(a, b, W, r, f) {
  const inv = 1 / (2 * r + 1 + 2 * f);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += a[k < 0 ? k + W : k];
  for (let x = 0; x < W; x++) {
    let lo = x - r - 1; if (lo < 0) lo += W;
    let hi = x + r + 1; if (hi >= W) hi -= W;
    let go = x - r; if (go < 0) go += W;
    b[x] = (sum + (a[lo] + a[hi]) * f) * inv;
    sum += a[hi] - a[go];
  }
}

function polarPrefilter(out) {
  const W = PLATE_W, H = PLATE_H;
  const a = new Float32Array(W), b = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    const sec = 1 / Math.max(1e-6, Math.abs(Math.cos(lat * RAD)));
    /* Capped at an eighth of the map. Past ~89.6° the honest half-width runs to
       hundreds of texels for a row that is already one colour wide on any sphere,
       and an uncapped sliding window there costs more than the rest of the bake. */
    const h = Math.min(W / 8, Math.sqrt(Math.max(0, sec * sec - 1)) / (2 * Math.SQRT2));
    if (h < 0.08) continue;            // under a tenth of a texel — nothing to gain
    const r = Math.floor(h), f = h - r, row = y * W * 4;
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < W; x++) a[x] = out[row + (x << 2) + c];
      boxRow(a, b, W, r, f);
      boxRow(b, a, W, r, f);
      for (let x = 0; x < W; x++) out[row + (x << 2) + c] = a[x];
    }
  }
}

/* ================================================== THE BAKE
 * One pass over 524 288 texels, once, at boot. Everything expensive about the
 * globe's look happens here rather than in js/globe.js's per-frame loop.
 * ========================================================================= */
function bake(topoPx, bmPx, nightPx, bmW, bmH) {
  const W = PLATE_W, H = PLATE_H, N = W * H;
  const out = new Uint8ClampedArray(N * 4);

  /* -- elevation, as a scalar field ------------------------------------- */
  const elev = new Float32Array(N);
  for (let i = 0, o = 0; i < N; i++, o += 4) {
    // the source is grey; averaging the three channels rejects any chroma noise
    // the JPEG left behind rather than trusting one of them
    elev[i] = (topoPx[o] + topoPx[o + 1] + topoPx[o + 2]) / 765;
  }

  /* ★ AN UNSHARP MASK ON THE ELEVATION, WHICH IS WHERE SHARPNESS ACTUALLY COMES
   * FROM ON THIS PLATE.
   *
   * Theodor: "make the globe a bit more sharp, I feel like it's a bit blurry."
   *
   * Raising the raster and the plate fixes the resampling, and it does not fix
   * this: the elevation source is a JPEG that has been through a 4x box-filtered
   * reduction, so its ridges arrive with soft shoulders. The hillshade is a
   * DERIVATIVE of that field, and the derivative of a blurred edge is a wide low
   * bump where the eye wants a narrow bright one — every mountain range comes out
   * as a smudge no matter how many pixels it is drawn into.
   *
   * Subtracting a blurred copy puts the shoulders back. Done on the elevation
   * rather than on the finished colour on purpose: it sharpens the SHAPE, so the
   * hillshade and the hypsometric tint both come out crisp and consistent, where
   * sharpening the output would just crawl along the coastlines. Radius and amount
   * are conservative — this is a relief map, not a phone camera.
   *
   * ★ AND IT HAS A THRESHOLD NOW, WHICH IS WHAT STOPS THE ICE FIELDS BOILING.
   *
   * Theodor: "you can see a bit of artifacting, a bit of stuff moving on islands
   * and on the land."
   *
   * An unsharp mask cannot tell a ridge from a compression artefact — it amplifies
   * whatever the blur removed, and what the blur removes from a JPEG is both the
   * ridge shoulders this is for AND the ±1-level ringing along every 8x8 block
   * boundary. At 0.85 that ringing came back at nearly twice its amplitude, and
   * the hillshade below is a DERIVATIVE, so a one-level step across one texel
   * turns into a visible facet. Over Tibet and the ice sheets — where `ice` and
   * the top of the hypsometric ramp are already near-white and any shading reads
   * loudly — that was a field of texel-scale speckle, and a planet turning under
   * a fixed raster makes speckle crawl.
   *
   * So the detail is gated on its own magnitude, with a soft knee so there is no
   * threshold to see. Below 0.005 of the elevation range — a level and a half out
   * of 255, which is noise and nothing else — none of it comes back; above 0.018
   * all of it does, which is every real ridge on Earth. The mountains are exactly
   * as sharp as they were and the flats stopped fizzing. */
  {
    const soft = blurField(elev, Math.round(1.5 * SCALE), 2);
    for (let i = 0; i < N; i++) {
      const detail = elev[i] - soft[i];
      const keep = smoothstep(0.005, 0.018, Math.abs(detail));
      elev[i] = clamp01(elev[i] + detail * 0.85 * keep);
    }
  }

  const mask = buildLandMask();

  /* ★ NORMALISED AGAINST THE LAND'S OWN HISTOGRAM, NOT AGAINST 0..255.
   *
   * The source encodes sea level near black and the ice sheets near white, but
   * where exactly is a property of whoever rendered it. Hard-coding a floor and
   * a ceiling means the ramp is right for one particular file and silently wrong
   * for its replacement — either every continent comes out snow-capped or the
   * whole planet comes out lowland green.
   *
   * So the ends are measured: the 1st and 99th percentile of elevation OVER LAND
   * ONLY, off a 256-bin histogram. Sea texels are excluded because they are most
   * of the plate and they are all at the floor, which would drag the 1st
   * percentile down to nothing. Self-tuning, and one pass. */
  const hist = new Uint32Array(256);
  let landCount = 0;
  for (let i = 0; i < N; i++) {
    if (mask[i] < 0.5) continue;
    hist[Math.min(255, (elev[i] * 255) | 0)]++;
    landCount++;
  }
  let lo = 0, hi = 255, acc = 0;
  for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= landCount * 0.01) { lo = b; break; } }
  acc = 0;
  for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= landCount * 0.01) { hi = b; break; } }
  const eLo = lo / 255, eHi = Math.max(eLo + 0.02, hi / 255);
  const eSpan = 1 / (eHi - eLo);

  /* -- the sea's depth field: distance from land, smoothed until it is smooth.
        Blurred at radius 7·SCALE three times over, which reaches roughly
        1 500 km — about the width of a real continental margin, and far wider
        than any feature that could show as a step. */
  const shelf = blurField(mask, Math.round(7 * SCALE), 3);

  /* ★ THE CITY LIGHTS ARE BLOOMED, AND WITHOUT IT THEY DO NOT SURVIVE THE TRIP.
   *
   * Extracted straight, a city is a handful of texels of the plate. That
   * is fine anywhere on the disc except the one place they are ever visible: the
   * shadowed crescent hugs the limb, and the limb is where an orthographic sphere
   * compresses a whole hemisphere's worth of texels into a few pixels. Bilinear
   * sampling there is a wild undersample, so a one-texel light lands between two
   * samples and vanishes. Baked, rendered and photographed, the terminator came
   * out completely dark with a perfectly good lights channel sitting behind it.
   *
   * So the emission is bloomed before it is stored: a couple of box passes to
   * spread each source over four or five texels, multiplied back up to put the
   * energy it lost back in, with a little of the sharp original left on top for
   * the cores. Wide enough to survive any sampling the limb can do to it — and it
   * is also simply what a city looks like from orbit, which is a glow in the haze
   * rather than a point. */
  /* ★ AND THE BLOOM IS TIGHTER THAN IT WAS, because the limb no longer needs it
   * to be that wide. The paragraph above is still the reason it exists at all —
   * but it was sized when a bilinear fetch was the only sampling this plate got,
   * and js/globe.js now widens its own footprint toward the limb (see FOOTPRINT
   * there), which averages over the compressed area properly rather than landing
   * between two texels and missing. The bloom no longer has to be wide enough to
   * survive being missed; it only has to be wide enough not to scintillate.
   *
   * What forced the question is the zoom. A blob baked at a fixed radius in TEXELS
   * grows on screen with magnification, so at 4x the reader was looking at
   * forty-pixel clouds of haze over Scandinavia with the terrain lost underneath —
   * the one view where they most wanted to see where they were. Pulled in to about
   * three texels, with more of the sharp original left standing, cities read as
   * cities at 1x and as points of light close up. */
  let lamps = null;
  if (nightPx) {
    const raw = new Float32Array(N);
    for (let i = 0, o = 0; i < N; i++, o += 4) raw[i] = emission(nightPx, o);
    const soft = blurField(raw, Math.round(1.5 * SCALE), 2);
    lamps = new Float32Array(N);
    for (let i = 0; i < N; i++) lamps[i] = Math.min(255, raw[i] * 0.85 + soft[i] * 2.4 * SCALE);
  }

  /* -- LAND-COVER CHROMA, and the resolution is the point ------------------
   * Blue Marble is used for one thing: the knowledge that the Sahara is sand
   * and Siberia is not. Sampled at full resolution it would drag its own
   * texture — swath seams, sensor noise, the faint sun-angle gradient — onto a
   * surface whose form is supposed to come from the elevation and nowhere else,
   * and that texture is what made the old globe read as a photograph.
   *
   * So it is read at 256x128 and bilinearly stretched back up: an eight-fold
   * low-pass that keeps regional colour and destroys everything finer. What
   * survives is a colour CAST, which is all this is for.
   */
  const chroma = (x, y) => {
    const fx = (x + 0.5) / W * bmW - 0.5, fy = (y + 0.5) / H * bmH - 0.5;
    const ix = Math.floor(fx), iy = Math.min(bmH - 2, Math.max(0, Math.floor(fy)));
    const tx = fx - ix, ty = fy - iy;
    const x0 = ((ix % bmW) + bmW) % bmW, x1 = (x0 + 1) % bmW;
    const r0 = iy * bmW, r1 = (iy + 1) * bmW;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty, w11 = tx * ty;
    const s = (ch) => bmPx[(r0 + x0) * 4 + ch] * w00 + bmPx[(r0 + x1) * 4 + ch] * w10 +
                      bmPx[(r1 + x0) * 4 + ch] * w01 + bmPx[(r1 + x1) * 4 + ch] * w11;
    return [s(0), s(1), s(2)];
  };

  /* -- the cartographer's sun ---------------------------------------------
   * Fixed at the north-west, 45° up. This is a 400-year-old convention and it
   * is not arbitrary: shade a relief map from the south-east and most people
   * read every valley as a ridge and every ridge as a valley. It has nothing to
   * do with the sun js/globe.js lights the SPHERE with — this one is baked into
   * the map, the way it is on paper.
   */
  const LX = -0.5333, LY = -0.5333, LZ = 0.6565;   // normalised (-1,-1,1.23)

  /* ★ RELIEF EXAGGERATION IS SCALED BY LATITUDE, AND THEN CAPPED.
   *
   * On an equirectangular plate a texel is 360/1024 of a degree wide however far
   * north it is, but the GROUND it covers narrows as cos(latitude) — so the same
   * height change over one texel is a steeper real slope near the poles. Honest
   * hillshading divides by cos(lat), and honest hillshading is wrong here: at
   * 85°N that is an eleven-fold amplification, and Greenland and Antarctica turn
   * into a field of black and white noise. The cosine is floored at 0.35, which
   * caps the gain just under 3x — enough that Scandinavian and Siberian relief
   * still reads, nowhere near enough to shatter the ice sheets. */
  const EXAG = 18 * SCALE;

  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    const kx = EXAG / Math.max(0.35, Math.cos(lat * RAD));
    const yUp = Math.max(0, y - 1) * W, yDn = Math.min(H - 1, y + 1) * W, row = y * W;

    for (let x = 0; x < W; x++) {
      const i = row + x, o = i * 4;
      const xL = (x - 1 + W) % W, xR = (x + 1) % W;

      const m = mask[i];
      const e = clamp01((elev[i] - eLo) * eSpan);

      let r, g, b;

      if (m > 0.002) {
        /* ---- land: hypsometric tint, hillshaded, cast by land cover ---- */
        const [cr, cg, cb] = chroma(x, y);

        /* ★ PERMANENT ICE CANNOT BE READ OFF THE ELEVATION, and leaving it to
         * the ramp is what made the first bake put a ring of tan beach round the
         * whole of Antarctica. The ice sheets are thick in the middle and thin at
         * the edge, so their coasts sit at the bottom of the ramp — which is
         * lowland green — and the land-cover transfer below cannot rescue it,
         * because that transfer moves hue and never lightness, and white has no
         * hue to give.
         *
         * So ice is detected instead, from the one source that knows: it is
         * where the land cover is BRIGHT and NEUTRAL. Neutrality is what
         * separates it from the deserts, which are just as bright and nothing
         * like as grey — the Sahara spans some 65 levels between its channels,
         * the Greenland ice sheet under five. */
        const cmax = Math.max(cr, cg, cb), cmin = Math.min(cr, cg, cb);
        const ice = (1 - smoothstep(14, 46, cmax - cmin)) *
                    smoothstep(0.58, 0.84, cmax / 255);

        // a mild gamma: most of the world's land is low, and without it nine
        // tenths of every continent collapses into the first two ramp stops
        const h = Math.max(Math.pow(e, 0.78), ice * 0.94);
        const [hr, hg, hb] = ramp(HYPSO, h);

        const dzdx = (elev[row + xR] - elev[row + xL]) * kx;
        const dzdy = (elev[yDn + x] - elev[yUp + x]) * EXAG;
        const nl = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        // dot(normal, light); normal = (-dzdx, -dzdy, 1) normalised
        const lam = (-dzdx * LX - dzdy * LY + LZ) * nl;
        /* 0.66..1.12 rather than 0..1: a relief map has no true shadow, it has a
           slope-dependent lightening and darkening about the flat value. Widened
           from 0.70..1.09 along with the unsharp mask above — the two together are
           what put definition back into the terrain — while the ceiling stays near
           1 because this disc sits behind the hero's body copy and the type has to
           win. */
        const shade = 0.66 + 0.46 * clamp01(lam * 1.15);

        /* Transfer only the source's COLOUR RATIOS, never its brightness — the
           lightness of every land texel stays the hypsometric tint's, so the
           relief keeps its structure and only the hue moves. Above the snow
           line the transfer fades out: satellite white over ramp white is the
           one place this can only lose information. */
        /* ★ TURNED DOWN FROM 0.46. Theodor, on the finished globe: "I'm thinking
           satellite's maybe not the best." He is right that this is the one part
           of the plate that comes from a photograph, and it earns its place only
           for the thing the elevation cannot know — that the Sahara is sand and
           the taiga is dark. A third is enough for that. Past it the cast starts
           doing the drawing, and the relief map starts looking like a soft
           satellite composite again, which is what he is reacting to. */
        const cl = (cr + cg + cb) / 3 + 1;
        const w = 0.33 * (1 - smoothstep(0.66, 0.88, h));
        const mix = (base, c) => base * (1 - w) + base * (c / cl) * w;

        r = mix(hr, cr) * shade;
        g = mix(hg, cg) * shade;
        b = mix(hb, cb) * shade;

        // and off the saturation, last — see SAT
        const lum = r * 0.30 + g * 0.56 + b * 0.14;
        r = lum + (r - lum) * SAT;
        g = lum + (g - lum) * SAT;
        b = lum + (b - lum) * SAT;
      } else {
        r = g = b = 0;
      }

      if (m < 0.998) {
        /* ---- sea: shelf to deep, on the smoothed distance field ----------
         * ★ The exponent is doing the work, not the colours. At 1.5 the shelf
         * reached most of the way to the middle of every ocean and every coast on
         * Earth wore a wide pale-blue halo, which read as a glow round the land
         * rather than as shallow water. At 2.4 it hugs the coast. */
        const d = Math.pow(clamp01(shelf[i] * 1.2), 2.4);
        const sr = SEA_DEEP[0] + (SEA_SHELF[0] - SEA_DEEP[0]) * d;
        const sg = SEA_DEEP[1] + (SEA_SHELF[1] - SEA_DEEP[1]) * d;
        const sb = SEA_DEEP[2] + (SEA_SHELF[2] - SEA_DEEP[2]) * d;
        r = m > 0.002 ? r * m + sr * (1 - m) : sr;
        g = m > 0.002 ? g * m + sg * (1 - m) : sg;
        b = m > 0.002 ? b * m + sb * (1 - m) : sb;
      }

      out[o] = r; out[o + 1] = g; out[o + 2] = b;

      /* ---- alpha: the city lights, bloomed ---------------------------- */
      out[o + 3] = lamps ? lamps[i] : 0;
    }
  }

  /* ★ LAST, AND IT HAS TO BE LAST. See polarPrefilter() above. It band-limits the
     FINISHED plate — hillshade, tint, coastline edge and lights together — because
     every one of those is a source of the high-latitude detail the sphere cannot
     resolve. Run it before the hillshade and the derivative would put the detail
     straight back in. */
  polarPrefilter(out);
  return out;
}

/* ★ THE LIGHTS, AND ONLY THE LIGHTS.
 *
 * NASA's Earth at Night is not a photograph of lights on black: it is lights
 * composited over a dim blue-violet rendering of the terrain, with the ice sheets
 * and the great deserts rendered noticeably paler than the sea. Added to the night
 * side whole, it does not read as cities — it reads as a grey smear with the
 * Sahara and Antarctica glowing, which is worse than no lights at all.
 *
 * ★ WHAT SEPARATES THEM IS BLUE, AND THE FIRST VERSION OF THIS FUNCTION GUESSED
 * THE OPPOSITE. It tested for WARMTH, on the reasoning that street lighting is
 * sodium and mercury vapour so red and green should run ahead of blue. That is
 * true of the light and it is not true of this image: measured, Tokyo is
 * (234,232,232), Moscow (246,246,244), Stockholm (224,222,218) — the settlements
 * are rendered essentially NEUTRAL. The warmth test scored Tokyo at 1 out of 255
 * and threw the four largest light fields on Earth away, which is why the
 * terminator came out completely dark with a perfectly good channel behind it.
 *
 * The backdrop is what is coloured: sea (8,8,16), Sahara (24,24,57), the
 * Greenland ice (33,24,57) — every one of them blue-dominant, by 8 to 33 levels.
 * So BLUE EXCESS gates the mask and luminance sets the strength, and the two
 * populations separate cleanly with room to spare: no settlement measured above
 * a bias of 13, no backdrop below 8, and the brightest backdrop on the planet
 * (38) sits under the luminance floor as well.
 */
function emission(px, o) {
  const r = px[o], g = px[o + 1], b = px[o + 2];
  const neutral = 1 - smoothstep(3, 18, b - (r + g) * 0.5);
  if (neutral <= 0) return 0;
  return 255 * neutral * clamp01(((r + g + b) / 3 - 26) / 150);
}

/* ============================================================ loading it all
 * Three images, any of which may still be decoding. The bake needs all three,
 * so it waits for whichever is last — and if one fails it degrades in a stated
 * way rather than silently: no topo means no relief and there is nothing to
 * fall back to, but a missing night plate simply means no lights.
 * ========================================================================= */
function whenReady(img) {
  return new Promise((res) => {
    if (!img) { res(null); return; }
    if (img.complete && img.naturalWidth) { res(img); return; }
    img.addEventListener('load', () => res(img), { once: true });
    img.addEventListener('error', () => res(null), { once: true });
  });
}

function finish() {
  PLATE.waiting.splice(0).forEach(fn => fn());
}

let started = false;
export function loadPlate() {
  if (started) return;                       // trace/plate.html calls it too
  started = true;
  if (typeof document === 'undefined') { PLATE.failed = true; PLATE.detail = 'no dom'; return; }
  const topo = document.getElementById('earth-topo');
  const bm = document.getElementById('earth-plate');
  const night = document.getElementById('earth-night');

  Promise.all([whenReady(topo), whenReady(bm), whenReady(night)]).then(([t, m, n]) => {
    if (!t) { PLATE.failed = true; PLATE.detail = 'no elevation source'; finish(); return; }
    try {
      const BM_W = 384, BM_H = 192;             // see chroma() — the low-pass IS the point
      const topoPx = readImage(t, PLATE_W, PLATE_H);
      const bmPx = m ? readImage(m, BM_W, BM_H) : new Uint8ClampedArray(BM_W * BM_H * 4).fill(128);
      const nightPx = n ? readImage(n, PLATE_W, PLATE_H) : null;
      PLATE.px = bake(topoPx, bmPx, nightPx, BM_W, BM_H);
      PLATE.ready = true;
      PLATE.detail = n ? (m ? 'relief + cover + lights' : 'relief + lights') : 'relief';
    } catch (err) {
      /* a tainted canvas is the one failure this cannot work around: the images
         are same-origin in index.html and rewritten to data: URIs by
         trace/bundle.py precisely so this never fires. If it does, say which. */
      PLATE.failed = true;
      PLATE.detail = 'tainted canvas — an Earth source is cross-origin';
    }
    finish();
  });
}
