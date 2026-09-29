import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { CAMERA_KEYS, DEFAULT_DIVE_CITY, HERO, PACE, SPLASH, TIMELINE_END, TIMELINE_START, heroDropsFor, visibleDrops } from '../config.js'
import { setLenis, setStep } from './loop.js'
import { buildMasterTimeline } from './timeline.js'
import { createCameraPath } from './cameraPath.js'
import { buildPaceTable, rateAt, smoothDamp } from './pace.js'
import { resetRig } from './rig.js'
import { globalUniforms, resetUniforms } from './uniforms.js'
import { state } from './state.js'
import { onTierChange, quality } from './quality.js'
import { liveCount } from '../content/videoManager.js'

gsap.registerPlugin(ScrollTrigger)

// The ending's own scroll: linear, easing out over the last 15% (value and slope match where they meet).
const EASE_FROM = 0.85
const EASE_K = 1 / (1 - EASE_FROM * EASE_FROM)
const endingEase = (x) => (x <= EASE_FROM ? 2 * EASE_K * (1 - EASE_FROM) * x : 1 - EASE_K * (1 - x) ** 2)

// The speed limit along the timeline (PACE in config.js): slower where the camera passes the drops
// this tier shows. Positions do not depend on which city is in which drop.
function paceTable() {
  const path = createCameraPath(CAMERA_KEYS)
  const out = { pos: null, look: null }
  const drops = visibleDrops(heroDropsFor(DEFAULT_DIVE_CITY), quality.heroDrops).map((d) => d.pos)
  const view = (t) => {
    path.sample(t, out)
    const d = out.look.map((v, i) => v - out.pos[i])
    const l = Math.hypot(...d)
    return d.map((v) => v / l)
  }
  // Radians the view turns per unit of timeline time at t.
  const turnAt = (t) => {
    const a = view(t - 0.005)
    const b = view(t + 0.005)
    return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / 0.01
  }
  return buildPaceTable((t) => path.sample(t, out).pos, drops, {
    from: TIMELINE_START,
    to: TIMELINE_END,
    near: HERO.near,
    max: PACE.max,
    nearDrop: PACE.nearDrop,
    brake: PACE.brake,
    turnAt,
    maxTurn: (PACE.maxTurn * Math.PI) / 180,
    turnWindow: PACE.turnWindow,
    round: PACE.round,
  })
}

