"""New York's landmarks for scripts/blender/skyline.py, modelled from published dimensions and OpenStreetMap
and checked against the reference photos in data/refs/new-york/ (Wikimedia Commons, see sources.json).

REPLACES: OpenStreetMap elements drawn here instead of raised from their outline.
build(g): g is skyline.py's globals (bpy, MAT, MeshBuilder, scene_data, SITE, rng, …).

Heights: the scene's z = 0 is the Lower Manhattan waterfront, 2.5 m above NAVD88; the water stands at
SITE['water'] (mean sea level). Published heights above the water or the ground are placed on those.
"""

import math

ONE_WTC = 'way/713565776'
BB_TOWER = 'way/1255363983'  # the Brooklyn Bridge's Manhattan tower (OSM: an 82.9 m stone block)
BB_OUTLINE = 'way/375157262'  # its outline as man_made=bridge (a 26 m slab at deck height otherwise)
# The Woolworth Building's tower above its 120 m base, mapped as twelve parts (the stages, the corner
# turrets, the pyramid): modelled whole here (woolworth), on the lowest stage's outline.
WOOLWORTH_STAGE = 'way/274782323'
WOOLWORTH_TOWER = {f'way/{i}' for i in (274782323, 274782325, 274782327, 274782329, 274782330, 274782332, 274782334, 274782336, 274782339,
                                        274782341, 274782344)}
# The Empire State Building's mooring mast and antenna, mapped as two pyramids (330 to 390 m and to 443.2 m):
# modelled here (empire_state), on the antenna part's centre.
ESB_ANTENNA = 'way/137425145'
ESB_MAST = {ESB_ANTENNA, 'way/265932618'}
# 8 Spruce Street (Frank Gehry, 2011; 265 m to the roof, OSM 271.6 m): mapped as eight stainless parts
# stepping down from the tower; raised here on their outlines with Gehry's rippling bays (spruce8).
SPRUCE8 = {f'way/{i}' for i in (274750635, 274750636, 274750637, 274750638, 274750639, 274750643, 274750646, 274750647)}
REPLACES = {ONE_WTC, BB_TOWER, BB_OUTLINE} | WOOLWORTH_TOWER | ESB_MAST | SPRUCE8
# The heroes: what says "New York" with every other building hidden (skyline.py --only heroes). The
# Chrysler Building and 432 Park Avenue are not drawn from OSM (extract.mjs LANDMARK_POINTS places them).
HEROES = {'Empire State Building', 'Woolworth Building'}
OBJECT_PREFIXES = {'one', 'bb', 'woolworth', 'esb', 'chrysler', 'park432', 'spruce8'}
# Each landmark's own stone and facade over all its OSM parts (filler.py add_building), instead of OSM's
# palette colour and the generic office windows: the Woolworth Building's cream terracotta in gothic piers;
# the Empire State Building's Indiana limestone with its aluminium spandrels in continuous vertical strips
# (style 5, art deco).
WOOL_TERRACOTTA = (0.44, 0.41, 0.33)
COPPER = (0.075, 0.13, 0.105)  # weathered copper, the Woolworth roof's green-grey in ref2 and set2/p020
ESB_LIMESTONE = (0.4, 0.38, 0.33)
OVERRIDES = {
    'Woolworth Building': dict(wall=WOOL_TERRACOTTA, roof=COPPER, style=4, cell=(1.9, 3.9, 0.17, 0.36, 0.3), busy=0.15),
    'Empire State Building': dict(wall=ESB_LIMESTONE, roof=(0.2, 0.2, 0.2), style=5, cell=(1.75, 3.73, 0.2, 0.4, 0.45)),
}
_prepared = {}


def is_hero(b):
    return b.get('name') in HEROES or (b.get('within') or {}).get('name') in HEROES


def prepare(scene_data):
    """Notes the outlines of the OSM parts the models replace (skyline.py then skips them)."""
    for b in scene_data['buildings']:
        if b['id'] in (WOOLWORTH_STAGE, ESB_ANTENNA) or b['id'] in SPRUCE8:
            _prepared[b['id']] = b
    return set()
# Floodlit at night, by name (a building or the building a part belongs to) or a part by its OSM id,
# relative brightness. The crowns the reference photos show lit: the Woolworth Building's gold from its
# setbacks up (ref5, ref8; its parts above 120 m); two lit spires among the pre-war towers (ref8): 70 Pine's
# lantern and spire (its parts above 242 m) and 40 Wall Street's copper pyramid and spire; and at the view's
# right edge the Empire State Building's top (its parts above 255 m), lit every night.
FLOODLIT = {
    'Woolworth Building': 0.6,
    **{f'way/{i}': 1.0 for i in (274782341, 274782325, 274782329, 274782334, 274782339, 274782344, 274782327, 274782330,
                                 274782332, 274782336, 274782323)},
    **{f'way/{i}': 0.9 for i in (286032722, 286032716, 286032720, 286032710, 286032719, 286032714, 286032721, 286032743,
                                 286032742, 286032740)},
    **{f'way/{i}': 0.9 for i in (277555174, 286057082, 286057109, 286057105)},
    **{f'way/{i}': 1.4 for i in (137425145, 265932618, 137425125, 137425129)},
}

# One World Trade Center (Wikipedia): a 61 m (200 ft) square; a 56 m (185 ft) windowless base; from there
# its edges chamfered into eight isosceles triangles up to the roof at 417.0 m, where the square is turned
# 45 degrees (OSM maps it with its corners at the base's edge midpoints); a glass parapet 10.16 m above
# the roof; a 124.3 m mast to 541.3 m. The ring round the mast's foot and the mast's 6 m base: OSM's parts
# (a 36 m circle to 420 m, the mast a 6 m circle tapering over its top 80 m).
WTC = {'side': 61.0, 'base': 56.0, 'roof': 417.0, 'parapet': 10.16, 'tip': 541.3, 'ring': 18.0, 'ring_top': 420.0,
       'mast_r': 3.0, 'taper_from': 461.3, 'floor': 4.1}

