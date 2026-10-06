"""A city's skyline from its vantage point, path traced in Blender (Cycles).

    blender -b --factory-startup -P scripts/blender/skyline.py -- --city london \
        [--view pano|<ref>] [--scale 0.25] [--samples 128] [--season leaf|bare]
        [--passes sky,city,win,late,depth,trees] [--out data/skyline/london/render] [--border x0,x1,y0,y1]

Builds the scene from data/skyline/<city>/scene.json (scripts/skyline/extract.mjs: OpenStreetMap
buildings, water, trees, street lamps, bridges; metres east (x) and north (y) of the vantage) plus the
city's hand-modelled landmarks (landmarks_<city>.py), then renders:
  --view pano   the panorama the drop reads: 120 deg around the view's bearing, SITE's elevations
  --view <ref>  a perspective view matching a reference photo (REFS below), to check the scene against it

One render per source of light, so the site can relight the result live (light adds linearly):
  sky   daylight from an overcast sky dome of unit horizon radiance (the site scales it by the live sky)
  city  the city's fixed lights: street lamps, floodlights, landmarks' LEDs (faded in after dark)
  win   the evening's lit windows
  late  the few still lit late at night (a subset of the evening's)
  depth the distance to each pixel (for haze in the live weather)
Coverage is the sky render's alpha (film transparent: the live sky shows behind). Each is <out>-<name>.exr;
scripts/blender/encode.py packs them for the site.
"""

import bpy
import bmesh
import json
import math
import os
import random
import sys
from mathutils import Vector, geometry

sys.path.insert(0, os.path.dirname(__file__))
import trees  # noqa: E402
import facade  # noqa: E402
import filler  # noqa: E402
from filler import FACADE_ATTRS, facade_runs  # noqa: E402
from nodekit import add_shaders, attr, grey_of, math_node, mix_colour, node, nodes_of, output  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return ARGS[ARGS.index('--' + name) + 1] if '--' + name in ARGS else default


CITY = arg('city', 'london')
VIEW = arg('view', 'pano')
SCALE = float(arg('scale', '0.25'))
SAMPLES = int(arg('samples', '128'))
SEASON = arg('season', 'leaf')  # leaf or bare
# --only heroes: the city's landmarks alone (the silhouette check: is the city known by them?), nothing else.
ONLY = arg('only')
# --upto N: the 2026-10-02 geometry pass's steps up to N only, to compare them (1 landmarks, 2 filler
# archetypes, 3 roof detail, 4 facade styles); everything by default.
UPTO = int(arg('upto', '9'))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = arg('out', os.path.join(ROOT, 'data', 'skyline', CITY, 'render' if VIEW == 'pano' else 'ref-' + VIEW))

# Heights (metres): the street is z = 0.
SITE = {
    # Waterloo Bridge's deck about 12.5 m above mid tide; nothing in the view rises above 16 degrees
    # (the Eye's top, 136 m at 570 m, is at 13).
    # Curtain walls' glass coated as office glass is (n 1.8 to 2.4: 8 to 17% at normal incidence), not clear.
    'london': {'eye': 8.5, 'water': -4.0, 'deck': 5.5, 'el': (-20.0, 16.0), 'facade': {'glass_ior': (1.8, 2.4)}},
    # z = 0 is the Lower Manhattan waterfront, 2.5 m above NAVD88 (extract.mjs TERRAIN; buildings stand on
    # the ground under them). The eye 1.6 m above the lowest Granite Prospect step at Pier 1's edge (about
    # 1.95 m NAVD88, USGS 3DEP lidar); the water at mean sea level, 0.063 m below NAVD88 (NOAA tide
    # station 8518750, The Battery, 1983-2001 epoch; mean range 1.38 m). One World Trade Center's mast tip
    # stands about 17 degrees up. Windows: New York's offices are lit far more than London's at night (the
    # reference photos 5 and 8, at dusk and after): each building 8 to 50%, about 30%, against London's 18%;
    # blinds drawn in 18% (fewer than London's third: office towers).
    # Facades: office floors lit or dark as a whole (runs of 4 to 14 bays), blinds along stretches of 2 to 6,
    # curtain walls of coated glass reflecting 10 to 20% (n 1.9 to 2.6; clear glass 4%): the towers in the
    # photos read as sheets of sky and rows of lit floors, not scattered windows. And a building OSM gives a
    # colour but no material: light and warm is stone, darker red-brown brick, the rest glass (Lower
    # Manhattan's pre-war towers are masonry).
    # Its own archetypes, palettes and roofs (filler.py, roofs.py: setback towers, lofts under cornices, water
    # tanks; flat-tagged roofs no reason to keep OSM's plain massing).
    'new-york': {'eye': 1.05, 'water': -2.56, 'deck': 6.0, 'el': (-20.0, 22.0), 'busy': (0.08, 0.5), 'archetypes': 'new-york',
                 # Lit offices from warm 2800 K to LED and fluorescent white 5600 K (set2's night photos: mostly
                 # warm yellow, some white, a few green-white tubes; London's homelier 2600 to 4800); curtain
                 # walls' panes 84% of the bay, so the mullions show.
                 'facade': {'lit_run': (4, 14), 'blind_run': (2, 6), 'glass_ior': (1.9, 2.6), 'colour_material': True, 'blinds': 0.18,
                            'kelvin': (2800, 5600), 'each': 0.6, 'curtain_w': 0.42,
                            # Art deco window strips on half the masonry setback towers, ribbon windows on a
                            # third of the plain offices (facade.py style 5; filler.py).
                            'deco': True, 'ribbon': 0.33,
                            # Curtain walls' panes and reflections tinted by their glass's hue (facade.py).
                            'glass_tint': 0.7,
                            # Lit windows as dotted lines, not slabs (facade.py window_light): light at the
                            # ceiling, 18% of a lit run's windows dark, a long-tailed brightness, 12% of runs
                            # fluorescent (each window's own brightness replaces 'each' here).
                            'window_light': {'dropout': 0.18, 'fluorescent': 0.12, 'gain': 4.9}},
                 # Red aviation lights on every roof 150 m up or more (filler.py beacons).
                 'beacons': True,
                 # Trees OSM gives no height: 7 to 14 m (chosen; the mapped ones here are young, median 7 m, and the
                 # waterfront's are small in the photos), not London's 14 to 26 m planes.
                 'tree_h': (7, 14),
                 # Elevated roads drawn from OSM's lines: the FDR Drive's viaduct along the waterfront (the deck
                 # height is SITE's default, 6 m: OSM gives none).
                 'viaducts': True},
}[CITY]
PANO = {'span': 120.0, 'el': SITE.get('el', (-20.0, 36.0)), 'ppd': 32}  # degrees; pixels per degree at scale 1
# Floodlit stone's emission per unit of the 'flood' attribute, relative to its albedo (lit windows run
# 1.5 to 6.5): floodlit Portland stone is a few times dimmer than a lit office window.
FLOOD_GAIN = 6.0
# The share of the evening's lit windows still lit late at night (the site mixes the two by local hour):
# about 6% of all windows, as chosen.
LATE_SHARE = 0.32
FLOODLIT = {}  # building (or the building it is part of) by name, or a part by OSM id -> flood, from landmarks_<city>.py

