/* ===========================================================================
 * layout3d.js — the track layout, on a plane you can turn.
 *
 * ★ THIS IS FIELD ATLAS 1.x's VENUE MAP, BROUGHT ACROSS.
 *
 * Theodor: "if you go in on an event, on the layout itself — track layout — I
 * want it to be 3D, like in the original Field Atlas. And a number for the
 * corners at every single circuit, hovering over each apex corner."
 *
 * 1.x builds it out of a `perspective` box holding a `preserve-3d` stage with
 * `rotateX(tilt) rotateZ(rot) scale(zoom)` on it, dragged with the mouse and
 * pinched with two fingers, plus a RESET VIEW button and a one-time tilt-and-zoom
 * reveal the first time it scrolls in. Same idea here, same feel, same starting
 * pose — 56° of tilt, −18° of rotation — because that is the view he already
 * knows, and because a flat plan turned back in space is the honest amount of 3D
 * for geometry that has no elevation data behind it. There is no height in
 * `data/atlas.js`: no banking, no gradient, not one metre of camber anywhere. A
 * circuit modelled with invented hills would look far better and would be the
 * only made-up number on a page that prints its sources under every drawing.
 *
 * ★ WHAT IS NEW IS THE NUMBERS, and they are the reason this is not just a CSS
 * transform on the old SVG.
 *
 * Laid flat in the drawing, a corner numeral turned back 56° is foreshortened
 * into a 40%-tall smear and, past about 70°, into a line. So the numerals come
 * OUT of the SVG and become real objects standing in the scene: each one rides
 * the top of a post rising off its own apex, and is then counter-rotated by
 * exactly the stage's own rotation so it always faces the reader square on. The
 * post is genuinely three-dimensional — it leans and foreshortens as you turn —
 * while the number it carries never does. Turn the layout to a hard 82° and the
 * road becomes a ribbon on edge with fourteen legible numbers floating over it.
 *
 * ---------------------------------------------------------------------------
 * HOW THE COUNTER-ROTATION WORKS, because it looks like a trick and is not.
 *
 * The stage applies RX(tilt)·RZ(rot). A child that applies RZ(−rot)·RX(−tilt) to
 * itself composes to RX(tilt)·RZ(rot)·RZ(−rot)·RX(−tilt) = I, so its own geometry
 * ends up axis-aligned with the screen no matter where the stage has been turned.
 * The translateZ that lifts it off the road is applied FIRST and so happens in
 * stage space, which is what makes the number sit over its apex rather than over
 * the middle of the drawing.
 *
 * Both angles come from two custom properties on the root element, so a drag
 * writes exactly two values per frame however many corners are on the circuit —
 * `calc(-1 * var(--rot))` does the rest in the compositor. Writing a transform
 * per numeral per frame was the alternative and it is twenty style
 * invalidations a frame on Gelleråsen.
 * ======================================================================== */

const START = { tilt: 56, rot: -18, zoom: 1 };
const TILT_MIN = 16, TILT_MAX = 84;
const ZOOM_MIN = 0.55, ZOOM_MAX = 2.6;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ★ HOW TALL A PLANE OF A GIVEN SHAPE IS ONCE IT HAS BEEN STOOD IN THE SCENE.
 *
 * The panel gets a fixed-height stage and lets a wide circuit sit short inside it,
 * which is fine for a card the reader opened on purpose. §03 is a figure in the
 * scroll, it is the biggest single block on the page, and Theodor's note about it
 * is that "the circuit is really small for the area itself" — a 3:1 Gelleråsen on
 * a plane turned back 56° projects to about a quarter of a 560px box, and the
 * other three quarters were empty. The answer is not to magnify the drawing past
 * the width it has; it is to stop reserving height nothing can ever use.
 *
 * So the stage is sized to the pose rather than the pose fitted into the stage.
 * The transform is `rotateX(φ) rotateZ(θ)`, so a plane w×h lands on screen as
 *
 *     width  = w·|cos θ| + h·|sin θ|
 *     height = (w·|sin θ| + h·|cos θ|) · cos φ
 *
 * — the Z-rotation swings the rectangle out to a bigger axis-aligned box, and the
 * X-rotation then foreshortens what is left. Two things are added to the height:
 * the posts, which rise `lift·k` off the plane and project `sin φ` of that
 * upward at the tallest tier, and one numeral box for the label riding the top of
 * the tallest one. Perspective is ignored — at 1250px of it against a ~400px
 * plane the correction is under 3%, and every term here is already an estimate
 * feeding a clamp.
 *
 * `availH` is optional and is the other half of the same job: a PORTRAIT lap is
 * not width-limited, it is height-limited, and left to the width alone Uddevalla
 * came out 1 180px tall inside a 648px stage with turn 6 clipped off the top. Every
 * term above is proportional to the plane's width except the numeral box, so
 * inverting it for a height is exact rather than iterative.
 *
 * Returns { w, h } for the PLANE, in px, plus the height it projects to.
 */
