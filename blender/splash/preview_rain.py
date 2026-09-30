"""
Contact sheet of a baked splash straight from the Mantaflow cache: selected frames rendered with
Workbench studio lighting from a low side view (the site's camera looks along the water).

    blender -b --factory-startup -P blender/splash/preview_rain.py -- --cache /tmp/schwe-rain-cache/r20 \
        --out review/rain/r20.png [--frames 1,10,20,…] [--step 10]
"""

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vat_from_cache import read_bobj  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--cache", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--frames", default="")
    p.add_argument("--step", type=int, default=10)
    p.add_argument("--size", type=int, default=480)
    p.add_argument("--cols", type=int, default=6)
    p.add_argument("--elev", type=float, default=12.0, help="camera elevation, degrees")
    p.add_argument("--domain", default="", help="splash_domain.json to use (while a bake is still running)")
    return p.parse_args(argv)


def main():
    args = parse_args()
    with open(args.domain or os.path.join(args.cache, "splash_domain.json")) as f:
        dom = json.load(f)
    files = sorted(glob.glob(os.path.join(args.cache, "mesh", "fluid_mesh_*.bobj.gz")))
    picks = [int(x) for x in args.frames.split(",")] if args.frames else list(range(1, len(files) + 1, args.step))
    picks = [p for p in picks if p <= len(files)]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.55, 0.62, 0.7)
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x = args.size
    scene.render.resolution_y = int(args.size * 0.75)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.02, 0.02, 0.03)

    d = 2 * dom["dropRadius"]
    pool = dom["poolDepth"]
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam_data.clip_start = 1e-5  # the scene is centimeters across
    cam_data.clip_end = 10
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    dist = 16 * d
    el = math.radians(args.elev)
    target = (0, 0, pool + 1.5 * d)
    cam.location = (0, -dist * math.cos(el), target[2] + dist * math.sin(el))
    direction = np.subtract(target, cam.location)
    cam.rotation_euler = (math.atan2(math.hypot(direction[0], direction[1]), -direction[2]), 0, 0)

    mesh_ob = None
    tmp = tempfile.mkdtemp()
    shots = []
    for i, fr in enumerate(picks):
        v, n, t = read_bobj(files[fr - 1])
        v = v * dom["maxSize"] + np.array(dom["center"], np.float32)
        me = bpy.data.meshes.new(f"f{fr}")
        me.from_pydata(v.tolist(), [], t.tolist())
        me.shade_smooth() if hasattr(me, "shade_smooth") else None
        if mesh_ob:
            old = mesh_ob.data
            mesh_ob.data = me
            bpy.data.meshes.remove(old)
        else:
            mesh_ob = bpy.data.objects.new("fluid", me)
            scene.collection.objects.link(mesh_ob)
        path = os.path.join(tmp, f"{i:03d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        shots.append(path)
        print(f"[preview] frame {fr}", flush=True)

    cols = min(args.cols, len(shots))
    rows = math.ceil(len(shots) / cols)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    labels = ",".join(str(p) for p in picks)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "1", "-i", os.path.join(tmp, "%03d.png"),
         "-vf", f"tile={cols}x{rows}:padding=4:color=white", "-frames:v", "1", args.out],
        check=True,
    )
    print(f"[preview] {args.out} (frames {labels})", flush=True)


main()