# Reference photos (data/refs/<city>/, Wikimedia Commons, see sources.json): where the camera looks,
# its horizontal field of view and pitch, and the photo's size.
REFS = {
    'london': {
        # Fitted to where the Eye's hub and top, Millbank Tower, St George Wharf Tower, Victoria Tower and
        # Elizabeth Tower (tip and clock) fall in the photo, the camera held on the bridge (12 px rms at 3840).
        'ref4': {'pos': (-51, 100), 'eye': 10.0, 'heading': 205.38, 'hfov': 29.37, 'pitch': 3.12, 'size': (2000, 1331)},
        # From the same four landmarks across the frame; pitch from Elizabeth Tower's tip.
        'ref6': {'pos': (-77, 154), 'eye': 10.0, 'heading': 200.6, 'hfov': 30.2, 'pitch': 0.0, 'size': (1024, 768)},
    },
    'new-york': {
        # From Pier 1's west side (the eye pinned 1.6 m above the promenade), fitted to One WTC's mast tip and
        # parapet, 8 Spruce, Woolworth's crown, 30 Park Place, 60 Wall Street's crown, 55 Water and One New
        # York Plaza (25 px rms at 3840).
        'ref2': {'pos': (84, 135), 'eye': 2.63, 'heading': 288.75, 'hfov': 64.87, 'pitch': 7.44, 'size': (1920, 1280)},
        # Not a photo: an inspection view 160 m over the East River onto Lower Manhattan's roofs (the roofs and
        # facades are seen nearly edge-on from the vantage).
        'aerial': {'pos': (-250, 330), 'eye': 160.0, 'heading': 300.0, 'hfov': 38.0, 'pitch': -11.0, 'size': (1920, 1080)},
    },
}

scene_data = json.load(open(os.path.join(ROOT, 'data', 'skyline', CITY, 'scene.json')))
BEARING = scene_data['vantage']['bearing']
# The panorama's azimuths either side of the bearing (the vantage's `span`, src/content/vantages.json): it
# is rendered about their middle, CENTRE, PANO['span'] wide.
VIEW_SPAN = scene_data['vantage'].get('span', [-60, 60])
CENTRE = (BEARING + (VIEW_SPAN[0] + VIEW_SPAN[1]) / 2) % 360
PANO['span'] = float(VIEW_SPAN[1] - VIEW_SPAN[0])
rng = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---- Materials ------------------------------------------------------------------------------------

def simple_material(name, colour, roughness=0.8, **extra):
    mat = bpy.data.materials.new(name)
    nt = nodes_of(mat)
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=roughness, **{'Base Color': (*colour, 1)})
    for k, v in extra.items():
        b.inputs[k].default_value = v
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return mat


