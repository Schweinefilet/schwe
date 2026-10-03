"""London's landmarks for scripts/blender/skyline.py, modelled from published dimensions and checked
against the reference photos in data/refs/london/ (Wikimedia Commons, see sources.json).

REPLACES: OpenStreetMap elements drawn here instead of raised from their outline.
build(g): g is skyline.py's globals (bpy, MAT, MeshBuilder, scene_data, SITE, rng, …).
"""

import math

EYE_WAY = 'way/204068874'
ELIZABETH = 'way/123557148'
HUNGERFORD = 'way/184107136'
# Drawn here instead of raised from OpenStreetMap: the London Eye's footprint (raised, a solid slab) and
# Hungerford Bridge's outline (as a deck, a 38 m wide slab over the river).
# Left out (user's choice, 2026-10-02): three moored craft OSM maps as buildings on the river 160 to 175 m
# out (the generic facade made them a floating block of office windows).
MOORED = {'way/1424896013', 'way/1424896014', 'way/1424896015'}
REPLACES = {EYE_WAY, HUNGERFORD} | MOORED
# Holes in the river OSM cuts for Brunel's pier's two ends (left out, below), by their centres (metres from
# the vantage): filled with water instead of raised as stone blocks.
RIVER_FILL = ((-165.0, -234.0), (-198.0, -299.0))
# Floodlit at night, by name (a building or the building a part belongs to), relative brightness: the
# Palace and its towers golden (ref1, ref6), the Abbey, and the river front's grand buildings dimmer.
FLOODLIT = {
    'Palace of Westminster': 1.0, 'Elizabeth Tower': 1.25, 'Victoria Tower': 1.2, 'Westminster Abbey': 0.7,
    'County Hall': 0.45, 'Whitehall Court': 0.5, 'Ministry of Defence': 0.3,
}
# The Eye's LEDs: blue as in ref6 (they change colour for occasions; the colour is the user's to choose).
# A pure LED blue: the site's AgX tone curve takes bright light toward white through its own hue, so a
# paler blue (0.2, 0.35, 1.0, as first set) burned white; this one stays blue, as in ref6.
EYE_LED = (0.04, 0.12, 1.0)
# The Jubilee stays' glow at the top of the fan (see rods_material).
ROD_GLOW = 16.0

# ---- Hero landmarks -------------------------------------------------------------------------------
# The buildings that say "London from Waterloo Bridge" with everything else hidden (skyline.py --only
# heroes): the Eye, the Palace of Westminster's three towers and its pinnacled river front, the Abbey,
# Portcullis House's chimneys, Whitehall Court's pavilion roofs, the towers beyond (Millbank, St George
# Wharf) and the Jubilee footbridges. Reference photos: data/refs/london/ (ref1-6) and set2/ (37 more
# from Waterloo Bridge looking upstream, Wikimedia Commons; sources.json credits each).
HEROES = {'Palace of Westminster', 'Elizabeth Tower', 'Victoria Tower', 'Westminster Abbey', 'Portcullis House', 'Whitehall Court',
          'Millbank Tower', 'Westminster Hall', 'Central Tower', 'County Hall', 'Shell Centre'}
# Modelled whole here instead of raised from their OpenStreetMap parts.
REPLACES_WITHIN = {'Elizabeth Tower', 'Victoria Tower'}
MILLBANK = 'way/24553530'
# St George Wharf Tower (Vauxhall): OSM maps it as four stacked rings, 148 to 181 m.
ST_GEORGE = ('way/1429872268', 'way/1429872269', 'way/1429872270', 'way/1429872271')
CENTRAL_TOWER = 'way/123557145'  # its base; the lantern and spire above (OSM's parts, to 78 m) are modelled
VICTORIA_BASE = 'way/1134791149'

# Linear albedo. Anston limestone (the Palace), weathered to a warm brown-grey (set2/big-c123, overcast); its roofs cast
# iron tiles, near black-blue; Portland stone for Whitehall and the South Bank's offices; Portcullis
# House's sandstone and its bronze roof and chimneys, dark in every photo.
ANSTON = (0.28, 0.22, 0.15)
IRON_ROOF = (0.035, 0.04, 0.05)
SLATE = (0.055, 0.06, 0.07)
PORTLAND = (0.38, 0.36, 0.31)
GOTHIC_CELL = (1.7, 4.6, 0.13, 0.36, 0.3)  # bay, floor height, light half width and height, frame
# Each landmark's stone, roof and facade style over all its OSM parts (filler.py add_building), instead
# of OSM's palette colours and the generic office windows; `parts` for its windowless parts (Portcullis
# House's chimneys are bronze, like its roof).
OVERRIDES = {
    'Palace of Westminster': dict(wall=ANSTON, roof=IRON_ROOF, style=4, cell=GOTHIC_CELL, busy=0.12),
    'Westminster Hall': dict(wall=ANSTON, roof=SLATE, style=4, cell=GOTHIC_CELL, busy=0.0),
    'Central Tower': dict(wall=ANSTON, roof=IRON_ROOF, style=4, cell=GOTHIC_CELL, busy=0.0),
    'Westminster Abbey': dict(wall=(0.31, 0.28, 0.22), roof=(0.07, 0.07, 0.075), style=4, cell=(2.2, 6.0, 0.16, 0.4, 0.3), busy=0.0),
    'Portcullis House': dict(wall=(0.2, 0.18, 0.155), roof=(0.07, 0.055, 0.04), parts=(0.06, 0.05, 0.04)),
    'Whitehall Court': dict(wall=PORTLAND, roof=SLATE),
    'County Hall': dict(wall=PORTLAND, roof=(0.16, 0.075, 0.05)),
    'Shell Centre': dict(wall=(0.34, 0.32, 0.27)),
    'Ministry of Defence': dict(wall=PORTLAND),
}
_prepared = {}


def is_hero(b):
    return (b.get('name') in HEROES or (b.get('within') or {}).get('name') in HEROES or b['id'] in ST_GEORGE
            or b['id'] == MILLBANK)


def prepare(scene_data):
    """OSM elements the hero models replace (skyline.py skips them), noted before the city is built: St
    George Wharf's rings, Millbank Tower, and the Palace's parts above the Central Tower's base."""
    out = set(ST_GEORGE) | {MILLBANK}
    base = next((b for b in scene_data['buildings'] if b['id'] == CENTRAL_TOWER), None)
    if base:
        c = _centroid(base['outer'][0])
        for b in scene_data['buildings']:
            if (b.get('within') or {}).get('name') == 'Palace of Westminster' and b['min'] >= 24 and math.dist(_centroid(b['outer'][0]), c) < 12:
                out.add(b['id'])
    _prepared['replaced'] = out
    return out


def _centroid(ring):
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def _axes(ring):
    """A square tower's centre and axes from its outline: the longest edge's direction and its normal."""
    from mathutils import Vector
    pts = [Vector((x, y, 0)) for x, y in ring]
    if (pts[0] - pts[-1]).length < 1e-6:
        pts = pts[:-1]
    c = sum(pts, Vector()) / len(pts)
    a, b = max(((pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))), key=lambda e: (e[1] - e[0]).length)
    ax = (b - a).normalized()
    return c, ax, Vector((-ax.y, ax.x, 0))