# The Brooklyn Bridge (Wikipedia): towers 278 ft (84.7 m) above the water, 140 by 59 ft (43 by 18 m) at
# the water line (OSM's outline: 42.8 by 17.0 m), each with a pair of pointed arches 117 ft (36 m) tall
# and 33.75 ft (10.29 m) wide; the roadway 119.25 ft (36.3 m) above the water at the towers; the main span
# 1,595.5 ft (486.3 m), side spans 930 ft (283 m); 85 ft (26 m) wide; 127 ft (38.7 m) clear above mean high
# water at mid-span (mean high water 0.66 m above mean sea level: NOAA 8518750); stiffening trusses 33 ft
# (10 m) deep; four main cables 15.75 in (0.4 m) across, two outside the roadways and two in the median;
# the promenade 18 ft (5.5 m) above the roadways. Not published, from the reference photos: the three piers
# of each tower alike (about 6.8 m, filling the width with the two arches), a slight batter, the cables'
# saddles 2 m below the tower top, their low point at mid-span just above the truss; the side span's roadway
# falling to 25 m at the anchorage (OSM maps the anchorage 12 m high; its height is not published).
BB = {'top': 84.7, 'road': 36.3, 'main': 486.3, 'side': 283.0, 'width': 26.0, 'clear': 38.7 + 0.66, 'truss': 10.0,
      'arch_w': 10.29, 'arch_h': 36.0, 'pier': 6.8, 'batter': 0.04, 'saddle': 82.7, 'cable_r': 0.2,
      'outer': 14.5, 'inner': 2.5, 'road_anchor': 25.0}
# Necklace lights (24 W LEDs on the main cables): about every 22 m along the outer cables (ref4 counts eleven
# from the Manhattan tower to mid-span); the roadway lamps under the promenade, sodium-orange in ref4 and
# ref7, about every 30 m each side; the towers floodlit gold (56 LED lamps).
NECKLACE_EVERY = 22.0
ROAD_LAMP_EVERY = 30.0


def build(g):
    mats = materials(g)
    one_wtc(g, mats)
    brooklyn_bridge(g, mats)
    woolworth(g, mats)
    empire_state(g, mats)
    chrysler(g, mats)
    park_432(g, mats)
    if g['UPTO'] >= 2:
        spruce8(g)


def materials(g):
    sm = g['simple_material']
    em = g['emission_material']
    return {
        'mast': lit_material(g, 'wtc_mast', (0.42, 0.43, 0.45), (1.0, 0.93, 0.82), 3.0, 0.4, 0.6),
        'ring': sm('wtc_ring', (0.35, 0.36, 0.38), 0.4, Metallic=0.6),
        'parapet': lit_material(g, 'wtc_parapet', (0.12, 0.14, 0.17), (0.92, 0.95, 1.0), 2.5, 0.08, 0.2),
        'beacon': em('wtc_beacon', (1.0, 0.15, 0.08), 60.0),
        'steel': sm('bb_steel', (0.24, 0.2, 0.15), 0.6, Metallic=0.3),  # "Brooklyn Bridge Tan", weathered
        'cable': sm('bb_cable', (0.3, 0.27, 0.22), 0.45, Metallic=0.4),
        'necklace': em('bb_necklace', (1.0, 0.93, 0.8), 400.0),
        'road_lamp': em('bb_road_lamp', (1.0, 0.62, 0.3), 120.0),
        # The Chrysler Building's crown: Nirosta stainless steel (Krupp's chrome-nickel steel, polished), and
        # the white lights in its triangular windows that trace each arch at night.
        'nirosta': sm('nirosta', (0.62, 0.62, 0.64), 0.22, Metallic=1.0),
        'chrysler_lights': em('chrysler_lights', (1.0, 0.95, 0.86), 10.0, base=(0.5, 0.5, 0.52)),
    }


def lit_material(g, name, colour, glow, strength, roughness=0.35, metallic=0.0):
    """A surface that also glows at night (the Emission's strength is switched with the city's lights by
    skyline.py)."""
    bpy = g['bpy']
    mat = bpy.data.materials.new(name)
    nt = g['nodes_of'](mat)
    b = g['node'](nt, 'ShaderNodeBsdfPrincipled', Roughness=roughness, Metallic=metallic, **{'Base Color': (*colour, 1)})
    e = g['node'](nt, 'ShaderNodeEmission', Strength=strength, Color=(*glow, 1))
    add = g['node'](nt, 'ShaderNodeAddShader')
    nt.links.new(b.outputs[0], add.inputs[0])
    nt.links.new(e.outputs[0], add.inputs[1])
    out = g['node'](nt, 'ShaderNodeOutputMaterial')
    nt.links.new(add.outputs[0], out.inputs['Surface'])
    return mat


def tube(bm, a, b, r, segs=6):
    """A cylinder from a to b (Vectors) of radius r, added to bmesh bm."""
    from mathutils import Vector
    import bmesh
    d = b - a
    if d.length < 1e-3:
        return
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in res['verts']:
        v.co = q @ v.co + (a + b) / 2


def cone(bm, a, b, r0, r1, segs=12):
    from mathutils import Vector
    import bmesh
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in res['verts']:
        v.co = q @ v.co + (a + b) / 2


def mesh_object(g, name, bm, mat, lightgroup='city'):
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


def facade_faces(g, name, polys, attrs):
    """Faces with the city's facade material (skyline.py facade_material): each a list of 3D points; the
    wall's u runs along its bottom (or top) edge, v up, in metres."""
    from mathutils import Vector
    mb = g['MeshBuilder'](name, g['FACADE_ATTRS'])
    for pts, mat in polys:
        p = [Vector(q) for q in pts]
        # The face's horizontal direction: its longest horizontal-ish edge.
        best = None
        for i in range(len(p)):
            e = p[(i + 1) % len(p)] - p[i]
            h = Vector((e.x, e.y, 0))
            if best is None or h.length > best.length:
                best = h
        e = best.normalized() if best.length > 1e-6 else Vector((1, 0, 0))
        uvs = [((q - p[0]).dot(e), q.z) for q in p]
        mb.face([tuple(q) for q in p], uvs, mat, **attrs)
    ob = mb.build([g['MAT']['facade'], g['MAT']['roof']])
    ob.lightgroup = 'city'
    return ob


