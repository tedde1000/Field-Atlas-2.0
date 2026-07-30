/* ===========================================================================
 * loop.js — one closed racing line, drawn the same way everywhere.
 *
 * A circuit is shown in four places: the §02 thumbnail, the §03 canvas figure,
 * the §04 catalogue cell and the panel hero. Each of those used to build its
 * own path inline, which is how the same two faults ended up in all of them —
 * so the geometry lives here now and they all call it.
 *
 * ★ 1. THE LOOP IS SMOOTHED, NOT POLYGONAL.
 *
 * Theodor: "all the circuits are not as accurate." They were not: a lap is 29
 * to 72 points (rasbo 33, gellerasen 45), because that is everything the hand
 * traces and the OSM centrelines under source/geometry carry. Drawn as
 * `M … L … L … Z`, a 33-point lap is a 33-sided polygon — every corner a
 * crease, every sweeper a run of flats. There is no finer data to fetch. The
 * fix is to stop treating the samples as the shape.
 *
 * CENTRIPETAL Catmull-Rom (α = ½), not uniform, and the distinction is not
 * decorative here. A lap mixes 200m straights sampled every ~60m with hairpins
 * sampled every few metres, and on spacing that uneven uniform Catmull-Rom
 * overshoots: it throws the curve wide of the outside of a hairpin and can loop
 * it back through itself. Centripetal parameterisation is the variant that
 * provably cannot cusp or self-intersect however uneven the spacing gets, which
 * is the exact property a racing line needs. The curve still passes through
 * every traced point — this interpolates the trace, it does not invent one.
 *
 * ★ 2. THE LOOP CLOSES.
 *
 * Theodor: "almost all track layouts have this little cut on the streets … the
 * circuits are not full." The old thumbnail emitted `Z`, which does close the
 * outline, and then set `stroke-dasharray` from a perimeter summed over
 * `i = 1 … n-1` — every segment **except the one Z adds**. The dash was always
 * shorter than the path it dashed, and the shortfall showed as a gap sitting
 * exactly on the start/finish line. Measured before the fix: 0.6% of the lap at
 * Gelleråsen, 1.4% at Rörken, 7.4% at Linköping. loopLength() closes the sum.
 * ======================================================================== */

/* =====================================================  1.x's layoutPath
 * ★ A CIRCUIT IS NOT A SPLINE. Straights are straight and corners have a
 * radius, and that distinction is the whole difference between a layout that
 * looks right and one that looks approximately right.
 *
 * This is Field Atlas 1.x's `layoutPath()`, ported unchanged, because 1.x is
 * what Theodor is comparing against and it was already correct. Each traced
 * point is `[x, y, r]` — the third component is the DESIGNED CORNER RADIUS at
 * that vertex, and 24 of Rörken's 33 points carry one. `tracedLayout()` in
 * main.js used to map those points to `[p[0], p[1]]`, throwing every radius
 * away, after which there was nothing left to draw but a 33-sided polygon.
 * That was "the circuits are not accurate", and no amount of smoothing fixes
 * it — a spline through the same points bends the straights instead, which is
 * wrong in the other direction.
 *
 * Each vertex is trimmed back along both its neighbours by
 * `t = min(r, l0·0.48, l1·0.48)` — the 0.48 is what stops two adjacent radii
 * eating the short segment between them — and the corner becomes one quadratic
 * whose control point is the original vertex. Straight runs stay dead straight.
 * ================================================================== */
export function layoutPath(pts, closed = true) {
  const n = pts.length;
  const P = (i) => pts[(i + n) % n];
  let d = '';
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = P(i);
    const [x0, y0] = P(i - 1);
    const [x1, y1] = P(i + 1);
    let pin = [x, y], arc = '';
    if (r && (closed || (i > 0 && i < n - 1))) {
      const v0 = [x0 - x, y0 - y], v1 = [x1 - x, y1 - y];
      const l0 = Math.hypot(v0[0], v0[1]), l1 = Math.hypot(v1[0], v1[1]);
      const t = Math.min(r, l0 * 0.48, l1 * 0.48);
      pin = [x + v0[0] / l0 * t, y + v0[1] / l0 * t];
      const po = [x + v1[0] / l1 * t, y + v1[1] / l1 * t];
      arc = 'Q' + x + ' ' + y + ' ' + po[0].toFixed(1) + ' ' + po[1].toFixed(1);
    }
    d += (i ? 'L' : 'M') + pin[0].toFixed(1) + ' ' + pin[1].toFixed(1) + arc;
  }
  return closed ? d + 'Z' : d;
}

/** does this trace carry designed corner radii, or is it a bare centreline? */
export function hasRadii(pts) {
  return Array.isArray(pts) && pts.some(p => p.length > 2 && p[2]);
}

