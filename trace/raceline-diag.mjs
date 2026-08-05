/* ===========================================================================
 * trace/raceline-diag.mjs — where does §03's racing line actually sit?
 *
 *     node trace/raceline-diag.mjs                  the phase table, every circuit
 *     node trace/raceline-diag.mjs --svg [outDir]   plus one SVG per circuit
 *     node trace/raceline-diag.mjs --compare        shipped vs true minimum curvature
 *     node trace/raceline-diag.mjs --per-corner     every corner, not just the mean
 *     node trace/raceline-diag.mjs --only=rasbo     one circuit
 *
 * A dev tool, not part of the site, and it needs no browser: it reproduces §03's
 * solve — the same NODES, the same corridor cap, the same fit — directly out of
 * js/loop.js, so the numbers it prints are the numbers the figure draws.
 *
 * ★ WHY THIS EXISTS. Theodor, session 9: "every circuit you have the wrong racing
 * lines. It's not a natural racing line." Every numeric check in verify.mjs was
 * green at the time — `swing` was 1.00, meaning the line reached a kerb, and the
 * sharpest joint was under 25°. Both were true and neither was the question. What
 * nobody was measuring is WHICH kerb, and WHEN: a line that is against the inside
 * kerb on the approach to every corner scores a perfect swing and is not a racing
 * line, it is a piece of string.
 *
 * So the measurement here is positional and phased. For each numbered corner it
 * reports where the line sits, as a fraction of the corridor half-width, signed so
 *
 *     +1  hard against the INSIDE kerb of that corner
 *      0  on the centreline
 *     −1  hard against the OUTSIDE kerb
 *
 * at four moments: on the approach (2% of a lap before the corner run begins), at
 * turn-in, at the apex, and at track-out. A racing line reads roughly
 * −0.9 / −0.85 / +0.95 / −0.85. See trace/RACING-LINES.md for the research this
 * comes from and for the targets each of these has to hit.
 * ======================================================================== */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENUES } from '../data/atlas.js';
import { loopSample, curvature, numberedCorners, racingLine, loopLength,
         resampleUniform, speedProfile, KART, CAR } from '../js/loop.js';

/* the three constants §03 solves with — js/circuit.js. Kept in step by hand, and
   asserted below: if circuit.js changes one of these the tool is measuring a
   different figure from the one that ships. */
const NODES = 2600, HALF_PX = 14, CORRIDOR_CAP = 0.8;
/* the canvas §03 is measured at on a desktop viewport, so `scale` — and therefore
   the corridor, which is specified in screen pixels — matches the real figure */
const W = 1200, H = 560;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.some(a => a === f || a.startsWith(f + '='));
const val = (f, d) => { const a = argv.find(x => x.startsWith(f + '=')); return a ? a.slice(f.length + 1) : d; };
const ONLY = val('--only', null);
const OUT = has('--svg') || has('--compare') ? path.join(HERE, 'raceline-shots') : null;
if (OUT) mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------- §03's setup, reproduced */
function setup(v) {
  const raw = v.track?.path;
  if (!raw || raw.length < 8 || v.track.runway) return null;

  const shaped = v.track.dense ? raw.map(p => p.slice(0, 2)) : loopSample(raw, 3.2);
  const pts = resampleUniform(shaped, NODES);
  const k = curvature(pts);
  const n = pts.length;

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const bw = (x1 - x0) || 1, bh = (y1 - y0) || 1;

  let arc = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; arc += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const mag = Array.from(k, (x) => Math.abs(x) / (6 * (arc / n))).sort((a, b) => a - b);
  const rMin = 1 / mag[Math.floor(n * 0.993)];

  const ROOM = HALF_PX + 8;
  const scale = Math.min((W - ROOM * 2) / bw, (H - ROOM * 2) / bh);
  const half = Math.min(HALF_PX, CORRIDOR_CAP * rMin * scale) / scale;

  /* the same left-of-travel normals racingLine() builds, so an offset measured
     here means what it means in there */
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / L; ny[i] = tx / L;
  }

  const lm = v.track.lengthM;
  return {
    id: v.id, pts, k, n, half, nx, ny, scale, x0, y0, bw, bh, rMin,
    car: lm >= 2000 ? CAR : KART,
    mpu: lm ? lm / loopLength(pts) : 0,
    corners: numberedCorners(pts, k, v.track.corners || 0).map((c, i) => ({ ...c, no: i + 1 })),
  };
}

