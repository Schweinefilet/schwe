"""The city's ordinary buildings for scripts/blender/skyline.py: each OpenStreetMap building (or part)
raised on its own outline, given a wall colour and facade from what OSM says of it, and a massing from a
small set of archetypes, so the skyline is not a field of plain extruded boxes:

  osm        a part of a building OSM maps in 3D parts: raised as mapped, the parts give the massing
  lowrise    older low-rise (Victorian and Georgian terraces, mansion blocks, listed stone): a cornice
             at the eaves, and where OSM gives no roof shape, a pitched slate roof (hipped or mansard)
  block      mid-rise offices and flats, straight up
  penthouse  mid-rise with its top floor set back
  setback    a tower stepping in once or twice near its top
  podium     a tower on a podium of a few floors that fills the outline
  slab       a long slab block (2.2:1 or more)
  glass      a curtain-wall tower, its glass carried up past the roof as a screen; in New York some with
             their corners chamfered (the footprint's shape, not only its height, varies)
  wedding    New York: a pre-war masonry tower stepped back two to four times by the 1916 zoning
             envelope, a cornice at each setback, a third under a pyramid
  loft       New York: a pre-war mid-rise (lofts, walk-ups, old offices) to 70 m, straight up under a
             heavy cornice, water tanks on the roof (roofs.py)

New York (SITE 'archetypes': 'new-york'): its own palettes (limestone, buff and red brick, brownstone,
white terracotta; white and grey concrete, dark steel), flat roofs (no pitched slate) behind cornices, and a
roof OSM tags flat is no reason to keep OSM's plain massing (nearly every outline here is tagged flat).

The real outlines and heights stay (the archetypes shape a building's profile within its outline: the
city's footprints and height distribution are OSM's). Every building is one set of faces in one merged
mesh (MeshBuilder), with per-face attributes for the facade shader (facade.py).

setup(g) takes skyline.py's globals (SITE, rng, FLOODLIT, the landmark module's hooks, MeshBuilder, ...).
"""

import math
import random

import roofs
from shapes import chamfer, inset, oriented_size, signed_area as area_of

G = {}


def setup(g):
    G.update(g)
    roofs.setup(g)


# ---- OSM colours and materials → linear albedo -------------------------------------------------------

NAMED = {
    'brown': (0.20, 0.11, 0.07), 'light_brown': (0.36, 0.25, 0.16), 'white': (0.62, 0.61, 0.57), 'gray': (0.30, 0.30, 0.29),
    'grey': (0.30, 0.30, 0.29), 'lightgrey': (0.45, 0.45, 0.43), 'darkgrey': (0.12, 0.12, 0.12), 'red': (0.30, 0.09, 0.06),
    'beige': (0.52, 0.45, 0.34), 'black': (0.03, 0.03, 0.03), 'yellow': (0.55, 0.45, 0.2), 'cream': (0.62, 0.56, 0.44),
}
MATERIAL_ALBEDO = {
    # Weathered, not quarried: Portland stone greys and blackens in London's air.
    'brick': (0.21, 0.13, 0.09), 'stone': (0.40, 0.37, 0.31), 'sandstone': (0.38, 0.30, 0.20), 'plaster': (0.50, 0.48, 0.44),
    'concrete': (0.30, 0.29, 0.27), 'glass': (0.10, 0.11, 0.12), 'metal': (0.28, 0.29, 0.30), 'wood': (0.2, 0.13, 0.08),
}
LONDON_BRICK = [(0.24, 0.19, 0.13), (0.21, 0.17, 0.12), (0.19, 0.09, 0.06), (0.16, 0.08, 0.055)]  # yellow stock, red
# New York's (linear albedo, weathered): Indiana limestone, buff and tan brick, red brick, brownstone, white
# glazed terracotta; its post-war white and grey concrete, dark steel, and the brown brick of the housing
# towers by the bridge.
LIMESTONE, BUFF, TAN, NY_RED, BROWNSTONE, TERRACOTTA = ((0.4, 0.37, 0.31), (0.36, 0.3, 0.21), (0.27, 0.2, 0.135), (0.19, 0.095, 0.065),
                                                        (0.13, 0.08, 0.06), (0.47, 0.45, 0.39))
