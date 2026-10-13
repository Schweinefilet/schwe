"""Paris's landmarks for scripts/blender/skyline.py, modelled from published dimensions and OpenStreetMap and
checked against the reference photos in data/refs/paris/ (Wikimedia Commons, see sources.json): the view
from the Trocadéro's parvis down the Palais de Chaillot's axis to the Eiffel Tower.

REPLACES: OpenStreetMap elements drawn here instead of raised from their outline.
build(g): g is skyline.py's globals (bpy, MAT, MeshBuilder, scene_data, SITE, rng, …).

Heights: the scene's z = 0 is the Seine at the Pont d'Iéna, 26.4 m NGF-IGN69 (extract.mjs TERRAIN); each
landmark stands on the IGN ground under it (scene_data['landmarkBases']).

The Eiffel Tower (Wikipedia; the Société d'Exploitation de la Tour Eiffel's figures): a square base 124.9 m
across the legs' outer corners, 74.24 m between their inner faces; the first floor at 57.64 m, 70.69 m
square; the second at 115.73 m, 40.96 m square; the third at 276.13 m; the antennas' tip at 330 m. The
outer profile is Koechlin and Nouguier's curve against the wind's moment, taken here as an exponential through
the base and both platforms (half width 62.45 e^(-0.00963 z): 35.8 m at the first floor, 20.5 at the second,
4.4 under the top); the legs' inner faces close in as 37.12 e^(-z / 88) (74 m apart at the ground, 39 at
the first floor, 20 at the second: measured on ref c001 against the outer widths). Every leg is four corner
chords, each a laced box girder, joined by X-braced panels about as tall as the leg is wide; above the
second floor the faces between the legs are braced too, making the pylon. The first floor's skirt: the
decorative arch on each face (crown 44 m, springing from the legs at 15 m: c001), the lattice over it, the
row of small arches and the frieze of the 72 names, the deck, its glazed pavilions (2014) and railings.
The second floor: its girders, two glazed levels and railings. The top: the corbelled third floor, its
glazed cabin and open deck, Eiffel's campanile, the beacon's lantern, and the antennas to 330 m.

By night (ref c021, c029, c063): the golden lighting from within (switched by 'tower_gain', rendered with
the city's lights and alone in the 'tower' pass: the site turns it off at midnight, as the tower does) (336 sodium projectors since 1985), the
steel itself glowing gold; the floors' glazing warm white; red aviation lights. The sparkle (20,000 bulbs,
five minutes each hour after dark) is its own render (the 'spark' pass) and the beacon's beams are drawn
live by the site (sky.glsl).
"""

import math
import random

EIFFEL = 'way/5013364'
HEROES = {'Tour Eiffel', 'Palais de Chaillot'}
OBJECT_PREFIXES = {'eiffel', 'iena'}

# Linear albedos. The tower's paint, "Brun Tour Eiffel", three shades from dark at the foot to lighter at
# the top (so it reads even against the sky); weathered and seen through the haze it is a dark bronze brown.
EIFFEL_BROWN = ((0.075, 0.055, 0.04), (0.11, 0.082, 0.058))
CHAILLOT_STONE = (0.52, 0.47, 0.38)  # the palace's pale Burgundy limestone (1937)
PARIS_STONE = (0.5, 0.45, 0.36)

OVERRIDES = {
    # The Palais de Chaillot: smooth stone walls, tall windows in deep bays (style 2), a flat roof.
    'Palais de Chaillot': dict(wall=CHAILLOT_STONE, roof=(0.32, 0.3, 0.27), style=2, cell=(4.2, 6.0, 0.17, 0.36, 0.42), busy=0.04),
    # The Invalides' Église du Dôme (OSM's name; its parts): stone, its dome gilded (regilded 1989), floodlit
    # gold at night (ref c096, left of the tower from the parvis).
    'Église du Dôme': dict(wall=PARIS_STONE, roof=(0.45, 0.32, 0.08), parts=PARIS_STONE),
}
FLOODLIT = {
    'Palais de Chaillot': 0.45,
    # Lit every night, by OSM's names: the Invalides' gilded dome (Église du Dôme; ref c096 shows it gold
    # left of the tower), the Grand Palais and the Palais Bourbon along the river.
    'Église du Dôme': 1.4,
    'Hôtel des Invalides': 0.5,
    'Grand Palais': 0.5,
    'Palais Bourbon': 0.4,
}


def is_hero(b):
    return (b.get('name') in HEROES) or ((b.get('within') or {}).get('name') in HEROES)


def prepare(scene_data):
    return set()


# ---- Mesh accumulation ----------------------------------------------------------------------------------

class Rods:
    """Many small boxes (the lattice's members) gathered into one mesh, each face with a material slot."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.mats = []

    def box(self, p, q, w, d=None, mat=0, up=(0.0, 0.0, 1.0)):
        """A beam of section w by d from p to q (3-tuples); its w side across `up`."""
        d = w if d is None else d
        ax = (q[0] - p[0], q[1] - p[1], q[2] - p[2])
        L = math.sqrt(ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2)
        if L < 1e-4:
            return
        a = (ax[0] / L, ax[1] / L, ax[2] / L)
        # s: across, perpendicular to the axis and to up; t: completes the frame.
        s = (a[1] * up[2] - a[2] * up[1], a[2] * up[0] - a[0] * up[2], a[0] * up[1] - a[1] * up[0])
        sl = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2)
        if sl < 1e-4:
            s = (1.0, 0.0, 0.0) if abs(a[0]) < 0.9 else (0.0, 1.0, 0.0)
            s = (s[0] - a[0] * (s[0] * a[0] + s[1] * a[1] + s[2] * a[2]), s[1] - a[1] * (s[0] * a[0] + s[1] * a[1] + s[2] * a[2]),
                 s[2] - a[2] * (s[0] * a[0] + s[1] * a[1] + s[2] * a[2]))
            sl = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2)
        s = (s[0] / sl * w / 2, s[1] / sl * w / 2, s[2] / sl * w / 2)
        t = (a[1] * s[2] - a[2] * s[1], a[2] * s[0] - a[0] * s[2], a[0] * s[1] - a[1] * s[0])
        tl = math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2) or 1.0
        t = (t[0] / tl * d / 2, t[1] / tl * d / 2, t[2] / tl * d / 2)
        n = len(self.verts)
        for e in (p, q):
            for sx, ty in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                self.verts.append((e[0] + s[0] * sx + t[0] * ty, e[1] + s[1] * sx + t[1] * ty, e[2] + s[2] * sx + t[2] * ty))
        for i in range(4):
            j = (i + 1) % 4
            self.faces.append((n + i, n + j, n + 4 + j, n + 4 + i))
            self.mats.append(mat)
        self.faces.append((n + 3, n + 2, n + 1, n))
        self.faces.append((n + 4, n + 5, n + 6, n + 7))
        self.mats += [mat, mat]

    def quad(self, pts, mat=0):
        n = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(n, n + len(pts))))
        self.mats.append(mat)

    def build(self, g, name, materials, lightgroup='city'):
        bpy = g['bpy']
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.polygons.foreach_set('material_index', self.mats)
        me.validate()
        for m in materials:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if lightgroup:
            ob.lightgroup = lightgroup
        return ob


def lattice_strip(r, p0, p1, q0, q1, rod, step, mat=0):
    """A laced girder between two parallel edges p0-p1 and q0-q1: its two flanges, and a zigzag between them
    every `step` metres along."""
    r.box(p0, p1, rod, mat=mat)
    r.box(q0, q1, rod, mat=mat)
    L = math.dist(p0, p1)
    n = max(1, int(round(L / step)))
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)  # noqa: E731
    for i in range(n):
        a = lerp(p0, p1, i / n)
        b = lerp(q0, q1, (i + 0.5) / n)
        c = lerp(p0, p1, (i + 1) / n)
        r.box(a, b, rod * 0.6, mat=mat)
        r.box(b, c, rod * 0.6, mat=mat)


# ---- The Eiffel Tower -----------------------------------------------------------------------------------

K_OUT = 0.00963
FIRST, SECOND, THIRD, TIP = 57.64, 115.73, 276.13, 330.0


def W(z):
    """Half the tower's width across its outer faces at height z."""
    return 62.45 * math.exp(-K_OUT * z)


