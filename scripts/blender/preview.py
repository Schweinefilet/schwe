"""Previews of a skyline render (scripts/blender/skyline.py's <prefix>-sky/-city/-depth.exr, and -win if
rendered): the lights recombined roughly as the site will, for day, dusk and night, over a plain sky of
that light, tone-mapped, with distance haze. A quick look while working; the site is the real check.

    blender -b --factory-startup -P scripts/blender/preview.py -- <render prefix> <out prefix> [--gain 1]
"""

import sys
import numpy as np
import OpenImageIO as oiio

args = sys.argv[sys.argv.index('--') + 1:]
src, prefix = args[0], args[1]
gain = float(args[args.index('--gain') + 1]) if '--gain' in args else 1.0


def read(path):
    inp = oiio.ImageInput.open(path)
    spec = inp.spec()
    px = inp.read_image(0, 0, 0, spec.nchannels, 'float').reshape(spec.height, spec.width, spec.nchannels)
    inp.close()
    return px


sky = read(src + '-sky.exr')
city = read(src + '-city.exr')
depth = read(src + '-depth.exr')
try:
    city = city + read(src + '-win.exr')  # the evening's windows, when rendered apart
except Exception:
    pass
alpha = sky[..., 3:4]
d = depth[..., 0:1] / np.maximum(depth[..., 3:4], 1e-4)


def tonemap(x):
    x = np.maximum(x, 0)
    x = x / (1 + x / 3)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, None), 1 / 2.4) - 0.055)


def save(img, name):
    out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    o = oiio.ImageOutput.create(name)
    o.open(name, oiio.ImageSpec(out.shape[1], out.shape[0], 3, 'uint8'))
    o.write_image(out)
    o.close()
    print('→', name)


h, w = alpha.shape[:2]
y = np.linspace(1, 0, h)[:, None, None]
for mode, sky_scale, city_scale, top, low in (
    ('day', 0.55, 0.0, (0.30, 0.42, 0.62), (0.72, 0.76, 0.8)),
    ('dusk', 0.05, 0.25, (0.03, 0.05, 0.14), (0.42, 0.24, 0.14)),
    ('night', 0.004, 0.25, (0.006, 0.006, 0.009), (0.035, 0.026, 0.02)),
):
    low = np.array(low)
    bg = (low + (np.array(top) - low) * y) * np.ones((h, w, 3))
    lit = sky[..., :3] * sky_scale * low / low.mean() + city[..., :3] * city_scale * gain
    haze = 1 - np.exp(-d / 6000.0)
    lit = lit * (1 - haze) + bg * alpha * haze
    save(tonemap(bg * (1 - alpha) + lit), f'{prefix}-{mode}.png')
