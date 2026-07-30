/* ===========================================================================
 * gear.js — reading Field Atlas 1.x's gear data, and only ever reading it.
 *
 * ★ 1.x AND 2.0 SHARE localStorage IN PRODUCTION. localStorage is scoped to an
 * ORIGIN — scheme, host, port — and not to a path. Both apps are served from
 * https://tedde1000.github.io, so .../Field-Atlas/ and .../Field-Atlas-2.0/ are
 * the same origin and see exactly the same storage. That is why 2.0 can show the
 * real gear list Theodor maintains in 1.x with no sync and no export step.
 *
 * It is also why 2.0 could destroy it. So the rule in this file is absolute:
 *
 *      2.0 READS evhub.*   ·   2.0 NEVER WRITES, MIGRATES OR DELETES evhub.*
 *
 * 1.x owns those keys. Anything 2.0 needs to persist goes under its own fa2.
 * prefix. There is no code path in this module that writes an evhub key, and
 * there must never be one — trace/verify.mjs §9 asserts it.
 *
 * ★ IN DEVELOPMENT THE SHARING WILL LOOK BROKEN, AND IT IS NOT. localhost:8765
 * (1.x) and localhost:8766 (2.0) differ by port, so they are different origins
 * and do not share storage. Do not "fix" this because it fails on localhost. To
 * exercise the shared path, serve both from one port under different paths, or
 * seed evhub.* by hand.
 * ======================================================================== */

/* 1.x's FA.store schema versions, from its defineSchema() calls. We refuse to
   interpret anything NEWER than we understand rather than guessing at a shape a
   later 1.x invented — see read(). */
const KNOWN_VERSION = { gear: 1, bring: 1, plan: 1 };

const raw = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

/**
 * Unwrap one FA.store value.
 *
 * 1.x stores `{__v, data}` as JSON. A value that parses to JSON but carries no
 * `__v` is a pre-FA.store legacy value and counts as v0; a bare non-JSON string
 * is v0 data too. This mirrors FA.store.get() exactly, MINUS the migration —
 * 1.x rewrites the migrated shape back to disk, and we must not.
 *
 * @returns {{present:boolean, value:*, version:number|null, tooNew:boolean}}
 */
function read(base, key, fallback) {
  const s = raw(key);
  if (s == null) return { present: false, value: fallback, version: null, tooNew: false };
  let box;
  try { box = JSON.parse(s); } catch { box = s; }
  if (!box || typeof box !== 'object' || !('__v' in box)) box = { __v: 0, data: box };
  const version = Number(box.__v) || 0;
  // respect the version field rather than assuming v1
  if (version > (KNOWN_VERSION[base] ?? 1)) {
    return { present: true, value: fallback, version, tooNew: true };
  }
  return {
    present: true,
    value: box.data === undefined ? fallback : box.data,
    version,
    tooNew: false,
  };
}

/* 1.x's category order, so 2.0 groups the kit the same way it does */
export const GEAR_CATS = ['Bodies', 'Lenses', 'Accessories', 'Power & Storage', 'Weather & Apparel'];

/* ===================================================== THE KIT, RECOVERED
 * ★ WHERE THIS LIST CAME FROM, BECAUSE IT MATTERS AND IT IS NOT OBVIOUS.
 *
 * Theodor: "in the first Field Atlas I had equipment and gear sections, which I
 * also want you to make — but don't put in random stuff, check out my gear in the
 * Field Atlas first."
 *
 * His gear is not in the 1.x repository. `evhub.gear.inventory` is localStorage,
 * so the real list lives in the browser on his phone and nowhere a checkout can
 * see it. 1.x's `initGear()` today seeds `[]` deliberately:
 *
 *     "Start EMPTY. The app used to seed 29 suggested items on first run, which
 *      meant the kit opened full of equipment nobody owned and the real job became
 *      deleting things. It's your kit — you add it."
 *
 * But those 29 items still exist, in git. This is `seedGear()` as it stood at
 * Field-Atlas commit dacef4d, before 7497b37 removed it, and session 16's notes
 * describe it as "real kit + rental options + suggested basics" — so it is his
 * equipment, with two kinds of things that are not, both of which 1.x already
 * flagged in the data and both of which this page prints:
 *
 *     status 'rental'    he does not own it; it is what he would hire
 *     suggested: true    a generic basic the seed proposed. These are the ones
 *                        that got the whole seed deleted. They are shown, marked,
 *                        and they are not counted as his.
 *
 * ★ IT IS A FALLBACK, NEVER AN OVERRIDE. A live `evhub.gear.inventory` wins
 * outright — see kit() below. On his phone, where 1.x and 2.0 are the same
 * origin, this list will never be reached at all. It is here so the page has
 * something true to show on a machine where 1.x has never run, instead of an
 * empty box, and so the section can be worked on at all.
 *
 * ★ 1.x's HARD RULE, KEPT: never seed or suggest flash or strobe. He does not
 * use it. There is none in here and none may be added.
 *
 * Do not hand-edit this to "add" equipment. If the kit is wrong, it is wrong in
 * 1.x, and 1.x is where it gets fixed — that is the whole point of the app that
 * owns it.
 * ==================================================================== */
