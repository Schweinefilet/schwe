"""A city's skyline from its vantage point, path traced in Blender (Cycles).

    blender -b --factory-startup -P scripts/blender/skyline.py -- --city london \
        [--view pano|<ref>] [--scale 0.25] [--samples 128] [--season leaf|bare]
        [--passes sky,city,win,late,depth] [--out data/skyline/london/render] [--border x0,x1,y0,y1]

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

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return ARGS[ARGS.index('--' + name) + 1] if '--' + name in ARGS else default


CITY = arg('city', 'london')
VIEW = arg('view', 'pano')
SCALE = float(arg('scale', '0.25'))
SAMPLES = int(arg('samples', '128'))
SEASON = arg('season', 'leaf')  # leaf or bare
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = arg('out', os.path.join(ROOT, 'data', 'skyline', CITY, 'render' if VIEW == 'pano' else 'ref-' + VIEW))

# Heights (metres): the street is z = 0.
SITE = {
    # Waterloo Bridge's deck about 12.5 m above mid tide; nothing in the view rises above 16 degrees
    # (the Eye's top, 136 m at 570 m, is at 13).
    'london': {'eye': 8.5, 'water': -4.0, 'deck': 5.5, 'el': (-20.0, 16.0)},
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
    'new-york': {'eye': 1.05, 'water': -2.56, 'deck': 6.0, 'el': (-20.0, 22.0), 'busy': (0.08, 0.5),
                 # Lit offices LED and fluorescent white, 3200 to 5200 K (the photos' windows warm white, not
                 # London's homelier 2600 to 4800); each window 30% either way within its lit run; curtain
                 # walls' panes 84% of the bay, so the mullions show.
                 'facade': {'lit_run': (4, 14), 'blind_run': (2, 6), 'glass_ior': (1.9, 2.6), 'colour_material': True, 'blinds': 0.18,
                            'kelvin': (3200, 5200), 'each': 0.6, 'curtain_w': 0.42},
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
FLOODLIT = {}  # building (or the building it is part of) by name -> flood, from landmarks_<city>.py

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
    },
}

scene_data = json.load(open(os.path.join(ROOT, 'data', 'skyline', CITY, 'scene.json')))
BEARING = scene_data['vantage']['bearing']
rng = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---- Materials ------------------------------------------------------------------------------------

def nodes_of(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k in n.inputs:
            n.inputs[k].default_value = v
        else:
            setattr(n, k, v)
    return n


def math_node(nt, op, a, b=None, c=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def attr(nt, name, kind='Fac'):
    n = nt.nodes.new('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs[kind]


def grey_of(nt, value):
    c = nt.nodes.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        nt.links.new(value, c.inputs[ch])
    return c.outputs[0]


def mix_colour(nt, fac, a, b, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    for sock, v in (('Factor', fac), ('A', a), ('B', b)):
        if isinstance(v, (int, float)):
            m.inputs[sock].default_value = v
        elif isinstance(v, tuple):
            m.inputs[sock].default_value = (*v, 1.0) if len(v) == 3 else v
        else:
            nt.links.new(v, m.inputs[sock])
    return m.outputs['Result']


def facade_material():
    """Walls with windows in their own metres (UV u along the wall, v up it). Per building face
    attributes: wall colour, style (0 curtain wall, 1 punched windows, 2 masonry with tall narrow
    windows, 3 none: turrets, pinnacles, roofs mapped as parts), bay width, floor height, the window's
    half width and height (fractions of its cell), frame lightness, how busy it is at night, a seed.
    Each window its own: dark rooms, blinds and curtains by day; lit or not, and how, by night."""
    mat = bpy.data.materials.new('facade')
    nt = nodes_of(mat)
    L = nt.links
    uv = node(nt, 'ShaderNodeUVMap', uv_map='walls')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    L.new(uv.outputs['UV'], sep.inputs[0])
    u, v = sep.outputs['X'], sep.outputs['Y']
    bay, floorh, busy, seed = attr(nt, 'bay'), attr(nt, 'floorh'), attr(nt, 'busy'), attr(nt, 'seed')
    style, win_w, win_h, frame = attr(nt, 'style'), attr(nt, 'win_w'), attr(nt, 'win_h'), attr(nt, 'frame')
    cu = math_node(nt, 'DIVIDE', u, bay)
    cv = math_node(nt, 'DIVIDE', v, floorh)
    ix, iy = math_node(nt, 'FLOOR', cu), math_node(nt, 'FLOOR', cv)
    fx, fy = math_node(nt, 'FRACT', cu), math_node(nt, 'FRACT', cv)
    dx = math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', fx, 0.5))
    dy = math_node(nt, 'ABSOLUTE', math_node(nt, 'SUBTRACT', fy, 0.52))
    has = math_node(nt, 'LESS_THAN', style, 2.5)
    outer = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'LESS_THAN', dx, win_w), math_node(nt, 'LESS_THAN', dy, win_h)), has)
    # The frame: 9 cm all round.
    fw = math_node(nt, 'DIVIDE', 0.09, bay)
    fh = math_node(nt, 'DIVIDE', 0.09, floorh)
    inner = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'LESS_THAN', dx, math_node(nt, 'SUBTRACT', win_w, fw)),
                                                math_node(nt, 'LESS_THAN', dy, math_node(nt, 'SUBTRACT', win_h, fh))), has)
    frame_mask = math_node(nt, 'SUBTRACT', outer, inner)
    # Two random draws per window: the first (lit or not at night, and how) shared along a run of `run_l`
    # bays of the floor, the second (blind or curtain by day) along `run_b` bays: an office floor is lit or
    # dark as a whole, its blinds drawn along a stretch. A run of 1 (a city that sets none) is each window
    # its own.
    run_l = math_node(nt, 'MAXIMUM', attr(nt, 'run_l'), 1.0)
    run_b = math_node(nt, 'MAXIMUM', attr(nt, 'run_b'), 1.0)
    draws = []
    for k, run in ((0.0, run_l), (31.7, run_b)):
        comb = node(nt, 'ShaderNodeCombineXYZ')
        L.new(math_node(nt, 'FLOOR', math_node(nt, 'DIVIDE', ix, run)), comb.inputs['X'])
        L.new(iy, comb.inputs['Y'])
        L.new(math_node(nt, 'ADD', seed, k), comb.inputs['Z'])
        wn = node(nt, 'ShaderNodeTexWhiteNoise', noise_dimensions='3D')
        L.new(comb.outputs[0], wn.inputs['Vector'])
        sc = node(nt, 'ShaderNodeSeparateColor')
        L.new(wn.outputs['Color'], sc.inputs[0])
        draws.append((wn.outputs['Value'], wn.outputs['Color'], sc.outputs))
    (r1, c1, s1), (r2, c2, s2) = draws
    # By day: a dark room behind the glass, or blinds or curtains (about a third), lighter and varied.
    room = grey_of(nt, math_node(nt, 'MULTIPLY_ADD', r2, 0.05, 0.012))
    # Blinds and curtains: white, cream and grey, lighter and darker; no colours at this range.
    blind_col = mix_colour(nt, s2[0], (0.46, 0.42, 0.35), (0.5, 0.5, 0.5))
    blind_col = mix_colour(nt, math_node(nt, 'MULTIPLY_ADD', s2[2], 0.55, 0.05), blind_col, (0.05, 0.05, 0.05))
    # About a third of windows with blinds or curtains drawn; a city's own share where SITE gives one. Behind a
    # curtain wall's tinted glass (style 0) they read darker.
    blind = math_node(nt, 'GREATER_THAN', r2, 1.0 - SITE.get('facade', {}).get('blinds', 0.36))
    blind_col = mix_colour(nt, math_node(nt, 'LESS_THAN', style, 0.5), blind_col, (0.5, 0.5, 0.5), 'MULTIPLY')
    interior = mix_colour(nt, blind, room, blind_col)
    glass = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.6)
    L.new(interior, glass.inputs['Base Color'])
    glass.inputs['Coat Weight'].default_value = 1.0
    # Clear glass (n 1.52, 4% at normal incidence), or a building's reflective coating where the city gives
    # one ('glass_ior': an office tower's low-e glass reflects several times more).
    L.new(math_node(nt, 'MAXIMUM', attr(nt, 'glass_ior'), 1.52), glass.inputs['Coat IOR'])
    L.new(math_node(nt, 'MULTIPLY_ADD', s2[1], 0.05, 0.01), glass.inputs['Coat Roughness'])  # panes not quite flat
    # By night: lit rooms, warm homes to cool offices, each its own brightness.
    # The evening's lit windows, or (window_late 1) the few of them still lit late at night.
    late = node(nt, 'ShaderNodeValue', name='window_late', label='window_late')
    late.outputs[0].default_value = 0.0
    share = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', late.outputs[0], 1.0 - LATE_SHARE))
    lit = math_node(nt, 'MULTIPLY', math_node(nt, 'LESS_THAN', r1, math_node(nt, 'MULTIPLY', busy, share)), inner)
    k0, k1 = SITE.get('facade', {}).get('kelvin', (2600, 4800))  # warm homes to cool offices
    temp = math_node(nt, 'MULTIPLY_ADD', s1[0], k1 - k0, k0)
    bb = node(nt, 'ShaderNodeBlackbody')
    L.new(temp, bb.inputs['Temperature'])
    gain = node(nt, 'ShaderNodeValue', name='city_gain', label='city_gain')
    gain.outputs[0].default_value = 1.0
    win_gain = node(nt, 'ShaderNodeValue', name='window_gain', label='window_gain')
    win_gain.outputs[0].default_value = 1.0
    # A drawn curtain or blind glows dimmer than a bare window.
    dim = math_node(nt, 'SUBTRACT', 1.0, math_node(nt, 'MULTIPLY', blind, 0.6))
    # Each window a little its own within its lit run.
    comb = node(nt, 'ShaderNodeCombineXYZ')
    L.new(ix, comb.inputs['X'])
    L.new(iy, comb.inputs['Y'])
    L.new(math_node(nt, 'ADD', seed, 57.1), comb.inputs['Z'])
    own = node(nt, 'ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    L.new(comb.outputs[0], own.inputs['Vector'])
    spread = SITE.get('facade', {}).get('each', 0.5)
    each = math_node(nt, 'MULTIPLY_ADD', own.outputs['Value'], spread, 1.0 - spread / 2)
    strength = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY_ADD', s1[1], 5.0, 1.5), lit), dim), win_gain.outputs[0]), each)
    emit = node(nt, 'ShaderNodeEmission')
    L.new(bb.outputs[0], emit.inputs['Color'])
    L.new(strength, emit.inputs['Strength'])
    glass_lit = node(nt, 'ShaderNodeAddShader')
    L.new(glass.outputs[0], glass_lit.inputs[0])
    L.new(emit.outputs[0], glass_lit.inputs[1])
    # Wall: its colour with grime at two scales, rain streaks down it, darker at street level, and on
    # masonry a lighter string course at each floor.
    tc = node(nt, 'ShaderNodeTexCoord')
    grime = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    grime.inputs['Scale'].default_value = 0.35
    grime.inputs['Detail'].default_value = 6.0
    L.new(tc.outputs['Object'], grime.inputs['Vector'])
    streak_map = node(nt, 'ShaderNodeMapping')
    streak_map.inputs['Scale'].default_value = (2.2, 2.2, 0.06)
    L.new(tc.outputs['Object'], streak_map.inputs['Vector'])
    streak = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    streak.inputs['Scale'].default_value = 1.0
    streak.inputs['Detail'].default_value = 3.0
    L.new(streak_map.outputs[0], streak.inputs['Vector'])
    k = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY_ADD', grime.outputs['Fac'], 0.4, 0.8), math_node(nt, 'MULTIPLY_ADD', streak.outputs['Fac'], 0.35, 0.83))
    k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'MULTIPLY_ADD', math_node(nt, 'LESS_THAN', v, 3.5), -0.18, 1.0))
    course = math_node(nt, 'MULTIPLY', math_node(nt, 'LESS_THAN', fy, 0.05), math_node(nt, 'GREATER_THAN', style, 1.5))
    k = math_node(nt, 'MULTIPLY', k, math_node(nt, 'MULTIPLY_ADD', course, 0.12, 1.0))
    wall_col = mix_colour(nt, 1.0, attr(nt, 'wall', 'Color'), grey_of(nt, k), 'MULTIPLY')
    wall = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.86)
    L.new(wall_col, wall.inputs['Base Color'])
    # Floodlit at night (the 'flood' attribute, per building): stone lit warm, as bright as its colour
    # is light (radiance = albedo x irradiance / pi), in pools from the fittings; windows stay dark.
    pools = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
    pools.inputs['Scale'].default_value = 0.12
    pools.inputs['Detail'].default_value = 2.0
    L.new(tc.outputs['Object'], pools.inputs['Vector'])
    flood_bb = node(nt, 'ShaderNodeBlackbody')
    flood_bb.inputs['Temperature'].default_value = 2600.0  # sodium-warm, as the Palace is lit
    flood_col = mix_colour(nt, 1.0, wall_col, flood_bb.outputs[0], 'MULTIPLY')
    flood_k = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', attr(nt, 'flood'), math_node(nt, 'MULTIPLY_ADD', pools.outputs['Fac'], 1.2, 0.4)), gain.outputs[0])
    flood_emit = node(nt, 'ShaderNodeEmission')
    L.new(flood_col, flood_emit.inputs['Color'])
    L.new(math_node(nt, 'MULTIPLY', flood_k, FLOOD_GAIN), flood_emit.inputs['Strength'])
    wall_lit = node(nt, 'ShaderNodeAddShader')
    L.new(wall.outputs[0], wall_lit.inputs[0])
    L.new(flood_emit.outputs[0], wall_lit.inputs[1])
    frames = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.5)
    L.new(grey_of(nt, frame), frames.inputs['Base Color'])
    wf = node(nt, 'ShaderNodeMixShader')
    L.new(frame_mask, wf.inputs['Fac'])
    L.new(wall_lit.outputs[0], wf.inputs[1])
    L.new(frames.outputs[0], wf.inputs[2])
    mix = node(nt, 'ShaderNodeMixShader')
    L.new(inner, mix.inputs['Fac'])
    L.new(wf.outputs[0], mix.inputs[1])
    L.new(glass_lit.outputs[0], mix.inputs[2])
    out = node(nt, 'ShaderNodeOutputMaterial')
    L.new(mix.outputs[0], out.inputs['Surface'])
    return mat


def simple_material(name, colour, roughness=0.8, **extra):
    mat = bpy.data.materials.new(name)
    nt = nodes_of(mat)
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=roughness, **{'Base Color': (*colour, 1)})
    for k, v in extra.items():
        b.inputs[k].default_value = v
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return mat


def roof_material():
    mat = bpy.data.materials.new('roof')
    nt = nodes_of(mat)
    col = attr(nt, 'roofc', 'Color')
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.7)
    nt.links.new(col, b.inputs['Base Color'])
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


def emission_material(name, colour, strength):
    mat = bpy.data.materials.new(name)
    nt = nodes_of(mat)
    e = node(nt, 'ShaderNodeEmission', Strength=strength, Color=(*colour, 1))
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(e.outputs[0], out.inputs['Surface'])
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
    'facade': facade_material(),
    'roof': roof_material(),
    'ground': simple_material('ground', (0.05, 0.05, 0.048), 0.75),
    'embankment': simple_material('embankment', (0.22, 0.2, 0.17), 0.85),
    'water': water_material(),
    'leaves': leaf_material(),
    'bark': simple_material('bark', (0.11, 0.1, 0.085), 0.9),  # a plane's mottled grey-olive bark, twigs grey-brown
    'iron': simple_material('iron', (0.02, 0.022, 0.025), 0.45, Metallic=0.8),
    'bridge': simple_material('bridge', (0.16, 0.16, 0.15), 0.8),
    'bulb': emission_material('bulb', (1.0, 0.78, 0.52), 60.0),
}


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


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def desaturate(c, k=0.55):
    # OSM colours are picked from a palette, far more saturated than weathered stone or brick.
    grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return tuple(grey + (x - grey) * k for x in c)


LONDON_BRICK = [(0.24, 0.19, 0.13), (0.21, 0.17, 0.12), (0.19, 0.09, 0.06), (0.16, 0.08, 0.055)]  # yellow stock, red


def albedo(b):
    """Weathered wall colour (linear). OSM colours are picked from a palette, lighter and purer than
    stone or brick after a century of London air: scaled down and desaturated."""
    col = b.get('colour')
    if col and col.startswith('#') and len(col) == 7:
        return desaturate(tuple(min(srgb_to_linear(int(col[i:i + 2], 16) / 255) * 0.6, 0.45) for i in (1, 3, 5)), 0.5)
    if col in NAMED:
        return desaturate(tuple(c * 0.8 for c in NAMED[col]), 0.7)
    if b.get('material') == 'brick':
        return rng.choice(LONDON_BRICK)
    if b.get('material') in MATERIAL_ALBEDO:
        return MATERIAL_ALBEDO[b['material']]
    # London's defaults: brick houses, Portland stone for the grand and civic, concrete otherwise.
    kind = b.get('kind', 'yes')
    if kind in ('house', 'residential', 'apartments', 'terrace'):
        return rng.choice(LONDON_BRICK)
    if kind in ('government', 'civic', 'public', 'church', 'cathedral', 'museum', 'hotel') or b.get('listed'):
        return MATERIAL_ALBEDO['stone']
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
    if mat == 'glass' or (b['height'] >= 60 and mat not in ('brick', 'stone', 'sandstone') and not grand):
        # Curtain wall: glass floor to ceiling between thin mullions, a dark spandrel at each floor.
        return 0, rng.uniform(1.35, 1.8), rng.uniform(3.6, 4.2), SITE.get('facade', {}).get('curtain_w', 0.47), rng.uniform(0.36, 0.42), 0.06, busy
    if grand and mat not in ('glass', 'concrete'):
        # Masonry: tall narrow windows in wide bays, high floors; gothic and classical alike at this range.
        return 2, rng.uniform(2.4, 3.4), rng.uniform(4.2, 5.4), rng.uniform(0.15, 0.21), rng.uniform(0.3, 0.36), 0.28, busy * 0.6
    if homes or mat == 'brick':
        # Sash windows, white-painted frames.
        return 1, rng.uniform(2.6, 3.3), rng.uniform(2.9, 3.3), rng.uniform(0.2, 0.26), rng.uniform(0.27, 0.33), rng.uniform(0.5, 0.7), busy
    # Offices and shops: wider windows, dark frames.
    return 1, rng.uniform(2.2, 3.0), rng.uniform(3.5, 4.0), rng.uniform(0.28, 0.38), rng.uniform(0.28, 0.34), rng.uniform(0.04, 0.12), busy


FACADE_ATTRS = ('wall', 'style', 'bay', 'floorh', 'win_w', 'win_h', 'frame', 'busy', 'seed', 'roofc', 'flood', 'run_l', 'run_b', 'glass_ior')


def facade_runs(style):
    """How a building's windows go together (SITE['facade'], where the city gives it): lit floors in runs of
    bays, blinds in runs, curtain-wall glass's coating. A city without it: each window its own, clear glass."""
    f = SITE.get('facade')
    if not f or style > 1:
        return dict(run_l=1.0, run_b=1.0, glass_ior=0.0)
    return dict(run_l=float(rng.randint(*f['lit_run'])), run_b=float(rng.randint(*f['blind_run'])),
                glass_ior=rng.uniform(*f['glass_ior']) if style == 0 else 0.0)


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


