"""Composed primitives for the skyline's modelled buildings, added to a bmesh: lathed (round or
polygonal) and square-section stacks of frusta, pinnacles, gables, and plan-polygon helpers (inset,
smoothing). Shared by the landmarks (landmarks_<city>.py), the filler archetypes and the roofs."""

import math

from mathutils import Vector

Z = Vector((0, 0, 1))


def lathe(bm, centre, profile, sides=8, phase=0.0, cap_top=True, cap_bottom=False, axes=None):
    """A solid of revolution about the vertical through `centre`: `profile` is [(z, r), ...] bottom to
    top, each ring a regular polygon of `sides` (32+ reads round). A ring of r 0 is a point (a spire's tip).
    `axes` (ax, ay) turns the polygon's frame (default x, y); `phase` turns it by that many radians."""
    ax, ay = axes or (Vector((1, 0, 0)), Vector((0, 1, 0)))
    rings = []
    for z, r in profile:
        if r <= 1e-4:
            rings.append([bm.verts.new(Vector((centre.x, centre.y, z)))])
            continue
        ring = []
        for i in range(sides):
            t = phase + i / sides * math.tau
            p = centre + ax * (r * math.cos(t)) + ay * (r * math.sin(t))
            ring.append(bm.verts.new(Vector((p.x, p.y, z))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        _bridge(bm, a, b)
    if cap_top and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    if cap_bottom and len(rings[0]) > 2:
        bm.faces.new(rings[0][::-1])
    return rings


def _bridge(bm, a, b):
    if len(a) == 1 and len(b) == 1:
        return
    if len(b) == 1:
        for i in range(len(a)):
            bm.faces.new((a[i], a[(i + 1) % len(a)], b[0]))
        return
    if len(a) == 1:
        for i in range(len(b)):
            bm.faces.new((b[(i + 1) % len(b)], b[i], a[0]))
        return
    n = len(a)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))


def square_stack(bm, centre, ax, ay, profile, cap_top=True, cap_bottom=False):
    """A square or oblong section tower: `profile` [(z, hx, hy), ...] half widths along the axes `ax`,
    `ay` (unit, horizontal). Consecutive rings joined by frusta; a ring of (z, 0, 0) is a point."""
    rings = []
    for z, hx, hy in profile:
        if hx <= 1e-4 and hy <= 1e-4:
            rings.append([bm.verts.new(Vector((centre.x, centre.y, z)))])
            continue
        ring = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = centre + ax * (sx * hx) + ay * (sy * hy)
            ring.append(bm.verts.new(Vector((p.x, p.y, z))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        _bridge(bm, a, b)
    if cap_top and len(rings[-1]) > 2:
        bm.faces.new(rings[-1])
    if cap_bottom and len(rings[0]) > 2:
        bm.faces.new(rings[0][::-1])
    return rings


def box(bm, centre, ax, ay, hx, hy, z0, z1):
    square_stack(bm, centre, ax, ay, [(z0, hx, hy), (z1, hx, hy)], cap_bottom=True)


def pinnacle(bm, at, z0, width, shaft, spire, sides=4, phase=None, axes=None):
    """A gothic pinnacle: a slender shaft `width` across and `shaft` tall from z0, a small capping band,
    then a spirelet `spire` tall to a point. Square by default (turned 45 deg off the axes when phase is
    None and sides 4 would show a corner), octagonal with sides=8."""
    r = width / 2 / math.cos(math.pi / sides)
    ph = (math.pi / sides) if phase is None else phase
    lathe(bm, at, [(z0, r), (z0 + shaft, r), (z0 + shaft, r * 1.22), (z0 + shaft + spire * 0.12, r * 1.22),
                   (z0 + shaft + spire * 0.12, r * 0.95), (z0 + shaft + spire, 0.0)], sides=sides, phase=ph, axes=axes)


def gable(bm, centre, along, across, width, depth, z0, height):
    """A gable: a triangular prism `width` wide (along), `depth` deep (across), its ridge `height` above z0."""
    h = width / 2
    d = depth / 2
    pts = []
    for s in (-1, 1):
        base = centre + across * (s * d)
        pts.append([bm.verts.new(base - along * h + Z * z0), bm.verts.new(base + along * h + Z * z0), bm.verts.new(base + Z * (z0 + height))])
    (a0, a1, a2), (b0, b1, b2) = pts
    bm.faces.new((a0, a1, a2))
    bm.faces.new((b2, b1, b0))
    bm.faces.new((a0, a2, b2, b0))
    bm.faces.new((a1, b1, b2, a2))


def signed_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def ccw(ring):
    return ring if signed_area(ring) > 0 else ring[::-1]


def inset(ring, d, min_edge=0.3):
    """The plan polygon moved inward by d (outward when d < 0; mitred offset, each vertex along its
    bisector, mitres capped at 3 d so a sharp corner does not shoot out). Fine for the mild concavity of
    real building outlines; None when it folds over (the result's area changes sign or collapses)."""
    pts = ccw([tuple(p) for p in ring])
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*pts[i - 1], 0)), Vector((*pts[i], 0)), Vector((*pts[(i + 1) % n], 0))
        e0, e1 = (p1 - p0), (p2 - p1)
        if e0.length < 1e-6 or e1.length < 1e-6:
            continue
        n0 = Vector((-e0.y, e0.x, 0)).normalized()  # inward normal of a ccw ring
        n1 = Vector((-e1.y, e1.x, 0)).normalized()
        bis = n0 + n1
        if bis.length < 1e-6:
            bis = n0
            k = d
        else:
            bis.normalize()
            cosh = max(bis.dot(n0), 1 / 3)
            k = d / cosh
        q = p1 + bis * k
        out.append((q.x, q.y))
    if len(out) < 3:
        return None
    a0, a1 = signed_area(pts), signed_area(out)
    if a1 <= 0 or (d > 0 and (a1 > a0 or a1 < 0.05 * a0)) or (d < 0 and a1 < a0):
        return None
    # Drop vertices that collapsed onto their neighbours.
    clean = [out[0]]
    for p in out[1:]:
        if math.dist(p, clean[-1]) > min_edge:
            clean.append(p)
    return clean if len(clean) >= 3 else None