/* ============================================================ FLATTENING
 * The §03 canvas figure walks a circuit point by point — it places particles
 * along it and reads curvature off it — so it needs points, not a `d` string.
 * Now that the most accurate geometry we hold is drawn artwork (real cubic
 * Béziers, see trace/extract.py), this turns any of the three representations
 * back into a polyline the canvas can use, so §03 and the SVG layouts are
 * always showing the same circuit.
 *
 * Supports the subset the artwork and layoutPath actually emit: M L H V C S Q T
 * Z, absolute and relative. Anything else is ignored rather than guessed at.
 * ========================================================================= */
export function flattenPath(d, step = 3) {
  const toks = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  let px = null, py = null;                 // last control point, for S and T
  const num = () => parseFloat(toks[i++]);
  const push = (a, b) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(a - last[0], b - last[1]) > 1e-9) out.push([a, b]);
  };
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    // subdivide by the control hull's length, which bounds the true arc length
    const hull = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2);
    const n = Math.max(2, Math.ceil(hull / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
           u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
    px = x2; py = y2; x = ex; y = ey;
  };
  const quad = (x1, y1, ex, ey) =>
    // every quadratic has an exact cubic equivalent — raise the degree and reuse
    cubic(x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y),
          ex + 2 / 3 * (x1 - ex), ey + 2 / 3 * (y1 - ey), ex, ey);
  const line = (ex, ey) => {
    const n = Math.max(1, Math.ceil(Math.hypot(ex - x, ey - y) / step));
    for (let k = 1; k <= n; k++) push(x + (ex - x) * k / n, y + (ey - y) * k / n);
    px = py = null; x = ex; y = ey;
  };

  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') {
      x = num() + ox; y = num() + oy; push(x, y); sx = x; sy = y; px = py = null;
      cmd = rel ? 'l' : 'L';                 // subsequent pairs are implicit lineto
    } else if (C === 'L') { line(num() + ox, num() + oy); }
    else if (C === 'H') { line(num() + ox, y); }
    else if (C === 'V') { line(x, num() + oy); }
    else if (C === 'C') { cubic(num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy); }
    else if (C === 'S') {
      const rx = px == null ? x : 2 * x - px, ry = py == null ? y : 2 * y - py;
      cubic(rx, ry, num() + ox, num() + oy, num() + ox, num() + oy);
    } else if (C === 'Q') { quad(num() + ox, num() + oy, num() + ox, num() + oy); }
    else if (C === 'T') {
      const rx = px == null ? x : 2 * x - px, ry = py == null ? y : 2 * y - py;
      quad(rx, ry, num() + ox, num() + oy);
    } else if (C === 'Z') { push(sx, sy); x = sx; y = sy; px = py = null; }
    else { i++; }                             // an arc or something unknown — skip it
  }
  // a closed loop repeats its first point at the end; the canvas wants it once
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