def tessellate(outer, holes=()):
    """Triangles covering outer minus holes (2D), as index triples into outer + holes flattened."""
    loops = [[Vector((x, y, 0)) for x, y in r] for r in [outer, *holes]]
    tris = geometry.tessellate_polygon(loops)
    flat = [p for r in [outer, *holes] for p in r]
    return tris, flat


def add_building(mb, b):
    outer = [clean(r) for r in b['outer']]
    inner = [clean(r) for r in b['inner']]
    outer = [r for r in outer if r]
    inner = [r for r in inner if r]
    if not outer:
        return
    col = albedo(b)
    col = tuple(max(0.01, c * rng.uniform(0.85, 1.12)) for c in col)
    style, bay, floorh, win_w, win_h, frame, busy = facade_params(b, max(abs(signed_area(r)) for r in outer))
    if style == 0:
        col = tuple(c * 0.35 for c in col)  # a curtain wall's spandrels and mullions: dark glass and metal
    seed = rng.random() * 1000
    # On the ground under it (b['base'], above z = 0; extract.mjs). A part that starts at the ground reaches
    # down to z = 0 too, so a building on a rise never floats over the flat ground slab.
    zb = b.get('base', 0.0)
    z0 = zb + b['min'] if b['min'] > 0 else min(0.0, zb)
    roof = b['roof']
    roof_h = roof['height'] if roof['shape'] not in ('flat',) else 0.0
    zw = max(zb + b['height'] - roof_h, z0 + 0.5)
    ztop = zb + b['height']
    # Flat roofs: felt, gravel and plant, grey; pitched: slate or lead.
    roofc = (rng.uniform(0.09, 0.17),) * 3 if roof['shape'] in ('flat', 'skillion') else (0.075, 0.08, 0.09)
    rc = roof.get('colour')
    if rc in NAMED:
        roofc = tuple(c * 0.7 for c in NAMED[rc])
    elif rc and rc.startswith('#') and len(rc) == 7:
        roofc = desaturate(tuple(min(srgb_to_linear(int(rc[i:i + 2], 16) / 255) * 0.6, 0.4) for i in (1, 3, 5)), 0.5)
    flood = FLOODLIT.get(b.get('name')) or FLOODLIT.get((b.get('within') or {}).get('name')) or 0.0
    face_attrs = dict(wall=col, style=style, bay=bay, floorh=floorh, win_w=win_w, win_h=win_h, frame=frame, busy=busy, seed=seed, roofc=roofc, flood=flood,
                      **facade_runs(style))
    for ring in [*outer, *inner]:
        is_hole = ring in inner
        ccw = signed_area(ring) > 0
        # Walls face outward for outer rings, inward (into the courtyard) for holes.
        pts = ring if (ccw != is_hole) else ring[::-1]
        u = 0.0
        for i in range(len(pts)):
            a, c = pts[i], pts[(i + 1) % len(pts)]
            length = math.hypot(c[0] - a[0], c[1] - a[1])
            mb.face([(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], zw), (a[0], a[1], zw)],
                    [(u, z0), (u + length, z0), (u + length, zw), (u, zw)], 0, **face_attrs)
            u += length
    # Roof.
    main = max(outer, key=lambda r: abs(signed_area(r)))
    if roof['shape'] in ('flat', 'skillion') or roof_h <= 0.3:
        for r in outer:
            tris, flat = tessellate(r, [h for h in inner])
            for t in tris:
                mb.face([(*flat[t[0]], ztop), (*flat[t[1]], ztop), (*flat[t[2]], ztop)], None, 1, **face_attrs)
        return
    cx = sum(p[0] for p in main) / len(main)
    cy = sum(p[1] for p in main) / len(main)
    ring = main if signed_area(main) > 0 else main[::-1]
    if roof['shape'] in ('pyramidal', 'cone', 'spire'):
        for i in range(len(ring)):
            a, c = ring[i], ring[(i + 1) % len(ring)]
            mb.face([(a[0], a[1], zw), (c[0], c[1], zw), (cx, cy, ztop)], None, 1, **face_attrs)
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
                    mb.face([prev[i], prev[j], cur[j], cur[i]], None, 1, **face_attrs)
                else:
                    mb.face([prev[i], prev[j], (cx, cy, ztop)], None, 1, **face_attrs)
            prev = cur
    else:
        # Pitched roofs (gabled, hipped, mansard, …): a hipped frustum, its top the footprint shrunk.
        k = 0.35
        top = [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, ztop) for p in ring]
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            mb.face([(ring[i][0], ring[i][1], zw), (ring[j][0], ring[j][1], zw), top[j], top[i]], None, 1, **face_attrs)
        tris, flat = tessellate([(p[0], p[1]) for p in top])
        for t in tris:
            mb.face([(*flat[t[0]], ztop), (*flat[t[1]], ztop), (*flat[t[2]], ztop)], None, 1, **face_attrs)