export const KIT_1X = [
  // Bodies
  { id: 'body-a7iii', name: 'Sony A7 III', category: 'Bodies', status: 'owned', defaultQty: 1 },
  { id: 'rent-body2', name: 'Second Sony body (A7 IV / A9 class)', category: 'Bodies', status: 'rental', defaultQty: 1 },
  // Lenses
  { id: 'lens-tamron-2875', name: 'Tamron 28–75mm f/2.8 (Sony E)', category: 'Lenses', status: 'owned', defaultQty: 1 },
  { id: 'rent-70200', name: '70–200mm f/2.8', category: 'Lenses', status: 'rental', defaultQty: 1 },
  { id: 'rent-100400', name: '100–400mm f/4.5–5.6', category: 'Lenses', status: 'rental', defaultQty: 1 },
  { id: 'rent-1635', name: '16–35mm f/2.8 or f/4', category: 'Lenses', status: 'rental', defaultQty: 1 },
  // Accessories
  { id: 'acc-monopod', name: 'Monopod', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-backpack', name: 'Camera backpack', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-cpl', name: 'CPL filter', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-cloth', name: 'Microfiber cloth', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-sd-reader', name: 'USB-C SD card reader', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-usba', name: 'USB-A adapter', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'acc-laptop', name: 'School laptop (photo sorting)', category: 'Accessories', status: 'owned', defaultQty: 1 },
  { id: 'rent-macbook', name: 'MacBook Pro', category: 'Accessories', status: 'rental', defaultQty: 1 },
  { id: 'acc-ear', name: 'Ear protection (motorsport/karting)', category: 'Accessories', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'acc-hivis', name: 'Hi-vis vest', category: 'Accessories', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'acc-blower', name: 'Rocket blower / lens cleaning kit', category: 'Accessories', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'acc-gaffer', name: 'Gaffer tape', category: 'Accessories', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'acc-water', name: 'Water bottle', category: 'Accessories', status: 'owned', defaultQty: 1, suggested: true },
  // Power & Storage
  { id: 'pow-bank', name: 'Power bank', category: 'Power & Storage', status: 'owned', defaultQty: 1 },
  { id: 'pow-sd128', name: 'SD card 128 GB', category: 'Power & Storage', status: 'owned', defaultQty: 1 },
  { id: 'pow-npfz100', name: 'NP-FZ100 battery', category: 'Power & Storage', status: 'owned', defaultQty: 3 },
  { id: 'pow-charger', name: 'Triple battery charger', category: 'Power & Storage', status: 'owned', defaultQty: 1 },
  { id: 'rent-extra-sd', name: 'Extra SD cards', category: 'Power & Storage', status: 'rental', defaultQty: 1, suggested: true },
  // Weather & Apparel
  { id: 'wx-rain-cover', name: 'Rain cover for camera', category: 'Weather & Apparel', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'wx-jacket', name: 'Waterproof jacket', category: 'Weather & Apparel', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'wx-gloves', name: 'Gloves', category: 'Weather & Apparel', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'wx-beanie', name: 'Beanie', category: 'Weather & Apparel', status: 'owned', defaultQty: 1, suggested: true },
  { id: 'wx-sunscreen', name: 'Sunscreen', category: 'Weather & Apparel', status: 'owned', defaultQty: 1, suggested: true },
];

/**
 * The kit to show, and where it came from — one answer for the whole page.
 *
 * `source` is not decoration. A reader looking at a list of their own equipment
 * deserves to know whether the page is reading it live or showing the last thing
 * 1.x is known to have carried, and every surface that prints this list prints
 * that too.
 *
 *   'live'      evhub.gear.inventory exists and has items. His actual kit.
 *   'recovered' it does not. KIT_1X, from 1.x's git history — see above.
 *   'too-new'   a newer 1.x wrote a schema this page does not understand. We
 *               refuse to interpret it rather than guess at the shape.
 */
export function kit() {
  const inv = inventory();
  if (inv.tooNew) return { source: 'too-new', version: inv.version, items: [] };
  const live = inv.present && inv.value.length;
  const raw = live ? inv.value : KIT_1X;
  const items = raw.map((it) => ({
    id: it.id,
    name: it.name || 'Untitled',
    category: GEAR_CATS.includes(it.category) ? it.category : GEAR_CATS[0],
    rental: it.status === 'rental',
    suggested: !!it.suggested,
    qty: Math.max(1, Math.round(+it.defaultQty || 1)),
  }));
  return { source: live ? 'live' : 'recovered', items };
}

/**
 * ★ THE EVENT KEY, WHICH WILL BITE YOU.
 * 2.0 keys events by position — `gellerasen:0`, see EVENTS in main.js. 1.x keys
 * them by timestamp — `gellerasen:1765609200000`. Rörken hosts two dates, so an
 * index and a date genuinely are not interchangeable. Everything that touches
 * 1.x storage must go through here.
 */
export const eventKey = (venueId, iso) => `${venueId}:${Date.parse(iso)}`;

/** the global inventory 1.x maintains — one array for the whole app */
export function inventory() {
  const r = read('gear', 'evhub.gear.inventory', []);
  return { ...r, value: Array.isArray(r.value) ? r.value : [] };
}

/** what 1.x says to BRING to one event: { itemId: {qty} } */
export function bring1x(key) {
  const r = read('bring', 'evhub.bring.' + key, {});
  return { ...r, value: (r.value && typeof r.value === 'object') ? r.value : {} };
}

/** a custom day plan saved in 1.x for one event, which overrides the default */
export function plan1x(key) {
  const r = read('plan', 'evhub.plan.' + key, null);
  return { ...r, value: Array.isArray(r.value) ? r.value : null };
}

/* ===================================================== 2.0's own overlay
 * Theodor chose to keep the two apps independent: 2.0 reads the real inventory
 * and the real bring list out of 1.x, but its own ticks live under fa2. and are
 * merged on read. Ticking here therefore does NOT show up in 1.x — that was the
 * explicit trade for never being able to corrupt the gear data.
 * ==================================================================== */
const OVERLAY = (key) => 'fa2.bring.' + key;

export function overlay(key) {
  const s = raw(OVERLAY(key));
  if (s == null) return {};
  try {
    const v = JSON.parse(s);
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}

export function setOverlay(key, map) {
  try { localStorage.setItem(OVERLAY(key), JSON.stringify(map)); return true; }
  catch { return false; }
}

/**
 * The list to show for one event: every inventory item, marked with whether it
 * is on the list and at what quantity, with 2.0's overlay layered over 1.x's.
 *
 * `sources.list` distinguishes the three states that must not be conflated:
 *   'none'    — no evhub.gear.inventory at all. A fresh browser, or 1.x has
 *               never run on this origin. The panel links out to 1.x.
 *   'empty'   — an inventory exists but this date has nothing picked. Normal.
 *   'ok'      — items picked.
 */
export function packingList(key) {
  const k = kit();
  const from1x = bring1x(key);
  const mine = overlay(key);

  if (k.source === 'too-new' || from1x.tooNew) {
    return { state: 'too-new', version: k.version ?? from1x.version, items: [], total: 0 };
  }

  /* ★ THE `none` STATE IS GONE, and that is the point of KIT_1X. This used to
     return an empty list with a link out to 1.x whenever `evhub.gear.inventory`
     was absent — which is every browser 1.x has never run in, including every
     dev machine, so the packing list on this page was an apology far more often
     than it was a list. There is always a kit to show now; `source` says whether
     it is the live one, and the panel prints that. */
  const items = k.items.map((it) => {
    const o = Object.prototype.hasOwnProperty.call(mine, it.id) ? mine[it.id] : null;
    const b = from1x.value[it.id] || null;
    const src = o || b;
    return {
      ...it,
      on: !!src && o?.removed !== true,
      qty: Math.max(1, Math.round(+(src?.qty) || it.qty)),
      // where the tick came from, so the panel can be honest about it
      from: o ? 'fa2' : (b ? '1.x' : null),
    };
  });

  const on = items.filter(i => i.on);
  return {
    state: on.length ? 'ok' : 'empty',
    source: k.source,
    items,
    total: on.reduce((n, i) => n + i.qty, 0),
    // ★ the brief's assertion: did the key we built actually exist in storage?
    hadKey: from1x.present,
  };
}
