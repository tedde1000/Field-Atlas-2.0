#!/usr/bin/env python3
"""
trace/serve.py — the dev server, with caching turned off.

    python3 trace/serve.py            # http://localhost:8766
    python3 trace/serve.py 8790       # somewhere else

★ WHY THIS EXISTS INSTEAD OF `python3 -m http.server`.

Theodor, on a build where the panel CSS had already been written and shipped:
"when I press the arrow, nothing happens — everything just froze."

Nothing was broken. His browser was still running the PREVIOUS assets/app.css.
`http.server` sends `Last-Modified` and no `Cache-Control`, and a response with
no explicit freshness is one the browser is allowed to age itself — the
heuristic is a fraction of how long ago the file was modified, so a stylesheet
edited an hour ago can be treated as fresh for minutes without ever asking.

That produced the worst possible half-state, and it is worth understanding
because it is not obvious: index.html and the JS reloaded, the panel CSS did
not. So `openFrom()` ran, the route resolved, `is-locked` went on <html> and
<body> — and the page stopped scrolling, while the panel it had opened was
still an unstyled block sitting at the bottom of the document. A frozen page
with nothing visibly different on it. Exactly what he described, from a fix
that was already correct on disk.

`no-store` on every response makes that class of ghost impossible: what is on
disk is what runs, always, with no reasoning about revalidation. It costs
nothing locally — the files are on the same machine.

For production, `trace/bundle.py` stamps the asset URLs in the .dc.html files
with a content hash, which is the same guarantee by a different route.
"""
import functools, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766


class NoCacheHandler(SimpleHTTPRequestHandler):
    # HTTP/1.1 so keep-alive works; the suite opens a lot of pages at once
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # one line per request is noise when a headless suite is hammering it;
        # errors still surface through the normal exception path
        pass


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with ThreadingHTTPServer(("", PORT), handler) as httpd:
        print(f"Field Atlas 2.0 — http://localhost:{PORT}/  (no-store; ^C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