def Gh(z):
    """Half the gap between the legs' inner faces at height z."""
    return 37.12 * math.exp(-z / 88.0)


def eiffel(g):
    from mathutils import Vector
    sd = g['scene_data']
    outline = sd['landmarkOutlines'].get(EIFFEL)
    if not outline:
        print('eiffel: no outline')
        return
    ring = outline[0][:-1] if outline[0][0] == outline[0][-1] else outline[0]
    cx, cy = tower_centre(g)
    # The faces' axes: the outline's longest edge (OSM's square of the four feet).
    best = max(range(len(ring)), key=lambda i: math.dist(ring[i], ring[(i + 1) % len(ring)]))
    ex, ey = ring[(best + 1) % len(ring)][0] - ring[best][0], ring[(best + 1) % len(ring)][1] - ring[best][1]
    el = math.hypot(ex, ey)
    A = (ex / el, ey / el)
    B = (-A[1], A[0])
    z0 = sd['landmarkBases'].get(EIFFEL, 0.0)
    print(f'eiffel: centre ({cx:.1f}, {cy:.1f}), base z {z0:.2f}, faces at {math.degrees(math.atan2(A[0], A[1])) % 90:.1f} deg')

    def P(u, v, z):
        return (cx + A[0] * u + B[0] * v, cy + A[1] * u + B[1] * v, z0 + z)

    steel = Rods()     # slot 0 the steel; 1 the floors' glazing; 2 dark roofs and decks; 3 the frieze's panels
    own = random.Random(1889)

    def section(z):
        return Gh(z), W(z)

    # Panel stations, each run of floors cut into panels about as tall as the legs are wide.
    bounds = [0.0, 15.0, FIRST - 11.5, FIRST, SECOND - 4.5, SECOND, 155.0, 196.0, 236.0, THIRD - 16.0]
    stations = []
    for a, b in zip(bounds, bounds[1:]):
        Lm = W((a + b) / 2) - Gh((a + b) / 2)
        n = max(1, int(round((b - a) / max(0.95 * Lm, 4.0))))
        stations += [a + (b - a) * i / n for i in range(n)]
    stations.append(bounds[-1])

    def chord_w(z):
        return max(0.6, min(3.0, 0.12 * (W(z) - Gh(z))))

    def member(z):
        return max(0.45, min(1.5, 0.065 * (W(z) - Gh(z))))

    # The four legs (quadrant signs su, sv).
    for su in (-1, 1):
        for sv in (-1, 1):
            def corner(cu, cv, z, inset=0.0):
                """A leg's corner at height z: cu, cv 0 for the inner edge, 1 the outer, `inset` metres into the leg."""
                g_, w_ = section(z)
                u = g_ + inset if cu == 0 else w_ - inset
                v = g_ + inset if cv == 0 else w_ - inset
                return P(su * u, sv * v, z)

            corners = ((0, 0), (1, 0), (1, 1), (0, 1))
            # Corner chords: each a laced box girder (four angles, lacing on every face).
            for cu, cv in corners:
                for za, zb in zip(stations, stations[1:]):
                    cw = chord_w(za)
                    sub = [za + (zb - za) * k / 3 for k in range(4)]
                    for s0, s1 in zip(sub, sub[1:]):
                        q = [corner(cu, cv, s, 0.0) for s in (s0, s1)]
                        qi = [corner(cu, cv, s, chord_w(s)) for s in (s0, s1)]
                        # The chord's four angles: at the leg's corner, inset along u, along v, and both.
                        def at(s, du, dv):
                            g_, w_ = section(s)
                            u = (g_ + du) if cu == 0 else (w_ - du)
                            v = (g_ + dv) if cv == 0 else (w_ - dv)
                            return P(su * u, sv * v, s)
                        rod = max(0.18, 0.2 * cw)
                        angles = [(0, 0), (chord_w(s0), 0), (chord_w(s0), chord_w(s0)), (0, chord_w(s0))]
                        for du, dv in angles:
                            steel.box(at(s0, du, dv), at(s1, du * chord_w(s1) / chord_w(s0), dv * chord_w(s1) / chord_w(s0)), rod)
                        # Lacing on the chord's four faces, a zigzag every chord width.
                        n = max(1, int(round((s1 - s0) / max(cw * 1.1, 0.6))))
                        for f in range(4):
                            (a1, b1), (a2, b2) = angles[f], angles[(f + 1) % 4]
                            for i in range(n):
                                t0, t1 = s0 + (s1 - s0) * i / n, s0 + (s1 - s0) * (i + 1) / n
                                k0, k1 = chord_w(t0) / cw, chord_w(t1) / cw
                                m = (t0 + t1) / 2
                                km = chord_w(m) / cw
                                steel.box(at(t0, a1 * k0, b1 * k0), at(m, a2 * km, b2 * km), rod * 0.55)
                                steel.box(at(m, a2 * km, b2 * km), at(t1, a1 * k1, b1 * k1), rod * 0.55)
            # Struts round the leg at each station, and X-bracing on its four faces in each panel.
            for i, za in enumerate(stations):
                mw = member(za)
                cw = chord_w(za)
                pts = [corner(cu, cv, za, cw / 2) for cu, cv in corners]
                for f in range(4):
                    a, b = pts[f], pts[(f + 1) % 4]
                    lattice_strip(steel, a, b, (a[0], a[1], a[2] - mw * 1.6), (b[0], b[1], b[2] - mw * 1.6), mw * 0.5, mw * 2.2)
                if i + 1 < len(stations):
                    zb = stations[i + 1]
                    top = [corner(cu, cv, zb, chord_w(zb) / 2) for cu, cv in corners]
                    for f in range(4):
                        a0, b0 = pts[f], pts[(f + 1) % 4]
                        a1, b1 = top[f], top[(f + 1) % 4]
                        # Each diagonal a light lattice girder: two flanges a member's width apart, laced.
                        for p0, p1 in ((a0, b1), (b0, a1)):
                            off = (0.0, 0.0, mw * 0.9)
                            lattice_strip(steel, p0, p1, (p0[0] + off[0], p0[1] + off[1], p0[2] + off[2]),
                                          (p1[0] + off[0], p1[1] + off[1], p1[2] + off[2]), mw * 0.55, mw * 2.0)

    # Above the second floor the faces between the legs are braced too: the pylon.
    pyl = [s for s in stations if s >= SECOND - 0.1]
    for face in range(4):
        def fp(t, z, face=face):
            """A point on face `face` (0 +u, 1 +v, 2 -u, 3 -v) at height z, t from -1 to 1 across the gap between
            the legs."""
            g_, w_ = section(z)
            w_ -= chord_w(z) / 2
            across = t * g_
            return [P(w_, across, z), P(across, w_, z), P(-w_, -across, z), P(-across, -w_, z)][face]
        for za, zb in zip(pyl, pyl[1:]):
            mw = member(za) * 0.85
            steel.box(fp(-1, za), fp(1, za), mw)
            for t0, t1 in ((-1, 0), (0, 1)):
                steel.box(fp(t0, za), fp(t1, zb), mw * 0.8)
                steel.box(fp(t1, za), fp(t0, zb), mw * 0.8)

    # The decorative arches, one on each face, with the lattice between them and the first floor's skirt.
    skirt_bottom = FIRST - 11.5
    for face in range(4):
        def ap(v, z, face=face, out=0.0):
            u = W(z) - 0.6 + out
            return [P(u, v, z), P(-v, u, z), P(-u, -v, z), P(v, -u, z)][face]
        zs, crown, depth = 15.0, 44.0, 4.0
        R = Gh(zs) + 1.0
        n = 48
        intra, extra = [], []
        for i in range(n + 1):
            t = math.pi * i / n
            v = R * math.cos(t)
            z = zs + (crown - zs) * math.sin(t)
            intra.append(ap(v, z))
            # The extrados: the arch band's depth along its normal, more at the crown.
            nz = math.sin(t) * (crown - zs) / max(R, 1e-3)
            k = depth / math.hypot(math.cos(t), nz or 1e-6)
            extra.append(ap(v * (1 + k / R), z + depth * math.sin(t)))
        for i in range(n):
            steel.box(intra[i], intra[i + 1], 1.0)
            steel.box(extra[i], extra[i + 1], 0.8)
            steel.box(intra[i], extra[i + 1], 0.4)
            steel.box(extra[i], intra[i + 1], 0.4)
            steel.box(intra[i], extra[i], 0.45)
        # Spandrels: posts from the arch's back to the skirt every 2.6 m, braced.
        v = -Gh(skirt_bottom)
        prev = None
        while v <= Gh(skirt_bottom) + 1e-6:
            # The arch's extrados height at this v.
            tt = math.acos(max(-1.0, min(1.0, v / (R * (1 + depth / R)))))
            zt = zs + (crown - zs + depth) * math.sin(tt)
            if zt < skirt_bottom:
                a, b = ap(v, zt), ap(v, skirt_bottom)
                steel.box(a, b, 0.45)
                if prev:
                    steel.box(prev[0], b, 0.32)
                prev = (a, b)
            v += 2.6

    # The first floor's skirt on each face: a row of small arches under the frieze, the frieze of the 72
    # names (a solid band), the deck's edge.
    def ring_face(face, z, out=0.0):
        """The two ends of the skirt's line on face `face` at height z (the platform's square)."""
        h = min(W(z), 35.35) + out
        return [(P(h, -h, z), P(h, h, z)), (P(h, h, z), P(-h, h, z)), (P(-h, h, z), P(-h, -h, z)), (P(-h, -h, z), P(h, -h, z))][face]

    def along(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)

    for face in range(4):
        lo = ring_face(face, skirt_bottom, 0.4)
        mid = ring_face(face, FIRST - 4.2, 0.4)
        fr0 = ring_face(face, FIRST - 3.4, 0.6)
        fr1 = ring_face(face, FIRST - 0.9, 0.6)
        deck = ring_face(face, FIRST, 0.8)
        steel.box(*lo, 0.6)
        steel.box(*mid, 0.5)
        # The small arches: 26 a face (c001), each a half ellipse from the lower chord up to the arcade's line.
        n = 26
        for i in range(n):
            a = along(*lo, i / n)
            c = along(*lo, (i + 1) / n)
            prevp = a
            for k in range(1, 9):
                t = math.pi * k / 8
                x = (1 - math.cos(t)) / 2
                p = along(along(*lo, i / n), along(*lo, (i + 1) / n), x)
                p = (p[0], p[1], skirt_bottom + 3.2 * math.sin(t))
                steel.box(prevp, p, 0.22)
                prevp = p
            steel.box(a, along(*mid, i / n), 0.3)
            # Lattice above each arch to the arcade line.
            steel.box((a[0] + (c[0] - a[0]) / 2, a[1] + (c[1] - a[1]) / 2, skirt_bottom + 3.2), along(*mid, (i + 0.5) / n), 0.18)
            steel.box(along(*mid, i / n), (c[0], c[1], skirt_bottom + 1.0), 0.14)
        # The frieze: a solid band (the names, gilded letters on brown).
        steel.quad([fr0[0], fr0[1], fr1[1], fr1[0]], mat=3)
        steel.quad([fr1[0], fr1[1], deck[1], deck[0]], mat=2)
        # Lattice from the arcade line to the frieze.
        for i in range(n * 2):
            steel.box(along(*mid, i / (2 * n)), along(*fr0, (i + 1) / (2 * n)), 0.16)
            steel.box(along(*mid, (i + 1) / (2 * n)), along(*fr0, i / (2 * n)), 0.16)

    # The first floor's deck, its railings and the glazed pavilions (2014) along three sides.
    h1 = 35.35
    steel.quad([P(-h1, -h1, FIRST), P(h1, -h1, FIRST), P(h1, h1, FIRST), P(-h1, h1, FIRST)], mat=2)
    for face in range(4):
        a, b = ring_face(face, FIRST + 0.05, 0.6)
        a2, b2 = ring_face(face, FIRST + 2.4, 0.6)
        steel.box(a2, b2, 0.22)  # the railing's handrail
        n = 60
        for i in range(n + 1):
            steel.box(along(a, b, i / n), along(a2, b2, i / n), 0.09)
        # A pavilion: glazed, 6.5 m tall, the middle 40% of the face, set 4 m in.
        pa, pb = ring_face(face, FIRST, -4.0)
        c0, c1 = along(pa, pb, 0.3), along(pa, pb, 0.7)
        steel.quad([c0, c1, (c1[0], c1[1], c1[2] + 6.5), (c0[0], c0[1], c0[2] + 6.5)], mat=1)
        ra, rb = ring_face(face, FIRST + 6.5, -4.0)
        rc, rd = ring_face(face, FIRST + 6.5, -12.0)
        steel.quad([along(ra, rb, 0.3), along(ra, rb, 0.7), along(rc, rd, 0.7), along(rc, rd, 0.3)], mat=2)

    # The second floor: its girders, two glazed levels, railings.
    h2 = 20.48
    def sq(z, h):
        return [P(-h, -h, z), P(h, -h, z), P(h, h, z), P(-h, h, z)]
    for k in range(4):
        a, b = sq(SECOND - 4.5, h2 + 0.3)[k], sq(SECOND - 4.5, h2 + 0.3)[(k + 1) % 4]
        c, d = sq(SECOND, h2 + 0.5)[k], sq(SECOND, h2 + 0.5)[(k + 1) % 4]
        lattice_strip(steel, a, b, c, d, 0.35, 1.3)
        g0, g1 = sq(SECOND + 0.2, h2 - 1.0)[k], sq(SECOND + 0.2, h2 - 1.0)[(k + 1) % 4]
        steel.quad([g0, g1, (g1[0], g1[1], g1[2] + 3.6), (g0[0], g0[1], g0[2] + 3.6)], mat=1)
        for z, h in ((SECOND + 2.4, h2 + 0.5), (SECOND + 6.6, h2 - 0.6)):
            a2, b2 = sq(z, h)[k], sq(z, h)[(k + 1) % 4]
            steel.box(a2, b2, 0.2)
            base_a, base_b = sq(z - 2.3, h)[k], sq(z - 2.3, h)[(k + 1) % 4]
            for i in range(41):
                steel.box(along(base_a, base_b, i / 40), along(a2, b2, i / 40), 0.08)
        g0, g1 = sq(SECOND + 4.3, h2 - 2.2)[k], sq(SECOND + 4.3, h2 - 2.2)[(k + 1) % 4]
        steel.quad([g0, g1, (g1[0], g1[1], g1[2] + 2.6), (g0[0], g0[1], g0[2] + 2.6)], mat=1)
    steel.quad(sq(SECOND, h2 + 0.5), mat=2)
    steel.quad(sq(SECOND + 3.8, h2 - 1.0), mat=2)
    steel.quad(sq(SECOND + 6.9, h2 - 2.2), mat=2)
    # A lattice belt between the legs a little under the second floor (c001).
    for k in range(4):
        a, b = sq(SECOND - 15.0, W(SECOND - 15.0) - 0.4)[k], sq(SECOND - 15.0, W(SECOND - 15.0) - 0.4)[(k + 1) % 4]
        c, d = sq(SECOND - 11.0, W(SECOND - 11.0) - 0.4)[k], sq(SECOND - 11.0, W(SECOND - 11.0) - 0.4)[(k + 1) % 4]
        lattice_strip(steel, a, b, c, d, 0.5, 0.9)

    # The top: corbels out to the third floor, its glazed cabin, the open deck, the campanile, the lantern.
    zc = THIRD - 16.0
    h3 = 7.4
    for k in range(4):
        for t in [i / 8 for i in range(9)]:
            lo_ = along(sq(zc, W(zc))[k], sq(zc, W(zc))[(k + 1) % 4], t)
            hi_ = along(sq(THIRD, h3)[k], sq(THIRD, h3)[(k + 1) % 4], t)
            steel.box(lo_, hi_, 0.3)
        a, b = sq(THIRD - 1.2, h3)[k], sq(THIRD - 1.2, h3)[(k + 1) % 4]
        c, d = sq(THIRD, h3)[k], sq(THIRD, h3)[(k + 1) % 4]
        steel.quad([a, b, d, c], mat=2)
        g0, g1 = sq(THIRD, h3 - 0.3)[k], sq(THIRD, h3 - 0.3)[(k + 1) % 4]
        steel.quad([g0, g1, (g1[0], g1[1], g1[2] + 5.2), (g0[0], g0[1], g0[2] + 5.2)], mat=1)
        # Mullions on the cabin's glazing.
        for i in range(9):
            p0 = along(g0, g1, i / 8)
            steel.box(p0, (p0[0], p0[1], p0[2] + 5.2), 0.16)
        a, b = sq(THIRD + 5.2, h3 + 0.4)[k], sq(THIRD + 5.2, h3 + 0.4)[(k + 1) % 4]
        steel.quad([a, b, (b[0], b[1], b[2] + 0.6), (a[0], a[1], a[2] + 0.6)], mat=2)
        # The upper deck's railing.
        a, b = sq(THIRD + 7.4, h3 - 1.8)[k], sq(THIRD + 7.4, h3 - 1.8)[(k + 1) % 4]
        a0, b0 = sq(THIRD + 5.8, h3 - 1.8)[k], sq(THIRD + 5.8, h3 - 1.8)[(k + 1) % 4]
        steel.box(a, b, 0.14)
        for i in range(17):
            steel.box(along(a0, b0, i / 16), along(a, b, i / 16), 0.07)
    steel.quad(sq(THIRD + 5.8, h3 + 0.4), mat=2)
    # Eiffel's campanile: four lattice arches over the upper deck, a small dome.
    hc = 4.6
    zt = THIRD + 5.8
    for k in range(4):
        a, b = sq(zt, hc)[k], sq(zt, hc)[(k + 1) % 4]
        steel.box(a, (a[0], a[1], zt + 7.5), 0.45)
        prevp = (a[0], a[1], zt + 4.5)
        for i in range(1, 11):
            t = math.pi * i / 10
            p = along(a, b, (1 - math.cos(t)) / 2)
            p = (p[0], p[1], zt + 4.5 + 2.2 * math.sin(t))
            steel.box(prevp, p, 0.3)
            prevp = p
        top0, top1 = sq(zt + 7.5, hc)[k], sq(zt + 7.5, hc)[(k + 1) % 4]
        steel.box(top0, top1, 0.35)
    # The lantern (the beacon's housing, 1.8 m across) under a small dome, then the antennas' mast.
    ztop = zt + 7.5
    for i in range(12):
        t0, t1 = math.tau * i / 12, math.tau * (i + 1) / 12
        for (z_a, r_a, z_b, r_b, m) in ((ztop, 3.2, ztop + 0.8, 3.2, 2), (ztop + 0.8, 1.8, ztop + 4.0, 1.8, 1), (ztop + 4.0, 2.0, ztop + 6.0, 0.6, 2)):
            steel.quad([P(r_a * math.cos(t0), r_a * math.sin(t0), z_a), P(r_a * math.cos(t1), r_a * math.sin(t1), z_a),
                        P(r_b * math.cos(t1), r_b * math.sin(t1), z_b), P(r_b * math.cos(t0), r_b * math.sin(t0), z_b)], mat=m)
    zm = ztop + 6.0
    # The beacon's lantern, for the site's beams (skyline.py writes it to the meta).
    g['BEACON'] = P(0, 0, ztop + 2.4)
    steel.box(P(0, 0, zm), P(0, 0, 312.0), 1.3, mat=4)
    steel.box(P(0, 0, 312.0), P(0, 0, 317.5), 2.2, mat=4)
    steel.box(P(0, 0, 317.5), P(0, 0, TIP - 0.6), 0.55, mat=4)
    # Dishes and panels on the mast.
    for i in range(4):
        t = math.tau * i / 4 + 0.4
        steel.box(P(1.1 * math.cos(t), 1.1 * math.sin(t), 305.0), P(1.1 * math.cos(t), 1.1 * math.sin(t), 309.0), 0.9, mat=4)

    mats = g['eiffel_mats']
    ob = steel.build(g, 'eiffel', [mats['steel'], mats['glazing'], mats['deck'], mats['frieze'], mats['mast']])
    print(f'eiffel: {len(steel.faces):,} faces, {len(stations)} stations')

    # Red aviation lights: the mast's tip and its middle, the top's corners.
    beacons = Rods()
    for p in (P(0, 0, TIP - 0.3), P(0, 0, 316.0), P(1.2, 0, 309.5), P(-1.2, 0, 309.5)):
        beacons.box((p[0], p[1], p[2] - 0.3), (p[0], p[1], p[2] + 0.3), 0.6)
    beacons.build(g, 'eiffel_beacons', [mats['beacon']])

    # The sparkle's bulbs: 20,000 over the structure (here one per point drawn evenly over the steel's
    # faces, weighted by area, the floors' decks excluded), rendered alone in the 'spark' pass.
    spark = Rods()
    rnd = random.Random(20000)
    faces = [(f, m) for f, m in zip(steel.faces, steel.mats) if m == 0]
    picks = rnd.sample(range(len(faces)), min(20000, len(faces)))
    for i in picks:
        f, _ = faces[i]
        a, b, c = steel.verts[f[0]], steel.verts[f[1]], steel.verts[f[2]]
        u, v = rnd.random(), rnd.random()
        if u + v > 1:
            u, v = 1 - u, 1 - v
        p = tuple(a[k] + (b[k] - a[k]) * u + (c[k] - a[k]) * v for k in range(3))
        spark.box((p[0], p[1], p[2] - 0.11), (p[0], p[1], p[2] + 0.11), 0.22)
    sp = spark.build(g, 'eiffel_spark', [mats['spark']], lightgroup='city')
    sp['spark'] = 1.0
    return ob


