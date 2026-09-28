import gsap from 'gsap'

// One frame loop for the whole site, in a fixed order:
//   1. Lenis updates scroll → ScrollTrigger → master timeline writes rig + uniforms
//   2. R3F renders the frame that reads them
// The Canvas runs with frameloop="never", so this is the only thing that renders.
let lenis = null
let advance = null

function tick(time) {
  lenis?.raf(time * 1000)
  advance?.(time) // R3F expects seconds when frameloop="never"
}

gsap.ticker.add(tick)
gsap.ticker.lagSmoothing(0)
import.meta.hot?.dispose(() => gsap.ticker.remove(tick))

export const setLenis = (l) => (lenis = l)
export const setAdvance = (fn) => (advance = fn)
