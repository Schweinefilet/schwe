import gsap from 'gsap'

// One frame loop for the whole site, in a fixed order:
//   1. the film travels toward its stop and moves the master timeline, which writes rig + uniforms
//      (core/film.js)
//   2. R3F renders the frame that reads them
// The Canvas runs with frameloop="never", so this is the only thing that renders.
let step = null
let advance = null
let frameHook = null // benchmark mode: (frameStart ms, cpu ms) after each frame

function tick(time, deltaMs) {
  const t0 = frameHook ? performance.now() : 0
  step?.(Math.min(deltaMs / 1000, 0.1))
  advance?.(time) // R3F expects seconds when frameloop="never"
  frameHook?.(t0, performance.now() - t0)
}

gsap.ticker.add(tick)
gsap.ticker.lagSmoothing(0)
import.meta.hot?.dispose(() => gsap.ticker.remove(tick))

export const setStep = (fn) => (step = fn)
export const setAdvance = (fn) => (advance = fn)
export const setFrameHook = (fn) => (frameHook = fn)
