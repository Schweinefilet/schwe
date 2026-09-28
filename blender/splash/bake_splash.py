"""
Crown splash: Mantaflow simulation baked to a vertex animation texture (VAT) for the web.

Run headless (Blender 4.2, or the `bpy` 4.2 wheel):
    blender -b -P blender/splash/bake_splash.py -- --out public/splash
    python blender/splash/bake_splash.py --out public/splash            (with `pip install bpy==4.2.0`)
Quick pipeline test at low resolution:
    ... -- --res 64 --frames 16 --out /tmp/splash-test

What it does
1. Builds a small liquid domain: a shallow pool and one drop fired downward.
2. Bakes Mantaflow with a small time scale, so a fraction of a second of real time spreads over many
   frames (slow motion is recorded, not interpolated).
3. For each frame, takes the liquid mesh, keeps only the impact zone (the rest of the pool is the
   site's puddle plane), and decimates it under a triangle budget.
4. Writes the frames as a VAT. A liquid mesh changes topology every frame, so vertices can't be
   tracked from frame to frame. Instead every frame is stored as a "triangle soup": three vertices
   per triangle, padded to the largest frame with degenerate triangles (all three vertices at the
   same point), which the GPU skips. The browser draws one fixed mesh of MAX_TRIS triangles and the
   vertex shader looks up each vertex's position for the current frame.

Outputs (in --out). Plain RGB PNGs: no alpha channel, so no browser can premultiply the data.
    splash_hi.png    R,G,B = high byte of the 16-bit quantized x, y, z
    splash_lo.png    R,G,B = low byte of x, y, z
    splash_nrm.png   R,G = octahedral-encoded normal (8-bit each)
    splash.json      layout: frames, vertsPerFrame, width, rowsPerFrame, bounds (meters, Y-up), fps
"""

import argparse
import json
import math
import os
import struct
import sys
import time
import zlib

import bpy
import bmesh
import numpy as np


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="public/splash")
    p.add_argument("--cache", default="/tmp/schwe-splash-cache")
    p.add_argument("--res", type=int, default=160, help="domain resolution along its longest side")
    p.add_argument("--frames", type=int, default=72)
    p.add_argument("--time-scale", type=float, default=0.05, help="sim seconds per real second of playback")
    p.add_argument("--max-tris", type=int, default=6000, help="triangle budget per frame")
    p.add_argument("--crop", type=float, default=0.06, help="keep geometry within this radius of the impact (m)")
    return p.parse_args(argv)


# ---- Scene -------------------------------------------------------------------------------------
# Meters, Blender Z-up. Domain 0.2 × 0.2 × 0.12 m; pool 0.03 m deep; drop radius 6 mm.
DOMAIN = (0.2, 0.2, 0.12)
POOL_DEPTH = 0.03
DROP_RADIUS = 0.006
DROP_HEIGHT = 0.02  # gap between drop bottom and pool surface at frame 1
DROP_SPEED = 4.0  # m/s, close to a large raindrop's terminal velocity


def add_box(size, center):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)  # mesh in world space
    return ob


def build_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = args.frames
    scene.render.fps = 24

    domain = add_box(DOMAIN, (0, 0, DOMAIN[2] / 2))
    domain.name = "Domain"
    mod = domain.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "DOMAIN"
    ds = mod.domain_settings
    ds.domain_type = "LIQUID"
    ds.resolution_max = args.res
    ds.time_scale = args.time_scale
    ds.use_adaptive_timesteps = True
    ds.use_mesh = True
    ds.mesh_scale = 2  # mesh at twice the grid resolution: thinner crown sheet
    ds.mesh_smoothen_pos = 1
    ds.mesh_smoothen_neg = 1
    ds.cache_directory = args.cache
    ds.cache_type = "ALL"
    ds.cache_frame_start = 1
    ds.cache_frame_end = args.frames

    pool = add_box((DOMAIN[0], DOMAIN[1], POOL_DEPTH), (0, 0, POOL_DEPTH / 2))
    pool.name = "Pool"
    m = pool.modifiers.new("Fluid", "FLUID")
    m.fluid_type = "FLOW"
    m.flow_settings.flow_type = "LIQUID"
    m.flow_settings.flow_behavior = "GEOMETRY"

    bpy.ops.mesh.primitive_uv_sphere_add(radius=DROP_RADIUS, location=(0, 0, POOL_DEPTH + DROP_HEIGHT + DROP_RADIUS))
    drop = bpy.context.active_object
    drop.name = "Drop"
    m = drop.modifiers.new("Fluid", "FLUID")
    m.fluid_type = "FLOW"
    fs = m.flow_settings
    fs.flow_type = "LIQUID"
    fs.flow_behavior = "GEOMETRY"
    fs.use_initial_velocity = True
    fs.velocity_coord = (0, 0, -DROP_SPEED)

    # Flow objects only emit; hide them from the evaluated result.
    pool.hide_render = drop.hide_render = True
    return scene, domain


def bake(domain):
    for ob in bpy.context.scene.objects:
        ob.select_set(ob == domain)
    bpy.context.view_layer.objects.active = domain
    with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
        result = bpy.ops.fluid.bake_all()
    if "FINISHED" not in result:
        raise RuntimeError(f"bake failed: {result}")


