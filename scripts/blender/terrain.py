"""A city on its own ground (SITE 'terrain'; Paris), for scripts/blender/skyline.py, in place of the flat
street slab: the terrain from the scene's elevation grids (scripts/skyline/terrain_ign.mjs: IGN's 1 m
bare-earth model, metres above z = 0), its water bodies each at its own level, stone walls round them,
and the ground's surface from OpenStreetMap (scripts/skyline/ground.py: lawns, gravel paths, paving,
roads) as textures over it.

  fine     the near ground at FINE_STEP metres (the 1 m model averaged), to the fine grid's edge
  coarse   the rest at the coarse grid's 10 m, sunk SINK metres where the fine one lies over it
  water    each water polygon flat at its level (the model's median over it: the model holds the water's
           surface), the ground under it lowered DEPTH below; the one LIVE level is the site's live water
           (a holdout to the camera, as London's and New York's rivers are), the rest is glossy water
           baked here (the Seine below the Trocadéro, the gardens' small pools)
  walls    the quays and basins' rims: stone from below the water up to the ground at each edge

build(g) takes skyline.py's globals; returns the live water level (z) or None.
"""

import math
import os

import numpy as np

G = {}
FINE_STEP = 2.0
SINK = 3.0
DEPTH = 1.5


def load(grid):
    path = os.path.join(G['ROOT'], 'data', 'skyline', G['CITY'], grid['file'])
    z = np.fromfile(path, dtype=np.float32).reshape(grid['h'], grid['w'])
    return z


def downsample(z, k):
    h, w = z.shape[0] // k * k, z.shape[1] // k * k
    return z[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))


def fill_rings(mask, x0, y0, step, rings, value=True):
    """Even-odd fill of polygon rings (scene metres) into a boolean grid whose cell (j, i) has its centre at
    (x0 + (i + 0.5) step, y0 + (j + 0.5) step): a scanline per row."""
    h, w = mask.shape
    edges = []
    for r in rings:
        p = np.asarray(r, dtype=np.float64)
        q = np.roll(p, -1, axis=0)
        edges.append(np.concatenate([p, q], axis=1))
    if not edges:
        return
    e = np.concatenate(edges)
    ys = y0 + (np.arange(h) + 0.5) * step
    ylo, yhi = np.minimum(e[:, 1], e[:, 3]), np.maximum(e[:, 1], e[:, 3])
    for j in np.nonzero((ys >= ylo.min()) & (ys <= yhi.max()))[0]:
        y = ys[j]
        sel = (ylo <= y) & (yhi > y)
        if not sel.any():
            continue
        s = e[sel]
        xs = s[:, 0] + (y - s[:, 1]) * (s[:, 2] - s[:, 0]) / (s[:, 3] - s[:, 1])
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            i0 = int(math.ceil((a - x0) / step - 0.5))
            i1 = int(math.floor((b - x0) / step - 0.5))
            if i1 >= i0:
                mask[j, max(i0, 0):min(i1 + 1, w)] = value


