/* ===========================================================================
 * panel.js — the full-screen detail overlay.
 *
 * A panel, not a route change: the reader keeps their scroll position on a page
 * this long. But it IS addressable — #date/gellerasen:0, #circuit/kalmar — so a
 * date can be linked to, and so Android's back button closes the panel instead
 * of leaving the app.
 *
 * History handling is deliberately hash-only. Opening assigns location.hash,
 * which pushes an entry and fires hashchange; closing calls history.back(), so
 * back and the close button do the same thing and the stack never grows on
 * repeated open/close. The one case with nothing to go back to is a cold deep
 * link straight into a panel — there we replaceState instead, so closing does
 * not walk the reader out of the site.
 *
 * Accessibility is not optional here: focus moves in on open and returns to the
 * trigger on close, Escape closes, focus is trapped while open, and the page
 * behind does not scroll.
 * ======================================================================== */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * `onAfterRender(body)` runs every time the panel's HTML is replaced — on open
 * and on refresh — and is where anything that needs live JS gets attached.
 *
 * ★ It exists because onRender() returns a STRING. That is deliberate: a panel
 * is rebuilt from scratch on every open and on every gear tick, and building it
 * as one string keeps that rebuild atomic and cheap. But a string cannot carry a
 * listener, so the 3D track layout — which needs pointer, wheel and key handling
 * — had nowhere to be wired up. Doing it inside show() would work for opening
 * and quietly fail on refresh(), which is precisely the bug that shape of code
 * produces: tick a gear item and the layout stops turning, with nothing in the
 * console to say why.
 */
export function createPanel({ root, onRender, onAfterRender }) {
  const card = root.querySelector('.panel-card');
  const body = root.querySelector('.panel-body');
  const closeBtn = root.querySelector('.panel-close');

  const state = { open: false, route: null, trigger: null, pushed: 0 };

  const focusables = () =>
    [...card.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === closeBtn);

  /* ------------------------------------------------------------ open/close */
  function show(route) {
    const html = onRender(route);
    if (html == null) return false;          // unknown id — leave the page alone

    body.innerHTML = html;
    onAfterRender?.(body);
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    // reflow before adding the class so the transition actually runs
    void root.offsetWidth;
    root.classList.add('is-open');
    // both elements: <html> is the scroller, <body> is not — see app.css
    document.documentElement.classList.add('is-locked');
    document.body.classList.add('is-locked');
    state.open = true;
    state.route = route;
    body.scrollTop = 0;

    // focus the panel itself, not the close button: a screen reader should hear
    // the heading first, and Tab from here lands on the first real control
    card.focus({ preventScroll: true });
    return true;
  }

  function hide() {
    if (!state.open) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('is-locked');
    document.body.classList.remove('is-locked');
    state.open = false;
    state.route = null;

    const back = state.trigger;
    state.trigger = null;
    // returning focus is the whole point — without it the reader is dumped at
    // the top of the document with no idea where they were
    if (back && document.contains(back)) back.focus({ preventScroll: true });

    // keep it out of the tab order once the transition has run
    setTimeout(() => { if (!state.open) root.hidden = true; }, 260);
  }

  /* -------------------------------------------------------------- routing */
  /* `date/…` and `circuit/…` name a thing; `gear` is a whole route on its own,
     because there is only one kit. Hence the extra alternative rather than one
     pattern with an optional tail — `gear/` with anything after it is not a
     route and must keep falling through to hide().
     ★ It is `gear` and not `kit` because `#kit` is already §05's element id, and
     a hash cannot be both a panel route and an anchor: main.js's goHash() would
     scroll the locked document to the section while the panel sat over it. */
  const routeOf = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    return (/^(date|circuit)\/.+/.test(h) || h === 'gear') ? h : null;
  };

  /** bring the panel in line with whatever the URL currently says */
  function applyRoute() {
    const route = routeOf();
    if (!route) { hide(); return; }
    if (state.open && state.route === route) return;
    if (state.open) hide();
    if (!show(route)) {
      // the hash names something that does not exist; do not leave a dead URL
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  window.addEventListener('hashchange', applyRoute);

  /* ------------------------------------------------------------- controls */
  closeBtn.addEventListener('click', () => api.close());
  root.querySelector('.panel-scrim').addEventListener('click', () => api.close());

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); return; }
    if (e.key !== 'Tab') return;

    // trap: Tab must not escape into the page behind
    const list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === card)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus();
    }
  });

  const api = {
    /** open from a click, remembering what to hand focus back to */
    openFrom(route, trigger) {
      state.trigger = trigger || document.activeElement;
      if (routeOf() === route) { applyRoute(); return; }
      state.pushed++;
      location.hash = route;            // fires hashchange -> applyRoute
    },
    close() {
      if (!state.open) return;
      if (state.pushed > 0) {
        state.pushed--;
        history.back();                 // fires hashchange -> applyRoute -> hide
      } else {
        // cold deep link: there is no history entry of ours to pop, so drop the
        // hash without navigating and close by hand
        history.replaceState(null, '', location.pathname + location.search);
        hide();
      }
    },
    /** honour a hash that was already in the URL at boot */
    sync() { applyRoute(); },
    isOpen: () => state.open,
    route: () => state.route,
    /** re-render in place, e.g. after a gear tick */
    refresh() {
      if (!state.open) return;
      const y = body.scrollTop;
      const html = onRender(state.route);
      if (html != null) { body.innerHTML = html; onAfterRender?.(body); body.scrollTop = y; }
    },
  };
  return api;
}
