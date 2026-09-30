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
REPLACES = {ONE_WTC, BB_TOWER, BB_OUTLINE}
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

    # ---- The Manhattan tower: stone, floodlit gold. Below the roadway a solid block; above it three piers
    # and two pointed arches, then solid to the cornice; the whole with a slight batter.
    rng = g['rng']
    stone = dict(wall=(0.42, 0.38, 0.31), style=3, bay=3.0, floorh=3.0, win_w=0, win_h=0, frame=0.3, busy=0.0, seed=rng.random() * 1000,
                 roofc=(0.3, 0.28, 0.24), flood=1.1, run_l=1.0, run_b=1.0, glass_ior=0.0)
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
        # The trusses: the deck's edges, 10 m deep, and the roadway slab.
        for side in (-1, 1):
            q0, q1 = p0 + across * (side * half_deck), p1 + across * (side * half_deck)
            vs = [steel.verts.new(q0 + Z * (z0 - BB['truss'] * 0.7)), steel.verts.new(q1 + Z * (z1 - BB['truss'] * 0.7)),
                  steel.verts.new(q1 + Z * (z1 + BB['truss'] * 0.3)), steel.verts.new(q0 + Z * (z0 + BB['truss'] * 0.3))]
            steel.faces.new(vs if side > 0 else vs[::-1])
        vs = [steel.verts.new(p0 + across * -half_deck + Z * (z0 - BB['truss'] * 0.7)), steel.verts.new(p0 + across * half_deck + Z * (z0 - BB['truss'] * 0.7)),
              steel.verts.new(p1 + across * half_deck + Z * (z1 - BB['truss'] * 0.7)), steel.verts.new(p1 + across * -half_deck + Z * (z1 - BB['truss'] * 0.7))]
        steel.faces.new(vs)
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