def square_of(outline):
    """OSM's One WTC outline (an eight-pointed star: the base square and the roof's turned square): the base
    square's corners, counter-clockwise, and its centre."""
    from mathutils import Vector
    ring = outline[:-1] if outline[0] == outline[-1] else outline
    pts = [Vector((x, y, 0)) for x, y in ring]
    c = sum(pts, Vector()) / len(pts)
    far = sorted(pts, key=lambda p: -(p - c).length)[:4]  # the base square's corners stand furthest out
    far.sort(key=lambda p: math.atan2(p.y - c.y, p.x - c.x))
    return far, c


def one_wtc(g, mats):
    import bmesh
    from mathutils import Vector
    outline = g['scene_data']['landmarkOutlines'].get(ONE_WTC)
    if not outline:
        print('landmark: One World Trade Center not in the data')
        return
    zb = g['scene_data']['landmarkBases'].get(ONE_WTC, 0.0)
    corners, c = square_of(outline[0])
    # OSM's square is 65 m; the published 61 m, about the same centre and turn.
    half = WTC['side'] / 2
    base = [c + (q - c).normalized() * (half * math.sqrt(2)) for q in corners]
    top = [(base[i] + base[(i + 1) % 4]) / 2 for i in range(4)]  # the roof's turned square: edge midpoints
    Z = Vector((0, 0, 1))
    z0, z1, z2 = zb, zb + WTC['base'], zb + WTC['roof']
    rng = g['rng']
    glass = dict(wall=(0.06, 0.08, 0.11), style=0, bay=1.52, floorh=WTC['floor'], win_w=0.47, win_h=0.44, frame=0.05,
                 busy=rng.uniform(*g['SITE'].get('busy', (0.2, 0.6))), seed=rng.random() * 1000, roofc=(0.2, 0.21, 0.22), flood=0.0,
                 **g['facade_runs'](0))
    podium = dict(glass, wall=(0.42, 0.44, 0.47), style=3, busy=0.0, run_l=1.0, run_b=1.0, glass_ior=0.0)
    polys_glass, polys_podium = [], []
    for i in range(4):
        a, b = base[i], base[(i + 1) % 4]
        # The podium's walls.
        polys_podium.append(([a + Z * z0, b + Z * z0, b + Z * z1, a + Z * z1], 0))
        # The shaft: an upright triangle on each base edge to the roof corner at its midpoint's turn, and an
        # inverted one from each base corner up to the roof edge between two roof corners.
        polys_glass.append(([a + Z * z1, b + Z * z1, top[i] + Z * z2], 0))
        polys_glass.append(([b + Z * z1, top[(i + 1) % 4] + Z * z2, top[i] + Z * z2], 0))
    facade_faces(g, 'one_wtc_podium', polys_podium, podium)
    facade_faces(g, 'one_wtc', polys_glass, glass)
    # The parapet: glass round the roof's square, lit from within at night (ref8: the crown burns white).
    bm = bmesh.new()
    zp = z2 + WTC['parapet']
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        vs = [bm.verts.new(a + Z * z2), bm.verts.new(b + Z * z2), bm.verts.new(b + Z * zp), bm.verts.new(a + Z * zp)]
        bm.faces.new(vs)
    mesh_object(g, 'one_wtc_parapet', bm, mats['parapet'])
    # The roof, the ring round the mast's foot, and the mast.
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(q + Z * (z2 + 0.5)) for q in top])
    cone(bm, c + Z * z2, c + Z * (zb + WTC['ring_top']), WTC['ring'], WTC['ring'], 48)
    mesh_object(g, 'one_wtc_ring', bm, mats['ring'])
    bm = bmesh.new()
    zt, zm = zb + WTC['taper_from'], zb + WTC['tip']
    tube(bm, c + Z * (zb + WTC['ring_top']), c + Z * zt, WTC['mast_r'], 16)
    cone(bm, c + Z * zt, c + Z * (zm - 6), WTC['mast_r'], 0.5, 16)
    tube(bm, c + Z * (zm - 6), c + Z * zm, 0.25, 8)
    # Service rings on the mast (ref2 shows them as bands).
    for k in (0.12, 0.3, 0.5):
        zr = zb + WTC['ring_top'] + k * (WTC['tip'] - WTC['ring_top'])
        r = WTC['mast_r'] * (1.0 if zr < zt else max(0.6, 1 - (zr - zt) / (zm - zt))) + 0.8
        cone(bm, c + Z * zr, c + Z * (zr + 1.5), r, r, 16)
    mesh_object(g, 'one_wtc_mast', bm, mats['mast'])
    # The aircraft warning beacon at the tip.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.8)
    for v in bm.verts:
        v.co += c + Z * (zm + 0.5)
    mesh_object(g, 'one_wtc_beacon', bm, mats['beacon'])
    print('landmark: One World Trade Center')


def pointed_arch(cx, w, z_floor, h, n=10):
    """The outline (across, z) of a pointed (equilateral) arch opening: vertical sides to the springing,
    two arcs of radius w meeting at the apex, h above the floor."""
    rise = w * math.sqrt(3) / 2
    spring = z_floor + h - rise
    pts = [(cx - w / 2, z_floor), (cx + w / 2, z_floor), (cx + w / 2, spring)]
    # Right arc: centred on the left springing point, radius w, from 0 to 60 degrees.
    for i in range(1, n):
        t = math.radians(60 * i / n)
        pts.append((cx - w / 2 + w * math.cos(t), spring + w * math.sin(t)))
    pts.append((cx, spring + rise))
    for i in range(n - 1, 0, -1):
        t = math.radians(60 * i / n)
        pts.append((cx + w / 2 - w * math.cos(t), spring + w * math.sin(t)))
    pts.append((cx - w / 2, spring))
    return pts


