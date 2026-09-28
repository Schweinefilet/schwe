import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ENTER_SCROLL_SECONDS } from '../config.js'
import { setLenis } from './loop.js'
import { buildMasterTimeline } from './timeline.js'
import { resetRig } from './rig.js'
import { resetUniforms } from './uniforms.js'

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
