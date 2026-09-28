"""
Crown splash: Mantaflow simulation for the site's final beat, exported as a vertex animation texture.

Run headless with Blender 4.2 LTS (the `bpy` pip wheel's Mantaflow bindings are broken):
    blender -b --factory-startup -P blender/splash/bake_splash.py -- --out public/splash
Quick pipeline test at low resolution:
    ... -- --res 48 --frames 12 --out /tmp/splash-test --cache /tmp/splash-test-cache
Re-export without simulating again (other crop, triangle budget or precision):
    python blender/splash/vat_from_cache.py --cache /tmp/schwe-splash-cache --out public/splash

What it does
1. Builds a small liquid domain: a shallow pool and one drop fired downward at about a large
   raindrop's terminal velocity.
2. Bakes Mantaflow with a small time scale, so a fraction of a second of real time spreads over many
   frames (the slow motion is simulated, not interpolated).
3. Writes the domain's dimensions next to the cache (splash_domain.json) and hands the cached meshes
   to vat_from_cache.py, which crops, simplifies and encodes them. That step is plain numpy and takes
   seconds; reading the meshes back through Blender took most of an hour at full resolution.
"""

import argparse
import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vat_from_cache  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="public/splash")
    p.add_argument("--cache", default="/tmp/schwe-splash-cache")
    p.add_argument("--res", type=int, default=160, help="domain resolution along its longest side")
    p.add_argument("--frames", type=int, default=72)
    p.add_argument("--time-scale", type=float, default=0.05, help="sim seconds per second of playback at 24 fps")
    args, rest = p.parse_known_args(argv)
    return args, rest  # the rest (--max-tris, --crop, --bits, …) goes to the exporter


# ---- Scene -------------------------------------------------------------------------------------
# Meters, Blender Z-up. Domain 0.2 × 0.2 × 0.12 m; pool 0.03 m deep; drop radius 6 mm.
DOMAIN = (0.2, 0.2, 0.12)
POOL_DEPTH = 0.03
DROP_RADIUS = 0.006
DROP_HEIGHT = 0.02  # gap between drop bottom and pool surface at frame 1
DROP_SPEED = 4.0  # m/s


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
    return domain


def bake(domain):
    for ob in bpy.context.scene.objects:
        ob.select_set(ob == domain)
    bpy.context.view_layer.objects.active = domain
    with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
        result = bpy.ops.fluid.bake_all()
    if "FINISHED" not in result:
        raise RuntimeError(f"bake failed: {result}")


def main():
    args, export_argv = parse_args()
    t0 = time.time()
    domain = build_scene(args)
    print(f"[splash] baking {args.frames} frames at res {args.res} …", flush=True)
    bake(domain)
    print(f"[splash] bake done in {time.time() - t0:.0f}s", flush=True)

    # Mantaflow stores meshes in the domain's space normalized by its longest side; the exporter
    # needs these numbers to put them back in meters.
    with open(os.path.join(args.cache, "splash_domain.json"), "w") as f:
        json.dump(
            {
                "maxSize": max(DOMAIN),
                "center": [0, 0, DOMAIN[2] / 2],
                "poolDepth": POOL_DEPTH,
                "dropRadius": DROP_RADIUS,
                "dropStartAbove": DROP_HEIGHT + DROP_RADIUS,  # drop center above the nominal surface
                "fps": 24,
                "timeScale": args.time_scale,
            },
            f,
        )
    vat_from_cache.export(vat_from_cache.parse_args(["--cache", args.cache, "--out", args.out, *export_argv]))
    print(f"[splash] total {time.time() - t0:.0f}s", flush=True)


main()