/* ------------------------------------------------------- the measurement */
/** offset at node i, as a fraction of the half-width, signed +1 = inside kerb */
const at = (S, d, c, i) => {
  const inw = Math.sign(c.turn) || 1;
  return d[((i % S.n) + S.n) % S.n] * inw / S.half;
};

/** is there clear road before this corner? (a corner reached straight off another
    corner is a LINKED one, and is not supposed to track out or re-approach wide —
    see RACING-LINES.md §1.3, so checks 2 and 4 exclude them) */
function standalone(S, c) {
  const gap = Math.round(S.n * 0.03);
  return !S.corners.some(o => o !== c &&
    ((c.from - (o.from + o.len) + S.n) % S.n) < gap);
}

function phases(S, d) {
  const back = Math.round(S.n * 0.02);
  let pre = 0, entry = 0, apex = 0, out = 0, cnt = 0;
  let preOK = 0, preN = 0, outSum = 0, outN = 0, apexFrac = 0;
  const rows = [];
  for (const c of S.corners) {
    const p = at(S, d, c, c.from - back);
    const e = at(S, d, c, c.from);
    let a = -Infinity, ai = c.from;
    for (let j = 0; j < c.len; j++) {
      const x = at(S, d, c, c.from + j);
      if (x > a) { a = x; ai = c.from + j; }
    }
    const o = at(S, d, c, c.from + c.len - 1);
    pre += p; entry += e; apex += a; out += o; cnt++;
    apexFrac += ((ai - c.from + S.n) % S.n) / Math.max(1, c.len - 1);
    if (standalone(S, c)) { preN++; if (p <= -0.30) preOK++; outSum += o; outN++; }
    rows.push({ no: c.no, turnDeg: c.turn * 180 / Math.PI, len: c.len, p, e, a, o,
                linked: !standalone(S, c) });
  }
  let pinned = 0;
  for (const x of d) if (Math.abs(x) > 0.985 * S.half) pinned++;
  let swing = 0;
  for (const x of d) swing = Math.max(swing, Math.abs(x));

  return {
    pre: pre / cnt, entry: entry / cnt, apex: apex / cnt, out: out / cnt,
    apexFrac: apexFrac / cnt,
    preOKFrac: preN ? preOK / preN : 1,
    outStandalone: outN ? outSum / outN : 0,
    pinned: pinned / S.n, swing: swing / S.half, rows,
  };
}

/** sharpest joint anywhere in the drawn line, in screen degrees */
function kink(S, d) {
  const X = (i) => (S.pts[i][0] + d[i] * S.nx[i]) * S.scale;
  const Y = (i) => (S.pts[i][1] + d[i] * S.ny[i]) * S.scale;
  let worst = 0;
  for (let i = 0; i < S.n; i++) {
    const a = (i - 1 + S.n) % S.n, b = (i + 1) % S.n;
    const h1 = Math.atan2(Y(i) - Y(a), X(i) - X(a));
    const h2 = Math.atan2(Y(b) - Y(i), X(b) - X(i));
    let t = h2 - h1;
    while (t > Math.PI) t -= 2 * Math.PI;
    while (t < -Math.PI) t += 2 * Math.PI;
    worst = Math.max(worst, Math.abs(t) * 180 / Math.PI);
  }
  return worst;
}

/** lap time under the same model §03's flow is paced off */
function lapTime(S, d) {
  if (!S.mpu) return 0;
  const L = S.pts.map((p, i) => [p[0] + d[i] * S.nx[i], p[1] + d[i] * S.ny[i]]);
  const ds = loopLength(L) * S.mpu / S.n;
  const v = speedProfile(L, ds, S.car);
  let t = 0;
  for (let i = 0; i < S.n; i++) t += 2 * ds / (v[i] + v[(i + 1) % S.n]);
  return t;
}

