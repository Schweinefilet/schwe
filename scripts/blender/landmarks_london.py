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
REPLACES = {EYE_WAY, HUNGERFORD}
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


def build(g):
    bridges = {b['id']: b for b in g['scene_data']['bridges']}
    mats = materials(g)
    london_eye(g, mats, footprint_of(g, EYE_WAY))
    jubilee_bridges(g, mats, bridges)
    clock_faces(g, mats)
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
        'led': em('eye_led', EYE_LED, 40.0),
        'mast_led': em('mast_led', (0.85, 0.9, 1.0), 30.0),
        'deck_led': em('deck_led', (0.7, 0.75, 1.0), 6.0),
        'cable': sm('cable', (0.55, 0.56, 0.57), 0.4, Metallic=0.5),
        'rods': rods_material(g),
        'balustrade': sm('balustrade', (0.6, 0.63, 0.64), 0.05, **{'Transmission Weight': 0.85}),
        'truss': sm('truss', (0.05, 0.05, 0.055), 0.6, Metallic=0.6),
        'brick': brick_material(g),
        'clock': em('clock_face', (1.0, 0.95, 0.82), 9.0),
        'lantern': em('lantern', (1.0, 0.8, 0.55), 25.0),
        'festoon': em('festoon', (1.0, 0.85, 0.62), 30.0),
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
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.3, Metallic=0.7, **{'Base Color': (0.7, 0.71, 0.72, 1)})
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
        for t in spots:
            if BRUNEL_PIER['along'][0] - 3 <= t <= BRUNEL_PIER['along'][1] + 3:
                continue
            k = min(int(t / 4), len(girders[0]) - 1, len(girders[1]) - 1)
            a0, b0 = girders[0][k], girders[1][k]
            for f in (0.0, 0.33, 0.67, 1.0):
                q = a0 + (b0 - a0) * f
                tube(dark, q + Z * (water - 1), q + Z * (z_bot - 1.2), 1.3, 14)
        # Brunel's brick pier (1845): the body across the whole bridge below the railway, and each end
        # rising to a round-arched head (ref4: the downstream head's top about 15.4 m up).
        t0, t1 = BRUNEL_PIER['along']
        p0, a = d_line.at((t0 + t1) / 2)
        q0, _ = u_line.at(u_line.nearest(p0))
        across = (q0 - p0).normalized()  # downstream to upstream
        half_l, z_head, rise = (t1 - t0) / 2, 12.0, 3.4
        lo, hi = -BRUNEL_PIER['down'][1], BRUNEL_PIER['up'][1]
        box(brick, p0 + across * ((lo + hi) / 2), a, across, half_l, (hi - lo) / 2, water - 1, 5.2)
        for e0, e1 in ((-BRUNEL_PIER['down'][1], -BRUNEL_PIER['down'][0]), BRUNEL_PIER['up']):
            centre = p0 + across * ((e0 + e1) / 2)
            half_w = (e1 - e0) / 2
            box(brick, centre, a, across, half_l, half_w, water - 1, z_head)
            # The arched head: a half disc spanning the pier's length, run the width of the end.
            for j in range(12):
                s0, s1 = math.pi * j / 12, math.pi * (j + 1) / 12
                ring_pts = [centre + a * (half_l * math.cos(s)) + Z * (z_head + rise * math.sin(s)) for s in (s0, s1)]
                vs = [brick.verts.new(v + across * (sw * half_w)) for v in (centre + Z * z_head, *ring_pts) for sw in (-1, 1)]
                brick.faces.new((vs[0], vs[2], vs[4]))
                brick.faces.new((vs[5], vs[3], vs[1]))
                brick.faces.new((vs[2], vs[3], vs[5], vs[4]))
    mesh_object(g, 'hungerford_iron', dark, mats['truss'])
    mesh_object(g, 'hungerford_brick', brick, mats['brick'])
    print('landmark: Hungerford and Golden Jubilee Bridges')




def clock_faces(g, mats):
    """Elizabeth Tower's four dials (7 m across, their centres about 55 m up: between the clock stage's
    corner turrets, 51.5 m, and the belfry's pinnacles, 60.5 m, as OSM maps them), on the tower's own
    faces, glowing through their opal glass at night."""
    import bmesh
    from mathutils import Vector
    fp = g['scene_data'].get('replacedOutlines', {}).get(ELIZABETH)
    if not fp:
        print('landmark: Elizabeth Tower footprint not in the data')
        return
    ring = [Vector((x, y, 0)) for x, y in fp['outer'][0]]
    if (ring[0] - ring[-1]).length < 1e-6:
        ring = ring[:-1]
    c = sum(ring, Vector()) / len(ring)
    # The tower's axes: its longest edge's direction and the perpendicular.
    a, b = max(((ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))), key=lambda e: (e[1] - e[0]).length)
    ax = (b - a).normalized()
    ay = Vector((-ax.y, ax.x, 0))
    bm = bmesh.new()
    for d in (ax, -ax, ay, -ay):
        half = max((p - c).dot(d) for p in ring)
        res = bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=3.5)
        q = Vector((0, 0, 1)).rotation_difference(d)
        for v in res['verts']:
            v.co = q @ v.co + c + d * (half + 0.3) + Vector((0, 0, 55.0))
    mesh_object(g, 'clock_faces', bm, mats['clock'], 'city')
    print('landmark: Elizabeth Tower clock faces')


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