/** perimeter of the CLOSED loop — the wrap-around segment included */
export function loopLength(pts) {
  const n = pts.length;
  let L = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

/* The control points of one centripetal-Catmull-Rom span, as a cubic Bézier.
   With d1 = d2 = d3 these collapse to p1 + (p2−p0)/6 and p2 − (p3−p1)/6, i.e.
   the uniform case — so nothing is special-cased for evenly spaced input. */
function span(p0, p1, p2, p3, alpha) {
  const k = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-6;
  const d1 = k(p0, p1), d2 = k(p1, p2), d3 = k(p2, p3);
  const c1 = [0, 1].map(i =>
    (d1 * d1 * p2[i] - d2 * d2 * p0[i] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[i]) /
    (3 * d1 * (d1 + d2)));
  const c2 = [0, 1].map(i =>
    (d3 * d3 * p1[i] - d2 * d2 * p3[i] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[i]) /
    (3 * d3 * (d3 + d2)));
  return [c1, c2];
}

const at = (pts, i) => pts[(i % pts.length + pts.length) % pts.length];

/* ========================================================= CORNERS
 * One corner finder for the whole page. §03's canvas figure had its own copy and
 * the panel layouts had none, which is why the figure could call out four turns
 * while the spec table beside it said fourteen.
 *
 * `curvature()` is heading change per node, smoothed over a window — the same
 * signal trace/extract.py walks when it counts corners off the OSM centreline,
 * only in artboard units instead of metres.
 * ================================================================== */
const TAU2 = Math.PI * 2;

export function curvature(p, window = 3) {
  const n = p.length, k = new Float32Array(n);
  const head = (i) => {
    const a = p[i % n], b = p[(i + 1) % n];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (let i = 0; i < n; i++) {
    let d = head(i + window) - head((i - window + n) % n);
    while (d > Math.PI) d -= TAU2;
    while (d < -Math.PI) d += TAU2;
    k[i] = d;
  }
  return k;
}

/**
 * Every maximal run of same-signed turn, in lap order, one entry per run.
 *
 * ★ The threshold is applied HERE and nowhere else, and the runs themselves do
 * not depend on it — which is the property numberedCorners() below relies on.
 */
/* ★ HOW MUCH A RUN ACTUALLY TURNS, WHICH IS NOT THE SUM OF curvature().
 *
 * `curvature()` reports, at each node, the heading change across a ±3-node WINDOW.
 * That is the right signal to find corners with — it is smooth and noise-robust —
 * but consecutive nodes overlap by six segments, so adding it up over a run
 * counts every segment about six times. The figure legend printed the result
 * verbatim and claimed a 1371° corner at Gelleråsen, which is 3.8 revolutions.
 *
 * The true total is the sum of the per-SEGMENT heading deltas, each wrapped into
 * (−π, π]. Summing deltas rather than differencing the endpoints matters: a
 * hairpin turns more than 180°, and an endpoint difference wraps and reports the
 * short way round.
 */
function trueTurn(pts, from, len) {
  const n = pts.length;
  const head = (i) => {
    const a = pts[i % n], b = pts[(i + 1) % n];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  let sum = 0, prev = head(from);
  for (let j = 1; j <= len; j++) {
    const h = head(from + j);
    let d = h - prev;
    while (d > Math.PI) d -= TAU2;
    while (d < -Math.PI) d += TAU2;
    sum += d;
    prev = h;
  }
  return sum;
}

export function cornerRuns(pts, k, thresholdDeg = 4, dead = 0.012) {
  const n = pts.length;
  const sgn = new Int8Array(n);
  for (let i = 0; i < n; i++) sgn[i] = k[i] > dead ? 1 : (k[i] < -dead ? -1 : 0);

  /* Start walking from a sign CHANGE, so a corner that straddles index 0 is one
     run and not two half-corners — index 0 is the start/finish line, and on a
     circuit that line is often mid-straight but is sometimes not. */
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (sgn[i] !== sgn[(i - 1 + n) % n]) { start = i; break; }
  }
  if (start < 0) return [];                  // uniform curvature — a circle, no corners

  const out = [];
  for (let i = 0; i < n; ) {
    const s = sgn[(start + i) % n];
    let len = 1;
    while (i + len < n && sgn[(start + i + len) % n] === s) len++;
    if (s !== 0) {
      let peak = 0, peakAt = (start + i) % n;
      for (let j = 0; j < len; j++) {
        const idx = (start + i + j) % n;
        if (Math.abs(k[idx]) > Math.abs(peak)) { peak = k[idx]; peakAt = idx; }
      }
      const from = (start + i) % n;
      const turn = trueTurn(pts, from, len);   // real degrees — see trueTurn()
      if (Math.abs(turn) * 180 / Math.PI >= thresholdDeg) {
        out.push({
          i: peakAt,                         // sharpest node — where a label points
          at: (start + i + (len >> 1)) % n,  // middle of the run
          from, len,
          turn,                              // signed total, radians
          peak: Math.abs(peak),
        });
      }
    }
    i += len;
  }
  return out.sort((a, b) => a.i - b.i);       // lap order, i.e. from start/finish
}

/**
 * The corners to NUMBER on a drawn layout — exactly `target` of them when the
 * data knows how many there are.
 *
 * ★ WHY THIS IS NOT JUST cornerRuns() WITH A TUNED THRESHOLD.
 *
 * `track.corners` is measured by trace/extract.py off the OSM centreline,
 * resampled to even 8-metre steps: that number is the authority and it is
 * printed in the spec table two inches from the drawing. The drawing is a
 * *different representation* of the same circuit — real Béziers on a 500x300
 * artboard — so walking it for heading change gives a similar but not identical
 * count, and a layout numbered T1…T16 beside a table reading "CORNERS 14" is
 * exactly the kind of quiet disagreement this page is supposed to not have.
 *
 * Since the runs are threshold-independent, the honest reconciliation is to rank
 * every run by how much it actually turns and keep the `target` sharpest, then
 * put them back in lap order. The count always matches the table, and which
 * turns got numbered is decided by the geometry rather than by a magic constant.
 */
/* ★ SPLITTING A RUN THAT IS REALLY TWO CORNERS.
 *
 * A run is a stretch of same-signed turn, so two corners the same way round with
 * only a breath between them — a double apex, or Gelleråsen's Esset — arrive as
 * ONE run. Loosening the deadband does not separate them; it makes it worse, which
 * is the trap the first version of numberedCorners() fell into. A smaller deadband
 * means fewer nodes read as straight, so runs get LONGER and merge more, and the
 * pool shrank exactly when it needed to grow.
 *
 * What actually separates them is the shape of the curvature inside the run: two
 * peaks with a dip between them. So cut at the deepest interior minima of |k| —
 * which is where a driver releases and re-applies — and take one number per piece.
 * Nothing is invented: a cut only happens where the drawing itself eases off.
 */
function splitRun(pts, k, run, pieces) {
  const n = pts.length;
  if (pieces < 2 || run.len < 8) return [run];
  const guard = Math.max(2, Math.floor(run.len * 0.18));   // no slivers at either end
  const dips = [];
  for (let j = guard; j < run.len - guard; j++) {
    const a = Math.abs(k[(run.from + j - 1) % n]);
    const b = Math.abs(k[(run.from + j) % n]);
    const c = Math.abs(k[(run.from + j + 1) % n]);
    if (b <= a && b <= c) dips.push({ j, v: b });
  }
  if (!dips.length) return [run];
  const cuts = dips.sort((a, b) => a.v - b.v).slice(0, pieces - 1)
                   .map(d => d.j).sort((a, b) => a - b);

  const out = [];
  let at = 0;
  for (const cut of [...cuts, run.len]) {
    const len = cut - at;
    if (len < 2) continue;
    const from = (run.from + at) % n;
    let peak = 0, peakAt = from;
    for (let j = 0; j < len; j++) {
      const idx = (from + j) % n;
      if (Math.abs(k[idx]) > Math.abs(peak)) { peak = k[idx]; peakAt = idx; }
    }
    out.push({ i: peakAt, at: (from + (len >> 1)) % n, from, len,
               turn: trueTurn(pts, from, len), peak: Math.abs(peak) });
    at = cut;
  }
  return out.length ? out : [run];
}

export function numberedCorners(pts, k, target) {
  const n = pts.length;
  if (!target) return cornerRuns(pts, k, 4);

  let pool = cornerRuns(pts, k, 3);

  /* Short of the measured count? Split the runs that turn the most, biggest first,
     one extra piece at a time — a 180° run is far more likely to be two corners
     than a 40° one. Stops as soon as the pool reaches the target, or as soon as
     nothing will split any further. */
  let guardRounds = target * 2;
  while (pool.length < target && guardRounds-- > 0) {
    const order = [...pool].sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn));
    let progressed = false;
    for (const run of order) {
      const parts = splitRun(pts, k, run, 2);
      if (parts.length < 2) continue;
      pool = pool.filter(r => r !== run).concat(parts);
      progressed = true;
      break;
    }
    if (!progressed) break;
  }

  if (pool.length <= target) return pool.sort((a, b) => a.i - b.i);

  /* More candidates than the data counts: keep the sharpest, but never two within
     3.5% of the lap — two numbers on top of each other on the drawing costs a real
     turn elsewhere its number. */
  const sep = Math.max(3, Math.floor(n * 0.035));
  const kept = [];
  for (const c of [...pool].sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn))) {
    if (kept.length >= target) break;
    if (kept.every(o => {
      const d = Math.abs(o.i - c.i);
      return Math.min(d, n - d) >= sep;
    })) kept.push(c);
  }
  return kept.sort((a, b) => a.i - b.i);
}

