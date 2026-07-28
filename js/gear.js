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
  const inv = inventory();
  const from1x = bring1x(key);
  const mine = overlay(key);

  if (inv.tooNew || from1x.tooNew) {
    return { state: 'too-new', version: inv.version ?? from1x.version, items: [], total: 0 };
  }
  if (!inv.present || !inv.value.length) {
    return { state: 'none', items: [], total: 0, hadKey: from1x.present };
  }

  const items = inv.value.map((it) => {
    const o = Object.prototype.hasOwnProperty.call(mine, it.id) ? mine[it.id] : null;
    const b = from1x.value[it.id] || null;
    const src = o || b;
    return {
      id: it.id,
      name: it.name || 'Untitled',
      category: GEAR_CATS.includes(it.category) ? it.category : GEAR_CATS[0],
      rental: it.status === 'rental',
      suggested: !!it.suggested,
      on: !!src && o?.removed !== true,
      qty: Math.max(1, Math.round(+(src?.qty) || +it.defaultQty || 1)),
      // where the tick came from, so the panel can be honest about it
      from: o ? 'fa2' : (b ? '1.x' : null),
    };
  });

  const on = items.filter(i => i.on);
  return {
    state: on.length ? 'ok' : 'empty',
    items,
    total: on.reduce((n, i) => n + i.qty, 0),
    // ★ the brief's assertion: did the key we built actually exist in storage?
    hadKey: from1x.present,
  };
}
