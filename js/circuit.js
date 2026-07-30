/* ===========================================================================
 * circuit.js — §03, "anatomy of a circuit".
 *
 * ★ THE FIGURE DRAWS A RACING LINE NOW, AND IT DID NOT BEFORE.
 *
 * Theodor: "on the anatomy of a circuit, change it so it's more like a racing
 * line — take the line and make it go wide and then, yeah, for the apex in the
 * corners. Also make the line a bit more clear."
 *
 * What it used to draw was the traced CENTRELINE, with a field of particles
 * scattered either side of it by a random per-particle constant. So the flow ran
 * down the middle of the road for the whole lap: no entry, no apex, no exit, and
 * a corner that looked like a straight with more bend in it. The section had been
 * captioned "RACING LINE" since session 1 and had never shown one.
 *
 * It now solves for the line properly — see racingLine() in js/loop.js, which
 * relaxes a lateral offset per node toward minimum curvature inside a corridor
 * the width of the track. Wide in, apex, wide out, and none of it hand-authored.
 * The figure draws, from the bottom up:
 *
 *     graph paper                 unchanged
 *     the tarmac, ±half a width   with both edges struck, so "going wide" reads
 *     the centreline, dashed      what the racing line is measured against
 *     the racing line             solid accent, the subject of the figure
 *     the flow                    particles ON the line, slowing into the apexes
 *     numbered corners + apexes   every corner the spec table claims, numbered
 *
 * Corners are no longer found here: loop.js owns that, and numbers exactly as
 * many of them as `track.corners` says exist, so the figure and the spec sheet
 * can never disagree. Where 1.x carried real corner NAMES (Gelleråsen) they are
 * printed with the number rather than instead of it.
 * ======================================================================== */

import { loopSample, curvature, numberedCorners, racingLine } from './loop.js';

const TAU = Math.PI * 2;

/* the flow is drawn as one path per alpha band rather than one per particle —
   see the note in paint(). ALPHA_MAX is the ceiling of the per-particle alpha
   formula there: 0.74 (max p.a) × 0.72 (night) × 1.0 (zero curvature). */
const ALPHA_STEPS = 7;
const ALPHA_MAX = 0.62;
const buckets = new Array(ALPHA_STEPS).fill(null);

/* ★ HALF THE TRACK, IN SCREEN PIXELS, AND DELIBERATELY NOT TO SCALE.
 *
 * A karting circuit is about 8–10 m wide on a 1 200 m lap, so drawn true to
 * scale at the width of the measure the corridor would be four pixels across and
 * the racing line would have nowhere to go — the whole point of the figure is the
 * lateral movement, and at true scale it is invisible. So the corridor is a fixed
 * 28 px on screen at every zoom, the figure legend says the width is exaggerated,
 * and the numbers next to it stay the measured ones. Screen pixels rather than
 * trace units because the three geometry sources have three different artboards;
 * converted through S.scale in fit(). */
const HALF_PX = 14;

