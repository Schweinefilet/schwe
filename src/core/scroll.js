import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ALIGN, DEFAULT_DIVE_CITY, DIVE, HERO, PACE, SNAP, SPLASH, TIMELINE_END, TIMELINE_START, heroDropsFor, visibleDrops } from '../config.js'
import { setLenis, setStep } from './loop.js'
import { buildMasterTimeline } from './timeline.js'
import { tierPath } from './tierPath.js'
import { buildPaceTable, rateAt, smoothDamp } from './pace.js'
import { landing } from './snap.js'
import { resetRig } from './rig.js'
import { globalUniforms, resetUniforms } from './uniforms.js'
import { state } from './state.js'
import { onTierChange, quality } from './quality.js'
import { liveCount } from '../content/videoManager.js'
import { MOTION } from '../ui/motion.js'

gsap.registerPlugin(ScrollTrigger)

// The ending's own scroll: linear, easing out over the last 15% (value and slope match where they meet).
const EASE_FROM = 0.85
const EASE_K = 1 / (1 - EASE_FROM * EASE_FROM)
const endingEase = (x) => (x <= EASE_FROM ? 2 * EASE_K * (1 - EASE_FROM) * x : 1 - EASE_K * (1 - x) ** 2)

// The speed limit along the timeline (PACE in config.js): slower where the camera passes the drops
// this tier shows, along the path this tier flies. Positions do not depend on which city is in which drop.
function paceTable() {
  const { path } = tierPath()
  const out = { pos: null, look: null }
  // The dive drop slows the camera until it starts pulling out: its city has been named by then, and
  // leaving it at a city drop's pace was dead time before the word.
  const drops = visibleDrops(heroDropsFor(DEFAULT_DIVE_CITY), quality.heroDrops).map((d) => (d.dive ? { pos: d.pos, until: DIVE.outStart } : d.pos))
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
    // The word: slowing almost to a stop as it forms (and held at the eye, below).
    holds: [{ from: ALIGN.hold.from, at: ALIGN.arrive, rate: ALIGN.hold.rate }],
  })
}

// Where a swift scroll may come to rest (SNAP in config.js): the slow point of each drift drop this tier
// shows (as this tier's camera times them), and inside the dive drop.
function landingPoints() {
  return [...tierPath().passes.map((at) => ({ at, capture: SNAP.capture })), SNAP.dive]
}

