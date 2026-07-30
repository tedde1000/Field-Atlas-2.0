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

import { loopSample, curvature, numberedCorners, racingLine, loopLength,
         resampleUniform, speedProfile, cornerArchetypes, KART, CAR } from './loop.js';

const TAU = Math.PI * 2;

/* ★ HOW MANY MEASURING POINTS THE LAP GETS, AND WHY IT IS THIS MANY.
 *
 * Theodor: "make a lot more measuring points for the line to be accurate."
 *
 * It was 29 to 72 for a sampled centreline and whatever flattenPath() happened to
 * emit for a drawing — a few hundred, bunched into the corners. At that density
 * an apex is three or four nodes, so where the line puts it can only ever land on
 * one of three or four places, and the difference between a geometric apex and a
 * late one is smaller than the gap between two nodes. The solver could not have
 * expressed a late apex even if it had wanted to.
 *
 * ★ 2 600, raised from 1 400 — "much tighter and denser measuring points."
 *
 * That puts one node every 0.46 m on a 1 200 m kart lap and every 0.9 m at
 * Gelleråsen: finer than the kart is wide, so an apex can sit anywhere it likes,
 * and the curvature stencil is reading real geometry rather than the sampling.
 *
 * It is also the second half of the fix for a line that read as too sharp — the
 * first being the smoothing folded into the solver, see racingLine(). Whatever
 * kink survives is now spread over twice as many nodes, so the same lateral
 * movement is drawn with half the angle at each joint.
 *
 * ★ EVERYTHING THAT MEASURES A DISTANCE IN NODES SCALES WITH IT. relGap() in
 * js/loop.js, the bump width K, the stride, and the flow's advance and streak
 * length below are all fractions of the lap, not counts — raising this number
 * silently changed the meaning of every one of them the first time. The lap-time
 * window is the one exception and deliberately so: it is a distance in METRES,
 * off the vehicle, because a fraction of the lap is not the distance a corner
 * exit is paid back over. See BACK/FWD in racingLine().
 *
 * The whole solve lands in about a fifth of a second, once, when the reader picks
 * a circuit — up from a tenth, which is what the honest time window costs. */
const NODES = 2600;

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

/* ★ AND CAPPED BY THE CIRCUIT'S OWN TIGHTEST CORNER, WHICH IS THE WHOLE FIX.
 *
 * Theodor: "the lines is maybe a bit better, but it's still not racing lines.
 * You're not supposed to take a racing line like that."
 *
 * A flat 28 px is not a width, it is a wish. Measured at Uddevalla it made the
 * corridor 39 trace units across a corner whose drawn radius is about 10 — a road
 * four times wider than its own corners, which is not a track, it is an
 * impossibility. Offsetting into it does what offsetting into an impossibility
 * always does: on the outside of the corner the line's segments stretched to six
 * times the centreline spacing, on the inside they collapsed to a quarter of it,
 * and the joint between two of them measured 132°. That is a corner IN THE LINE,
 * at a node spacing under a metre, and it is what he was looking at.
 *
 * The clamp in js/loop.js was already trying to hold this back and could not: it
 * bounds each node against folding, but when the corridor is that far past what
 * the geometry supports, the bound becomes the shape and its own steps become the
 * kinks. Fixing it downstream — smoothing harder, relieving collapsed segments,
 * de-kinking afterwards — was treating a width problem as a smoothness problem.
 *
 * So the corridor is now the narrower of the drawn 28 px and what the circuit can
 * actually carry: eight tenths of its tightest corner radius, off the 99.3rd
 * percentile of curvature so one noisy node cannot set it for the whole lap.
 * Across all 21 circuits that takes joints over 20° from 121 to 5, the worst joint
 * from 72° to 31°, and the collapse detector from 26 rescues to 4 — and the apexes
 * come out slightly LATER rather than paying for it, because the search finally
 * has a corridor it can move inside instead of a bound it is pinned against.
 *
 * It also lands, without being asked to, at roughly 1.2–1.8x true track width
 * where the old constant was six times it. That is not a coincidence: real
 * circuits are built with corner radii proportionate to how wide they are, so a
 * width derived from the radii is close to the real one by construction. The
 * exaggeration the legend promises is still there, and it is now the most the
 * drawing can honestly hold rather than a number that happened to look right on
 * the one circuit it was chosen on. */