/* ================================================== EVEN SPACING, FIRST
 * ★ EVERY SOLVER BELOW ASSUMES THE NODES ARE EVENLY SPACED, AND NOTHING
 * UPSTREAM WAS GIVING THEM THAT.
 *
 * flattenPath() subdivides a Bézier by its control hull and loopSample() by its
 * chord, so both put many nodes into a tight corner and few along a straight —
 * sensible for drawing, wrong for everything here. The relaxation below is a
 * discrete Laplacian, whose strength per sweep goes as the SQUARE of the node
 * spacing; the curvature estimate is a finite difference over a fixed number of
 * nodes; the speed profile integrates ds between them. Feed any of those uneven
 * spacing and they quietly weight the corners differently from the straights,
 * which is exactly the sort of error that shows up as a line that looks almost
 * right and is subtly wrong everywhere.
 *
 * So the lap is resampled to constant arc length before anything else happens.
 * `n` is chosen by the caller, and it is chosen high — see the note over
 * NODES in js/circuit.js.
 * ==================================================================== */
export function resampleUniform(pts, n) {
  const m = pts.length;
  const seg = new Float64Array(m);
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    seg[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += seg[i];
  }
  const step = total / n;
  const out = new Array(n);
  let i = 0, walked = 0;
  for (let k = 0; k < n; k++) {
    const want = k * step;
    while (i < m - 1 && walked + seg[i] < want) { walked += seg[i]; i++; }
    const t = seg[i] > 1e-12 ? (want - walked) / seg[i] : 0;
    const a = pts[i], b = pts[(i + 1) % m];
    out[k] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return out;
}

/* ============================================== CURVATURE, THE REAL ONE
 * curvature() above reports heading change across a window, which is the right
 * signal for FINDING corners and is not a curvature: it has units of radians and
 * depends on the window. Cornering speed needs 1/radius, in units of 1/length.
 *
 * The Menger curvature of three points is 4A/(abc) — the reciprocal of the radius
 * of the circle through them — and taking the three a few nodes apart rather than
 * adjacent is what keeps it stable, because at 1 500 nodes round a lap three
 * consecutive points are nearly collinear and the area term is all rounding
 * error.
 * ==================================================================== */
export function menger(P, gap = 3) {
  const n = P.length, k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[(i - gap + n) % n], b = P[i], c = P[(i + gap) % n];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    const den = ab * bc * ca;
    k[i] = den > 1e-12 ? 2 * area2 / den : 0;
  }
  return k;
}