def grid_mesh(name, z, x0, y0, step, mat):
    """A heightfield of quads, vertex (j, i) at (x0 + (i + 0.5) step, y0 + (j + 0.5) step, z[j, i])."""
    bpy = G['bpy']
    h, w = z.shape
    xs = x0 + (np.arange(w) + 0.5) * step
    ys = y0 + (np.arange(h) + 0.5) * step
    X, Y = np.meshgrid(xs, ys)
    co = np.stack([X, Y, z], axis=-1).reshape(-1, 3).astype(np.float32)
    idx = np.arange(h * w).reshape(h, w)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]
    quads = np.stack([a, b, c, d], axis=-1).reshape(-1, 4)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set('co', co.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set('vertex_index', quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set('loop_start', np.arange(0, quads.size, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(quads), 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    me.polygons.foreach_set('use_smooth', np.ones(len(quads), dtype=bool))
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def sampler(grids):
    def at(x, y):
        for g, z in grids:
            fx = (x - g['x0']) / g['res'] - 0.5
            fy = (y - g['y0']) / g['res'] - 0.5
            if 0 <= fx < g['w'] - 1 and 0 <= fy < g['h'] - 1:
                i, j = int(fx), int(fy)
                u, v = fx - i, fy - j
                return float((z[j, i] * (1 - u) + z[j, i + 1] * u) * (1 - v) + (z[j + 1, i] * (1 - u) + z[j + 1, i + 1] * u) * v)
        return None
    return at


def build(g):
    G.update(g)
    t = G['scene_data']['terrain']
    grids = {gr['name']: (gr, load(gr)) for gr in t['grids']}
    fine_g, fine_z = grids['fine']
    coarse_g, coarse_z = grids['coarse']
    at = sampler([grids['fine'], grids['coarse']])
    MAT = G['MAT']
    site = G['SITE']
    live = site.get('live_water')  # the OSM id of the live water body (the Trocadéro's basin)

    # Water bodies: each at the model's median over it.
    bodies = []
    for w in G['scene_data']['water']:
        outer = [r for r in (G['clean'](r) for r in w['outer']) if r]
        inner = [r for r in (G['clean'](r) for r in w['inner']) if r]
        if not outer:
            continue
        m = np.zeros(fine_z.shape, dtype=bool)
        fill_rings(m, fine_g['x0'], fine_g['y0'], fine_g['res'], outer + inner)
        vals = fine_z[m]
        if vals.size < 4:
            cx = sum(p[0] for p in outer[0]) / len(outer[0])
            cy = sum(p[1] for p in outer[0]) / len(outer[0])
            level = at(cx, cy)
            if level is None:
                continue
        else:
            level = float(np.median(vals))
        bodies.append({'id': w['id'], 'outer': outer, 'inner': inner, 'level': level})
    live_level = next((b['level'] for b in bodies if b['id'] == live), None)
    for b in bodies:
        # Pieces of the same basin (OSM maps the Warsaw fountains in several ways) share the live level.
        b['live'] = live_level is not None and abs(b['level'] - live_level) < 0.4 and min(math.hypot(*p) for r in b['outer'] for p in r) < 400
        if b['live']:
            g.setdefault('LIVE_WATER_IDS', set()).add(b['id'])

    # The fine ground, averaged to FINE_STEP, lowered under the water.
    k = int(round(FINE_STEP / fine_g['res']))
    fz = downsample(fine_z, k).copy()
    step = fine_g['res'] * k
    for b in bodies:
        m = np.zeros(fz.shape, dtype=bool)
        fill_rings(m, fine_g['x0'], fine_g['y0'], step, b['outer'] + b['inner'])
        fz[m] = np.minimum(fz[m], b['level'] - DEPTH)
    fine = grid_mesh('ground_fine', fz, fine_g['x0'], fine_g['y0'], step, MAT['terrain'])
    # The coarse ground, sunk under the fine.
    cz = coarse_z.copy()
    cs = coarse_g['res']
    cx = coarse_g['x0'] + (np.arange(cz.shape[1]) + 0.5) * cs
    cy = coarse_g['y0'] + (np.arange(cz.shape[0]) + 0.5) * cs
    inside = ((cx[None, :] > fine_g['x0'] + 2 * cs) & (cx[None, :] < fine_g['x0'] + fine_g['w'] * fine_g['res'] - 2 * cs) &
              (cy[:, None] > fine_g['y0'] + 2 * cs) & (cy[:, None] < fine_g['y0'] + fine_g['h'] * fine_g['res'] - 2 * cs))
    cz[inside] -= SINK
    for b in bodies:
        m = np.zeros(cz.shape, dtype=bool)
        fill_rings(m, coarse_g['x0'], coarse_g['y0'], cs, b['outer'] + b['inner'])
        cz[m] = np.minimum(cz[m], b['level'] - DEPTH)
    coarse = grid_mesh('ground_coarse', cz, coarse_g['x0'], coarse_g['y0'], cs, MAT['terrain'])

    # Water surfaces and their stone walls.
    MeshBuilder, tessellate, signed_area = G['MeshBuilder'], G['tessellate'], G['signed_area']
    live_mb, pool_mb, wall = MeshBuilder('water'), MeshBuilder('pool'), MeshBuilder('quay')
    for b in bodies:
        mb = live_mb if b['live'] else pool_mb
        wz = b['level']
        for ring in b['outer']:
            tris, flat = tessellate(ring, b['inner'])
            for tr in tris:
                mb.face([(*flat[tr[0]], wz), (*flat[tr[1]], wz), (*flat[tr[2]], wz)])
        for ring, hole in [(r, False) for r in b['outer']] + [(r, True) for r in b['inner']]:
            ccw = ring if signed_area(ring) > 0 else ring[::-1]
            if hole:
                ccw = ccw[::-1]
            # The edge's top: the highest ground within 2.5 m outside it (the quay's coping), at least the water.
            tops = []
            for (x, y) in ccw:
                hs = [at(x + dx, y + dy) for dx in (-2.5, 0, 2.5) for dy in (-2.5, 0, 2.5)]
                tops.append(max([h for h in hs if h is not None] + [wz + 0.3]))
            for i in range(len(ccw)):
                j = (i + 1) % len(ccw)
                a, c = ccw[i], ccw[j]
                if math.dist(a, c) > 400:  # a stitched ring's closing chord across the river
                    continue
                wall.face([(c[0], c[1], wz - DEPTH), (a[0], a[1], wz - DEPTH), (a[0], a[1], tops[i]), (c[0], c[1], tops[j])])
    objs = [fine, coarse, wall.build([MAT['embankment']])]
    if live_mb.faces:
        objs.append(live_mb.build([MAT['water']]))
    if pool_mb.faces:
        objs.append(pool_mb.build([MAT['pool']]))
    print(f'terrain: fine {fz.shape[1]}x{fz.shape[0]} at {step} m, coarse {cz.shape[1]}x{cz.shape[0]} at {cs} m; '
          f'{len(bodies)} water bodies, live level {live_level}')
    return live_level, at
