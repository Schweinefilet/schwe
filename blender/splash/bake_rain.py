"""
Rain on the puddle: a library of single raindrop impacts, baked in Mantaflow, for the ending's rain.

The hero drop (bake_splash.py) is one big drop; the rain that follows is many small ones. Each variant
here is one drop of its own size, speed and slant hitting a calm, deep pool, simulated at about twelve
cells across the drop (the hero had ten) and exported as its own vertex animation texture. The site
scatters them over the puddle, each turned and scaled, and a live wave simulation carries the rings
between them (src/scenes/PuddleRain.jsx).

Run headless with Blender (4.2 LTS or later; Mantaflow in the pip `bpy` wheel is broken):
    blender -b --factory-startup -P blender/splash/bake_rain.py -- --variant all --out public/splash/rain
One variant, quick test at low resolution:
    ... -- --variant r20 --cells 5 --frames 40 --out /tmp/rain-test --cache-root /tmp/rain-test-cache
Re-export without simulating again:
    python blender/splash/vat_from_cache.py --cache /tmp/schwe-rain-cache/r20 --out public/splash/rain/r20 --rain

Every variant uses the same time step per frame (FRAME_SECONDS of real time), so all play at one rate.
"""

import argparse
import json
import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vat_from_cache  # noqa: E402

FPS = 24
FRAME_SECONDS = 0.001  # real time per baked frame: 1 ms (the hero's frames were 2.08 ms)

# name: drop radius (m), impact speed (m/s), slant from vertical (degrees, the wind), frames.
# Radii follow the scene's rain beads (0.01–0.03 world units at the splash's scale of 5 per meter).
# Speeds sit below terminal velocity (6.5–9 m/s for these sizes): the crowns come out whole instead of
# shattering into spray far finer than the grid. Frames run until the jets are back in the pool.
VARIANTS = {
    "r15": (0.0015, 5.0, 5.0, 180),
    "r20": (0.0020, 5.5, 0.0, 200),
    "r25": (0.0025, 6.0, 7.0, 230),
    "r30": (0.0030, 6.0, 3.0, 260),
    "r35": (0.0035, 6.5, 9.0, 280),
    "r40": (0.0040, 6.5, 0.0, 300),
}

# Domain in drop diameters: 16 across (walls 8 out, well past the crown), a pool 5 deep (the crater
# reaches 2–3), 9 of air above it (room for the jet and its spray).
WIDTH_D, POOL_D, AIR_D = 16.0, 5.0, 9.0
GAP_D = 0.5  # the drop's underside starts this far above the water at frame 1


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--variant", default="all", help="a name from VARIANTS, a comma list, or all")
    p.add_argument("--out", default="public/splash/rain")
    p.add_argument("--cache-root", default="/tmp/schwe-rain-cache")
    p.add_argument("--cells", type=float, default=10.0, help="grid cells across the drop's diameter")
    p.add_argument("--frames", type=int, default=0, help="override every variant's frame count")
    p.add_argument("--skip-bake", action="store_true", help="export from an existing cache only")
    # The crown is a sheet far thinner than a cell. With Mantaflow's defaults (radius 1, 8–16 particles a
    # cell) the particles spread apart as it stretches and it tears into lace; a larger particle radius,
    # twice the particles and a wider mesher radius keep it whole, a bowl with a rolled rim.
    p.add_argument("--particle-radius", type=float, default=1.5)
    p.add_argument("--particles", default="16,32", help="FLIP particles per cell, min,max")
    p.add_argument("--mesh-radius", type=float, default=3.0, help="particle radius the mesher uses")
    args, rest = p.parse_known_args(argv)
    return args, rest


def add_box(size, center):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    return ob