/* ==================================================== HOW FAST, AND WHERE
 * ★ A LAP TIME NEEDS A CAR, so here is one, as a point mass with three limits.
 *
 * Nothing else on this page invents a number, and this is the one place it has
 * to: `data/atlas.js` has lap lengths and corner counts and no vehicle in it at
 * all. These are ordinary published figures for the two things that actually run
 * at these venues, and they are only ever used to decide the SHAPE of a line —
 * no time is printed anywhere, and none should be.
 *
 *   aLat     how hard it can hold a corner
 *   aBrake   how hard it can stop
 *   aPower   how hard it can accelerate — the small one, and the reason a late
 *            apex is worth anything at all
 *   vMax     where it stops accelerating
 *
 * A kart pulls more lateral g than a Carrera Cup car and has a fraction of the
 * power, which is why kart lines apex later and squarer than car lines do. That
 * difference falls straight out of these four numbers.
 * ==================================================================== */
export const KART = { aLat: 15.5, aBrake: 13.5, aPower: 5.2, vMax: 29 };
export const CAR = { aLat: 14.0, aBrake: 14.5, aPower: 6.8, vMax: 62 };

/**
 * Speed at every node, in metres per second — the classic forward/backward pass.
 *
 * Start from what the corner alone allows, v = √(a_lat / κ). Then walk the lap
 * backwards limiting each node to what can still be shed before the one after it
 * (braking), and forwards limiting it to what can have been gained since the one
 * before (power). What is left is the fastest the lap can be driven.
 *
 * ★ TWICE ROUND, EACH WAY. The lap is closed, so a braking zone for turn 1 can
 * begin before the start/finish line — one pass starting at index 0 has no idea
 * that is coming and leaves the last straight too fast. A second pass carries the
 * answer back across the seam. Two is enough for any real circuit; the limits are
 * monotone, so the passes can only ever lower a speed and always converge.
 */
export function speedProfile(P, dsMetres, car) {
  const n = P.length;
  const k = menger(P, 3);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    v[i] = k[i] > 1e-9 ? Math.min(car.vMax, Math.sqrt(car.aLat / k[i])) : car.vMax;
  }
  const dvB = 2 * car.aBrake * dsMetres, dvP = 2 * car.aPower * dsMetres;
  for (let pass = 0; pass < 2; pass++) {
    for (let s = n - 1; s >= 0; s--) {
      const j = (s + 1) % n, lim = Math.sqrt(v[j] * v[j] + dvB);
      if (v[s] > lim) v[s] = lim;
    }
    for (let s = 0; s < n; s++) {
      const h = (s - 1 + n) % n, lim = Math.sqrt(v[h] * v[h] + dvP);
      if (v[s] > lim) v[s] = lim;
    }
  }
  return v;
}

/** seconds to cover `len` nodes from `from`, on the trapezium rule */
function spanTime(v, dsMetres, from, len, n) {
  let t = 0;
  for (let s = 0; s < len; s++) {
    const i = (from + s) % n, j = (i + 1) % n;
    t += 2 * dsMetres / (v[i] + v[j]);
  }
  return t;
}