def build(g):
    bridges = {b['id']: b for b in g['scene_data']['bridges']}
    mats = materials(g)
    london_eye(g, mats, footprint_of(g, EYE_WAY))
    jubilee_bridges(g, mats, bridges)
    elizabeth_tower(g, mats)
    victoria_tower(g, mats)
    central_tower(g, mats)
    palace_pinnacles(g)
    millbank_tower(g)
    st_george_wharf(g)
    whitehall_court_roofs(g)
    if not g['ONLY']:
        embankment_lights(g, mats)


def materials(g):
    bpy = g['bpy']
    sm = g['simple_material']
    em = g['emission_material']
    global EYE_LED
    if g['arg']('eye-led'):  # previews of other colours: --eye-led r,g,b (linear)
        EYE_LED = tuple(float(v) for v in g['arg']('eye-led').split(','))
    return {
        'white_steel': sm('white_steel', (0.62, 0.63, 0.64), 0.35, Metallic=0.2),
        # The Eye's rim and spokes lit by its LEDs at night: the whole truss takes their colour (ref6).
        'eye_rim': lit_material(g, 'eye_rim', (0.62, 0.63, 0.64), EYE_LED, 2.0),
        'eye_spokes': lit_material(g, 'eye_spokes', (0.55, 0.56, 0.57), EYE_LED, 1.2),
        'capsule': glass_capsule(g),
        'led': em('eye_led', EYE_LED, 40.0, base=(0.6, 0.61, 0.62)),
        'mast_led': em('mast_led', (0.85, 0.9, 1.0), 30.0, base=(0.6, 0.61, 0.62)),
        'deck_led': em('deck_led', (0.7, 0.75, 1.0), 6.0, base=(0.3, 0.3, 0.3)),
        'cable': sm('cable', (0.55, 0.56, 0.57), 0.4, Metallic=0.5),
        'rods': rods_material(g),
        'balustrade': sm('balustrade', (0.6, 0.63, 0.64), 0.05, **{'Transmission Weight': 0.85}),
        'truss': sm('truss', (0.05, 0.05, 0.055), 0.6, Metallic=0.6),
        'brick': brick_material(g),
        'clock': opal_material(g),
        'gilt': gilt_material(g),
        'flag': flag_material(g),
        'lantern': em('lantern', (1.0, 0.8, 0.55), 25.0, base=(0.5, 0.48, 0.42)),
        'festoon': em('festoon', (1.0, 0.85, 0.62), 30.0, base=(0.5, 0.5, 0.48)),
    }


def glass_capsule(g):
    bpy = g['bpy']
    mat = bpy.data.materials.new('capsule')
    nt = g['nodes_of'](mat)
    b = g['node'](nt, 'ShaderNodeBsdfPrincipled', Roughness=0.08, **{'Base Color': (0.12, 0.13, 0.14, 1)})
    b.inputs['Transmission Weight'].default_value = 0.3
    b.inputs['Metallic'].default_value = 0.3
    # Dimly lit inside at night: the rim's LEDs, not the capsules, light the wheel.
    e = g['node'](nt, 'ShaderNodeEmission', Strength=0.08, Color=(0.85, 0.9, 1.0, 1))
    add = g['node'](nt, 'ShaderNodeAddShader')
    nt.links.new(b.outputs[0], add.inputs[0])
    nt.links.new(e.outputs[0], add.inputs[1])
    out = g['node'](nt, 'ShaderNodeOutputMaterial')
    nt.links.new(add.outputs[0], out.inputs['Surface'])
    return mat


def brick_material(g):
    """Brunel's pier: Victorian brick, 180 years by the river and near black in ref4, courses and bricks
    varying, a green-black tide band up to high water, 3.5 m above the mean the scene's water stands at."""
    bpy = g['bpy']
    node, math_node, mix_colour = g['node'], g['math_node'], g['mix_colour']
    mat = bpy.data.materials.new('brick')
    nt = g['nodes_of'](mat)
    tc = node(nt, 'ShaderNodeTexCoord')
    bricks = node(nt, 'ShaderNodeTexBrick')
    bricks.inputs['Scale'].default_value = 4.0
    bricks.inputs['Mortar Size'].default_value = 0.015
    bricks.inputs['Color1'].default_value = (0.1, 0.065, 0.05, 1)
    bricks.inputs['Color2'].default_value = (0.075, 0.05, 0.042, 1)
    bricks.inputs['Mortar'].default_value = (0.13, 0.12, 0.11, 1)
    nt.links.new(tc.outputs['Object'], bricks.inputs['Vector'])
    grime = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    grime.inputs['Scale'].default_value = 0.4
    nt.links.new(tc.outputs['Object'], grime.inputs['Vector'])
    col = mix_colour(nt, 1.0, bricks.outputs['Color'], g['grey_of'](nt, math_node(nt, 'MULTIPLY_ADD', grime.outputs['Fac'], 0.5, 0.7)), 'MULTIPLY')
    geo = node(nt, 'ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    tide = math_node(nt, 'LESS_THAN', sep.outputs['Z'], g['SITE']['water'] + 3.5)
    col = mix_colour(nt, tide, col, (0.03, 0.035, 0.028))
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.9)
    nt.links.new(col, b.inputs['Base Color'])
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return mat


def lit_material(g, name, colour, glow, strength, roughness=0.35):
    """Painted steel that also glows at night (the Emission's strength is switched with the city's
    lights by skyline.py)."""
    bpy = g['bpy']
    mat = bpy.data.materials.new(name)
    nt = g['nodes_of'](mat)
    b = g['node'](nt, 'ShaderNodeBsdfPrincipled', Roughness=roughness, **{'Base Color': (*colour, 1)})
    e = g['node'](nt, 'ShaderNodeEmission', Strength=strength, Color=(*glow, 1))
    add = g['node'](nt, 'ShaderNodeAddShader')
    nt.links.new(b.outputs[0], add.inputs[0])
    nt.links.new(e.outputs[0], add.inputs[1])
    out = g['node'](nt, 'ShaderNodeOutputMaterial')
    nt.links.new(add.outputs[0], out.inputs['Surface'])
    return mat


def rods_material(g):
    """The Jubilee footbridges' stays: steel rods that, lit from the masts' tops, glow at night brightest
    near the top and fading fast down the fan (the small white "umbrellas" of ref1 and ref6). A rod is a
    fraction of a pixel across at this range, so the glow is strong where it is lit."""
    bpy = g['bpy']
    node, math_node = g['node'], g['math_node']
    mat = bpy.data.materials.new('rods')
    nt = g['nodes_of'](mat)
    # Painted, mostly diffuse: a mirror-like steel would reflect the dark street below the horizon, and the
    # photos show the fans pale against everything (set2).
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.35, Metallic=0.25, **{'Base Color': (0.72, 0.73, 0.74, 1)})
    geo = node(nt, 'ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    deck = g['SITE']['deck']
    k = math_node(nt, 'DIVIDE', math_node(nt, 'SUBTRACT', sep.outputs['Z'], deck), MAST_TOP - deck, clamp=True)
    gain = node(nt, 'ShaderNodeValue', name='city_gain', label='city_gain')
    gain.outputs[0].default_value = 1.0
    # Only the fan's top fifth or so glows: the light is at the mast's head.
    strength = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'POWER', k, 10.0), ROD_GLOW), gain.outputs[0])
    e = node(nt, 'ShaderNodeEmission', Color=(0.9, 0.93, 1.0, 1))
    nt.links.new(strength, e.inputs['Strength'])
    add = node(nt, 'ShaderNodeAddShader')
    nt.links.new(b.outputs[0], add.inputs[0])
    nt.links.new(e.outputs[0], add.inputs[1])
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(add.outputs[0], out.inputs['Surface'])
    return mat