const CORRIDOR_CAP = 0.8;

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

  /* ★ THE CORRIDOR STAYS EXAGGERATED, AND THAT IS NOT THE BUG.
   *
   * The obvious reading of "these are not racing lines" is that the road is six
   * times too wide, so solve at the real 8–10 m and magnify the answer for the
   * drawing. That was tried and measured across all 21 circuits, and it is wrong
   * — for a reason worth writing down so it is not tried again.
   *
   * A kart hairpin has a radius of about eight metres. The track is about eight
   * metres wide. So `d·κ` at the true half-width is already ~0.5: the real racing
   * line on a real kart circuit uses up half its own fold budget just existing.
   * Magnifying that by six folds the drawn line inside out, and capping the
   * magnification to avoid the fold leaves it at 1.2–1.7x — which puts the drawn
   * swing back down to 0.3 of the ribbon on half the atlas. The figure would go
   * back to looking like the centreline, which is the exact defect §03 was built
   * to fix. Measured: swing fell to 0.30 at Uddevalla and 0.35 at Vuollerim, and
   * the sharpest joint went UP, to 145° at Åsum.
   *
   * The corridor is a drawing decision and it is the right one. What was actually
   * wrong with the line is the OBJECTIVE it was solved against — a time window
   * shorter than the straight it was supposed to be paying for. See the note over
   * BACK/FWD in js/loop.js. */
  function solve() {
    if (!S.pts || !S.scale) return;
    /* the drawn corridor, and the one the geometry can carry — see CORRIDOR_CAP.
       `halfPx` is what the ribbon is stroked at, so the road the reader sees is
       always the road the line was solved in. */
    S.halfPx = Math.min(HALF_PX, CORRIDOR_CAP * S.rMin * S.scale);
    S.half = S.halfPx / S.scale;
    /* ★ The vehicle and the scale are what turn this from a geometry solve into a
     * lap-time solve. Without both, racingLine() falls back to minimum curvature
     * and says so, which is what happens for a circuit whose length was never
     * measured — better a conservative line than a confident wrong one. */
    const r = racingLine(S.pts, S.half, { car: S.car, metresPerUnit: S.mpu });
    S.line = r.line; S.d = r.d; S.nx = r.nx; S.ny = r.ny;
    S.geometric = r.geometric;
    S.lap = r.lap || 0; S.gain = r.gain || 0;
    S.relieved = r.relieved || 0;
    S.apexAt = r.apexAt || null;
    S.rk = curvature(S.line);
    /* the flow is paced off SPEED now, where it used to be paced off curvature.
       They agree in a corner and disagree everywhere that matters: a driver is
       still hard on the brakes where the road has already gone straight, and
       already accelerating where it has not finished bending. */
    S.v = (S.mpu && S.car) ? speedProfile(S.line, (loopLength(S.line) / S.line.length) * S.mpu, S.car) : null;
    if (S.v) {
      let lo = Infinity, hi = 0;
      for (const x of S.v) { if (x < lo) lo = x; if (x > hi) hi = x; }
      S.vLo = lo; S.vHi = Math.max(hi, lo + 1e-6);
    }
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
    const shaped = track.dense ? raw.map(p => p.slice(0, 2)) : loopSample(raw, 3.2);
    /* ★ AND THEN RESAMPLED, EVENLY, AT NODES POINTS. Both sources above are
       spaced by drawing convenience — dense in the corners, sparse on the
       straights — and every solver in js/loop.js assumes otherwise. See the note
       over resampleUniform() for what uneven spacing quietly does to a Laplacian
       and to an arc-length integral. */
    S.pts = resampleUniform(shaped, NODES);
    S.k = curvature(S.pts);

    /* ★ THE TIGHTEST CORNER ON THE DRAWING, WHICH SETS HOW WIDE THE ROAD MAY BE.
     * curvature() is heading change over ±3 nodes, so per unit of arc length it is
     * k/(6·ds). The 99.3rd percentile rather than the maximum: one node of
     * flattener noise must not decide the corridor for the whole lap, and at 2 600
     * nodes that still leaves ~18 nodes tighter than the figure it returns. */
    {
      const nn = S.pts.length;
      let arc = 0;
      for (let i = 0; i < nn; i++) {
        const a = S.pts[i], b = S.pts[(i + 1) % nn];
        arc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      const ds = arc / nn;
      const mag = Array.from(S.k, (v) => Math.abs(v) / (6 * ds)).sort((a, b) => a - b);
      const kMax = mag[Math.floor(nn * 0.993)];
      S.rMin = kMax > 1e-9 ? 1 / kMax : Infinity;
    }
    S.names = track.cornerNames || null;
    S.colour = track.colour || tok('--accent', '#c9974f');

    /* ★ THE SCALE, AND THE VEHICLE. A lap time needs metres and a car; the
     * artboard has neither. `lengthM` is measured — off the OSM centreline, or off
     * a recorded 1.x geometry session — so dividing it by the drawn lap's own
     * length gives metres per artboard unit exactly.
     *
     * The vehicle is chosen by lap length, and in this atlas that is not a proxy
     * for anything, it IS the distinction: every venue here under two kilometres
     * is a karting circuit and the one over it, Gelleråsen, is the full-size
     * circuit that runs Kanonloppet. A kart holds more lateral grip and has a
     * fraction of the power, and both push its apex later — so the two profiles
     * genuinely draw different lines through the same corner. */
    const lm = track.track?.lengthM;
    S.mpu = (lm && !track.track?.runway) ? lm / loopLength(S.pts) : 0;
    S.car = lm >= 2000 ? CAR : KART;

    /* number exactly as many corners as the measured data claims — an air base
       has none, and reports runways instead. See numberedCorners() in loop.js. */
    S.target = track.track?.runway ? 0 : (track.track?.corners || 0);
    S.corners = S.target === 0 && track.track?.runway
      ? []
      : numberedCorners(S.pts, S.k, S.target).map((c, idx) => ({ ...c, no: idx + 1 }));

    /* what SHAPE each of those corners is — hairpin, double apex, increasing or
       decreasing radius, linked, or classic. Nothing downstream shapes the line
       from this; it is the description the solved line gets checked against. See
       cornerArchetypes() in js/loop.js. */
    const kinds = cornerArchetypes(S.pts, S.k, S.corners, {
      metresPerNode: (track.track?.lengthM || 0) / S.pts.length,
    });
    S.corners.forEach((c, i) => {
      c.kind = kinds[i]?.kind || null;
      c.radius = kinds[i]?.radius ?? null;
      c.wants = kinds[i]?.wants ?? 0.58;
    });

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
    /* ★ With motion off the reveal must be OVER, not about to start. Picking a
       different circuit re-enters here, and starting the clock unconditionally
       meant the new figure drew instantly and then faded its corner numbers in
       over a second and a half — with the MOTION pill pressed. See setMotion(). */
    S.reveal = 0;
    S.t0 = S.motion ? performance.now() : -1e9;
    S.tPrev = performance.now();
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
    g.lineWidth = S.halfPx * 2;
    g.stroke();

    /* -- both edges of the road, struck thin. Without these the corridor has no
          boundary and "wide" has nothing to be wide OF. */
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(offX(0, side * S.halfPx), offY(0, side * S.halfPx));
      for (let i = 1; i < shown; i++) g.lineTo(offX(i, side * S.halfPx), offY(i, side * S.halfPx));
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

      /* ★ THE FLOW IS PACED OFF THE SPEED PROFILE NOW, NOT OFF CURVATURE.
       *
       * Curvature is where the road bends; speed is how fast anybody is going,
       * and the two come apart exactly where the figure is interesting. A driver
       * is still hard on the brakes a hundred metres after the road went straight,
       * and is already accelerating while it is still bending — that asymmetry
       * round every corner is the readable difference between a flow field and a
       * lap, and pacing off |κ| could not show it, because |κ| is symmetric about
       * the apex by construction.
       *
       * `S.v` is the same forward/backward pass the line was solved against, so
       * the particles are travelling at the speeds the line was chosen for.
       * Falls back to curvature where there is no measured length to scale by. */
      const paceAt = S.v
        ? (i) => 0.26 + 0.74 * ((S.v[i] - S.vLo) / (S.vHi - S.vLo))
        : (i) => 0.34 + 0.66 / (1 + Math.abs(S.rk[i]) * 11);

      /* ★ IN LAPS PER SECOND, NOT NODES PER FRAME. The node count went from a few
         hundred to NODES (1 400), and the old constant advanced one node a frame —
         which would have quietly made the flow three or four times slower on every
         circuit. A lap is a lap however finely it is cut up. */
      const perFrame = n * (0.135 / 60);
      const trail = Math.max(3, Math.round(n * 0.007));

      for (const p of S.particles) {
        const i = Math.floor(p.s) % n;
        const pace = paceAt(i);
        p.s = (p.s + p.v * pace * perFrame * dt) % n;

        const a = S.line[i], b = S.line[(i + 3) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        // the scatter is in screen pixels about the line, hence the /S.scale
        const sc = p.off / S.scale;
        const nxp = -dy / L * sc, nyp = dx / L * sc;

        const x = (a[0] + nxp) * S.scale + S.ox;
        const y = (a[1] + nyp) * S.scale + S.oy;
        // the streak runs BACK along the line, and its length reads as speed
        const j = (i - Math.round(trail * (0.35 + 0.65 * pace)) + n) % n;
        const c = S.line[j];
        const tx = (c[0] + nxp) * S.scale + S.ox;
        const ty = (c[1] + nyp) * S.scale + S.oy;

        const alpha = p.a * (isDay ? 0.62 : 0.72) * (0.42 + 0.58 * pace);
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
      const x0 = offX(0, -S.halfPx), y0 = offY(0, -S.halfPx);
      const x1 = offX(0, S.halfPx), y1 = offY(0, S.halfPx);
      g.strokeStyle = isDay ? 'rgba(22,21,15,.62)' : 'rgba(236,229,217,.6)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const lx = offX(0, -(S.halfPx + 13)), ly = offY(0, -(S.halfPx + 13));
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
      const px = S.halfPx + 11;
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
    /* ★ Published so the suite can tell the two solves apart from outside the
       canvas. `nodes` is the resolution the line was solved at — the thing that
       was raised from a few dozen — and `solve` says whether the lap-time stage
       actually ran and beat the geometric line it started from, which is the only
       externally visible difference between "a driver's line" and "the biggest
       circle that fits". */
    canvas.dataset.nodes = String(S.pts ? S.pts.length : 0);
    canvas.dataset.solve = S.geometric === false ? 'lap-time' : 'curvature';
    /* ★ The line's geometric health, published so it can be asserted from outside
       instead of eyeballed. `kink` is the sharpest joint anywhere in the drawn
       line in degrees — at a node spacing under a metre, anything into double
       figures is a visible corner in the line and the whole reason the corridor is
       now capped. `corridor` is what that cap allowed, in px. `apex` is where the
       line actually sits closest to the inside, meaned over every numbered corner,
       as a fraction of the corner: 0.5 is the geometric middle and a driver's line
       is past it. `kinds` names the six shapes — see cornerArchetypes(). */
    canvas.dataset.kink = api.worstJoint().toFixed(1);
    canvas.dataset.corridor = (S.halfPx || 0).toFixed(1);
    canvas.dataset.apex = api.apexMean().toFixed(3);
    canvas.dataset.kinds = S.corners.map(c => c.kind || '?').join(',');
  }
  const api = {
    load(track) { load(track); },
    resize() { resize(); },
    /** the corners as the legend wants them: number, name, angle, shape */
    corners: () => S.corners.map(c => ({
      no: c.no,
      label: c.label || null,
      turn: c.turn == null ? null : Math.abs(Math.round(c.turn * 180 / Math.PI)),
      kind: c.kind || null,
    })),

    /** the sharpest joint anywhere in the drawn line, in degrees. A racing line
        has no vertices, so this is the figure's single best self-check. */
    worstJoint: () => {
      const L = S.line;
      if (!L || L.length < 3) return 0;
      const n = L.length;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const a = L[(i - 1 + n) % n], b = L[i], c = L[(i + 1) % n];
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
        const m1 = Math.hypot(ux, uy), m2 = Math.hypot(vx, vy);
        if (m1 < 1e-12 || m2 < 1e-12) return 180;
        const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (m1 * m2)));
        const deg = Math.acos(cos) * 180 / Math.PI;
        if (deg > worst) worst = deg;
      }
      return worst;
    },

    /** where the line apexes, meaned over every numbered corner, as a fraction of
        the corner. 0.5 is the geometric middle; a driver's line sits past it. */
    apexMean: () => {
      if (!S.d || !S.corners.length) return 0;
      const n = S.pts.length;
      let sum = 0;
      for (const c of S.corners) {
        const sg = Math.sign(c.turn) || 1;
        let best = -Infinity, at = 0;
        for (let j = 0; j < c.len; j++) {
          const v = S.d[(c.from + j) % n] * sg;
          if (v > best) { best = v; at = j; }
        }
        sum += c.len > 1 ? at / (c.len - 1) : 0.5;
      }
      return sum / S.corners.length;
    },
    /** how far the racing line actually swings, as a fraction of the half-width —
        published so §03's legend can state it rather than claim it */
    swing: () => {
      if (!S.d || !S.d.length || !S.half) return 0;
      let m = 0;
      for (let i = 0; i < S.d.length; i++) { const a = Math.abs(S.d[i]); if (a > m) m = a; }
      return m / S.half;
    },
    /** how the line was arrived at, for §03's legend to state rather than imply */
    solve: () => ({
      nodes: S.pts ? S.pts.length : 0,
      mode: S.geometric === false ? 'lap-time' : 'curvature',
      car: S.car === CAR ? 'CAR' : 'KART',
      scaled: !!S.mpu,
    }),
    /* ★ MOTION OFF MUST MEAN FULLY DRAWN, LABELS AND ALL.
     *
     * `shown` already jumps to the whole lap with motion off, so the road and the
     * line appeared at once — but the apex ticks and the corner numbers are held
     * back on `reveal`, which is a clock rather than a state, and it went on
     * running. So the figure came up complete and then grew its numbers a second
     * and a half later: an animation, playing because the pill that turns
     * animations off had been pressed. Winding the clock back past the end of the
     * reveal is what makes the still frame actually still. */
    setMotion(on) {
      S.motion = on;
      if (!on) { S.t0 = -1e9; S.stillKey = null; }
    },
    pause() { S.running = false; },
    resume() { S.running = true; lastPaint = -1e9; },
    destroy() { cancelAnimationFrame(raf); },
  };

  raf = requestAnimationFrame(frame);
  return api;
}
