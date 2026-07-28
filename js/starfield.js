/* ===========================================================================
 * starfield.js — the field behind everything.
 *
 * Deliberately quiet: mostly-white points with a little colour temperature
 * scatter, a slow twinkle on a tenth of them, and a parallax offset driven by
 * scroll so the page feels like it is descending rather than sliding.
 *
 * ---------------------------------------------------------------------------
 * ★ WHY THIS REPAINTS AT 10 Hz AND NOT 60 (session 2)
 * This file was the single biggest thing the reader was paying for: 5 fps with
 * it on, 138 fps with it off. Not because drawing 249 dots is slow — measured
 * with visibility:hidden, where the JS still paints every star into a full-size
 * canvas, the page ran at the same 138 fps. The cost is COMPOSITING: a
 * viewport-sized layer whose contents change every frame forces the page to
 * re-composite, and #scrim and the topbar's backdrop-filter sit on top of it.
 *
 * So the fix is not to draw less, it is to CHANGE LESS OFTEN. Across a 260px
 * scroll notch the parallax moves the fastest layer about three pixels — 0.05px
 * per frame at 60 Hz. Repainting ten times a second shows that as 0.3px steps,
 * which is invisible, and the twinkle cycles over 3–10s so it does not care
 * either. Anything that makes this layer change per-frame again brings the
 * 5 fps back; trace/verify.mjs §8 is the guard.
 * ======================================================================== */

const TAU = Math.PI * 2;

/* repaints per second — see the note above before raising this */
const REPAINT_HZ = 10;

/* the fastest parallax layer, from build() below. Used to turn a change in the
   scroll fraction into the pixel distance a star will actually move. */
const MAX_PARALLAX = 0.26;

/* ★ HOW FAR A STAR MUST MOVE BEFORE IT IS WORTH A REPAINT (session 3).
 *
 * Theodor: "the stars behind and the background is a bit laggy when you scroll
 * down." The 10 Hz cap above is not the whole story, because those ten
 * repaints are not spread evenly through the day — every one of them lands
 * while the reader is scrolling, which is the only time the page has no frame
 * budget to spare, and each forces a re-composite under #scrim and the topbar's
 * backdrop-filter.
 *
 * The globe answers this by standing still while the reader moves (see
 * globe.js setBusy) but the starfield cannot: its parallax IS a response to
 * scrolling, and freezing it would let the offset drift up to ~40px behind on a
 * long fling and then snap on release.
 *
 * So instead of asking "has the offset changed at all", it asks "has it changed
 * enough to see". At 0.5px on the fastest layer a slow read repaints almost
 * never, a fast fling repaints only as often as it genuinely moves, and the
 * motion is identical to the eye because sub-pixel steps were never visible.
 * The twinkle, which is the other thing that can dirty this canvas, is paused
 * outright while scrolling — nobody has ever noticed a star stop twinkling
 * while the page was moving. */
const MOVE_EPS_PX = 0.5;

/* ★ AND A LOWER CEILING WHILE THE READER IS MOVING.
 *
 * The epsilon above is enough for a slow, deliberate read — the kind of scroll
 * the parallax exists to serve — where it cuts repaints to almost none. It does
 * nothing for a fling, because on a fling the stars genuinely DO move: 80
 * notches down §02 shifts the fastest layer about 42px, which at half a pixel
 * an update wants ~83 repaints and simply saturates REPAINT_HZ.
 *
 * But a fling is exactly when the parallax is worth least — nobody is tracking
 * an individual star while the page is flying past — and exactly when the frame
 * budget is worth most. So while scrolling the field gets a quarter of its
 * budget: it still follows the page, at a step no one can resolve mid-fling,
 * for a fraction of the compositing. It returns to REPAINT_HZ the moment the
 * reader stops, which is when the twinkle becomes visible again anyway. */
const BUSY_HZ = 4;