def footprint_of(g, osm_id):
    outline = g['scene_data'].get('landmarkOutlines', {}).get(osm_id)
    if not outline:
        raise KeyError(f'{osm_id} not in the scene data (scripts/skyline/extract.mjs LANDMARK_OUTLINES)')
    return outline[0]


def tube(bm, a, b, r, segs=6):
    """A cylinder from a to b (Vectors) of radius r, added to bmesh bm."""
    from mathutils import Vector
    import bmesh
    d = b - a
    length = d.length
    if length < 1e-3:
        return
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in res['verts']:
        v.co = q @ v.co + (a + b) / 2


def mesh_object(g, name, bm, mat, lightgroup=None):
    bpy = g['bpy']
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if lightgroup:
        ob.lightgroup = lightgroup
    return ob


def london_eye(g, mats, fp):
    """The London Eye (London Eye, published: 135 m tall, 120 m across, 32 capsules): a lattice rim, the
    hub on its spindle, cable spokes, capsules outside the rim, the A-frame on the landward side."""
    import bmesh
    from mathutils import Vector
    cx = sum(p[0] for p in fp) / len(fp)
    cy = sum(p[1] for p in fp) / len(fp)
    # The wheel's plane: the footprint's long axis.
    sxx = sum((p[0] - cx) ** 2 for p in fp)
    syy = sum((p[1] - cy) ** 2 for p in fp)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in fp)
    a = 0.5 * math.atan2(2 * sxy, sxx - syy)
    u = Vector((math.cos(a), math.sin(a), 0))  # along the wheel
    n = Vector((-u.y, u.x, 0))  # the spindle
    # Landward: the side away from the river (east here), where the A-frame stands.
    if n.x < 0:
        n = -n
    # OSM: 136.5 m to the top, from 1.5 m; the rim 120 m across, so the hub about 69 m up with the
    # capsules' outer ends 67 m from it (ref4 measures 67.5 m from hub to the top capsule's roof).
    hub = Vector((cx, cy, 69.0))
    R = 60.0

    def on_wheel(t, r, off=0.0):
        return hub + u * (r * math.cos(t)) + Vector((0, 0, r * math.sin(t))) + n * off

    # Rim: a triangular truss, two chords either side of the plane and one inside, braced.
    bm = bmesh.new()
    N = 128
    for i in range(N):
        t0 = i / N * math.tau
        t1 = (i + 1) / N * math.tau
        for (r, off) in ((R, 1.6), (R, -1.6), (R - 2.8, 0.0)):
            tube(bm, on_wheel(t0, r, off), on_wheel(t1, r, off), 0.32)
        # bracing
        tube(bm, on_wheel(t0, R, 1.6), on_wheel(t1, R - 2.8, 0.0), 0.12, 4)
        tube(bm, on_wheel(t0, R, -1.6), on_wheel(t1, R - 2.8, 0.0), 0.12, 4)
        tube(bm, on_wheel(t0, R, 1.6), on_wheel(t0, R, -1.6), 0.1, 4)
    mesh_object(g, 'eye_rim', bm, mats['eye_rim'])
    # LEDs along the outer chords (lit at night).
    bm = bmesh.new()
    for i in range(N):
        t0 = i / N * math.tau
        t1 = (i + 1) / N * math.tau
        for off in (1.6, -1.6):
            tube(bm, on_wheel(t0, R + 0.4, off), on_wheel(t1, R + 0.4, off), 0.14, 4)
    mesh_object(g, 'eye_leds', bm, mats['led'], 'city')
    # Hub and spindle.
    bm = bmesh.new()
    tube(bm, hub - n * 11, hub + n * 11, 1.2, 12)
    tube(bm, hub - n * 3, hub + n * 3, 3.2, 16)
    # Spokes: cables from each end of the hub to the rim's chords.
    for i in range(32):
        t = i / 32 * math.tau
        tube(bm, hub + n * 3, on_wheel(t, R - 1.0, 1.6), 0.09, 4)
        tube(bm, hub - n * 3, on_wheel(t + math.pi / 32, R - 1.0, -1.6), 0.09, 4)
    mesh_object(g, 'eye_hub', bm, mats['eye_spokes'])
    # Capsules: 32 glass ovoids hanging outside the rim, long axis along the spindle.
    bm = bmesh.new()
    for i in range(32):
        t = i / 32 * math.tau + 0.05
        c = on_wheel(t, R + 4.8)
        res = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in res['verts']:
            p = v.co
            v.co = c + n * (p.x * 4.0) + u * (p.y * 2.2) + Vector((0, 0, p.z * 2.2))
    mesh_object(g, 'eye_capsules', bm, mats['capsule'], 'city')
    # The A-frame: two legs from either end of the spindle's landward half down to the embankment,
    # leaning back about 65° (published), with backstay cables.
    bm = bmesh.new()
    base = hub + n * 38 - Vector((0, 0, hub.z))
    for s in (-1, 1):
        foot = base + u * (s * 14)
        tube(bm, hub + n * 8, foot, 1.6, 10)
        tube(bm, foot + Vector((0, 0, 1)), foot + n * 25 + Vector((0, 0, 1)), 0.5, 6)
    # A tie between the legs, 30 m below the hub.
    k = 30 / hub.z
    tube(bm, hub + n * 8 + (base - u * 14 - hub - n * 8) * k, hub + n * 8 + (base + u * 14 - hub - n * 8) * k, 0.8, 8)
    for s in (-1, 1):
        tube(bm, hub + n * 8, base + n * 30 + u * (s * 22), 0.12, 4)
    mesh_object(g, 'eye_aframe', bm, mats['white_steel'])
    print('landmark: London Eye')


class Polyline:
    """A path in plan (x, y), measured along its length."""

    def __init__(self, pts):
        from mathutils import Vector
        self.p = [Vector((x, y, 0)) for x, y in pts]
        self.s = [0.0]
        for i in range(1, len(self.p)):
            self.s.append(self.s[-1] + (self.p[i] - self.p[i - 1]).length)
        self.length = self.s[-1]

    def at(self, t):
        """Point and unit tangent at distance t along."""
        t = max(0.0, min(self.length, t))
        for i in range(1, len(self.p)):
            if t <= self.s[i] or i == len(self.p) - 1:
                a, b = self.p[i - 1], self.p[i]
                k = (t - self.s[i - 1]) / max(self.s[i] - self.s[i - 1], 1e-6)
                return a + (b - a) * k, (b - a).normalized()

    def nearest(self, q):
        """Distance along of the point on the path nearest q."""
        best = (1e18, 0.0)
        for i in range(1, len(self.p)):
            a, b = self.p[i - 1], self.p[i]
            L = (b - a).length
            k = max(0.0, min(1.0, (q - a).dot(b - a) / max(L * L, 1e-9)))
            d = (a + (b - a) * k - q).length
            if d < best[0]:
                best = (d, self.s[i - 1] + k * L)
        return best[1]


