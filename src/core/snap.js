// Soft landings: where a swift scroll should come to rest (SNAP in config.js). Pure; scroll.js asks it
// once a gesture has gone quiet, while the picture, which lags the scroll, is still gliding.
//
// The landing is the point nearest to where the scroll would stop (`target`), among those ahead of the
// picture in the direction it is moving and within that point's `capture` of the target. Never one
// behind the picture, so it never turns back; null when none qualifies (it rests where it stops).
// `from`: where the scroll stood when the gesture began. A point must lie ahead of that too, so a
// gesture can always leave the point the last one landed on: on touch the scroll runs well ahead of
// the picture, and a point still ahead of the picture would otherwise pull every new swipe back to it.
// `margin`: a point the picture (or the scroll) is practically on already does not count as ahead.
export function landing({ picture, target, points, from = picture, margin = 0.02 }) {
  const dir = Math.sign(target - picture)
  if (!dir) return null
  let best = null
  for (const p of points) {
    if ((p.at - picture) * dir <= margin || (p.at - from) * dir <= margin) continue
    const off = Math.abs(p.at - target)
    if (off > p.capture) continue
    if (best === null || off < Math.abs(best - target)) best = p.at
  }
  return best
}