/* ==================================================== THE RACING LINE
 * ★ A CENTRELINE IS NOT A RACING LINE, and §03 used to show the centreline.
 *
 * Theodor: "take the line and then make it a racing line — make it go wide and
 * then for the apex in the corners." What the figure drew was the traced
 * centreline with the particles scattered either side of it by a random constant,
 * so the flow ran down the middle of the road forever and the corners looked
 * like the straights with more bend.
 *
 * This solves for the line a driver would actually take, inside a corridor of
 * ±`halfWidth` about the centreline. The racing line is written as one lateral
 * offset per node,
 *
 *     P(i) = C(i) + d(i) · n(i)      with  d(i) ∈ [−halfWidth, +halfWidth]
 *
 * and relaxed toward minimum curvature: each node steps toward the midpoint of
 * its two neighbours, projected back onto its own normal so the point stays on
 * its cross-section, then clamped to the track. Straights are already the
 * midpoint of their neighbours so they do not move; corners pull inward until
 * they hit the kerb. The equilibrium is wide in, apex, wide out — nobody has to
 * hand-author that, it falls out of the geometry.
 *
 * ★ IT IS SOLVED COARSE-TO-FINE, AND IT HAS TO BE. The naive version relaxes
 * only against immediate neighbours, and the Laplacian of a dense polyline is
 * proportional to the SQUARE of the node spacing — at the 2.2-unit spacing the
 * flattener emits, one sweep moves a node about a hundredth of a unit, so
 * crossing a 13px corridor needs on the order of a thousand sweeps and the line
 * visibly had not converged. Relaxing against neighbours ±k apart first, then
 * halving k, moves the long wavelengths in a handful of sweeps and leaves the
 * fine ones to the tail. Same answer, ~40x fewer sweeps.
 * ================================================================== */
/* ★ AND MINIMUM CURVATURE IS STILL NOT THE LINE A DRIVER TAKES.
 *
 * Theodor: "the anatomy of a circuit — make a lot more measuring points for the
 * line to be accurate. It's really weird. Search up how a normal racing line is,
 * how drivers take lines."
 *
 * He is right, and the fault is not resolution — that was only half of it. The
 * minimum-curvature line apexes in the GEOMETRIC middle of every corner, because
 * that is the largest circle that fits, and a driver does not do that. They turn
 * in late, clip the inside past the middle, and straighten early so the throttle
 * can open sooner: the entry is deliberately given away to buy exit speed, and
 * the exit speed is then carried for the whole length of the following straight.
 * A tenth lost at turn-in comes back several times over 500 m later. Through
 * linked corners the same logic compounds — the earlier turns are sacrificed for
 * whichever one actually feeds the straight.
 *
 * None of that is a shape. It is a consequence of a stopwatch, and it cannot be
 * had from geometry alone at any resolution, which is why the old figure looked
 * symmetrical and slightly wrong however many points went into it.
 *
 * So the solve is now in two stages. The Laplacian relaxation stays and produces
 * the minimum-curvature line, which is a good starting guess and nothing more.
 * Then that line is driven — see speedProfile() — and each node is nudged in
 * whichever direction makes the LAP TIME shorter, until it stops improving. The
 * late apex is not written down anywhere in here; it is what falls out.
 *
 * ★ THE TIME TEST IS WINDOWED, and it has to be. Evaluating a whole lap for both
 * directions at every one of ~1 500 nodes, twelve times over, is 50 million-odd
 * operations and a visible stall every time the reader picks a different circuit.
 * Moving one node can only change the speed within a braking or acceleration
 * zone of itself, so the test re-solves ±WINDOW nodes with the speeds at the two
 * ends pinned to the current full-lap answer. Same decision, a hundredth of the
 * cost — and the full lap is still checked once at the end, so a refinement that
 * somehow made the lap slower is thrown away rather than shipped.
 */
const WINDOW = 60;          // nodes either side, re-solved for a trial move
const KGAP = 3;             // curvature stencil half-width, in nodes