def tower_centre(g):
    outline = g['scene_data']['landmarkOutlines'].get(EIFFEL)
    if not outline:
        return 0.0, 0.0
    ring = outline[0][:-1] if outline[0][0] == outline[0][-1] else outline[0]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def eiffel_materials(g):
    bpy = g['bpy']
    node, nodes_of, math_node, mix_colour, attr = g['node'], g['nodes_of'], g['math_node'], g['mix_colour'], g['attr']
    from nodekit import add_shaders, gain_value, output

    def steel_mat():
        """The painted steel by day; by night the golden lighting from within: each member glowing gold, the
        inner faces and the floors' undersides brightest, varying a little along the tower (the projectors' pools)."""
        mat = bpy.data.materials.new('eiffel_steel')
        nt = nodes_of(mat)
        L = nt.links
        tc = node(nt, 'ShaderNodeTexCoord')
        sep = node(nt, 'ShaderNodeSeparateXYZ')
        L.new(tc.outputs['Object'], sep.inputs[0])
        zr = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 300.0})
        L.new(sep.outputs['Z'], zr.inputs['Value'])
        col = mix_colour(nt, zr.outputs['Result'], EIFFEL_BROWN[0], EIFFEL_BROWN[1])
        n = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=0.6, Detail=3.0)
        L.new(tc.outputs['Object'], n.inputs['Vector'])
        col = mix_colour(nt, 1.0, col, g['grey_of'](nt, math_node(nt, 'MULTIPLY_ADD', n.outputs['Fac'], 0.3, 0.85)), 'MULTIPLY')
        b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.55)
        L.new(col, b.inputs['Base Color'])
        b.inputs['Metallic'].default_value = 0.15
        # Gold: high-pressure sodium, about 2100 K, a little desaturated by the steel's brown.
        e = node(nt, 'ShaderNodeEmission', Strength=1.0, Color=(1.0, 0.46, 0.1, 1))
        pools = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=0.05, Detail=2.0)
        L.new(tc.outputs['Object'], pools.inputs['Vector'])
        level = math_node(nt, 'MULTIPLY_ADD', pools.outputs['Fac'], 0.8, 0.6)
        # The projectors stand inside the tower, aimed out and up: the steel facing its axis is lit full, the
        # outer faces only by what spills (a quarter). From the Trocadéro the far legs' inner faces glow
        # through the near legs' lattice, which reads against them (ref c021), not as one gold silhouette.
        cx, cy = tower_centre(g)
        geo = node(nt, 'ShaderNodeNewGeometry')
        pos = node(nt, 'ShaderNodeSeparateXYZ')
        L.new(geo.outputs['Position'], pos.inputs[0])
        nrm = node(nt, 'ShaderNodeSeparateXYZ')
        L.new(geo.outputs['Normal'], nrm.inputs[0])
        dx = math_node(nt, 'SUBTRACT', cx, pos.outputs['X'])
        dy = math_node(nt, 'SUBTRACT', cy, pos.outputs['Y'])
        dist = math_node(nt, 'MAXIMUM', math_node(nt, 'SQRT', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', dx, dx), math_node(nt, 'MULTIPLY', dy, dy))), 0.5)
        inward = math_node(nt, 'DIVIDE', math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', nrm.outputs['X'], dx), math_node(nt, 'MULTIPLY', nrm.outputs['Y'], dy)), dist)
        inward = math_node(nt, 'MAXIMUM', inward, math_node(nt, 'MULTIPLY', nrm.outputs['Z'], -0.8))  # undersides: lit from below
        facing = math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'POWER', math_node(nt, 'MAXIMUM', inward, 0.0), 1.5), 1.1, 0.25)
        level = math_node(nt, 'MULTIPLY', level, facing)
        gain = gain_value(nt, 'tower_gain')
        L.new(math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', level, gain), g['SITE'].get('eiffel_gold', 2.6)), e.inputs['Strength'])
        output(nt, add_shaders(nt, b.outputs[0], e.outputs[0]))
        return mat

    def lit(name, base, glow, strength, rough=0.3, metallic=0.0, coat=False):
        mat = bpy.data.materials.new(name)
        nt = nodes_of(mat)
        b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=rough, Metallic=metallic, **{'Base Color': (*base, 1)})
        if coat:
            b.inputs['Coat Weight'].default_value = 1.0
            b.inputs['Coat IOR'].default_value = 1.6
            b.inputs['Coat Roughness'].default_value = 0.05
        e = node(nt, 'ShaderNodeEmission', Strength=1.0, Color=(*glow, 1))
        gain = gain_value(nt, 'tower_gain')
        nt.links.new(math_node(nt, 'MULTIPLY', gain, strength), e.inputs['Strength'])
        output(nt, add_shaders(nt, b.outputs[0], e.outputs[0]))
        return mat

    def jet_mat():
        """A fountain's jet: white water and spray, half see-through, lit from below after dark (white)."""
        mat = bpy.data.materials.new('fountain_jet')
        nt = nodes_of(mat)
        b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.35, **{'Base Color': (0.75, 0.8, 0.82, 1)})
        b.inputs['Transmission Weight'].default_value = 0.4
        tr = node(nt, 'ShaderNodeBsdfTransparent')
        mix = node(nt, 'ShaderNodeMixShader', Fac=0.55)
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(b.outputs[0], mix.inputs[2])
        e = node(nt, 'ShaderNodeEmission', Strength=6.0, Color=(0.85, 0.92, 1.0, 1))
        output(nt, add_shaders(nt, mix.outputs[0], e.outputs[0]))
        return mat

    def spark_mat():
        """The sparkle's bulbs: white xenon flashes, off in every render but the 'spark' pass."""
        mat = bpy.data.materials.new('eiffel_spark')
        nt = nodes_of(mat)
        e = node(nt, 'ShaderNodeEmission', Strength=1.0, Color=(0.9, 0.95, 1.0, 1))
        gain = gain_value(nt, 'spark_gain')
        gain.node.outputs[0].default_value = 0.0
        nt.links.new(math_node(nt, 'MULTIPLY', gain, 400.0), e.inputs['Strength'])
        tr = node(nt, 'ShaderNodeBsdfTransparent')
        mix = node(nt, 'ShaderNodeMixShader')
        # Unseen by day and by every other pass: a bulb's glass is tiny beside the steel. Seen by the camera
        # only: a flash lights nothing else in its instant (lit by them, the gardens 600 m off glittered).
        cam = node(nt, 'ShaderNodeLightPath').outputs['Is Camera Ray']
        nt.links.new(math_node(nt, 'MULTIPLY', math_node(nt, 'MINIMUM', gain, 1.0), cam), mix.inputs['Fac'])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(e.outputs[0], mix.inputs[2])
        output(nt, mix.outputs[0])
        return mat

    return {
        'steel': steel_mat(),
        'glazing': lit('eiffel_glazing', (0.03, 0.035, 0.04), (1.0, 0.86, 0.66), 7.0, rough=0.08, coat=True),
        'deck': lit('eiffel_deck', (0.07, 0.055, 0.04), (1.0, 0.62, 0.25), 2.0, rough=0.7),
        'frieze': lit('eiffel_frieze', (0.1, 0.075, 0.05), (1.0, 0.62, 0.22), 5.0, rough=0.6),
        'mast': lit('eiffel_mast', (0.45, 0.45, 0.45), (1.0, 0.85, 0.65), 2.5, rough=0.5),
        'beacon': g['emission_material']('eiffel_beacon', (1.0, 0.08, 0.03), 80.0, base=(0.3, 0.05, 0.04)),
        'spark': spark_mat(),
        'stone': g['simple_material']('iena_stone', PARIS_STONE, 0.85),
        'road': g['simple_material']('iena_road', (0.04, 0.04, 0.042), 0.5),
        'pavement': g['simple_material']('iena_pavement', (0.26, 0.24, 0.21), 0.7),
        'marking': g['simple_material']('iena_marking', (0.6, 0.6, 0.58), 0.6),
        'statue': g['simple_material']('iena_statue', (0.12, 0.12, 0.11), 0.7),
        'yew': g['simple_material']('yew', (0.012, 0.028, 0.012), 0.85),
        'jet': jet_mat(),
    }


