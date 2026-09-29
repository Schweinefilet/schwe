// The first half of the film's camera, from the rain at the top to inside the dive drop: a floating
// path that weaves between the city drops, the drops placed along it, and a gaze that leans into its
// turns. Pure: config.js builds CAMERA_KEYS and the drops' positions from it.
//
// Path: a straight line bent by `curve` (sideways and vertical offsets as functions of the distance
// travelled), the bend fading in after the start and out before the dive, so the camera arrives on
// the dive drop's axis; then straight on into the drop.
// Timing: one smooth speed profile, so acceleration never jumps (low jerk): a gentle start from rest,
// a soft dip at each drop (to `ease` of the cruising speed, Gaussian, `sigma` wide), a blend into
// the approach speed, then a quintic ease that comes to rest inside the drop with no acceleration left.
// Drops sit `lead` ahead of where the camera is slowest, `pass` off the path, across it at the angle
// in `around` (0 right, 90 up; mostly above and below, so portrait phones keep them in frame).
// Gaze: `ahead` along the path, so it turns and tilts into each bend; a slow `sway` of its own (yaw,
// pitch, radians); a glance toward each drop as it comes up (`lookToward`).

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
// Zero speed and acceleration at both ends (C2): for starting and stopping.
const smootherstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * t * (t * (6 * t - 15) + 10)
}
const mix = (a, b, t) => a + (b - a) * t
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const norm = (a) => scale(a, 1 / Math.hypot(...a))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mixDir = (a, b, t) => norm(add(scale(a, 1 - t), scale(b, t)))

// Turns a direction by small yaw (about world up) and pitch angles.
function turn(dir, yaw, pitch) {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x = dir[0] * cy + dir[2] * sy
  const z = -dir[0] * sy + dir[2] * cy
  const flat = Math.hypot(x, z)
  const p = Math.atan2(dir[1], flat) + pitch
  return [(x / flat) * Math.cos(p), Math.sin(p), (z / flat) * Math.cos(p)]
}

// Distance covered at time u ∈ [0, 1] of a quintic from rest-free start to rest: starts at speed v0
// (distance per unit u) with no acceleration, ends at `length` at rest with no acceleration.
function quinticToRest(u, v0, length) {
  // x(u) = v0 u + a u³ + b u⁴ + c u⁵, with x(1) = L, x'(1) = 0, x''(1) = 0.
  const a = 10 * length - 6 * v0
  const b = -15 * length + 8 * v0
  const c = 6 * length - 3 * v0
  return v0 * u + a * u ** 3 + b * u ** 4 + c * u ** 5
}