def water_material():
    """The river. The camera does not see it (a holdout: alpha 0, so the site draws the water itself, live,
    from the mirror render below); to every other ray it is dark, glossy water with small wind ripples,
    so it still lights the walls and bridges above it as before."""
    mat = bpy.data.materials.new('water')
    nt = nodes_of(mat)
    L = nt.links
    tc = node(nt, 'ShaderNodeTexCoord')
    mp = node(nt, 'ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0, 5.0, 1.0)  # ripples longer across the view than along it
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    wave.inputs['Scale'].default_value = 1.4
    wave.inputs['Detail'].default_value = 8.0
    wave.inputs['Roughness'].default_value = 0.6
    L.new(mp.outputs[0], wave.inputs['Vector'])
    bump = node(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.12
    bump.inputs['Distance'].default_value = 0.2
    L.new(wave.outputs['Fac'], bump.inputs['Height'])
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.03, **{'Base Color': (0.008, 0.011, 0.01, 1)})
    b.inputs['IOR'].default_value = 1.333
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    path = node(nt, 'ShaderNodeLightPath')
    hold = node(nt, 'ShaderNodeHoldout')
    mix = node(nt, 'ShaderNodeMixShader')
    L.new(path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    L.new(b.outputs[0], mix.inputs[1])
    L.new(hold.outputs[0], mix.inputs[2])
    out = node(nt, 'ShaderNodeOutputMaterial')
    L.new(mix.outputs[0], out.inputs['Surface'])
    return mat


def emission_material(name, colour, strength, base=None):
    """A light's glowing part. With `base`, the housing or glass seen by day when the light is off (an
    Emission alone renders black in the daylight pass)."""
    mat = bpy.data.materials.new(name)
    nt = nodes_of(mat)
    e = node(nt, 'ShaderNodeEmission', Strength=strength, Color=(*colour, 1))
    shader = e.outputs[0]
    if base:
        shader = add_shaders(nt, node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.4, **{'Base Color': (*base, 1)}).outputs[0], shader)
    output(nt, shader)
    return mat


def leaf_material():
    """Plane leaves: each card its own green (the 'leafvar' face attribute), shade to sunlit, and a
    little light through them."""
    mat = bpy.data.materials.new('leaves')
    nt = nodes_of(mat)
    L = nt.links
    tc = node(nt, 'ShaderNodeTexCoord')
    n = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    n.inputs['Scale'].default_value = 2.5
    n.inputs['Detail'].default_value = 4.0
    L.new(tc.outputs['Object'], n.inputs['Vector'])
    ramp = node(nt, 'ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.03, 0.045, 0.022, 1)
    ramp.color_ramp.elements[1].color = (0.1, 0.12, 0.05, 1)
    L.new(math_node(nt, 'MULTIPLY_ADD', attr(nt, 'leafvar'), 0.7, math_node(nt, 'MULTIPLY', n.outputs['Fac'], 0.3)), ramp.inputs['Fac'])
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.75)
    L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    tr = node(nt, 'ShaderNodeBsdfTranslucent')
    L.new(ramp.outputs['Color'], tr.inputs['Color'])
    mix = node(nt, 'ShaderNodeMixShader', Fac=0.25)
    L.new(b.outputs[0], mix.inputs[1])
    L.new(tr.outputs[0], mix.inputs[2])
    out = node(nt, 'ShaderNodeOutputMaterial')
    L.new(mix.outputs[0], out.inputs['Surface'])
    return mat


MAT = {
    'facade': facade.facade_material(SITE, LATE_SHARE, FLOOD_GAIN),
    'roof': facade.roof_material(FLOOD_GAIN),
    'ground': simple_material('ground', (0.05, 0.05, 0.048), 0.75),
    'embankment': simple_material('embankment', (0.22, 0.2, 0.17), 0.85),
    'water': water_material(),
    'leaves': leaf_material(),
    'bark': simple_material('bark', (0.11, 0.1, 0.085), 0.9),  # a plane's mottled grey-olive bark, twigs grey-brown
    'iron': simple_material('iron', (0.02, 0.022, 0.025), 0.45, Metallic=0.8),
    'bridge': simple_material('bridge', (0.16, 0.16, 0.15), 0.8),
    'bulb': emission_material('bulb', (1.0, 0.78, 0.52), 60.0, base=(0.5, 0.48, 0.42)),
}


# ---- Geometry ---------------------------------------------------------------------------------------

def signed_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def inside(ring, pt):
    x, y = pt
    odd = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            odd = not odd
    return odd


def clean(ring):
    pts = [tuple(p) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) > 0.05 or abs(p[1] - out[-1][1]) > 0.05):
            out.append(p)
    return out if len(out) >= 3 else None


class MeshBuilder:
    """Collects faces with per-face attributes and wall UVs, then makes one object."""

    def __init__(self, name, attrs=()):
        self.name = name
        self.verts = []
        self.faces = []
        self.uvs = []  # per face corner
        self.mat = []
        self.attrs = {a: [] for a in attrs}

    def face(self, pts, uvs=None, mat=0, **values):
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.uvs.append(uvs or [(0.0, 0.0)] * len(pts))
        self.mat.append(mat)
        for k, lst in self.attrs.items():
            lst.append(values.get(k, 0.0))

    def build(self, materials):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.verts, [], self.faces)
        uvl = me.uv_layers.new(name='walls')
        i = 0
        for fi, poly in enumerate(me.polygons):
            for li in poly.loop_indices:
                uvl.data[li].uv = self.uvs[fi][li - poly.loop_start]
            poly.material_index = self.mat[fi]
        for k, lst in self.attrs.items():
            if lst and isinstance(lst[0], tuple):
                a = me.attributes.new(k, 'FLOAT_COLOR', 'FACE')
                for fi, v in enumerate(lst):
                    a.data[fi].color = (*v, 1.0)
            else:
                a = me.attributes.new(k, 'FLOAT', 'FACE')
                a.data.foreach_set('value', [float(v) for v in lst])
        me.validate()
        for m in materials:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        return ob


