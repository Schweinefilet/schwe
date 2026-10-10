import gsap from 'gsap'
import { ALIGN, DEFAULT_DIVE_CITY, DIVE, HERO, PACE, SPLASH, STOPS, TIMELINE_END, TIMELINE_START, heroDropsFor, visibleDrops } from '../config.js'
import { setStep } from './loop.js'
import { buildMasterTimeline } from './timeline.js'
import { tierPath } from './tierPath.js'
import { buildPaceTable, rateAt, smoothDamp } from './pace.js'
import { glide, hardBetween, nextStop, restingPoint, stopList } from './stops.js'
import { listen } from './gestures.js'
import { resetRig } from './rig.js'
import { globalUniforms, resetUniforms } from './uniforms.js'
import { state } from './state.js'
import { onTierChange, quality } from './quality.js'
import { liveCount } from '../content/videoManager.js'
import { MOTION } from '../ui/motion.js'

// The speed limit along the timeline (PACE in config.js): slower where the camera passes the drops
// this tier shows, along the path this tier flies. Going forward it is also kept down where a caption
// is read on the way and through the ending, which plays at its own pace; going back it is not (the
// ending in reverse at that pace was a quarter of a minute). Positions do not depend on which city is
// in which drop.
function paceTable(forward) {
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
    caps: forward ? [STOPS.reading, { from: ALIGN.arrive, to: TIMELINE_END, rate: STOPS.ending }] : [],
  })
}

// The stops for the tier now showing (STOPS in config.js).
const stopsNow = () => stopList([TIMELINE_START, STOPS.drops, ...tierPath().passes, STOPS.dive, { at: ALIGN.arrive, hard: true }, TIMELINE_END])

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

// How fast the picture settles into rest at a stop (state.rest, the camera's breathing) and leaves it.
const REST_IN = 1.6
const REST_OUT = 0.35
// `eps`: close enough to call it arrived (the picture, easing after it, hides the last step).
const GLIDE = { accel: STOPS.accel, tail: STOPS.tail, eps: 6e-4 }