def build_city():
    mb = MeshBuilder('buildings', FACADE_ATTRS)
    skipped = 0
    for b in scene_data['buildings']:
        if b['id'] in LANDMARK_REPLACES:
            skipped += 1
            continue
        try:
            add_building(mb, b)
        except Exception as e:  # a broken footprint should not stop the city
            skipped += 1
    ob = mb.build([MAT['facade'], MAT['roof']])
    print(f'buildings: {len(scene_data["buildings"]) - skipped} ({skipped} skipped), {len(mb.faces)} faces')
    return ob


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
    for w in scene_data['water']:
        o = [r for r in (clean(r) for r in w['outer']) if r]
        h = [r for r in (clean(r) for r in w['inner']) if r]
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
        h = tr['height'] or rng.uniform(*SITE.get('tree_h', (14, 26)))
        crown = tr['crown'] or h * rng.uniform(0.6, 0.8)
        ob = bpy.data.objects.new(f'tree_{i}', None)
        ob.instance_type = 'COLLECTION'
        ob.instance_collection = templates[i % len(templates)]
        ob.location = (tr['at'][0], tr['at'][1], tr.get('base', 0.0))
        ob.scale = (crown, crown, h)
        ob.rotation_euler = (0, 0, rng.uniform(0, math.tau))
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
    FLOODLIT.update(getattr(landmarks, 'FLOODLIT', {}))


