#!/usr/bin/env python3
"""
Field Atlas 2.0 — data extraction.

Reads the VENDORED 1.x source under source/ and emits two generated modules:

    data/atlas.js   venues, events, competition tracks, circuit geometry, metrics
    data/world.js   land outline rings for the globe (world-atlas land-50m)

Field Atlas 1.x is still the MASTER for venue/event facts (CONVENTIONS.md §9), but
this script reads the COPY in source/, never the 1.x folder itself — so 1.x can be
deleted or moved and 2.0 still regenerates. Refresh the copy with:

    python3 trace/sync-source.py     # pull the latest 1.x into source/
    python3 trace/extract.py         # rebuild data/

Never hand-edit data/atlas.js.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.dirname(HERE)
SRC_DIR = os.path.join(OUT, "source")
SRC = os.path.join(SRC_DIR, "field-atlas-1x-src.dc.html")
TRACE = os.path.join(SRC_DIR, "geometry")

# Coastline resolution for the globe. 110m is Natural Earth's coarsest and reads
# as visibly faceted once the disc is over about 900px — Norway and west Africa
# go polygonal. 50m is 60 635 points against 5 129, which the globe absorbs
# because js/globe.js projects from a precomputed unit-vector cache and culls
# rings that are over the horizon or under two pixels across. Set FA2_LAND=110m
# to go back if a low-powered device ever needs it.
LAND_RES = os.environ.get("FA2_LAND", "50m")
LAND = os.path.join(HERE, f"land-{LAND_RES}.json")

if not os.path.exists(SRC):
    sys.exit(f"source/ is empty — run `python3 trace/sync-source.py` first.\n  missing: {SRC}")

# ---------------------------------------------------------------- helpers
R_EARTH = 6371008.8

def hav(a, b):
    """great-circle metres between two [lon,lat] pairs"""
    lo1, la1 = math.radians(a[0]), math.radians(a[1])
    lo2, la2 = math.radians(b[0]), math.radians(b[1])
    dla, dlo = la2 - la1, lo2 - lo1
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1, math.sqrt(h)))

def path_len(pts, closed=True):
    L = sum(hav(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    if closed and len(pts) > 2 and pts[0] != pts[-1]:
        L += hav(pts[-1], pts[0])
    return L

def to_metres(pts):
    """lon/lat polyline -> local equirectangular metres, origin at the centroid"""
    lat0 = sum(p[1] for p in pts) / len(pts)
    k = math.cos(math.radians(lat0)) * math.pi * R_EARTH / 180
    m = math.pi * R_EARTH / 180
    return [[(p[0] - pts[0][0]) * k, (p[1] - pts[0][1]) * m] for p in pts]

def resample_m(pts, step):
    """even-spaced resample of a PLANAR metre polyline, so turn detection is scale-free"""
    out = [pts[0]]
    acc = 0.0
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        seg = math.dist(a, b)
        if seg <= 1e-9: continue
        pos = step - acc
        while pos <= seg:
            t = pos / seg
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            pos += step
        acc = (acc + seg) % step
    return out

def corner_count(pts_m, closed=True, step=8.0, thresh_deg=32.0, window=3):
    """
    Count distinct turns on a planar metre polyline: resample to a fixed step, sum the
    heading change over a short window, then take each run of same-signed change above
    the threshold as ONE corner. Sweepers count once, chicanes twice — roughly how a
    circuit map is numbered.
    """
    p = resample_m(pts_m, step)
    if closed and len(p) > 3: p = p + p[:window + 1]
    if len(p) < 2 * window + 2: return 0
    def head(i):
        a, b = p[i], p[i + 1]
        return math.atan2(b[1] - a[1], b[0] - a[0])
    turns = []
    for i in range(len(p) - 1 - window):
        d = math.degrees(head(i + window) - head(i))
        while d > 180: d -= 360
        while d < -180: d += 360
        turns.append(d)
    count, run, sign = 0, 0.0, 0
    for d in turns:
        s = 1 if d > 1.2 else (-1 if d < -1.2 else 0)
        if s != 0 and s == sign:
            run += d
        else:
            if abs(run) >= thresh_deg: count += 1
            run, sign = (d if s else 0.0), s
    if abs(run) >= thresh_deg: count += 1
    return count

def longest_straight(pts_m, closed=True, step=6.0, curve_deg=3.2):
    p = resample_m(pts_m, step)
    if closed and len(p) > 3: p = p + p[:2]
    best = run = 0.0
    for i in range(1, len(p) - 1):
        a, b, c = p[i - 1], p[i], p[i + 1]
        d = math.degrees(math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(b[1] - a[1], b[0] - a[0]))
        while d > 180: d -= 360
        while d < -180: d += 360
        if abs(d) < curve_deg:
            run += math.dist(a, b)
            best = max(best, run)
        else:
            run = 0.0
    return best

def bearing(a, b):
    """initial great-circle bearing a -> b, degrees from north"""
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dlo = math.radians(b[0] - a[0])
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def compass(deg):
    return ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][int((deg + 11.25) % 360 // 22.5)]

def norm_xy(pts):
    """lon/lat polyline -> 0..1000 x 0..640 viewBox path points, north-up, aspect kept"""
    lat0 = sum(p[1] for p in pts) / len(pts)
    k = math.cos(math.radians(lat0))
    xs = [p[0] * k for p in pts]
    ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    s = min(940 / w, 580 / h)
    ox, oy = (1000 - w * s) / 2, (640 - h * s) / 2
    return [[round(ox + (x - x0) * s, 1), round(640 - (oy + (y - y0) * s), 1)] for x, y in zip(xs, ys)]

def simplify(pts, tol):
    """Douglas–Peucker in projected units"""
    if len(pts) < 3: return pts
    def dist(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == 0 and dy == 0: return math.hypot(p[0] - a[0], p[1] - a[1])
        t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)))
        return math.hypot(p[0] - (a[0] + t*dx), p[1] - (a[1] + t*dy))
    def rec(s, e):
        idx, dmax = -1, tol
        for i in range(s + 1, e):
            d = dist(pts[i], pts[s], pts[e])
            if d > dmax: idx, dmax = i, d
        if idx < 0: return [pts[s]]
        return rec(s, idx) + rec(idx, e)
    return rec(0, len(pts) - 1) + [pts[-1]]

# ---------------------------------------------------------------- 1. source js literals
src = open(SRC, encoding="utf-8").read()

def grab_block(fn_name):
    # match the METHOD DEFINITION (line-start), not the earlier `this.foo()` call sites
    m = re.search(r"^\s*" + re.escape(fn_name) + r"\s*\{", src, re.M)
    i = m.start()
    j = src.index("{", i)
    depth, k = 0, j
    while True:
        if src[k] == "{": depth += 1
        elif src[k] == "}": depth -= 1
        if depth == 0: break
        k += 1
    return src[j:k + 1]

# venueLayouts() is one big JSON return — the hand-traced 1000x640 geometry
layouts = json.loads(re.search(r"return (\{.*\});", grab_block("venueLayouts()"), re.S).group(1))

# competition tracks: parse the object-literal rows
comp = []
for m in re.finditer(
    r'\{\s*id:"(\w+)",\s*name:"([^"]+)",\s*ort:"([^"]+)",\s*lat:([\d.]+),\s*lng:([\d.]+)',
    grab_block("buildCompetitionTracks()")):
    comp.append(dict(id=m.group(1), name=m.group(2), ort=m.group(3),
                     lat=float(m.group(4)), lon=float(m.group(5))))

# scorit track-layout SVGs for the competition tracks
comp_layouts = {}
for m in re.finditer(r"(\w+):\s*\{\s*vb:'([^']*)',\s*t:'([^']*)',\s*d:'([^']*)'\s*\}",
                     grab_block("competitionLayouts()")):
    comp_layouts[m.group(1)] = dict(vb=m.group(2), t=m.group(3), d=m.group(4))

# ---------------------------------------------------------------- venue track artwork
# ★ THE MOST ACCURATE GEOMETRY WE HOLD FOR A VENUE IS THE DRAWING, NOT THE TRACE.
#
# Theodor: "all the circuits are not as accurate … look on how it looks on the
# first version of the Field Atlas and make all the tracks accurate, because it
# is on the first version. Also in the Field Atlas folder you should be able to
# find the SVG files."
#
# He is right, and they are: source/uploads carries the hand-drawn layout for
# every circuit venue, as real cubic Béziers on a 500x300 artboard. That is the
# artwork the circuits were actually drawn as — curvature and all — while
# `track.path` is a 29-to-72-point sampled centreline and `layout` is a hand
# trace. Ranked by fidelity the drawing wins every time, so it is preferred
# wherever one exists, exactly as the competition tracks already prefer their
# scorit layouts.
#
# The filenames are what the exports were called and do not match the venue ids,
# so the mapping is spelled out rather than guessed at. Gelleråsen exports two
# paths — the full circuit and the kart loop inside it — and the longer one is
# the circuit the dates are actually for.
VENUE_ART = {
    "rasbo":      "rörken ring.svg",
    "gellerasen": "Gelleråsen.svg",
    "halla":      "Hälla Ring.svg",
    "jarfalla":   "järfälla.svg",
    "enkoping":   "Ena Karting Ring.svg",     # <title>Enköping</title> inside
    "linkoping":  "Linköping MS.svg",
}

def venue_art(vid):
    """the drawn layout for a venue id, as {vb, d}, or None"""
    fn = VENUE_ART.get(vid)
    if not fn:
        return None
    p = os.path.join(SRC_DIR, "uploads", fn)
    if not os.path.exists(p):
        print(f"  note: no artwork for {vid} at uploads/{fn}")
        return None
    svg = open(p, encoding="utf-8").read()
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    if not paths:
        return None
    d = max(paths, key=len)                     # the circuit, not the kart loop

    # ★ Frame from the PATH, never from the viewBox. Hälla's artwork starts at
    # y = -36.5, well outside its own 0 0 500 300 box, so trusting the declared
    # viewBox would crop the top of the circuit off. The bbox below is computed
    # from every coordinate in the path — including Bézier control points, which
    # bound the curve conservatively (a cubic never leaves its control hull).
    nums = [float(x) for x in re.findall(r"-?\d+\.?\d*(?:e-?\d+)?", d)]
    xs, ys = nums[0::2], nums[1::2]
    if not xs or not ys:
        return None
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = max(1e-6, x1 - x0), max(1e-6, y1 - y0)
    pad = max(w, h) * 0.06
    vb = "%.1f %.1f %.1f %.1f" % (x0 - pad, y0 - pad, w + pad * 2, h + pad * 2)
    return dict(vb=vb, d=d, sw=round(max(w, h) / 150, 2))

# venues + events
vblock = grab_block("buildVenues()")

# The shared day-plans, declared at the top of buildVenues() as KART_SCHED /
# CUP_SCHED / AIR_SCHED, each a list of { time, title, note, gold? } rows.
#
# ★ Read the ASSIGNMENT, do not infer one from the event type. Only KART_SCHED is
# actually referenced in 1.x: Kanonloppet (cup), Malmen (airshow) and Rörken's
# September date all carry `schedule: []`, and 1.x renders an explicit "no plan
# yet" state for them rather than falling back. CUP_SCHED and AIR_SCHED are
# written but unused. Inventing a fallback here would put a day plan on the page
# that does not exist in the app that masters it.
SCHEDULES = {}
for sm in re.finditer(r"const (\w+_SCHED) = \[(.*?)\n    \];", vblock, re.S):
    rows = []
    for rm in re.finditer(
        r"\{ time: '([^']+)', title: '([^']+)', note: '([^']*)'(, gold: true)? \}", sm.group(2)):
        row = dict(time=rm.group(1), title=rm.group(2), note=rm.group(3))
        if rm.group(4):
            row["gold"] = True
        rows.append(row)
    SCHEDULES[sm.group(1)] = rows
assert SCHEDULES.get("KART_SCHED") and len(SCHEDULES["KART_SCHED"]) == 6, SCHEDULES.keys()

venues = []
# ★ The events array must be closed by a LOOKAHEAD to the next venue, not by the
# first `] },` — an event carrying `schedule: []` contains that sequence inline,
# which truncated the capture and silently dropped Rörken's second date (7 events
# instead of 8). The assert below is what caught it; keep it.
for vm in re.finditer(
    r"\{ id: '(\w+)', name: '([^']+)',(?: club: '([^']+)',)? city: '([^']+)', short: '([^']+)', "
    r"lat: ([\d.]+), lon: ([\d.]+), accent: '(#\w+)',\s*events: \[(.*?)\]\s*\},\s*(?=\{ id: '|\];)",
    vblock, re.S):
    evs = []
    for em in re.finditer(
        r"\{ name: '([^']+)', type: '(\w+)', dateMs: Date\.parse\('([^']+)'\)"
        r"(?:, days: (\d+))?, dateLabel: '([^']+)', fullDateLabel: '([^']+)'"
        r", schedule: (\w+|\[\])", vm.group(9)):
        sched = SCHEDULES.get(em.group(7), []) if em.group(7) != "[]" else []
        evs.append(dict(name=em.group(1), type=em.group(2), iso=em.group(3),
                        days=int(em.group(4) or 1),
                        dateLabel=em.group(5), fullDateLabel=em.group(6),
                        schedule=sched))
    venues.append(dict(id=vm.group(1), name=vm.group(2), club=vm.group(3), city=vm.group(4),
                       short=vm.group(5), lat=float(vm.group(6)), lon=float(vm.group(7)),
                       accent=vm.group(8), events=evs))
assert len(venues) == 7 and sum(len(v["events"]) for v in venues) == 8, (len(venues), venues)
assert len(comp) == 16, len(comp)

# ---------------------------------------------------------------- 2. geometry per venue
def tj(name): return json.load(open(os.path.join(TRACE, name), encoding="utf-8"))

comp_geo  = tj("comp-geo.json")
new_osm   = tj("new-osm.json")
osm_geo   = tj("osm-geo.json")
fit_new   = tj("fit-new.json")
fits      = tj("fits.json")

def longest_way(ways):
    return max(ways, key=lambda w: path_len(w, closed=False))

# lon/lat racing line per venue id — best available source, noted per entry
GEO = {}
GEO["halla"]     = ("OSM way (trace/new-osm.json)",  longest_way(new_osm["halla"]))
GEO["jarfalla"]  = ("OSM way (trace/new-osm.json)",  new_osm["jarfalla"][0])
GEO["enkoping"]  = ("fitted kart loop (trace/fit-new.json)", fit_new["enkopingKart"]["lnglat"])
GEO["rasbo"]     = ("OSM raceway (trace/osm-geo.json)", osm_geo["rasbo"]["raceway"][0]["coordinates"])
GEO["gellerasen"]= ("fitted main circuit (trace/fit-new.json)", fit_new["gellMain"]["lnglat"])
for t in comp:
    if t["id"] in comp_geo:
        GEO[t["id"]] = ("OSM circuit (trace/comp-geo.json)", comp_geo[t["id"]]["lines"]["track"])

# measured lap lengths recorded by the 1.x geometry sessions — these beat re-derivation
MEASURED = {"halla": fit_new["halla"]["lapM"], "jarfalla": fit_new["jarfalla"]["lapM"],
            "enkoping": fit_new["enkopingKart"]["lapM"], "gellerasen": fit_new["gellMain"]["lapM"],
            "rasbo": fits["rasbo"]["loopLen"]}

# Malmen is an airfield, not a circuit: its "geometry" is the two runways. The OSM
# extract carries four ways — two runways plus stubs that measure under a hundred
# metres, so drop anything too short to land on and keep the longest first.
malmen_rw = sorted((w["coordinates"] for w in osm_geo["malmen"]["runway"]),
                   key=lambda w: path_len(w, closed=False), reverse=True)
malmen_rw = [w for w in malmen_rw if path_len(w, closed=False) > 300]
malmen_len = path_len(malmen_rw[0], closed=False)

# Linköpings Motorstadion has a hand-traced layout but no geo fit in 1.x. Scale it with the
# median px-per-metre of the five venues that have BOTH, and flag it as estimated.
def traced_pts(vid):
    for L in layouts.get(vid, {}).get("layers", []):
        if L.get("k") == "track": return [[p[0], p[1]] for p in L["pts"]]
    return None
def px_perim(pts):
    P = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    return P + math.dist(pts[-1], pts[0])
scales = [px_perim(traced_pts(v)) / MEASURED[v] for v in ("halla", "jarfalla", "enkoping") if traced_pts(v)]
scales.sort(); px_per_m = scales[len(scales) // 2]
link_len = px_perim(traced_pts("linkoping")) / px_per_m

# ---------------------------------------------------------------- 3. build records
HOME = {"id": "home", "name": "Uppsala", "lat": 59.8586, "lon": 17.6389}  # base of operations

def metrics(vid, closed=True):
    """length / corners / longest straight / traced viewBox path, from the best geo we hold"""
    if vid not in GEO: return None
    note, pts = GEO[vid]
    pts = [[p[0], p[1]] for p in pts]
    m = to_metres(pts)
    length = MEASURED.get(vid) or path_len(pts, closed)
    return dict(
        lengthM=round(length),
        corners=corner_count(m, closed),
        straightM=round(longest_straight(m, closed)),
        source=note,
        path=norm_xy(simplify(pts, 1.2e-5)),
    )

def dist_home(lat, lon):
    return hav([HOME["lon"], HOME["lat"]], [lon, lat])

out_venues = []
for v in venues:
    m = metrics(v["id"])
    if v["id"] == "linkoping":
        # px -> metres with the median scale, then the same planar turn detector
        lm = [[p[0] / px_per_m, -p[1] / px_per_m] for p in traced_pts("linkoping")]
        m = dict(lengthM=round(link_len / 5) * 5, corners=corner_count(lm, True),
                 straightM=round(longest_straight(lm, True) / 5) * 5,
                 source="scaled from the hand-traced layout — estimate, not a geo fit",
                 path=[[p[0], p[1]] for p in traced_pts("linkoping")], estimated=True)
    if v["id"] == "malmen":
        m = dict(lengthM=round(malmen_len), corners=0, straightM=round(malmen_len),
                 source="OSM runways (trace/osm-geo.json)", path=None, runway=True,
                 runways=[round(path_len(w, closed=False)) for w in malmen_rw])
    d = dist_home(v["lat"], v["lon"])
    out_venues.append(dict(
        id=v["id"], name=v["name"], club=v["club"], city=v["city"], short=v["short"],
        lat=v["lat"], lon=v["lon"], accent=v["accent"],
        coordLabel="%.4f° N · %.4f° E" % (v["lat"], v["lon"]),
        distanceKm=round(d / 1000, 1),
        bearing=round(bearing([HOME["lon"], HOME["lat"]], [v["lon"], v["lat"]])),
        compass=compass(bearing([HOME["lon"], HOME["lat"]], [v["lon"], v["lat"]])),
        track=m,
        layout=layouts.get(v["id"]),
        svg=venue_art(v["id"]),        # the drawn layout — preferred over the trace
        events=v["events"],
    ))

out_comp = []
for t in comp:
    m = metrics(t["id"])
    d = dist_home(t["lat"], t["lon"])
    out_comp.append(dict(
        id=t["id"], name=t["name"], city=t["ort"], lat=t["lat"], lon=t["lon"],
        coordLabel="%.4f° N · %.4f° E" % (t["lat"], t["lon"]),
        distanceKm=round(d / 1000, 1),
        bearing=round(bearing([HOME["lon"], HOME["lat"]], [t["lon"], t["lat"]])),
        compass=compass(bearing([HOME["lon"], HOME["lat"]], [t["lon"], t["lat"]])),
        track=m, svg=comp_layouts.get(t["id"]),
    ))

# ---------------------------------------------------------------- 4. world land rings
topo = json.load(open(LAND, encoding="utf-8"))
tr, sc = topo["transform"]["translate"], topo["transform"]["scale"]
def decode(arc):
    x = y = 0; out = []
    for dx, dy in arc:
        x += dx; y += dy
        out.append([round(x * sc[0] + tr[0], 3), round(y * sc[1] + tr[1], 3)])
    return out
arcs = [decode(a) for a in topo["arcs"]]
def ring(idxs):
    pts = []
    for i in idxs:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        pts += a if not pts else a[1:]
    return pts
rings = []
for geom in topo["objects"]["land"]["geometries"]:
    polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
    for poly in polys:
        for r in poly:
            pr = ring(r)
            if len(pr) >= 4: rings.append(pr)

# ★ Simplify before emitting. Raw 50m is 60 625 points and the globe cannot
# project that per frame — measured, it drops the whole page to 3 fps, worse
# than the 110m version it replaced. But the density is far beyond what the
# disc can resolve: at 2560x1440 the globe is 1267px across, which is 7.04px
# per degree, so a 0.05° tolerance is a 0.35px maximum deviation — sub-pixel at
# the largest size we render, and half that at 1440. So the simplified outline
# is visually identical to full 50m while costing a third as many points, and
# still nearly four times the detail of 110m.
LAND_TOL = float(os.environ.get("FA2_LAND_TOL", "0.05"))

def simplify_ring(pts, tol):
    """Douglas-Peucker, ITERATIVE. The recursive simplify() above is fine for a
    track trace but blows Python's stack on a 4 000-point coastline."""
    n = len(pts)
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = pts[s]; bx, by = pts[e]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        dmax, idx = tol, -1
        for i in range(s + 1, e):
            px, py = pts[i]
            if dd == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / dd))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > dmax:
                dmax, idx = d, i
        if idx >= 0:
            keep[idx] = True
            stack.append((s, idx)); stack.append((idx, e))
    return [p for p, k in zip(pts, keep) if k]

