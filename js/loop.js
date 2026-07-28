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
