"""The ground's materials for a city on its own terrain (scripts/blender/terrain.py; Paris), for skyline.py:

  ground_material   the terrain, shaded by what OpenStreetMap says it is made of (scripts/skyline/ground.py's
                    maps: grass, loose gravel and sand, paving, asphalt, else earth), each with its own
                    small-scale variation, the near map where it reaches and the far one beyond
  pool_material     water the site does not draw live (the Seine below the Trocadéro, the gardens' small
                    pools): dark, glossy, with small wind ripples, rendered here

Colours are linear albedos: Paris's lawns, its parks' stabilised sand (a pinkish beige, ref c001), pale
limestone and concrete paving, asphalt, and the bare earth under trees.
"""

import json
import os

GRASS = {'leaf': ((0.035, 0.07, 0.018), (0.07, 0.1, 0.03)), 'bare': ((0.05, 0.065, 0.025), (0.075, 0.08, 0.04))}
LOOSE = ((0.25, 0.19, 0.145), (0.33, 0.26, 0.2))
PAVING = ((0.17, 0.16, 0.14), (0.26, 0.245, 0.215))
ASPHALT = ((0.035, 0.035, 0.037), (0.06, 0.06, 0.062))
EARTH = ((0.03, 0.028, 0.02), (0.055, 0.048, 0.035))


def ground_material(g):
    bpy, node, nodes_of, math_node, mix_colour = g['bpy'], g['node'], g['nodes_of'], g['math_node'], g['mix_colour']
    d = os.path.join(g['ROOT'], 'data', 'skyline', g['CITY'])
    if not os.path.exists(os.path.join(d, 'ground.json')):
        print('ground: no maps (scripts/skyline/ground.py), plain ground')
        return g['simple_material']('terrain', (0.07, 0.068, 0.06), 0.8)
    meta = json.load(open(os.path.join(d, 'ground.json')))
    mat = bpy.data.materials.new('terrain')
    nt = nodes_of(mat)
    L = nt.links
    tc = node(nt, 'ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep.inputs[0])

    def sample(m):
        """The map's RGBA at this point: (colour socket, alpha socket, inside 0/1)."""
        u = math_node(nt, 'DIVIDE', math_node(nt, 'SUBTRACT', sep.outputs['X'], m['x0']), m['size'])
        v = math_node(nt, 'DIVIDE', math_node(nt, 'SUBTRACT', sep.outputs['Y'], m['y0']), m['size'])
        comb = node(nt, 'ShaderNodeCombineXYZ')
        L.new(u, comb.inputs['X'])
        L.new(v, comb.inputs['Y'])
        tex = node(nt, 'ShaderNodeTexImage', interpolation='Linear', extension='EXTEND')
        img = bpy.data.images.load(os.path.join(d, m['file']))
        img.colorspace_settings.name = 'Non-Color'
        img.alpha_mode = 'CHANNEL_PACKED'
        tex.image = img
        L.new(comb.outputs[0], tex.inputs['Vector'])
        inside = math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', math_node(nt, 'GREATER_THAN', u, 0.002), math_node(nt, 'LESS_THAN', u, 0.998)),
                           math_node(nt, 'MULTIPLY', math_node(nt, 'GREATER_THAN', v, 0.002), math_node(nt, 'LESS_THAN', v, 0.998)))
        return tex.outputs['Color'], tex.outputs['Alpha'], inside

    nc, na, nin = sample(meta['near'])
    fc, fa, _ = sample(meta['far'])
    rgb = mix_colour(nt, nin, fc, nc)
    alpha = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', na, nin), math_node(nt, 'MULTIPLY', fa, math_node(nt, 'SUBTRACT', 1.0, nin)))
    ch = node(nt, 'ShaderNodeSeparateColor')
    L.new(rgb, ch.inputs[0])
    w_grass, w_loose, w_paving, w_asphalt = ch.outputs[0], ch.outputs[1], ch.outputs[2], alpha
    total = math_node(nt, 'ADD', math_node(nt, 'ADD', w_grass, w_loose), math_node(nt, 'ADD', w_paving, w_asphalt))
    w_earth = math_node(nt, 'MAXIMUM', math_node(nt, 'SUBTRACT', 1.0, total), 0.0)

    def varied(pair, scale, detail=4.0, fine=None):
        """A colour between the pair's two, by noise at `scale` metres (and finer speckle, `fine`)."""
        n = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=1.0 / scale, Detail=detail)
        L.new(tc.outputs['Object'], n.inputs['Vector'])
        f = n.outputs['Fac']
        if fine:
            n2 = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=1.0 / fine, Detail=2.0)
            L.new(tc.outputs['Object'], n2.inputs['Vector'])
            f = math_node(nt, 'MULTIPLY_ADD', n2.outputs['Fac'], 0.5, math_node(nt, 'MULTIPLY', f, 0.5))
        ramp = node(nt, 'ShaderNodeMapRange', **{'From Min': 0.3, 'From Max': 0.7}, clamp=True)
        L.new(f, ramp.inputs['Value'])
        return mix_colour(nt, ramp.outputs['Result'], pair[0], pair[1])

    grass = varied(GRASS[g['SEASON']], 6.0, 5.0, 0.6)
    loose = varied(LOOSE, 3.0, 3.0, 0.15)
    paving = varied(PAVING, 8.0, 3.0, 0.8)
    asphalt = varied(ASPHALT, 10.0, 3.0, 0.4)
    earth = varied(EARTH, 4.0, 4.0, 0.5)

    def weighted(c, w):
        return mix_colour(nt, 1.0, c, g['grey_of'](nt, w), 'MULTIPLY')

    col = mix_colour(nt, 1.0, weighted(grass, w_grass), weighted(loose, w_loose), 'ADD')
    col = mix_colour(nt, 1.0, col, weighted(paving, w_paving), 'ADD')
    col = mix_colour(nt, 1.0, col, weighted(asphalt, w_asphalt), 'ADD')
    col = mix_colour(nt, 1.0, col, weighted(earth, w_earth), 'ADD')
    b = node(nt, 'ShaderNodeBsdfPrincipled')
    L.new(col, b.inputs['Base Color'])
    # Roughness: grass and gravel matt, paving 0.6, asphalt 0.5 (the street lamps' sheen at night).
    rough = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', math_node(nt, 'ADD', math_node(nt, 'ADD', w_grass, w_loose), w_earth), 0.95),
                      math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', w_paving, 0.62), math_node(nt, 'MULTIPLY', w_asphalt, 0.5)))
    L.new(rough, b.inputs['Roughness'])
    out = node(nt, 'ShaderNodeOutputMaterial')
    L.new(b.outputs[0], out.inputs['Surface'])
    return mat


def pool_material(g):
    bpy, node, nodes_of = g['bpy'], g['node'], g['nodes_of']
    mat = bpy.data.materials.new('pool')
    nt = nodes_of(mat)
    L = nt.links
    tc = node(nt, 'ShaderNodeTexCoord')
    mp = node(nt, 'ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0, 3.0, 1.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    wave = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=1.2, Detail=8.0, Roughness=0.6)
    L.new(mp.outputs[0], wave.inputs['Vector'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.1, Distance=0.2)
    L.new(wave.outputs['Fac'], bump.inputs['Height'])
    b = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.04, **{'Base Color': (0.012, 0.016, 0.014, 1)})
    b.inputs['IOR'].default_value = 1.333
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    out = node(nt, 'ShaderNodeOutputMaterial')
    L.new(b.outputs[0], out.inputs['Surface'])
    return mat