def build_scene(name, args, cache):
    radius, speed, slant, frames = VARIANTS[name]
    if args.frames:
        frames = args.frames
    d = 2 * radius
    width, pool, air = WIDTH_D * d, POOL_D * d, AIR_D * d
    height = pool + air
    res = max(16, round(args.cells * WIDTH_D))  # along the longest side (the width)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.fps = FPS

    domain = add_box((width, width, height), (0, 0, height / 2))
    domain.name = "Domain"
    mod = domain.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "DOMAIN"
    ds = mod.domain_settings
    ds.domain_type = "LIQUID"
    ds.resolution_max = res
    ds.time_scale = FRAME_SECONDS * FPS
    ds.use_adaptive_timesteps = True
    # The drop crosses many cells per frame at these speeds: allow enough substeps that it moves at
    # most two cells in each (the default cap of 4 would let it tunnel into the pool).
    ds.cfl_condition = 2.0
    ds.timesteps_max = 24
    ds.particle_radius = args.particle_radius
    ds.particle_min, ds.particle_max = (int(x) for x in args.particles.split(","))
    ds.mesh_particle_radius = args.mesh_radius
    # Mantaflow's surface tension (use_diffusion + surface_tension) made no difference at 0.5, 5, 20 or
    # 80 in Blender 5.2: left off.
    ds.use_mesh = True
    ds.mesh_scale = 2
    ds.mesh_smoothen_pos = 2
    ds.mesh_smoothen_neg = 1
    ds.cache_directory = cache
    ds.cache_type = "ALL"
    ds.cache_frame_start = 1
    ds.cache_frame_end = frames

    pool_ob = add_box((width, width, pool), (0, 0, pool / 2))
    pool_ob.name = "Pool"
    m = pool_ob.modifiers.new("Fluid", "FLUID")
    m.fluid_type = "FLOW"
    m.flow_settings.flow_type = "LIQUID"
    m.flow_settings.flow_behavior = "GEOMETRY"

    # Slanted drops start upwind, so every one lands on the domain's centre.
    a = math.radians(slant)
    vel = (speed * math.sin(a), 0.0, -speed * math.cos(a))
    start_above = GAP_D * d + radius  # drop centre above the nominal surface
    fall_time = (GAP_D * d) / (speed * math.cos(a))
    x0 = -vel[0] * fall_time
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=48, ring_count=24, location=(x0, 0, pool + start_above))
    drop = bpy.context.active_object
    drop.name = "Drop"
    m = drop.modifiers.new("Fluid", "FLUID")
    m.fluid_type = "FLOW"
    fs = m.flow_settings
    fs.flow_type = "LIQUID"
    fs.flow_behavior = "GEOMETRY"
    fs.use_initial_velocity = True
    fs.velocity_coord = vel

    info = {
        "variant": name,
        "maxSize": max(width, height),
        "center": [0, 0, height / 2],
        "poolDepth": pool,
        "dropRadius": radius,
        "dropStartAbove": start_above,
        "dropStartX": x0,
        "velocity": list(vel),
        "speed": speed,
        "slant": slant,
        "fps": FPS,
        "timeScale": FRAME_SECONDS * FPS,
        "frameSeconds": FRAME_SECONDS,
        "resolution": res,
        "cell": max(width, height) / res,
    }
    return domain, frames, info


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
    names = list(VARIANTS) if args.variant == "all" else args.variant.split(",")
    for name in names:
        t0 = time.time()
        cache = os.path.join(args.cache_root, name)
        domain, frames, info = build_scene(name, args, cache)
        if not args.skip_bake:
            print(f"[rain] {name}: baking {frames} frames at res {info['resolution']} (cell {info['cell'] * 1000:.3f} mm) …", flush=True)
            bake(domain)
            print(f"[rain] {name}: bake done in {time.time() - t0:.0f}s", flush=True)
        with open(os.path.join(cache, "splash_domain.json"), "w") as f:
            json.dump(info, f)
        out = os.path.join(args.out, name)
        vat_from_cache.export(vat_from_cache.parse_args(["--cache", cache, "--out", out, "--rain", *export_argv]))
        print(f"[rain] {name}: total {time.time() - t0:.0f}s", flush=True)


main()