# The Golden Jubilee footbridges as OpenStreetMap maps them (their centrelines), downstream (nearer the
# vantage) and upstream, both taken south to north.
JUBILEE_DOWNSTREAM = 'way/4254120'
JUBILEE_UPSTREAM = 'way/4254123'
# Pylons, metres along the downstream footbridge from its south end: the positions that put a near and
# a far mast top where each of ref4's ten masts is (rays from the fitted camera), seven a bridge
# (Wikipedia), two of them at the ends of Brunel's brick pier; the last two, out of that photo's frame,
# continue the spacing.
JUBILEE_PIERS = (20.5, 66.5, 77.5, 123.5, 173.0, 222.0, 271.0)
# Brunel's pier: OpenStreetMap maps its two ends beyond the footbridges (ways 166709479, 166709480),
# 70.4 m to 80.9 m along, and 14 m across each: 4 m to 18 m downstream of the downstream footbridge's
# centreline, and 55 m to 69 m upstream of it (past the upstream footbridge, 49.5 m away).
BRUNEL_PIER = {'along': (70.4, 80.9), 'down': (4.0, 18.0), 'up': (55.0, 69.0)}
# Mast tops: about 25 m above the street (ref4, from their elevation at the fitted distance). One mast
# per footbridge at each pier (Commons side views); ref4's close pairs are the near and far bridges'.
MAST_TOP = 25.0


def jubilee_bridges(g, mats, bridges):
    """Hungerford Bridge and the Golden Jubilee footbridges. The railway: dark wrought-iron lattice
    girders on cylinder piers, and Brunel's brick pier near the south bank. Each footbridge (4.7 m wide,
    Lifschutz Davidson Sandilands 2002): at each of six piers a white mast rising from a caisson below
    the deck, leaning outward, with a fan of steel rods each way down to the deck's outer edge and
    backstays to its inner edge. At night (Illuminated River, 2021) white light."""
    import bmesh
    from mathutils import Vector
    down, up = bridges.get(JUBILEE_DOWNSTREAM), bridges.get(JUBILEE_UPSTREAM)
    rail = bridges.get(HUNGERFORD)
    if not (down and up):
        print('landmark: Golden Jubilee Bridges not in the data')
        return
    fb = {'down': Polyline(down['pts']), 'up': Polyline(up['pts'][::-1])}
    if (fb['up'].p[0] - fb['down'].p[0]).length > (fb['up'].p[-1] - fb['down'].p[0]).length:
        fb['up'] = Polyline(up['pts'])
    deck = g['SITE']['deck']
    water = g['SITE']['water']
    Z = Vector((0, 0, 1))
    steel, rods, glass, dark, brick = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    deck_leds, mast_leds = bmesh.new(), bmesh.new()

    def outward(name, p):
        other = fb['up' if name == 'down' else 'down']
        q, _ = other.at(other.nearest(p))
        v = p - q
        v.z = 0
        return v.normalized()

    def box(bm, centre, along, across, half_l, half_w, z0, z1):
        corners = [centre + along * (sl * half_l) + across * (sw * half_w) for sl, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        vs = [bm.verts.new(c + Z * z0) for c in corners] + [bm.verts.new(c + Z * z1) for c in corners]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([vs[i] for i in f])

    piers = {}
    for name, line in fb.items():
        # Deck: a 4.7 m box girder 0.9 m deep, glass balustrades and a handrail each side, a strip of
        # light under each edge.
        step = 6.0
        n = max(2, int(line.length / step))
        for i in range(n):
            a, ta = line.at(line.length * i / n)
            b, tb = line.at(line.length * (i + 1) / n)
            o = outward(name, (a + b) / 2)
            box(steel, (a + b) / 2, (b - a).normalized(), o, (b - a).length / 2 + 0.02, 2.35, deck - 0.9, deck)
            for side in (-1, 1):
                e0, e1 = a + o * (side * 2.3), b + o * (side * 2.3)
                box(glass, (e0 + e1) / 2, (b - a).normalized(), o, (b - a).length / 2, 0.02, deck, deck + 1.1)
                tube(steel, e0 + Z * (deck + 1.15), e1 + Z * (deck + 1.15), 0.05, 4)
                tube(deck_leds, e0 + o * (side * 0.05) + Z * (deck - 0.95), e1 + o * (side * 0.05) + Z * (deck - 0.95), 0.06, 4)
        # Pylons.
        piers[name] = []
        for t0 in JUBILEE_PIERS:
            if name == 'up':
                p_down, _ = fb['down'].at(t0)
                t = line.nearest(p_down)
            else:
                t = t0
            p, a = line.at(t)
            o = outward(name, p)
            piers[name].append((p, a, o))
            foot = p - o * 2.8 + Z * (water + 3.0)
            # The pier: a round caisson under the footbridge (Commons photos), a forked cradle up to the deck.
            tube(dark, p - o * 1.0 + Z * (water - 1.0), p - o * 1.0 + Z * (water + 3.0), 3.4, 16)
            for s in (-1, 1):
                tube(steel, foot, p + a * (s * 3.0) + o * 2.3 + Z * (deck - 0.9), 0.25, 8)
            top = p + o * 4.0 + Z * MAST_TOP
            # The mast: 0.81 m at its widest (Structurae), tapering to the top, leaning outward.
            k0 = 0.0
            for j in range(6):
                k1 = (j + 1) / 6
                r = 0.41 - 0.18 * (k0 + k1) / 2
                tube(steel, foot + (top - foot) * k0, foot + (top - foot) * k1, r, 10)
                k0 = k1
            tube(steel, top, top + (top - foot).normalized() * 1.5, 0.14, 6)  # the finial
            tube(mast_leds, top + Z * 0.2, top + Z * 0.5, 0.3, 6)
            # Stays: 19 rods each way from the top to the deck's outer edge (228 a bridge, Structurae),
            # reaching about 30 m along (the longest 37 m).
            for s in (-1, 1):
                for k in range(19):
                    d = 1.5 + k * 1.58
                    q, _ = line.at(t + s * d)
                    tube(rods, top, q + o * 2.35 + Z * (deck - 0.3), 0.016, 3)  # slender rods, about 3 cm
            # Eight backstays inboard, to the railway side of the deck.
            for k in range(8):
                d = (k - 3.5) * 1.8
                q, _ = line.at(t + d)
                tube(rods, top, q - o * 2.35 + Z * (deck - 0.3), 0.022, 3)
    mesh_object(g, 'jubilee_steel', steel, mats['white_steel'])
    mesh_object(g, 'jubilee_rods', rods, mats['rods'])
    mesh_object(g, 'jubilee_glass', glass, mats['balustrade'])
    mesh_object(g, 'jubilee_deck_leds', deck_leds, mats['deck_led'], 'city')
    mesh_object(g, 'jubilee_mast_leds', mast_leds, mats['mast_led'], 'city')
    # White light washing each mast from its foot (Illuminated River's monochrome scheme).
    for name in piers:
        for p, a, o in piers[name]:
            top = p + o * 4.0 + Z * MAST_TOP
            foot = p - o * 2.8 + Z * (deck + 0.2)
            light = g['bpy'].data.lights.new('jubilee_wash', 'SPOT')
            light.energy = 2500.0
            light.color = (0.92, 0.95, 1.0)
            light.spot_size = math.radians(18)
            light.spot_blend = 0.5
            light.shadow_soft_size = 0.2
            ob = g['bpy'].data.objects.new('jubilee_wash', light)
            ob.location = foot - o * 0.8
            ob.rotation_euler = (top - ob.location).to_track_quat('-Z', 'Y').to_euler()
            ob.lightgroup = 'city'
            g['bpy'].context.scene.collection.objects.link(ob)
            # And a lamp at the top, lighting the rods of its fan (brightest near the mast).
            lamp = g['bpy'].data.lights.new('jubilee_top', 'POINT')
            lamp.energy = 600.0
            lamp.color = (0.92, 0.95, 1.0)
            lamp.shadow_soft_size = 0.3
            ob = g['bpy'].data.objects.new('jubilee_top', lamp)
            ob.location = top - Z * 0.6 + o * 0.5
            ob.lightgroup = 'city'
            g['bpy'].context.scene.collection.objects.link(ob)
    # The railway: lattice girders along both edges of Hungerford Bridge's outline, the rail deck between.
    if rail:
        ring = [Vector((x, y, 0)) for x, y in rail['pts']]
        d_line, u_line = fb['down'], fb['up']
        # Each girder runs parallel to its footbridge, 5 m inboard of the footbridge's centreline.
        girders = []
        for name, line in (('down', d_line), ('up', u_line)):
            pts = []
            for t in range(0, int(line.length) + 1, 4):
                p, a = line.at(t)
                pts.append(p - outward(name, p) * 5.0)
            girders.append(pts)
        z_bot, z_top = 6.6, 10.1  # ref4: the girder's chords at the fitted distance
        for pts in girders:
            for z in (z_bot, z_top):
                for i in range(len(pts) - 1):
                    tube(dark, pts[i] + Z * z, pts[i + 1] + Z * z, 0.28, 4)
            for i in range(len(pts) - 1):
                # X bracing in 4 m panels, with posts.
                tube(dark, pts[i] + Z * z_bot, pts[i + 1] + Z * z_top, 0.1, 3)
                tube(dark, pts[i] + Z * z_top, pts[i + 1] + Z * z_bot, 0.1, 3)
                tube(dark, pts[i] + Z * z_bot, pts[i] + Z * z_top, 0.12, 3)
        # The rail deck: a dark slab between the girders.
        for i in range(0, min(len(girders[0]), len(girders[1])) - 1):
            a0, a1 = girders[0][i], girders[0][i + 1]
            b1, b0 = girders[1][min(i + 1, len(girders[1]) - 1)], girders[1][i]
            vs = [dark.verts.new(v + Z * z_bot) for v in (a0, a1, b1, b0)]
            dark.faces.new(vs)
            vs = [dark.verts.new(v + Z * (z_bot - 1.2)) for v in (b0, b1, a1, a0)]
            dark.faces.new(vs)
        # Iron cylinder piers (Commons photos: between the pylons' caissons), halfway between pylons,
        # four across the railway.
        spots = [(a + b) / 2 for a, b in zip(JUBILEE_PIERS, JUBILEE_PIERS[1:])]
        for t in spots:  # Brunel's pier left out (below): iron piers there too
            k = min(int(t / 4), len(girders[0]) - 1, len(girders[1]) - 1)
            a0, b0 = girders[0][k], girders[1][k]
            for f in (0.0, 0.33, 0.67, 1.0):
                q = a0 + (b0 - a0) * f
                tube(dark, q + Z * (water - 1), q + Z * (z_bot - 1.2), 1.3, 14)
        # Brunel's brick pier (1845) is left out, its heads and its body (user's choice, 2026-10-02): from
        # the bridge it read as a block standing in front of Hungerford Bridge, not as part of it.
    mesh_object(g, 'hungerford_iron', dark, mats['truss'])
    mesh_object(g, 'hungerford_brick', brick, mats['brick'])
    print('landmark: Hungerford and Golden Jubilee Bridges')




def opal_material(g):
    """Elizabeth Tower's dials: opal glass, white by day, lit from behind at night (the Emission is the
    city's light, switched by skyline.py)."""
    bpy, node = g['bpy'], g['node']
    mat = bpy.data.materials.new('clock_face')
    nt = g['nodes_of'](mat)
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.35, **{'Base Color': (0.7, 0.69, 0.62, 1)})
    e = node(nt, 'ShaderNodeEmission', Strength=9.0, Color=(1.0, 0.95, 0.82, 1))
    g['output'](nt, g['add_shaders'](nt, b.outputs[0], e.outputs[0]))
    return mat


