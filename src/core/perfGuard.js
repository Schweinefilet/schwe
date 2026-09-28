import gsap from 'gsap'
import { quality, stepDownTier } from './quality.js'

// Live safety net (bible): if frames average over 20 ms for two seconds, drop one quality tier.
// Stalls longer than 250 ms (loading, tab switches) are ignored rather than counted, and after a
// drop the guard waits before judging again, so one hitch never cascades to the lowest tier.
const BUDGET_MS = 20
const WINDOW_MS = 2000
const STALL_MS = 250
const COOLDOWN_MS = 4000

let windowTime = 0
let windowFrames = 0
let cooldown = COOLDOWN_MS // also skips the first seconds after load, when shaders compile
const forced = new URLSearchParams(location.search).has('tier')

function tick(_time, deltaMs) {
  if (forced || document.hidden) return
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
    const next = stepDownTier()
    if (next) console.info(`[quality] ${avg.toFixed(1)} ms/frame for ${WINDOW_MS / 1000}s: dropped to ${quality.name}`)
    cooldown = COOLDOWN_MS
  }
}

export function startPerfGuard() {
  gsap.ticker.add(tick)
  return () => gsap.ticker.remove(tick)
}