def facade_object(name, bm, wall, roofc, style=2, bay=2.8, floorh=4.5, win_w=0.18, win_h=0.33, frame=0.28, busy=0.0, flood=0.0,
                  roof_nz=0.02, lightgroup='city'):
    """A modelled mesh (bmesh) given the city's facade: walls (faces within roof_nz of vertical) take the
    facade material with these window parameters, their UVs in metres along and up each face; the rest
    take the roof material in `roofc`. Floodlit by `flood` as OSM's buildings are."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    uvl = me.uv_layers.new(name='walls')
    for poly in me.polygons:
        n = poly.normal
        poly.material_index = 1 if n.z > roof_nz else 0
        t = Vector((-n.y, n.x, 0))
        t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.dot(t), co.z)
    vals = dict(wall=wall, style=style, bay=bay, floorh=floorh, win_w=win_w, win_h=win_h, frame=frame, busy=busy,
                seed=rng.random() * 1000, roofc=roofc, flood=flood, **facade_runs(style))
    for k in FACADE_ATTRS:
        v = vals[k]
        if isinstance(v, tuple):
            a = me.attributes.new(k, 'FLOAT_COLOR', 'FACE')
            for d in a.data:
                d.color = (*v, 1.0)
        else:
            a = me.attributes.new(k, 'FLOAT', 'FACE')
            a.data.foreach_set('value', [float(v)] * len(me.polygons))
    me.materials.append(MAT['facade'])
    me.materials.append(MAT['roof'])
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.lightgroup = lightgroup
    return ob


def tessellate(outer, holes=()):
    """Triangles covering outer minus holes (2D), as index triples into outer + holes flattened."""
    loops = [[Vector((x, y, 0)) for x, y in r] for r in [outer, *holes]]
    tris = geometry.tessellate_polygon(loops)
    flat = [p for r in [outer, *holes] for p in r]
    return tris, flat


def landmark_override(b):
    if not landmarks:
        return None
    o = getattr(landmarks, 'OVERRIDES', {})
    return o.get(b['id']) or o.get(b.get('name')) or o.get((b.get('within') or {}).get('name'))


def replaced(b):
    names = getattr(landmarks, 'REPLACES_WITHIN', ()) if landmarks else ()
    return b['id'] in LANDMARK_REPLACES or b.get('name') in names or (b.get('within') or {}).get('name') in names


def build_ground_and_water():
    """Street level everywhere but the river: a ground slab with the water polygons cut out by a boolean
    (robust where OSM's river pieces overlap), stone embankment walls down to the water, the water below."""
    R = 9000
    wz = SITE['water']
    bpy.ops.mesh.primitive_cube_add(size=1)
    ground = bpy.context.active_object
    ground.name = 'ground'
    ground.scale = (2 * R, 2 * R, 1.0)
    ground.location = (0, 0, -0.5)
    ground.data.materials.append(MAT['ground'])
    cutter = MeshBuilder('river_cut')
    water = MeshBuilder('water')
    wall = MeshBuilder('embankment')
    fill = getattr(landmarks, 'RIVER_FILL', ()) if landmarks else ()

    def filled(ring):  # a hole a landmark module fills with water (a pier it leaves out)
        c = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
        return any(math.dist(c, f) < 10.0 for f in fill)

    for w in scene_data['water']:
        o = [r for r in (clean(r) for r in w['outer']) if r]
        h = [r for r in (clean(r) for r in w['inner']) if r and not filled(r)]
        for ring in o:
            tris, flat = tessellate(ring, h)
            for t in tris:
                a, b, c = flat[t[0]], flat[t[1]], flat[t[2]]
                water.face([(*a, wz), (*b, wz), (*c, wz)])
            # A closed prism for the cut.
            ccw = ring if signed_area(ring) > 0 else ring[::-1]
            for t in tessellate(ccw)[0]:
                fl = tessellate(ccw)[1]
                a, b, c = fl[t[0]], fl[t[1]], fl[t[2]]
                cutter.face([(*a, 2.0), (*b, 2.0), (*c, 2.0)])
                cutter.face([(*c, -8.0), (*b, -8.0), (*a, -8.0)])
            for i in range(len(ccw)):
                a, c = ccw[i], ccw[(i + 1) % len(ccw)]
                cutter.face([(a[0], a[1], -8.0), (c[0], c[1], -8.0), (c[0], c[1], 2.0), (a[0], a[1], 2.0)])
                # The embankment wall, facing into the river.
                wall.face([(c[0], c[1], wz - 0.5), (a[0], a[1], wz - 0.5), (a[0], a[1], 0.0), (c[0], c[1], 0.0)])
        # Holes in the water (bridge piers, mostly): solid, their walls facing the water, capped at street level.
        for hole in h:
            ccw = hole if signed_area(hole) > 0 else hole[::-1]
            for i in range(len(ccw)):
                a, c = ccw[i], ccw[(i + 1) % len(ccw)]
                wall.face([(a[0], a[1], wz - 0.5), (c[0], c[1], wz - 0.5), (c[0], c[1], 0.0), (a[0], a[1], 0.0)])
            tris, flat = tessellate(ccw)
            for t in tris:
                wall.face([(*flat[t[0]], 0.0), (*flat[t[1]], 0.0), (*flat[t[2]], 0.0)])
    cut = cutter.build([MAT['ground']])
    mod = ground.modifiers.new('river', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT' if 'EXACT' in [e.identifier for e in mod.bl_rna.properties['solver'].enum_items] else mod.solver
    mod.object = cut
    bpy.context.view_layer.objects.active = ground
    bpy.ops.object.modifier_apply(modifier='river')
    bpy.data.objects.remove(cut)
    return ground, wall.build([MAT['embankment']]), water.build([MAT['water']])


def build_bridges():
    """Bridge decks from OSM bridge outlines (man_made=bridge), at deck height, the vantage's own excepted."""
    mb = MeshBuilder('bridges')
    deck = SITE['deck']
    for br in scene_data['bridges']:
        if not br['area'] or br['id'] in LANDMARK_REPLACES:
            continue
        ring = clean(br['pts'])
        # The vantage's own bridge is left out (the view is over its parapet): the one the vantage stands
        # in, or one passing within 40 m of it.
        if not ring or inside(ring, (0.0, 0.0)) or min(math.hypot(x, y) for x, y in ring) < 40:
            continue
        tris, flat = tessellate(ring)
        for t in tris:
            mb.face([(*flat[t[0]], deck), (*flat[t[1]], deck), (*flat[t[2]], deck)])
            mb.face([(*flat[t[2]], deck - 1.6), (*flat[t[1]], deck - 1.6), (*flat[t[0]], deck - 1.6)])
        pts = ring if signed_area(ring) > 0 else ring[::-1]
        for i in range(len(pts)):
            a, c = pts[i], pts[(i + 1) % len(pts)]
            mb.face([(a[0], a[1], deck - 1.6), (c[0], c[1], deck - 1.6), (c[0], c[1], deck + 1.1), (a[0], a[1], deck + 1.1)])
    # Elevated roads OSM maps as lines only (New York's FDR Drive along the Manhattan waterfront): a deck
    # along each, a carriageway's width (motorways and trunks 11 m, three lanes; the rest 7.5 m), at the deck
    # height (OSM gives none), on the ground under it. The great bridges (layer 3 and up) are not these.
    if SITE.get('viaducts'):
        widths = {'motorway': 11.0, 'trunk': 11.0, 'primary': 11.0}
        for br in scene_data['bridges']:
            if br['area'] or br['id'] in LANDMARK_REPLACES or br['layer'] >= 3:
                continue
            kind = br['kind'].replace('_link', '')
            if kind not in ('motorway', 'trunk', 'primary', 'secondary'):
                continue
            half = widths.get(kind, 7.5) / 2 if not br['kind'].endswith('_link') else 3.75
            pts = br['pts']
            for i in range(1, len(pts)):
                (ax, ay), (cx, cy) = pts[i - 1], pts[i]
                L = math.hypot(cx - ax, cy - ay)
                if L < 0.5 or min(math.hypot(ax, ay), math.hypot(cx, cy)) < 40:
                    continue
                nx, ny = -(cy - ay) / L * half, (cx - ax) / L * half
                quad = [(ax + nx, ay + ny), (cx + nx, cy + ny), (cx - nx, cy - ny), (ax - nx, ay - ny)]
                mb.face([(*q, deck) for q in quad])
                mb.face([(*q, deck - 1.6) for q in quad[::-1]])
                for (p0, p1) in ((quad[0], quad[1]), (quad[2], quad[3])):
                    mb.face([(*p0, deck - 1.6), (*p1, deck - 1.6), (*p1, deck + 1.1), (*p0, deck + 1.1)])
            # Its lamps, which OSM does not map: one every 35 m along the deck's edge (chosen; reference
            # photo 8 shows an unbroken chain of them along the waterfront), as the street lamps are.
            walked = 17.5
            for i in range(1, len(pts)):
                (ax, ay), (cx, cy) = pts[i - 1], pts[i]
                L = math.hypot(cx - ax, cy - ay)
                while walked < L:
                    t = walked / L
                    nx, ny = -(cy - ay) / L * (half - 0.5), (cx - ax) / L * (half - 0.5)
                    scene_data['lamps'].append({'at': [ax + (cx - ax) * t + nx, ay + (cy - ay) * t + ny], 'base': deck, 'colour': None, 'count': 1})
                    walked += 35.0
                walked -= L
    return mb.build([MAT['bridge']])


def build_trees():
    """OpenStreetMap's trees (and tree rows, one every 9 m), each an instance of one of six grown London
    planes, scaled to its mapped height and crown or to a street plane's (14 to 26 m, crown 0.6 to 0.8
    of that); in leaf or bare by --season."""
    templates = trees.make_templates(bpy, MAT, count=6, leaves=SEASON == 'leaf')
    parent = bpy.data.collections.new('trees')
    bpy.context.scene.collection.children.link(parent)
    near = 0
    for i, tr in enumerate(scene_data['trees']):
        # None within 25 m of the eye: so close its leaf cards would show, and it would hide the view.
        if math.hypot(*tr['at']) < 25:
            near += 1
            continue
        own = random.Random(i * 7919 + 1)  # each tree's own draws: the buildings' do not reshuffle the trees
        h = tr['height'] or own.uniform(*SITE.get('tree_h', (14, 26)))
        crown = tr['crown'] or h * own.uniform(0.6, 0.8)
        ob = bpy.data.objects.new(f'tree_{i}', None)
        ob.instance_type = 'COLLECTION'
        ob.instance_collection = templates[i % len(templates)]
        ob.location = (tr['at'][0], tr['at'][1], tr.get('base', 0.0))
        ob.scale = (crown, crown, h)
        ob.rotation_euler = (0, 0, own.uniform(0, math.tau))
        ob['tree'] = 1.0  # the trees pass (tree_material) picks them out
        parent.objects.link(ob)
    print(f'trees: {len(scene_data["trees"]) - near} ({SEASON}; {near} within 25 m of the eye left out)')


def build_lamps():
    """Street lamps: a post, a warm bulb (visible), and the light it casts. All in the city group."""
    coll = bpy.data.collections.new('lamps')
    bpy.context.scene.collection.children.link(coll)
    post_me = bpy.data.meshes.new('lamp_post')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.09, radius2=0.06, depth=5.0)
    for v in bm.verts:
        v.co.z += 2.5
    bm.to_mesh(post_me)
    bm.free()
    post_me.materials.append(MAT['iron'])
    bulb_me = bpy.data.meshes.new('lamp_bulb')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.22)
    bm.to_mesh(bulb_me)
    bm.free()
    bulb_me.materials.append(MAT['bulb'])
    for i, lp in enumerate(scene_data['lamps']):
        x, y = lp['at']
        zb = lp.get('base', 0.0)
        post = bpy.data.objects.new(f'post_{i}', post_me)
        post.location = (x, y, zb)
        bulb = bpy.data.objects.new(f'bulb_{i}', bulb_me)
        bulb.location = (x, y, zb + 5.2)
        bulb.lightgroup = 'city'
        light = bpy.data.lights.new(f'lamp_{i}', 'POINT')
        light.energy = 180.0
        light.shadow_soft_size = 0.25
        light.color = (1.0, 0.8, 0.58)
        lo = bpy.data.objects.new(f'lamp_{i}', light)
        lo.location = (x, y, zb + 5.0)
        lo.lightgroup = 'city'
        for o in (post, bulb, lo):
            coll.objects.link(o)
    print(f'lamps: {len(scene_data["lamps"])}')