export function initScroll() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  // Mobile address bar show/hide should not re-measure every trigger.
  ScrollTrigger.config({ ignoreMobileResize: true })

  const tl = buildMasterTimeline()
  tl.time(TIMELINE_START) // the top of the page is the rain beat, not the timeline's zero
  // The scroll covers TIMELINE_START → TIMELINE_END; the trigger only measures where that is on the page.
  const st = ScrollTrigger.create({ trigger: '#scroll-track', start: 'top top', end: 'bottom bottom' })
  const span = TIMELINE_END - TIMELINE_START
  const timeToScroll = (t) => st.start + ((t - TIMELINE_START) / span) * (st.end - st.start)
  const scrollToTime = (y) => TIMELINE_START + Math.min(Math.max((y - st.start) / (st.end - st.start || 1), 0), 1) * span

  // The picture follows the scroll at a limited pace (core/pace.js): the timeline's time chases the time
  // the scroll position stands for. Scroll stays the one source of truth; only the rate is time-based.
  let table = paceTable()
  const offTier = onTierChange(() => (table = paceTable()))
  const pace = { time: TIMELINE_START, velocity: 0, arrived: null, lastTarget: TIMELINE_START, ending: false }
  const snap = (t) => {
    pace.time = pace.lastTarget = t
    pace.velocity = 0
    pace.ending = false // a jump interrupts the ending's own scroll (and Lenis drops its lock)
    tl.time(t)
  }

  // Past SPLASH.autoFrom the ending plays itself: the page scrolls to the end at SPLASH.autoRate,
  // locked, and holds there. Only for a visitor's own scroll: not while the scroll is stopped (the
  // loader, the bench) or already locked by another programmatic scroll.
  const playEnding = (from) => {
    pace.ending = true
    lenis.scrollTo(timeToScroll(TIMELINE_END), {
      duration: Math.max((TIMELINE_END - from) / SPLASH.autoRate, 0.5),
      easing: endingEase,
      lock: true,
      force: true,
      onComplete: () => (pace.ending = false),
    })
  }

  // A hard wheel or trackpad flick runs at most PACE.bank ahead of the picture; the rest is dropped, so
  // the camera stops soon after the hand does. (Touch scrolling is native, momentum included; it only
  // meets the speed limit.)
  const lenis = new Lenis({
    autoRaf: false,
    virtualScroll(data) {
      if (!data.event.type.includes('wheel') || !data.deltaY) return true
      const ahead = scrollToTime(lenis.targetScroll + data.deltaY) - pace.time
      if (Math.abs(ahead) <= PACE.bank) return true
      const edge = timeToScroll(pace.time + Math.sign(ahead) * PACE.bank) - lenis.targetScroll
      if (Math.sign(edge) === Math.sign(data.deltaY)) {
        data.deltaY = edge
        return true
      }
      // Nothing of this one is allowed; cancel it here, or the browser would scroll natively.
      if (data.event.cancelable) data.event.preventDefault()
      return false
    },
  })
  lenis.stop() // locked until "enter"
  const offScroll = lenis.on('scroll', ScrollTrigger.update)
  setLenis(lenis)

  setStep((dt) => {
    const target = scrollToTime(lenis.scroll)
    const crossed = pace.lastTarget < SPLASH.autoFrom && target >= SPLASH.autoFrom
    pace.lastTarget = target
    if (crossed && !pace.ending && !lenis.isStopped && !lenis.isLocked) playEnding(target)
    if (target !== pace.time || pace.velocity !== 0) {
      ;[pace.time, pace.velocity] = smoothDamp(pace.time, pace.velocity, target, PACE.smooth, rateAt(table, pace.time), dt)
      tl.time(pace.time)
    }
    if (pace.arrived && Math.abs(pace.time - pace.arrived.t) < 0.002) {
      pace.arrived.resolve()
      pace.arrived = null
    }
  })

  // Dev hook for scripted checks (scripts/smoke.mjs): __schwe.goto(units) jumps the scroll and the
  // picture to a timeline time; state, uniforms and the live video count are readable.
  if (import.meta.env.DEV) {
    window.__schwe = Object.assign(window.__schwe ?? {}, {
      lenis,
      tl,
      state,
      quality,
      uniforms: globalUniforms,
      liveCount,
      pace,
      goto: (t) => {
        lenis.scrollTo(timeToScroll(t), { immediate: true, force: true })
        snap(scrollToTime(lenis.scroll))
      },
    })
  }

  return {
    labels: tl.labels,
    duration: () => tl.duration(),
    // Benchmark mode: scroll to timeline time `t` at a constant speed; resolves when the picture (which
    // may lag behind the scroll at the pace limit) arrives there.
    scrollToTime: (t, seconds) =>
      new Promise((resolve) =>
        lenis.scrollTo(timeToScroll(t), {
          duration: seconds,
          easing: (x) => x,
          lock: true,
          force: true,
          onComplete: () => (pace.arrived = { t, resolve }),
        })
      ),
    setLocked: (on) => (on ? lenis.stop() : lenis.start()),
    // "enter" only unlocks the scroll; the page is already at the top, the rain.
    enter() {
      lenis.start()
    },
    // The final screen's "back to top": a cut through black (the film scrolled back at the pace limit
    // would take half a minute). `onTop` runs at the top, under the black.
    toTop(onTop) {
      gsap.to('#fade', {
        opacity: 1,
        duration: 0.6,
        ease: 'power1.in',
        overwrite: true,
        onComplete: () => {
          lenis.scrollTo(0, { immediate: true, force: true })
          snap(TIMELINE_START)
          onTop?.()
          gsap.to('#fade', { opacity: 0, duration: 1, delay: 0.15, ease: 'power1.out' })
        },
      })
    },
    destroy() {
      offScroll()
      offTier()
      setStep(null)
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
