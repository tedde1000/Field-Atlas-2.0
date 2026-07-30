/* ===========================================================================
 * trace/serve.mjs — the dev server, with caching turned off. Node, no deps.
 *
 *     node trace/serve.mjs            # http://localhost:8766
 *     node trace/serve.mjs 8790       # somewhere else
 *
 * ★ WHY THIS EXISTS ALONGSIDE serve.py.
 *
 * `trace/serve.py` is the original and the two are interchangeable — same root,
 * same port, same headers. It is here because Python is not installed on every
 * machine this repo gets opened on, and a project whose whole selling point is
 * "no build step, just serve it" should not be un-runnable for want of an
 * interpreter it never actually needs. Node is already required by
 * trace/verify.mjs and trace/shots.mjs.
 *
 * Read the long note at the top of serve.py for why `no-store` is not
 * optional here: a half-reloaded page — new JS against old CSS — produced a
 * frozen, unstyled panel that looked exactly like a bug in code that was
 * already correct on disk.
 * ======================================================================== */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2]) || 8766;

/* Only the types this site actually serves. An unknown extension gets
   octet-stream rather than a guess: a mislabelled ES module is refused by the
   browser outright, which is a far more confusing failure than a download. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400, NO_CACHE); res.end('bad request'); return;
  }

  /* Resolve inside ROOT and check that it stayed there. `..` in a URL is the
     one thing a static server must not honour, and normalize() alone does not
     stop it — the containment test does. */
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403, NO_CACHE); res.end('forbidden'); return; }

  let st;
  try { st = statSync(file); } catch { st = null; }
  if (st?.isDirectory()) {
    file = join(file, 'index.html');
    try { st = statSync(file); } catch { st = null; }
  }
  if (!st?.isFile()) { res.writeHead(404, NO_CACHE); res.end('not found'); return; }

  res.writeHead(200, {
    ...NO_CACHE,
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Field Atlas 2.0 — http://localhost:${PORT}/  (no-store; ^C to stop)`);
});