# ---- The Trocadéro's gardens and the Pont d'Iéna -------------------------------------------------------

BASIN = 'way/79738429'   # the Warsaw fountains' basin (Fontaine de Varsovie, 1937)
IENA = 'way/184263889'   # the Pont d'Iéna's outline (man_made=bridge)
REPLACES = {IENA}


def oriented_box(ring):
    """The ring's minimum-area box: centre, unit long axis, half length, half width."""
    best = None
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6:
            continue
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        a = [x * ux + y * uy for x, y in pts]
        b = [-x * uy + y * ux for x, y in pts]
        area = (max(a) - min(a)) * (max(b) - min(b))
        if best is None or area < best[0]:
            ca, cb = (max(a) + min(a)) / 2, (max(b) + min(b)) / 2
            c = (ca * ux - cb * uy, ca * uy + cb * ux)
            la, lb = (max(a) - min(a)) / 2, (max(b) - min(b)) / 2
            best = (area, c, (ux, uy) if la >= lb else (-uy, ux), max(la, lb), min(la, lb))
    return best[1:]


def gardens(g):
    """The basin's jets (in leaf: the fountains run from April to October; ref c031: two rows of vertical
    jets along its long sides, white plumes 5 to 9 m), and the clipped yews in cones along its lawns."""
    sd = g['scene_data']
    basin = next((w for w in sd['water'] if w['id'] == BASIN), None)
    at = g.get('GROUND_AT')
    if not basin or not at:
        return
    c, u, hl, hw = oriented_box(basin['outer'][0])
    v = (-u[1], u[0])
    level = g['SITE']['water']
    rnd = random.Random(1937)
    mats = g['eiffel_mats']
    if g['SEASON'] == 'leaf':
        jets = Rods()
        # Every water body at the basin's level (OSM maps its side channels apart): jets only where they stand
        # in water, in rows 2 m in from each long side.
        live = [w for w in sd['water'] if w['id'] == BASIN or w['id'] in g.get('LIVE_WATER_IDS', ())]
        inside = g['inside']
        wet = lambda p: any(inside(r, p) for w in live for r in w['outer'])  # noqa: E731
        for side in (-1, 1):
          for off in (2.0, 5.5, 9.0, 12.5, 16.0):
            t = -hl + 4.0
            while t < hl - 3.0:
                p = (c[0] + u[0] * t + v[0] * side * (hw - off), c[1] + u[1] * t + v[1] * side * (hw - off))
                t += rnd.uniform(7.5, 9.0)
                if not wet(p):
                    continue
                h = rnd.uniform(7.0, 11.0)
                # A column narrowing then spreading into its crown, in four stacked frusta of eight sides.
                prof = [(0.0, 0.16), (h * 0.6, 0.22), (h * 0.88, 0.42), (h, 0.7), (h + 0.9, 0.0)]
                for (z0, r0), (z1, r1) in zip(prof, prof[1:]):
                    n0 = len(jets.verts)
                    for k in range(8):
                        a = math.tau * k / 8
                        jets.verts.append((p[0] + r0 * math.cos(a), p[1] + r0 * math.sin(a), level + z0))
                    for k in range(8):
                        a = math.tau * k / 8
                        jets.verts.append((p[0] + r1 * math.cos(a), p[1] + r1 * math.sin(a), level + z1))
                    for k in range(8):
                        j = (k + 1) % 8
                        jets.faces.append((n0 + k, n0 + j, n0 + 8 + j, n0 + 8 + k))
                        jets.mats.append(0)
        jets.build(g, 'fountain_jets', [mats['jet']])
    # Clipped yews along the basin's lawns, every 7 m, 3 m tall.
    yews = Rods()
    for side in (-1, 1):
        t = -hl + 3.0
        while t < hl - 3.0:
            p = (c[0] + u[0] * t + v[0] * side * (hw + 3.5), c[1] + u[1] * t + v[1] * side * (hw + 3.5))
            z = at(*p)
            if z is not None:
                n0 = len(yews.verts)
                for k in range(8):
                    a = math.tau * k / 8
                    yews.verts.append((p[0] + 0.75 * math.cos(a), p[1] + 0.75 * math.sin(a), z))
                yews.verts.append((p[0], p[1], z + 3.2))
                for k in range(8):
                    yews.faces.append((n0 + k, n0 + (k + 1) % 8, n0 + 8))
                    yews.mats.append(0)
            t += 7.0
    yews.build(g, 'yews', [mats['yew']], lightgroup=None)


