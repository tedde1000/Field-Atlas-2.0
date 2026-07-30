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
export function racingLine(pts, halfWidth) {
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

  const line = new Array(n);
  for (let i = 0; i < n; i++) {
    line[i] = [pts[i][0] + d[i] * nx[i], pts[i][1] + d[i] * ny[i]];
  }
  return { line, d, nx, ny, halfWidth: w };
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