# ---- World, light groups, camera, render ------------------------------------------------------------

def setup_world():
    """An overcast sky of unit horizon radiance, (1 + 2 sin h) / 3 × 3 up to the zenith (CIE overcast),
    neutral in colour: the site tints and scales it with the live sky. Below the horizon, dim ground."""
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
    out = node(nt, 'ShaderNodeOutputWorld')
    L.new(bg.outputs[0], out.inputs['Surface'])
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
        heading, pitch = BEARING, 0.0
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
build_city()
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


# Five renders of the one scene: light adds linearly, so each source can be rendered alone and the
# site mixes them by the live sky, the dark and the local hour.
DEPTH = depth_material()
passes = arg('passes', 'sky,city,win,late,depth').split(',')
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
    render_set(OUT + '-mirror', passes)
    mirror = {'elevation': [0.0, top], 'size': [scene.render.resolution_x, scene.render.resolution_y],
              'eyeAboveWater': SITE['eye'] - wz}
if VIEW == 'pano':
    # Where the panorama sits in the sky, for scripts/blender/encode.py.
    res_y = int((PANO['el'][1] - PANO['el'][0]) * PANO['ppd'] * SCALE)
    json.dump({'bearing': BEARING, 'span': PANO['span'], 'elevation': list(PANO['el']), 'season': SEASON,
               'size': [scene.render.resolution_x, res_y], 'mirror': mirror}, open(OUT + '.json', 'w'))
print('done')