# ---- Mesh extraction ---------------------------------------------------------------------------
def frame_triangles(scene, domain, frame, args):
    """Cropped, decimated triangles for one frame: (positions [T,3,3], normals [T,3,3]), Y-up meters."""
    scene.frame_set(frame)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = domain.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=deps)

    bm = bmesh.new()
    bm.from_mesh(me)
    # Keep the impact zone only; the rest of the pool is the site's puddle plane.
    kill = [f for f in bm.faces if math.hypot(f.calc_center_median().x, f.calc_center_median().y) > args.crop]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    # The flat floor and walls of the pool box are never seen from above: drop faces well below the surface.
    kill = [f for f in bm.faces if f.calc_center_median().z < POOL_DEPTH * 0.5]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    # Merge near-flat regions (the calm pool surface) into large faces, so the triangle budget goes to
    # the crown and the crater instead of flat water.
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.5), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()

    tris = len(me.polygons)
    if tris == 0:
        bpy.data.meshes.remove(me)
        return np.zeros((0, 3, 3), np.float32), np.zeros((0, 3, 3), np.float32)
    ob = bpy.data.objects.new("frame", me)
    bpy.context.scene.collection.objects.link(ob)
    if tris > args.max_tris:
        dec = ob.modifiers.new("Decimate", "DECIMATE")
        dec.ratio = args.max_tris / tris * 0.98
        deps = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(deps), depsgraph=deps)
    else:
        me2 = me
    me2.calc_loop_triangles()

    n = len(me2.loop_triangles)
    verts = np.zeros((len(me2.vertices), 3), np.float32)
    me2.vertices.foreach_get("co", verts.ravel())
    normals = np.zeros((len(me2.vertices), 3), np.float32)
    me2.vertices.foreach_get("normal", normals.ravel())
    idx = np.zeros((n, 3), np.int32)
    me2.loop_triangles.foreach_get("vertices", idx.ravel())

    bpy.data.objects.remove(ob)
    for m in {me, me2}:
        bpy.data.meshes.remove(m)

    # Blender Z-up → three.js Y-up: (x, y, z) → (x, z, -y)
    def to_y_up(a):
        return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)

    return to_y_up(verts[idx]), to_y_up(normals[idx])


# ---- Encoding ----------------------------------------------------------------------------------
def oct_encode(n):
    """Unit normals [N,3] → octahedral [N,2] in [0,1]."""
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-8)
    xy = n[:, :2].copy()
    neg = n[:, 2] < 0
    xy[neg] = (1 - np.abs(xy[neg][:, ::-1])) * np.where(xy[neg] >= 0, 1, -1)
    return xy * 0.5 + 0.5


def write_png(path, rgb):
    """Minimal RGB8 PNG writer (no PIL in Blender's Python)."""
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    scene, domain = build_scene(args)
    print(f"[splash] baking {args.frames} frames at res {args.res} …", flush=True)
    bake(domain)
    print(f"[splash] bake done in {time.time() - t0:.0f}s", flush=True)

    frames = []
    for f in range(1, args.frames + 1):
        p, n = frame_triangles(scene, domain, f, args)
        frames.append((p, n))
        print(f"[splash] frame {f}: {len(p)} tris", flush=True)

    max_tris = max(1, max(len(p) for p, _ in frames))
    verts_per_frame = max_tris * 3
    all_p = np.concatenate([p.reshape(-1, 3) for p, _ in frames if len(p)])
    lo, hi = all_p.min(axis=0), all_p.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)

    width = 1
    while width < min(verts_per_frame, 2048):
        width *= 2
    rows_per_frame = math.ceil(verts_per_frame / width)
    height = rows_per_frame * len(frames)
    tex_hi = np.zeros((height, width, 3), np.uint8)
    tex_lo = np.zeros((height, width, 3), np.uint8)
    tex_n = np.zeros((height, width, 3), np.uint8)

    for fi, (p, n) in enumerate(frames):
        flat_p = np.zeros((verts_per_frame, 3), np.float32)
        flat_n = np.zeros((verts_per_frame, 3), np.float32)
        flat_n[:, 1] = 1
        flat_p[:] = lo  # padding: every unused vertex at the same point → degenerate triangles
        if len(p):
            flat_p[: len(p) * 3] = p.reshape(-1, 3)
            flat_n[: len(p) * 3] = n.reshape(-1, 3)
        q = np.clip(np.round((flat_p - lo) / span * 65535), 0, 65535).astype(np.uint32)
        o = np.clip(np.round(oct_encode(flat_n) * 255), 0, 255).astype(np.uint8)
        block = np.zeros((3, rows_per_frame * width, 3), np.uint8)
        block[0, :verts_per_frame] = (q >> 8).astype(np.uint8)
        block[1, :verts_per_frame] = (q & 255).astype(np.uint8)
        block[2, :verts_per_frame, :2] = o
        r0 = fi * rows_per_frame
        for tex, b in zip((tex_hi, tex_lo, tex_n), block):
            tex[r0 : r0 + rows_per_frame] = b.reshape(rows_per_frame, width, 3)

    write_png(os.path.join(args.out, "splash_hi.png"), tex_hi)
    write_png(os.path.join(args.out, "splash_lo.png"), tex_lo)
    write_png(os.path.join(args.out, "splash_nrm.png"), tex_n)
    meta = {
        "frames": len(frames),
        "vertsPerFrame": verts_per_frame,
        "width": width,
        "rowsPerFrame": rows_per_frame,
        "boundsMin": lo.tolist(),
        "boundsMax": hi.tolist(),
        "surfaceY": POOL_DEPTH,
        "dropRadius": DROP_RADIUS,
        "dropStartAbove": DROP_HEIGHT + DROP_RADIUS,  # drop center above the resting surface at frame 1
        "fps": 24,
        "timeScale": args.time_scale,
        "trisPerFrame": [len(p) for p, _ in frames],
    }
    with open(os.path.join(args.out, "splash.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[splash] wrote {width}x{height} VAT, {max_tris} tris max, in {time.time() - t0:.0f}s total", flush=True)


main()
