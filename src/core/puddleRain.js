// Rain on the puddle (beat 7, after the hero drop): when and where each raindrop lands.
//
// The schedule is a fixed list of impacts on a square tile of the puddle that repeats every `period`
// seconds of the rain's own clock, so the ending loops exactly: the rain at clock τ and at τ + period
// is the same rain. The tile repeats in space too (the wave simulation under it is periodic), so the
// same list covers the whole puddle. Everything here is plain data; PuddleRain.jsx draws it.
//
// Times are in real seconds of the splash's physics (the bakes' own seconds), positions in tile
// coordinates, world units, from 0 to `tile`.

// Small fast seeded PRNG (mulberry32): the same rain on every visit.
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Builds the schedule. `variants`: [{ weight, slant }] (slant in degrees; slanted drops turn to come
// from the wind's side, within `windJitter` radians); `rate`: impacts per world unit² per second;
// `wind`: the scene's horizontal drift direction [x, z]. Returns typed arrays sorted by time:
//   t      impact time in [0, period)
//   x, z   impact point in [0, tile)
//   variant, rot (radians about the vertical), scale, rank (in [0, 1): impacts with rank below the
//   rain's intensity fall; thinning the rain drops the highest ranks first)
export function buildSchedule({ seed = 1, period, tile, rate, variants, wind = [1, 0], windJitter = 0.35, scale = [0.85, 1.15] }) {
  const random = rng(seed)
  const count = Math.max(1, Math.round(rate * tile * tile * period))
  const total = variants.reduce((s, v) => s + v.weight, 0)
  const windAngle = Math.atan2(-wind[1], wind[0]) // rotation about +y that turns local +x into the wind's direction
  const rows = []
  for (let i = 0; i < count; i++) {
    let pick = random() * total
    let variant = 0
    while (variant < variants.length - 1 && pick >= variants[variant].weight) pick -= variants[variant++].weight
    const slanted = variants[variant].slant > 0.5
    const rot = slanted ? windAngle + (random() * 2 - 1) * windJitter : random() * 2 * Math.PI
    rows.push({
      t: random() * period,
      x: random() * tile,
      z: random() * tile,
      variant,
      rot,
      scale: scale[0] + random() * (scale[1] - scale[0]),
      rank: random(),
    })
  }
  rows.sort((a, b) => a.t - b.t)
  const pick = (key, Type = Float32Array) => Type.from(rows, (r) => r[key])
  return {
    period,
    tile,
    count,
    t: Float64Array.from(rows, (r) => r.t),
    x: pick('x'),
    z: pick('z'),
    variant: pick('variant', Uint8Array),
    rot: pick('rot'),
    scale: pick('scale'),
    rank: pick('rank'),
  }
}

// First index with t >= value (sorted times).
function lowerBound(t, value) {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Calls fn(index, age) for every impact whose age (clock − impact time, taking the nearest repeat)
// lies in [-lead, life). Each impact is visited once per repeat that falls in the window; the window
// is shorter than the period, so that is at most once.
export function forEachActive(schedule, clock, lead, life, fn) {
  const { t, period } = schedule
  const from = clock - life
  const to = clock + lead
  // Walk the repeats of the list that overlap [from, to].
  const firstCycle = Math.floor(from / period)
  const lastCycle = Math.floor(to / period)
  for (let c = firstCycle; c <= lastCycle; c++) {
    const base = c * period
    const lo = lowerBound(t, from - base)
    for (let i = lo; i < t.length; i++) {
      const at = t[i] + base
      if (at > to) break
      const age = clock - at
      if (age > -lead && age <= life) fn(i, age)
    }
  }
}

// The copy of tile point (x, z) nearest to world point (fx, fz), for a tile whose origin (tile
// coordinate 0, 0) sits at world (ox, oz). Writes [worldX, worldZ] into out.
export function nearestCopy(x, z, ox, oz, tile, fx, fz, out) {
  const wx = ox + x
  const wz = oz + z
  out[0] = wx + tile * Math.round((fx - wx) / tile)
  out[1] = wz + tile * Math.round((fz - wz) / tile)
  return out
}