def brooklyn_bridge(g, mats):
    import bmesh
    from mathutils import Vector, geometry
    sd = g['scene_data']
    fp = sd['landmarkOutlines'].get(BB_TOWER)
    if not fp:
        print('landmark: Brooklyn Bridge tower not in the data')
        return
    fp = fp[0]
    wz = g['SITE']['water']
    pts = [Vector((x, y, 0)) for x, y in fp]
    c = sum(pts, Vector()) / len(pts)
    # The tower's long side runs across the bridge: its principal axis.
    sxx = sum((p.x - c.x) ** 2 for p in pts)
    syy = sum((p.y - c.y) ** 2 for p in pts)
    sxy = sum((p.x - c.x) * (p.y - c.y) for p in pts)
    a = 0.5 * math.atan2(2 * sxy, sxx - syy)
    across = Vector((math.cos(a), math.sin(a), 0))
    along = Vector((-across.y, across.x, 0))
    # Toward Brooklyn: the side of the bridge's outline centre.
    outline = next((b for b in sd['bridges'] if b['id'] == BB_OUTLINE), None)
    if outline:
        oc = Vector((sum(p[0] for p in outline['pts']) / len(outline['pts']), sum(p[1] for p in outline['pts']) / len(outline['pts']), 0))
        if (oc - c).dot(along) < 0:
            along = -along
    Z = Vector((0, 0, 1))
    half_w = max(abs((p - c).dot(across)) for p in pts)
    half_t = max(abs((p - c).dot(along)) for p in pts)
    top = wz + BB['top']
    road = wz + BB['road']

    # ---- The Manhattan tower: stone, floodlit gold (as bright as the Woolworth crown's gold in ref4 and ref7,
    # not brighter). Below the roadway a solid block; above it three piers
    # and two pointed arches, then solid to the cornice; the whole with a slight batter.
    rng = g['rng']
    stone = dict(wall=(0.42, 0.38, 0.31), style=3, bay=3.0, floorh=3.0, win_w=0, win_h=0, frame=0.3, busy=0.0, seed=rng.random() * 1000,
                 roofc=(0.3, 0.28, 0.24), flood=0.5, run_l=1.0, run_b=1.0, glass_ior=0.0)
    shrink = lambda z: 1 - BB['batter'] * (z - wz) / BB['top']

    def P(x, z, t):
        """A point at `x` across the tower, height z, `t` along (from its centre), with the batter."""
        k = shrink(z)
        return c + across * (x * k) + along * (t * k) + Z * z

    polys = []
    W, T = half_w, half_t
    # The block below the roadway.
    for s in (-1, 1):
        polys.append(([P(-W, wz, s * T), P(W, wz, s * T), P(W, road, s * T), P(-W, road, s * T)], 0))
        polys.append(([P(s * W, wz, -T), P(s * W, wz, T), P(s * W, road, T), P(s * W, road, -T)], 0))
    # The front and back faces above the roadway, pierced by the two arches.
    aw, ah, pier = BB['arch_w'], BB['arch_h'], BB['pier']
    centres = (-(pier + aw) / 2, (pier + aw) / 2)
    arches = [pointed_arch(xc, aw, road, ah) for xc in centres]
    # One outline round both arch openings, which stand on the face's bottom edge: along the bottom, up
    # each opening's left side, over its apex and down its right side, on to the far corner and back
    # across the top.
    face = [(-W, road)]
    for arch in arches:
        face += [arch[0], *arch[2:][::-1], arch[1]]
    face += [(W, road), (W, top), (-W, top)]
    loops = [[Vector((x, z, 0)) for x, z in face]]
    flat = face
    tris = geometry.tessellate_polygon(loops)
    for s in (-1, 1):
        for t in tris:
            tri = [P(flat[i][0], flat[i][1], s * T) for i in t]
            polys.append((tri if s > 0 else tri[::-1], 0))
    # The sides above the roadway, and the arches' soffits (the tunnels the roadways pass through).
    for s in (-1, 1):
        polys.append(([P(s * W, road, -T), P(s * W, road, T), P(s * W, top, T), P(s * W, top, -T)], 0))
    for arch in arches:
        for i in range(len(arch)):
            (x0, z0), (x1, z1) = arch[i], arch[(i + 1) % len(arch)]
            if z0 == road and z1 == road:
                continue
            polys.append(([P(x0, z0, -T), P(x1, z1, -T), P(x1, z1, T), P(x0, z0, T)], 0))
    # The cornice: the top, a little proud.
    k = 1.03
    polys.append(([P(-W * k, top, -T * k), P(W * k, top, -T * k), P(W * k, top, T * k), P(-W * k, top, T * k)], 1))
    for s in (-1, 1):
        polys.append(([P(-W * k, top - 1.5, s * T * k), P(W * k, top - 1.5, s * T * k), P(W * k, top, s * T * k), P(-W * k, top, s * T * k)], 0))
        polys.append(([P(s * W * k, top - 1.5, -T * k), P(s * W * k, top - 1.5, T * k), P(s * W * k, top, T * k), P(s * W * k, top, -T * k)], 0))
    facade_faces(g, 'bb_tower', polys, stone)

    # ---- Deck, cables, suspenders, stays and lights.
    def road_at(s):
        """The roadway's height at s metres along from the Manhattan tower (positive over the river)."""
        if s >= 0:
            L = BB['main']
            mid = wz + BB['clear'] + BB['truss'] * 0.7  # the roadway on the truss, its bottom clear by the published height
            x = s / L
            return road + (mid - road) * 4 * x * (1 - x)
        return road + (wz + BB['road_anchor'] - road) * min(1.0, -s / BB['side'])

    saddle = wz + BB['saddle']

    def cable_at(s):
        if s >= 0:
            L = BB['main']
            low = road_at(L / 2) + BB['truss'] * 0.3 + 1.0
            x = s / L
            return saddle - (saddle - low) * 4 * x * (1 - x)
        L = BB['side']
        end = wz + BB['road_anchor'] + 1.0
        x = min(1.0, -s / L)
        return saddle + (end - saddle) * x - 6.0 * 4 * x * (1 - x)

    s_min, s_max = -BB['side'], BB['main']
    step = 6.0
    steel = bmesh.new()
    lamps = bmesh.new()
    cables = bmesh.new()
    necklace = bmesh.new()
    half_deck = BB['width'] / 2
    s = s_min
    while s < s_max:
        s1 = min(s + step, s_max)
        z0, z1 = road_at(s), road_at(s1)
        p0, p1 = c + along * s, c + along * s1
        # The stiffening trusses, 10 m deep: open lattice, not walls (Midtown shows through them from Pier 1,
        # set2/w2, w3): top and bottom chords, a post and a diagonal each 6 m panel, the two outer trusses
        # and two inner ones (the bridge has six); and the roadway's floor, 1.2 m, in the bottom third.
        lo0, lo1 = z0 - BB['truss'] * 0.7, z1 - BB['truss'] * 0.7
        hi0, hi1 = z0 + BB['truss'] * 0.3, z1 + BB['truss'] * 0.3
        for x in (-half_deck, -4.5, 4.5, half_deck):
            q0, q1 = p0 + across * x, p1 + across * x
            tube(steel, q0 + Z * lo0, q1 + Z * lo1, 0.35, 4)
            tube(steel, q0 + Z * hi0, q1 + Z * hi1, 0.35, 4)
            tube(steel, q0 + Z * lo0, q0 + Z * hi0, 0.2, 4)
            tube(steel, q0 + Z * lo0, q1 + Z * hi1, 0.15, 4)
        f0, f1 = z0 - 1.2, z1 - 1.2
        vs = [steel.verts.new(p0 + across * -half_deck + Z * f0), steel.verts.new(p0 + across * half_deck + Z * f0),
              steel.verts.new(p1 + across * half_deck + Z * f1), steel.verts.new(p1 + across * -half_deck + Z * f1)]
        steel.faces.new(vs)
        for side in (-1, 1):
            q0, q1 = p0 + across * (side * half_deck), p1 + across * (side * half_deck)
            vs = [steel.verts.new(q0 + Z * f0), steel.verts.new(q1 + Z * f1), steel.verts.new(q1 + Z * z1), steel.verts.new(q0 + Z * z0)]
            steel.faces.new(vs if side > 0 else vs[::-1])
        # The cables, as segments.
        for x in (-BB['outer'], -BB['inner'], BB['inner'], BB['outer']):
            tube(cables, p0 + across * x + Z * cable_at(s), p1 + across * x + Z * cable_at(s1), BB['cable_r'], 6)
        s = s1
    # Suspenders every 3 m on each cable, from the cable to the truss top.
    s = s_min + 1.5
    while s < s_max:
        if abs(s) > half_t + 1:
            p = c + along * s
            for x in (-BB['outer'], -BB['inner'], BB['inner'], BB['outer']):
                top_z, bot_z = cable_at(s), road_at(s) + BB['truss'] * 0.3
                if top_z > bot_z + 0.5:
                    tube(cables, p + across * x + Z * bot_z, p + across * x + Z * top_z, 0.03, 3)
        s += 3.0
    # Stays: from the saddles down to the deck, fanned each way, 42 to 137 m long (published), 24 a cable a side.
    for x in (-BB['outer'], -BB['inner'], BB['inner'], BB['outer']):
        for sgn in (-1, 1):
            for i in range(24):
                d = 12 + (125 * i / 23)
                q = c + along * (sgn * d) + across * x + Z * (road_at(sgn * d) + BB['truss'] * 0.3)
                tube(cables, c + across * x + Z * saddle, q, 0.04, 3)
    # The necklace: LEDs along the outer cables; the roadway lamps along both edges.
    s = s_min + NECKLACE_EVERY / 2
    while s < s_max:
        p = c + along * s
        for x in (-BB['outer'], BB['outer']):
            res = bmesh.ops.create_uvsphere(necklace, u_segments=8, v_segments=6, radius=0.45)
            for v in res['verts']:
                v.co += p + across * x + Z * (cable_at(s) + 0.35)
        s += NECKLACE_EVERY
    s = s_min + ROAD_LAMP_EVERY / 2
    while s < s_max:
        if abs(s) > half_t + 2:
            p = c + along * s
            for x in (-half_deck + 1.0, half_deck - 1.0):
                res = bmesh.ops.create_uvsphere(lamps, u_segments=8, v_segments=6, radius=0.3)
                for v in res['verts']:
                    v.co += p + across * x + Z * (road_at(s) + BB['truss'] * 0.3 + 4.5)
        s += ROAD_LAMP_EVERY
    mesh_object(g, 'bb_deck', steel, mats['steel'])
    mesh_object(g, 'bb_cables', cables, mats['cable'])
    mesh_object(g, 'bb_necklace', necklace, mats['necklace'])
    mesh_object(g, 'bb_road_lamps', lamps, mats['road_lamp'])
    print(f'landmark: Brooklyn Bridge (Manhattan tower {math.hypot(c.x, c.y):.0f} m at {math.degrees(math.atan2(c.x, c.y)) % 360:.1f} deg)')


