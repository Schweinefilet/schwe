"""Roof detail for the city's buildings (filler.py): no flat roof is left bare. Added to the buildings'
merged mesh (MeshBuilder), walls with the facade material's windowless style, tops with the roof's:

  parapet    a low wall round every flat roof, 0.9 to 1.2 m, 0.3 m thick
  plant      a mechanical penthouse (lift overrun and plant room) set in from the edges of larger flat
             roofs, 3 to 4.5 m tall
  hvac       air-handling boxes and condensers scattered over large flat roofs
  antennas   thin masts on the tall ones
  chimneys   London's chimney stacks along the ridges of pitched roofs and the party walls of flat ones,
             each with its pots
  skillion   OSM's mono-pitched roofs, sloping down toward their mapped roof:direction (Portcullis House's
             steep bronze roof is sixteen of them), the walls' tops following the slope

  tanks      New York (SITE 'archetypes': 'new-york'): wooden water tanks on steel stands on its pre-war
             low- and mid-rises (one, sometimes two or three), and a stair bulkhead where London has
             chimney stacks
"""

import math

from shapes import inset, oriented_size, signed_area as area_of

G = {}


def setup(g):
    G.update(g)


def _ccw(r):
    return r if area_of(r) > 0 else r[::-1]


def walls(mb, ring, z0, z1, attrs, inward=False):
    ring = _ccw(ring)
    pts = ring[::-1] if inward else ring
    u = 0.0
    for i in range(len(pts)):
        a, c = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        mb.face([(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)],
                [(u, z0), (u + L, z0), (u + L, z1), (u, z1)], 0, **attrs)
        u += L


def cap(mb, ring, z, attrs, holes=(), mat=1):
    tris, flat = G['tessellate'](ring, list(holes))
    for t in tris:
        mb.face([(*flat[t[0]], z), (*flat[t[1]], z), (*flat[t[2]], z)], None, mat, **attrs)