export function racingLine(pts, halfWidth, opts = {}) {
  const n = pts.length;
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / L; ny[i] = tx / L;          // left of travel
  }

  const d = new Float64Array(n);
  const w = Math.max(1e-6, halfWidth);
  const clamp = (v) => (v > w ? w : (v < -w ? -w : v));

  /* ------------------------------------------- stage 1: minimum curvature */
  const scales = [];
  for (let k = Math.max(1, Math.floor(n / 24)); k >= 1; k = Math.floor(k / 2)) scales.push(k);
  if (scales[scales.length - 1] !== 1) scales.push(1);

  for (const k of scales) {
    const relax = k > 1 ? 0.55 : 0.32;
    for (let it = 0; it < 34; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - k + n * 2) % n, b = (i + k) % n;
        const ax = pts[a][0] + d[a] * nx[a], ay = pts[a][1] + d[a] * ny[a];
        const bx = pts[b][0] + d[b] * nx[b], by = pts[b][1] + d[b] * ny[b];
        const cx = pts[i][0] + d[i] * nx[i], cy = pts[i][1] + d[i] * ny[i];
        const lx = (ax + bx) / 2 - cx, ly = (ay + by) / 2 - cy;
        d[i] = clamp(d[i] + relax * (lx * nx[i] + ly * ny[i]));
      }
    }
  }

  /* A taut string apexes early and turns in kinks where it leaves the kerb. Three
     passes of [1 2 1] on the offset move the line from minimum-LENGTH toward
     minimum-CURVATURE — a later apex and a rounded release, which is what a lap
     actually looks like. Re-clamped each pass, so nothing leaves the track. */
  const tmp = new Float64Array(n);
  for (let s = 0; s < 3; s++) {
    tmp.set(d);
    for (let i = 0; i < n; i++) {
      d[i] = clamp((tmp[(i - 1 + n) % n] + 2 * tmp[i] + tmp[(i + 1) % n]) / 4);
    }
  }

  /* the centreline and its normals, flat — see the note over the search below:
     this whole stage has to run without allocating anything */
  const CX = new Float64Array(n), CY = new Float64Array(n);
  for (let i = 0; i < n; i++) { CX[i] = pts[i][0]; CY[i] = pts[i][1]; }
  const build = (off) => {
    const L = new Array(n);
    for (let i = 0; i < n; i++) L[i] = [CX[i] + off[i] * nx[i], CY[i] + off[i] * ny[i]];
    return L;
  };

  const car = opts.car;
  const mpu = opts.metresPerUnit;
  if (!car || !(mpu > 0)) {
    // no vehicle and no scale — the geometric line is all that can be justified
    return { line: build(d), d, nx, ny, halfWidth: w, geometric: true };
  }

  /* ------------------------------------------------ stage 2: minimum time */
  const geo = Float64Array.from(d);
  let line = build(d);
  const ds = (loopLength(line) / n) * mpu;              // metres between nodes
  let v = speedProfile(line, ds, car);
  const t0 = spanTime(v, ds, 0, n, n);                  // the whole lap, once

  const SPAN = 2 * WINDOW + 1;
  const vw = new Float64Array(SPAN);
  const dvB = 2 * car.aBrake * ds, dvP = 2 * car.aPower * ds;

  /**
   * Lap time over the window centred on `c`, with `d` as it currently stands.
   *
   * ★ NOT ONE ALLOCATION IN HERE, and that is not premature: the first version
   * built three little [x, y] arrays per node of the window, which at 121 nodes a
   * window and seventy thousand windows is twenty-six million throwaway objects
   * for one circuit. It was not slow because of the arithmetic. Everything below
   * is scalars over flat typed arrays.
   */
  const localTime = (c) => {
    for (let s = 0; s < SPAN; s++) {
      const i = (c - WINDOW + s + n * 2) % n;
      const ia = (i - KGAP + n) % n, ie = (i + KGAP) % n;
      const ax = CX[ia] + d[ia] * nx[ia], ay = CY[ia] + d[ia] * ny[ia];
      const bx = CX[i] + d[i] * nx[i], by = CY[i] + d[i] * ny[i];
      const ex = CX[ie] + d[ie] * nx[ie], ey = CY[ie] + d[ie] * ny[ie];
      const abx = bx - ax, aby = by - ay, aex = ex - ax, aey = ey - ay;
      const den = Math.hypot(abx, aby) * Math.hypot(ex - bx, ey - by) * Math.hypot(aex, aey);
      const k = den > 1e-12 ? 2 * Math.abs(abx * aey - aby * aex) / den : 0;
      vw[s] = k > 1e-9 ? Math.min(car.vMax, Math.sqrt(car.aLat / k)) : car.vMax;
    }
    // pin the ends to the full-lap answer, so the window cannot invent speed it
    // could never have arrived with, or leave with
    const v0 = v[(c - WINDOW + n * 2) % n], v1 = v[(c + WINDOW) % n];
    if (vw[0] > v0) vw[0] = v0;
    if (vw[SPAN - 1] > v1) vw[SPAN - 1] = v1;
    for (let s = SPAN - 2; s >= 0; s--) {
      const lim = Math.sqrt(vw[s + 1] * vw[s + 1] + dvB);
      if (vw[s] > lim) vw[s] = lim;
    }
    for (let s = 1; s < SPAN; s++) {
      const lim = Math.sqrt(vw[s - 1] * vw[s - 1] + dvP);
      if (vw[s] > lim) vw[s] = lim;
    }
    let t = 0;
    for (let s = 0; s < SPAN - 1; s++) t += 2 * ds / (vw[s] + vw[s + 1]);
    return t;
  };

  /* ★ THE SEARCH MOVES A REGION, NOT A NODE, and that is the difference between
   * a search that finds late apexes and one that finds nothing.
   *
   * Nudging a single node of 1 400 changes the line by a fraction of a millimetre
   * over a metre and a half of track: the lap time does not measurably move, so
   * every trial is rejected, and 1 400 rejected trials is a very expensive way to
   * return the line you started with. Worse, if any of them are accepted the line
   * gets a one-node spike in it, which the curvature stencil then reads as a
   * hairpin.
   *
   * What actually distinguishes a late apex from a geometric one is where a whole
   * stretch of road sits — twenty metres of it, not one point. So a trial adds a
   * raised-cosine bump across ±K nodes, tapering to nothing at both ends so the
   * line stays smooth by construction and no clamp or re-smoothing is needed
   * afterwards. It is also a twentieth of the trials, which is what makes the
   * whole stage affordable at this resolution.
   */
  const K = Math.max(6, Math.round(n / 110));
  const bump = new Float64Array(2 * K + 1);
  for (let s = 0; s <= 2 * K; s++) bump[s] = 0.5 - 0.5 * Math.cos(Math.PI * s / K);
  const keep = new Float64Array(2 * K + 1);

  const apply = (c, amp) => {
    for (let s = 0; s <= 2 * K; s++) {
      const i = (c - K + s + n * 2) % n;
      d[i] = clamp(keep[s] + amp * bump[s]);
    }
  };
  const save = (c) => {
    for (let s = 0; s <= 2 * K; s++) keep[s] = d[(c - K + s + n * 2) % n];
  };
  const restore = (c) => {
    for (let s = 0; s <= 2 * K; s++) d[(c - K + s + n * 2) % n] = keep[s];
  };

  /* Coarse to fine: the first step is a quarter of the road, which is enough to
     carry an apex most of the way across a corner in one move; the last is a
     fortieth, which settles it. The stride is half the bump so neighbouring trial
     regions overlap and no stretch of road is only ever moved by its own edge. */
  const stride = Math.max(1, Math.floor(K / 2));
  for (let stage = 0; stage < 5; stage++) {
    const step = w * 0.25 * Math.pow(0.55, stage);
    for (let sweep = 0; sweep < 3; sweep++) {
      let moved = 0;
      for (let c = 0; c < n; c += stride) {
        save(c);
        let best = localTime(c), pick = 0;
        for (const amp of [step, -step]) {
          apply(c, amp);
          const tt = localTime(c);
          if (tt < best - 1e-9) { best = tt; pick = amp; }
          restore(c);
        }
        if (pick) { apply(c, pick); moved++; }
      }
      /* The window's boundary speeds came from `v`, which a sweep has just made
         stale. Re-solving here is what stops the descent optimising against its
         own out-of-date picture of the lap. */
      line = build(d);
      v = speedProfile(line, ds, car);
      if (!moved) break;                    // this step size has nothing left
    }
  }

  /* ★ AND CHECK. Descent on a windowed objective is a heuristic — it is not
     guaranteed to improve the thing it is a proxy for. Measuring the whole lap
     once, against the line we started from, costs one profile and makes the whole
     stage safe to have: if it did not help, the minimum-curvature line goes out
     instead and the figure is merely conservative rather than wrong. */
  const t1 = spanTime(v, ds, 0, n, n);
  if (!(t1 < t0)) {
    return { line: build(geo), d: geo, nx, ny, halfWidth: w, geometric: true,
             lap: t0, gain: 0 };
  }
  return { line, d, nx, ny, halfWidth: w, geometric: false,
           lap: t1, gain: (t0 - t1) };
}

