"""The city's facade shader (and its roofs'), for scripts/blender/skyline.py: every wall's detail made in
the shader from its UVs (metres along and up each wall; MeshBuilder and facade_object write them) and
per-face attributes (filler.py FACADE_ATTRS), never as geometry:

  the window grid    a building's own bay width and floor height; windows a share of each cell
  floor bands        the floor slabs' spandrels on offices (darker), string courses on masonry (lighter)
  glazing bars       sashes' meeting rails and centre bars on homes, a mullion in wide office windows,
                     curtain walls' mullions between their bays
  sills              a stone sill under each punched window
  relief             windows set back in their reveals, sills, courses and gothic panelling standing
                     proud: in the shading normal (a bump), so they catch the light at grazing angles
  each window        its own glass: tint, reflectance and roughness from a per-window hash; dark rooms,
                     blinds and curtains by day; by night lit or not by a per-window hash (lit runs and
                     shares per city), warm homes to cool offices

Styles (the 'style' attribute): 0 curtain wall, 1 punched windows, 2 masonry with tall narrow windows,
3 none (turrets, pinnacles, roofs mapped as parts, mouldings, plant), 4 gothic (a landmark's panelled
Perpendicular stone), 5 art deco (New York's setback towers and the Empire State Building: each column of
windows one continuous strip, dark metal spandrels between the floors' windows, the stone piers between
the strips standing proud).
"""

import bpy

from nodekit import add_shaders, attr, gain_value, grey_of, math_node, mix_colour, node, nodes_of, output