# ---- Landmarks ------------------------------------------------------------------------------------
LANDMARK_REPLACES = set()
landmark_file = os.path.join(os.path.dirname(__file__), f'landmarks_{CITY.replace("-", "_")}.py')
landmarks = None
if os.path.exists(landmark_file):
    import importlib.util
    spec = importlib.util.spec_from_file_location('landmarks', landmark_file)
    landmarks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(landmarks)
    LANDMARK_REPLACES = set(getattr(landmarks, 'REPLACES', ()))
    if hasattr(landmarks, 'prepare'):
        LANDMARK_REPLACES |= set(landmarks.prepare(scene_data))
    FLOODLIT.update(getattr(landmarks, 'FLOODLIT', {}))


# ---- World, light groups, camera, render ------------------------------------------------------------

# What glass and metal reflect: a real overcast city sky (Poly Haven's "Urban Street 01", a London street
# under cloud, Andreas Mischok, CC0), seen only by glossy rays: the walls are lit by the overcast dome as
# before (the lighting is unchanged), while curtain walls and capsules mirror cloud, street and facades.
HDRI = {'name': 'urban_street_01', 'url': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/urban_street_01_2k.hdr',
        'saturation': 0.5}


def hdri_path():
    path = os.path.join(ROOT, 'data', 'hdri', os.path.basename(HDRI['url']))
    if not os.path.exists(path):
        import urllib.request
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(HDRI['url'], path)
    return path