# ---- Hero landmarks ---------------------------------------------------------------------------------
# Heights above the ground each stands on (the terrain, extract.mjs); the Manhattan grid's avenues run
# 29 degrees east of true north.
GRID = math.radians(29.0)


def grid_axes():
    from mathutils import Vector
    ay = Vector((math.sin(GRID), math.cos(GRID), 0))  # up the avenues
    return Vector((ay.y, -ay.x, 0)), ay  # along the cross streets, along the avenues


def _rect_axes(ring):
    """A rectangular outline's centre, its axes (unit, along its sides) and half sizes: the minimum-area
    bounding rectangle (roofs.axes)."""
    from mathutils import Vector
    import roofs
    (ux, uy), (cx, cy), long_, short = roofs.axes(ring)
    ax = Vector((ux, uy, 0))
    return Vector((cx, cy, 0)), ax, Vector((-uy, ux, 0)), long_ / 2, short / 2


def woolworth(g, mats):
    """The Woolworth Building's tower (Cass Gilbert, 1913; 241.4 m), above its 120 m base (OSM's, in its
    cream terracotta and gothic piers: OVERRIDES): on the lowest stage's outline (OSM: a 26 m square from 120
    to 170 m), the stages OSM maps, each with its corner turrets and pinnacles: a 26 m shaft to 170 m with
    octagonal turrets at its corners to 172 m; a 22 m stage to 194 m; a 17 m stage to 203 m with four
    turrets 4.8 m across rising to 215 m under their spirelets (OSM's 5 m parts); the steep copper pyramid
    with gothic dormers to the octagonal lantern at 228 m; its spirelet and finial to 241.4 m. Floodlit
    gold from the setbacks up (ref5, ref8: OSM's tower parts had 1.0)."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, square_stack, pinnacle, gable, lathe
    b = _prepared.get(WOOLWORTH_STAGE)
    if not b:
        print('landmark: Woolworth Building tower not in the data')
        return
    c, ax, ay, _, _ = _rect_axes(b['outer'][0])
    zb = b.get('base', 0.0)
    k = lambda z: zb + z  # noqa: E731
    stone = bmesh.new()
    square_stack(stone, c, ax, ay, [(k(120), 13.0, 13.0), (k(170), 13.0, 13.0), (k(170), 11.0, 11.0), (k(194), 11.0, 11.0),
                                    (k(194), 8.5, 8.5), (k(203), 8.5, 8.5)], cap_top=False)
    # Gothic piers up the shaft's corners, standing proud.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        square_stack(stone, c + ax * (sx * 12.4) + ay * (sy * 12.4), ax, ay, [(k(120), 1.0, 1.0), (k(170), 1.0, 1.0)])
    g['facade_object']('woolworth_tower', stone, WOOL_TERRACOTTA, COPPER, style=4, bay=1.9, floorh=3.9, win_w=0.17, win_h=0.36, frame=0.3,
                       busy=0.12, flood=1.0)
    turrets = bmesh.new()
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        d = ax * sx + ay * sy
        lathe(turrets, c + d * 12.6, [(k(165), 1.6), (k(172), 1.6), (k(172), 1.9), (k(172.6), 1.9), (k(172.6), 1.4), (k(178.5), 0.0)], sides=8,
              phase=math.pi / 8)
        pinnacle(turrets, c + d * 10.7, k(194), 0.9, 1.6, 3.4, sides=8)
        lathe(turrets, c + d * 8.6, [(k(194), 2.4), (k(212), 2.4), (k(212), 2.75), (k(213), 2.75), (k(213), 2.3), (k(215), 2.3),
                                     (k(215), 2.6), (k(222), 0.0)], sides=8, phase=math.pi / 8)
    # Lesser pinnacles along each stage's parapet.
    for face, side in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
        for t in (-6.0, -2.0, 2.0, 6.0):
            pinnacle(turrets, c + face * 12.8 + side * t, k(170), 0.5, 1.2, 2.2, sides=4)
        for t in (-5.0, 0.0, 5.0):
            pinnacle(turrets, c + face * 10.8 + side * t, k(194), 0.45, 1.0, 2.0, sides=4)
    g['facade_object']('woolworth_turrets', turrets, WOOL_TERRACOTTA, COPPER, style=3, roof_nz=0.6, flood=1.0)
    roof = bmesh.new()
    # The copper pyramid, steep (about 79 degrees), to the lantern's gallery; its gothic dormers.
    square_stack(roof, c, ax, ay, [(k(203), 8.5, 8.5), (k(228), 3.6, 3.6)], cap_top=True)
    for face, side in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
        for t in (-4.2, 0.0, 4.2):
            gable(roof, c + face * 7.6 + side * t, side, face, 1.6, 2.4, k(206), 3.4)
        gable(roof, c + face * 5.6, side, face, 1.4, 2.2, k(216), 3.0)
    g['facade_object']('woolworth_roof', roof, COPPER, COPPER, style=3, roof_nz=-1.0, flood=0.6)
    lantern = bmesh.new()
    lathe(lantern, c, [(k(228), 3.9), (k(228.8), 3.9), (k(228.8), 3.3), (k(233.5), 3.3), (k(233.5), 3.6), (k(234.2), 3.6),
                       (k(234.2), 2.9), (k(239.2), 0.5), (k(239.2), 0.3), (k(241.4), 0.0)], sides=8, phase=math.pi / 8)
    g['facade_object']('woolworth_lantern', lantern, WOOL_TERRACOTTA, COPPER, style=4, bay=1.25, floorh=4.7, win_w=0.28, win_h=0.4,
                       frame=0.4, busy=0.0, flood=1.2, roof_nz=0.5)
    print(f'landmark: Woolworth Building (tower {math.hypot(c.x, c.y):.0f} m at {math.degrees(math.atan2(c.x, c.y)) % 360:.1f} deg)')


def empire_state(g, mats):
    """The Empire State Building's top (Shreve, Lamb & Harmon, 1931): OSM's setbacks stand to the 86th floor's
    observatory (330 m in OSM; published 320 m); from there the mooring mast (published: from the 86th floor
    to the 102nd floor's observatory at 373 m, its domed cap at the 381 m roof), on four flaring buttresses at
    its foot, its aluminium ribs, the glazed 102nd-floor band, and the antenna to the 443.2 m tip. Floodlit
    as OSM's crown parts were (1.4)."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, square_stack, lathe
    b = _prepared.get(ESB_ANTENNA)
    if not b:
        print('landmark: Empire State Building not in the data')
        return
    ring = b['outer'][0]
    c = Vector((sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring), 0))
    zb = b.get('base', 0.0)
    k = lambda z: zb + z  # noqa: E731
    ax, ay = grid_axes()
    mast = bmesh.new()
    lathe(mast, c, [(k(328), 9.5), (k(333), 9.5), (k(338), 7.8), (k(356), 7.2), (k(356), 7.9), (k(357.5), 7.9), (k(357.5), 6.6),
                    (k(364), 6.4), (k(364), 6.9), (k(365), 6.9), (k(365), 6.0), (k(372), 5.8), (k(372), 6.3), (k(373), 6.3),
                    (k(375.5), 4.9), (k(378.5), 3.4), (k(381), 1.9)], sides=16, phase=math.pi / 16)
    # The four buttresses at the mast's foot, on the diagonals, and its ribs.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        d = (ax * sx + ay * sy).normalized()
        o = Vector((-d.y, d.x, 0))
        square_stack(mast, c + d * 9.0, d, o, [(k(320), 3.2, 0.9), (k(334), 2.2, 0.8), (k(345), 0.4, 0.5)], cap_top=True)
    for i in range(8):
        t = i / 8 * math.tau
        d = Vector((math.cos(t), math.sin(t), 0))
        square_stack(mast, c + d * 7.4, d, Vector((-d.y, d.x, 0)), [(k(338), 0.45, 0.3), (k(356), 0.45, 0.3)], cap_top=True)
    g['facade_object']('esb_mast', mast, (0.46, 0.46, 0.45), (0.3, 0.3, 0.3), style=4, bay=1.6, floorh=4.4, win_w=0.18, win_h=0.38,
                       frame=0.55, busy=0.0, flood=1.4, roof_nz=0.6)
    antenna = bmesh.new()
    lathe(antenna, c, [(k(381), 1.7), (k(392), 1.5), (k(392), 1.9), (k(393.5), 1.9), (k(393.5), 1.2), (k(412), 1.0),
                       (k(412), 1.3), (k(413), 1.3), (k(413), 0.8), (k(432), 0.55), (k(443.2), 0.12)], sides=8)
    g['facade_object']('esb_antenna', antenna, (0.32, 0.32, 0.32), (0.3, 0.3, 0.3), style=3, roof_nz=0.6, flood=0.7)
    print(f'landmark: Empire State Building ({math.hypot(c.x, c.y):.0f} m at {math.degrees(math.atan2(c.x, c.y)) % 360:.1f} deg)')