/* ------------------------------------------ the objective §03 should solve
 * ★ MINIMUM CURVATURE, FOR COMPARISON ONLY — this is not a proposed implementation,
 * it is the control experiment for RACING-LINES.md §2.2.
 *
 * Stage 1 of racingLine() steps each node toward the MIDPOINT of its neighbours,
 * which is the Laplacian [1 −2 1] — curve-shortening flow, whose fixed point inside
 * a corridor is the SHORTEST path in it, glued to the inside of everything.
 * Minimising ∫κ²ds instead means minimising Σ|P₍ᵢ₋₁₎ − 2Pᵢ + P₍ᵢ₊₁₎|², whose gradient
 * is the biharmonic [1 −4 6 −4 1]. Same corridor, same clamps, same coarse-to-fine
 * schedule; only the stencil differs, and the approach flips from inside to outside.
 *
 * Deliberately naive — projected gradient, fixed step, no line search — because its
 * job is to isolate one variable, not to be fast or to be shipped. */
function minCurvature(S) {
  const { pts, n, nx, ny, half } = S;
  const d = new Float64Array(n);
  const PX = new Float64Array(n), PY = new Float64Array(n);
  const LX = new Float64Array(n), LY = new Float64Array(n);
  const ALPHA = 0.045;              // the stencil's spectral radius is 16
  for (let k = Math.max(1, Math.floor(n / 24)); ; k = Math.floor(k / 2)) {
    for (let it = 0; it < 900; it++) {
      for (let i = 0; i < n; i++) { PX[i] = pts[i][0] + d[i] * nx[i]; PY[i] = pts[i][1] + d[i] * ny[i]; }
      for (let i = 0; i < n; i++) {
        const a = (i - k + 2 * n) % n, b = (i + k) % n;
        LX[i] = PX[a] - 2 * PX[i] + PX[b];
        LY[i] = PY[a] - 2 * PY[i] + PY[b];
      }
      for (let i = 0; i < n; i++) {
        const a = (i - k + 2 * n) % n, b = (i + k) % n;
        const gx = LX[a] - 2 * LX[i] + LX[b], gy = LY[a] - 2 * LY[i] + LY[b];
        const v = d[i] - ALPHA * (gx * nx[i] + gy * ny[i]);
        d[i] = v > half ? half : (v < -half ? -half : v);
      }
    }
    if (k === 1) break;
  }
  return d;
}

