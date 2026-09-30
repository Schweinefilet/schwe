"""Trees for scripts/blender/skyline.py: London planes grown by space colonisation (Runions, Lane and
Prusinkiewicz 2007), one unit tall and one across the crown (instances scale them to each tree), with
leaf cards in leaf and a fine mesh of twigs bare.

    make_templates(bpy, materials, count=6, leaves=True) -> [collection, ...]
"""

import math
import random

import bmesh
from mathutils import Vector, kdtree


def grow(seed, crown_base=0.22, attractors=2600, step=0.018, influence=0.2, kill=0.026, iters=340):
    """Branch nodes and their parents. A London plane: a short trunk forking into two to four big
    limbs, each carrying its own dome, so the crown is broad and irregular, with bays and holes."""
    r = random.Random(seed)
    lean = Vector((r.uniform(-0.04, 0.04), r.uniform(-0.04, 0.04), 1)).normalized()
    fork = lean * crown_base
    limbs = []
    n_limbs = r.choice((2, 3, 3, 4))
    a0 = r.uniform(0, math.tau)
    for k in range(n_limbs):
        a = a0 + k * math.tau / n_limbs + r.uniform(-0.5, 0.5)
        tilt = math.radians(r.uniform(28, 52))
        limbs.append(Vector((math.sin(tilt) * math.cos(a), math.sin(tilt) * math.sin(a), math.cos(tilt))))
    # Each limb's dome: centred out along the limb, some higher, some wider, the lower ones hanging.
    domes = []
    for d in limbs:
        reach = r.uniform(0.32, 0.5)
        c = fork + d * reach
        c.z = min(c.z, 0.72)
        domes.append((c, r.uniform(0.23, 0.32)))
    domes.append((Vector((r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), r.uniform(0.66, 0.74))), r.uniform(0.2, 0.26)))
    holes = [(Vector((r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(0.4, 0.85))), r.uniform(0.05, 0.1)) for _ in range(6)]
    pts = []
    while len(pts) < attractors:
        c, rad = r.choice(domes)
        p = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))
        if p.length > 1:
            continue
        q = c + Vector((p.x * rad * 1.2, p.y * rad * 1.2, p.z * rad))
        if q.z < crown_base + 0.06 or q.z > 1.0 or abs(q.x) > 0.5 or abs(q.y) > 0.5:
            continue
        if any((q - hc).length < hr for hc, hr in holes):
            continue
        pts.append(q)
    nodes = [Vector((0, 0, 0))]
    parent = [-1]
    while nodes[-1].z < crown_base - 1e-6:
        nodes.append(nodes[-1] + lean * step)
        parent.append(len(nodes) - 2)
    top = len(nodes) - 1
    # The limbs, grown straight for a while before the crown takes over.
    for d in limbs:
        i = top
        for _ in range(r.randint(5, 9)):
            nodes.append(nodes[i] + (d + Vector((r.gauss(0, 0.08), r.gauss(0, 0.08), 0))).normalized() * step)
            parent.append(i)
            i = len(nodes) - 1
    alive = pts
    kids = [0] * len(nodes)
    for p in parent[1:]:
        kids[p] += 1
    for _ in range(iters):
        if not alive:
            break
        kd = kdtree.KDTree(len(nodes))
        for i, n in enumerate(nodes):
            kd.insert(n, i)
        kd.balance()
        pull = {}
        keep = []
        for a in alive:
            co, i, d = kd.find(a)
            if d < kill:
                continue
            keep.append(a)
            if d < influence:
                v = (a - co).normalized()
                if i in pull:
                    pull[i][0] += v
                    pull[i][1] += 1
                else:
                    pull[i] = [v.copy(), 1]
        alive = keep
        if not pull:
            break
        for i, (v, n) in pull.items():
            # Pulls from all sides cancel: growing on would only knot twigs in place (the method's
            # known artefact), as would a node sprouting again and again.
            if v.length < 0.35 * n or kids[i] >= 3:
                continue
            d = (v.normalized() + Vector((0, 0, 0.12))).normalized()
            nodes.append(nodes[i] + d * step)
            parent.append(i)
            kids[i] += 1
            kids.append(0)
    return nodes, parent


def radii(parent, tip=0.0011, exponent=2.5):
    """Pipe model: a branch's cross-section carries its children's."""
    acc = [0.0] * len(parent)
    r = [tip] * len(parent)
    for i in range(len(parent) - 1, 0, -1):
        if acc[i] > 0:
            r[i] = max(tip, acc[i] ** (1 / exponent))
        acc[parent[i]] += r[i] ** exponent
    r[0] = max(tip, acc[0] ** (1 / exponent)) * 1.25  # the flare at the foot
    return r