def _point(g, name):
    from mathutils import Vector
    p = g['scene_data'].get('landmarkPoints', {}).get(name)
    if not p:
        print(f'landmark: {name} not placed (no landmarkPoints in scene.json: run extract.mjs)')
        return None, 0.0
    return Vector((p['at'][0], p['at'][1], 0)), p.get('base', 0.0)


def chrysler(g, mats):
    """The Chrysler Building (William Van Alen, 1930; 318.9 m), 405 Lexington Avenue, by Wikipedia's
    coordinates on the grid's axes. Its lot 201 by 167 ft (61 by 51 m), the base filling it to the 16th
    floor; setbacks at the 16th, 18th, 23rd, 28th and 31st floors (published; floors about 3.66 m); the
    square shaft to the 61st floor's eagles, chamfered above them to the 71st; the crown of seven
    terraced arches in Nirosta steel on each face, each arch as wide as its tier, lit in its triangular
    windows at night; the spire (the "vertex", 56 m) to the tip. Not published, from the photos: the
    shaft about 27 m square, the arches' spacing (even, 5.2 m), the chamfers."""
    import bmesh
    from mathutils import Vector
    from shapes import Z, square_stack, lathe, box
    c, zb = _point(g, 'Chrysler Building')
    if c is None:
        return
    ax, ay = grid_axes()  # ax along 42nd Street, ay up Lexington Avenue
    k = lambda z: zb + z  # noqa: E731
    f = 3.66
    body = bmesh.new()
    square_stack(body, c, ax, ay, [(k(0), 25.5, 30.5), (k(16 * f), 25.5, 30.5), (k(16 * f), 22.0, 26.0), (k(18 * f), 22.0, 26.0),
                                   (k(18 * f), 19.0, 22.0), (k(23 * f), 19.0, 22.0), (k(23 * f), 17.0, 18.0), (k(28 * f), 17.0, 18.0),
                                   (k(28 * f), 15.2, 15.6), (k(31 * f), 15.2, 15.6), (k(31 * f), 13.5, 13.5), (k(61 * f), 13.5, 13.5)],
                 cap_top=True)
    g['facade_object']('chrysler_body', body, (0.42, 0.41, 0.39), (0.2, 0.2, 0.2), style=1, bay=1.75, floorh=f, win_w=0.24, win_h=0.32,
                       frame=0.12, busy=0.3)
    steel = bmesh.new()
    z0, z1 = k(61 * f), k(67.2 * f)
    from shapes import prism
    # Above the eagles: the shaft's corners chamfered (2.4 m), to the crown's foot.
    pts = []
    for (sx, sy) in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        pts += [(sx * 12.6, sy * 10.2), (sx * 10.2, sy * 12.6)] if sx * sy > 0 else [(sx * 10.2, sy * 12.6), (sx * 12.6, sy * 10.2)]
    plan = [tuple((c + ax * x + ay * y)[:2]) for x, y in pts]
    prism(steel, plan, z0, z1, cap_top=True)
    # The eagles at the 61st floor's corners, standing out on the diagonals.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        d = (ax * sx + ay * sy).normalized()
        box(steel, c + d * 20.0, d, Vector((-d.y, d.x, 0)), 2.6, 0.6, z0 - 1.2, z0 + 0.4)
    g['facade_object']('chrysler_eagles', steel, (0.5, 0.5, 0.52), (0.5, 0.5, 0.52), style=1, bay=1.6, floorh=f, win_w=0.22, win_h=0.32,
                       frame=0.5, busy=0.25)
    crown = bmesh.new()
    lights = bmesh.new()
    z = z1
    tiers = 7
    for t in range(tiers):
        w = 11.6 - 1.3 * t  # each tier's half width
        top = z + 5.2
        # The tier's core, from the tier below's springing (so it fills the arches behind) to this one's.
        square_stack(crown, c, ax, ay, [(z - 5.2 if t else z, w, w), (top if t < tiers - 1 else z + 2.0, w, w)], cap_top=True)
        # An arch on each face, a semicircle as wide as the face, 0.5 m thick.
        for face, side in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
            n = 14
            arc = [(-w, 0.0)] + [(-w * math.cos(math.pi * i / n), w * math.sin(math.pi * i / n)) for i in range(1, n)] + [(w, 0.0)]
            front = [crown.verts.new(c + face * (w + 0.25) + side * a + Z * (z + b_)) for a, b_ in arc]
            back = [crown.verts.new(c + face * (w - 0.25) + side * a + Z * (z + b_)) for a, b_ in arc]
            crown.faces.new(front if face.dot(side.cross(Z)) < 0 else front[::-1])
            crown.faces.new(back[::-1] if face.dot(side.cross(Z)) < 0 else back)
            for i in range(len(arc)):
                j = (i + 1) % len(arc)
                crown.faces.new((front[i], front[j], back[j], back[i]))
            # Its lights: the triangular windows along the arch, a band 0.4 to 2.4 m inside its edge (they are
            # tall: set2/w2 shows the crown burning white at 6 km).
            r0, r1 = w - 2.4, w - 0.4
            band = []
            for i in range(n + 1):
                a = math.pi * i / n
                band.append((-r1 * math.cos(a), r1 * math.sin(a), -r0 * math.cos(a), r0 * math.sin(a)))
            for i in range(n):
                (ox0, oz0, ix0, iz0), (ox1, oz1, ix1, iz1) = band[i], band[i + 1]
                if i % 2:
                    continue  # the triangles' gaps
                q = [c + face * (w + 0.3) + side * ox0 + Z * (z + oz0), c + face * (w + 0.3) + side * ox1 + Z * (z + oz1),
                     c + face * (w + 0.3) + side * ((ix0 + ix1) / 2) + Z * (z + (iz0 + iz1) / 2)]
                lights.faces.new([lights.verts.new(v) for v in (q if face.dot(side.cross(Z)) < 0 else q[::-1])])
        z = top
    spire_foot = z - 5.2 + 3.9 + 1.0
    lathe(crown, c, [(spire_foot, 2.4), (k(292), 1.6), (k(305), 0.9), (k(318.9), 0.0)], sides=8, phase=math.pi / 8)
    mesh_object(g, 'chrysler_crown', crown, mats['nirosta'])
    mesh_object(g, 'chrysler_lights', lights, mats['chrysler_lights'])
    print(f'landmark: Chrysler Building ({math.hypot(c.x, c.y):.0f} m at {math.degrees(math.atan2(c.x, c.y)) % 360:.1f} deg, crown to {z - zb:.0f} m)')


