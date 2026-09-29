import gsap from 'gsap'
import { DRIFT, FOCUS, TIMELINE_START } from '../config.js'
import { globalUniforms } from './uniforms.js'

// The first shot's focus pull (FOCUS in config.js). `pull` is real-time: it drops to 0 on "enter"
// (while the loader is still opaque) and eases back to 1. Scrolling from the top toward the drift pulls
// focus too, so whichever is further along wins. Pages without "enter" (the drop lab) stay at 1.
const run = { pull: 1 }

// Dev hook for review stills: __schwe.holdFocus(0.3) stops the pull there.
if (import.meta.env.DEV) {
  window.__schwe = Object.assign(window.__schwe ?? {}, {
    holdFocus: (v) => {
      gsap.killTweensOf(run)
      run.pull = v
    },
  })
}

export function startFocusPull() {
  run.pull = 0
  gsap.to(run, { pull: 1, delay: FOCUS.delay, duration: FOCUS.seconds, ease: 'sine.inOut', overwrite: true })
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Once a frame, before anything draws (FrameDriver).
export function updateFocus(time) {
  globalUniforms.uFocus.value = Math.max(run.pull, smoothstep(TIMELINE_START, DRIFT.start, time))
}
