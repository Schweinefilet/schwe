"""
Mantaflow mesh cache → vertex animation texture, in plain numpy (no Blender needed).

Reads the liquid mesh Mantaflow wrote for each frame (cache/mesh/fluid_mesh_####.bobj.gz), keeps
the impact zone, simplifies it under a triangle budget, and writes the VAT the site plays back.
bake_splash.py calls this after baking; run it alone to re-export with other settings:

    python blender/splash/vat_from_cache.py --cache /tmp/schwe-splash-cache --out public/splash
    (any Python 3 with numpy; Blender's bundled Python works: blender/4.2/python/bin/python3.11)

Simplification is vertex clustering: vertices are snapped to a grid, each occupied cell becomes one
vertex (average position and normal), and triangles whose corners collapse together are dropped.
Flat, calm water gets a coarse grid; the crown and crater get a fine one. The fine cell size is
searched per frame so each frame lands just under the budget.

A liquid mesh changes topology every frame, so vertices can't be tracked between frames. Every
frame is stored as a "triangle soup" (three vertices per triangle), padded to the largest frame with
degenerate triangles (all three vertices at one point), which the GPU skips.

Outputs, plain RGB PNGs (no alpha, so no browser can premultiply the data):
    splash_hi.png    R,G,B = high byte of the quantized x, y, z
    splash_lo.png    R,G,B = low byte of x, y, z
    splash_nrm.png   R,G = octahedral-encoded normal
    splash.json      layout, bounds (meters, Y-up), quantMax, drop size, frame count
"""

import argparse
import glob
import gzip
import json
import math
import os
import struct
import zlib

import numpy as np


def parse_args(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--cache", required=True)
    p.add_argument("--out", default="public/splash")
    p.add_argument("--max-tris", type=int, default=6000, help="triangle budget per frame")
    p.add_argument("--crop", type=float, default=0.06, help="keep geometry within this radius of the impact (m)")
    p.add_argument("--coarse", type=float, default=5.0, help="flat water uses cells this many times larger")
    # 12 bits is ~0.03 mm over the splash's span, far below a pixel, and leaves the low-byte PNG
    # mostly zeros, so it compresses better.
    p.add_argument("--bits", type=int, default=12, help="position precision, at most 16")
    return p.parse_args(argv)


def read_bobj(path):
    """Mantaflow .bobj.gz: int n, n×float3 verts, int n, n×float3 normals, int t, t×int3 triangles."""
    b = gzip.open(path).read()
    o = 0

    def block(dtype, count, width):
        nonlocal o
        a = np.frombuffer(b, dtype, count * width, o).reshape(-1, width)
        o += count * width * 4
        return a

    n = struct.unpack_from("<i", b, o)[0]
    o += 4
    verts = block("<f4", n, 3)
    nn = struct.unpack_from("<i", b, o)[0]
    o += 4
    normals = block("<f4", nn, 3)
    t = struct.unpack_from("<i", b, o)[0]
    o += 4
    tris = block("<i4", t, 3)
    return verts, normals, tris


def cluster(v, n, tris, cell_fine, cell_coarse, surface_z):
    """Vertex clustering with a coarse grid on flat calm water. Returns (verts, normals, tris)."""
    flat = (n[:, 2] > 0.985) & (np.abs(v[:, 2] - surface_z) < 0.0015)
    cell = np.where(flat, cell_coarse, cell_fine)[:, None]
    g = np.floor(v / cell).astype(np.int64) + 500_000  # < 2^19 per axis, so the packed key fits int64
    key = (g[:, 0] << 42) ^ (g[:, 1] << 21) ^ g[:, 2]
    key = key * 2 + flat  # coarse and fine cells never share an id
    uniq, cid = np.unique(key, return_inverse=True)
    cid = cid.ravel()
    k = len(uniq)
    count = np.bincount(cid, minlength=k)[:, None]
    cv = np.stack([np.bincount(cid, v[:, i], k) for i in range(3)], 1) / count
    cn = np.stack([np.bincount(cid, n[:, i], k) for i in range(3)], 1)
    cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-8)
    t = cid[tris]
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = t[keep]
    # Collapsing can create the same triangle twice; keep one.
    _, first = np.unique(np.sort(t, axis=1), axis=0, return_index=True)
    return cv, cn, t[np.sort(first)]


def frame_mesh(path, domain, args):
    v, n, tris = read_bobj(path)
    # Cache coordinates are the domain normalized by its longest side, centered on the domain.
    v = v * domain["maxSize"] + np.array(domain["center"], np.float32)
    n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-8)

    c = v[tris].mean(axis=1)
    keep = (np.hypot(c[:, 0], c[:, 1]) <= args.crop) & (c[:, 2] >= domain["poolDepth"] * 0.5)
    # Calm water (at rest height, facing up) is drawn by the site's puddle, and the splash shader
    # makes it transparent anyway: drop it here so the whole budget goes to the crown, jet and crater.
    calm_v = (np.abs(v[:, 2] - domain["restHeight"]) < 0.0015) & (n[:, 2] > 0.985)
    keep &= ~calm_v[tris].all(axis=1)
    tris = tris[keep]
    if len(tris) == 0:
        return np.zeros((0, 3, 3), np.float32), np.zeros((0, 3, 3), np.float32)
    used, remap = np.unique(tris, return_inverse=True)
    v, n, tris = v[used], n[used], remap.reshape(-1, 3)

    if len(tris) > args.max_tris:
        lo, hi = 1e-5, 0.02  # fine cell size bounds, meters
        best = None
        for _ in range(18):
            mid = math.sqrt(lo * hi)
            cv, cn, ct = cluster(v, n, tris, mid, mid * args.coarse, domain["restHeight"])
            if len(ct) > args.max_tris:
                lo = mid
            else:
                hi = mid
                best = (cv, cn, ct)
        v, n, tris = best if best else cluster(v, n, tris, hi, hi * args.coarse, domain["restHeight"])

    # Blender Z-up → three.js Y-up: (x, y, z) → (x, z, -y)
    def y_up(a):
        return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1).astype(np.float32)

    return y_up(v[tris]), y_up(n[tris])