/** the closed smooth loop as an SVG `d`, cubic Béziers through every point */
export function loopPath(pts, alpha = 0.5) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map(p => `${p[0]} ${p[1]}`).join('L') + 'Z';
  const r = (v) => Math.round(v * 100) / 100;   // 0.01 trace units, far under a pixel

  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p1 = at(pts, i), p2 = at(pts, i + 1);
    const [c1, c2] = span(at(pts, i - 1), p1, p2, at(pts, i + 2), alpha);
    d += `C${r(c1[0])} ${r(c1[1])},${r(c2[0])} ${r(c2[1])},${r(p2[0])} ${r(p2[1])}`;
  }
  // the final span already lands back on pts[0]; Z welds the join so the round
  // linejoin applies there too, instead of two butt caps meeting on the line
  return d + 'Z';
}

/**
 * The same closed smooth loop, flattened to points roughly `step` apart —
 * for the canvas figure, which has no Path2D of its own to follow and needs to
 * walk the line to place particles and read curvature off it.
 *
 * Spacing is approximate on purpose: each span is subdivided by its chord
 * length, so a long straight gets many samples and a hairpin gets few relative
 * to its arc. That is close enough for a flow field and costs one pass.
 */
export function loopSample(pts, step, alpha = 0.5) {
  const n = pts.length;
  if (n < 3) return pts.map(p => p.slice());
  const out = [];
  for (let i = 0; i < n; i++) {
    const p1 = at(pts, i), p2 = at(pts, i + 1);
    const [c1, c2] = span(at(pts, i - 1), p1, p2, at(pts, i + 2), alpha);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(chord / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      out.push([
        a * p1[0] + b * c1[0] + c * c2[0] + e * p2[0],
        a * p1[1] + b * c1[1] + c * c2[1] + e * p2[1],
      ]);
    }
  }
  return out;
}