def box(mb, c, u, hx, hy, z0, z1, attrs, top=True):
    """An oriented box: centre c (x, y), unit axis u (x, y), half sizes along u and across it."""
    v = (-u[1], u[0])
    ring = [(c[0] + u[0] * sx * hx + v[0] * sy * hy, c[1] + u[1] * sx * hx + v[1] * sy * hy) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    walls(mb, ring, z0, z1, attrs)
    if top:
        cap(mb, _ccw(ring), z1, attrs)


def mast(mb, c, z0, z1, r, attrs, sides=6):
    ring = [(c[0] + r * math.cos(i / sides * math.tau), c[1] + r * math.sin(i / sides * math.tau)) for i in range(sides)]
    walls(mb, ring, z0, z1, attrs)


def axes(ring):
    """The outline's long axis (unit x, y), centre and length along it, and its width across."""
    pts = _ccw(ring)
    best = None
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6:
            continue
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        a = [x * ux + y * uy for x, y in pts]
        b = [-x * uy + y * ux for x, y in pts]
        w, h = max(a) - min(a), max(b) - min(b)
        if best is None or w * h < best[0]:
            ca, cb = (max(a) + min(a)) / 2, (max(b) + min(b)) / 2
            centre = (ca * ux - cb * uy, ca * uy + cb * ux)
            best = (w * h, (ux, uy) if w >= h else (-uy, ux), centre, max(w, h), min(w, h))
    if not best:
        return (1.0, 0.0), pts[0], 0.0, 0.0
    return best[1], best[2], best[3], best[4]


def scatter(ring, n, own, margin):
    """Up to n points inside the outline, `margin` metres clear of its edges."""
    inner = inset(ring, margin)
    if not inner:
        return []
    xs, ys = [p[0] for p in inner], [p[1] for p in inner]
    out, tries = [], 0
    while len(out) < n and tries < n * 12:
        tries += 1
        p = (own.uniform(min(xs), max(xs)), own.uniform(min(ys), max(ys)))
        if G['inside'](inner, p):
            out.append(p)
    return out


PLANT = (0.24, 0.245, 0.25)  # galvanised and painted plant, grey


def flat_roof(mb, ring, z, attrs, own, kind, height, tall_tier=True):
    """A flat roof's detail at height z: its parapet, and by the roof's size and the building's kind its
    plant room, air-handling boxes, antennas, or (older low-rise) chimney stacks on the party walls."""
    ring = _ccw(ring)
    area = abs(area_of(ring))
    plain = dict(attrs, style=3)
    plant = dict(plain, wall=PLANT, roofc=(0.18, 0.18, 0.19))
    n = 0
    # Parapet.
    ph = 0.9 + 0.3 * own.random()
    walls(mb, ring, z, z + ph, plain)
    inner = inset(ring, 0.3)
    if inner:
        walls(mb, inner, z, z + ph, plain, inward=True)
        cap(mb, ring, z + ph, plain, holes=[_ccw(inner)], mat=0)
    n += 1
    if area < 60 or not tall_tier:
        return n
    u, c, long_, short = axes(ring)
    nyc = G['SITE'].get('archetypes') == 'new-york'
    if nyc and (kind in ('lowrise', 'loft', 'wedding') or (kind == 'block' and attrs['style'] != 0 and own.random() < 0.5)):
        # New York's older roofs: a stair bulkhead, and from six floors up its wooden water tanks.
        v = (-u[1], u[0])
        bulk = dict(plain, wall=tuple(c_ * 0.9 for c_ in attrs['wall']))
        bp = (c[0] + u[0] * long_ * own.uniform(-0.25, 0.25), c[1] + u[1] * long_ * own.uniform(-0.25, 0.25))
        if G['inside'](ring, bp):
            box(mb, bp, u, own.uniform(1.6, 2.6), own.uniform(1.4, 2.0), z, z + own.uniform(2.6, 3.4), bulk)
            n += 1
        if height >= 18 and own.random() < 0.85:
            k = 1 if area < 600 or own.random() < 0.6 else (2 if own.random() < 0.75 else 3)
            for p in scatter(ring, k, own, 3.2):
                water_tank(mb, p, z, attrs, own)
                n += 1
        if kind != 'wedding' or area < 250:
            return n
    if kind == 'lowrise':
        # Chimney stacks on the party walls, every 6 to 9 m along the long sides.
        stacks = int(long_ // own.uniform(6, 9))
        v = (-u[1], u[0])
        brick = dict(plain, wall=tuple(c_ * 0.85 for c_ in attrs['wall']))
        for k in range(stacks):
            t = (k + 0.5) / max(stacks, 1) - 0.5
            for side in (-1, 1):
                if own.random() < 0.5:
                    continue
                p = (c[0] + u[0] * t * long_ + v[0] * side * (short / 2 - 0.6), c[1] + u[1] * t * long_ + v[1] * side * (short / 2 - 0.6))
                if G['inside'](ring, p):
                    stack(mb, p, u, z, z + own.uniform(1.4, 2.4), brick, own)
                    n += 1
        return n
    # A plant room: the lift overrun and the building's plant, set in from the edges (larger roofs).
    if area >= 250 and height >= 12:
        d = short * own.uniform(0.22, 0.34)
        pr = inset(ring, d)
        if pr and abs(area_of(pr)) > 20:
            top = z + own.uniform(3.0, 4.5)
            walls(mb, pr, z, top, plant)
            cap(mb, _ccw(pr), top, plant)
            n += 1
            # Antennas and a flagpole or two on the tall ones.
            if height >= 45:
                for p in scatter(pr, own.randint(1, 3), own, 0.5):
                    mast(mb, p, top, top + own.uniform(3, 11), 0.12, plant)
                    n += 1
        else:
            w = min(short * 0.35, 8.0)
            box(mb, c, u, min(long_ * 0.25, 10.0), w / 2, z, z + own.uniform(2.6, 4.0), plant)
            n += 1
    # Air-handling boxes and condensers.
    count = min(8, int(area / own.uniform(120, 220)))
    for p in scatter(ring, count, own, 1.8):
        box(mb, p, u if own.random() < 0.7 else (-u[1], u[0]), own.uniform(0.8, 2.0), own.uniform(0.6, 1.3), z, z + own.uniform(1.0, 2.1), plant)
        n += 1
    return n


def stack(mb, p, u, z0, z1, attrs, own):
    """A London chimney stack, 1.6 to 2.4 m long and 0.6 m deep, with its pots."""
    hx = own.uniform(0.8, 1.2)
    box(mb, p, u, hx, 0.32, z0, z1, attrs)
    pots = max(2, int(hx * 2.5))
    pot = dict(attrs, wall=(0.21, 0.11, 0.07))  # terracotta
    for k in range(pots):
        t = (k + 0.5) / pots * 2 - 1
        q = (p[0] + u[0] * t * (hx - 0.2), p[1] + u[1] * t * (hx - 0.2))
        mast(mb, q, z1, z1 + 0.6, 0.12, pot, sides=5)


def ridge_chimneys(mb, top, z_ridge, attrs, own):
    """Stacks along a pitched roof's ridge (its flat top or ridge line), every 5 to 8 m."""
    u, c, long_, short = axes(top)
    brick = dict(attrs, style=3, wall=tuple(c_ * 0.85 for c_ in attrs['wall']))
    n = 0
    k = int(max(long_ - 2.0, 0) // own.uniform(5, 8)) + 1
    for i in range(k):
        t = 0.0 if k == 1 else (i / (k - 1) - 0.5) * max(long_ - 2.0, 0)
        if own.random() < 0.25:
            continue
        p = (c[0] + u[0] * t, c[1] + u[1] * t)
        stack(mb, p, (-u[1], u[0]), z_ridge - 1.0, z_ridge + own.uniform(1.2, 2.2), brick, own)
        n += 1
    return n


def skillion(mb, ring, zw, roof_h, direction, attrs):
    """A mono-pitched roof: highest along the side away from `direction` (the compass bearing the slope
    faces), down to the eaves at zw on that side; the walls rise to meet it. Returns False when it cannot."""
    if direction is None:
        return False
    ring = _ccw(ring)
    d = (math.sin(math.radians(direction)), math.cos(math.radians(direction)))  # downhill, x east, y north
    proj = [p[0] * d[0] + p[1] * d[1] for p in ring]
    lo, hi = min(proj), max(proj)
    if hi - lo < 0.3:
        return False
    z = [zw + roof_h * (hi - s) / (hi - lo) for s in proj]
    u = 0.0
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        a, c = ring[i], ring[j]
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        mb.face([(a[0], a[1], zw), (c[0], c[1], zw), (c[0], c[1], z[j]), (a[0], a[1], z[i])],
                [(u, zw), (u + L, zw), (u + L, z[j]), (u, z[i])], 0, **dict(attrs, style=3))
        u += L
    tris, flat = G['tessellate'](ring, [])
    for t in tris:
        mb.face([(*flat[k], z[k]) for k in t], None, 1, **attrs)
    return True


# A New York water tank: cedar or redwood staves weathered grey-brown under a shallow conical lid, steel
# hoops, on a steel stand (Rosenwach and Isseks build them 10 to 16 ft across, 12 to 16 ft tall).
TANK_WOOD = (0.13, 0.1, 0.075)
TANK_STEEL = (0.06, 0.06, 0.065)


def water_tank(mb, p, z, attrs, own):
    r = own.uniform(1.5, 2.4)
    stand = own.uniform(2.4, 5.5)
    tall = own.uniform(3.6, 4.9)
    k = own.uniform(0.8, 1.2)
    steel = dict(attrs, style=3, wall=TANK_STEEL, roofc=TANK_STEEL)
    wood = dict(attrs, style=3, wall=tuple(c * k for c in TANK_WOOD), roofc=tuple(c * k * 0.8 for c in TANK_WOOD))
    for i in range(4):
        t = (i + 0.5) / 4 * math.tau
        mast(mb, (p[0] + r * 0.72 * math.cos(t), p[1] + r * 0.72 * math.sin(t)), z, z + stand, 0.14, steel, sides=4)
    box(mb, p, (1.0, 0.0), r * 0.9, r * 0.9, z + stand - 0.35, z + stand, steel)
    sides = 12
    ring = [(p[0] + r * math.cos(i / sides * math.tau), p[1] + r * math.sin(i / sides * math.tau)) for i in range(sides)]
    walls(mb, ring, z + stand, z + stand + tall, wood)
    # Two hoops standing proud.
    for zh in (0.3, 0.62):
        hoop = [(p[0] + (r + 0.05) * math.cos(i / sides * math.tau), p[1] + (r + 0.05) * math.sin(i / sides * math.tau)) for i in range(sides)]
        walls(mb, hoop, z + stand + tall * zh, z + stand + tall * zh + 0.12, steel)
    top = z + stand + tall
    apex = (p[0], p[1], top + r * 0.45)
    for i in range(sides):
        a, c = ring[i], ring[(i + 1) % sides]
        mb.face([(a[0], a[1], top), (c[0], c[1], top), apex], None, 1, **wood)