// Where the drift's camera is on `path` at time t (its distance along the line, which only ever falls),
// and the time another path is there: a tier that drops mid-drift flies another timing of the same
// path, so the picture moves to the same place on it rather than jumping.
const DRIFT_UNTIL = 9.4 // the camera comes to rest inside the dive drop (config.js driftFor)
const _at = { pos: null, look: null }
function sameMoment(from, to, t) {
  if (t <= TIMELINE_START || t >= DRIFT_UNTIL) return t
  const z = from.sample(t, _at).pos[2]
  let lo = TIMELINE_START
  let hi = DRIFT_UNTIL
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (to.sample(mid, _at).pos[2] > z) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// `onTop`: runs under the black when a cut lands at the top ("back to top", the Home key): the first
// shot's focus pull plays again.
export function initScroll({ onTop } = {}) {
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
  let points = landingPoints()
  let flying = tierPath().path
  const offTier = onTierChange(() => {
    table = paceTable()
    points = landingPoints()
    // The camera rig reads tierPath() each frame, so from the next frame it flies the new timing: keep
    // the picture where it was, and the scroll as far ahead of it as it was.
    const before = flying
    flying = tierPath().path
    const t = sameMoment(before, flying, pace.time)
    if (Math.abs(t - pace.time) > 1e-4 && !lenis.isStopped) {
      const ahead = pace.lastTarget - pace.time
      pace.time = t
      tl.time(t)
      lenis.scrollTo(timeToScroll(t + ahead), { immediate: true, force: true })
      pace.lastTarget = t + ahead
    }
  })
  const pace = { time: TIMELINE_START, velocity: 0, arrived: null, lastTarget: TIMELINE_START, ending: false }
  // The visitor's current gesture: when its last input came, how far the scroll ran ahead of the picture
  // at most, whether its landing has been decided, and the time the scroll stood for when it began.
  const gesture = { at: 0, lead: 0, landed: true, movedAt: 0, lastScroll: 0, from: TIMELINE_START }
  // The word's hold (ALIGN.hold): reaching the eye going forward, the picture holds on the word until
  // the visitor, after a rest, scrolls on by ALIGN.hold.push. Armed again once the picture is back
  // before the word, or after a jump that lands before it.
  const word = { armed: true, holding: false, since: 0, push: 0 }
  state.word = word // read by the scroll hint, which comes back during the hold (ui/ScrollHint.jsx)
  // Let go (the visitor scrolled on): the ending plays itself from the word, as it does once the picture
  // passes SPLASH.autoFrom. (Left to the scroll, a push that let go ran out just short of it.)
  const goOn = () => {
    word.holding = false
    word.armed = false
    if (!lenis.isStopped && !lenis.isLocked && !resize) playEnding(pace.time)
  }
  // Forward input while held: counted toward letting go once the rest is over.
  const pushWord = (units) => {
    if (performance.now() - word.since < ALIGN.hold.dwell * 1000) return
    word.push += units
    if (word.push >= ALIGN.hold.push) goOn()
  }
  const snap = (t) => {
    pace.time = pace.lastTarget = t
    pace.velocity = 0
    pace.ending = false // a jump interrupts the ending's own scroll (and Lenis drops its lock)
    gesture.landed = true
    word.holding = false
    word.armed = t < ALIGN.arrive
    tl.time(t)
  }

  // Once the picture passes SPLASH.autoFrom going down, the ending plays itself: the page scrolls to the
  // end at SPLASH.autoRate and holds there. Only for a visitor's own scroll: not while the scroll is
  // stopped (the loader, the bench) or already locked by another programmatic scroll. It starts from the
  // picture, not from the scroll, which a touch fling can carry screens ahead of it: the scroll is
  // brought back to the picture first, so the word is always seen before the ending takes over.
  // Scrolling up takes over again at once (stopEnding); scrolling down while it plays is ignored.
  const playEnding = (from) => {
    pace.ending = true
    lenis.scrollTo(timeToScroll(from), { immediate: true, force: true })
    lenis.scrollTo(timeToScroll(TIMELINE_END), {
      duration: Math.max((TIMELINE_END - from) / SPLASH.autoRate, 0.5),
      easing: endingEase,
      lock: true,
      force: true,
      onComplete: () => (pace.ending = false),
    })
  }
  const stopEnding = () => {
    if (!pace.ending) return
    pace.ending = false
    lenis.reset() // stops the scroll where it is and unlocks it
  }

  // A hard wheel or trackpad flick runs at most PACE.bank ahead of the picture; the rest is dropped, so
  // the camera stops soon after the hand does. (Touch scrolling is native, momentum included; it only
  // meets the speed limit.)
  const lenis = new Lenis({
    autoRaf: false,
    virtualScroll(data) {
      // Scrolling up while the ending plays itself hands the scroll back to the visitor.
      if (pace.ending && data.deltaY < 0) stopEnding()
      // Every input counts toward the gesture, even input refused below.
      gesture.at = performance.now()
      if (gesture.landed) gesture.from = scrollToTime(lenis.scroll)
      gesture.landed = false
      // Held on the word: forward input (wheel or touch) moves nothing and only counts toward letting go.
      // Upward input scrolls as usual.
      if (word.holding && data.deltaY > 0) {
        pushWord((data.deltaY * span) / (st.end - st.start || 1))
        if (data.event.cancelable) data.event.preventDefault()
        return false
      }
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

  // Once a gesture has been quiet SNAP.idle ms (and a native touch fling has stopped), a swift one's
  // scroll is moved to its landing point at once. Nothing on the page moves with it (the scene is a
  // fixed canvas); the picture, which lags the scroll and is still gliding, simply comes to rest on the
  // point, without stopping and starting again or turning back. Any new input takes over at once.
  const land = (now) => {
    if (lenis.scroll !== gesture.lastScroll) {
      gesture.lastScroll = lenis.scroll
      gesture.movedAt = now
    }
    if (gesture.landed) return
    const target = scrollToTime(lenis.targetScroll) // where the scroll will come to rest
    gesture.lead = Math.max(gesture.lead, Math.abs(target - pace.time))
    const quiet = now - gesture.at > SNAP.idle && (lenis.isScrolling !== 'native' || now - gesture.movedAt > SNAP.idle)
    if (!quiet) return
    const swift = gesture.lead >= SNAP.swift
    gesture.landed = true
    gesture.lead = 0
    if (!swift || lenis.isStopped || lenis.isLocked || pace.ending) return
    const at = landing({ picture: pace.time, target, points, from: gesture.from })
    if (at !== null && Math.abs(at - target) > 0.002) lenis.scrollTo(timeToScroll(at), { immediate: true })
  }

  // A resize changes the page's height (the track is measured in viewport heights) but not the scroll
  // offset in pixels, so the same offset would stand for another moment of the film. On a real resize
  // (not a phone's address bar coming and going) the moment is kept: the picture holds on it while the
  // layout settles, then the scroll is moved to where that moment now is.
  let resize = null // { time, ending, timer }
  let lastSize = [innerWidth, innerHeight]
  const onResize = () => {
    const size = [innerWidth, innerHeight]
    if (size[0] === lastSize[0] && Math.abs(size[1] - lastSize[1]) < 160) return
    lastSize = size
    if (!resize) resize = { time: pace.lastTarget, ending: pace.ending }
    clearTimeout(resize.timer)
    resize.timer = setTimeout(() => {
      const { time, ending } = resize
      resize = null
      ScrollTrigger.refresh()
      lenis.resize()
      lenis.scrollTo(timeToScroll(time), { immediate: true, force: true })
      pace.lastTarget = time
      if (ending) playEnding(time)
    }, 250)
  }
  addEventListener('resize', onResize)

  setStep((dt) => {
    const now = performance.now()
    land(now)
    let target = resize ? resize.time : scrollToTime(lenis.scroll)
    if (word.holding) {
      // A scroll carried a screen past the word by other means (the scrollbar, a fling already under
      // way) lets go after the rest: nobody is kept there against their will.
      if (target > ALIGN.arrive + 1 && now - word.since > ALIGN.hold.dwell * 1000) goOn()
      else target = Math.min(target, ALIGN.arrive)
    }
    pace.lastTarget = target
    const before = pace.time
    if (target !== pace.time || pace.velocity !== 0) {
      ;[pace.time, pace.velocity] = smoothDamp(pace.time, pace.velocity, target, PACE.smooth, rateAt(table, pace.time), dt)
      tl.time(pace.time)
    }
    // Reaching the word going forward: hold there, and bring the scroll back onto it (the rest of the
    // gesture's momentum would run on past it). Not while the page scrolls itself (the bench).
    if (word.armed && !word.holding && before < ALIGN.arrive && pace.time >= ALIGN.arrive && !pace.ending && !resize && !lenis.isStopped && !lenis.isLocked) {
      pace.time = ALIGN.arrive
      pace.velocity = 0
      tl.time(pace.time)
      Object.assign(word, { holding: true, since: now, push: 0 })
      gesture.landed = true
      if (scrollToTime(lenis.targetScroll) > ALIGN.arrive) lenis.scrollTo(timeToScroll(ALIGN.arrive), { immediate: true, force: true })
    }
    if (pace.time < ALIGN.hold.from) {
      word.armed = true
      word.holding = false
    }
    const crossed = before < SPLASH.autoFrom && pace.time >= SPLASH.autoFrom
    if (crossed && !pace.ending && !resize && !lenis.isStopped && !lenis.isLocked) playEnding(pace.time)
    if (pace.arrived && Math.abs(pace.time - pace.arrived.t) < 0.002) {
      pace.arrived.resolve()
      pace.arrived = null
    }
  })

  // A jump to another moment of the film: a cut through black, since the picture following the scroll
  // at the pace limit would take up to half a minute. `after` runs there, under the black.
  const cut = (t, after) =>
    gsap.to('#fade', {
      opacity: 1,
      duration: MOTION.base,
      ease: MOTION.easeIn,
      overwrite: true,
      onComplete: () => {
        lenis.scrollTo(timeToScroll(t), { immediate: true, force: true })
        snap(t)
        after?.()
        gsap.to('#fade', { opacity: 0, duration: MOTION.slow, delay: 0.15, ease: MOTION.easeOut })
      },
    })

  // Keys scroll the page natively, and Lenis follows. Home and End are cuts to the top and to the last
  // frame, like "back to top"; any key that scrolls up takes over from the ending as it plays itself.
  const onKey = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || lenis.isStopped) return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) stopEnding()
    // Held on the word, keys that scroll down count toward letting go (a page as much as the whole push,
    // an arrow a third of it), and scroll nothing themselves.
    const forward = { ArrowDown: ALIGN.hold.push / 3, PageDown: ALIGN.hold.push, ' ': e.shiftKey ? 0 : ALIGN.hold.push }[e.key]
    if (word.holding && forward) {
      e.preventDefault()
      pushWord(forward)
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const t = e.key === 'Home' ? TIMELINE_START : TIMELINE_END
      if (Math.abs(pace.time - t) > 0.01) cut(t, e.key === 'Home' ? onTop : null)
    }
  }
  addEventListener('keydown', onKey)

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
      word,
      splash: SPLASH,
      driftPasses: () => tierPath().passes,
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
    // would take half a minute).
    toTop: () => cut(TIMELINE_START, onTop),
    destroy() {
      removeEventListener('resize', onResize)
      removeEventListener('keydown', onKey)
      clearTimeout(resize?.timer)
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