def chamfer(ring, d):
    """The plan polygon with each convex corner cut back d metres along both its edges (a chamfered tower);
    None when an edge is too short for it."""
    r = ccw([tuple(p) for p in ring])
    n = len(r)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*r[i - 1], 0)), Vector((*r[i], 0)), Vector((*r[(i + 1) % n], 0))
        e0, e1 = p1 - p0, p2 - p1
        if e0.length < 2.2 * d or e1.length < 2.2 * d:
            return None
        if e0.x * e1.y - e0.y * e1.x > 0:  # convex (a left turn on a ccw ring)
            a, b = p1 - e0.normalized() * d, p1 + e1.normalized() * d
            out += [(a.x, a.y), (b.x, b.y)]
        else:
            out.append((p1.x, p1.y))
    return out


def chaikin(ring, rounds=2, keep=0.25):
    """A plan polygon's corners rounded (Chaikin's corner cutting): for curved facades OSM traces with
    a few straight segments."""
    pts = [tuple(p) for p in ring]
    for _ in range(rounds):
        nxt = []
        for i in range(len(pts)):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
            nxt.append((x0 + (x1 - x0) * keep, y0 + (y1 - y0) * keep))
            nxt.append((x0 + (x1 - x0) * (1 - keep), y0 + (y1 - y0) * (1 - keep)))
        pts = nxt
    return pts


def prism(bm, ring, z0, z1, cap_top=True, cap_bottom=False):
    """A vertical prism on a plan polygon (outward walls, ccw)."""
    from mathutils import geometry
    r = ccw(ring)
    lo = [bm.verts.new((x, y, z0)) for x, y in r]
    hi = [bm.verts.new((x, y, z1)) for x, y in r]
    n = len(r)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if cap_top or cap_bottom:
        tris = geometry.tessellate_polygon([[Vector((x, y, 0)) for x, y in r]])
        for t in tris:
            if cap_top:
                bm.faces.new((hi[t[0]], hi[t[1]], hi[t[2]]))
            if cap_bottom:
                bm.faces.new((lo[t[2]], lo[t[1]], lo[t[0]]))
    return lo, hi


def edge_points(ring, every, corner_min_deg=40.0, margin=1.0):
    """Points along a plan polygon for pinnacles and chimneys: every convex corner sharper than
    `corner_min_deg`, and evenly along each edge longer than `every`, kept `margin` from the corners.
    Returns (point, inward normal) pairs."""
    r = ccw([tuple(p) for p in ring])
    n = len(r)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*r[i - 1], 0)), Vector((*r[i], 0)), Vector((*r[(i + 1) % n], 0))
        e0, e1 = p1 - p0, p2 - p1
        if e0.length < 1e-6 or e1.length < 1e-6:
            continue
        turn = math.degrees(math.atan2(e0.x * e1.y - e0.y * e1.x, e0.dot(e1)))
        inward = (Vector((-e0.y, e0.x, 0)).normalized() + Vector((-e1.y, e1.x, 0)).normalized())
        if turn > corner_min_deg and inward.length > 1e-6:
            out.append((p1, inward.normalized()))
        L = e1.length
        if L > every:
            k = int(L // every)
            nrm = Vector((-e1.y, e1.x, 0)).normalized()
            for j in range(1, k + 1):
                t = j / (k + 1)
                if margin < t * L < L - margin:
                    out.append((p1 + e1 * t, nrm))
    return out


def oriented_size(ring):
    """The plan polygon's short and long sides: its minimum-area bounding rectangle over its edges'
    directions (exact for convex outlines, near enough for real ones)."""
    pts = [tuple(p) for p in ring]
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
            best = (w * h, min(w, h), max(w, h))
    return (best[1], best[2]) if best else (0.0, 0.0)
