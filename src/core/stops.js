// Stops: the moments the film rests on (STOPS in config.js). Pure functions (tested); film.js runs them
// once a frame.
//
// The visitor never scrubs the timeline. A click, a tap, a flick of the wheel, a swipe or a key moves
// to the next stop (or back to the one before), and the film travels there at its own pace: it starts
// from rest, keeps under the pace limit (core/pace.js), and settles onto the stop. Holding lets time
// run on through the stops; letting go comes to rest at the next one ahead.

// Sorted, without near-duplicates. Each entry is { at, hard }: a hard stop is never run or stepped
// past without resting on it first (the word, easy to miss).
export function stopList(entries, eps = 0.01) {
  const sorted = entries.map((e) => (typeof e === 'number' ? { at: e, hard: false } : { hard: false, ...e })).sort((a, b) => a.at - b.at)
  const out = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.at - last.at < eps) last.hard ||= s.hard
    else out.push({ ...s })
  }
  return out
}

// The first stop beyond t in direction dir (±1), more than `margin` from it; null at either end.
export function nextStop(stops, t, dir, margin = 0.005) {
  if (dir > 0) return stops.find((s) => s.at > t + margin) ?? null
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i].at < t - margin) return stops[i]
  return null
}

// The first hard stop strictly between a and b (either order), or null.
export function hardBetween(stops, a, b, margin = 0.005) {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const inside = stops.filter((s) => s.hard && s.at > lo + margin && s.at < hi - margin)
  if (!inside.length) return null
  return a < b ? inside[0] : inside[inside.length - 1]
}

// Where a glide at `velocity` would come to rest braking at `accel` (no tail): for choosing a stop it
// can still settle on without braking harder.
export const restingPoint = (time, velocity, accel) => time + (Math.sign(velocity) * velocity * velocity) / (2 * accel)

// One frame of travel toward `target` (timeline units). The speed rises at no more than `accel`
// (units/s²), stays under `rate` (the pace limit where the picture is), and falls ahead of the target
// so it brakes at `accel` and, over the last stretch, settles exponentially (time constant `tail` s)
// rather than stopping dead. Moving away from the target (a change of mind), it slows at `accel` and
// turns back. Returns [time, velocity].
export function glide(time, velocity, target, rate, dt, { accel, tail, eps = 1e-4 }) {
  const d = target - time
  const dist = Math.abs(d)
  if (dist < eps && Math.abs(velocity) <= eps / tail + accel * dt) return [target, 0]
  const dir = Math.sign(d) || 1
  const allowed = Math.min(rate, Math.sqrt(2 * accel * dist), dist / tail)
  let speed = velocity * dir // along the way to the target; negative while still moving away
  speed = speed < allowed ? Math.min(allowed, speed + accel * dt) : allowed
  const out = time + dir * speed * dt
  if ((target - out) * dir < 0) return [target, 0] // never past it
  return [out, dir * speed]
}