def oct_encode(n):
    """Unit normals [N,3] → octahedral [N,2] in [0,1]."""
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-8)
    xy = n[:, :2].copy()
    neg = n[:, 2] < 0
    xy[neg] = (1 - np.abs(xy[neg][:, ::-1])) * np.where(xy[neg] >= 0, 1, -1)
    return xy * 0.5 + 0.5


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def export(args):
    with open(os.path.join(args.cache, "splash_domain.json")) as f:
        domain = json.load(f)
    files = sorted(glob.glob(os.path.join(args.cache, "mesh", "fluid_mesh_*.bobj.gz")))
    if not files:
        raise SystemExit(f"no meshes in {args.cache}/mesh")
    # Where the water actually rests: the level-set surface sits a little above the nominal pool depth.
    # Measured on frame 1 (before the impact) over the calm outer ring, so the site can put rest height
    # exactly on its puddle plane.
    v0, n0, _ = read_bobj(files[0])
    v0 = v0 * domain["maxSize"] + np.array(domain["center"], np.float32)
    r0 = np.hypot(v0[:, 0], v0[:, 1])
    calm = (n0[:, 2] / np.maximum(np.linalg.norm(n0, axis=1), 1e-8) > 0.99) & (r0 > args.crop * 0.6) & (r0 < args.crop)
    rest = float(np.median(v0[calm, 2])) if calm.any() else domain["poolDepth"]
    domain = {**domain, "restHeight": rest}

    frames = []
    for i, path in enumerate(files):
        frames.append(frame_mesh(path, domain, args))
        print(f"[splash] frame {i + 1}/{len(files)}: {len(frames[-1][0])} tris", flush=True)

    os.makedirs(args.out, exist_ok=True)
    max_tris = max(1, max(len(p) for p, _ in frames))
    verts_per_frame = max_tris * 3
    all_p = np.concatenate([p.reshape(-1, 3) for p, _ in frames if len(p)])
    lo, hi = all_p.min(axis=0), all_p.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)
    levels = (1 << args.bits) - 1
    shift = 16 - args.bits

    width = 1
    while width < min(verts_per_frame, 2048):
        width *= 2
    rows_per_frame = math.ceil(verts_per_frame / width)
    height = rows_per_frame * len(frames)
    tex = np.zeros((3, height, width, 3), np.uint8)

    for fi, (p, n) in enumerate(frames):
        flat_p = np.repeat(lo[None], verts_per_frame, 0).astype(np.float32)  # padding: one point → degenerate
        flat_n = np.tile(np.array([0, 1, 0], np.float32), (verts_per_frame, 1))
        if len(p):
            flat_p[: len(p) * 3] = p.reshape(-1, 3)
            flat_n[: len(p) * 3] = n.reshape(-1, 3)
        q = np.clip(np.round((flat_p - lo) / span * levels), 0, levels).astype(np.uint32) << shift
        o = np.clip(np.round(oct_encode(flat_n) * 255), 0, 255).astype(np.uint8)
        block = np.zeros((3, rows_per_frame * width, 3), np.uint8)
        block[0, :verts_per_frame] = q >> 8
        block[1, :verts_per_frame] = q & 255
        block[2, :verts_per_frame, :2] = o
        r0 = fi * rows_per_frame
        tex[:, r0 : r0 + rows_per_frame] = block.reshape(3, rows_per_frame, width, 3)

    for name, t in zip(("splash_hi.png", "splash_lo.png", "splash_nrm.png"), tex):
        write_png(os.path.join(args.out, name), t)
    meta = {
        "frames": len(frames),
        "vertsPerFrame": verts_per_frame,
        "width": width,
        "rowsPerFrame": rows_per_frame,
        "boundsMin": lo.tolist(),
        "boundsMax": hi.tolist(),
        "quantMax": levels << shift,  # decoded position = mix(min, max, (hi * 256 + lo) / quantMax)
        "surfaceY": domain["restHeight"],  # measured resting water height (Y-up, meters)
        "dropRadius": domain["dropRadius"],
        # Drop center above the resting water at frame 1.
        "dropStartAbove": domain["poolDepth"] + domain["dropStartAbove"] - domain["restHeight"],
        "fps": domain["fps"],
        "timeScale": domain["timeScale"],
        "trisPerFrame": [len(p) for p, _ in frames],
    }
    with open(os.path.join(args.out, "splash.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[splash] wrote {width}x{height} VAT, {max_tris} tris max → {args.out}", flush=True)


if __name__ == "__main__":
    export(parse_args())
