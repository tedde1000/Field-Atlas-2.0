/* =====================================================================
 * Field Atlas 2.0 — service worker
 *
 * 2.0 is a fully static page: no weather call, no map tiles, no runtime
 * fetch of any kind. So unlike 1.x — which has to keep a live endpoint
 * live and cap an unbounded tile cache — the whole job here is "precache
 * the shell, then work with no signal at all".
 *
 * Bump CACHE_VERSION on every deploy. skipWaiting() + clients.claim() are
 * kept from 1.x for the same reason: an installed app has no update
 * button, so a `git push` has to land on the NEXT launch rather than sit
 * behind a worker that never gets to activate.
 *
 * ★ THE TWO STRATEGIES ARE SPLIT ON `?v=`, AND THAT IS LOAD-BEARING.
 *   trace/bundle.mjs stamps index.html's own asset URLs with a hash of
 *   their bytes (see stamp_index there, and the note about the page that
 *   froze because the JS reloaded and app.css did not). A stamped URL is
 *   therefore immutable — the bytes cannot change without the URL
 *   changing — so it is safe to serve cache-first forever, and that is
 *   where the launch actually costs something: three earth images at
 *   several MB, both stylesheets, the entry module.
 *
 *   Everything else same-origin is UNSTAMPED, and the js/*.js modules
 *   that main.js imports are the important case: their specifiers live
 *   inside JavaScript, where the stamper cannot reach them. Serving those
 *   stale-while-revalidate would reintroduce exactly the half-state the
 *   stamping exists to prevent — a fresh index.html and main.js next to a
 *   module from the previous deploy. So they are network-first, and fall
 *   back to cache only when the network fails. They are small; correctness
 *   is worth the round trip, and offline still works because the fallback
 *   is a full precache rather than a partial one.
 * ===================================================================== */
const CACHE_VERSION = 'fa2-v2';
const SHELL = CACHE_VERSION + '-shell';

/* There is no cross-origin branch here, and that is a property of the page
   rather than an omission: since Outfit was self-hosted into assets/fonts.css
   (trace/fonts.mjs) as data: URIs, 2.0 requests nothing off its own origin.
   The worker used to carry a fonts.googleapis.com / fonts.gstatic.com cache,
   which meant the typeface only arrived on the SECOND load — a cold offline
   first launch fell back to system sans. Nothing to cache now; it ships in the
   stylesheet. If anything here ever needs a CDN again, that is the regression. */

/* The unstamped half of the shell: the module graph main.js pulls in, plus the
   files that are never referenced from index.html with an attribute at all.
   ★ Keep this in step with js/ — a module missing here is invisible until the
   first genuinely offline launch, because online it just fetches. */
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/main.js',
  './js/circuit.js',
  './js/earth.js',
  './js/gear.js',
  './js/globe.js',
  './js/layout3d.js',
  './js/loop.js',
  './js/panel.js',
  './js/scroll.js',
  './js/starfield.js',
  './data/atlas.js',
  './data/world.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

/* The stamped half is read out of index.html rather than written down, because
   the hashes change on every content edit and a hand-maintained list would be
   wrong the first time anyone touched a stylesheet. This keeps the worker
   build-free, which is convention 1. */
async function stampedShellUrls() {
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (!res.ok) return [];
    const html = await res.text();
    const out = new Set();
    const re = /(?:href|src)="([^"]+\?v=[0-9a-f]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (!/^(https?:|data:)/.test(m[1])) out.add('./' + m[1].replace(/^\.?\//, ''));
    }
    return [...out];
  } catch (e) {
    return [];                            // offline install: the fixed list still applies
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    const urls = SHELL_URLS.concat(await stampedShellUrls());
    // Individually, not addAll: that is all-or-nothing, and one 404 would leave
    // the app with no offline shell at all rather than an incomplete one.
    await Promise.all(urls.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) await c.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (e) {
    return (await c.match(req)) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin !== self.location.origin) return;

  // A cold offline launch has to boot, so a failed navigation falls back to the
  // cached shell. Deep links (#date/…, #circuit/…) are fragments and never
  // reach the network, so one cached index.html covers every route on the page.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (err) {
        const c = await caches.open(SHELL);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Content-hashed URL: immutable, so cache-first can never serve stale bytes.
  if (/[?&]v=[0-9a-f]+/.test(url.search)) {
    e.respondWith(cacheFirst(req, SHELL));
    return;
  }

  e.respondWith(networkFirst(req, SHELL));
});
