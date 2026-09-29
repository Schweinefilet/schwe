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

A liquid mesh changes topology every frame, so vertices can't be tracked between frames. Each frame
is stored as its own indexed mesh: its vertices (each once, in spatial order, so neighbouring texels
are alike and compress well) and three 16-bit indices per triangle. Every frame starts on a new
texture row and the site draws only the current frame's triangles.

Outputs, plain RGB PNGs (no alpha, so no browser can premultiply the data):
    splash_hi.png    per vertex: R,G,B = high byte of the quantized x, y, z
    splash_lo.png    per vertex: R,G,B = low byte of x, y, z
    splash_nrm.png   per vertex: R,G = octahedral-encoded normal
    splash_idx.png   per triangle corner: R,G = high and low byte of the vertex index in its frame
    splash.json      layout (each frame's first rows and triangle count), bounds (meters, Y-up),
                     quantMax, drop size, frame count
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
    p.add_argument("--frames", type=int, default=0, help="use only the first N cached frames (0: all)")
    # Speed ramp: which cached frames to keep. "frame:step" knots, linear between them; the step is
    # how many cached frames one stored frame advances. The crown and the jet's rise play in full
    # slow motion, then the step widens as the water calms, so the ending leaves slow motion
    # smoothly and the file stays small. "" keeps every frame.
    p.add_argument("--ramp", default="1:1,60:1,150:2.05,240:3.7,300:5.4")
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
    """Vertex clustering with a coarse grid on flat calm water. Returns (verts, normals, tris).

    Vertices only merge if they also face the same way (dominant normal axis and sign). The crown is
    a sheet thinner than a cell; without this, its front and back surfaces merge, their triangles
    collapse, and the sheet fills with holes."""
    flat = (n[:, 2] > 0.985) & (np.abs(v[:, 2] - surface_z) < 0.0015)
    cell = np.where(flat, cell_coarse, cell_fine)[:, None]
    g = np.floor(v / cell).astype(np.int64) + 65_536  # < 2^17 per axis, so the packed key fits int64
    axis = np.abs(n).argmax(axis=1)
    facing = axis * 2 + (n[np.arange(len(n)), axis] > 0)  # 6 directions
    key = (g[:, 0] << 34) | (g[:, 1] << 17) | g[:, 2]
    key = (key * 2 + flat) * 8 + facing  # coarse and fine cells, and opposite faces, never share an id
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
    # The thresholds are the shader's: within 2 mm of rest and tilted less than 1 - 0.97 is invisible.
    calm_v = (np.abs(v[:, 2] - domain["restHeight"]) < 0.002) & (n[:, 2] > 0.97)
    keep &= ~calm_v[tris].all(axis=1)
    tris = tris[keep]
    if len(tris) == 0:
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int64)
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

    # Vertices in Morton (Z-curve) order of their position, triangles by their lowest index: nearby
    # texels then hold nearby points, which is what the PNG compressor can use.
    g = np.clip(((v - v.min(axis=0)) / 0.0005).astype(np.int64), 0, 1023)
    code = np.zeros(len(v), np.int64)
    for bit in range(10):
        for axis in range(3):
            code |= ((g[:, axis] >> bit) & 1) << (3 * bit + axis)
    order = np.argsort(code, kind="stable")
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    v, n, tris = v[order], n[order], rank[tris]
    tris = tris[np.argsort(tris.min(axis=1), kind="stable")]

    # Blender Z-up → three.js Y-up: (x, y, z) → (x, z, -y)
    def y_up(a):
        return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1).astype(np.float32)

    return y_up(v), y_up(n), tris


def oct_encode(n):
    """Unit normals [N,3] → octahedral [N,2] in [0,1]."""
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-8)
    xy = n[:, :2].copy()
    neg = n[:, 2] < 0
    xy[neg] = (1 - np.abs(xy[neg][:, ::-1])) * np.where(xy[neg] >= 0, 1, -1)
    return xy * 0.5 + 0.5


