"""Smaller copies of a city's skyline images (public/skyline/<city>/<variant>-*.png, scripts/blender/encode.py)
for the drops that cannot show them at full size (SKY.skyline.sets in config.js; src/sky/citySky.js):

  <city>/half/    every image at half size (mip level 1): the dive below the high tier, and a drift drop
                  while the camera passes close
  <city>/small/   every image at an eighth (mip level 3): the drift's drops and the falling drop

Each copy is the mip level the GPU would make from the full image: halved again and again, every step a
2x2 box over light (RGB decoded from sRGB to linear, averaged, encoded back) and over the data in alpha,
rounded to 8 bits as the GPU's own sRGB8_ALPHA8 levels are (the trees' sway, one linear grey channel, is
simply averaged). So a drop reading level n of a copy 2^k
smaller reads what it read at level n + k of the full image (the shader's level of detail follows the
texture's size).

    python3 scripts/skyline/sets.py [--city new-york]     every city with a v2 skyline by default
"""

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIR = os.path.join(ROOT, 'public', 'skyline')
SETS = {1: 'half', 3: 'small'}  # mip level → folder (SKY.skyline.sets)


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.round(255.0 * np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055))


def halve(img):
    """One mip step of an 8-bit sRGB+alpha image (H, W, 4 uint8) → (H/2, W/2, 4) uint8."""
    h, w = img.shape[0] // 2 * 2, img.shape[1] // 2 * 2
    img = img[:h, :w]
    rgb = to_linear(img[..., :3].astype(np.float64))
    a = img[..., 3:].astype(np.float64)
    box = lambda x: 0.25 * (x[0::2, 0::2] + x[1::2, 0::2] + x[0::2, 1::2] + x[1::2, 1::2])
    return np.concatenate([to_srgb(box(rgb)), np.round(box(a))], axis=-1).astype(np.uint8)


def halve_linear(img):
    """One mip step of a linear grey image (the trees' sway, H, W uint8)."""
    h, w = img.shape[0] // 2 * 2, img.shape[1] // 2 * 2
    x = img[:h, :w].astype(np.float64)
    return np.round(0.25 * (x[0::2, 0::2] + x[1::2, 0::2] + x[0::2, 1::2] + x[1::2, 1::2])).astype(np.uint8)


def write(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(img, 'RGBA' if img.ndim == 3 else 'L').save(path, optimize=True)


def city_sets(city):
    src = os.path.join(DIR, city)
    for name in sorted(f for f in os.listdir(src) if f.endswith('.png')):
        grey = name.endswith('-trees.png')  # linear, one channel
        img = np.asarray(Image.open(os.path.join(src, name)).convert('L' if grey else 'RGBA'))
        level = img
        for k in range(1, max(SETS) + 1):
            level = halve_linear(level) if grey else halve(level)
            if k in SETS:
                write(level, os.path.join(src, SETS[k], name))
        print(f'{city}/{name}: {img.shape[1]}x{img.shape[0]} -> ' + ', '.join(f'{v} level {k}' for k, v in SETS.items()))


def main():
    args = sys.argv[1:]
    if '--city' in args:
        cities = [args[args.index('--city') + 1]]
    else:
        cities = sorted(
            f[:-5] for f in os.listdir(DIR)
            if f.endswith('.json') and json.load(open(os.path.join(DIR, f))).get('version') == 2
        )
    for city in cities:
        city_sets(city)


if __name__ == '__main__':
    main()