def iena(g):
    """The Pont d'Iéna (1814, widened 1937): five segmental stone arches of 28 m across the Seine on the
    Chaillot-Champ de Mars axis, 35 m wide, its deck level with the quays; piers with their cutwaters, a
    stone parapet, lamps along it; at its ends, on tall pedestals, the four equestrian groups (a Gaul, an
    Arab, a Roman and a Greek warrior, 1853), dark against the tower in ref c001."""
    sd = g['scene_data']
    br = next((b for b in sd['bridges'] if b['id'] == IENA), None)
    at = g.get('GROUND_AT')
    if not br or not at:
        print('iena: no outline')
        return
    c, u, hl, hw = oriented_box(br['pts'])
    v = (-u[1], u[0])
    ends = [at(c[0] + u[0] * k * (hl + 6), c[1] + u[1] * k * (hl + 6)) for k in (-1, 1)]
    deck = max(e for e in ends if e is not None) + 0.4
    water = 0.0  # the Seine
    stone = Rods()
    def P(t, s, z):
        return (c[0] + u[0] * t + v[0] * s, c[1] + u[1] * t + v[1] * s, z)
    spans = 5
    span = 2 * hl / spans
    pier = 3.6
    rise = 5.2
    spring = water + 1.2
    # The deck: its roadway (asphalt, lane lines) between two broad pavements of pale stone, and the parapets.
    walk = 7.0
    stone.quad([P(-hl, -hw + walk, deck), P(hl, -hw + walk, deck), P(hl, hw - walk, deck), P(-hl, hw - walk, deck)], mat=1)
    for side in (-1, 1):
        a, b = sorted((side * hw, side * (hw - walk)))
        stone.quad([P(-hl, a, deck + 0.15), P(hl, a, deck + 0.15), P(hl, b, deck + 0.15), P(-hl, b, deck + 0.15)], mat=2)
    lanes = 6
    for k in range(1, lanes):
        sv = -hw + walk + (2 * hw - 2 * walk) * k / lanes
        t = -hl
        while t < hl - 3:
            stone.quad([P(t, sv - 0.08, deck + 0.02), P(t + 3, sv - 0.08, deck + 0.02), P(t + 3, sv + 0.08, deck + 0.02), P(t, sv + 0.08, deck + 0.02)], mat=3)
            t += 3 if k == lanes // 2 else 9
    for side in (-1, 1):
        stone.box(P(-hl, side * (hw - 0.3), deck), P(hl, side * (hw - 0.3), deck), 0.6, 2.4, up=(0, 0, 1))
        stone.box(P(-hl, side * (hw - 0.3), deck + 1.0), P(hl, side * (hw - 0.3), deck + 1.0), 0.7, 0.25)
    for i in range(spans):
        t0 = -hl + i * span + pier / 2
        t1 = -hl + (i + 1) * span - pier / 2
        n = 16
        pts = []
        for k in range(n + 1):
            a = math.pi * k / n
            t = (t0 + t1) / 2 - math.cos(a) * (t1 - t0) / 2
            pts.append((t, spring + rise * math.sin(a)))
        # The vault (its underside) and the two faces: the spandrel from the arch up to the deck.
        for (ta, za), (tb, zb) in zip(pts, pts[1:]):
            stone.quad([P(ta, -hw, za), P(tb, -hw, zb), P(tb, hw, zb), P(ta, hw, za)], mat=0)
            for side in (-1, 1):
                q = [P(ta, side * hw, za), P(tb, side * hw, zb), P(tb, side * hw, deck), P(ta, side * hw, deck)]
                stone.quad(q if side < 0 else q[::-1], mat=0)
        # The arch's voussoir ring standing a little proud on each face.
        for side in (-1, 1):
            for (ta, za), (tb, zb) in zip(pts, pts[1:]):
                stone.box(P(ta, side * (hw + 0.15), za + 0.4), P(tb, side * (hw + 0.15), zb + 0.4), 0.3, 0.9)
    # The piers, with pointed cutwaters, from below the water to the springing.
    for i in range(1, spans):
        t = -hl + i * span
        for side in (-1, 1):
            stone.quad([P(t - pier / 2, side * hw, water - 2), P(t + pier / 2, side * hw, water - 2), P(t + pier / 2, side * hw, spring), P(t - pier / 2, side * hw, spring)][::(1 if side > 0 else -1)], mat=0)
        stone.box(P(t, -hw - 2.5, water - 2), P(t, hw + 2.5, water - 2), pier, 0.1)
        stone.box(P(t, -hw - 1.2, (water + spring + 2.5) / 2), P(t, hw + 1.2, (water + spring + 2.5) / 2), pier * 0.9, spring + 2.5 - water + 2)
        # The imperial eagle's plinth on each cutwater (the eagles themselves too small to tell here).
        for side in (-1, 1):
            stone.box(P(t, side * (hw + 1.0), deck - 4.0), P(t, side * (hw + 1.0), deck + 1.2), 1.4, 1.4)
    # The four groups on their pedestals at the bridge's ends, a little out from the parapets.
    statues = Rods()
    for k in (-1, 1):
        for side in (-1, 1):
            t = k * (hl + 3.0)
            s_ = side * (hw - 2.0)
            z = at(*P(t, s_, 0)[:2]) or deck
            stone.box(P(t, s_, z), P(t, s_, z + 5.5), 3.2, 6.0, up=(u[0], u[1], 0))
            # Horse and rider, dark bronze-green stone: a body, legs, neck and head, the rider over it.
            zb = z + 5.5
            statues.box(P(t, s_ - 1.6, zb + 1.9), P(t, s_ + 1.6, zb + 2.0), 1.2, 1.4)
            for dl in (-1.2, 1.2):
                for dt in (-0.35, 0.35):
                    statues.box(P(t + dt, s_ + dl, zb), P(t + dt, s_ + dl, zb + 1.5), 0.3)
            statues.box(P(t, s_ - side * 1.7, zb + 2.2), P(t, s_ - side * 2.4, zb + 3.6), 0.6, 0.9)
            statues.box(P(t, s_ + 0.2, zb + 2.5), P(t, s_ + 0.1, zb + 4.2), 0.8, 0.6)
    # Lamps along both parapets, every 16 m (lit warm).
    lamps = sd['lamps']
    tt = -hl + 4
    while tt < hl:
        for side in (-1, 1):
            x, y, _ = P(tt, side * (hw - 0.9), 0)
            lamps.append({'at': [x, y], 'base': deck, 'colour': None, 'count': 1})
        tt += 16.0
    mats = g['eiffel_mats']
    stone.build(g, 'iena', [mats['stone'], mats['road'], mats['pavement'], mats['marking']], lightgroup='city')
    statues.build(g, 'iena_statues', [mats['statue']], lightgroup=None)
    print(f'iena: deck z {deck:.2f}, {2 * hl:.0f} m by {2 * hw:.0f} m')


