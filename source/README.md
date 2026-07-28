# source/ — vendored copy of Field Atlas 1.x

**This folder exists so Field Atlas 2.0 does not need Field Atlas 1.x on disk.**
Delete, move or rename the 1.x project and everything here still works:
`trace/extract.py` reads only from this folder, never from the 1.x path.

Nothing in here is edited by hand. It is a byte-for-byte copy, refreshed by:

```bash
python3 trace/sync-source.py          # pull the latest 1.x into source/
python3 trace/sync-source.py --check  # report drift, copy nothing
python3 trace/extract.py              # rebuild data/ from source/
```

`sync-source.py` only ever **reads** the 1.x folder. It cannot write to it.
Point it somewhere else with `FA1_DIR=/path/to/Field Atlas` if the project moves.

## Contents

| Path | What it is | Used by |
|---|---|---|
| `field-atlas-1x-src.dc.html` | The 1.x standalone source — the master for venues, events, competition tracks, hand-traced layouts and the scorit SVG paths | `extract.py` parses `buildVenues()`, `buildCompetitionTracks()`, `competitionLayouts()`, `venueLayouts()` |
| `geometry/*.json` (13) | Traced and satellite-fitted circuit geometry from the 1.x sessions — `comp-geo`, `new-osm`, `osm-geo`, `fit-new`, `fits`, `baked-geo`, `layouts-baked`, … | `extract.py` for lap length, corners, longest straight |
| `uploads/` (34) | Every source asset 1.x was built from: 23 track-layout SVGs (scorit + hand), reference screenshots, the Malmen spotters-day deck | Provenance. Re-trace a circuit from here if a layout needs redoing |
| `fonts/` (6) | The Saira SemiCondensed woff2 faces 1.x self-hosts | Not used yet — 2.0 loads from Google Fonts. Needed if 2.0 ever goes offline |
| `icons/` (5) | The PWA icon set: 192, 512, maskable-512, apple-touch, favicon | Needed when 2.0 becomes an installable app |
| `MANIFEST.json` | Every file copied, with size and sha256, plus when and from where | `sync-source.py --check` compares against it |

## Which files are the real masters

Season facts — dates, venue names, clubs, coordinates — are **mastered in 1.x**
(CONVENTIONS §9) and copied here. If a date is wrong on the 2.0 page, fix it in the
1.x source, re-run `sync-source.py`, then `extract.py`. Editing `data/atlas.js`
directly works until the next regen, then silently reverts.

If 1.x is ever retired for good, this folder becomes the master and
`field-atlas-1x-src.dc.html` is the file to edit.
