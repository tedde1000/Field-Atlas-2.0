/* ===========================================================================
 * globe.js — orthographic Earth on a 2D canvas, with the atlas plotted on it.
 *
 * No WebGL, no map library: a sphere, land rings from Natural Earth, a soft
 * terminator, and one pin per circuit. The globe idles with a slow drift and
 * eases to face whichever venue the page is currently talking about.
 *
 * Coordinates are {lat, lon} everywhere, per Field Atlas CONVENTIONS §3.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE (session 2). The first draft ran at 5 fps because every frame it
 * re-projected 5 123 land points with fresh sin/cos each, re-projected 1 375
 * graticule points, and filled four full-disc radial gradients. Four changes,
 * in the order they paid off:
 *
 *   1. The halo, ocean, terminator, rim and limb do not depend on the camera at
 *      all — only on size and theme. They are rendered once into three offscreen
 *      canvases and blitted. A blit is a memcpy; a radial gradient is evaluated
 *      per pixel. Invalidated on resize and on theme change ONLY.
 *   2. Every point is stored as a unit vector once at module load, so project()
 *      is eleven multiplies and no trigonometry whatsoever. See CACHE below.
 *   3. Each ring carries a bounding cap, so a ring entirely on the far side of
 *      the planet, or under two pixels across, costs one comparison instead of
 *      a path, a fill and a stroke.
 *   4. Past the hero the globe sits at ~0.14 opacity behind the scrim, so it
 *      drops to 15 fps there and stops entirely when effectively invisible.
 *
 * Note what is NOT on that list: throwing away points. See the star in paint().
 *
 * PERFORMANCE (session 3). The globe is a fixed, full-viewport canvas sitting
 * under #scrim and under a topbar that carries a backdrop-filter, so every
 * repaint invalidates a compositor layer that the browser must re-blend across
 * the whole page. Past the hero that buys nothing — the disc is at 0.14 opacity
 * and drifting 0.9°/s — but it lands squarely on the frame budget of whatever
 * the reader is actually doing, which is scrolling. Hence setBusy(): the page
 * tells the canvas when the reader is moving, and the canvas gets out of the
 * way until they stop. See the loop at the bottom.
 * ======================================================================== */
import { LAND } from '../data/world.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/* the sun sits up and to the left, so the lit limb reads along the top-left edge */
const SUN = { x: -0.62, y: -0.5, z: 0.6 };

/* ★ HOW FAR THE ATMOSPHERE REACHES PAST THE SURFACE, and therefore how much of
 * the canvas is NOT planet.
 *
 * Theodor: "the light shape around the globe is a bit squarish — there is a
 * small square gradient with atmospheric blue. I want you to round that so it's
 * the same gradient around the whole planet."
 *
 * It was square because the disc filled the canvas. `#globe-wrap` is a square
 * box and the radius was `min(w, h) / 2 - 2`, so a halo painted out to 1.13 × r
 * ran off all four edges — leaving the gradient visible only where the canvas
 * still had room, which is a rectangle with a circle bitten out of it. The
 * glow was never round; it was the corners of its own bounding box.
 *
 * So the halo's reach is a named constant now, the disc is sized to leave
 * exactly that much room, and app.css grows #globe-wrap by the same factor so
 * the planet stays the size it was on the page. If you change this, change the
 * three `#globe-wrap` widths with it — the comment there says so too. */
const HALO = 1.14;

/** signed shortest way round from a to b, in degrees */
const angleDelta = (a, b) => ((b - a + 540) % 360) - 180;

/* ★ THE CAMERA MAY NOT TURN FASTER THAN THIS, in degrees/second.
 *
 * Theodor, on scrolling back up out of the season: "it just spins back to point
 * 1 at max speed." Reproduced — going UP is fast, so §02's per-entry observer
 * re-aims the globe at all eight venues in quick succession, and then §00 aims
 * it home again. Each target change was chased with a 0.155 s time constant, so
 * the camera whipped between them: a ~9° swing landed in about a fifth of a
 * second, and eight of those back to back read as the planet spinning.
 *
 * An ease alone cannot fix this, because an ease is proportional — the further
 * the target, the faster it starts, which is exactly the wrong response to a
 * target that just jumped. A hard ceiling on angular speed is what "not at max
 * speed" actually means, and it costs nothing when the target is near: 34°/s is
 * well above the 0.9°/s idle drift, so idling is untouched. */