def road_lamps(g):
    """Paris's main roads are lit both sides about every 28 m (its candelabra and lanterns); OpenStreetMap maps
    a few (ref c096 shows unbroken rows along the Avenue de New York and the Place de Varsovie). Within 900 m,
    on roads 9 m wide or more, 1.5 m outside each kerb, none within 12 m of a mapped lamp."""
    sd = g['scene_data']
    ground = sd.get('ground') or {}
    at = g.get('GROUND_AT')
    lamps = sd['lamps']
    have = [tuple(l['at']) for l in lamps]
    cell = {}
    for p in have:
        cell.setdefault((int(p[0] // 12), int(p[1] // 12)), []).append(p)

    def near(p):
        cx, cy = int(p[0] // 12), int(p[1] // 12)
        return any(math.dist(p, q) < 12 for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in cell.get((cx + dx, cy + dy), ()))
    added = 0
    for ln in ground.get('lines', []):
        if not ln.get('road') or ln['width'] < 9:
            continue
        pts = ln['pts']
        walked = 14.0
        for i in range(1, len(pts)):
            (ax, ay), (bx, by) = pts[i - 1], pts[i]
            L = math.hypot(bx - ax, by - ay)
            while walked < L:
                t = walked / L
                x, y = ax + (bx - ax) * t, ay + (by - ay) * t
                if math.hypot(x, y) < 900:
                    nx, ny = -(by - ay) / L, (bx - ax) / L
                    for side in (-1, 1):
                        p = (x + nx * side * (ln['width'] / 2 + 1.5), y + ny * side * (ln['width'] / 2 + 1.5))
                        if not near(p):
                            z = at(*p) if at else None
                            lamps.append({'at': list(p), 'base': z if z is not None else 0.0, 'colour': None, 'count': 1})
                            cell.setdefault((int(p[0] // 12), int(p[1] // 12)), []).append(p)
                            added += 1
                walked += 28.0
            walked -= L
    print(f'road lamps: {added} added along the main roads')


def build(g):
    g['eiffel_mats'] = eiffel_materials(g)
    eiffel(g)
    iena(g)
    gardens(g)
    road_lamps(g)
