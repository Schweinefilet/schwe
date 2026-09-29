import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { TIMELINE_END, TIMELINE_START } from '../config.js'
import { setLenis } from './loop.js'
import { buildMasterTimeline } from './timeline.js'
import { resetRig } from './rig.js'
import { globalUniforms, resetUniforms } from './uniforms.js'
import { state } from './state.js'
import { quality } from './quality.js'
import { liveCount } from '../content/videoManager.js'

gsap.registerPlugin(ScrollTrigger)

export function initScroll() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  // Mobile address bar show/hide should not re-measure every trigger.
  ScrollTrigger.config({ ignoreMobileResize: true })

  const lenis = new Lenis({ autoRaf: false })
  lenis.stop() // locked until "enter"
  const offScroll = lenis.on('scroll', ScrollTrigger.update)
  setLenis(lenis)

  const tl = buildMasterTimeline()
  tl.time(TIMELINE_START) // the top of the page is the rain beat, not the timeline's zero
  // The scroll covers TIMELINE_START → TIMELINE_END. scrub: true (no extra lag) because Lenis already
  // smooths the scroll.
  const st = ScrollTrigger.create({
    trigger: '#scroll-track',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    animation: tl.tweenFromTo(TIMELINE_START, TIMELINE_END, { paused: true, ease: 'none' }),
  })
  const timeToScroll = (t) => st.start + ((t - TIMELINE_START) / (TIMELINE_END - TIMELINE_START)) * (st.end - st.start)

  // Dev hook for scripted checks (scripts/smoke.mjs): __schwe.goto(units) jumps the scroll to a
  // timeline time; state, uniforms and the live video count are readable.
  if (import.meta.env.DEV) {
    window.__schwe = Object.assign(window.__schwe ?? {}, {
      lenis,
      tl,
      state,
      quality,
      uniforms: globalUniforms,
      liveCount,
      goto: (t) => lenis.scrollTo(timeToScroll(t), { immediate: true, force: true }),
    })
  }

  return {
    labels: tl.labels,
    duration: () => tl.duration(),
    // Benchmark mode: scroll to timeline time `t` at a constant speed; resolves when it arrives.
    scrollToTime: (t, seconds) =>
      new Promise((resolve) =>
        lenis.scrollTo(timeToScroll(t), { duration: seconds, easing: (x) => x, lock: true, force: true, onComplete: resolve })
      ),
    setLocked: (on) => (on ? lenis.stop() : lenis.start()),
    // "enter" only unlocks the scroll; the page is already at the top, the rain.
    enter() {
      lenis.start()
    },
    destroy() {
      offScroll()
      st.kill()
      tl.kill()
      setLenis(null)
      lenis.destroy()
      resetRig()
      resetUniforms()
      gsap.set('#fade', { opacity: 0 })
    },
  }
}