NY_PALETTES = {
    'prewar': ((LIMESTONE, 0.3), (BUFF, 0.25), (TAN, 0.2), (NY_RED, 0.15), (TERRACOTTA, 0.1)),
    'homes': ((NY_RED, 0.45), (BROWNSTONE, 0.25), (TAN, 0.2), (BUFF, 0.1)),
    'brick': ((NY_RED, 0.4), (TAN, 0.3), (BUFF, 0.2), (BROWNSTONE, 0.1)),
    'modern': (((0.45, 0.44, 0.41), 0.35), ((0.3, 0.3, 0.29), 0.3), ((0.06, 0.06, 0.065), 0.2), ((0.17, 0.09, 0.065), 0.15)),
}


def masonry_saturation(c):
    """How much of an OSM colour's saturation a New York wall keeps: warm masonry hues (brick red through
    limestone buff, 5 to 60 degrees) most of it; the pale greens, pinks and blues mappers pick, which no wall
    here is, little. (Cutting every colour to 0.3, tried first, turned the city's tan stone grey.)"""
    import colorsys
    h, _, _ = colorsys.rgb_to_hls(*c)
    return 0.65 if 5 / 360 <= h <= 60 / 360 else 0.3


# A New York curtain wall's glass (its spandrels' and mullions' colour, dark; facade.py tints the panes and
# their reflections by its hue): teal, blue, bronze, silver and black, as across set2's towers.
NY_GLASS = (((0.035, 0.06, 0.06), 0.2), ((0.03, 0.042, 0.068), 0.2), ((0.06, 0.045, 0.03), 0.15), ((0.09, 0.09, 0.095), 0.25),
            ((0.02, 0.02, 0.022), 0.2))


def ny():
    return G['SITE'].get('archetypes') == 'new-york' and G['UPTO'] >= 2


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def desaturate(c, k=0.55):
    # OSM colours are picked from a palette, far more saturated than weathered stone or brick.
    grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return tuple(grey + (x - grey) * k for x in c)


# Wall colours by archetype where OSM gives neither colour nor material (linear albedo, weathered), with
# their shares: London's older low-rise is yellow stock and red brick, white and cream stucco, Portland
# stone; its post-war mid-rise concrete, stone cladding, brick and dark panels.
STOCK, RED, STUCCO, PORTLAND = (0.23, 0.18, 0.125), (0.18, 0.085, 0.06), (0.5, 0.48, 0.43), (0.4, 0.37, 0.31)
PALETTES = {
    'lowrise homes': ((STOCK, 0.4), (RED, 0.2), (STUCCO, 0.25), (PORTLAND, 0.15)),
    'lowrise': ((PORTLAND, 0.4), (STOCK, 0.35), (STUCCO, 0.15), (RED, 0.1)),
    'block': (((0.3, 0.29, 0.27), 0.4), ((0.36, 0.34, 0.29), 0.3), ((0.2, 0.15, 0.11), 0.2), ((0.15, 0.15, 0.16), 0.1)),
}


def pick(rng, palette):
    t = rng.random()
    for col, share in palette:
        t -= share
        if t <= 0:
            return col
    return palette[-1][0]


def jitter(rng, col):
    """Each building a little lighter or darker (15%) and a little warmer or cooler (5%) than its base."""
    v = rng.uniform(0.85, 1.15)
    w = rng.uniform(-0.05, 0.05)
    return tuple(max(0.01, c * v * k) for c, k in zip(col, (1 + w, 1.0, 1 - w)))


def albedo(b, kind=None):
    """Weathered wall colour (linear). OSM colours are picked from a palette, lighter and purer than
    stone or brick after a century of London air: scaled down and desaturated. Without a colour or
    material, the archetype's palette (PALETTES)."""
    rng = G['rng']
    col = b.get('colour')
    if col and col.startswith('#') and len(col) == 7:
        c = tuple(min(srgb_to_linear(int(col[i:i + 2], 16) / 255) * 0.6, 0.45) for i in (1, 3, 5))
        return desaturate(c, masonry_saturation(c) if ny() and G['UPTO'] >= 5 else 0.5)
    if col in NAMED:
        return desaturate(tuple(c * 0.8 for c in NAMED[col]), 0.7)
    if b.get('material') == 'brick':
        return pick(rng, NY_PALETTES['brick']) if ny() else rng.choice(LONDON_BRICK)
    if b.get('material') in MATERIAL_ALBEDO:
        return MATERIAL_ALBEDO[b['material']]
    if ny():
        use = b.get('kind', 'yes')
        if use in HOMES:
            return pick(rng, NY_PALETTES['homes'])
        return pick(rng, NY_PALETTES['prewar' if kind in ('lowrise', 'loft', 'wedding') else 'modern'])
    # London's defaults: brick houses, Portland stone for the grand and civic; by archetype otherwise.
    use = b.get('kind', 'yes')
    if use in ('government', 'civic', 'public', 'church', 'cathedral', 'museum', 'hotel') or b.get('listed'):
        return MATERIAL_ALBEDO['stone']
    homes = use in ('house', 'residential', 'apartments', 'terrace')
    if kind == 'lowrise':
        return pick(rng, PALETTES['lowrise homes' if homes else 'lowrise'])
    if homes:
        return rng.choice(LONDON_BRICK)
    if kind in ('block', 'penthouse', 'slab'):
        return pick(rng, PALETTES['block'])
    return (0.3, 0.29, 0.27)


