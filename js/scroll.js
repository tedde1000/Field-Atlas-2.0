/* ===========================================================================
 * scroll.js — everything that reacts to the scroll position.
 *
 * One rAF-throttled reader for the whole page: progress bar, hero dissolve,
 * globe parallax, chapter readout, reticle drift, starfield offset. Reveal is
 * separate and event-driven (IntersectionObserver), because it must survive a
 * page that is loaded already scrolled.
 * ======================================================================== */

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/* Where the reticle sits while you read each chapter, in viewport fractions.
   Nothing functional — it is a sightline, and a still one looks dead. */
const RETICLE = {
  overture:  [0.50, 0.50],
  mandate:   [0.38, 0.42],
  season:    [0.62, 0.36],
  anatomy:   [0.34, 0.58],
  catalogue: [0.66, 0.46],
};

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

export function initScroll({ hero, globeWrap, progress, reticle, chapterLabel, onChapter, onGlobeDim, onBusy, stars }) {
  const sections = [...document.querySelectorAll('section[data-chapter]')];
  const state = { ret: [0.5, 0.5], retNow: [0.5, 0.5], chapter: null, motion: true, t: 0 };
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

  function read() {
    ticking = false;
    const vh = window.innerHeight;
    const doc = Math.max(1, document.documentElement.scrollHeight - vh);
    const y = window.scrollY || window.pageYOffset;
    const p = clamp(y / doc);

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

    /* ---- globe: falls away with the hero, then hangs back as a presence ---- */
    if (state.motion) {
      const gs = 1 - hp * 0.46;
      const gx = hp * 12, gy = hp * 16;
      const go = 1 - hp * 0.86;
      globeWrap.style.transform =
        `translate3d(${gx}vmin, calc(-50% + ${gy}vmin), 0) scale(${gs.toFixed(3)})`;
      globeWrap.style.opacity = String(go);
      // tell the globe how visible it actually is, so it can stop spending a
      // full 6 500-point repaint per frame on something at 14% behind the scrim
      onGlobeDim && onGlobeDim(go);
    }

    /* ---- which chapter am I in ---- */
    let cur = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= vh * 0.6) cur = s;
    }
    if (cur && cur.id !== state.chapter) {
      state.chapter = cur.id;
      chapterLabel.style.opacity = '0';
      const n = cur.dataset.chapter, t = cur.dataset.title;
      setTimeout(() => {
        chapterLabel.innerHTML = `<b>${n}</b> / ${t}`;
        chapterLabel.style.opacity = '1';
      }, 190);
      state.ret = RETICLE[cur.id] || [0.5, 0.5];
      onChapter && onChapter(cur.id);
    }
  }

  function onScroll() {
    markBusy();
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
  }

  /* the reticle eases on its own clock so it keeps moving when the page is still */
  let raf = 0;
  function drift(now) {
    raf = requestAnimationFrame(drift);
    if (!reticle) return;
    state.t = now / 1000;
    const k = state.motion ? 0.045 : 1;
    state.retNow[0] += (state.ret[0] - state.retNow[0]) * k;
    state.retNow[1] += (state.ret[1] - state.retNow[1]) * k;
    const wob = state.motion ? 1 : 0;
    const x = state.retNow[0] * window.innerWidth + Math.sin(state.t * 0.34) * 9 * wob;
    const yy = state.retNow[1] * window.innerHeight + Math.cos(state.t * 0.27) * 7 * wob;
    reticle.style.transform = `translate3d(${x.toFixed(1)}px, ${yy.toFixed(1)}px, 0)`;
  }

  // the reticle is positioned from 0,0 once we drive it with transforms
  if (reticle) { reticle.style.left = '0'; reticle.style.top = '0'; reticle.style.margin = '-17px 0 0 -17px'; }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  raf = requestAnimationFrame(drift);
  read();

  return {
    refresh: read,
    setMotion(on) {
      state.motion = on;
      if (!on) {
        hero.style.transform = hero.style.filter = '';
        hero.style.opacity = '';
        globeWrap.style.transform = 'translate3d(0, -50%, 0)';
        globeWrap.style.opacity = '';
        // the wrapper goes back to fully opaque, so the paint budget must too —
        // otherwise the globe stays throttled at whatever the last scroll said
        onGlobeDim && onGlobeDim(1);
      } else read();
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(busyTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}