def _hash(nt, ix, iy, seed, k, run=None):
    """A per-window random draw (Value, Color) from the window's column (or its run of columns) and floor."""
    L = nt.links
    comb = node(nt, 'ShaderNodeCombineXYZ')
    L.new(math_node(nt, 'FLOOR', math_node(nt, 'DIVIDE', ix, run)) if run is not None else ix, comb.inputs['X'])
    L.new(iy, comb.inputs['Y'])
    L.new(math_node(nt, 'ADD', seed, k), comb.inputs['Z'])
    wn = node(nt, 'ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    L.new(comb.outputs[0], wn.inputs['Vector'])
    sc = node(nt, 'ShaderNodeSeparateColor')
    L.new(wn.outputs['Color'], sc.inputs[0])
    return wn.outputs['Value'], wn.outputs['Color'], sc.outputs


def facade_material(site, late_share, flood_gain):
    """Walls with windows (see the module's doc). `site`: the city's SITE (its facade settings: blinds,
    lit runs, colour temperatures); `late_share`: the share of the evening's lit windows still lit late;
    `flood_gain`: floodlit stone's emission per unit of the 'flood' attribute."""
    f = site.get('facade', {})
    mat = bpy.data.materials.new('facade')
    nt = nodes_of(mat)
    L = nt.links
    M = lambda op, a, b=None, c=None: math_node(nt, op, a, b, c)  # noqa: E731
    uv = node(nt, 'ShaderNodeUVMap', uv_map='walls')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    L.new(uv.outputs['UV'], sep.inputs[0])
    u, v = sep.outputs['X'], sep.outputs['Y']
    bay, floorh, busy, seed = attr(nt, 'bay'), attr(nt, 'floorh'), attr(nt, 'busy'), attr(nt, 'seed')
    style, win_w, win_h, frame = attr(nt, 'style'), attr(nt, 'win_w'), attr(nt, 'win_h'), attr(nt, 'frame')
    cu, cv = M('DIVIDE', u, bay), M('DIVIDE', v, floorh)
    ix, iy = M('FLOOR', cu), M('FLOOR', cv)
    fx, fy = M('FRACT', cu), M('FRACT', cv)
    dx = M('ABSOLUTE', M('SUBTRACT', fx, 0.5))
    dy = M('ABSOLUTE', M('SUBTRACT', fy, 0.52))
    gothic = M('MULTIPLY', M('GREATER_THAN', style, 3.5), M('LESS_THAN', style, 4.5))
    deco = M('GREATER_THAN', style, 4.5)
    curtain = M('LESS_THAN', style, 0.5)
    punched = M('MULTIPLY', M('GREATER_THAN', style, 0.5), M('LESS_THAN', style, 2.5))  # styles 1 and 2
    has = M('MAXIMUM', M('MAXIMUM', M('LESS_THAN', style, 2.5), gothic), deco)
    outer = M('MULTIPLY', M('MULTIPLY', M('LESS_THAN', dx, win_w), M('LESS_THAN', dy, win_h)), has)
    # The frame: 9 cm all round.
    inner = M('MULTIPLY', M('MULTIPLY', M('LESS_THAN', dx, M('SUBTRACT', win_w, M('DIVIDE', 0.09, bay))),
                                         M('LESS_THAN', dy, M('SUBTRACT', win_h, M('DIVIDE', 0.09, floorh)))), has)
    # Glazing bars, 6 cm: a centre bar in a punched window over 1.1 m wide, and a sash's meeting rail across
    # the middle of a home's (white-framed) window; they are frame where they cross the glass.
    wide = M('GREATER_THAN', M('MULTIPLY', M('MULTIPLY', win_w, bay), 2.0), 1.1)
    sash = M('GREATER_THAN', frame, 0.4)
    vbar = M('MULTIPLY', M('MULTIPLY', M('LESS_THAN', dx, M('DIVIDE', 0.03, bay)), wide), punched)
    hbar = M('MULTIPLY', M('MULTIPLY', M('LESS_THAN', dy, M('DIVIDE', 0.03, floorh)), sash), punched)
    glass_m = M('MULTIPLY', inner, M('SUBTRACT', 1.0, M('MAXIMUM', vbar, hbar)))
    frame_mask = M('SUBTRACT', outer, glass_m)
    # A stone sill under each punched window: 10 cm deep, 6 cm wider each side.
    below = M('SUBTRACT', M('SUBTRACT', 0.52, win_h), fy)
    sill = M('MULTIPLY', M('MULTIPLY', M('MULTIPLY', M('GREATER_THAN', below, 0.0), M('LESS_THAN', below, M('DIVIDE', 0.1, floorh))),
                                     M('LESS_THAN', dx, M('ADD', win_w, M('DIVIDE', 0.06, bay)))), punched)
    # Two random draws per window: the first (lit or not at night, and how) shared along a run of `run_l`
    # bays of the floor, the second (blind or curtain by day) along `run_b` bays: an office floor is lit or
    # dark as a whole, its blinds drawn along a stretch. A run of 1 (a city that sets none) is each window
    # its own. A third, each window's own glass.
    run_l = M('MAXIMUM', attr(nt, 'run_l'), 1.0)
    run_b = M('MAXIMUM', attr(nt, 'run_b'), 1.0)
    r1, c1, s1 = _hash(nt, ix, iy, seed, 0.0, run_l)
    r2, c2, s2 = _hash(nt, ix, iy, seed, 31.7, run_b)
    r3, c3, s3 = _hash(nt, ix, iy, seed, 91.3)
    # By day: a dark room behind the glass, or blinds or curtains (about a third), lighter and varied.
    room = grey_of(nt, M('MULTIPLY_ADD', r2, 0.05, 0.012))
    # Blinds and curtains: white, cream and grey, lighter and darker; no colours at this range.
    blind_col = mix_colour(nt, s2[0], (0.46, 0.42, 0.35), (0.5, 0.5, 0.5))
    blind_col = mix_colour(nt, M('MULTIPLY_ADD', s2[2], 0.55, 0.05), blind_col, (0.05, 0.05, 0.05))
    # About a third of windows with blinds or curtains drawn; a city's own share where SITE gives one. Behind a
    # curtain wall's tinted glass (style 0) they read darker.
    blind = M('GREATER_THAN', r2, 1.0 - f.get('blinds', 0.36))
    blind_col = mix_colour(nt, curtain, blind_col, (0.5, 0.5, 0.5), 'MULTIPLY')
    interior = mix_colour(nt, blind, room, blind_col)
    # Each pane its own: a little lighter or darker, a little greener or bluer (old and new glass, films).
    tint = mix_colour(nt, s3[0], (0.93, 1.0, 1.04), (1.04, 1.0, 0.94))
    interior = mix_colour(nt, 1.0, interior, mix_colour(nt, 1.0, tint, grey_of(nt, M('MULTIPLY_ADD', s3[1], 0.4, 0.8)), 'MULTIPLY'), 'MULTIPLY')
    # Tinted curtain walls (a city's 'glass_tint'): the panes and their reflections take the hue of the
    # building's glass ('wall' on a curtain wall: teal, blue, bronze, silver), its brightness divided out.
    bw = node(nt, 'ShaderNodeRGBToBW')
    L.new(attr(nt, 'wall', 'Color'), bw.inputs[0])
    hue = mix_colour(nt, 1.0, attr(nt, 'wall', 'Color'), grey_of(nt, M('DIVIDE', 1.0, M('MAXIMUM', bw.outputs[0], 0.005))), 'MULTIPLY')
    glass_tint = mix_colour(nt, M('MULTIPLY', curtain, f.get('glass_tint', 0.0)), (1.0, 1.0, 1.0), hue)
    interior = mix_colour(nt, 1.0, interior, glass_tint, 'MULTIPLY')
    glass = node(nt, 'ShaderNodeBsdfPrincipled')
    L.new(interior, glass.inputs['Base Color'])
    L.new(glass_tint, glass.inputs['Coat Tint'])
    L.new(M('MULTIPLY_ADD', s3[2], 0.3, 0.45), glass.inputs['Roughness'])
    glass.inputs['Coat Weight'].default_value = 1.0
    # Clear glass (n 1.52, 4% at normal incidence), or a building's reflective coating where the city gives
    # one ('glass_ior': an office tower's low-e glass reflects several times more); each pane's reflectance a
    # little its own, and its flatness (old panes ripple, new ones are float glass).
    L.new(M('MULTIPLY_ADD', r3, 0.12, M('MAXIMUM', attr(nt, 'glass_ior'), 1.46)), glass.inputs['Coat IOR'])
    L.new(M('MULTIPLY_ADD', M('MULTIPLY', r3, r3), 0.07, 0.004), glass.inputs['Coat Roughness'])
    # By night: lit rooms, warm homes to cool offices, each its own brightness.
    # The evening's lit windows, or (window_late 1) the few of them still lit late at night.
    late = node(nt, 'ShaderNodeValue', name='window_late', label='window_late')
    late.outputs[0].default_value = 0.0
    share = M('SUBTRACT', 1.0, M('MULTIPLY', late.outputs[0], 1.0 - late_share))
    lit = M('MULTIPLY', M('LESS_THAN', r1, M('MULTIPLY', busy, share)), glass_m)
    k0, k1 = f.get('kelvin', (2600, 4800))  # warm homes to cool offices
    bb = node(nt, 'ShaderNodeBlackbody')
    L.new(M('MULTIPLY_ADD', s1[0], k1 - k0, k0), bb.inputs['Temperature'])
    gain = gain_value(nt, 'city_gain')
    win_gain = gain_value(nt, 'window_gain')
    # A drawn curtain or blind glows dimmer than a bare window.
    dim = M('SUBTRACT', 1.0, M('MULTIPLY', blind, 0.6))
    # Each window a little its own within its lit run.
    spread = f.get('each', 0.5)
    each = M('MULTIPLY_ADD', r3, spread, 1.0 - spread / 2)
    level = M('MULTIPLY_ADD', s1[1], 5.0, 1.5)
    colour = bb.outputs[0]
    wl = f.get('window_light')
    if wl:
        # A city's lit rooms seen as the photos show them from a kilometre off ('window_light'; New York):
        # not even slabs of light but dotted lines. The light gathers at the ceiling (its fittings), so a
        # pane is brightest near its head and dim at its sill, with a bright line just under its head; a
        # share of the windows in a lit run stay dark (partitions, empty desks, a blind down); the run's
        # brightness has a long tail (most dim, a few blazing) and each window its own within it; a run's
        # tubes now and then fluorescent green-white; each pane's hue a little its own. Scaled so the
        # average lit window gives about the light it gave before.
        r4, _, s4 = _hash(nt, ix, iy, seed, 57.1)
        pane = M('DIVIDE', M('SUBTRACT', fy, M('SUBTRACT', 0.52, win_h)), M('MULTIPLY', win_h, 2.0))  # 0 at the sill, 1 at the head
        head = node(nt, 'ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        L.new(pane, head.inputs['Value'])
        head.inputs['From Min'].default_value, head.inputs['From Max'].default_value = 0.3, 1.0
        head.inputs['To Min'].default_value, head.inputs['To Max'].default_value = 0.25, 1.6
        profile = M('MULTIPLY', head.outputs['Result'], M('MULTIPLY_ADD', M('GREATER_THAN', pane, 0.85), 0.4, 1.0))
        on = M('GREATER_THAN', r4, wl.get('dropout', 0.18))
        run = M('MULTIPLY_ADD', M('MULTIPLY', s1[1], s1[1]), 2.6, 0.35)
        own = M('MULTIPLY_ADD', s4[0], 1.1, 0.45)
        level = M('MULTIPLY', M('MULTIPLY', M('MULTIPLY', run, own), M('MULTIPLY', profile, on)), wl.get('gain', 4.9))
        each = 1.0
        fluorescent = M('LESS_THAN', s1[2], wl.get('fluorescent', 0.12))
        colour = mix_colour(nt, fluorescent, colour, mix_colour(nt, 1.0, colour, (0.82, 1.0, 0.88), 'MULTIPLY'))
        colour = mix_colour(nt, 1.0, colour, mix_colour(nt, s4[1], (1.06, 1.0, 0.92), (0.94, 1.0, 1.06)), 'MULTIPLY')
    strength = M('MULTIPLY', M('MULTIPLY', M('MULTIPLY', M('MULTIPLY', level, lit), dim), win_gain), each)
    emit = node(nt, 'ShaderNodeEmission')
    L.new(colour, emit.inputs['Color'])
    L.new(strength, emit.inputs['Strength'])
    glass_lit = add_shaders(nt, glass.outputs[0], emit.outputs[0])
    # Wall: its colour with grime at two scales, rain streaks down it, darker at street level; on masonry a
    # lighter string course at each floor, on offices a darker band at each slab; gothic panelling.
    tc = node(nt, 'ShaderNodeTexCoord')
    grime = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=0.35, Detail=6.0)
    L.new(tc.outputs['Object'], grime.inputs['Vector'])
    streak_map = node(nt, 'ShaderNodeMapping')
    streak_map.inputs['Scale'].default_value = (2.2, 2.2, 0.06)
    L.new(tc.outputs['Object'], streak_map.inputs['Vector'])
    streak = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=1.0, Detail=3.0)
    L.new(streak_map.outputs[0], streak.inputs['Vector'])
    k = M('MULTIPLY', M('MULTIPLY_ADD', grime.outputs['Fac'], 0.4, 0.8), M('MULTIPLY_ADD', streak.outputs['Fac'], 0.35, 0.83))
    k = M('MULTIPLY', k, M('MULTIPLY_ADD', M('LESS_THAN', v, 3.5), -0.18, 1.0))
    slab = M('LESS_THAN', fy, 0.05)
    course = M('MULTIPLY', slab, M('GREATER_THAN', style, 1.5))
    office = M('MULTIPLY', M('MULTIPLY', M('LESS_THAN', frame, 0.2), M('LESS_THAN', style, 1.5)), M('GREATER_THAN', style, 0.5))
    band = M('MULTIPLY', M('LESS_THAN', fy, 0.07), office)
    k = M('MULTIPLY', k, M('MULTIPLY_ADD', course, 0.12, 1.0))
    k = M('MULTIPLY', k, M('MULTIPLY_ADD', band, -0.12, 1.0))
    # Gothic panelling: a rib 12 cm wide at each bay's edge and a moulding at each floor, standing proud.
    rib = M('GREATER_THAN', dx, M('SUBTRACT', 0.5, M('DIVIDE', 0.06, bay)))
    panel = M('MULTIPLY', M('MAXIMUM', rib, M('LESS_THAN', fy, 0.035)), gothic)
    k = M('MULTIPLY', k, M('MULTIPLY_ADD', panel, 0.1, 1.0))
    wall_col = mix_colour(nt, 1.0, attr(nt, 'wall', 'Color'), grey_of(nt, k), 'MULTIPLY')
    # Sills: the wall's stone, lighter.
    wall_col = mix_colour(nt, sill, wall_col, mix_colour(nt, 1.0, wall_col, (1.35, 1.35, 1.35), 'MULTIPLY'))
    # Art deco: the window's column a continuous strip, the spandrels between its windows dark cast aluminium
    # (the Empire State Building's), set back with the glass.
    strip = M('MULTIPLY', M('LESS_THAN', dx, win_w), deco)
    spandrel = M('MULTIPLY', strip, M('SUBTRACT', 1.0, outer))
    wall_col = mix_colour(nt, spandrel, wall_col, mix_colour(nt, 1.0, (0.16, 0.16, 0.17), grey_of(nt, M('MULTIPLY_ADD', r3, 0.4, 0.8)), 'MULTIPLY'))
    wall = node(nt, 'ShaderNodeBsdfPrincipled')
    L.new(wall_col, wall.inputs['Base Color'])
    # Stone and brick matte, never uniformly: roughness 0.74 to 0.96 with the weathering, a little glossier
    # where rain runs. A curtain wall's spandrels and mullions are coated glass and metal: reflective.
    L.new(M('MULTIPLY_ADD', M('MULTIPLY', grime.outputs['Fac'], streak.outputs['Fac']), M('MULTIPLY_ADD', spandrel, -0.35, 0.5),
            M('MULTIPLY_ADD', spandrel, -0.3, 0.71)), wall.inputs['Roughness'])
    L.new(curtain, wall.inputs['Coat Weight'])
    L.new(M('MAXIMUM', attr(nt, 'glass_ior'), 1.6), wall.inputs['Coat IOR'])
    wall.inputs['Coat Roughness'].default_value = 0.04
    # Relief (metres): the windows 20 cm back in their reveals, sills 6 cm proud, courses and slab bands
    # 3 cm, gothic ribs 8 cm.
    height = M('SUBTRACT', M('ADD', M('ADD', M('MULTIPLY', sill, 0.06), M('MULTIPLY', M('MAXIMUM', course, band), 0.03)),
                                 M('MULTIPLY', panel, 0.08)), M('MAXIMUM', M('MULTIPLY', outer, 0.2), M('MULTIPLY', spandrel, 0.15)))
    relief = node(nt, 'ShaderNodeBump', Strength=1.0, Distance=1.0)
    L.new(height, relief.inputs['Height'])
    L.new(relief.outputs['Normal'], wall.inputs['Normal'])
    # Floodlit at night (the 'flood' attribute, per building): stone lit warm, as bright as its colour
    # is light (radiance = albedo x irradiance / pi), in pools from the fittings; windows stay dark.
    pools = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=0.12, Detail=2.0)
    L.new(tc.outputs['Object'], pools.inputs['Vector'])
    flood_bb = node(nt, 'ShaderNodeBlackbody')
    flood_bb.inputs['Temperature'].default_value = 2600.0  # sodium-warm, as the Palace is lit
    flood_col = mix_colour(nt, 1.0, wall_col, flood_bb.outputs[0], 'MULTIPLY')
    flood_k = M('MULTIPLY', M('MULTIPLY', attr(nt, 'flood'), M('MULTIPLY_ADD', pools.outputs['Fac'], 1.2, 0.4)), gain)
    flood_emit = node(nt, 'ShaderNodeEmission')
    L.new(flood_col, flood_emit.inputs['Color'])
    L.new(M('MULTIPLY', flood_k, flood_gain), flood_emit.inputs['Strength'])
    wall_lit = add_shaders(nt, wall.outputs[0], flood_emit.outputs[0])
    frames = node(nt, 'ShaderNodeBsdfPrincipled', Roughness=0.5)
    L.new(grey_of(nt, frame), frames.inputs['Base Color'])
    L.new(relief.outputs['Normal'], frames.inputs['Normal'])
    wf = node(nt, 'ShaderNodeMixShader')
    L.new(frame_mask, wf.inputs['Fac'])
    L.new(wall_lit, wf.inputs[1])
    L.new(frames.outputs[0], wf.inputs[2])
    mix = node(nt, 'ShaderNodeMixShader')
    L.new(glass_m, mix.inputs['Fac'])
    L.new(wf.outputs[0], mix.inputs[1])
    L.new(glass_lit, mix.inputs[2])
    output(nt, mix.outputs[0])
    return mat