def gilt_material(g):
    """Gilding (the dials' surrounds, the spires' finials and crockets): gold leaf, a little worn; it takes
    the floodlight warm at night."""
    bpy, node = g['bpy'], g['node']
    mat = bpy.data.materials.new('gilt')
    nt = g['nodes_of'](mat)
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.32, Metallic=1.0, **{'Base Color': (0.8, 0.58, 0.27, 1)})
    e = node(nt, 'ShaderNodeEmission', Strength=2.5, Color=(1.0, 0.64, 0.3, 1))
    g['output'](nt, g['add_shaders'](nt, b.outputs[0], e.outputs[0]))
    return mat


def flag_material(g):
    """The Union Flag on Victoria Tower (flown when Parliament sits; a few pixels across here): blue
    field, the white saltire and cross, the red cross, by the flag's own UVs."""
    bpy, node, math_node, mix = g['bpy'], g['node'], g['math_node'], g['mix_colour']
    mat = bpy.data.materials.new('flag')
    nt = g['nodes_of'](mat)
    uv = node(nt, 'ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs[0])
    u, v = sep.outputs['X'], sep.outputs['Y']
    du = math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', u, 0.5))
    dv = math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', v, 0.5))
    diag = math_node(nt, 'LESS_THAN', math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', du, dv)), 0.07)  # the saltire, corner to corner
    white = math_node(nt, 'MAXIMUM', math_node(nt, 'MAXIMUM', math_node(nt, 'LESS_THAN', du, 0.1), math_node(nt, 'LESS_THAN', dv, 0.17)), diag)
    red = math_node(nt, 'MAXIMUM', math_node(nt, 'LESS_THAN', du, 0.06), math_node(nt, 'LESS_THAN', dv, 0.1))
    col = mix(nt, white, (0.012, 0.03, 0.14), (0.75, 0.75, 0.72))
    col = mix(nt, red, col, (0.5, 0.02, 0.03))
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.8)
    nt.links.new(col, b.inputs['Base Color'])
    b.inputs['Coat Weight'].default_value = 0.0
    g['output'](nt, b.outputs[0])
    return mat


def elizabeth_tower(g, mats):
    """Elizabeth Tower (Barry and Pugin, 1859; 96 m; the shaft 12 m square), on OSM's outline and axes
    (way/123557148), in its stages as set2/big-c003 shows them, scaled by the dials (7 m across, their
    centres 55 m up): the plinth; the panelled shaft with its corner buttresses; the clock stage corbelled
    out (49.3 to 61.1 m), a dial in a gilt surround on each face; the short belfry band (to 64.6 m); the
    lower iron roof, 14 m wide at its eaves to 7.7 m, with gilt dormers; the gilt lantern of the Ayrton
    Light on its gallery (72.5 to 78 m); the upper spire (to 92.2 m) and the gilt finial. Pinnacles at
    the clock stage's corners, at the lower roof's and round the lantern's top."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, square_stack, pinnacle, gable, lathe
    fp = g['scene_data'].get('replacedOutlines', {}).get(ELIZABETH)
    if not fp:
        print('landmark: Elizabeth Tower footprint not in the data')
        return
    c, ax, ay = _axes(fp['outer'][0])
    faces = ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax))
    stone = bmesh.new()
    square_stack(stone, c, ax, ay, [(0, 7.4, 7.4), (7, 7.4, 7.4), (7, 6.9, 6.9), (48.5, 6.9, 6.9), (49.3, 7.35, 7.35),
                                    (60.4, 7.35, 7.35), (60.4, 7.6, 7.6), (61.1, 7.6, 7.6), (61.1, 7.0, 7.0), (64.6, 7.0, 7.0)], cap_top=False)
    # Corner buttresses up the shaft, standing 0.45 m proud.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        square_stack(stone, c + ax * (sx * 6.55) + ay * (sy * 6.55), ax, ay, [(7, 0.8, 0.8), (48.5, 0.8, 0.8)])
    g['facade_object']('elizabeth_stone', stone, ANSTON, IRON_ROOF, style=4, bay=1.45, floorh=5.2, win_w=0.12, win_h=0.38, frame=0.3,
                       busy=0.0, flood=FLOODLIT['Elizabeth Tower'])
    iron = bmesh.new()
    square_stack(iron, c, ax, ay, [(64.6, 7.1, 7.1), (72.5, 3.85, 3.85)], cap_top=False)  # the lower roof
    square_stack(iron, c, ax, ay, [(78.3, 3.6, 3.6), (92.2, 0.2, 0.2), (92.4, 0.0, 0.0)])  # the upper spire
    g['facade_object']('elizabeth_spire', iron, ANSTON, IRON_ROOF, style=3, roof_nz=-1.0, flood=0.5)
    lantern = bmesh.new()
    square_stack(lantern, c, ax, ay, [(72.5, 4.2, 4.2), (73.2, 4.2, 4.2), (73.2, 3.75, 3.75), (77.9, 3.75, 3.75), (77.9, 4.0, 4.0),
                                      (78.3, 4.0, 4.0)], cap_bottom=True)
    g['facade_object']('elizabeth_lantern', lantern, (0.55, 0.42, 0.2), IRON_ROOF, style=4, bay=1.25, floorh=4.7, win_w=0.3, win_h=0.4,
                       frame=0.5, busy=0.0, flood=1.6)
    gilt = bmesh.new()
    # The dials' gilt surrounds, 8.4 m square; dormers on the lower roof; the orb and finial.
    for d, o in faces:
        square_stack(gilt, c + d * 7.45, o, d, [(50.8, 4.2, 0.12), (59.2, 4.2, 0.12)], cap_bottom=True)
        for k in (-2.6, 0.0, 2.6):
            gable(gilt, c + d * 6.0 + o * k, o, d, 0.9, 1.2, 66.2, 1.7)
    lathe(gilt, c, [(92.1, 0.25), (92.6, 0.5), (93.1, 0.5), (93.5, 0.1), (96.0, 0.06), (96.0, 0.0)], sides=12)
    mesh_object(g, 'elizabeth_gilt', gilt, mats['gilt'], 'city')
    pins = bmesh.new()
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pinnacle(pins, c + ax * (sx * 7.25) + ay * (sy * 7.25), 61.1, 0.8, 1.6, 2.2, sides=8)  # the clock stage's corners
        pinnacle(pins, c + ax * (sx * 6.75) + ay * (sy * 6.75), 64.6, 0.45, 3.8, 2.6, sides=6)  # the lower roof's
        pinnacle(pins, c + ax * (sx * 3.85) + ay * (sy * 3.85), 78.3, 0.4, 0.9, 1.6, sides=6)  # round the lantern's top
    g['facade_object']('elizabeth_pinnacles', pins, (0.45, 0.35, 0.18), IRON_ROOF, style=3, roof_nz=-1.0, flood=1.0)
    dials = bmesh.new()
    for d, _ in faces:
        res = bmesh.ops.create_circle(dials, cap_ends=True, segments=40, radius=3.5)
        q = Vector((0, 0, 1)).rotation_difference(d)
        for v in res['verts']:
            v.co = q @ v.co + c + d * 7.6 + Z * 55.0
    mesh_object(g, 'clock_faces', dials, mats['clock'], 'city')
    print('landmark: Elizabeth Tower')


def victoria_tower(g, mats):
    """Victoria Tower (98.5 m to its turrets' tops; 23 m square): the panelled shaft to a battlemented
    parapet at 77 m, an octagonal turret at each corner rising past it to an open stage and a crocketed
    spirelet ringed by small pinnacles, two lesser pinnacles on each face between them, the low iron roof
    and the flagstaff (OSM: its top 120 m) with the Union Flag. Centre and axes from OSM's base (way/
    1134791149); the stages' heights from OSM's parts and ref4."""
    import bmesh
    from shapes import Z, square_stack, pinnacle, lathe
    from mathutils import Vector
    base = next((b for b in g['scene_data']['buildings'] if b['id'] == VICTORIA_BASE), None)
    if not base:
        print('landmark: Victoria Tower not in the data')
        return
    c, ax, ay = _axes(base['outer'][0])
    hw = 11.1
    stone = bmesh.new()
    square_stack(stone, c, ax, ay, [(0, hw, hw), (75.5, hw, hw), (75.5, hw + 0.25, hw + 0.25), (77.0, hw + 0.25, hw + 0.25),
                                    (77.0, 8.6, 8.6), (85.5, 1.2, 1.2), (86.5, 0.6, 0.6)])
    # Battlements: merlons 1.2 m tall, 1.4 m wide, every 2.8 m along the parapet.
    for d, o in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
        k = -8.4
        while k <= 8.41:
            square_stack(stone, c + d * (hw + 0.05) + o * k, o, d, [(77.0, 0.7, 0.2), (78.2, 0.7, 0.2)])
            k += 2.8
    turrets = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        q = c + ax * (sx * (hw - 1.0)) + ay * (sy * (hw - 1.0))
        turrets.append(q)
        lathe(stone, q, [(0, 2.75), (84.0, 2.75), (84.0, 3.05), (85.0, 3.05), (85.0, 2.75), (89.5, 2.75), (89.5, 3.15), (90.2, 3.15)],
              sides=8, phase=math.pi / 8, axes=(ax, ay))
    g['facade_object']('victoria_tower', stone, ANSTON, IRON_ROOF, style=4, bay=1.6, floorh=4.8, win_w=0.13, win_h=0.37, frame=0.3,
                       busy=0.02, flood=FLOODLIT['Victoria Tower'])
    spires = bmesh.new()
    for q in turrets:
        # The spirelet (set2/big-c123): a neck over the turret's top, a swelling cap, then a slender point.
        lathe(spires, q, [(90.2, 2.6), (90.8, 2.6), (91.2, 1.8), (92.8, 2.15), (94.6, 1.3), (96.5, 0.45), (98.5, 0.0)], sides=8, phase=math.pi / 8,
              axes=(ax, ay))
        for i in range(8):
            t = (i + 0.5) / 8 * math.tau
            p = q + ax * (2.9 * math.cos(t)) + ay * (2.9 * math.sin(t))
            pinnacle(spires, p, 90.2, 0.35, 0.8, 1.7, sides=4)
    for d, o in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
        for k in (-3.7, 3.7):
            p = c + d * (hw - 0.6) + o * k
            lathe(spires, p, [(70, 0.95), (87.0, 0.95), (87.0, 1.2), (87.5, 1.2), (87.9, 0.9), (89.3, 0.55), (90.8, 0.25), (93.5, 0.0)],
                  sides=8, phase=math.pi / 8, axes=(ax, ay))
    g['facade_object']('victoria_spires', spires, ANSTON, (0.12, 0.1, 0.08), style=3, roof_nz=-1.0, flood=FLOODLIT['Victoria Tower'] * 0.8)
    pole = bmesh.new()
    tube(pole, c + Z * 86.5, c + Z * 120.0, 0.22, 8)
    mesh_object(g, 'victoria_flagstaff', pole, g['MAT']['iron'])
    # The flag: 6 by 3 m (ref4's flag at the fitted distance), flying from the staff's top, a little
    # slack, downwind of the prevailing south-westerly.
    flag = bmesh.new()
    uv = flag.loops.layers.uv.new('UVMap')
    fly = (ax * 0.6 + ay * 0.8).normalized()
    cols = 8
    rows = []
    for i in range(cols + 1):
        t = i / cols
        p = c + fly * (6.0 * t) + Z * (math.sin(t * 5.0) * 0.25)
        rows.append((flag.verts.new(p + Z * (119.6 - 3.0 - 0.5 * t)), flag.verts.new(p + Z * (119.6 - 0.3 * t))))
    for i in range(cols):
        f = flag.faces.new((rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]))
        for loop, (u, v) in zip(f.loops, ((i / cols, 0), ((i + 1) / cols, 0), ((i + 1) / cols, 1), (i / cols, 1))):
            loop[uv].uv = (u, v)
    mesh_object(g, 'victoria_flag', flag, mats['flag'])
    print('landmark: Victoria Tower')


def central_tower(g, mats):
    """The Central Tower over the Central Lobby: from the roofs at 25 m a low octagonal roof, the
    octagonal lantern of tall windows (10 m across) with a pinnacle at each corner, a narrower stage and
    the slender spire to 78 m, as OSM's parts give it (way/123557145 and those above it). The photos from
    the bridge (ref4, set2/big-c123) agree: its tip shows inside Victoria Tower's crown, about 3.5 degrees
    up, where a 91 m spire (a published figure) would stand clear above the crown."""
    import bmesh
    from shapes import pinnacle, lathe
    from mathutils import Vector
    base = next((b for b in g['scene_data']['buildings'] if b['id'] == CENTRAL_TOWER), None)
    if not base:
        return
    cx, cy = _centroid(base['outer'][0])
    c = Vector((cx, cy, 0))
    ph = math.pi / 8
    stone = bmesh.new()
    lathe(stone, c, [(24.0, 9.6), (25.0, 9.6), (36.5, 5.4), (49.0, 5.4), (49.0, 5.7), (50.0, 5.7), (50.0, 3.4), (61.5, 3.4)], sides=8, phase=ph)
    g['facade_object']('central_tower', stone, ANSTON, IRON_ROOF, style=4, bay=1.4, floorh=6.0, win_w=0.15, win_h=0.42, frame=0.3,
                       busy=0.0, flood=0.8, roof_nz=0.02)
    spire = bmesh.new()
    lathe(spire, c, [(61.5, 3.4), (61.5, 2.8), (77.0, 0.15), (78.0, 0.0)], sides=8, phase=ph)
    g['facade_object']('central_spire', spire, ANSTON, IRON_ROOF, style=3, roof_nz=-1.0, flood=0.6)
    pins = bmesh.new()
    for i in range(8):
        t = ph + i / 8 * math.tau
        pinnacle(pins, c + Vector((5.3 * math.cos(t), 5.3 * math.sin(t), 0)), 50.0, 0.7, 2.6, 3.4, sides=8)
        pinnacle(pins, c + Vector((3.3 * math.cos(t), 3.3 * math.sin(t), 0)), 61.5, 0.4, 1.0, 2.0, sides=6)
    g['facade_object']('central_pinnacles', pins, ANSTON, ANSTON, style=3, roof_nz=-1.0, flood=0.6)
    print('landmark: Central Tower')


def palace_pinnacles(g):
    """The Palace's river front and courts bristle with pinnacles (every photo's spiky roofline): one at
    each corner of its roofs between 15 and 45 m and every 7 m along their edges, 0.8 m square, 2 m of
    shaft and a 2.6 m spirelet, all stone. OSM maps the towers' pinnacles, not these."""
    import bmesh
    from mathutils import Vector
    from shapes import pinnacle, edge_points
    bm = bmesh.new()
    n = 0
    for b in g['scene_data']['buildings']:
        if (b.get('within') or {}).get('name') != 'Palace of Westminster' or b['id'] in _prepared.get('replaced', ()):
            continue
        if b['roof']['shape'] != 'flat' or not (15 <= b['height'] <= 45):
            continue
        ring = b['outer'][0]
        if abs(g['signed_area'](ring)) < 30:
            continue
        top = b.get('base', 0.0) + b['height']
        for p, inward in edge_points(ring, 7.0):
            pinnacle(bm, p + inward * 0.4, top, 0.6, 2.4, 2.6)
            n += 1
    g['facade_object']('palace_pinnacles', bm, ANSTON, ANSTON, style=3, roof_nz=-1.0, flood=0.7)
    print(f'landmark: Palace pinnacles ({n})')