export function poseFit(aspect, availW, availH = Infinity, { lift = 0.095, tiers = 1.95, cap = 26 } = {}) {
  const rad = Math.PI / 180;
  const ct = Math.abs(Math.cos(START.rot * rad)), st = Math.abs(Math.sin(START.rot * rad));
  const cf = Math.cos(START.tilt * rad), sf = Math.sin(START.tilt * rad);
  const a = Math.max(0.05, aspect);
  // screen height per unit of plane width, projection and posts together
  const K = (st + ct / a) * cf + lift * Math.max(1, 1 / a) * tiers * sf;
  // widest plane whose projected width still fits: w·ct + (w/a)·st <= availW
  let w = availW / (ct + st / a);
  if (Number.isFinite(availH)) w = Math.min(w, Math.max(40, (availH - cap) / K));
  return { w, h: w / a, screenH: w * K + cap };
}

/**
 * Wire every `[data-layout3d]` inside `root`. Idempotent: a node that has
 * already been wired is skipped, so the panel can re-render in place (a gear
 * tick does exactly that) without stacking a second set of listeners on it.
 */
export function mount(root) {
  root.querySelectorAll('[data-layout3d]').forEach(wire);
}

function wire(host) {
  if (host.dataset.wired) return;
  host.dataset.wired = '1';

  const stage = host.querySelector('.p3d-stage');
  const plane = host.querySelector('.p3d-plane');
  if (!stage || !plane) return;

  const view = { ...START };
  const apply = () => {
    host.style.setProperty('--tilt', view.tilt.toFixed(2) + 'deg');
    host.style.setProperty('--rot', view.rot.toFixed(2) + 'deg');
    host.style.setProperty('--zoom', view.zoom.toFixed(3));
    /* ★ Published for the suite. There is no way to read a CSS transform back and
       know it came from a drag rather than from the stylesheet, so the pose is
       mirrored onto data-* where a test can assert that dragging actually turned
       the thing — CONVENTIONS §5. */
    host.dataset.tilt = view.tilt.toFixed(1);
    host.dataset.rot = view.rot.toFixed(1);
    host.dataset.zoom = view.zoom.toFixed(2);
  };
  apply();

  /* ------------------------------------------------------------- pointers
   * One handler for mouse, pen and touch. Two live pointers become a pinch:
   * their midpoint still orbits, so a two-finger gesture can zoom and turn at
   * once rather than making the reader choose.
   * -------------------------------------------------------------------- */
  const live = new Map();
  let grab = null;

  const centre = () => {
    let x = 0, y = 0;
    for (const p of live.values()) { x += p.x; y += p.y; }
    return { x: x / live.size, y: y / live.size };
  };
  const spread = () => {
    const [a, b] = [...live.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const regrab = () => {
    grab = {
      c: centre(), d: live.size > 1 ? spread() : 0,
      tilt: view.tilt, rot: view.rot, zoom: view.zoom,
    };
  };

  stage.addEventListener('pointerdown', (e) => {
    // a click on RESET, or on anything else with its own job, is not a drag
    if (e.target.closest('button, a')) return;
    stage.setPointerCapture(e.pointerId);
    live.set(e.pointerId, { x: e.clientX, y: e.clientY });
    regrab();
    stage.classList.add('is-grabbing');
    host.classList.remove('is-revealing');    // the reader took over; stop easing
  });

  stage.addEventListener('pointermove', (e) => {
    if (!live.has(e.pointerId) || !grab) return;
    live.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = centre();
    view.rot = grab.rot + (c.x - grab.c.x) * 0.32;
    view.tilt = clamp(grab.tilt - (c.y - grab.c.y) * 0.30, TILT_MIN, TILT_MAX);
    if (live.size > 1 && grab.d) {
      view.zoom = clamp(grab.zoom * (spread() / grab.d), ZOOM_MIN, ZOOM_MAX);
    }
    apply();
  });

  const release = (e) => {
    if (!live.delete(e.pointerId)) return;
    // a finger lifting off a pinch must not snap the view: re-baseline on what
    // is left, so two-to-one hands over smoothly instead of jumping
    if (live.size) regrab(); else { grab = null; stage.classList.remove('is-grabbing'); }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  /* ★ NOT passive, and it must not be: the wheel here zooms the model, and
     without preventDefault the page scrolls out from under it at the same time.
     `touch-action: none` in app.css is the same guarantee for touch.

     ★ `data-wheel="modifier"` REVERSES THAT, and §03 sets it. Swallowing the
     wheel is right for a panel the reader opened on purpose and covers the page;
     it is wrong for a figure sitting in the middle of the scroll, where it turns
     the biggest block on the page into somewhere the reader's scroll wheel stops
     working. Held behind ctrl/⌘ instead, which is also what a trackpad pinch
     sends, so the gesture that means zoom everywhere else means zoom here too and
     a plain wheel goes to the page. */
  const wheelNeedsMod = host.dataset.wheel === 'modifier';
  stage.addEventListener('wheel', (e) => {
    if (wheelNeedsMod && !(e.ctrlKey || e.metaKey)) return;   // let the page have it
    e.preventDefault();
    view.zoom = clamp(view.zoom * Math.pow(0.9988, e.deltaY), ZOOM_MIN, ZOOM_MAX);
    apply();
    host.classList.remove('is-revealing');
  }, { passive: false });

  /* ---------------------------------------------------------- keyboard
     The stage is focusable, so this has to work — a control you can Tab to and
     then cannot operate is worse than one you cannot reach. */
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 12 : 4;
    let hit = true;
    switch (e.key) {
      case 'ArrowLeft': view.rot -= step; break;
      case 'ArrowRight': view.rot += step; break;
      case 'ArrowUp': view.tilt = clamp(view.tilt + step, TILT_MIN, TILT_MAX); break;
      case 'ArrowDown': view.tilt = clamp(view.tilt - step, TILT_MIN, TILT_MAX); break;
      case '+': case '=': view.zoom = clamp(view.zoom * 1.12, ZOOM_MIN, ZOOM_MAX); break;
      case '-': case '_': view.zoom = clamp(view.zoom / 1.12, ZOOM_MIN, ZOOM_MAX); break;
      case '0': Object.assign(view, START); break;
      default: hit = false;
    }
    if (!hit) return;
    e.preventDefault();
    host.classList.remove('is-revealing');
    apply();
  });

  host.querySelector('.p3d-reset')?.addEventListener('click', () => {
    host.classList.add('is-revealing');           // ease home rather than snap
    Object.assign(view, START);
    apply();
    setTimeout(() => host.classList.remove('is-revealing'), 700);
  });

  /* ------------------------------------------------------------- reveal
   * 1.x plays a one-time tilt-and-zoom as the card comes into view, and it is
   * doing real work: a plan view that arrives already flat gives the reader no
   * reason to believe it can be turned. Coming to rest from a lower, closer pose
   * says "this is an object" in about half a second.
   *
   * Skipped with motion off. The MOTION pill is `body.no-motion`, and app.css
   * kills the transition there anyway, but the pose must not be left at the
   * starting frame of an animation that will never run — hence the check. */
  if (!document.body.classList.contains('no-motion')) {
    view.tilt = clamp(START.tilt - 15, TILT_MIN, TILT_MAX);
    view.rot = START.rot - 11;
    view.zoom = START.zoom * 0.86;
    apply();
    /* ★ A FORCED REFLOW, NOT A requestAnimationFrame.
     *
     * The rAF is the more familiar way to write this and it leaves the pose
     * indeterminate for as long as the next frame takes — which under headless
     * swiftshader is a fifth of a second and under a backgrounded tab is forever.
     * verify.mjs caught it as a flake: RESET VIEW compared against a pose read
     * while the reveal had not yet started, so the "start" it was asked to
     * restore was the animation's first frame rather than its last.
     *
     * Reading offsetWidth flushes layout, which is all the transition needs to
     * see the from-pose as a computed style. The target is then set
     * SYNCHRONOUSLY, so the pose is correct the instant this function returns
     * and the animation is purely something CSS does on the way there. */
    void plane.offsetWidth;
    host.classList.add('is-revealing');
    Object.assign(view, START);
    apply();
    setTimeout(() => host.classList.remove('is-revealing'), 900);
  }
}

/* ============================================================ THE MARKUP
 * Built here rather than in js/main.js so the shape of the DOM and the transform
 * chain that depends on it live in one file. main.js hands over what it knows —
 * the drawn layout, the viewBox it is in, and where the apexes are — and gets
 * back a block it can drop into the panel's HTML string.
 * ========================================================================= */

/**
 * Post heights for a lap's worth of marks — see the note inside stage3d() for
 * what the tiers are for. `pts` are {x, y} in any one consistent unit and `long`
 * is the drawing's long side in that same unit.
 *
 * @returns {number[]} one multiplier per mark, in lap order
 */
export function tierMarks(pts, long) {
  const TIERS = [1, 1.5, 1.95];
  let tier = 0;
  return pts.map((m, i) => {
    if (i > 0) {
      const p = pts[i - 1];
      const near = Math.hypot(m.x - p.x, m.y - p.y) < long * 0.20;
      tier = near ? (tier + 1) % TIERS.length : 0;
    }
    return TIERS[tier];
  });
}

/**
 * @param {string} svg     the layout, already rendered, with its own viewBox
 * @param {object} vb      {x, y, w, h} — the same viewBox, parsed
 * @param {Array}  marks   [{no, label, x, y}] in viewBox units
 * @param {string} label   what to print in the corner of the stage
 */
export function stage3d(svg, vb, marks, label) {
  /* ★ THE PLANE'S ASPECT RATIO IS THE viewBox'S, EXACTLY, and that is what lets
   * the numbers be positioned in percentages at all. The SVG is drawn with
   * `xMidYMid meet`, which only fills its box edge to edge when the two aspect
   * ratios agree; anywhere they disagree it letterboxes, and every numeral would
   * then sit off its corner by half the letterbox. Give the plane the viewBox's
   * own ratio and `meet` becomes an exact fit, so viewBox units and percentages
   * of the plane are the same thing. */
  const pct = (v) => (v * 100).toFixed(3) + '%';

  /* How high the numbers float, as a fraction of the drawing's long side. Fixed
     in the artboard's units rather than in pixels, so a 500-wide drawing and a
     1000-wide hand trace lift theirs by the same amount of the picture. */
  const long = Math.max(vb.w, vb.h);
  const lift = long * 0.095;

  /* ★ POSTS COME IN THREE HEIGHTS, AND A CIRCUIT IS THE REASON.
   *
   * Corners are not spread evenly round a lap: an esses is three turns inside a
   * couple of car lengths, and at Gelleråsen turns 2, 3, 5 and 6 all sit within a
   * fifth of the drawing. On posts of one height their labels landed in a stack,
   * overlapping each other and their own names, and the two in the middle were
   * unreadable at any angle.
   *
   * So a corner that crowds the one before it is put on a taller post — up to two
   * steps, then back down. Nothing moves sideways, so every number stays directly
   * over its own apex and the reader can still follow a post down to the tarmac;
   * they simply stand at different heights, which is what separates them on
   * screen. The test is distance in the DRAWING, so it is the same decision at
   * every zoom, and lap order makes it stable — the same circuit always tiers the
   * same way. It is exported because §03's figure stands the same numbers over the
   * same circuits and must crowd them identically — see renderFigure() in
   * js/main.js. */
  const ks = tierMarks(marks, long);
  const tiered = marks.map((m, i) => ({ ...m, k: ks[i] }));

  const posts = tiered.map(m => `
    <div class="p3d-mark" style="left:${pct((m.x - vb.x) / vb.w)};top:${pct((m.y - vb.y) / vb.h)};--k:${m.k}">
      <i class="p3d-post" aria-hidden="true"></i>
      <b class="p3d-no"><span>${m.no}</span>${m.label ? `<em>${m.label}</em>` : ''}</b>
    </div>`).join('');

  return `<div class="p3d" data-layout3d
       style="--lift:${lift.toFixed(2)}px;--tilt:${START.tilt}deg;--rot:${START.rot}deg;--zoom:1">
    <div class="p3d-stage" tabindex="0" role="group"
         aria-label="Track layout in three dimensions. Drag to orbit, arrow keys to turn, 0 to reset.">
      <div class="p3d-plane" style="aspect-ratio:${vb.w.toFixed(2)}/${vb.h.toFixed(2)}">
        ${svg}
        <div class="p3d-marks">${posts}</div>
      </div>
      <span class="p3d-tag mono">${label}</span>
    </div>
    <div class="p3d-bar">
      <span class="p3d-hint mono">DRAG TO ORBIT · SCROLL OR PINCH TO ZOOM</span>
      <button class="p3d-reset mono" type="button">RESET VIEW</button>
    </div>
  </div>`;
}
