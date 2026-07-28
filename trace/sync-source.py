#!/usr/bin/env python3
"""
Field Atlas 2.0 — vendor the 1.x source into source/.

2.0 must not need Field Atlas 1.x on disk. This copies everything 2.0's data is
derived from into `source/`, so the 1.x folder can be deleted, moved or renamed
and `trace/extract.py` still regenerates the whole atlas.

    python3 trace/sync-source.py            # refresh source/ from 1.x
    python3 trace/sync-source.py --check     # report drift, copy nothing

What lands in source/:
    field-atlas-1x-src.dc.html   the master for venues, events, layouts, tracks
    geometry/*.json              the traced + fitted circuit geometry
    uploads/                     every SVG and reference image 1.x was built from
    fonts/                       the Saira faces 1.x self-hosts
    icons/                       the PWA icon set
    MANIFEST.json                what was copied, when, and its sha256

Nothing in the 1.x folder is written to, ever. This script only reads from it.
"""
import hashlib, json, os, shutil, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'source')
ONE_X = os.environ.get('FA1_DIR', '/Users/theodor/Documents/Field Atlas/Field Atlas')

CHECK = '--check' in sys.argv

FILES = [('Field Atlas (standalone-src).dc.html', 'field-atlas-1x-src.dc.html')]
TREES = [('trace', 'geometry', ('.json',)),
         ('uploads', 'uploads', None),
         ('fonts', 'fonts', None),
         ('icons', 'icons', None)]


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def copy(src, dst):
    if CHECK:
        if not os.path.exists(dst):
            return 'missing'
        return 'ok' if sha(src) == sha(dst) else 'DRIFT'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst) and sha(src) == sha(dst):
        return 'ok'
    shutil.copy2(src, dst)
    return 'copied'


def main():
    if not os.path.isdir(ONE_X):
        print(f'Field Atlas 1.x not found at:\n  {ONE_X}\n'
              f'Set FA1_DIR to point at it. source/ already holds a vendored copy,\n'
              f'so trace/extract.py still works without this step.')
        return 1

    manifest, tally = [], {}
    for src_name, dst_name in FILES:
        s = os.path.join(ONE_X, src_name)
        if not os.path.exists(s):
            print('  MISSING in 1.x:', src_name); tally['missing'] = tally.get('missing', 0) + 1; continue
        d = os.path.join(OUT, dst_name)
        r = copy(s, d); tally[r] = tally.get(r, 0) + 1
        manifest.append({'from': src_name, 'to': dst_name,
                         'bytes': os.path.getsize(s), 'sha256': sha(s)})

    for src_dir, dst_dir, exts in TREES:
        sdir = os.path.join(ONE_X, src_dir)
        if not os.path.isdir(sdir):
            print('  MISSING in 1.x:', src_dir + '/'); continue
        for name in sorted(os.listdir(sdir)):
            s = os.path.join(sdir, name)
            if not os.path.isfile(s) or name.startswith('.'):
                continue
            if exts and not name.lower().endswith(exts):
                continue
            d = os.path.join(OUT, dst_dir, name)
            r = copy(s, d); tally[r] = tally.get(r, 0) + 1
            manifest.append({'from': f'{src_dir}/{name}', 'to': f'{dst_dir}/{name}',
                             'bytes': os.path.getsize(s), 'sha256': sha(s)})

    total = sum(m['bytes'] for m in manifest)
    if not CHECK:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, 'MANIFEST.json'), 'w', encoding='utf-8') as f:
            json.dump({'vendoredFrom': ONE_X,
                       'vendoredAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                       'fileCount': len(manifest), 'totalBytes': total,
                       'files': manifest}, f, indent=1, ensure_ascii=False)

    print(('CHECK ' if CHECK else 'SYNC  ') +
          f'{len(manifest)} files, {total/1e6:.1f} MB  ' +
          '  '.join(f'{k}={v}' for k, v in sorted(tally.items())))
    if CHECK and (tally.get('DRIFT') or tally.get('missing')):
        print('  source/ is out of date — run without --check')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