// `onTop`: runs under the black when a cut lands at the top ("back to top", the Home key): the first
// shot's focus pull plays again.
export function initFilm({ onTop } = {}) {
  const tl = buildMasterTimeline()
  tl.time(TIMELINE_START) // the top is the rain beat, not the timeline's zero

  const tables = () => ({ [1]: paceTable(true), [-1]: paceTable(false) })
  let table = tables()
  // The limit at t for travel in direction dir.
  const limitAt = (t, dir) => rateAt(table[dir < 0 ? -1 : 1], t)
  let stops = stopsNow()
  // Where a hold runs to: the hard stops and the two ends.
  const limitsOf = (list) => list.filter((s, i) => s.hard || i === 0 || i === list.length - 1)
  let limits = limitsOf(stops)
  let flying = tierPath().path

  // `drive`: where the film is travelling. Its time moves toward `target` (a stop) or, while held
  // (`hold`: the direction), on toward `limit`, the next hard stop or an end, where it is `pinned` until
  // let go; null target and no hold is at rest. `script`: the bench's constant-speed pass, which nothing
  // interrupts. `pace`: the picture, easing after the drive under the same limit.
  const drive = { time: TIMELINE_START, velocity: 0, target: null, hold: 0, limit: null, pinned: false, locked: true, script: null }
  const pace = { time: TIMELINE_START, velocity: 0, arrived: null }
  Object.assign(state, { rest: 0, stop: TIMELINE_START, restSince: performance.now(), moves: 0 })

  const offTier = onTierChange(() => {
    table = tables()
    stops = stopsNow()
    limits = limitsOf(stops)
    // The camera rig reads tierPath() each frame, so from the next frame it flies the new timing: keep
    // the picture where it was, and the drive heading for the same place.
    const before = flying
    flying = tierPath().path
    const t = sameMoment(before, flying, pace.time)
    if (Math.abs(t - pace.time) > 1e-4) {
      pace.time = t
      // Heading for a stop: the new tier's stop at or after the same place, the way it was going.
      if (drive.target !== null) {
        const dir = Math.sign(drive.target - drive.time) || 1
        const at = sameMoment(before, flying, drive.target)
        drive.target = nextStop(stops, at - dir * 0.02, dir)?.at ?? at
      }
      drive.time = sameMoment(before, flying, drive.time)
      if (drive.hold && !drive.pinned) drive.limit = nextStop(limits, drive.time, drive.hold)?.at ?? drive.limit
      tl.time(t)
    }
  })

  const free = () => !drive.locked && !drive.script
  const settle = (at) => Object.assign(drive, { target: at, hold: 0, pinned: false })

  // On to the next stop, or back. During travel a step in the same direction aims one stop further (so
  // two quick taps pass a stop without resting), but no further, and never past a hard stop.
  const step = (dir) => {
    if (!free() || drive.hold) return
    state.moves++
    const heading = drive.target !== null ? Math.sign(drive.target - drive.time) : 0
    let base = drive.time
    if (heading === dir) {
      if (nextStop(stops, drive.time, dir)?.at !== drive.target) return // one stop is already skipped
      base = drive.target
    }
    let next = nextStop(stops, base, dir)
    if (!next) return
    next = hardBetween(stops, drive.time, next.at) ?? next
    settle(next.at)
  }

  const hold = (dir) => {
    if (!free()) return
    state.moves++
    const limit = nextStop(limits, drive.time, dir)
    if (!limit) return // already at that end
    Object.assign(drive, { hold: dir, target: null, limit: limit.at, pinned: false })
  }

  // Let go: come to rest at the first stop the glide can still settle on, ahead in the direction it
  // ran, at the latest the hard stop it was running toward (where it stays, if it got there).
  const release = () => {
    if (!drive.hold) return
    const dir = drive.hold
    if (drive.pinned) return settle(drive.time)
    const rp = restingPoint(drive.time, drive.velocity, STOPS.accel)
    const from = dir > 0 ? Math.max(rp, drive.time + 0.004) : Math.min(rp, drive.time - 0.004)
    const next = nextStop(stops, from - dir * 0.006, dir)
    settle(next && (next.at - drive.limit) * dir < 0 ? next.at : drive.limit)
  }

  // A jump to another moment: a cut through black (travelling there would take up to half a minute).
  // `after` runs there, under the black.
  const snap = (t) => {
    Object.assign(drive, { time: t, velocity: 0, target: null, hold: 0, pinned: false })
    Object.assign(pace, { time: t, velocity: 0 })
    tl.time(t)
  }
  const cut = (t, after) =>
    gsap.to('#fade', {
      opacity: 1,
      duration: MOTION.base,
      ease: MOTION.easeIn,
      overwrite: true,
      onComplete: () => {
        snap(t)
        after?.()
        gsap.to('#fade', { opacity: 0, duration: MOTION.slow, delay: 0.15, ease: MOTION.easeOut })
      },
    })
  const jump = (dir) => {
    const t = dir < 0 ? TIMELINE_START : TIMELINE_END
    if (Math.abs(pace.time - t) > 0.01) cut(t, dir < 0 ? onTop : null)
  }

  const offInput = listen({ step, hold, release, jump, enabled: free })

  setStep((dt) => {
    const now = performance.now()
    if (drive.script) {
      const s = drive.script
      const x = Math.min((now - s.start) / (s.seconds * 1000), 1)
      drive.time = s.from + (s.to - s.from) * x
      drive.velocity = 0
      if (x >= 1) {
        drive.script = null
        pace.arrived = { t: s.to, resolve: s.resolve }
      }
    } else if (drive.hold) {
      // Held: on toward the next hard stop (or the end) at the pace limit, and held there.
      if (!drive.pinned) [drive.time, drive.velocity] = glide(drive.time, drive.velocity, drive.limit, limitAt(drive.time, drive.hold), dt, GLIDE)
      if (drive.time === drive.limit && drive.velocity === 0) drive.pinned = true
    } else if (drive.target !== null) {
      ;[drive.time, drive.velocity] = glide(drive.time, drive.velocity, drive.target, limitAt(drive.time, drive.target - drive.time), dt, GLIDE)
      if (drive.time === drive.target && drive.velocity === 0) drive.target = null
    }

    if (drive.time !== pace.time || pace.velocity !== 0) {
      ;[pace.time, pace.velocity] = smoothDamp(pace.time, pace.velocity, drive.time, PACE.smooth, limitAt(pace.time, drive.time - pace.time), dt)
      tl.time(pace.time)
    }

    // At rest: settled on a stop (the camera breathes, CameraRig; the hint may come back, ScrollHint).
    const resting = drive.target === null && !drive.hold && !drive.script && Math.abs(pace.time - drive.time) < 1e-4
    if (resting && state.stop === null) {
      state.stop = pace.time
      state.restSince = now
    } else if (!resting) state.stop = null
    const k = resting ? dt / REST_IN : -dt / REST_OUT
    state.rest = Math.min(Math.max(state.rest + k, 0), 1)

    if (pace.arrived && Math.abs(pace.time - pace.arrived.t) < 0.002) {
      pace.arrived.resolve()
      pace.arrived = null
    }
  })

  // Dev hook for scripted checks (scripts/smoke.mjs, ui-crawl.mjs): __schwe.goto(units) jumps the
  // picture to a timeline time; step(±1) moves as a visitor's tap does; state, uniforms and the live
  // video count are readable.
  if (import.meta.env.DEV) {
    window.__schwe = Object.assign(window.__schwe ?? {}, {
      tl,
      state,
      quality,
      uniforms: globalUniforms,
      liveCount,
      pace,
      drive,
      splash: SPLASH,
      stops: () => stops.map((s) => s.at),
      step,
      driftPasses: () => tierPath().passes,
      goto: snap,
    })
  }

  return {
    labels: tl.labels,
    duration: () => tl.duration(),
    // Benchmark mode: travel to timeline time `t` at a constant speed; resolves when the picture (which
    // may lag behind at the pace limit) arrives there.
    playTo: (t, seconds) => new Promise((resolve) => (drive.script = { from: drive.time, to: t, start: performance.now(), seconds, resolve })),
    setLocked: (on) => {
      if (on) release()
      drive.locked = on
    },
    // "enter" only unlocks the film; it is already at the top, the rain.
    enter() {
      drive.locked = false
      // The loader's button had focus; the keys belong to the film now.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    },
    // The final screen's "back to top": a cut through black.
    toTop: () => cut(TIMELINE_START, onTop),
    destroy() {
      offInput()
      offTier()
      setStep(null)
      tl.kill()
      resetRig()
      resetUniforms()
      gsap.set('#fade', { opacity: 0 })
    },
  }
}