def roof_material(flood_gain):
    """Roofs; floodlit ones (a crown's pyramid, a spire: the 'flood' attribute) lit as the walls are."""
    mat = bpy.data.materials.new('roof')
    nt = nodes_of(mat)
    # Felt, gravel, slate and lead weather unevenly: the colour 0.8 to 1.2 of its own, roughness 0.55 to 0.9.
    tc = node(nt, 'ShaderNodeTexCoord')
    n = node(nt, 'ShaderNodeTexNoise', noise_dimensions='3D', Scale=0.4, Detail=5.0)
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    col = mix_colour(nt, 1.0, attr(nt, 'roofc', 'Color'), grey_of(nt, math_node(nt, 'MULTIPLY_ADD', n.outputs['Fac'], 0.4, 0.8)), 'MULTIPLY')
    b = node(nt, 'ShaderNodeBsdfPrincipled')
    nt.links.new(col, b.inputs['Base Color'])
    nt.links.new(math_node(nt, 'MULTIPLY_ADD', n.outputs['Fac'], 0.35, 0.55), b.inputs['Roughness'])
    gain = gain_value(nt, 'city_gain')
    bb = node(nt, 'ShaderNodeBlackbody')
    bb.inputs['Temperature'].default_value = 2600.0
    e = node(nt, 'ShaderNodeEmission')
    nt.links.new(mix_colour(nt, 1.0, col, bb.outputs[0], 'MULTIPLY'), e.inputs['Color'])
    nt.links.new(math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', attr(nt, 'flood'), gain), flood_gain), e.inputs['Strength'])
    output(nt, add_shaders(nt, b.outputs[0], e.outputs[0]))
    return mat
