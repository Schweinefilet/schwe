import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ENTER_SCROLL_SECONDS } from '../config.js'
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
  // scrub: true (no extra lag) because Lenis already smooths the scroll.
  const st = ScrollTrigger.create({
    trigger: '#scroll-track',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    animation: tl,
  })

  // Dev hook for scripted checks (scripts/smoke.mjs): __schwe.goto(units) jumps the scroll to a
  // timeline time; state, uniforms and the live video count are readable.
  if (import.meta.env.DEV) {
    window.__schwe = {
      lenis,
      tl,
      state,
      quality,
      uniforms: globalUniforms,
      liveCount,
      goto: (t) => lenis.scrollTo(st.start + (t / tl.duration()) * (st.end - st.start), { immediate: true, force: true }),
    }
  }

  return {
    enter() {
      lenis.start()
      lenis.scrollTo(st.labelToScroll('rain'), { duration: ENTER_SCROLL_SECONDS, lock: true })
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
