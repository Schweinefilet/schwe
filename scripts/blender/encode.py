"""Packs a panorama's renders (scripts/blender/skyline.py) for the site: three 8-bit PNGs per variant,
decoded by the GPU (sRGB, so mip levels average light correctly):

  <variant>-light.png    RGB the sky-lit render (overcast dome of unit horizon radiance), / scale,
                         A coverage (film alpha)
  <variant>-night.png    RGB the city's fixed lights, / scale; A log distance (m) between the meta's
                         near and far, times coverage
  <variant>-windows.png  RGB the evening's lit windows, / scale; A the share of that light still on late,
                         times coverage

and, where the city has water, the same three for the river's reflection (skyline.py's mirror render,
from the eye's mirror image below the water plane, elevations 0 up):

  <variant>-mirror-light.png, -mirror-night.png, -mirror-windows.png

and the glow of the city's lights after dark (a camera's bloom and the air's halo round each light), from
the renders' true, unclipped values, the river's streaks included as they average over the waves:

  <variant>-glow.png     RGB the tight part (half resolution), / scale; A the windows' share of it
  <variant>-halo.png     RGB the wide part (quarter resolution), / scale; A the windows' share of it

both over the panorama's azimuths and from its bottom to GLOW_TOP degrees above its top (a halo reaches
past the tallest light), and the city's meta (public/skyline/<city>.json), which lists the variants and when each shows. Every
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
HAZE_PER_KM = 0.12  # SKY.skyline.hazePerKm (config.js): the clear air's haze the lights shine through
# The glow's point spread: Gaussians (sigma in degrees) with their shares of it, after Unreal Engine's
# default Gaussian-sum bloom (sizes 0.3, 1, 2 and 10+ % of the view, tints 0.3465, 0.138, 0.1176 and
# 0.066 + 0.066 + 0.061), its sizes taken against the dive's 55 degree view. Tight and wide are stored
# apart: the wide part is also the air's halo, which grows in rain and fog (the site weighs them).
GLOW_TIGHT = ((0.12, 0.715), (0.4, 0.285))
GLOW_WIDE = ((1.2, 0.38), (4.0, 0.62))
GLOW_TOP = 10.0  # degrees of sky above the panorama the glow is kept for
# The river's streaks, for their glow: the mirror blurred up and down as waves of this slope spread it
# (sigma of the along-view slope at 4 m/s with SKY.water.slopeScale 0.15: about 0.042; the reflected ray
# tilts twice the slope).
STREAK_SIGMA = math.degrees(2 * 0.042)


def read(name, prefix=SRC):
    inp = oiio.ImageInput.open(f'{prefix}-{name}.exr')
    if inp is None:
        raise SystemExit(f'no {prefix}-{name}.exr: {oiio.geterror()}')
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


lum = lambda x: 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
out_dir = os.path.join(ROOT, 'public', 'skyline', CITY)
os.makedirs(out_dir, exist_ok=True)


def encode_set(prefix, tag):
    """One panorama's renders → its three PNGs (<variant><tag>-light, -night, -windows); returns their
    scales, the coverage, and the lights and windows as the clear air leaves them (for the glow)."""
    sky, city, win, late, depth = (read(n, prefix) for n in ('sky', 'city', 'win', 'late', 'depth'))
    cover = sky[..., 3]
    # Distance: the depth render's premultiplied distance over its coverage, log between NEAR and FAR.
    d = depth[..., 0] / np.maximum(depth[..., 3], 1e-4)
    logd = np.clip(np.log(np.maximum(d, NEAR) / NEAR) / math.log(FAR / NEAR), 0, 1)
    logd = np.where(cover > 1e-3, logd, 1.0)
    late_share = np.where(lum(win[..., :3]) > 1e-4, np.clip(lum(late[..., :3]) / np.maximum(lum(win[..., :3]), 1e-4), 0, 1), 0.0)
    scales = {}
    # Alphas premultiplied by coverage too, so the mip levels average them over the covered part only.
    for name, rgb, a in (('light', sky[..., :3], cover), ('night', city[..., :3], logd * cover), ('windows', win[..., :3], late_share * cover)):
        scales[name] = scale_for(rgb, cover)
        write(os.path.join(out_dir, f'{VARIANT}{tag}-{name}.png'), rgb / scales[name], a)
    clear = np.exp(-np.where(cover > 1e-3, d, 0.0) / 1000.0 * HAZE_PER_KM)[..., None]
    return scales, cover, city[..., :3] * clear, win[..., :3] * clear, late[..., :3] * clear


def blur(img, sigma, axis):
    """Gaussian blur along one axis (sigma in pixels) by FFT, zero beyond the edges."""
    if sigma < 0.3:
        return img
    n = img.shape[axis]
    pad = int(4 * sigma) + 1
    size = 1 << int(math.ceil(math.log2(n + 2 * pad)))
    f = np.fft.rfftfreq(size)
    shape = [1] * img.ndim
    shape[axis] = f.size
    spec = np.fft.rfft(img, n=size, axis=axis) * np.exp(-2 * (math.pi * sigma * f) ** 2).reshape(shape)
    return np.take(np.fft.irfft(spec, n=size, axis=axis), np.arange(n), axis=axis)


def gauss(img, sigma):
    return blur(blur(img, sigma, 0), sigma, 1)


def shrink(img, k):
    h, w = img.shape[0] // k * k, img.shape[1] // k * k
    return img[:h, :w].reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))


scales, cover, lights, windows, late_windows = encode_set(SRC, '')
geometry = json.load(open(SRC + '.json'))  # written by skyline.py beside its renders
mirror = geometry.get('mirror')
el0, el1 = geometry['elevation']
H, W = cover.shape
ppd = H / (el1 - el0)
if mirror:
    scales['mirror'], _, m_lights, m_windows, _ = encode_set(SRC + '-mirror', '-mirror')
    # The river's lights as they average over the waves: the mirror blurred up and down, read at the
    # water's pixels (a pixel at -e reflects +e), times the water's reflectance there.
    mppd = m_lights.shape[0] / (mirror['elevation'][1] - mirror['elevation'][0])
    m = np.concatenate([m_lights, m_windows], axis=-1)
    m = blur(m, STREAK_SIGMA * mppd, 0)
    rows_el = el1 - (np.arange(H) + 0.5) / ppd  # each main row's elevation
    e = np.clip(-rows_el, 0, None)
    mrow = np.clip((mirror['elevation'][1] - e) * mppd - 0.5, 0, m.shape[0] - 1)  # mirror rows run top down too
    lo = np.floor(mrow).astype(int)
    hi = np.minimum(lo + 1, m.shape[0] - 1)
    t = (mrow - lo)[:, None, None]
    streaks = m[lo] * (1 - t) + m[hi] * t
    fresnel = 0.02 + 0.98 * (1 - np.sin(np.radians(e))) ** 5
    wet = ((1 - cover) * (rows_el < 0)[:, None] * fresnel[:, None])[..., None]
    lights = lights + streaks[..., :3] * wet
    windows = windows + streaks[..., 3:] * wet

# The glow: the evening's lights and windows, spread by the point spread function, the sky above
# padded so a halo is not cut off at the panorama's top.
late_share = float(lum(late_windows).sum() / max(lum(windows).sum(), 1e-9))
pad = int(round(GLOW_TOP * ppd))
source = np.concatenate([lights + windows, lum(windows)[..., None]], axis=-1)
source = np.concatenate([np.zeros((pad, W, 4)), source], axis=0)
glow_meta = {'elevation': [el0, el1 + pad / ppd], 'lateShare': round(late_share, 4)}
for name, parts, k in (('glow', GLOW_TIGHT, 2), ('halo', GLOW_WIDE, 4)):
    small = shrink(source, k)
    g = sum(w * gauss(small, sigma * ppd / k) for sigma, w in parts)
    g = np.maximum(g, 0.0)
    share = np.clip(g[..., 3] / np.maximum(lum(g[..., :3]), 1e-9), 0, 1)
    top = float(np.percentile(g[..., :3].max(axis=-1), 99.99))
    scale = float(2 ** math.ceil(math.log2(max(top, 1e-6))))
    write(os.path.join(out_dir, f'{VARIANT}-{name}.png'), g[..., :3] / scale, share)
    scales[name] = scale
    glow_meta[f'{name}Size'] = [g.shape[1], g.shape[0]]

# The meta: the panorama's place in the sky (as skyline.py rendered it) and the variants.
scene = json.load(open(os.path.join(ROOT, 'data', 'skyline', CITY, 'scene.json')))
meta_path = os.path.join(ROOT, 'public', 'skyline', f'{CITY}.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
if meta.get('version') != 2:
    meta = {}
h, w = cover.shape
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
    # The river's reflection: where its panorama sits (elevations from the mirror eye, which is as far
    # below the water as the eye is above it) and the eye's height above the water (m).
    'mirror': mirror,
    # The glow textures: their elevations (the panorama's bottom to above its top) and the share of the
    # evening's windows' light still on late.
    'glow': glow_meta,
    'source': f"{scene.get('source', '© OpenStreetMap contributors, ODbL')}; rendered in Blender (Cycles) with hand-modelled landmarks",
})
meta.setdefault('variants', {})[VARIANT] = {'months': MONTHS, 'scale': scales}
json.dump(meta, open(meta_path, 'w'), indent=2)
print('→', meta_path, scales)