def hdri_scale(path):
    """The HDRI's gain to the dome's brightness over the open sky (25 to 90 degrees up, weighted by solid
    angle): a street HDRI's horizon is buildings, so matching it there would blow out every reflection of
    the sky above (tried: 18 times too bright, the Jubilee stays and the Eye's capsules turned to chrome)."""
    import OpenImageIO as oiio
    import numpy as np
    inp = oiio.ImageInput.open(path)
    spec = inp.spec()
    px = inp.read_image(0, 0, 0, 3, 'float').reshape(spec.height, spec.width, 3)
    inp.close()
    lum = (px @ np.array([0.2126, 0.7152, 0.0722])).mean(axis=1)
    el = (0.5 - (np.arange(spec.height) + 0.5) / spec.height) * math.pi
    w = np.cos(el) * (el > math.radians(25))
    return float(((1 + 2 * np.sin(el)) * w).sum() / max((lum * w).sum(), 1e-6))


def setup_world():
    """An overcast sky of unit horizon radiance, (1 + 2 sin h) / 3 × 3 up to the zenith (CIE overcast),
    neutral in colour: the site tints and scales it with the live sky. Below the horizon, dim ground. To
    glossy rays, the reflection HDRI at the same horizon radiance, half desaturated."""
    world = bpy.data.worlds.new('sky')
    scene.world = world
    nt = nodes_of(world)
    L = nt.links
    tc = node(nt, 'ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs[0])
    z = math_node(nt, 'MAXIMUM', sep.outputs['Z'], 0.0)
    lum = math_node(nt, 'MULTIPLY_ADD', z, 2.0, 1.0)  # 1 at the horizon, 3 at the zenith
    below = math_node(nt, 'LESS_THAN', sep.outputs['Z'], 0.0)
    lum = math_node(nt, 'MULTIPLY', lum, math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', below, 0.9)))
    gain = node(nt, 'ShaderNodeValue', name='sky_gain', label='sky_gain')
    gain.outputs[0].default_value = 1.0
    bg = node(nt, 'ShaderNodeBackground', Color=(1, 1, 1, 1))
    L.new(math_node(nt, 'MULTIPLY', lum, gain.outputs[0]), bg.inputs['Strength'])
    path = hdri_path()
    env = node(nt, 'ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(path)
    sat = node(nt, 'ShaderNodeHueSaturation', Saturation=HDRI['saturation'])
    L.new(env.outputs['Color'], sat.inputs['Color'])
    refl = node(nt, 'ShaderNodeBackground')
    L.new(sat.outputs['Color'], refl.inputs['Color'])
    L.new(math_node(nt, 'MULTIPLY', gain.outputs[0], hdri_scale(path)), refl.inputs['Strength'])
    pick = node(nt, 'ShaderNodeMixShader')
    L.new(node(nt, 'ShaderNodeLightPath').outputs['Is Glossy Ray'], pick.inputs['Fac'])
    L.new(bg.outputs[0], pick.inputs[1])
    L.new(refl.outputs[0], pick.inputs[2])
    out = node(nt, 'ShaderNodeOutputWorld')
    L.new(pick.outputs[0], out.inputs['Surface'])
    return world


def setup_render():
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.max_bounces = 6
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    vl = scene.view_layers[0]
    for name in ('sky', 'city'):
        vl.lightgroups.add(name=name)
    vl.use_pass_z = True
    scene.world.lightgroup = 'sky'
    scene.render.use_compositing = False
    scene.render.image_settings.media_type = 'IMAGE'
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.exr_codec = 'ZIP'


def setup_camera():
    cam_data = bpy.data.cameras.new('eye')
    cam = bpy.data.objects.new('eye', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0, 0, SITE['eye'])
    cam_data.clip_start = 1.0
    cam_data.clip_end = 20000
    if VIEW == 'pano':
        span, (el0, el1), ppd = PANO['span'], PANO['el'], PANO['ppd']
        cam_data.type = 'PANO'
        cam_data.panorama_type = 'EQUIRECTANGULAR'
        cam_data.longitude_min = math.radians(-span / 2)
        cam_data.longitude_max = math.radians(span / 2)
        cam_data.latitude_min = math.radians(el0)
        cam_data.latitude_max = math.radians(el1)
        scene.render.resolution_x = int(span * ppd * SCALE)
        scene.render.resolution_y = int((el1 - el0) * ppd * SCALE)
        heading, pitch = CENTRE, 0.0
    else:
        ref = REFS[CITY][VIEW]
        cam_data.type = 'PERSP'
        cam_data.sensor_fit = 'HORIZONTAL'
        cam_data.angle = math.radians(ref['hfov'])
        scene.render.resolution_x = int(ref['size'][0] * SCALE * 2)
        scene.render.resolution_y = int(ref['size'][1] * SCALE * 2)
        heading, pitch = ref['heading'], ref['pitch']
        cam.location = (*ref['pos'], ref.get('eye', SITE['eye']))
    scene.render.resolution_percentage = 100
    if arg('border'):  # render only part of the frame: --border x0,x1,y0,y1 (fractions, y up)
        x0, x1, y0, y1 = (float(v) for v in arg('border').split(','))
        scene.render.use_border = True
        scene.render.use_crop_to_border = True
        scene.render.border_min_x, scene.render.border_max_x = x0, x1
        scene.render.border_min_y, scene.render.border_max_y = y0, y1
    # Looking along +y (north) after the x turn, then clockwise by the heading.
    cam.rotation_euler = (math.radians(90 + pitch), 0.0, math.radians(-heading))
    return cam


setup_world()
setup_render()
filler.setup(globals())
filler.build_city()
if not ONLY:
    build_ground_and_water()
    build_bridges()
    build_trees()
    build_lamps()
if landmarks:
    landmarks.build(globals())
for ob in bpy.data.objects:
    if ob.name.startswith('buildings'):
        ob.lightgroup = 'city'  # the lit windows
setup_camera()


def scene_stats():
    """What the bake draws: objects and instances (the GPU draw calls a real-time engine would issue, one
    per object and material), and triangles, instanced trees counted per instance."""
    dg = bpy.context.evaluated_depsgraph_get()
    tris, objects, slots = 0, 0, 0
    per_mesh, groups = {}, {}
    for inst in dg.object_instances:
        ob = inst.object
        if ob.type != 'MESH':
            continue
        me = ob.data
        if me.name not in per_mesh:
            me.calc_loop_triangles()
            per_mesh[me.name] = (len(me.loop_triangles), max(1, len(me.materials)))
        t, m = per_mesh[me.name]
        tris += t
        objects += 1
        slots += m
        grp = 'trees' if inst.is_instance else ('buildings' if ob.name.startswith('buildings') else 'roof props' if ob.name.startswith('roof') else
                                                'landmarks' if ob.name.split('_')[0] in LANDMARK_OBJECTS else 'other')
        groups[grp] = groups.get(grp, 0) + t
    print(f'stats: {objects} mesh objects and instances, {slots} draws (object x material), {tris:,} triangles')
    print('stats by group: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(groups.items(), key=lambda kv: -kv[1])))


LANDMARK_OBJECTS = {'eye', 'jubilee', 'hungerford', 'elizabeth', 'victoria', 'central', 'palace', 'millbank', 'st', 'whitehall', 'clock'}
LANDMARK_OBJECTS |= set(getattr(landmarks, 'OBJECT_PREFIXES', ()))


scene_stats()
print(f'rendering {VIEW} at {scene.render.resolution_x}x{scene.render.resolution_y}, {SAMPLES} samples → {OUT}.exr')
EMISSION_STRENGTH = {}
for m in bpy.data.materials:
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'EMISSION' and not n.inputs['Strength'].is_linked:
                EMISSION_STRENGTH[(m.name, n.name)] = n.inputs['Strength'].default_value
LIGHTS = [o for o in bpy.data.objects if o.type == 'LIGHT']


def set_lights(city=False, windows=False, late=False, sky=False):
    """What lights this render: the city's fixed lights (lamps, floodlights, landmarks' LEDs), its
    windows (the evening's or the late night's), the sky."""
    for (mname, nname), v in EMISSION_STRENGTH.items():
        bpy.data.materials[mname].node_tree.nodes[nname].inputs['Strength'].default_value = v if city else 0.0
    for m in bpy.data.materials:
        nodes = m.node_tree.nodes if m.node_tree else {}
        if 'city_gain' in nodes:
            nodes['city_gain'].outputs[0].default_value = 1.0 if city else 0.0
        if 'window_gain' in nodes:
            nodes['window_gain'].outputs[0].default_value = 1.0 if windows else 0.0
        if 'window_late' in nodes:
            nodes['window_late'].outputs[0].default_value = 1.0 if late else 0.0
    for o in LIGHTS:
        o.hide_render = not city
    scene.world.node_tree.nodes['sky_gain'].outputs[0].default_value = 1.0 if sky else 0.0


def depth_material():
    mat = bpy.data.materials.new('depth')
    nt = nodes_of(mat)
    cam = node(nt, 'ShaderNodeCameraData')
    e = node(nt, 'ShaderNodeEmission', Strength=1.0)
    comb = node(nt, 'ShaderNodeCombineColor')
    for c in ('Red', 'Green', 'Blue'):
        nt.links.new(cam.outputs['View Distance'], comb.inputs[c])
    nt.links.new(comb.outputs[0], e.inputs['Color'])
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    return mat


def tree_material():
    """The trees pass: white where a tree is, black elsewhere (as coverage, through the film's alpha), so the
    site can sway the trees' pixels and nothing else (encode.py packs it)."""
    mat = bpy.data.materials.new('trees')
    nt = nodes_of(mat)
    tree = node(nt, 'ShaderNodeAttribute', attribute_type='INSTANCER', attribute_name='tree')
    # How far up the tree (the templates are a unit tall): the trunk stands still, the crown bends more
    # the higher it is, as a tree in the wind does.
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(node(nt, 'ShaderNodeTexCoord').outputs['Object'], sep.inputs[0])
    bend = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.25, 'From Max': 0.9, 'To Min': 0.0, 'To Max': 1.0})
    bend.interpolation_type = 'SMOOTHSTEP'
    nt.links.new(sep.outputs['Z'], bend.inputs['Value'])
    e = node(nt, 'ShaderNodeEmission', Strength=1.0)
    nt.links.new(math_node(nt, 'MULTIPLY', tree.outputs['Fac'], bend.outputs['Result']), e.inputs['Color'])
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    return mat


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('→', path + '.exr')


def clip_below_water():
    """For the mirror render: the camera sees nothing below the water plane (the underwater parts of
    walls and piers would stand in front of their own reflections). Every other ray sees the scene as it is."""
    wz = SITE['water']
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if out is None or not out.inputs['Surface'].is_linked:
            continue
        src = out.inputs['Surface'].links[0].from_socket
        geo = node(nt, 'ShaderNodeNewGeometry')
        sep = node(nt, 'ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Position'], sep.inputs[0])
        below = math_node(nt, 'LESS_THAN', sep.outputs['Z'], wz)
        camera = node(nt, 'ShaderNodeLightPath').outputs['Is Camera Ray']
        mix = node(nt, 'ShaderNodeMixShader')
        nt.links.new(math_node(nt, 'MULTIPLY', below, camera), mix.inputs['Fac'])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(node(nt, 'ShaderNodeBsdfTransparent').outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])