/* ------------------------------------------------------------------ SVG */
function svg(S, lines) {
  const ox = (W - S.bw * S.scale) / 2 - S.x0 * S.scale;
  const oy = (H - S.bh * S.scale) / 2 - S.y0 * S.scale;
  const off = (d, mul = 1) => S.pts.map((p, i) => {
    const x = (p[0] + (d ? d[i] : 0) * mul * (d ? 1 : S.half)) * 0 +
              (p[0] + (d ? d[i] : mul * S.half) * S.nx[i]) * S.scale + ox;
    const y = (p[1] + (d ? d[i] : mul * S.half) * S.ny[i]) * S.scale + oy;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ') + ' Z';
  const centre = S.pts.map((p, i) =>
    (i ? 'L' : 'M') + (p[0] * S.scale + ox).toFixed(1) + ' ' + (p[1] * S.scale + oy).toFixed(1)).join(' ') + ' Z';
  const dots = (d) => S.corners.map(c => {
    let a = -Infinity, ai = c.from;
    for (let j = 0; j < c.len; j++) { const x = at(S, d, c, c.from + j); if (x > a) { a = x; ai = (c.from + j) % S.n; } }
    const x = (S.pts[ai][0] + d[ai] * S.nx[ai]) * S.scale + ox;
    const y = (S.pts[ai][1] + d[ai] * S.ny[ai]) * S.scale + oy;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#ff5a5a"/>` +
           `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" fill="#ff9a9a" font-size="10" text-anchor="middle">${c.no}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0b0d10"/>
<path d="${off(null, 1)}" fill="none" stroke="#39424c" stroke-width="1"/>
<path d="${off(null, -1)}" fill="none" stroke="#39424c" stroke-width="1"/>
<path d="${centre}" fill="none" stroke="#4a5560" stroke-width="1" stroke-dasharray="5 6"/>
${lines.map(l => `<path d="${off(l.d)}" fill="none" stroke="${l.colour}" stroke-width="2.2"/>`).join('\n')}
${lines.length === 1 ? dots(lines[0].d) : ''}
<text x="10" y="18" font-size="11" font-family="monospace" fill="#8892a0">${S.id}   ${
  lines.map(l => `<tspan fill="${l.colour}">${l.label}</tspan>`).join('   ')}</text>
</svg>`;
}

/* ----------------------------------------------------------------- run */
const F = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const pad = (s, w) => String(s).padStart(w);

console.log('position of the line, as a fraction of the corridor half-width');
console.log('  +1 = hard against the INSIDE kerb   −1 = hard against the OUTSIDE kerb');
console.log('  a racing line reads about   pre −0.90   in −0.85   apex +0.95   out −0.85\n');
console.log('circuit      trn   pre     in    apex    out   apexAt  pinned  kink   lap     ');
console.log('───────────────────────────────────────────────────────────────────────────────');

const cmp = has('--compare');
for (const v of VENUES) {
  if (ONLY && v.id !== ONLY) continue;
  const S = setup(v);
  if (!S) continue;

  const r = racingLine(S.pts, S.half, { car: S.car, metresPerUnit: S.mpu });
  const m = phases(S, r.d);
  console.log(
    `${S.id.padEnd(12)}${pad(S.corners.length, 3)} ${pad(F(m.pre), 6)} ${pad(F(m.entry), 6)} ` +
    `${pad(F(m.apex), 6)} ${pad(F(m.out), 6)}   ${m.apexFrac.toFixed(2)}   ` +
    `${pad((100 * m.pinned).toFixed(0) + '%', 5)} ${pad(kink(S, r.d).toFixed(1) + '°', 6)} ` +
    `${lapTime(S, r.d).toFixed(1)}s`);

  if (has('--per-corner')) {
    for (const row of m.rows) {
      console.log(`   T${pad(row.no, 2)} ${pad(row.turnDeg.toFixed(0) + '°', 5)} len=${pad(row.len, 4)}  ` +
        `pre ${F(row.p)}  in ${F(row.e)}  apex ${F(row.a)}  out ${F(row.o)}` +
        (row.linked ? '   (linked)' : ''));
    }
  }

  if (cmp) {
    const mc = minCurvature(S);
    const m2 = phases(S, mc);
    console.log(`${''.padEnd(12)}    ${pad(F(m2.pre), 6)} ${pad(F(m2.entry), 6)} ${pad(F(m2.apex), 6)} ` +
      `${pad(F(m2.out), 6)}   ${m2.apexFrac.toFixed(2)}   ${pad((100 * m2.pinned).toFixed(0) + '%', 5)} ` +
      `${pad(kink(S, mc).toFixed(1) + '°', 6)} ${lapTime(S, mc).toFixed(1)}s   ← true min-curvature`);
    if (OUT) writeFileSync(path.join(OUT, `cmp-${S.id}.svg`), svg(S, [
      { d: r.d, colour: '#ff6b6b', label: 'shipped' },
      { d: mc, colour: '#34E0C4', label: 'min-curvature' },
    ]));
  } else if (OUT) {
    writeFileSync(path.join(OUT, `${S.id}.svg`), svg(S, [{ d: r.d, colour: '#34E0C4', label: 'racing line' }]));
  }
}

if (OUT) console.log(`\nSVGs written to ${OUT}`);
console.log('\ntargets and the research behind them: trace/RACING-LINES.md');