def millbank_tower(g):
    """Millbank Tower (1963; 118 m, 32 floors): OSM's outline (way/24553530), its curved ends rounded as
    built, raised from the podium's roof at 9.6 m as a curtain wall of dark blue-green glass between close
    mullions; the top two floors a plant room behind louvres, set back a metre."""
    import bmesh
    from shapes import chaikin, inset, prism
    b = next((b for b in g['scene_data']['buildings'] if b['id'] == MILLBANK), None)
    if not b:
        return
    ring = chaikin(b['outer'][0], rounds=2)
    bm = bmesh.new()
    prism(bm, ring, b['min'], 111.6)
    g['facade_object']('millbank_tower', bm, (0.04, 0.05, 0.055), (0.12, 0.12, 0.12), style=0, bay=1.25, floorh=3.4, win_w=0.45, win_h=0.37,
                       frame=0.08, busy=0.2)
    top = inset(ring, 1.0) or ring
    bm = bmesh.new()
    prism(bm, top, 111.6, 118.0)
    g['facade_object']('millbank_plant', bm, (0.1, 0.105, 0.11), (0.12, 0.12, 0.12), style=3)
    print('landmark: Millbank Tower')


def st_george_wharf(g):
    """St George Wharf Tower (Vauxhall, 2014; 181 m with its turbine): a faceted glass drum 34 m across
    (OSM's rings: 148, 160 and 168 m), tapering straight in over its top 25 m to the square frame round
    the wind turbine at the top (ref4, set2/c116)."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, lathe, square_stack
    bs = [b for b in g['scene_data']['buildings'] if b['id'] in ST_GEORGE]
    if not bs:
        return
    cx, cy = _centroid(max(bs, key=lambda b: b['height'])['outer'][0])
    c = Vector((cx, cy, 0))
    bm = bmesh.new()
    lathe(bm, c, [(0, 17.0), (147, 17.0), (160, 13.5), (168, 10.0), (171, 7.0)], sides=20)
    g['facade_object']('st_george_wharf', bm, (0.05, 0.055, 0.06), (0.1, 0.1, 0.1), style=0, bay=1.4, floorh=3.2, win_w=0.45, win_h=0.38,
                       frame=0.1, busy=0.25, roof_nz=0.3)
    frame = bmesh.new()
    ax, ay = Vector((1, 0, 0)), Vector((0, 1, 0))
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        q = c + ax * (sx * 4.2) + ay * (sy * 4.2)
        square_stack(frame, q, ax, ay, [(171, 0.35, 0.35), (181, 0.35, 0.35)])
    for z in (176.0, 180.6):
        square_stack(frame, c, ax, ay, [(z, 4.55, 4.55), (z + 0.4, 4.55, 4.55)], cap_bottom=True)
    g['facade_object']('st_george_frame', frame, (0.3, 0.31, 0.32), (0.3, 0.31, 0.32), style=3)
    print('landmark: St George Wharf Tower')


def whitehall_court_roofs(g):
    """Whitehall Court (1887, French Renaissance; OSM's walls to 28.8 m, a flat roof): its steep slate
    roofs, a mansard round the whole block rising 7 m, a pavilion turret with a pointed slate spire at
    each sharp corner, and chimney stacks along the ridge (the spiky right-hand edge of the photos taken
    upstream, set2/c013, c078)."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, inset, prism, edge_points, lathe, box, ccw
    b = next((b for b in g['scene_data']['buildings'] if b.get('name') == 'Whitehall Court'), None)
    if not b:
        return
    ring = ccw([tuple(p) for p in b['outer'][0]])
    z0 = b.get('base', 0.0) + b['height']
    top = inset(ring, 3.5)
    if not top:
        print('landmark: Whitehall Court roof inset failed')
        return
    bm = bmesh.new()
    # The mansard: the outline at the eaves to the inset outline 7 m up (the two have the same vertex count
    # when the inset dropped none; otherwise a hipped prism of the inset alone).
    if len(top) == len(ring):
        lo = [bm.verts.new((x, y, z0)) for x, y in ring]
        hi = [bm.verts.new((x, y, z0 + 7.0)) for x, y in top]
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        from mathutils import geometry
        for t in geometry.tessellate_polygon([[Vector((x, y, 0)) for x, y in top]]):
            bm.faces.new((hi[t[0]], hi[t[1]], hi[t[2]]))
    else:
        prism(bm, top, z0, z0 + 7.0)
    g['facade_object']('whitehall_court_roof', bm, PORTLAND, SLATE, style=3, roof_nz=0.02)
    turrets, spires, stacks = bmesh.new(), bmesh.new(), bmesh.new()
    n = 0
    for p, inward in edge_points(ring, 1e9, corner_min_deg=55.0):
        q = p + inward * 1.6
        lathe(turrets, q, [(z0 - 6, 2.3), (z0 + 6.5, 2.3)], sides=8)
        lathe(spires, q, [(z0 + 6.5, 2.6), (z0 + 15.5, 0.0)], sides=8)
        n += 1
    for p, inward in edge_points(top, 13.0, corner_min_deg=200.0, margin=3.0):
        box(stacks, p + inward * 0.8, Vector((1, 0, 0)), Vector((0, 1, 0)), 0.8, 0.45, z0 + 5.0, z0 + 10.0)
    g['facade_object']('whitehall_court_turrets', turrets, PORTLAND, SLATE, style=4, bay=1.6, floorh=3.6, win_w=0.16, win_h=0.3, busy=0.1,
                       flood=FLOODLIT['Whitehall Court'])
    g['facade_object']('whitehall_court_spires', spires, PORTLAND, SLATE, style=3, roof_nz=-1.0)
    g['facade_object']('whitehall_court_stacks', stacks, (0.2, 0.15, 0.11), SLATE, style=3)
    print(f'landmark: Whitehall Court roofs ({n} turrets)')


# The Victoria Embankment's lamp standards (Bazalgette's dolphin lamps, 1870s) along the river wall,
# with the strings of bulbs hung between them, and the South Bank's lamps along the Queen's Walk: the
# rows of warm lights on both banks in every night view. OSM maps few of them, so they follow the river
# wall as mapped (the Thames relation), within 1.5 km of the vantage.
EMBANKMENT_LAMP_EVERY = 27.0  # metres
NORTH_BRIDGEHEAD = (-150.0, 230.0)  # Waterloo Bridge's ends, for finding each bank on the river's ring
SOUTH_BRIDGEHEAD = (80.0, -170.0)


def bank(ring, start, reach):
    """The river wall either side of the ring vertex nearest `start`, while within `reach` of the vantage."""
    n = len(ring) - 1 if ring[0] == ring[-1] else len(ring)
    i0 = min(range(n), key=lambda i: math.dist(ring[i], start))
    pts = [ring[i0]]
    for step in (-1, 1):
        i = i0
        side = []
        while True:
            i = (i + step) % n
            if math.hypot(*ring[i]) > reach or len(side) > n:
                break
            side.append(ring[i])
        pts = (side[::-1] + pts) if step == -1 else (pts + side)
    return pts


def embankment_lights(g, mats):
    import bmesh
    from mathutils import Vector
    bpy = g['bpy']
    inside = g['inside']
    thames = next((w for w in g['scene_data']['water'] if w['id'] == 'relation/28934'), None)
    if not thames:
        print('landmark: no Thames in the data, no embankment lights')
        return
    ring = [tuple(p) for p in thames['outer'][0]]
    posts, lanterns, bulbs = bmesh.new(), bmesh.new(), bmesh.new()
    count = 0
    for head, chains in ((NORTH_BRIDGEHEAD, True), (SOUTH_BRIDGEHEAD, False)):
        wall = bank(ring, head, 1500.0)
        # Lamp positions every EMBANKMENT_LAMP_EVERY metres along the wall, 1.5 m inland.
        lamps = []
        carry = 0.0
        for a, b in zip(wall, wall[1:]):
            a, b = Vector((*a, 0)), Vector((*b, 0))
            seg = (b - a).length
            if seg < 1e-3:
                continue
            u = (b - a) / seg
            nrm = Vector((-u.y, u.x, 0))
            mid = (a + b) / 2
            if inside(ring, tuple(mid + nrm * 2.0)[:2]):
                nrm = -nrm  # point inland, away from the water
            t = EMBANKMENT_LAMP_EVERY - carry
            while t <= seg:
                lamps.append(a + u * t + nrm * 1.5)
                t += EMBANKMENT_LAMP_EVERY
            carry = seg - (t - EMBANKMENT_LAMP_EVERY)
        for p in lamps:
            tube(posts, p, p + Vector((0, 0, 4.6)), 0.12, 8)
            res = bmesh.ops.create_uvsphere(lanterns, u_segments=8, v_segments=6, radius=0.28)
            for v in res['verts']:
                v.co = v.co + p + Vector((0, 0, 4.9))
            light = bpy.data.lights.new('embankment_lamp', 'POINT')
            light.energy = 120.0
            light.color = (1.0, 0.72, 0.45)
            light.shadow_soft_size = 0.3
            ob = bpy.data.objects.new('embankment_lamp', light)
            ob.location = p + Vector((0, 0, 4.9))
            ob.lightgroup = 'city'
            bpy.context.scene.collection.objects.link(ob)
            count += 1
        if chains:
            # Festoons: twelve bulbs a span, sagging 0.7 m between the lanterns.
            for p, q in zip(lamps, lamps[1:]):
                if (q - p).length > EMBANKMENT_LAMP_EVERY * 1.6:
                    continue  # a gap (a pier, a bridge): no string across it
                for k in range(1, 12):
                    s = k / 12
                    c = p + (q - p) * s + Vector((0, 0, 4.6 - 0.7 * 4 * s * (1 - s)))
                    res = bmesh.ops.create_uvsphere(bulbs, u_segments=6, v_segments=4, radius=0.07)
                    for v in res['verts']:
                        v.co = v.co + c
    mesh_object(g, 'embankment_posts', posts, g['MAT']['iron'])
    mesh_object(g, 'embankment_lanterns', lanterns, mats['lantern'], 'city')
    mesh_object(g, 'embankment_festoons', bulbs, mats['festoon'], 'city')
    print(f'landmark: embankment lamps ({count})')
