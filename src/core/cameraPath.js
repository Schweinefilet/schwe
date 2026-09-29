// The camera's position and look target as smooth functions of timeline time.
//
// Each coordinate is a cubic Hermite curve through the keys, with tangents from Steffen's method:
// velocity is continuous at every key (no speed jumps, which is what read as "snappy"), and the curve
// never overshoots a key (no wobble between two keys that sit close together, or past a hold).
// Two identical consecutive keys make an exact hold, entered and left with zero velocity.
// A key's `speed` (default 1) scales its velocity: below 1 the camera eases as it passes, without
// stopping.

// Keys sampled densely from a smooth curve (`sampled`) take the central difference instead: exact
// enough there, where Steffen's limiter would pinch the tangent wherever an axis turns and jolt the
// acceleration at that key.
function steffen(ts, vs, speeds, sampled) {
  const n = ts.length
  const m = new Array(n).fill(0) // ends start and finish at rest
  for (let i = 1; i < n - 1; i++) {
    if (sampled[i]) {
      m[i] = (vs[i + 1] - vs[i - 1]) / (ts[i + 1] - ts[i - 1])
      continue
    }
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

// keys: [{ at, pos: [x, y, z], look: [x, y, z], speed?, sampled? }] sorted by `at`. `sampled`: the key
// is one of many taken from a smooth curve (core/drift.js, smoothKeys below).
export function createCameraPath(keys) {
  const ts = keys.map((k) => k.at)
  const speeds = keys.map((k) => k.speed ?? 1)
  const sampled = keys.map((k) => !!k.sampled)
  const curves = {}
  for (const field of ['pos', 'look']) {
    curves[field] = [0, 1, 2].map((axis) => {
      const vs = keys.map((k) => k[field][axis])
      return { vs, ms: steffen(ts, vs, speeds, sampled) }
    })
  }

  // Writes into out.pos / out.look (anything with a set(x, y, z) method or plain arrays).
  function sample(t, out) {
    // The segment holding t: the last key at or before it (binary search; the drift has hundreds of keys).
    let lo = 0
    let hi = ts.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ts[mid] < t) lo = mid
      else hi = mid - 1
    }
    const i = lo
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

// A keyed stretch made smooth in acceleration too: `keys` resampled every `fine` units from their
// path, averaged over a Gaussian `sigma` units wide (the ends held), then nudged back exactly onto the
// keys at `pins` (times) by a smooth correction 3 × sigma wide. Returns keys every `step` after `from`.
// The first key should be the end of a hold (it stays exact and the motion starts from rest); `pins`
// are the moments that must be exact, such as a viewpoint and the last frame.
export function smoothKeys(keys, { sigma, pins = [], step = 0.02, fine = 0.005 }) {
  const path = createCameraPath(keys)
  const from = keys[0].at
  const to = keys.at(-1).at
  const n = Math.round((to - from) / fine)
  const out = { pos: null, look: null }
  const raw = { pos: [], look: [] }
  for (let i = 0; i <= n; i++) {
    path.sample(from + i * fine, out)
    raw.pos.push(out.pos)
    raw.look.push(out.look)
  }
  const r = Math.ceil((3 * sigma) / fine)
  const weights = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-0.5 * (((k - r) * fine) / sigma) ** 2))
  const total = weights.reduce((a, b) => a + b, 0)
  const smooth = (a) =>
    a.map((_, i) => {
      const s = [0, 0, 0]
      for (let k = 0; k <= 2 * r; k++) {
        const p = a[Math.min(Math.max(i + k - r, 0), n)]
        for (let j = 0; j < 3; j++) s[j] += (weights[k] * p[j]) / total
      }
      return s
    })
  const result = { pos: smooth(raw.pos), look: smooth(raw.look) }
  for (const at of pins) {
    const i = Math.round((at - from) / fine)
    for (const field of ['pos', 'look']) {
      const delta = raw[field][i].map((v, j) => v - result[field][i][j])
      result[field].forEach((p, m) => {
        const g = Math.exp(-0.5 * (((m - i) * fine) / (3 * sigma)) ** 2)
        for (let j = 0; j < 3; j++) p[j] += delta[j] * g
      })
    }
  }
  const every = Math.round(step / fine)
  const dense = []
  for (let i = every; i <= n; i += every) dense.push({ at: from + i * fine, pos: result.pos[i], look: result.look[i], sampled: true })
  if (dense.at(-1).at < to - 1e-9) dense.push({ at: to, pos: result.pos[n], look: result.look[n], sampled: true })
  return dense
}