def material_from_colour(colour):
    """A wall material guessed from OSM's colour where no material is mapped: light and warm (sandy, beige,
    cream, pale grey-tan) stone; darker, red-brown brick; anything else None (glass and metal)."""
    named = {'beige': 'stone', 'cream': 'stone', 'brown': 'brick', 'red': 'brick', 'white': 'stone', 'tan': 'stone'}
    if not colour:
        return None
    if colour in named:
        return named[colour]
    if not (colour.startswith('#') and len(colour) == 7):
        return None
    r, g, bl = (int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl
    if r - bl > 0.04 and max(r, g, bl) - min(r, g, bl) < 0.3 and lum > 0.45:
        return 'stone'
    if r - bl > 0.08 and r > g and lum <= 0.45:
        return 'brick'
    return None


HOMES = ('house', 'residential', 'apartments', 'terrace', 'dormitory', 'flats')
GRAND = ('government', 'civic', 'public', 'church', 'cathedral', 'chapel', 'museum', 'palace', 'castle', 'hotel', 'university')


def facade_params(b, area):
    """Style, bay width, floor height, window half width and height (fractions of the cell), frame
    lightness, night busyness: from what OSM says of the building."""
    rng, SITE = G['rng'], G['SITE']
    kind = b.get('kind', 'yes')
    within = (b.get('within') or {}).get('kind')
    mat = b.get('material')
    if mat in ('limestone', 'marble', 'granite', 'masonry'):
        mat = 'stone'
    if mat is None and SITE.get('facade', {}).get('colour_material'):
        mat = material_from_colour(b.get('colour'))
    span = b['height'] - b['min']
    homes = kind in HOMES or within in HOMES
    # The evening's lit share, about 18% across the city (the user's choice, 2026-09-29), homes more; a
    # city's own where SITE gives one (offices; homes alike).
    if 'busy' in SITE:
        busy = rng.uniform(*SITE['busy'])
    else:
        busy = rng.uniform(0.06, 0.34) if homes else rng.uniform(0.03, 0.3)
    # Turrets, pinnacles, spires, chimneys, and roofs mapped as parts: no windows.
    if area < 30 or kind in ('roof', 'chimney', 'spire', 'pinnacle') or (b['min'] > 0 and span < 5):
        return 3, 3.0, 3.0, 0, 0, 0.3, 0.0
    grand = kind in GRAND or within in GRAND or b.get('listed')
    # New York's tall towers OSM says nothing of: 60% curtain walls, the rest offices in concrete, steel or brick.
    unknown_ok = not (ny() and G['UPTO'] >= 5 and mat is None and not b.get('colour') and random.Random(b['id'] + ' glass').random() > 0.6)
    if mat == 'glass' or (b['height'] >= 60 and mat not in ('brick', 'stone', 'sandstone') and not grand and unknown_ok):
        # Curtain wall: glass floor to ceiling between thin mullions, a dark spandrel at each floor.
        return 0, rng.uniform(1.35, 1.8), rng.uniform(3.6, 4.2), SITE.get('facade', {}).get('curtain_w', 0.47), rng.uniform(0.36, 0.42), 0.06, busy
    if grand and mat not in ('glass', 'concrete'):
        # Masonry: tall narrow windows in wide bays, high floors; gothic and classical alike at this range.
        return 2, rng.uniform(2.4, 3.4), rng.uniform(4.2, 5.4), rng.uniform(0.15, 0.21), rng.uniform(0.3, 0.36), 0.28, busy * 0.6
    if homes or mat == 'brick':
        # Sash windows, white-painted frames.
        return 1, rng.uniform(2.6, 3.3), rng.uniform(2.9, 3.3), rng.uniform(0.2, 0.26), rng.uniform(0.27, 0.33), rng.uniform(0.5, 0.7), busy
    # New York's mid-century offices: a third in ribbon windows, glass the bay's full width between thin
    # mullions, a floor's windows one band (facade.py: the window's frame and its centre bar are the mullions).
    own = random.Random(b['id'] + ' facade')  # its own draw: the shared sequence (every later colour) stays put
    if SITE.get('facade', {}).get('ribbon') and G['UPTO'] >= 4 and own.random() < SITE['facade']['ribbon']:
        return 1, own.uniform(1.4, 1.9), own.uniform(3.6, 4.0), 0.48, own.uniform(0.27, 0.33), own.uniform(0.04, 0.1), busy
    # Offices and shops: wider windows, dark frames.
    return 1, rng.uniform(2.2, 3.0), rng.uniform(3.5, 4.0), rng.uniform(0.28, 0.38), rng.uniform(0.28, 0.34), rng.uniform(0.04, 0.12), busy


FACADE_ATTRS = ('wall', 'style', 'bay', 'floorh', 'win_w', 'win_h', 'frame', 'busy', 'seed', 'roofc', 'flood', 'run_l', 'run_b', 'glass_ior')


def facade_runs(style):
    """How a building's windows go together (SITE['facade'], where the city gives it): lit floors in runs of
    bays, blinds in runs, curtain-wall glass's coating. A city without it: each window its own, clear glass."""
    rng, f = G['rng'], G['SITE'].get('facade')
    if not f or style > 1:
        return dict(run_l=1.0, run_b=1.0, glass_ior=0.0)
    return dict(run_l=float(rng.randint(*f.get('lit_run', (1, 1)))), run_b=float(rng.randint(*f.get('blind_run', (1, 1)))),
                glass_ior=rng.uniform(*f['glass_ior']) if style == 0 and 'glass_ior' in f else 0.0)


# ---- Archetypes ---------------------------------------------------------------------------------------

BEACONS = []  # (x, y, z) of the aviation lights, built as one object by build_city
ARCHETYPES = ('osm', 'lowrise', 'block', 'penthouse', 'setback', 'podium', 'slab', 'glass', 'wedding', 'loft')
COUNTS = {a: 0 for a in ARCHETYPES}


def older(b, h, area, style, r):
    """Pre-war London low-rise: homes, brick or stone, listed or grand; or an unnamed small building of
    the old grain (OSM says nothing more of most of them), half of them."""
    kind = b.get('kind', 'yes')
    if kind in HOMES or kind in GRAND or b.get('listed') or b.get('material') in ('brick', 'stone', 'sandstone') or b.get('architecture'):
        return True
    return style != 0 and kind == 'yes' and h <= 25 and area < 900 and r < 0.5


def older_ny(b, style, r):
    """New York's pre-war masonry: brick or stone (mapped, or guessed from the colour), listed, or of no
    known material and not a curtain wall, about half of them."""
    mat = b.get('material') or material_from_colour(b.get('colour'))
    if mat in ('brick', 'stone', 'sandstone', 'limestone', 'granite', 'masonry') or b.get('listed') or b.get('architecture'):
        return True
    return style != 0 and mat not in ('glass', 'metal', 'concrete') and r < 0.5


def archetype(b, ring, style, r):
    """The building's archetype, from its OSM outline, height and kind (see the module's doc)."""
    h = b['height'] - b['min']
    tagged = b['roof']['tagged'] and not (ny() and b['roof']['shape'] == 'flat')
    single = not b.get('within') and b['min'] == 0 and not b['inner'] and not tagged
    if not single or G['UPTO'] < 2:
        return 'osm'
    area = abs(area_of(ring))
    short, long_ = oriented_size(ring)
    if ny():
        old = older_ny(b, style, r)
        if h >= 50 and old and short >= 16:
            return 'wedding'
        if h <= 25 and old:
            return 'lowrise'
        if h <= 70 and old:
            return 'loft'
    if h >= 50:
        if area >= 1400 and short >= 28:
            return 'podium'
        if short > 0 and long_ / short >= 2.2:
            return 'slab'
        if style == 0:
            return 'glass'
        return 'setback'
    if h <= 28 and older(b, h, area, style, r):
        return 'lowrise'
    if 18 <= h and r < 0.35 and short >= 12:
        return 'penthouse'
    return 'block'


def tiers_for(kind, ring, z0, zw, r2):
    """The massing as tiers [(outline, bottom, top), ...], each set within the one below. `r2` a uniform
    draw of the building's own."""
    h = zw - z0
    if kind == 'podium':
        short, _ = oriented_size(ring)
        zp = z0 + min(h * 0.3, 3.6 * (3 + int(r2 * 3)))  # three to five floors
        top = inset(ring, short * (0.15 + 0.07 * r2))
        if top:
            return [(ring, z0, zp), (top, zp, zw)]
    if kind == 'setback':
        z1 = z0 + h * (0.76 + 0.1 * r2)
        a = inset(ring, 1.4 + 1.2 * r2)
        if a:
            if r2 > 0.45:
                z2 = z0 + h * (0.91 + 0.04 * r2)
                b2 = inset(a, 1.2 + 1.0 * r2)
                if b2:
                    return [(ring, z0, z1), (a, z1, z2), (b2, z2, zw)]
            return [(ring, z0, z1), (a, z1, zw)]
    if kind == 'glass' and r2 > 0.6:
        a = inset(ring, 1.5 + r2)
        if a:
            z1 = z0 + h * 0.88
            return [(ring, z0, z1), (a, z1, zw)]
    if kind == 'penthouse':
        a = inset(ring, 1.8 + 0.8 * r2)
        if a:
            return [(ring, z0, zw - 3.3), (a, zw - 3.3, zw)]
    if kind == 'wedding':
        # The 1916 zoning envelope: the street wall rises to 42 to 60% of the height, then two to four
        # setbacks, each 7 to 11% of the outline's short side.
        steps = 2 + int(r2 * 2.99)
        start = 0.42 + 0.18 * r2
        d = oriented_size(ring)[0] * (0.07 + 0.04 * r2)
        out, cur, zc = [], ring, z0
        for i in range(steps):
            z1 = z0 + h * (start + (1 - start) * i / steps)
            nxt = inset(cur, d)
            if not nxt:
                break
            out.append((cur, zc, z1))
            cur, zc = nxt, z1
        out.append((cur, zc, zw))
        return out
    return [(ring, z0, zw)]


# ---- Geometry ---------------------------------------------------------------------------------------

def walls(mb, ring, z0, z1, attrs, hole=False):
    """Walls round a ring from z0 to z1, facing out (into the courtyard for a hole), u in metres along."""
    ccw = area_of(ring) > 0
    pts = ring if (ccw != hole) else ring[::-1]
    u = 0.0
    for i in range(len(pts)):
        a, c = pts[i], pts[(i + 1) % len(pts)]
        length = math.hypot(c[0] - a[0], c[1] - a[1])
        mb.face([(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)],
                [(u, z0), (u + length, z0), (u + length, z1), (u, z1)], 0, **attrs)
        u += length


def cap(mb, ring, z, attrs, holes=(), mat=1, down=False):
    tris, flat = G['tessellate'](ring, list(holes))
    for t in tris:
        tri = [(*flat[t[0]], z), (*flat[t[1]], z), (*flat[t[2]], z)]
        mb.face(tri[::-1] if down else tri, None, mat, **attrs)


def band(mb, ring, z0, z1, out, attrs):
    """A moulding round the walls: the outline pushed `out` metres outward from z0 to z1, closed above and
    below (a cornice, a string course)."""
    o = inset(ring, -out)
    if not o:
        return
    ccw = lambda r: r if area_of(r) > 0 else r[::-1]  # noqa: E731
    o, ring = ccw(o), ccw(ring)
    walls(mb, o, z0, z1, attrs)
    cap(mb, o, z1, attrs, holes=[ring], mat=0)
    cap(mb, o, z0, attrs, holes=[ring], mat=0, down=True)


def frustum(mb, lo, z0, hi, z1, attrs):
    """Roof slopes from ring `lo` at z0 up to ring `hi` at z1 (the same vertex count), and hi's flat top."""
    lo = lo if area_of(lo) > 0 else lo[::-1]
    hi = hi if area_of(hi) > 0 else hi[::-1]
    for i in range(len(lo)):
        j = (i + 1) % len(lo)
        mb.face([(*lo[i], z0), (*lo[j], z0), (*hi[j], z1), (*hi[i], z1)], None, 1, **attrs)


def same_inset(ring, d):
    """An inset with the same vertex count as the ring (for a roof's slopes), trying smaller insets when the
    full one folds; None if none holds."""
    for k in (1.0, 0.7, 0.45):
        r = inset(ring, d * k, min_edge=0.0)
        if r and len(r) == len(ring):
            return r, d * k
    return None, 0.0


def pitched(mb, ring, zw, roof_h, shape, attrs):
    """A pitched roof over the outline: hipped (35 degree slopes to a ridge or a small flat), or mansard
    (a steep lower slope to 70% of the height, then a shallow one); the slopes follow the outline, concave
    corners included. Falls back to shrinking toward the centroid where the outline is too narrow."""
    ring = ring if area_of(ring) > 0 else ring[::-1]
    short, _ = oriented_size(ring)
    if shape == 'mansard':
        mid, d1 = same_inset(ring, min(roof_h * 0.7 / math.tan(math.radians(70)), short * 0.2))
        if mid:
            top, d2 = same_inset(mid, min(roof_h * 0.3 / math.tan(math.radians(25)), short * 0.5 - d1 - 0.3))
            if top:
                frustum(mb, ring, zw, mid, zw + roof_h * 0.7, attrs)
                frustum(mb, mid, zw + roof_h * 0.7, top, zw + roof_h, attrs)
                cap(mb, top, zw + roof_h, attrs)
                return top, zw + roof_h
    d = min(roof_h / math.tan(math.radians(35)), short * 0.48)
    top, d = same_inset(ring, d)
    if top:
        z1 = zw + roof_h * min(1.0, d / max(roof_h / math.tan(math.radians(35)), 1e-6))
        frustum(mb, ring, zw, top, z1, attrs)
        cap(mb, top, z1, attrs)
        return top, z1
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    top = [(cx + (p[0] - cx) * 0.35, cy + (p[1] - cy) * 0.35) for p in ring]
    frustum(mb, ring, zw, top, zw + roof_h, attrs)
    cap(mb, top, zw + roof_h, attrs)
    return top, zw + roof_h


def add_building(mb, b):
    rng, clean, FLOODLIT = G['rng'], G['clean'], G['FLOODLIT']
    outer = [r for r in (clean(r) for r in b['outer']) if r]
    inner = [r for r in (clean(r) for r in b['inner']) if r]
    if not outer:
        return
    over = G['landmark_override'](b)
    main = max(outer, key=lambda r: abs(area_of(r)))
    style, bay, floorh, win_w, win_h, frame, busy = facade_params(b, abs(area_of(main)))
    own = random.Random(b['id'])  # the building's own draws: the archetype stays put when other code changes
    r1, r2, r3 = own.random(), own.random(), own.random()
    kind = 'osm' if over or len(outer) > 1 else archetype(b, main, style, r1)
    COUNTS[kind] = COUNTS.get(kind, 0) + 1
    # Half of New York's masonry setback towers in art deco's continuous window strips (facade.py style 5).
    if kind == 'wedding' and style in (1, 2) and r2 < 0.5 and G['SITE'].get('facade', {}).get('deco') and G['UPTO'] >= 4:
        style, bay, win_w, win_h, frame = 5, own.uniform(1.5, 2.0), own.uniform(0.18, 0.26), own.uniform(0.36, 0.4), 0.3
        COUNTS['deco'] = COUNTS.get('deco', 0) + 1
    # New York's glass towers: a third with their corners chamfered, 2 to 5 m (simple outlines only).
    if ny() and kind == 'glass' and r3 < 0.33 and len(main) <= 6:
        cut = chamfer(main, 2.0 + 3.0 * r2)
        if cut:
            main = cut
            outer = [cut]
            COUNTS['chamfered'] = COUNTS.get('chamfered', 0) + 1
    col = jitter(rng, albedo(b, kind))
    if over:
        # A landmark's own stone and roof (landmarks_<city>.py), the same over all its parts, and its style.
        col = over.get('parts', col) if style == 3 else over.get('wall', col)  # windowless parts: chimneys, turrets
        if 'style' in over and style != 3:
            style, bay, floorh, win_w, win_h, frame = over['style'], *over.get('cell', (bay, floorh, win_w, win_h, frame))
            busy = over.get('busy', busy)
    if style == 0 and ny() and G['UPTO'] >= 5 and not b.get('colour') and not over:
        col = jitter(random.Random(b['id'] + ' tint'), pick(random.Random(b['id'] + ' glass tint'), NY_GLASS))
    elif style == 0:
        col = tuple(c * 0.35 for c in col)  # a curtain wall's spandrels and mullions: dark glass and metal
    seed = rng.random() * 1000
    # On the ground under it (b['base'], above z = 0; extract.mjs). A part that starts at the ground reaches
    # down to z = 0 too, so a building on a rise never floats over the flat ground slab.
    zb = b.get('base', 0.0)
    z0 = zb + b['min'] if b['min'] > 0 else min(0.0, zb)
    roof = dict(b['roof'])
    ztop = zb + b['height']
    # A third of New York's setback towers under a pyramid (copper or tile), a sixth of the height.
    if kind == 'wedding' and r3 > 0.66:
        roof['shape'] = 'pyramidal'
        roof['height'] = (b['height'] - b['min']) * 0.07
        ztop += roof['height']
    # Older low-rise with no roof shape in OSM: London's are mostly pitched slate (hipped or mansard behind a
    # parapet); a quarter stay flat. The eaves stay 2 m below the mapped height, the ridge above it.
    if kind == 'lowrise' and not roof['tagged'] and r2 < 0.75 and not ny():
        short, _ = oriented_size(main)
        roof['shape'] = 'mansard' if r2 < 0.3 else 'hipped'
        roof['height'] = max(2.0, min(4.5, short * 0.32))
        ztop += roof['height'] - 2.0
    roof_h = roof['height'] if roof['shape'] not in ('flat',) else 0.0
    zw = max(ztop - roof_h, z0 + 0.5)
    # Flat roofs: felt, gravel and plant, grey; pitched: slate or lead, each a little its own.
    roofc = (rng.uniform(0.09, 0.17),) * 3 if roof['shape'] in ('flat', 'skillion') else jitter(rng, (0.075, 0.08, 0.09))
    rc = roof.get('colour')
    if over and 'roof' in over:
        roofc = over['roof']
    elif rc in NAMED:
        roofc = tuple(c * 0.7 for c in NAMED[rc])
    elif rc and rc.startswith('#') and len(rc) == 7:
        roofc = desaturate(tuple(min(srgb_to_linear(int(rc[i:i + 2], 16) / 255) * 0.6, 0.4) for i in (1, 3, 5)), 0.5)
    flood = FLOODLIT.get(b['id']) or FLOODLIT.get(b.get('name')) or FLOODLIT.get((b.get('within') or {}).get('name')) or 0.0
    attrs = dict(wall=col, style=style, bay=bay, floorh=floorh, win_w=win_w, win_h=win_h, frame=frame, busy=busy, seed=seed, roofc=roofc, flood=flood,
                 **facade_runs(style))
    plain = dict(attrs, style=3)  # mouldings, screens: wall without windows
    # Walls, tier by tier.
    tiers = tiers_for(kind, main, z0, zw, r2) if kind != 'osm' else [(main, z0, zw)]
    for i, (ring, a, c) in enumerate(tiers):
        walls(mb, ring, a, c, attrs)
        if i < len(tiers) - 1:
            cap(mb, ring, c, attrs)  # the terrace a setback leaves
    for ring in outer:
        if ring is not main:
            walls(mb, ring, z0, zw, attrs)
    for hole in inner:
        walls(mb, hole, z0, zw, attrs, hole=True)
    top = tiers[-1][0]
    # Aviation obstruction lights (a city's 'beacons'; the FAA's steady red): two at opposite corners of each
    # roof 230 m or more above the ground. On every roof over 150 m (910 lamps, tried first) the skyline
    # read as strung with red; w0 shows a few, on the tallest.
    if G['SITE'].get('beacons') and b['height'] >= 230 and abs(area_of(top)) >= 150:
        far = max(((p, q) for p in top for q in top), key=lambda pq: math.dist(*pq))
        BEACONS.extend((x, y, zw + 1.6) for x, y in far)
    # A cornice at the eaves of older low-rise: 0.35 m proud, 0.6 m deep, lighter (stucco or stone).
    # New York's are heavier (pressed metal or stone, 0.6 m proud, 1 m deep), and its setback towers carry
    # one at each setback.
    trim = dict(plain, wall=tuple(min(0.6, c * 1.25 + 0.04) for c in col))
    if kind == 'lowrise' and not ny():
        band(mb, top, zw - 0.6, zw, 0.35, trim)
    if kind in ('lowrise', 'loft') and ny():
        band(mb, top, zw - 1.0, zw, 0.6, trim)
    if kind == 'wedding':
        for ring, a, c in tiers:
            band(mb, ring, c - 0.8, c, 0.35, trim)
    # A curtain wall's glass carried 3 m past the roof as a screen round the plant.
    if kind == 'glass':
        walls(mb, top, zw, zw + 3.0, dict(plain, wall=tuple(c * 0.6 for c in col)))
    # Roof, and its detail (roofs.py): parts without windows (turrets, chimneys, roofs mapped as parts) and
    # the landmarks' get none.
    detail = style != 3 and not over and abs(area_of(main)) >= 20 and G['UPTO'] >= 3
    if roof['shape'] == 'skillion' and roof_h > 0.3:
        ok = roofs.skillion(mb, top, zw, roof_h, roof.get('direction'), attrs)
        COUNTS['skillion' if ok else 'skillion failed'] = COUNTS.get('skillion' if ok else 'skillion failed', 0) + 1
        if ok:
            return
    if roof['shape'] in ('flat', 'skillion') or roof_h <= 0.3:
        if len(tiers) > 1 or kind in ('lowrise', 'glass', 'loft'):
            cap(mb, top, zw, attrs)
        else:
            for r in outer:
                cap(mb, r, zw, attrs, holes=inner)
        if detail:
            # Plant and boxes on the archetypes' roofs and on the larger roofs of buildings mapped in parts
            # (half of them: a part's roof is often a podium's or a wing's); parapets on all.
            busy_roof = kind != 'osm' or (abs(area_of(main)) >= 400 and b['height'] >= 20 and r3 < 0.5)
            COUNTS['roof props'] = COUNTS.get('roof props', 0) + roofs.flat_roof(mb, top, zw, attrs, own, kind, b['height'], busy_roof)
        return
    cx = sum(p[0] for p in top) / len(top)
    cy = sum(p[1] for p in top) / len(top)
    ring = top if area_of(top) > 0 else top[::-1]
    if roof['shape'] in ('pyramidal', 'cone', 'spire'):
        for i in range(len(ring)):
            a, c = ring[i], ring[(i + 1) % len(ring)]
            mb.face([(a[0], a[1], zw), (c[0], c[1], zw), (cx, cy, ztop)], None, 1, **attrs)
    elif roof['shape'] in ('dome', 'onion', 'round'):
        steps = 6
        prev = [(p[0], p[1], zw) for p in ring]
        for s in range(1, steps + 1):
            t = s / steps
            k = math.cos(t * math.pi / 2)  # a quarter circle in section
            z = zw + roof_h * math.sin(t * math.pi / 2)
            cur = [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, z) for p in ring]
            for i in range(len(ring)):
                j = (i + 1) % len(ring)
                if s < steps:
                    mb.face([prev[i], prev[j], cur[j], cur[i]], None, 1, **attrs)
                else:
                    mb.face([prev[i], prev[j], (cx, cy, ztop)], None, 1, **attrs)
            prev = cur
    else:
        # Pitched roofs (gabled, hipped, mansard, …): slopes following the outline (pitched above), with
        # chimney stacks along the ridge on older low-rise and most other pitched roofs.
        ridge, zr = pitched(mb, ring, zw, roof_h, 'mansard' if roof['shape'] in ('mansard', 'gambrel') else 'hipped', attrs)
        if detail and (kind == 'lowrise' or r3 < 0.6):
            COUNTS['roof props'] = COUNTS.get('roof props', 0) + roofs.ridge_chimneys(mb, ridge, zr, attrs, own)


