/* ===========================================================================
 * scroll.js — everything that reacts to the scroll position.
 *
 * One rAF-throttled reader for the whole page: progress bar, hero dissolve,
 * globe parallax, chapter readout, starfield offset. Reveal is separate and
 * event-driven (IntersectionObserver), because it must survive a page that is
 * loaded already scrolled.
 *
 * ★ THERE IS NO RETICLE ANY MORE. A 34px crosshair used to drift toward a
 * per-chapter sightline on its own rAF clock, wobbling on two out-of-phase sine
 * waves so it never sat still. Theodor: "the arrow thing that's random that
 * moves around when you scroll on the website — I don't wanna have that." It was
 * decoration that read as a cursor the reader did not control, and it also meant
 * this module held a requestAnimationFrame loop open for the life of the page to
 * animate something purely ornamental. Both are gone: no #reticle in
 * index.html, no rule in app.css, and no rAF here at all.
 * ======================================================================== */

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function initReveal(root = document) {
  const targets = root.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('is-in'));
    return { observe(el) { el.classList.add('is-in'); } };
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  targets.forEach(el => io.observe(el));
  return { observe: (el) => io.observe(el) };
}

/* ★ HOW CLOSE A SECTION HAS TO BE FOR ITS CANVAS TO BE WORTH PAINTING, in
   viewports either side of it. See `onNear` below. */
const NEAR = 0.3;