const MAX_TURN = 34;

/* ============================================================ THE POINT CACHE
 * A point's latitude and longitude never change — only the camera does. So each
 * point is stored once as the unit vector
 *      a = cos(lat)·sin(lon)   b = cos(lat)·cos(lon)   c = sin(lat)
 * and the whole projection reduces to multiplies against the camera's own
 * sin/cos, computed once per frame. That removes every sin() and cos() from a
 * 6 500-point inner loop.
 *
 * Each ring also gets a bounding cap: the normalised mean of its vectors, plus
 * the angular radius that covers all of them. Two comparisons per ring then
 * reject anything over the horizon or too small to see.
 * ========================================================================= */
function packRing(pts) {
  const n = pts.length;
  const xyz = new Float32Array(n * 3);
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    const lon = pts[i][0] * RAD, lat = pts[i][1] * RAD;
    const cl = Math.cos(lat);
    const a = cl * Math.sin(lon), b = cl * Math.cos(lon), c = Math.sin(lat);
    xyz[i * 3] = a; xyz[i * 3 + 1] = b; xyz[i * 3 + 2] = c;
    mx += a; my += b; mz += c;
  }
  const len = Math.hypot(mx, my, mz);
  let capA = 0, capB = 0, capC = 1, rho = Math.PI;   // degenerate -> never cull
  if (len > 1e-6) {
    capA = mx / len; capB = my / len; capC = mz / len;
    let minDot = 1;
    for (let i = 0; i < n; i++) {
      const d = capA * xyz[i * 3] + capB * xyz[i * 3 + 1] + capC * xyz[i * 3 + 2];
      if (d < minDot) minDot = d;
    }
    rho = Math.acos(Math.max(-1, Math.min(1, minDot)));
  }
  return {
    n, xyz,
    capA, capB, capC,
    // a ring is entirely on the far side when cos(camera·cap) < -sin(rho);
    // caps wider than a hemisphere can never be culled, hence the -2 sentinel
    cull: rho >= Math.PI / 2 ? -2 : -Math.sin(rho),
    // half-extent as a fraction of the globe radius, for the too-small-to-see test
    span: Math.sin(Math.min(rho, Math.PI / 2)),
  };
}

const LAND_RINGS = LAND.filter(r => r.length >= 5).map(packRing);

/* the 20° graticule, packed the same way so it draws through the same loop */
const GRATICULE = (() => {
  const out = [];
  for (let lon = -180; lon < 180; lon += 20) {
    const pts = [];
    for (let lat = -80; lat <= 80; lat += 4) pts.push([lon, lat]);
    out.push(packRing(pts));
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
    out.push(packRing(pts));
  }
  return out;
})();