/* =========================================================================== */
export function createCircuitFigure(canvas) {
  const ctx = canvas.getContext('2d');
  const tokens = getComputedStyle(document.documentElement);
  const tok = (n, f) => (tokens.getPropertyValue(n).trim() || f);

  const S = {
    w: 0, h: 0, dpr: 1, running: true, motion: true,
    pts: null,            // the centreline
    line: null,           // the racing line
    d: null, nx: null, ny: null, half: 0,   // the solved offset and its frame
    k: null,              // centreline curvature — corners are found off this
    rk: null,             // racing-line curvature — the flow is paced off this
    corners: [], names: null, colour: null, id: null, target: 0,
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

  /* fit the trace into the canvas with room for the callout labels, then solve
     the racing line — the corridor is specified in screen pixels, so it cannot
     be solved until we know how many trace units a pixel is worth */
  function fit() {
    if (!S.pts) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of S.pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    /* the padding has to clear the corridor AND the numerals sitting outside it,
       or a corner on the bounding box gets its number clipped by the frame */
    const padX = S.w < 620 ? 40 : 96, padY = S.w < 620 ? 46 : 62;
    const room = HALF_PX + 22;
    const s = Math.min((S.w - (padX + room) * 2) / (x1 - x0 || 1),
                       (S.h - (padY + room) * 2) / (y1 - y0 || 1));
    S.scale = s;
    S.ox = (S.w - (x1 - x0) * s) / 2 - x0 * s;
    S.oy = (S.h - (y1 - y0) * s) / 2 - y0 * s;
    solve();
  }
  const X = (p) => p[0] * S.scale + S.ox;
  const Y = (p) => p[1] * S.scale + S.oy;
  /* a point on the centreline pushed `px` screen pixels along its own normal */
  const offX = (i, px) => (S.pts[i][0] + S.nx[i] * px / S.scale) * S.scale + S.ox;
  const offY = (i, px) => (S.pts[i][1] + S.ny[i] * px / S.scale) * S.scale + S.oy;

  function solve() {
    if (!S.pts || !S.scale) return;
    S.half = HALF_PX / S.scale;
    const r = racingLine(S.pts, S.half);
    S.line = r.line; S.d = r.d; S.nx = r.nx; S.ny = r.ny;
    S.rk = curvature(S.line);
    S.stillKey = null;
  }

  /* ------------------------------------------------------------- loading */
  function load(track) {
    const raw = track.path;
    if (!raw || raw.length < 8) { S.pts = S.line = null; return; }
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

    /* number exactly as many corners as the measured data claims — an air base
       has none, and reports runways instead. See numberedCorners() in loop.js. */
    S.target = track.track?.runway ? 0 : (track.track?.corners || 0);
    S.corners = S.target === 0 && track.track?.runway
      ? []
      : numberedCorners(S.pts, S.k, S.target).map((c, idx) => ({ ...c, no: idx + 1 }));

    /* real names win for the LABEL, never for the numbering: snap each name to
       the nearest numbered corner rather than to the nearest node, so "T7 ·
       SÖDRA" is the same turn the spec table counted */
    if (S.names && S.names.length && S.corners.length) {
      for (const nm of S.names) {
        let best = null, bd = Infinity;
        for (const c of S.corners) {
          const p = S.pts[c.i];
          const dd = (p[0] - nm.x) ** 2 + (p[1] - nm.y) ** 2;
          if (dd < bd) { bd = dd; best = c; }
        }
        if (best && !best.label) best.label = nm.label;
      }
    }

    const n = S.pts.length;
    S.particles = Array.from({ length: 900 }, () => ({
      s: Math.random() * n,
      /* ★ ±1.4px, not ±half the road. The scatter used to be ±1 trace unit about
         the CENTRELINE, which at these scales spread the flow across most of the
         tarmac and was doing the work the racing line does now. The particles are
         ON the line; the scatter is only so the ribbon has body. */
      off: (Math.random() - 0.5) * 2.8,
      v: 0.72 + Math.random() * 0.62,      // per-particle pace
      a: 0.14 + Math.random() * 0.6,
    }));
    S.reveal = 0; S.t0 = performance.now(); S.tPrev = S.t0;
    fit();
  }

  /* ============================================== the still layers
   * ★ Everything except the particles is the same picture every frame: the graph
   * paper, the tarmac and its edges, the dashed centreline, the racing line, the
   * start/finish bar and the numbered corners. Re-stroking the tarmac was the
   * expensive part — it is a ~28px round-joined polyline over 1300 points, and
   * tessellating that per frame is what held §03 at 8 fps. It is rendered into
   * two offscreen canvases and blitted, and rebuilt only when something it
   * depends on actually changes: the track, the canvas size, the theme, or the
   * reveal animation still being in flight. Once the reveal finishes, this stops
   * rebuilding entirely.
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

    g.lineJoin = g.lineCap = 'round';

    /* -- the tarmac: one wide dim stroke down the centreline. Its width IS the
          corridor the racing line was solved in, so the line can never appear to
          leave the road. */
    const ribbon = (path) => {
      g.beginPath();
      g.moveTo(path(0)[0], path(0)[1]);
      for (let i = 1; i < shown; i++) { const p = path(i); g.lineTo(p[0], p[1]); }
      if (shown >= n) g.closePath();
    };
    const centre = (i) => [X(S.pts[i]), Y(S.pts[i])];
    ribbon(centre);
    g.strokeStyle = isDay ? 'rgba(22,21,15,.11)' : 'rgba(236,229,217,.075)';
    g.lineWidth = HALF_PX * 2;
    g.stroke();

    /* -- both edges of the road, struck thin. Without these the corridor has no
          boundary and "wide" has nothing to be wide OF. */
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(offX(0, side * HALF_PX), offY(0, side * HALF_PX));
      for (let i = 1; i < shown; i++) g.lineTo(offX(i, side * HALF_PX), offY(i, side * HALF_PX));
      if (shown >= n) g.closePath();
      g.strokeStyle = isDay ? 'rgba(22,21,15,.30)' : 'rgba(236,229,217,.20)';
      g.lineWidth = 1.1;
      g.stroke();
    }

    // -- the centreline, dashed and quiet: what the racing line departs from
    g.save();
    g.setLineDash([2, 7]);
    ribbon(centre);
    g.strokeStyle = isDay ? 'rgba(22,21,15,.24)' : 'rgba(236,229,217,.15)';
    g.lineWidth = 1;
    g.stroke();
    g.restore();

    /* -- the racing line itself, and it is the subject of the figure: a soft wide
          pass for the glow, then the line. "Make the line a bit more clear." */
    const rline = (i) => [X(S.line[i]), Y(S.line[i])];
    ribbon(rline);
    g.strokeStyle = accent;
    g.globalAlpha = 0.14;
    g.lineWidth = 7;
    g.stroke();
    g.globalAlpha = isDay ? 0.95 : 0.8;
    g.lineWidth = 2.3;
    g.stroke();
    g.globalAlpha = 1;

    drawMarks(over.g, shown, n, isDay, accent);
    S.under = under.c;
    S.over = over.c;
  }

  /* -------------------------------------------------------------- paint */
  function paint(now) {
    const { w, h } = S;
    ctx.clearRect(0, 0, w, h);
    if (!S.pts || !S.line) return;
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

    // -- the flow, which now runs ON the racing line
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
        /* paced off the RACING LINE's curvature, not the centreline's — that is
           the whole reading of the figure: a driver on the line is slow at the
           apex and already accelerating where the centreline is still bending */
        const kk = Math.abs(S.rk[i]);
        const speed = p.v * (0.34 + 0.66 / (1 + kk * 11));
        p.s = (p.s + speed * 0.85 * dt) % n;

        const a = S.line[i], b = S.line[(i + 3) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        // the scatter is in screen pixels about the line, hence the /S.scale
        const sc = p.off / S.scale;
        const nxp = -dy / L * sc, nyp = dx / L * sc;

        const x = (a[0] + nxp) * S.scale + S.ox;
        const y = (a[1] + nyp) * S.scale + S.oy;
        const j = Math.floor(p.s - speed * 5 + n) % n;
        const c = S.line[j];
        const tx = (c[0] + nxp) * S.scale + S.ox;
        const ty = (c[1] + nyp) * S.scale + S.oy;

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

  /** start/finish bar, apex ticks and the numbered corners — baked into `over` */
  function drawMarks(g, shown, n, isDay, accent) {
    const ink3 = tok('--ink-3', '#6c675f');
    const ink = tok('--ink', '#ece5d9');

    // -- start / finish, struck across the whole road rather than a stub
    if (shown >= n * 0.98) {
      const x0 = offX(0, -HALF_PX), y0 = offY(0, -HALF_PX);
      const x1 = offX(0, HALF_PX), y1 = offY(0, HALF_PX);
      g.strokeStyle = isDay ? 'rgba(22,21,15,.62)' : 'rgba(236,229,217,.6)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const lx = offX(0, -(HALF_PX + 13)), ly = offY(0, -(HALF_PX + 13));
      label(g, lx, ly, 'S/F', ink3, 'centre', 9);
    }

    if (shown < n * 0.9 || !S.corners.length) return;

    g.save();
    const alpha = Math.max(0, Math.min(1, (S.reveal - 0.5) / 0.5));

    /* -- the apex of each corner: where the racing line is nearest the inside
          kerb. A tick on the line there, so the reader can see the line touch. */
    g.globalAlpha = alpha * 0.75;
    g.strokeStyle = accent;
    g.lineWidth = 1.6;
    g.beginPath();
    for (const c of S.corners) {
      const inward = Math.sign(c.turn) || 1;
      let apex = c.i, bestD = -Infinity;
      for (let j = 0; j < c.len; j++) {
        const idx = (c.from + j) % n;
        const towardKerb = S.d[idx] * inward;
        if (towardKerb > bestD) { bestD = towardKerb; apex = idx; }
      }
      c.apex = apex;
      const ax = X(S.line[apex]), ay = Y(S.line[apex]);
      const kx = S.nx[apex] * inward, ky = S.ny[apex] * inward;
      g.moveTo(ax - kx * 4, ay - ky * 4);
      g.lineTo(ax + kx * 6.5, ay + ky * 6.5);
    }
    g.stroke();

    /* -- the numbers. Every corner the spec table claims, sitting just OUTSIDE
          the road on the outside of the turn, where the line is wide and there is
          therefore nothing to cover. A named corner gets its name beside it. */
    for (const c of S.corners) {
      const out = -(Math.sign(c.turn) || 1);
      const px = HALF_PX + 11;
      const x = offX(c.i, out * px), y = offY(c.i, out * px);

      g.globalAlpha = alpha;
      label(g, x, y, String(c.no), accent, 'centre', 10.5);

      if (c.label) {
        // push the name one step further out, along the same normal
        const nx2 = offX(c.i, out * (px + 13)), ny2 = offY(c.i, out * (px + 13));
        g.globalAlpha = alpha * 0.72;
        label(g, nx2, ny2, c.label.toUpperCase(), ink, 'centre', 8.5);
      }
    }
    g.restore();
  }

  function label(g, x, y, text, colour, align, size = 10) {
    g.font = '700 ' + size + 'px ' + tok('--font-mono', 'monospace').replace(/'/g, '');
    g.fillStyle = colour;
    g.textAlign = align === 'centre' ? 'center' : (align === 'right' ? 'right' : 'left');
    g.textBaseline = align === 'centre' ? 'middle' : 'alphabetic';
    g.save();
    g.letterSpacing = '1.2px';
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
    /* ★ Published so the suite can assert that the figure draws a RACING LINE and
       not the centreline it used to. There is no DOM inside a canvas, and
       CONVENTIONS §5 says tests read ids and data-* — so `swing` is the largest
       lateral offset as a fraction of the corridor half-width. It was structurally
       0 before this work, because there was no offset: any check on the old code
       reads 0 and any check on this one reads most of the way to 1. */
    canvas.dataset.swing = api.swing().toFixed(3);
    canvas.dataset.corners = String(S.corners.length);
  }
  const api = {
    load(track) { load(track); },
    resize() { resize(); },
    /** the corners as the legend wants them: number, name, angle */
    corners: () => S.corners.map(c => ({
      no: c.no,
      label: c.label || null,
      turn: c.turn == null ? null : Math.abs(Math.round(c.turn * 180 / Math.PI)),
    })),
    /** how far the racing line actually swings, as a fraction of the half-width —
        published so §03's legend can state it rather than claim it */
    swing: () => {
      if (!S.d || !S.d.length || !S.half) return 0;
      let m = 0;
      for (let i = 0; i < S.d.length; i++) { const a = Math.abs(S.d[i]); if (a > m) m = a; }
      return m / S.half;
    },
    setMotion(on) { S.motion = on; },
    pause() { S.running = false; },
    resume() { S.running = true; lastPaint = -1e9; },
    destroy() { cancelAnimationFrame(raf); },
  };

  raf = requestAnimationFrame(frame);
  return api;
}