def tube(bm, a, b, ra, rb, sides):
    d = b - a
    if d.length < 1e-6:
        return
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    ring_a, ring_b = [], []
    for k in range(sides):
        t = k / sides * math.tau
        o = q @ Vector((math.cos(t), math.sin(t), 0))
        ring_a.append(bm.verts.new(a + o * ra))
        ring_b.append(bm.verts.new(b + o * rb))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((ring_a[k], ring_a[j], ring_b[j], ring_b[k]))


def template(bpy, name, seed, mats, leaves=True):
    """One tree as a collection: its wood and (in leaf) its leaves."""
    nodes, parent = grow(seed)
    # A pipe model near area-preserving (2 is Leonardo's rule): a mature plane's trunk is near a metre
    # thick; bare, the limbs a little more slender against the sky.
    r = radii(parent, exponent=2.2 if leaves else 2.3)
    children = [0] * len(nodes)
    for p in parent[1:]:
        children[p] += 1
    rnd = random.Random(seed * 7 + 1)
    wood = bmesh.new()
    for i in range(1, len(nodes)):
        ra, rb = r[parent[i]], r[i]
        # In leaf, the finest twigs are hidden in the leaves; bare, they are the crown's whole look.
        if leaves and rb < 0.0016:
            continue
        sides = 7 if ra > 0.008 else 4 if ra > 0.002 else 3
        tube(wood, nodes[parent[i]], nodes[i], ra, rb, sides)
    if not leaves:
        # Bare: sprays of fine twigs at every tip, bending up and out, so the crown's edge is a grey lace
        # (at this range, a haze with the limbs dark in it) rather than cut-off branch ends.
        for i in range(1, len(nodes)):
            if children[i] > 0:
                continue
            base = nodes[i]
            grow_dir = (nodes[i] - nodes[parent[i]]).normalized()
            for _ in range(rnd.randint(3, 5)):
                d = (grow_dir + Vector((rnd.gauss(0, 0.6), rnd.gauss(0, 0.6), rnd.uniform(0.0, 0.5)))).normalized()
                p = base
                length = rnd.uniform(0.02, 0.045)
                for s in range(3):
                    d = (d + Vector((rnd.gauss(0, 0.25), rnd.gauss(0, 0.25), 0.12))).normalized()
                    q = p + d * length / 3
                    tube(wood, p, q, 0.0009 * (1 - s / 3), 0.0009 * (1 - (s + 1) / 3) + 0.0002, 3)
                    p = q
    me = bpy.data.meshes.new(name + '_wood')
    wood.to_mesh(me)
    wood.free()
    me.materials.append(mats['bark'])
    coll = bpy.data.collections.new(name)
    coll.objects.link(bpy.data.objects.new(name + '_wood', me))
    if leaves:
        # Leaf cards (a plane leaf about 20 cm; cards stand for small clusters) around the outer twigs.
        bm = bmesh.new()
        var = []
        tips = [i for i in range(len(nodes)) if children[i] == 0 or r[i] < 0.0022]
        for i in tips:
            for _ in range(9):
                c = nodes[i] + Vector((rnd.gauss(0, 0.012), rnd.gauss(0, 0.012), rnd.gauss(0, 0.01)))
                n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 1.2))).normalized()
                t = n.orthogonal().normalized()
                b = n.cross(t)
                s = rnd.uniform(0.008, 0.014)
                vs = [bm.verts.new(c + (t * x + b * y) * s) for x, y in ((-1, -0.6), (1, -0.6), (0.8, 0.7), (-0.8, 0.7))]
                bm.faces.new(vs)
                var.append(rnd.random())
        me = bpy.data.meshes.new(name + '_leaves')
        bm.to_mesh(me)
        bm.free()
        a = me.attributes.new('leafvar', 'FLOAT', 'FACE')
        a.data.foreach_set('value', var)
        me.materials.append(mats['leaves'])
        coll.objects.link(bpy.data.objects.new(name + '_leaves', me))
    return coll


def make_templates(bpy, mats, count=6, leaves=True):
    root = bpy.data.collections.new('tree_templates')
    out = []
    for k in range(count):
        c = template(bpy, f'tree{k}', 11 + k * 17, mats, leaves)
        root.children.link(c)
        out.append(c)
    return out
