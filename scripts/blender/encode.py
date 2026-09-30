"""Packs a panorama's renders (scripts/blender/skyline.py) for the site: three 8-bit PNGs per variant,
decoded by the GPU (sRGB, so mip levels average light correctly):

  <variant>-light.png    RGB the sky-lit render (overcast dome of unit horizon radiance), / scale,
                         A coverage (film alpha)
  <variant>-night.png    RGB the city's fixed lights, / scale; A log distance (m) between the meta's
                         near and far, times coverage
  <variant>-windows.png  RGB the evening's lit windows, / scale; A the share of that light still on late,
                         times coverage

and the city's meta (public/skyline/<city>.json), which lists the variants and when each shows. Every
RGB is premultiplied by coverage, as rendered, so it averages as light does.

    blender -b --factory-startup -P scripts/blender/encode.py -- --city london --render data/skyline/london/pano-leaf \
        --variant leaf [--months 4,5,6,7,8,9,10,11]
"""

import json
import math
import os
import sys

import numpy as np
import OpenImageIO as oiio

ARGS = sys.argv[sys.argv.index('--') + 1:]


def arg(name, default=None):
    return ARGS[ARGS.index('--' + name) + 1] if '--' + name in ARGS else default


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CITY = arg('city')
SRC = arg('render')
VARIANT = arg('variant', 'leaf')
MONTHS = [int(m) for m in arg('months', '1,2,3,4,5,6,7,8,9,10,11,12').split(',')]
NEAR, FAR = 20.0, 12000.0  # metres, the log-encoded distance range


def read(name):
    inp = oiio.ImageInput.open(f'{SRC}-{name}.exr')
    if inp is None:
        raise SystemExit(f'no {SRC}-{name}.exr: {oiio.geterror()}')
    spec = inp.spec()
    px = inp.read_image(0, 0, 0, spec.nchannels, 'float').reshape(spec.height, spec.width, spec.nchannels)
    inp.close()
    return px


def srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def scale_for(rgb, cover):
    """A power of two over nearly all of the covered pixels' values: the brightest few (a lamp's bulb,
    an LED's core) clip, the rest keep 8-bit precision."""
    v = rgb[cover > 0.01].max(axis=-1) if np.any(cover > 0.01) else np.zeros(1)
    top = float(np.percentile(v, 99.95)) if v.size else 1.0
    return float(2 ** max(0, math.ceil(math.log2(max(top, 1e-6)))))


def write(path, rgb, a):
    out = np.concatenate([srgb(rgb), np.clip(a, 0, 1)[..., None]], axis=-1)
    out = (out * 255 + 0.5).astype(np.uint8)
    o = oiio.ImageOutput.create(path)
    spec = oiio.ImageSpec(out.shape[1], out.shape[0], 4, 'uint8')
    # Write the numbers as they are. PNG's alpha is "unassociated", so OIIO would otherwise divide RGB by
    # alpha on the way out; these alphas are coverage or data (distance, the late share), and RGB is
    # meant premultiplied by coverage.
    spec.attribute('oiio:UnassociatedAlpha', 1)
    o.open(path, spec)
    o.write_image(out)
    o.close()
    print('→', path, f'{os.path.getsize(path) / 1e6:.1f} MB')


sky, city, win, late, depth = (read(n) for n in ('sky', 'city', 'win', 'late', 'depth'))
cover = sky[..., 3]
# Distance: the depth render's premultiplied distance over its coverage, log between NEAR and FAR.
d = depth[..., 0] / np.maximum(depth[..., 3], 1e-4)
logd = np.clip(np.log(np.maximum(d, NEAR) / NEAR) / math.log(FAR / NEAR), 0, 1)
logd = np.where(cover > 1e-3, logd, 1.0)
lum = lambda x: 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
late_share = np.where(lum(win[..., :3]) > 1e-4, np.clip(lum(late[..., :3]) / np.maximum(lum(win[..., :3]), 1e-4), 0, 1), 0.0)

out_dir = os.path.join(ROOT, 'public', 'skyline', CITY)
os.makedirs(out_dir, exist_ok=True)
scales = {}
# Alphas premultiplied by coverage too, so the mip levels average them over the covered part only.
for name, rgb, a in (('light', sky[..., :3], cover), ('night', city[..., :3], logd * cover), ('windows', win[..., :3], late_share * cover)):
    scales[name] = scale_for(rgb, cover)
    write(os.path.join(out_dir, f'{VARIANT}-{name}.png'), rgb / scales[name], a)

# The meta: the panorama's place in the sky (as skyline.py rendered it) and the variants.
scene = json.load(open(os.path.join(ROOT, 'data', 'skyline', CITY, 'scene.json')))
meta_path = os.path.join(ROOT, 'public', 'skyline', f'{CITY}.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
if meta.get('version') != 2:
    meta = {}
h, w = cover.shape
geometry = json.load(open(SRC + '.json'))  # written by skyline.py beside its renders
span = geometry['span']
el = geometry['elevation']
meta.update({
    'version': 2,
    'city': CITY,
    'from': scene['vantage']['name'],
    'bearing': scene['vantage']['bearing'],
    'azimuth': [round((scene['vantage']['bearing'] - span / 2) % 360, 3), span],  # where it starts (clockwise from north), width
    'elevation': el,  # degrees, bottom and top rows
    'distance': [NEAR, FAR],
    'size': [w, h],
    'source': '© OpenStreetMap contributors (ODbL); rendered in Blender (Cycles) with hand-modelled landmarks',
})
meta.setdefault('variants', {})[VARIANT] = {'months': MONTHS, 'scale': scales}
json.dump(meta, open(meta_path, 'w'), indent=2)
print('→', meta_path, scales)