def park_432(g, mats):
    """432 Park Avenue (Rafael Viñoly, 2015; 425.7 m), by Wikipedia's coordinates on the grid's axes: a
    28.5 m square of white concrete, each face six square windows a floor (10 by 10 ft, 3.05 m, in a 4.75 m
    bay), floors 4.75 m; five double-height mechanical floors open to the wind every twelve floors (the
    facade's frame continues, the core stands inside, the sky shows through), and the open top floors round
    the roof plant. Not published, from the photos: the open floors' heights (even, every 75 m), the core
    (about 9 m square)."""
    import bmesh
    from shapes import Z, square_stack, box
    c, zb = _point(g, '432 Park Avenue')
    if c is None:
        return
    ax, ay = grid_axes()
    k = lambda z: zb + z  # noqa: E731
    h, top = 14.25, 425.7
    opens = [(75.0 * i, 75.0 * i + 9.5) for i in range(1, 6)] + [(top - 14.0, top)]
    closed = bmesh.new()
    frame = bmesh.new()
    z = 0.0
    for a, b_ in opens:
        square_stack(closed, c, ax, ay, [(k(z), h, h), (k(a), h, h)], cap_top=True, cap_bottom=z > 0)
        # The open floors: the core, the frame's seven columns a side (corners shared) and the slab edges.
        square_stack(frame, c, ax, ay, [(k(a), 4.6, 4.6), (k(b_), 4.6, 4.6)])
        for face, side in ((ax, ay), (-ax, ay), (ay, ax), (-ay, ax)):
            for i in range(7):
                t = -h + 0.45 + i * (2 * h - 0.9) / 6
                box(frame, c + face * (h - 0.45) + side * t, face, side, 0.45, 0.45, k(a), k(b_))
            if b_ - a > 10:
                for zz in (a + 4.7, a + 9.4):
                    box(frame, c + face * (h - 0.45), face, side, 0.45, h, k(zz) - 0.35, k(zz) + 0.35)
        z = b_
    square_stack(frame, c, ax, ay, [(k(top) - 0.6, h, h), (k(top), h, h)], cap_bottom=True)
    g['facade_object']('park432_tower', closed, (0.56, 0.55, 0.51), (0.25, 0.25, 0.25), style=1, bay=4.75, floorh=4.75, win_w=0.32,
                       win_h=0.32, frame=0.55, busy=0.15)
    g['facade_object']('park432_frame', frame, (0.56, 0.55, 0.51), (0.25, 0.25, 0.25), style=3)
    print(f'landmark: 432 Park Avenue ({math.hypot(c.x, c.y):.0f} m at {math.degrees(math.atan2(c.x, c.y)) % 360:.1f} deg)')