export function initScroll({ hero, globeWrap, progress, chapterLabel, onChapter, onGlobeDim, onBusy, stars,
                             nearId = null, onNear = null }) {
  const sections = [...document.querySelectorAll('section[data-chapter]')];
  const state = { chapter: null, motion: true, near: null };
  const nearIx = nearId ? sections.findIndex(s => s.id === nearId) : -1;
  let ticking = false;

  /* ★ Is the reader moving right now? The canvases behind the page use this to
     stand still while they are dimmed, because a repaint on a fixed
     full-viewport canvas under #scrim forces the compositor to re-blend the
     whole page — which is affordable when nothing else is happening and is not
     when the reader is scrolling. 140ms of quiet counts as stopped: long enough
     that trackpad inertia and a wheel notch do not flicker it on and off, short
     enough that the drift is back before anyone looks at the globe again. */
  const BUSY_TAIL = 140;
  let busy = false, busyTimer = 0;
  function markBusy() {
    if (!busy) { busy = true; onBusy && onBusy(true); }
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { busy = false; onBusy && onBusy(false); }, BUSY_TAIL);
  }

  /* ★ NOTHING IN read() IS ALLOWED TO READ LAYOUT, AND THAT IS THE WHOLE FIX.
   *
   * Theodor: "the stars are still lagging a bit in the background when I'm
   * scrolling."
   *
   * They were, and it was not the starfield — that file is already capped at
   * 10Hz, quarter-rate while busy, and skips the frame entirely unless the
   * fastest parallax layer has moved half a pixel. The stall was here. read()
   * used to WRITE `progress`, `hero` and `globeWrap` styles and then, in the same
   * pass, READ `getBoundingClientRect()` for every chapter section to work out
   * which one the reader was in. A style write invalidates layout; a geometry
   * read afterwards forces the browser to recompute it synchronously before it
   * can answer. So every scroll frame paid for a full document reflow — with six
   * chapter sections, an entry list, and a fixed blurred topbar over the top of
   * it — and the compositor's budget went with it. The starfield was simply the
   * most visible thing sharing the frame.
   *
   * Sections do not move while the reader scrolls, so their positions are
   * measured once, here, and kept. Everything read() needs is then arithmetic on
   * numbers that are already in hand. measure() runs at init, on resize, and off
   * a ResizeObserver — a ResizeObserver callback fires after layout and before
   * paint, so reading geometry inside it is free, which is exactly the place this
   * work belongs. The entry list changes height when the display face swaps in
   * (see the deep-link note in js/main.js) and that is precisely the case the
   * observer catches and a resize listener alone would not. */
  const metrics = { vh: 0, doc: 1, tops: sections.map(() => 0) };
  function measure() {
    const y = window.scrollY || window.pageYOffset;
    metrics.vh = window.innerHeight;
    metrics.doc = Math.max(1, document.documentElement.scrollHeight - metrics.vh);
    for (let i = 0; i < sections.length; i++) {
      metrics.tops[i] = sections[i].getBoundingClientRect().top + y;
    }
  }

  function read() {
    ticking = false;
    const vh = metrics.vh;
    const doc = metrics.doc;
    const y = window.scrollY || window.pageYOffset;
    const p = clamp(y / doc);

    /* which chapter am I in — resolved BEFORE anything is written, off the
       cached tops. `rect.top <= vh * 0.6` is the same test as this one with the
       scroll position added back to both sides. */
    let cur = sections[0];
    for (let i = 0; i < sections.length; i++) {
      if (metrics.tops[i] <= y + vh * 0.6) cur = sections[i];
    }

    progress.style.transform = `scaleX(${p})`;
    if (stars) stars.setScroll(p);

    /* ---- hero: rises, blurs, and gives the page away ---- */
    const hp = clamp(y / (vh * 0.85));
    if (state.motion) {
      hero.style.transform = `translate3d(0,${-hp * 90}px,0)`;
      hero.style.opacity = String(1 - clamp(hp * 1.28));
      /* ★ The blur is the most expensive pixel on the page: measured headless,
         turning it off took the hero from 25 to 95 fps, because a software
         raster of a large blurred subtree is redone whenever anything beneath
         it changes. Quantised to whole pixels so a scroll produces eight
         discrete re-rasters instead of one per frame, and capped at 8px —
         past about six the hero is already unreadable, which is the point. */
      const b = Math.round(hp * 8);
      hero.style.filter = b >= 1 ? `blur(${b}px)` : '';
    }

    /* ---- globe: falls away with the hero, then hangs back as a presence ----
     *
     * ★ THE OPACITY IS NOT PART OF THE ANIMATION, AND PUTTING IT INSIDE THE
     * MOTION GUARD MADE THE PAGE UNREADABLE WITH MOTION OFF.
     *
     * All of this used to sit inside `if (state.motion)`, and setMotion(false)
     * cleared `globeWrap.style.opacity` back to 1 — so with the MOTION pill
     * pressed, or on any machine that asks for reduced motion, the globe stayed
     * at FULL brightness behind every chapter of the page. `#scrim` only covers
     * the left 62% of the viewport, because the whole layout assumes the disc has
     * faded to 14% by the time the reader is past the hero; at 100% the right-hand
     * side of §04 and §05 is body copy over a lit continent. Measured at every
     * chapter: wrap-opacity 1.00 all the way down.
     *
     * The rise, the drift and the scale are animation and are correctly gated.
     * How VISIBLE the globe is behind text is a legibility property of where the
     * reader is on the page, and it has to hold whether or not anything moves. */
    const go = 1 - hp * 0.86;
    if (state.motion) {
      const gs = 1 - hp * 0.46;
      const gx = hp * 12, gy = hp * 16;
      globeWrap.style.transform =
        `translate3d(${gx}vmin, calc(-50% + ${gy}vmin), 0) scale(${gs.toFixed(3)})`;
    }
    globeWrap.style.opacity = String(go);
    // tell the globe how visible it actually is, so it can stop spending a
    // full-resolution repaint per frame on something at 14% behind the scrim
    onGlobeDim && onGlobeDim(go);

    /* ★ IS §03's FIGURE NEAR ENOUGH TO BE WORTH PAINTING — AND WHY THIS IS NOT AN
     * IntersectionObserver ANY MORE.
     *
     * It was one, on `.figure`, and it could get stuck. Deep-linking to #anatomy
     * scrolls the page in a rAF loop for two seconds (see goHash() in js/main.js,
     * which re-aims because the display faces reflow every entry), and the observer
     * delivered exactly one record during that — taken at an instant when the
     * figure was 2 960px above the viewport — and then never delivered again, at
     * any later scroll position. The figure came to rest fully on screen, paused,
     * with no way back: no repaints, no racing line, an empty box. Whether that is
     * a headless quirk or not is beside the point, because the failure mode is
     * silent and total, and the same code was one layout change away from it all
     * along — the old figure simply happened to get its one record at a moment when
     * the answer was yes.
     *
     * The scroll reader already knows where every section is and what the scroll
     * position is, both from numbers it has cached — so this is two comparisons
     * against values already in hand, it re-evaluates on every scroll rather than
     * on a notification that may not come, and it reads no layout, which is the
     * rule this whole function is built around. One mechanism, and it cannot get
     * stuck, because there is no state to get stuck in. */
    if (onNear && nearIx >= 0) {
      const top = metrics.tops[nearIx];
      const bot = nearIx + 1 < metrics.tops.length ? metrics.tops[nearIx + 1] : metrics.doc + vh;
      const v = (y + vh * (1 + NEAR)) >= top && y <= bot + vh * NEAR;
      if (v !== state.near) { state.near = v; onNear(v); }
    }

    /* ---- and report it (resolved above, before the writes) ---- */
    if (cur && cur.id !== state.chapter) {
      state.chapter = cur.id;
      chapterLabel.style.opacity = '0';
      const n = cur.dataset.chapter, t = cur.dataset.title;
      setTimeout(() => {
        chapterLabel.innerHTML = `<b>${n}</b> / ${t}`;
        chapterLabel.style.opacity = '1';
      }, 190);
      onChapter && onChapter(cur.id);
    }
  }

  function onScroll() {
    markBusy();
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
  }

  function remeasure() { measure(); read(); }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', remeasure);

  /* The page's own height is what invalidates the cache most often — fonts land,
     thumbnails decode, the display face swaps into every entry — and none of
     that is a window resize. Observing the document element catches all of it in
     the one callback where reading layout costs nothing. */
  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => { measure(); if (!ticking) { ticking = true; requestAnimationFrame(read); } });
    ro.observe(document.documentElement);
  }

  remeasure();

  return {
    refresh: remeasure,
    setMotion(on) {
      state.motion = on;
      /* ★ The globe's OPACITY is deliberately not reset here — see the note in
         read(). Motion off means nothing moves; it does not mean a lit planet
         behind the body copy. read() puts the transform back where the scroll
         position says it belongs and recomputes the opacity either way. */
      if (!on) {
        hero.style.transform = hero.style.filter = '';
        hero.style.opacity = '';
        globeWrap.style.transform = 'translate3d(0, -50%, 0)';
      }
      read();
    },
    destroy() {
      clearTimeout(busyTimer);
      ro && ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', remeasure);
    },
  };
}
