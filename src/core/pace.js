// Scroll pacing: how fast the picture may follow the scroll. Pure functions (tested); scroll.js runs
// them once a frame.
//
// The timeline's time chases the time the scroll position stands for, like a critically damped spring
// (smoothDamp), with a speed limit that depends on where the camera is: lower while a city drop is
// near. The limit table brakes ahead of each slow stretch, so the camera never has to slow abruptly.

// Unity's SmoothDamp (Game Programming Gems 4, 1.10): eases `current` toward `target` over about
// `smoothTime` seconds without overshooting, never faster than `maxSpeed`. Returns [position, velocity].
export function smoothDamp(current, velocity, target, smoothTime, maxSpeed, dt) {
  const omega = 2 / smoothTime
  const x = omega * dt
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const maxChange = maxSpeed * smoothTime
  const change = Math.min(Math.max(current - target, -maxChange), maxChange)
  const goal = current - change
  const temp = (velocity + omega * change) * dt
  let v = (velocity - omega * temp) * decay
  let out = goal + (change + temp) * decay
  // Never past the real target.
  if (target - current > 0 === out > target) {
    out = target
    v = 0
  }
  return [out, v]
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Speed limit (timeline units per second) every `step` units from `from` to `to`.
//   cameraAt(t): the camera's position [x, y, z] at timeline time t
//   drops: positions of the city drops on screen
//   near: [full, none], camera distance within which a drop's pace applies in full, and beyond which
//     not at all (the distances at which its city shows)
//   max, nearDrop: the limit away from drops and at them
//   brake: the most the limit may fall per second of travel at it (units/s²), in either direction
export function buildPaceTable(cameraAt, drops, { from, to, step = 0.01, near, max, nearDrop, brake }) {
  const n = Math.round((to - from) / step) + 1
  const rate = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = cameraAt(from + i * step)
    let closest = Infinity
    for (const d of drops) closest = Math.min(closest, Math.hypot(p[0] - d[0], p[1] - d[1], p[2] - d[2]))
    rate[i] = max + (nearDrop - max) * (1 - smoothstep(near[0], near[1], closest))
  }
  // A speed v can come down to u within (v² − u²) / 2·brake: cap each entry by what its neighbours
  // allow, forward (for scrolling down) and backward (for scrolling up).
  for (let i = n - 2; i >= 0; i--) rate[i] = Math.min(rate[i], Math.sqrt(rate[i + 1] ** 2 + 2 * brake * step))
  for (let i = 1; i < n; i++) rate[i] = Math.min(rate[i], Math.sqrt(rate[i - 1] ** 2 + 2 * brake * step))
  return { from, step, rate }
}

export function rateAt({ from, step, rate }, t) {
  const x = Math.min(Math.max((t - from) / step, 0), rate.length - 1)
  const i = Math.min(Math.floor(x), rate.length - 2)
  return rate[i] + (rate[i + 1] - rate[i]) * (x - i)
}
