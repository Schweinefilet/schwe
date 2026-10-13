"""What a city's ground is made of, as maps over its terrain (Paris; scripts/blender/ground.py shades them):
from the scene's OpenStreetMap ground (extract.mjs `ground`: lawns, parks, squares, paths and roads), each
kind painted in order, the later over the earlier, lines at their widths:

  data/skyline/<city>/ground-near.png   RGBA over the near ground at NEAR_RES metres a pixel
  data/skyline/<city>/ground-far.png    RGBA over the fine terrain grid at FAR_RES metres
  data/skyline/<city>/ground.json       where each lies (x0, y0, size in metres)

Channels: R grass (lawns; a park's or garden's unmapped ground half), G loose (gravel and sand: Paris's
parks are paved in stabilised sand, its paths a pinkish beige), B paving (stone and concrete slabs, squares,
pavements), A asphalt (roads, parking). What none of them covers is the city's bare ground: earth under
trees and shrubs.

    python3 scripts/skyline/ground.py --city paris
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NEAR_R, NEAR_RES = 820.0, 0.3
FAR_RES = 1.0
# Paint order (later over earlier) and each kind's channel values (grass, loose, paving, asphalt).
KINDS = {
    'park': (0.55, 0.25, 0.0, 0.0),
    'garden': (0.75, 0.15, 0.0, 0.0),
    'shrub': (0.15, 0.0, 0.0, 0.0),
    'earth': (0.0, 0.15, 0.0, 0.0),
    'grass': (1.0, 0.0, 0.0, 0.0),
    'sand': (0.0, 1.0, 0.0, 0.0),
    'asphalt': (0.0, 0.0, 0.0, 1.0),
    'paving': (0.0, 0.0, 1.0, 0.0),
    'gravel': (0.0, 1.0, 0.0, 0.0),
    'ballast': (0.0, 0.5, 0.3, 0.0),
}
AREA_ORDER = ['park', 'garden', 'shrub', 'earth', 'grass', 'sand', 'asphalt', 'paving', 'gravel']
# The city's bare default: its streets' pavements and courtyards (under the buildings it does not show).
DEFAULT = (0.0, 0.0, 0.55, 0.45)


def paint(box, res, ground):
    x0, y0, size = box
    n = int(round(size / res))
    img = Image.new('RGBA', (n, n), tuple(int(c * 255) for c in DEFAULT))
    draw = ImageDraw.Draw(img)
    to_px = lambda p: ((p[0] - x0) / res, (y0 + size - p[1]) / res)  # noqa: E731  (rows from the north)
    col = lambda k: tuple(int(round(c * 255)) for c in KINDS[k])  # noqa: E731
    for kind in AREA_ORDER:
        for a in ground['areas']:
            if a['kind'] != kind:
                continue
            for r in a['outer']:
                if len(r) >= 3:
                    draw.polygon([to_px(p) for p in r], fill=col(kind))
            for r in a['inner']:
                if len(r) >= 3:
                    draw.polygon([to_px(p) for p in r], fill=tuple(int(c * 255) for c in DEFAULT))
    # Roads with their pavements (3 m a side), then the roads, then paths and rails over them.
    lines = ground['lines']
    for ln in lines:
        if ln.get('road'):
            draw.line([to_px(p) for p in ln['pts']], fill=col('paving'), width=max(1, int(round((ln['width'] + 6.0) / res))), joint='curve')
    for ln in lines:
        if ln.get('road'):
            draw.line([to_px(p) for p in ln['pts']], fill=col(ln['kind']), width=max(1, int(round(ln['width'] / res))), joint='curve')
    for ln in lines:
        if not ln.get('road'):
            w = max(1, int(round(ln['width'] / res)))
            draw.line([to_px(p) for p in ln['pts']], fill=col(ln['kind']), width=w, joint='curve')
            # Round ends, so paths meet cleanly.
            for p in (ln['pts'][0], ln['pts'][-1]):
                x, y = to_px(p)
                draw.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col(ln['kind']))
    return img


def main():
    args = sys.argv[1:]
    city = args[args.index('--city') + 1] if '--city' in args else 'paris'
    d = os.path.join(ROOT, 'data', 'skyline', city)
    scene = json.load(open(os.path.join(d, 'scene.json')))
    ground = scene.get('ground')
    if not ground:
        print(f'{city}: no ground')
        return
    fine = next(g for g in scene['terrain']['grids'] if g['name'] == 'fine')
    fx0, fy0 = fine['x0'], fine['y0']
    fsize = max(fine['w'], fine['h']) * fine['res']
    # The near box: the view's wedge to NEAR_R, squared.
    b = scene['vantage']['bearing']
    span = scene['vantage'].get('span', [-60, 60])
    pts = [(0.0, 0.0)] + [(NEAR_R * math.sin(math.radians(b + a)), NEAR_R * math.cos(math.radians(b + a))) for a in range(span[0] - 5, span[1] + 6)]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    nsize = max(max(xs) - min(xs), max(ys) - min(ys)) + 40
    nx0, ny0 = (max(xs) + min(xs)) / 2 - nsize / 2, (max(ys) + min(ys)) / 2 - nsize / 2
    meta = {}
    for name, box, res in (('near', (nx0, ny0, nsize), NEAR_RES), ('far', (fx0, fy0, fsize), FAR_RES)):
        img = paint(box, res, ground)
        path = os.path.join(d, f'ground-{name}.png')
        img.save(path)
        meta[name] = {'file': f'ground-{name}.png', 'x0': box[0], 'y0': box[1], 'size': box[2], 'px': img.size[0]}
        print(f'{city}: {path} {img.size[0]}x{img.size[1]} at {res} m')
    json.dump(meta, open(os.path.join(d, 'ground.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