if LAND_TOL > 0:
    rings = [simplify_ring(r, LAND_TOL) for r in rings]   # decode() already rounded to 3dp

rings.sort(key=len, reverse=True)
rings = [r for r in rings if len(r) >= 5]

# ---------------------------------------------------------------- 5. emit
def js(obj, indent=None):
    return json.dumps(obj, ensure_ascii=False, indent=indent).replace("</script", "<\\/script")

hdr = ("// GENERATED by trace/extract.py — do not hand-edit.\n"
       "// Master data lives in Field Atlas 1.x (Field Atlas (standalone-src).dc.html\n"
       "// + trace/*.json). Re-run the script after any season change over there.\n")

with open(os.path.join(OUT, "data", "atlas.js"), "w", encoding="utf-8") as f:
    f.write(hdr)
    f.write("export const HOME = %s;\n\n" % js(HOME))
    f.write("export const VENUES = %s;\n\n" % js(out_venues, 1))
    f.write("export const TRACKS = %s;\n" % js(out_comp, 1))

with open(os.path.join(OUT, "data", "world.js"), "w", encoding="utf-8") as f:
    f.write(hdr + "// Land outlines: world-atlas land-%s (Natural Earth, public domain).\n" % LAND_RES)
    f.write("export const LAND = %s;\n" % js(rings))

# ---------------------------------------------------------------- 6. report
print("venues %d  events %d  tracks %d  land %s: %d rings / %d points" %
      (len(out_venues), sum(len(v["events"]) for v in out_venues), len(out_comp),
       LAND_RES, len(rings), sum(len(r) for r in rings)))
print("px/m median %.4f -> linkoping %.0f m (estimated)" % (px_per_m, link_len))
for v in out_venues:
    t = v["track"] or {}
    print("  %-11s %5s m  %2s corners  %5s m straight  %6.1f km %s" % (
        v["id"], t.get("lengthM", "-"), t.get("corners", "-"), t.get("straightM") or "-",
        v["distanceKm"], v["compass"]))
for t in out_comp:
    m = t["track"] or {}
    print("  %-11s %5s m  %2s corners  %6.1f km %s" % (
        t["id"], m.get("lengthM", "-"), m.get("corners", "-"), t["distanceKm"], t["compass"]))
