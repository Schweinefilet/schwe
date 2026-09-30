"""Where a reference photo was taken from: fits the camera's position, eye height, heading, pitch and
horizontal field of view to where known landmarks fall in the photo. Positions are in the skyline's
local metres (east x, north y of the city's vantage, src/content/vantages.json); each landmark's
position is the middle of its OpenStreetMap element's bounds (data/osm/<city>.json, from fetch.mjs).

    python3 scripts/skyline/tools/fit_camera.py data/refs/<city>/<ref>.fit.json [--pin x,y,eye | --pin-eye eye]

The .fit.json file (write one per photo; measure u, v by eye on a gridded crop, compare.py --grid):
    {"city": "london", "size": [3840, 2556],
     "points": [{"osm": "way/123557148", "z": 96.0, "u": 0.5918, "v": 0.4357, "what": "Elizabeth Tower tip"},
                {"osm": "way/367642689", "z": null, "u": 0.4835, "v": null, "what": "Victoria Tower, centre"}]}
u, v: fractions of the photo's width and height (v down); z: the point's height above the street in
metres (null: horizontal only). With few vertical points the height and position trade off: pin the
camera where the photographer must have stood (--pin) and fit only heading, pitch and field of view, or pin
only the eye's height (--pin-eye: standing on a pier or promenade of known height) and fit where along it.
London's photo 4 fitted to 12 px rms at 3840 px this way (scripts/blender/skyline.py REFS).
"""

import json
import math
import sys

import numpy as np

ROOT = __file__.rsplit('/scripts/', 1)[0]
cfg = json.load(open(sys.argv[1]))
pin = [float(v) for v in sys.argv[sys.argv.index('--pin') + 1].split(',')] if '--pin' in sys.argv else None
pin_eye = float(sys.argv[sys.argv.index('--pin-eye') + 1]) if '--pin-eye' in sys.argv else None
city = cfg['city']
vantages = json.load(open(f'{ROOT}/src/content/vantages.json'))
LAT0, LON0 = vantages[city]['from']['at']
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110540  # as extract.mjs

osm = json.load(open(f'{ROOT}/data/osm/{city}.json'))
bounds = {f"{e['type']}/{e['id']}": e['bounds'] for e in osm['elements'] if 'bounds' in e}


def at(osm_id):
    b = bounds[osm_id]
    return (((b['minlon'] + b['maxlon']) / 2 - LON0) * KX, ((b['minlat'] + b['maxlat']) / 2 - LAT0) * KY)


W, H = cfg['size']
pts = [(at(p['osm']), p.get('z'), p.get('u'), p.get('v'), p.get('what', p['osm'])) for p in cfg['points']]


def project(q, P):
    x, y, zc, heading, pitch, hfov = q
    (X, Y), z = P[0], P[1]
    dx, dy = X - x, Y - y
    d = math.hypot(dx, dy)
    rel = math.radians(((math.degrees(math.atan2(dx, dy)) - heading + 180) % 360) - 180)
    f = 0.5 / math.tan(math.radians(hfov / 2))  # in widths
    fw, rt = d * math.cos(rel), d * math.sin(rel)
    up = (z - zc) if z is not None else 0.0
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    fw2, up2 = fw * cp + up * sp, -fw * sp + up * cp
    return 0.5 + f * rt / fw2, 0.5 - f * up2 / fw2 * W / H


def cost(q):
    r = 0.0
    for P in pts:
        u, v = project(q, P)
        if P[2] is not None:
            r += ((u - P[2]) * W) ** 2
        if P[3] is not None and P[1] is not None:
            r += ((v - P[3]) * H) ** 2
    return r


def nelder_mead(f, x0, step, iters=6000):
    n = len(x0)
    xs = [np.array(x0, float)] + [np.array(x0, float) + np.eye(n)[i] * step[i] for i in range(n)]
    fs = [f(x) for x in xs]
    for _ in range(iters):
        order = np.argsort(fs)
        xs, fs = [xs[i] for i in order], [fs[i] for i in order]
        c = sum(xs[:-1]) / n
        xr = c + (c - xs[-1])
        fr = f(xr)
        if fr < fs[0]:
            xe = c + 2 * (c - xs[-1])
            fe = f(xe)
            xs[-1], fs[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < fs[-2]:
            xs[-1], fs[-1] = xr, fr
        else:
            xc = c + 0.5 * (xs[-1] - c)
            fc = f(xc)
            if fc < fs[-1]:
                xs[-1], fs[-1] = xc, fc
            else:
                xs = [xs[0] + 0.5 * (x - xs[0]) for x in xs]
                fs = [f(x) for x in xs]
    i = int(np.argmin(fs))
    return xs[i], fs[i]


# Start facing the landmarks' mean bearing from the vantage.
mx = sum(p[0][0] for p in pts) / len(pts)
my = sum(p[0][1] for p in pts) / len(pts)
h0 = math.degrees(math.atan2(mx, my)) % 360
if pin:
    q, c = nelder_mead(lambda q: cost([*pin, *q]), [h0, 0.0, 30.0], [2, 1, 3])
    q = np.array([*pin, *q])
elif pin_eye is not None:
    best = None
    for dx, dy in ((0, 0), (80, 0), (-80, 0), (0, 80), (0, -80)):
        q, c = nelder_mead(lambda q: cost([q[0], q[1], pin_eye, *q[2:]]), [dx, dy, h0, 0.0, 30.0], [30, 30, 2, 1, 3])
        if best is None or c < best[1]:
            best = (q, c)
    q, c = best
    q = np.array([q[0], q[1], pin_eye, *q[2:]])
else:
    best = None
    for dx, dy in ((0, 0), (80, 0), (-80, 0), (0, 80), (0, -80)):
        q, c = nelder_mead(cost, [dx, dy, 10.0, h0, 0.0, 30.0], [30, 30, 4, 2, 1, 3])
        if best is None or c < best[1]:
            best = (q, c)
    q, c = best
n = sum((P[2] is not None) + (P[3] is not None and P[1] is not None) for P in pts)
print('pos (%.0f, %.0f) eye %.1f heading %.2f pitch %.2f hfov %.2f   rms %.1f px' % (*q, math.sqrt(c / max(n, 1))))
for P in pts:
    u, v = project(q, P)
    print('  %-34s u %.4f (%s)  v %.4f (%s)' % (P[4][:34], u, P[2], v, P[3]))
print("REFS entry: {'pos': (%.0f, %.0f), 'eye': %.1f, 'heading': %.2f, 'hfov': %.2f, 'pitch': %.2f, 'size': (%d, %d)}"
      % (q[0], q[1], q[2], q[3], q[5], q[4], W / 2, H / 2))