export function createStarfield(canvas, { density = 1 } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const state = { w: 0, h: 0, dpr: 1, stars: [], offset: 0, motion: true, running: true, busy: false };
  let dirty = true;          // something changed that the canvas has not shown yet
  let shownOffset = 0;       // the offset the pixels on screen actually represent
  let twinklers = 0;         // >0 means the field is never truly static
  let lastPaint = -1e9;
  let paints = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);

  function build() {
    const n = Math.round((state.w * state.h) / 5200 * density);
    const stars = new Array(n);
    for (let i = 0; i < n; i++) {
      // three depth layers -> three parallax rates and three size bands
      const layer = Math.random() < 0.62 ? 0 : (Math.random() < 0.7 ? 1 : 2);
      stars[i] = {
        x: Math.random(), y: Math.random() * 1.6 - 0.3,   // extra vertical room for parallax
        r: [rnd(0.35, 0.75), rnd(0.6, 1.05), rnd(0.9, 1.5)][layer],
        a: [rnd(0.16, 0.42), rnd(0.3, 0.62), rnd(0.45, 0.9)][layer],
        p: [0.06, 0.14, 0.26][layer],
        hue: Math.random() < 0.14 ? (Math.random() < 0.5 ? 30 : 205) : 0,  // amber / blue strays
        tw: Math.random() < 0.11 ? rnd(0.6, 1.9) : 0,
        ph: Math.random() * TAU,
      };
    }
    state.stars = stars;
    twinklers = stars.reduce((n, s) => n + (s.tw ? 1 : 0), 0);
    dirty = true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.dpr = dpr;
    state.w = canvas.clientWidth || window.innerWidth;
    state.h = canvas.clientHeight || window.innerHeight;
    canvas.width = state.w * dpr;
    canvas.height = state.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function paint(t) {
    const { w, h, stars, offset } = state;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      let y = (s.y - offset * s.p) % 1.3;
      if (y < -0.15) y += 1.3;
      const py = y * h;
      if (py < -4 || py > h + 4) continue;
      let a = s.a;
      if (s.tw && state.motion) a *= 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
      ctx.beginPath();
      ctx.arc(s.x * w, py, s.r, 0, TAU);
      ctx.fillStyle = s.hue === 0
        ? `rgba(236,229,217,${a})`
        : (s.hue === 30 ? `rgba(226,178,116,${a})` : `rgba(150,196,236,${a})`);
      ctx.fill();
    }
  }

  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!state.running) return;
    // a twinkling field is always out of date; a still one only when told.
    // While the reader is scrolling the twinkle does NOT count as a reason —
    // only a parallax move that is big enough to see does. See MOVE_EPS_PX.
    const twinkling = twinklers && state.motion && !state.busy;
    const hz = state.busy ? BUSY_HZ : REPAINT_HZ;
    const due = (dirty || twinkling) && (now - lastPaint) >= 1000 / hz;
    if (!due) return;
    lastPaint = now;
    canvas.dataset.paints = ++paints;   // verify.mjs §8 asserts the repaint rate
    dirty = false;
    shownOffset = state.offset;
    paint(now / 1000);
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    resize() { resize(); },
    /** 0 at the top of the document, 1 at the bottom */
    setScroll(p) {
      if (p === state.offset) return;
      state.offset = p;
      // dirty only once the fastest layer has moved far enough to register —
      // measured against what is ON SCREEN, not against the previous call, so a
      // long slow scroll still repaints the moment it accumulates half a pixel
      if (Math.abs(p - shownOffset) * MAX_PARALLAX * state.h >= MOVE_EPS_PX) dirty = true;
    },
    /** true while the reader is actively scrolling — pauses the twinkle only */
    setBusy(v) { state.busy = v; if (!v) lastPaint = -1e9; },
    setMotion(on) { state.motion = on; dirty = true; },
    pause() { state.running = false; },
    resume() { state.running = true; lastPaint = -1e9; dirty = true; },
    destroy() { cancelAnimationFrame(raf); },
  };
}