def write_png(path, rgb):
    h, w, _ = rgb.shape
    # Each row takes the PNG filter (none, left neighbour, row above) with the smallest residuals.
    rows = rgb.reshape(h, w * 3).astype(np.int16)
    sub = rows.copy()
    sub[:, 3:] -= rows[:, :-3]
    up = rows.copy()
    up[1:] -= rows[:-1]
    options = np.stack([rows, sub, up]) % 256
    cost = np.abs(options.astype(np.int8).astype(np.int16)).sum(axis=2)  # residuals as signed bytes
    best = cost.argmin(axis=0)
    raw = b"".join(bytes([best[y]]) + options[best[y], y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def ramp_frames(ramp, count):
    """Cached frame numbers (1-based) to store, from the first to the last."""
    if not ramp:
        return list(range(1, count + 1))
    knots = [tuple(float(x) for x in k.split(":")) for k in ramp.split(",")]
    kx, ky = [k[0] for k in knots], [k[1] for k in knots]
    picks, f = [1.0], 1.0
    while True:
        f += float(np.interp(f, kx, ky))
        if f > count:
            break
        picks.append(f)
    keep = sorted({min(count, int(round(x))) for x in picks} | {count})
    return keep


def export(args):
    with open(os.path.join(args.cache, "splash_domain.json")) as f:
        domain = json.load(f)
    files = sorted(glob.glob(os.path.join(args.cache, "mesh", "fluid_mesh_*.bobj.gz")))
    if not files:
        raise SystemExit(f"no meshes in {args.cache}/mesh")
    if args.frames:
        files = files[: args.frames]
    source = ramp_frames(args.ramp, len(files))
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
    for i, f in enumerate(source):
        frames.append(frame_mesh(files[f - 1], domain, args))
        print(f"[splash] frame {i + 1}/{len(source)} (cache {f}): {len(frames[-1][2])} tris", flush=True)

    os.makedirs(args.out, exist_ok=True)
    max_tris = max(1, max(len(t) for _, _, t in frames))
    all_p = np.concatenate([p for p, _, _ in frames if len(p)])
    lo, hi = all_p.min(axis=0), all_p.max(axis=0)
    span = np.maximum(hi - lo, 1e-6)
    levels = (1 << args.bits) - 1
    shift = 16 - args.bits

    width = 2048
    vert_rows = [math.ceil(len(p) / width) for p, _, _ in frames]
    idx_rows = [math.ceil(len(t) * 3 / width) for _, _, t in frames]
    first = lambda rows: np.concatenate([[0], np.cumsum(rows)[:-1]]).astype(int)  # noqa: E731
    vert_first, idx_first = first(vert_rows), first(idx_rows)
    vtex = np.zeros((3, max(1, sum(vert_rows)), width, 3), np.uint8)
    itex = np.zeros((max(1, sum(idx_rows)), width, 3), np.uint8)
    for height in (vtex.shape[1], itex.shape[0]):
        if height > 4096:
            print(f"[splash] warning: a texture is {height} rows; some phones cap textures at 4096", flush=True)

    for fi, (p, n, t) in enumerate(frames):
        if not len(t):
            continue
        q = np.clip(np.round((p - lo) / span * levels), 0, levels).astype(np.uint32) << shift
        o = np.clip(np.round(oct_encode(n) * 255), 0, 255).astype(np.uint8)
        flat = vtex[:, vert_first[fi] : vert_first[fi] + vert_rows[fi]].reshape(3, -1, 3)
        flat[0, : len(p)] = q >> 8
        flat[1, : len(p)] = q & 255
        flat[2, : len(p), :2] = o
        c = t.reshape(-1).astype(np.uint32)
        iflat = itex[idx_first[fi] : idx_first[fi] + idx_rows[fi]].reshape(-1, 3)
        iflat[: len(c), 0] = c >> 8
        iflat[: len(c), 1] = c & 255

    for name, tex in zip(("splash_hi.png", "splash_lo.png", "splash_nrm.png"), vtex):
        write_png(os.path.join(args.out, name), tex)
    write_png(os.path.join(args.out, "splash_idx.png"), itex)
    meta = {
        "frames": len(frames),
        "maxCorners": max_tris * 3,  # the longest frame, in triangle corners (3 per triangle)
        "width": width,
        "vertexRows": vert_first.tolist(),  # each frame's first row in the vertex textures
        "indexRows": idx_first.tolist(),  # each frame's first row in the index texture
        "boundsMin": lo.tolist(),
        "boundsMax": hi.tolist(),
        "quantMax": levels << shift,  # decoded position = mix(min, max, (hi * 256 + lo) / quantMax)
        "surfaceY": domain["restHeight"],  # measured resting water height (Y-up, meters)
        "dropRadius": domain["dropRadius"],
        # Drop center above the resting water at frame 1.
        "dropStartAbove": domain["poolDepth"] + domain["dropStartAbove"] - domain["restHeight"],
        "fps": domain["fps"],
        "timeScale": domain["timeScale"],
        "trisPerFrame": [len(t) for _, _, t in frames],
        "sourceFrames": source,  # the cached frame each stored frame shows (the speed ramp)
    }
    with open(os.path.join(args.out, "splash.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[splash] wrote {len(frames)} frames, {max_tris} tris max, vertex textures {width}x{vtex.shape[1]}, index {width}x{itex.shape[0]} → {args.out}", flush=True)


if __name__ == "__main__":
    export(parse_args())