def spruce8(g):
    """8 Spruce Street (Frank Gehry, 2011): each of OSM's eight parts raised on its outline, its walls rippling
    in Gehry's stainless bays: each wall pushed out up to 1.3 m in waves 9 m long that slide sideways floor
    by floor, so the folds run diagonally up the tower (set2/p019, p020, ref2); the south face, which is
    flat, left flat. Stainless steel panels with punched windows."""
    import bmesh
    from mathutils import Vector
    from shapes import ccw
    parts = [_prepared[i] for i in sorted(SPRUCE8) if i in _prepared]
    if not parts:
        print('landmark: 8 Spruce Street not in the data')
        return
    bm = bmesh.new()
    floor, step, amp, wave = 3.1, 1.5, 1.3, 9.0
    for b in parts:
        ring = ccw([tuple(p) for p in b['outer'][0][:-1]] if b['outer'][0][0] == b['outer'][0][-1] else [tuple(p) for p in b['outer'][0]])
        zb = b.get('base', 0.0)
        # The outline resampled every 1.5 m, each point with its outward normal and the distance along.
        pts = []
        u = 0.0
        for i in range(len(ring)):
            a, c = Vector((*ring[i], 0)), Vector((*ring[(i + 1) % len(ring)], 0))
            e = c - a
            if e.length < 1e-3:
                continue
            nrm = Vector((e.y, -e.x, 0)).normalized()
            k = max(1, int(e.length // step))
            for j in range(k):
                pts.append((a + e * (j / k), nrm, u + e.length * j / k))
            u += e.length
        rows = []
        z = zb + b['min']
        top = zb + b['height']
        levels = []
        while z < top - 0.01:
            levels.append(z)
            z += floor
        levels.append(top)
        for zl in levels:
            row = []
            shift = (zl - zb) / floor * 0.9  # the folds slide 0.9 m a floor
            for p, nrm, uu in pts:
                south = max(0.0, -nrm.y)
                k = amp * (0.5 + 0.5 * math.sin(math.tau * (uu + shift) / wave)) * (1 - min(1.0, south * 1.4))
                k *= 0.0 if zl - zb < 25 else min(1.0, (zl - zb - 25) / 10)  # the brick base's plain walls
                q = p + nrm * k
                row.append(bm.verts.new((q.x, q.y, zl)))
            rows.append(row)
        for r0, r1 in zip(rows, rows[1:]):
            n = len(r0)
            for i in range(n):
                bm.faces.new((r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]))
        bm.faces.new(rows[-1])
    g['facade_object']('spruce8', bm, (0.42, 0.44, 0.47), (0.2, 0.2, 0.21), style=1, bay=1.5, floorh=floor, win_w=0.3, win_h=0.3, frame=0.6,
                       busy=0.3)
    print(f'landmark: 8 Spruce Street ({len(parts)} parts)')