def beacons():
    """The aviation lights: small red lamps (the city's lights, faded in after dark), steady."""
    import bmesh
    from mathutils import Vector
    bpy = G['bpy']
    bm = bmesh.new()
    for p in BEACONS:
        res = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.5)
        for v in res['verts']:
            v.co += Vector(p)
    me = bpy.data.meshes.new('beacons')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(G['emission_material']('beacon', (1.0, 0.07, 0.03), 35.0, base=(0.3, 0.05, 0.04)))
    ob = bpy.data.objects.new('beacons', me)
    bpy.context.collection.objects.link(ob)
    ob.lightgroup = 'city'
    print(f'beacons: {len(BEACONS)}')


def build_city():
    MeshBuilder, scene_data, landmarks = G['MeshBuilder'], G['scene_data'], G['landmarks']
    mb = MeshBuilder('buildings', FACADE_ATTRS)
    skipped = 0
    for b in scene_data['buildings']:
        if G['replaced'](b) or (G['ONLY'] == 'heroes' and not landmarks.is_hero(b)):
            skipped += 1
            continue
        try:
            add_building(mb, b)
        except Exception as e:  # a broken footprint should not stop the city
            skipped += 1
            print('building failed:', b['id'], e)
    ob = mb.build([G['MAT']['facade'], G['MAT']['roof']])
    if BEACONS:
        beacons()
    print(f'buildings: {len(scene_data["buildings"]) - skipped} ({skipped} skipped), {len(mb.faces)} faces')
    print('archetypes: ' + ', '.join(f'{k} {v}' for k, v in COUNTS.items()))
    return ob