// from: { at, pos, look } (the top, at rest), start: { z } (where the height has settled to `y`),
// end: { at, pos, look } (the dive's approach), arrive: { at, pos, look } (inside the drop, at rest),
// passes: the moments the camera is slowest, one per drop, drops: { zOffset?, pass, around, lead },
// timing: { ease, sigma, rampIn, blendOut, approach }, curve(distance) → [dx, dy], fade: [in, out]
// (distance over which the bend comes and goes), gaze: { ahead, lookToward, sway, swayPeriod },
// step: key spacing in timeline units.
export function buildDrift({ from, start, end, arrive, y, passes, drops, timing, curve, fade, gaze, step = 0.02 }) {
  const z0 = from.pos[2]
  const zEnd = end.pos[2]
  // Fades are smootherstep, not smoothstep: the latter's curvature jumps at its ends, a jolt in the path.
  const bend = (z) => smootherstep(z0, z0 - fade[0], z) * (1 - smootherstep(zEnd + fade[1], zEnd, z))
  const centre = (z) => {
    const [dx, dy] = curve(z0 - z)
    const w = bend(z)
    const toEnd = smootherstep(zEnd + fade[1], zEnd, z)
    const baseY = mix(from.pos[1], y, smootherstep(z0, start.z, z))
    return [mix(from.pos[0], end.pos[0], toEnd) + w * dx, mix(baseY, end.pos[1], toEnd) + w * dy, z]
  }
  const frame = (z) => {
    const t = norm(sub(centre(z - 0.01), centre(z + 0.01))) // direction of travel
    const right = norm(cross(t, [0, 1, 0]))
    return { t, right, up: cross(right, t) }
  }

  // Speed (distance per unit of time) from the top to the approach: ramp × (cruise with dips, blended
  // into the approach speed). The cruise level is solved so the distance comes out exactly.
  const approachLength = zEnd - arrive.pos[2]
  const approachTime = arrive.at - end.at
  const vEnd = (timing.approach * approachLength) / approachTime // the quintic's start speed
  const dips = (t) => 1 - (1 - timing.ease) * passes.reduce((s, p) => s + Math.exp(-0.5 * ((t - p) / timing.sigma) ** 2), 0)
  const ramp = (t) => smootherstep(from.at, from.at + timing.rampIn, t)
  const out = (t) => smootherstep(end.at - timing.blendOut, end.at, t)
  const dt = 0.001
  const n = Math.round((end.at - from.at) / dt)
  let cruiseArea = 0
  let endArea = 0
  for (let i = 0; i < n; i++) {
    const t = from.at + (i + 0.5) * dt
    cruiseArea += ramp(t) * (1 - out(t)) * dips(t) * dt
    endArea += ramp(t) * out(t) * vEnd * dt
  }
  const cruise = (z0 - zEnd - endArea) / cruiseArea
  const zTable = new Float64Array(n + 1)
  zTable[0] = z0
  for (let i = 0; i < n; i++) {
    const t = from.at + (i + 0.5) * dt
    zTable[i + 1] = zTable[i] - ramp(t) * ((1 - out(t)) * cruise * dips(t) + out(t) * vEnd) * dt
  }
  const zAt = (t) => {
    const x = Math.min(Math.max((t - from.at) / dt, 0), n)
    const i = Math.min(Math.floor(x), n - 1)
    return zTable[i] + (zTable[i + 1] - zTable[i]) * (x - i)
  }

  const dropZ = passes.map((t) => zAt(t) - drops.lead)
  const dropPos = dropZ.map((z, i) => {
    const a = (drops.around[i % drops.around.length] * Math.PI) / 180
    const { right, up } = frame(z)
    return add(centre(z), add(scale(right, drops.pass * Math.cos(a)), scale(up, drops.pass * Math.sin(a))))
  })

  const keys = []
  const count = Math.round((arrive.at - from.at) / step)
  for (let k = 0; k <= count; k++) {
    const at = from.at + ((arrive.at - from.at) * k) / count
    if (at > end.at) {
      // Straight on into the drop, coming to rest.
      const u = (at - end.at) / approachTime
      const s = quinticToRest(u, vEnd * approachTime, approachLength) / approachLength
      keys.push({ at, pos: k === count ? arrive.pos : end.pos.map((v, j) => mix(v, arrive.pos[j], s)), look: arrive.look, sampled: true })
      continue
    }
    const z = zAt(at)
    const pos = centre(z)
    let dir = norm(sub(centre(z - gaze.ahead), pos))
    // A slow drift of the gaze of its own, faded in and out with the bend.
    const w = bend(z)
    const phase = (period, offset = 0) => Math.sin((2 * Math.PI * (at - from.at)) / period + offset)
    dir = turn(dir, w * gaze.sway[0] * phase(gaze.swayPeriod[0]), w * gaze.sway[1] * phase(gaze.swayPeriod[1], 1.3))
    // A glance toward each drop as it comes up, back ahead before it slides past.
    dropZ.forEach((dz, i) => {
      const before = z - dz
      const g = gaze.lookToward * smootherstep(3.5, 1.8, before) * smootherstep(0.25, 1.3, before)
      if (g > 0) dir = mixDir(dir, norm(sub(dropPos[i], pos)), g)
    })
    let look = add(pos, scale(dir, 3))
    // Hand over from the top's look and onto the dive's aim.
    look = look.map((v, j) => mix(from.look[j], v, smootherstep(from.at, from.at + 1, at)))
    look = look.map((v, j) => mix(v, end.look[j], smootherstep(end.at - 0.6, end.at, at)))
    keys.push({ at, pos: k === 0 ? from.pos : pos, look: k === 0 ? from.look : look, sampled: true })
  }
  return { keys, drops: dropPos }
}