def render_set(prefix, passes):
    """The light renders (sky, city, windows, late windows) and the distance, with this camera."""
    for name, lights in (('sky', dict(sky=True)), ('city', dict(city=True)), ('win', dict(windows=True)), ('late', dict(windows=True, late=True))):
        if name in passes:
            set_lights(**lights)
            render(f'{prefix}-{name}')
    if 'depth' in passes:
        set_lights()
        scene.view_layers[0].material_override = DEPTH
        scene.cycles.samples = 1
        scene.cycles.use_denoising = False
        filter_width = scene.cycles.filter_width
        scene.cycles.filter_width = 0.01
        render(prefix + '-depth')
        scene.view_layers[0].material_override = None
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = True
        scene.cycles.filter_width = filter_width
    if 'trees' in passes:
        set_lights()
        scene.view_layers[0].material_override = TREES
        scene.cycles.samples = 32  # anti-aliased like the light renders' coverage; no light to converge
        scene.cycles.use_denoising = False
        render(prefix + '-trees')
        scene.view_layers[0].material_override = None
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = True


# Five renders of the one scene: light adds linearly, so each source can be rendered alone and the
# site mixes them by the live sky, the dark and the local hour.
DEPTH = depth_material()
TREES = tree_material()
passes = arg('passes', 'sky,city,win,late,depth,trees').split(',')
render_set(OUT, passes)
mirror = None
if VIEW == 'pano' and scene_data['water'] and arg('mirror', '1') == '1':
    # The river's reflection, exactly: the same panorama seen from the eye's mirror image below the
    # water plane, looking up, the water itself hidden from the camera. A reflected ray leaving the water
    # at elevation e is this camera's ray at +e, so the site reads the river's pixel at -e from here at +e,
    # tilted by its live waves. Half the vertical resolution: the waves blur it far more than that.
    cam = scene.camera
    wz = SITE['water']
    cam.location = (0, 0, 2 * wz - SITE['eye'])
    ppd = PANO['ppd']
    top = -PANO['el'][0]
    cam.data.latitude_min = 0.0
    cam.data.latitude_max = math.radians(top)
    scene.render.resolution_y = int(top * ppd / 2 * SCALE)
    for ob in bpy.data.objects:
        if ob.name.startswith('water'):
            ob.visible_camera = False
    clip_below_water()  # every material, the distance render's too
    render_set(OUT + '-mirror', [p for p in passes if p != 'trees'])  # the river's trees stay still
    mirror = {'elevation': [0.0, top], 'size': [scene.render.resolution_x, scene.render.resolution_y],
              'eyeAboveWater': SITE['eye'] - wz}
if VIEW == 'pano':
    # Where the panorama sits in the sky, for scripts/blender/encode.py.
    res_y = int((PANO['el'][1] - PANO['el'][0]) * PANO['ppd'] * SCALE)
    json.dump({'bearing': BEARING, 'centre': CENTRE, 'span': PANO['span'], 'elevation': list(PANO['el']), 'season': SEASON,
               'size': [scene.render.resolution_x, res_y], 'mirror': mirror}, open(OUT + '.json', 'w'))
print('done')
