/* ===========================================================================
 * circuit.js — §03, "anatomy of a circuit".
 *
 * Takes a traced centreline (the 1000x640 viewBox paths in data/atlas.js) and
 * runs a field of particles round it. Speed is modulated by local curvature, so
 * the plot slows into the corners and lets go down the straights — which is the
 * whole point of the figure: it shows you where the panning shots are.
 *
 * Corners are found by walking heading change, then the four sharpest
 * well-separated ones get called out. Where the 1.x layout carried real corner
 * NAMES (Gelleråsen), those win over the generated numbering.
 * ======================================================================== */

import { loopSample } from './loop.js';

const TAU = Math.PI * 2;

/* the flow is drawn as one path per alpha band rather than one per particle —
   see the note in paint(). ALPHA_MAX is the ceiling of the per-particle alpha
   formula there: 0.74 (max p.a) × 0.72 (night) × 1.0 (zero curvature). */
const ALPHA_STEPS = 7;
const ALPHA_MAX = 0.62;
const buckets = new Array(ALPHA_STEPS).fill(null);

/** heading change per node, smoothed — the curvature signal everything reads */
function curvature(p, window = 3) {
  const n = p.length, k = new Float32Array(n);
  const head = (i) => {
    const a = p[i % n], b = p[(i + 1) % n];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (let i = 0; i < n; i++) {
    let d = head(i + window) - head((i - window + n) % n);
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    k[i] = d;
  }
  return k;
}

/** runs of same-signed turn above the threshold -> one corner each */
function findCorners(p, k, thresholdDeg = 30) {
  const n = p.length, out = [];
  let run = 0, sign = 0, start = 0, peak = 0, peakAt = 0;
  const close = (end) => {
    if (Math.abs(run) * 180 / Math.PI >= thresholdDeg) {
      out.push({ i: peakAt, at: Math.round((start + end) / 2) % n, turn: run, peak: Math.abs(peak) });
    }
  };
  for (let i = 0; i < n + 8; i++) {
    const idx = i % n;
    const d = k[idx];
    const s = d > 0.012 ? 1 : (d < -0.012 ? -1 : 0);
    if (s !== 0 && s === sign) {
      run += d;
      if (Math.abs(d) > Math.abs(peak)) { peak = d; peakAt = idx; }
    } else {
      close(idx);
      run = s ? d : 0; sign = s; start = idx; peak = d; peakAt = idx;
    }
  }
  // keep the sharpest, but never two within a tenth of the lap
  out.sort((a, b) => b.peak - a.peak);
  const kept = [];
  for (const c of out) {
    if (kept.every(o => {
      const d = Math.abs(o.i - c.i);
      return Math.min(d, n - d) > n * 0.1;
    })) kept.push(c);
    if (kept.length >= 4) break;
  }
  return kept.sort((a, b) => a.i - b.i);
}

/* =========================================================================== */
export function createCircuitFigure(canvas) {
  const ctx = canvas.getContext('2d');
  const tokens = getComputedStyle(document.documentElement);
  const tok = (n, f) => (tokens.getPropertyValue(n).trim() || f);

  const S = {
    w: 0, h: 0, dpr: 1, running: true, motion: true,
    pts: null, k: null, corners: [], names: null, colour: null, id: null,
    scale: 1, ox: 0, oy: 0, particles: [], reveal: 0, t0: 0,
    under: null, over: null, stillKey: null,   // the cached still layers
    tPrev: 0,                                  // for time-based particle advance
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    S.dpr = dpr;
    S.w = Math.max(1, Math.round(rect.width));
    S.h = Math.max(1, Math.round(rect.height));
    canvas.width = S.w * dpr; canvas.height = S.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fit();
    S.stillKey = null;              // the cached layers are the wrong size now
  }

  /* fit the 1000x640 trace into the canvas with room for the callout labels */
  function fit() {
    if (!S.pts) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of S.pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    const padX = S.w < 620 ? 46 : 118, padY = S.w < 620 ? 58 : 76;
    const s = Math.min((S.w - padX * 2) / (x1 - x0 || 1), (S.h - padY * 2) / (y1 - y0 || 1));
    S.scale = s;
    S.ox = (S.w - (x1 - x0) * s) / 2 - x0 * s;
    S.oy = (S.h - (y1 - y0) * s) / 2 - y0 * s;
  }
  const X = (p) => p[0] * S.scale + S.ox;
  const Y = (p) => p[1] * S.scale + S.oy;

  /* ------------------------------------------------------------- loading */
  function load(track) {
    const raw = track.path;
    if (!raw || raw.length < 8) { S.pts = null; return; }
    S.id = track.id || null;
    S.stillKey = null;              // different track, different still layers
    /* ★ The figure must show the SAME circuit the SVG layouts do.
     *
     * `dense` means main.js already flattened the real geometry for us — the
     * drawn artwork, or a hand trace drawn through 1.x's corner radii — so
     * these points ARE the curve and re-splining them would only round off
     * corners that were designed. Only a bare sampled centreline gets a spline,
     * and only because its points really are meant to lie on one; drawn as
     * straight chords it gave the ribbon a crease at every sample and made the
     * curvature signal read as spike-and-flat instead of as a corner, which the
     * particles then stuttered through. See js/loop.js. */
    S.pts = track.dense ? raw.map(p => p.slice(0, 2)) : loopSample(raw, 3.2);
    S.k = curvature(S.pts);
    S.names = track.cornerNames || null;
    S.colour = track.colour || tok('--accent', '#c9974f');
    S.corners = findCorners(S.pts, S.k);

    // real names win: snap each to the nearest point on the trace
    if (S.names && S.names.length) {
      S.corners = S.names.map(nm => {
        let best = 0, bd = Infinity;
        for (let i = 0; i < S.pts.length; i++) {
          const d = (S.pts[i][0] - nm.x) ** 2 + (S.pts[i][1] - nm.y) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        // no angle for a named corner: the label is snapped to the trace, so the
        // curvature under it is a local reading, not the corner's real total
        return { i: best, label: nm.label, turn: null };
      }).slice(0, 5);
    }

    const n = S.pts.length;
    S.particles = Array.from({ length: 900 }, () => ({
      s: Math.random() * n,
      off: (Math.random() - 0.5) * 2,      // lateral scatter, in trace units
      v: 0.72 + Math.random() * 0.62,      // per-particle pace
      a: 0.14 + Math.random() * 0.6,
    }));
    S.reveal = 0; S.t0 = performance.now(); S.tPrev = S.t0;
    fit();
  }

  /* ============================================== the still layers
   * ★ Everything except the particles is the same picture every frame: the graph
   * paper, the wide tarmac ribbon, the start/finish bar and the corner callouts.
   * Re-stroking the ribbon was the expensive part — it is a ~21px round-joined
   * polyline over 1300 points, and tessellating that per frame is what held §03
   * at 8 fps. It is now rendered into two offscreen canvases and blitted, and
   * rebuilt only when something it depends on actually changes: the track, the
   * canvas size, the theme, or the reveal animation still being in flight.
   * Once the reveal finishes, this stops rebuilding entirely.
   * ============================================================== */
  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(S.w * S.dpr));
    c.height = Math.max(1, Math.round(S.h * S.dpr));
    const g = c.getContext('2d');
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    return { c, g };
  }

  function buildStill(shown, n, isDay, accent) {
    const { w, h } = S;
    const under = makeLayer(), over = makeLayer();
    const g = under.g;

    // -- graph paper
    g.strokeStyle = isDay ? 'rgba(22,21,15,.05)' : 'rgba(236,229,217,.035)';
    g.lineWidth = 1;
    const gr = 46;
    g.beginPath();
    for (let x = (S.ox % gr + gr) % gr; x < w; x += gr) { g.moveTo(x, 0); g.lineTo(x, h); }
    for (let y = (S.oy % gr + gr) % gr; y < h; y += gr) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();

    // -- the tarmac: a wide dim ribbon under the flow
    const ribbon = () => {
      g.beginPath();
      g.moveTo(X(S.pts[0]), Y(S.pts[0]));
      for (let i = 1; i < shown; i++) g.lineTo(X(S.pts[i]), Y(S.pts[i]));
      if (shown >= n) g.closePath();
    };
    g.lineJoin = g.lineCap = 'round';
    ribbon();
    g.strokeStyle = isDay ? 'rgba(22,21,15,.10)' : 'rgba(236,229,217,.075)';
    g.lineWidth = Math.max(9, 15 * S.scale / 0.55);
    g.stroke();
    ribbon();
    g.strokeStyle = isDay ? 'rgba(22,21,15,.22)' : 'rgba(236,229,217,.14)';
    g.lineWidth = 1.1;
    g.stroke();

    drawMarks(over.g, shown, n, isDay, accent);
    S.under = under.c;
    S.over = over.c;
  }

  /* -------------------------------------------------------------- paint */
  function paint(now) {
    const { w, h } = S;
    ctx.clearRect(0, 0, w, h);
    if (!S.pts) return;
    const isDay = document.documentElement.dataset.theme === 'day';
    const n = S.pts.length;
    const accent = S.colour;

    // trace reveal: the line draws itself once on load
    S.reveal = Math.min(1, (now - S.t0) / 1500);
    const ease = 1 - Math.pow(1 - S.reveal, 3);
    const shown = S.motion ? Math.max(2, Math.floor(n * ease)) : n;

    // while the reveal is running `shown` changes, so the key does too and the
    // layers rebuild; once it lands the key goes constant and they stop
    const key = `${isDay ? 'd' : 'n'}|${w}x${h}|${S.id}|${S.reveal >= 1 ? 'done' : shown}`;
    if (key !== S.stillKey) { buildStill(shown, n, isDay, accent); S.stillKey = key; }

    ctx.drawImage(S.under, 0, 0, w, h);

    // -- the flow
    if (shown >= n * 0.98) {
      /* ★ Advance by ELAPSED TIME, not by one unit per frame. The original code
         added a fixed step per call, so the flow ran at whatever speed the
         reader's frame rate happened to be — and capping this canvas at 30 Hz
         would otherwise have silently halved it. One unit still means one
         60 Hz frame, so the figure looks exactly as it was designed. */
      const dt = S.motion ? Math.min(3, (now - S.tPrev) / (1000 / 60)) : 0;
      S.tPrev = now;
      ctx.globalCompositeOperation = isDay ? 'source-over' : 'lighter';

      /* ★ One stroke() per particle was 900 rasterisation passes a frame and the
         reason §03 sat at 8 fps. Every segment is the same colour and the same
         width — only the alpha differs — so the segments are bucketed by alpha
         into ALPHA_STEPS paths and stroked once each. 900 stroke calls become 7.
         The bucketing is invisible: the alphas run 0…0.62 and the eye cannot
         separate neighbouring ninths of that on a 1.25px line. */
      for (let i = 0; i < ALPHA_STEPS; i++) buckets[i] = null;

      for (const p of S.particles) {
        const i = Math.floor(p.s) % n;
        const kk = Math.abs(S.k[i]);
        // slow into the corners, release on the straights
        const speed = p.v * (0.34 + 0.66 / (1 + kk * 11));
        p.s = (p.s + speed * 0.85 * dt) % n;

        const a = S.pts[i], b = S.pts[(i + 3) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * p.off, ny = dx / L * p.off;

        const x = (a[0] + nx) * S.scale + S.ox;
        const y = (a[1] + ny) * S.scale + S.oy;
        const j = Math.floor(p.s - speed * 5 + n) % n;
        const c = S.pts[j];
        const tx = (c[0] + nx) * S.scale + S.ox;
        const ty = (c[1] + ny) * S.scale + S.oy;

        const alpha = p.a * (isDay ? 0.62 : 0.72) * (0.45 + 0.55 * (1 - Math.min(1, kk * 8)));
        let bi = Math.floor(alpha / ALPHA_MAX * ALPHA_STEPS);
        if (bi < 0) bi = 0; else if (bi >= ALPHA_STEPS) bi = ALPHA_STEPS - 1;
        (buckets[bi] || (buckets[bi] = new Path2D())).moveTo(tx, ty);
        buckets[bi].lineTo(x, y);
      }

      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.25;
      for (let i = 0; i < ALPHA_STEPS; i++) {
        if (!buckets[i]) continue;
        ctx.globalAlpha = (i + 0.5) / ALPHA_STEPS * ALPHA_MAX;
        ctx.stroke(buckets[i]);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // -- the still marks that sit above the flow
    ctx.drawImage(S.over, 0, 0, w, h);
  }

  /** start/finish bar and the corner callouts — baked into the `over` layer */
  function drawMarks(g, shown, n, isDay, accent) {
    // -- start / finish
    if (shown >= n * 0.98) {
      const a = S.pts[0], b = S.pts[4 % n];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
      const len = Math.max(9, 13 * S.scale / 0.55);
      const x = X(a), y = Y(a);
      g.strokeStyle = isDay ? 'rgba(22,21,15,.6)' : 'rgba(236,229,217,.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.lineTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len);
      g.stroke();
      label(g, x + Math.cos(ang) * (len + 10), y + Math.sin(ang) * (len + 10), 'S/F', tok('--ink-3', '#6c675f'), 'centre');
    }

    // -- callouts: dashed ring, leader line, name
    if (shown >= n * 0.9) {
      g.save();
      const alpha = Math.min(1, (S.reveal - 0.55) / 0.45);
      g.globalAlpha = Math.max(0, alpha);
      S.corners.forEach((c, idx) => {
        const p = S.pts[c.i];
        const x = X(p), y = Y(p);
        const r = 22;
        g.setLineDash([3, 4]);
        g.strokeStyle = accent; g.lineWidth = 1;
        g.globalAlpha = Math.max(0, alpha) * 0.6;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        g.setLineDash([]);

        // lead outward, away from the centre of the plot
        const outX = Math.sign(x - S.w / 2) || 1;
        const lx = x + outX * (r + 34), ly = y - 26;
        g.globalAlpha = Math.max(0, alpha) * 0.85;
        g.beginPath();
        g.moveTo(x + outX * r * 0.72, y - r * 0.72);
        g.lineTo(lx, ly);
        g.stroke();

        const text = c.label || `T${idx + 1} · ${Math.abs(Math.round((c.turn || 0) * 180 / Math.PI))}°`;
        label(g, lx + outX * 6, ly - 4, text, accent, outX > 0 ? 'left' : 'right');
      });
      g.restore();
    }
  }

  function label(g, x, y, text, colour, align) {
    g.font = '500 10px ' + tok('--font-mono', 'monospace').replace(/'/g, '');
    g.fillStyle = colour;
    g.textAlign = align === 'centre' ? 'center' : (align === 'right' ? 'right' : 'left');
    g.textBaseline = 'alphabetic';
    g.save();
    g.letterSpacing = '1.6px';
    g.fillText(text, x, y);
    g.restore();
  }

  /* 30 Hz, not 60. This canvas is as wide as the measure and up to 560px tall,
     and every repaint forces the page to re-composite through #scrim and the
     topbar's backdrop-filter — so the repaint RATE is the cost, not the 900
     particles. At 30 Hz the flow still reads as continuous motion. */
  let raf = 0, lastPaint = -1e9, paints = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!S.running) return;
    if (now - lastPaint < 1000 / 30) return;
    lastPaint = now;
    canvas.dataset.paints = ++paints;   // verify.mjs §8 asserts the repaint rate
    paint(now);
  }
  raf = requestAnimationFrame(frame);

  return {
    load(track) { load(track); },
    resize() { resize(); },
    corners: () => S.corners.map((c, i) => ({
      label: c.label || `T${i + 1}`,
      turn: c.turn == null ? null : Math.abs(Math.round(c.turn * 180 / Math.PI)),
    })),
    setMotion(on) { S.motion = on; },
    pause() { S.running = false; },
    resume() { S.running = true; lastPaint = -1e9; },
    destroy() { cancelAnimationFrame(raf); },
  };
}
