import gsap from 'gsap'
import { ALIGN, DIVE, SPLASH } from '../config.js'
import { quality, stepDownTier } from './quality.js'
import { state } from './state.js'
import { tierPath } from './tierPath.js'

// Live safety net (bible): if frames average over 20 ms for two seconds, drop one quality tier.
// Stalls longer than 250 ms (loading, tab switches) are ignored rather than counted, and after a
// drop the guard waits before judging again, so one hitch never cascades to the lowest tier.
// The drop waits (at most DEFER_MS) until the picture is between its moments, so the change (fewer
// drops, no bloom, a lower resolution; the first two fade rather than pop) does not land on a city,
// the dive, the word or the splash.
const BUDGET_MS = 20
const WINDOW_MS = 2000
const STALL_MS = 250
const COOLDOWN_MS = 4000
const DEFER_MS = 5000

// Timeline windows where a change would be seen: each drift drop's pass (as this tier times them), the
// dive, the word, the impact.
const MOMENTS = [
  [DIVE.inStart - 0.4, DIVE.outEnd],
  [ALIGN.arrive - 0.4, ALIGN.arrive + 0.2],
  [SPLASH.impactAt - 0.3, SPLASH.impactAt + 1.2],
]
const inMoment = (t) => MOMENTS.some(([a, b]) => t > a && t < b) || tierPath().passes.some((p) => t > p - 0.3 && t < p + 0.15)
let pending = null // ms the drop has waited, once one is due

let windowTime = 0
let windowFrames = 0
let cooldown = COOLDOWN_MS // also skips the first seconds after load, when shaders compile
const forced = new URLSearchParams(location.search).has('tier')

function tick(_time, deltaMs) {
  if (forced || document.hidden) return
  // The rain on the puddle is built for the look, not the budget (the user's call, 2026-09-30): from
  // the impact on, the ending is never judged, and it never costs the visitor a tier.
  if (state.time > SPLASH.impactAt - 0.3) {
    windowTime = 0
    windowFrames = 0
    return
  }
  if (pending !== null) {
    pending += Math.min(deltaMs, STALL_MS)
    if (inMoment(state.time) && pending < DEFER_MS) return
    const waited = pending
    pending = null
    const next = stepDownTier()
    if (next) console.info(`[quality] dropped to ${quality.name} (${(waited / 1000).toFixed(1)} s after it was due)`)
    cooldown = COOLDOWN_MS
    return
  }
  if (deltaMs > STALL_MS) return
  if (cooldown > 0) {
    cooldown -= deltaMs
    return
  }
  windowTime += deltaMs
  windowFrames++
  if (windowTime < WINDOW_MS) return
  const avg = windowTime / windowFrames
  windowTime = 0
  windowFrames = 0
  if (avg > BUDGET_MS) {
    console.info(`[quality] ${avg.toFixed(1)} ms/frame for ${WINDOW_MS / 1000}s: dropping a tier`)
    pending = 0
  }
}

export function startPerfGuard() {
  gsap.ticker.add(tick)
  return () => gsap.ticker.remove(tick)
}
