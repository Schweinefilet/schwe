"""Small helpers for building Blender shader node trees in code, shared by the skyline's modules
(skyline.py, facade.py, landmarks_<city>.py)."""

import bpy


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


def output(nt, shader):
    out = node(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(shader, out.inputs['Surface'])
    return out


def add_shaders(nt, a, b):
    add = node(nt, 'ShaderNodeAddShader')
    nt.links.new(a, add.inputs[0])
    nt.links.new(b, add.inputs[1])
    return add.outputs[0]


def gain_value(nt, name):
    """A Value node skyline.py switches per render (city_gain, window_gain, window_late)."""
    v = node(nt, 'ShaderNodeValue', name=name, label=name)
    v.outputs[0].default_value = 1.0
    return v.outputs[0]