export function createGlobe(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const tokens = getComputedStyle(document.documentElement);
  const tok = (n, f) => (tokens.getPropertyValue(n).trim() || f);

  const state = {
    lon: opts.lon ?? 16.5, lat: opts.lat ?? 44,   // current camera centre
    tLon: opts.lon ?? 16.5, tLat: opts.lat ?? 44, // eased target
    drift: 0.9,          // degrees/second of idle rotation
    holdUntil: 0,        // pause the drift for a moment after a look-at
    pins: [], home: null,
    focus: null,         // pin id currently being talked about
    running: true, motion: true,
    dim: 1,              // wrapper opacity, fed in by scroll.js
    busy: false,         // the reader is scrolling right now — see frame()
    w: 0, h: 0, r: 0, cx: 0, cy: 0, dpr: 1,
  };

  /* camera trig, recomputed once per frame rather than once per point */
  const cam = { sLon: 0, cLon: 1, sLat: 0, cLat: 1, a: 0, b: 1, c: 0 };
  function setCam() {
    const p0 = state.lat * RAD, l0 = state.lon * RAD;
    cam.sLon = Math.sin(l0); cam.cLon = Math.cos(l0);
    cam.sLat = Math.sin(p0); cam.cLat = Math.cos(p0);
    // the camera's own unit vector, in the same basis as the packed points
    cam.a = cam.cLat * cam.sLon; cam.b = cam.cLat * cam.cLon; cam.c = cam.sLat;
  }

  /* ------------------------------------------------------------- sizing */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.dpr = dpr;
    state.w = Math.max(1, Math.round(rect.width));
    state.h = Math.max(1, Math.round(rect.height));
    canvas.width = state.w * dpr;
    canvas.height = state.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.cx = state.w / 2;
    state.cy = state.h / 2;
    // divide by HALO, do not subtract a margin: the atmosphere has to fit INSIDE
    // the canvas or it gets clipped to the canvas rectangle. See HALO above.
    state.r = (Math.min(state.w, state.h) / 2 - 2) / HALO;
    layers.dirty = true;
  }

  /* ================================================= the cached still layers
   * Everything that does not move with the camera, rendered once. `below` goes
   * under the land, `shade` and `rim` go over the graticule — rim with 'lighter',
   * which is plain addition, so blitting it composites identically to filling it.
   * ====================================================================== */
  const layers = { dirty: true, theme: null, below: null, shade: null, rim: null, accent: '', ink: '' };

  function makeLayer() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(state.w * state.dpr));
    c.height = Math.max(1, Math.round(state.h * state.dpr));
    const g = c.getContext('2d');
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    return { c, g };
  }

  function buildLayers(isDay) {
    const { cx, cy, r } = state;
    const disc = (g) => { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip(); };
    const lx = cx + SUN.x * r * 0.72, ly = cy + SUN.y * r * 0.72;

    /* -- below: the air outside the limb, then the lit ocean inside it -- */
    const b = makeLayer();
    const halo = b.g.createRadialGradient(cx, cy, r * 0.965, cx, cy, r * HALO);
    halo.addColorStop(0, isDay ? 'rgba(90,130,160,.30)' : 'rgba(96,158,196,.26)');
    halo.addColorStop(0.45, isDay ? 'rgba(90,130,160,.09)' : 'rgba(80,132,170,.09)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    b.g.fillStyle = halo;
    // fill the DISC the gradient occupies, not a rectangle — a rect fill would
    // put the gradient's transparent tail in the corners and, if the canvas ever
    // gets tighter than HALO again, show the box instead of the atmosphere
    b.g.beginPath(); b.g.arc(cx, cy, r * HALO, 0, TAU); b.g.fill();

    b.g.save(); disc(b.g);
    const sea = b.g.createRadialGradient(lx, ly, r * 0.04, cx - SUN.x * r * .3, cy - SUN.y * r * .3, r * 1.5);
    if (isDay) {
      sea.addColorStop(0, '#2f5f7d'); sea.addColorStop(0.45, '#1d4359'); sea.addColorStop(1, '#0c2130');
    } else {
      sea.addColorStop(0, '#12333f'); sea.addColorStop(0.42, '#0b2130'); sea.addColorStop(1, '#040a10');
    }
    b.g.fillStyle = sea;
    b.g.fillRect(cx - r, cy - r, r * 2, r * 2);
    b.g.restore();

    /* -- shade: the terminator, then the limb itself -- */
    const s = makeLayer();
    s.g.save(); disc(s.g);
    const term = s.g.createRadialGradient(lx, ly, r * 0.12, cx - SUN.x * r, cy - SUN.y * r, r * 1.72);
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.42, isDay ? 'rgba(6,10,16,.16)' : 'rgba(3,5,8,.42)');
    term.addColorStop(1, isDay ? 'rgba(4,7,12,.62)' : 'rgba(2,3,5,.95)');
    s.g.fillStyle = term;
    s.g.fillRect(cx - r, cy - r, r * 2, r * 2);
    s.g.restore();
    s.g.strokeStyle = isDay ? 'rgba(30,40,50,.35)' : 'rgba(150,200,230,.22)';
    s.g.lineWidth = 1;
    s.g.beginPath(); s.g.arc(cx, cy, r, 0, TAU); s.g.stroke();

    /* -- rim: additive light along the lit limb, blitted with 'lighter' -- */
    const m = makeLayer();
    m.g.save(); disc(m.g);
    const rim = m.g.createRadialGradient(cx, cy, r * 0.9, cx, cy, r);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, isDay ? 'rgba(150,190,220,.34)' : 'rgba(120,190,230,.30)');
    m.g.fillStyle = rim;
    m.g.fillRect(cx - r, cy - r, r * 2, r * 2);
    m.g.restore();

    layers.below = b.c; layers.shade = s.c; layers.rim = m.c;
    // getPropertyValue forces a style read, so the tokens are cached here too
    layers.accent = tok('--accent', '#c9974f');
    layers.ink = tok('--ink', '#ece5d9');
    layers.theme = isDay ? 'day' : 'night';
    layers.dirty = false;
  }

  /* ----------------------------------------------------- the projection */
  /* General form, for the handful of pins. Returns null on the far side. */
  function project(lat, lon) {
    const p = lat * RAD, l = lon * RAD;
    const cl = Math.cos(p);
    return projectVec(cl * Math.sin(l), cl * Math.cos(l), Math.sin(p));
  }

  /* The hot one: a packed unit vector, no trigonometry. */
  function projectVec(a, b, c) {
    const P = b * cam.cLon + a * cam.sLon;
    const cosc = cam.sLat * c + cam.cLat * P;
    if (cosc < 0) return null;
    return {
      x: state.cx + state.r * (a * cam.cLon - b * cam.sLon),
      y: state.cy - state.r * (cam.cLat * c - cam.sLat * P),
      z: cosc,
    };
  }

  /* Append a packed ring to two paths at once: `fillPath` gets a continuous
   * outline, `strokePath` gets only the runs that are actually on this side.
   *
   * ★ HORIZON CLIPPING. The old code just skipped hidden points and let fill()
   * close each visible run implicitly — so a landmass crossing the limb was
   * closed with a straight chord across the disc, and the Americas rendered as
   * a grey wedge over the whole left limb. Very visible at 2560.
   *
   * The fix needs no intersection maths. Orthographic projects the FAR
   * hemisphere onto the same disc, at the correct azimuth but at a radius under
   * r — so pushing a hidden point out to exactly r lands it on the limb, in the
   * right place. Do that for every hidden point and the fill boundary becomes
   * "true coastline while visible, limb arc while hidden", which is precisely
   * the correct silhouette.
   *
   * The stroke must NOT follow the limb, or every continent that crosses it
   * grows a bright false coastline along the edge — hence the two paths.
   *
   * No closePath(): fill() closes each subpath implicitly, which is what we
   * want, while an explicit close would draw the closing segment in the stroke. */
  function ringInto(fillPath, strokePath, ring, step) {
    const { xyz, n } = ring;
    const { cx, cy, r } = state;
    const { sLon, cLon, sLat, cLat } = cam;
    let open = false, started = false;
    for (let i = 0; i < n; i += step) {
      const j = i * 3;
      const a = xyz[j], b = xyz[j + 1], c = xyz[j + 2];
      const P = b * cLon + a * sLon;
      const front = sLat * c + cLat * P >= 0;
      let x = cx + r * (a * cLon - b * sLon);
      let y = cy - r * (cLat * c - sLat * P);

      if (!front) {
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 1e-6) { open = false; continue; }   // the exact antipode has no azimuth
        x = cx + dx / d * r;
        y = cy + dy / d * r;
        open = false;                                // break the visible stroke run
      }

      if (fillPath) {
        if (!started) { fillPath.moveTo(x, y); started = true; } else fillPath.lineTo(x, y);
      }
      if (front) {
        if (!open) { strokePath.moveTo(x, y); open = true; } else strokePath.lineTo(x, y);
      }
    }
  }

  /** true when the ring is worth drawing at all */
  function ringVisible(ring, r) {
    const dot = cam.a * ring.capA + cam.b * ring.capB + cam.c * ring.capC;
    if (dot < ring.cull) return false;            // wholly over the horizon
    /* ★ THE SIZE CULL IS THE HOT ONE, because the per-ring cost is fixed — a
     * Path2D allocation and a fill() — and does NOT scale with how big the ring
     * is. 50m coastlines are 892 rings against 110m's 280, and the extra 612 are
     * almost all islands a few pixels across. At the hero disc (r=396) a 1.5px
     * floor keeps 792 rings; a 5px floor keeps 267 — two thirds fewer fills for
     * 83% of the points, i.e. all of the coastline anyone can actually see.
     * That ratio is why the frame rate came back after the 50m swap. */
    return 2 * r * ring.span >= 5;                // or too small to register
  }

  /* ------------------------------------------------------------ painting */
  function paint() {
    const { cx, cy, r, w, h } = state;
    ctx.clearRect(0, 0, w, h);
    if (r <= 4) return;

    const isDay = document.documentElement.dataset.theme === 'day';
    if (layers.dirty || layers.theme !== (isDay ? 'day' : 'night')) buildLayers(isDay);
    const accent = layers.accent;

    setCam();

    // -- the still layers below the land: air, then ocean
    ctx.drawImage(layers.below, 0, 0, w, h);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();

    // -- land. Decimation widens as the rendered globe shrinks, but never so far
    //    that a six-point island collapses into a triangle.
    /* ★ Each ring is FILLED SEPARATELY, and that is deliberate — do not "optimise"
     * this into one batched fill. A ring that crosses the limb is drawn as runs of
     * visible points, so it is not a well-formed closed polygon; batching those
     * into one Path2D makes the nonzero winding rule punch holes at random, and
     * the visible result is Europe and the Mediterranean rendering as sea. The
     * STROKE has no winding rule, so that one is safely batched. */
    /* ★ DO NOT INDEX-DECIMATE THESE RINGS. They arrive from trace/extract.py
     * already run through Douglas-Peucker at 0.05°, and DP output is the
     * opposite of uniform: every surviving point is load-bearing, kept
     * precisely because dropping it would move the outline. Taking every
     * *other* one therefore does not halve the detail, it deletes the corners —
     * measured at a 440px disc with the old `base = 2`, Italy disappeared into
     * the Adriatic, Greece and Denmark became blobs, Cyprus became a rectangle,
     * and thin coastal features collapsed into stray slivers lying in the sea.
     * That is the "weird stuff in some countries" this fix is for; compare
     * trace/shots/globe/*-step1 against the frames beside them.
     *
     * The old ladder was written against RAW 50m, which does carry a uniform
     * ~0.1–0.3° between points and can survive being sampled. The data stopped
     * being raw when the simplify step landed; the ladder did not notice, and
     * the comment describing it had been stale ever since.
     *
     * Skipping it back is also worth very little: projection is eleven
     * multiplies out of the packed cache with no trigonometry, so the whole
     * 19 667-point set costs far less than the per-ring Path2D and fill() that
     * the size cull above already removes. Below ~150px across, nothing on the
     * disc resolves anyway and every 2nd point is safe. */
    const base = r > 150 ? 1 : 2;
    const outline = new Path2D();
    ctx.fillStyle = isDay ? 'rgba(196,186,160,.92)' : 'rgba(126,124,108,.5)';
    for (const ring of LAND_RINGS) {
      if (!ringVisible(ring, r)) continue;
      const p = new Path2D();
      ringInto(p, outline, ring, Math.min(base, Math.max(1, Math.floor(ring.n / 6))));
      ctx.fill(p);
    }
    ctx.strokeStyle = isDay ? 'rgba(60,58,46,.35)' : 'rgba(196,186,160,.28)';
    ctx.lineWidth = 0.7;
    ctx.stroke(outline);

    // -- graticule, 20°, quiet. Stroke only, so no fill path — a null fillPath
    //    also means it never picks up the limb-hugging segments.
    const grat = new Path2D();
    const gstep = r > 300 ? 1 : 2;
    for (const ring of GRATICULE) {
      if (!ringVisible(ring, r)) continue;
      ringInto(null, grat, ring, gstep);
    }
    ctx.strokeStyle = isDay ? 'rgba(20,20,14,.13)' : 'rgba(236,229,217,.085)';
    ctx.lineWidth = 0.6;
    ctx.stroke(grat);

    // -- terminator + limb, then the additive rim
    ctx.drawImage(layers.shade, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(layers.rim, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();

    // -- pins ------------------------------------------------------------
    const t = performance.now() / 1000;
    for (const pin of state.pins) {
      const p = project(pin.lat, pin.lon);
      if (!p) continue;
      const fade = Math.min(1, p.z * 3.2);           // dim toward the limb
      const focus = state.focus === pin.id;
      ctx.globalAlpha = fade * (pin.event ? 1 : 0.62);

      if (pin.event) {
        const r = focus ? 4.4 : 3.2;
        ctx.fillStyle = pin.color;
        ctx.shadowColor = pin.color;
        ctx.shadowBlur = 10 * fade;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        // day side: the accents are light on a light globe, so ring them
        if (isDay) {
          ctx.strokeStyle = 'rgba(12,16,20,.75)'; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 0.8, 0, TAU); ctx.stroke();
        }
        if (pin.next || focus) {                      // the live one breathes
          const k = (t * 0.55 + (pin.next ? 0 : 0.4)) % 1;
          ctx.globalAlpha = fade * (1 - k) * 0.85;
          ctx.strokeStyle = pin.color; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + k * 17, 0, TAU); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = accent; ctx.lineWidth = isDay ? 1.5 : 1.1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.7, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // -- home, drawn as a survey cross rather than another dot
    if (state.home) {
      const p = project(state.home.lat, state.home.lon);
      if (p) {
        ctx.globalAlpha = Math.min(1, p.z * 3.2) * 0.8;
        ctx.strokeStyle = layers.ink; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y);
        ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* --------------------------------------------------------------- loop */
  let last = performance.now();
  let lastPaint = -1e9;
  let raf = 0;
  /* ★ Published as data-paints so verify.mjs §8 can assert the REPAINT RATE
     rather than the frame rate. Frame rate in headless measures swiftshader's
     software rasteriser, which is not what ships and which varied 14–150 fps
     run to run on identical code. What actually matters — and what caused the
     5 fps this work started from — is a canvas repainting when it has no need
     to, and that is exactly what this counter makes measurable. */
  let paints = 0;
  let stillSig = '';        // last frame painted while MOTION was off
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.running) return;

    if (state.motion) {
      const k = 1 - Math.pow(0.0016, dt);            // frame-rate independent ease
      let dLon = angleDelta(state.lon, state.tLon) * k;
      let dLat = (state.tLat - state.lat) * k;

      // ★ clamp the turn rate — see MAX_TURN. Scale both axes by the same factor
      // so a capped turn follows the same arc, just slower, instead of sliding
      // along one axis first and bending toward the target at the end.
      const mag = Math.hypot(dLon, dLat), cap = MAX_TURN * dt;
      if (mag > cap) { const s = cap / mag; dLon *= s; dLat *= s; }

      state.lon += dLon;
      state.lat += dLat;
      if (now > state.holdUntil) {
        state.tLon += state.drift * dt;              // keep drifting once settled
      }
    } else {
      state.lon = state.tLon; state.lat = state.tLat;

      /* ★ MOTION OFF MUST MEAN STATIC, and it quietly did not. The camera stops
         here, but the live pin's pulse is driven by the clock inside paint() —
         so the globe went on repainting an all-but-identical frame at its full
         budget, forever, with motion off. verify.mjs §8 caught it: the starfield
         sat correctly at 0 Hz while the globe ran at its budget beside it.
         With motion off, paint only when something has genuinely changed. */
      const sig = state.lon.toFixed(2) + '|' + state.lat.toFixed(2) + '|' +
                  state.dim.toFixed(2) + '|' + state.focus + '|' +
                  document.documentElement.dataset.theme + '|' + state.w + 'x' + state.h;
      if (sig === stillSig && !layers.dirty) return;
      stillSig = sig;
    }

    /* A changing canvas layer forces the page to re-composite, and #scrim and the
       topbar's backdrop-filter sit on top of this one — so what matters is how
       OFTEN the globe changes, not how fast it draws. The idle drift is 0.9°/s;
       at a 660px disc that is a fifth of a pixel per frame at 60 Hz. 30 Hz is
       indistinguishable, and past the hero the globe is at ~0.14 opacity behind
       the scrim, where 15 Hz is generous. */
    if (state.dim <= 0.02) return;

    /* ★ WHILE THE READER IS SCROLLING, A DIMMED GLOBE PAINTS NOTHING.
     *
     * Theodor: "when the globe is behind the track layouts and the track facts,
     * it's a bit more laggy compared to before." It is, and the disc itself is
     * not the reason — the compositor is. This canvas is fixed and
     * viewport-sized, #scrim lies over it and the topbar over that with a
     * backdrop-filter, so a repaint here does not just cost its own raster: it
     * dirties a layer that has to be re-blended under everything, and it does
     * that in the middle of the one frame budget the reader can actually feel.
     *
     * Past the hero there is nothing on the disc worth the money. It sits at
     * 0.14 opacity behind the scrim and drifts 0.9°/s, which at a 660px disc is
     * a fifth of a pixel per frame — invisible while the page is moving under
     * it. So it stands still until the reader does, then picks the drift back
     * up. Above dim 0.5 the globe IS the subject and this never applies, so the
     * hero is untouched. */
    if (state.busy && state.dim < 0.5) return;

    const budget = state.dim < 0.25 ? 1000 / 8 : 1000 / 30;
    if (now - lastPaint < budget) return;
    lastPaint = now;

    /* The camera, reflected onto the canvas so the suite can see it. There is no
       DOM inside a canvas, and CONVENTIONS §5 says tests read ids and data-* —
       so the camera is published as data-*, written only on a real paint (8–30
       Hz, not per frame) and rounded, which keeps it off the hot path. */
    canvas.dataset.lon = state.lon.toFixed(1);
    canvas.dataset.lat = state.lat.toFixed(1);
    canvas.dataset.paints = ++paints;

    paint();
  }

  /* ------------------------------------------------------------- public */
  const api = {
    resize() { resize(); paint(); },
    setPins(pins, home) { state.pins = pins; state.home = home || null; },
    /**
     * Turn the Earth so this coordinate faces the camera.
     *
     * `settled` is for re-aims the reader did not ask for — arriving back at a
     * chapter rather than choosing a date. ★ It is the fix for "when u scroll up
     * from it disappearing it just spins back to point 1 at max speed": while
     * the globe is dimmed behind the scrim there is nothing to animate FOR, so
     * the camera is placed rather than flown, and the hero fades in already
     * pointing the right way. Animating it instead saves the whole traversal up
     * and plays it as a spin at the exact moment the globe becomes visible,
     * which is what he was seeing. Once the globe IS the subject (dim >= .5) a
     * look-at eases normally, so nothing teleports in front of the reader.
     */
    lookAt(lat, lon, { hold = 2600, settled = false } = {}) {
      state.tLat = Math.max(-70, Math.min(70, lat));
      state.tLon = lon;
      state.holdUntil = performance.now() + hold;
      if (settled && state.dim < 0.5) {
        state.lat = state.tLat;
        state.lon = state.tLon;
      }
    },
    focus(id) { state.focus = id; },
    /** the wrapper's current opacity, so the paint budget can follow it */
    setDim(v) { state.dim = v; },
    /** true while the reader is actively scrolling — see the star in frame() */
    setBusy(v) {
      if (state.busy === v) return;
      state.busy = v;
      /* Published for the suite, per CONVENTIONS §5 (tests read data-*). The
         check that guards this fix has to assert the MECHANISM — no repaints
         across a window where the gate was continuously closed — because
         asserting a repaint-rate ratio instead measured headless scheduling
         noise and went amber run to run on identical code. */
      canvas.dataset.busy = v ? '1' : '0';
      // coming out of a scroll, repaint at once rather than waiting out the
      // budget, so the drift resumes from where the camera actually is
      if (!v) lastPaint = -1e9;
    },
    /** screen position of a pin right now, or null if it is on the far side */
    pinAt(id) {
      const pin = state.pins.find(x => x.id === id);
      if (!pin) return null;
      setCam();
      return project(pin.lat, pin.lon);
    },
    /** nearest pin within `tol` px of a point in canvas space, or null */
    hitTest(x, y, tol = 14) {
      setCam();
      let best = null, bd = tol * tol;
      for (const pin of state.pins) {
        const p = project(pin.lat, pin.lon);
        if (!p) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = pin; }
      }
      return best;
    },
    setMotion(on) {
      state.motion = on;
      if (!on) { state.lon = state.tLon; state.lat = state.tLat; paint(); }
    },
    pause() { state.running = false; },
    resume() { state.running = true; last = performance.now(); lastPaint = -1e9; },
    destroy() { cancelAnimationFrame(raf); },
  };

  resize();
  raf = requestAnimationFrame(frame);
  return api;
}
