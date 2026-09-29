// The camera's position and look target as smooth functions of timeline time.
//
// Each coordinate is a cubic Hermite curve through the keys, with tangents from Steffen's method:
// velocity is continuous at every key (no speed jumps, which is what read as "snappy"), and the curve
// never overshoots a key (no wobble between two keys that sit close together, or past a hold).
// Two identical consecutive keys make an exact hold, entered and left with zero velocity.
// A key's `speed` (default 1) scales its velocity: below 1 the camera eases as it passes, without
// stopping.

function steffen(ts, vs, speeds) {
  const n = ts.length
  const m = new Array(n).fill(0) // ends start and finish at rest
  for (let i = 1; i < n - 1; i++) {
    const h0 = ts[i] - ts[i - 1]
    const h1 = ts[i + 1] - ts[i]
    const d0 = (vs[i] - vs[i - 1]) / h0
    const d1 = (vs[i + 1] - vs[i]) / h1
    if (d0 * d1 <= 0) continue // a local turn or flat side: velocity 0 here keeps it from overshooting
    const p = (d0 * h1 + d1 * h0) / (h0 + h1)
    m[i] = Math.sign(d0) * Math.min(Math.abs(d0), Math.abs(d1), 0.5 * Math.abs(p)) * 2 * speeds[i]
  }
  return m
}

function hermite(p0, p1, m0, m1, h, s) {
  const s2 = s * s
  const s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1
}

// keys: [{ at, pos: [x, y, z], look: [x, y, z], speed? }] sorted by `at`.
export function createCameraPath(keys) {
  const ts = keys.map((k) => k.at)
  const speeds = keys.map((k) => k.speed ?? 1)
  const curves = {}
  for (const field of ['pos', 'look']) {
    curves[field] = [0, 1, 2].map((axis) => {
      const vs = keys.map((k) => k[field][axis])
      return { vs, ms: steffen(ts, vs, speeds) }
    })
  }

  // Writes into out.pos / out.look (anything with a set(x, y, z) method or plain arrays).
  function sample(t, out) {
    let i = 0
    if (t <= ts[0]) i = 0
    else if (t >= ts[ts.length - 1]) i = ts.length - 2
    else while (t > ts[i + 1]) i++
    const h = ts[i + 1] - ts[i]
    const s = Math.min(1, Math.max(0, (t - ts[i]) / h))
    for (const field of ['pos', 'look']) {
      const c = curves[field]
      const x = hermite(c[0].vs[i], c[0].vs[i + 1], c[0].ms[i], c[0].ms[i + 1], h, s)
      const y = hermite(c[1].vs[i], c[1].vs[i + 1], c[1].ms[i], c[1].ms[i + 1], h, s)
      const z = hermite(c[2].vs[i], c[2].vs[i + 1], c[2].ms[i], c[2].ms[i + 1], h, s)
      if (out[field]?.set) out[field].set(x, y, z)
      else out[field] = [x, y, z]
    }
    return out
  }

  return { sample, start: ts[0], end: ts[ts.length - 1] }
}
