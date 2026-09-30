"""Checking a skyline render against a reference photo.

    python3 scripts/skyline/tools/compare.py <photo> <render.png> <out.jpg> [y0 y1]
        the photo above the render at the same size, then the render's edges in red over the photo,
        cropped to the band y0..y1 (fractions of height): silhouettes, masts and roof lines line up or not
    python3 scripts/skyline/tools/compare.py --grid <image> <x0> <y0> <x1> <y1> <out.jpg> [scale]
        a crop (fractions) with ticks every 0.01 of the width, labelled every 0.05: for reading the u, v
        of landmarks off a photo (fit_camera.py)

Renders: skyline.py --view <ref> writes EXRs; scripts/blender/preview.py makes the PNGs. Needs Pillow.
"""

import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps

args = sys.argv[1:]
if args and args[0] == '--grid':
    src, x0, y0, x1, y1, out = args[1], *map(float, args[2:6]), args[6]
    scale = float(args[7]) if len(args) > 7 else 1.0
    img = Image.open(src).convert('RGB')
    W, H = img.size
    box = (int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))
    c = img.crop(box)
    c = c.resize((int(c.width * scale), int(c.height * scale)))
    d = ImageDraw.Draw(c)
    step = 0.01 * W
    k = int(box[0] / step) + 1
    while k * step < box[2]:
        x = (k * step - box[0]) * scale
        d.line([(x, 0), (x, 8 if k % 5 else 20)], fill=(255, 0, 0), width=1)
        if k % 5 == 0:
            d.text((x + 2, 20), '%.2f' % (k * 0.01), fill=(255, 0, 0))
        k += 1
    k = int(box[1] / step) + 1
    while k * step < box[3]:
        y = (k * step - box[1]) * scale
        d.line([(0, y), (8 if k % 5 else 20, y)], fill=(255, 0, 0), width=1)
        if k % 5 == 0:
            d.text((22, y - 5), '%.3f' % (k * step / H), fill=(255, 0, 0))
        k += 1
    c.save(out, quality=90)
    print(c.size)
    sys.exit()

photo = Image.open(args[0]).convert('RGB')
render = Image.open(args[1]).convert('RGB')
W = 1400
H = round(photo.height * W / photo.width)
photo, render = photo.resize((W, H)), render.resize((W, H))
y0, y1 = (float(args[3]), float(args[4])) if len(args) > 4 else (0.0, 1.0)
box = (0, int(y0 * H), W, int(y1 * H))
p, r = photo.crop(box), render.crop(box)
edges = ImageOps.grayscale(r).filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 18 else 0)
over = Image.composite(Image.new('RGB', p.size, (255, 40, 40)), p, edges)
out = Image.new('RGB', (W, p.height * 3), 'white')
out.paste(p, (0, 0))
out.paste(r, (0, p.height))
out.paste(over, (0, 2 * p.height))
out.save(args[2], quality=88)
print(out.size)
