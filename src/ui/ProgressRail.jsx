import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ALIGN, DIVE, DRIFT_PASSES, SPLASH, TIMELINE_END, TIMELINE_START } from '../config.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'

// The rail runs from the top to the answer (the rest of the film plays itself), with a soft tick at
// each part of it on the way: the first city, the dive, the word.
const END = SPLASH.answerAt
const TICKS = [DRIFT_PASSES[0], (DIVE.inEnd + DIVE.outStart) / 2, ALIGN.arrive]
const at = (t) => Math.min(Math.max((t - TIMELINE_START) / (END - TIMELINE_START), 0), 1)

// The way through, on the right edge: a thin line that fills as the page is scrolled, a drop at its
// head, a tick at each part of the film that brightens once passed. Full as the answer comes in. Shown from "enter" until the
// answer. Set on the shared ticker, so it never re-renders React.
export default function ProgressRail() {
  const ref = useRef()
  const fill = useRef()
  const drop = useRef()

  useEffect(() => {
    const el = ref.current
    const ticks = [...el.querySelectorAll('.progress-rail__tick')]
    let shown = false
    let last = -1
    const update = () => {
      // Gone again as the answer comes in (EndType.jsx): the ending is a title card, and the rest of the
      // film plays itself from there.
      const show = state.unlocked && rig.endType < 0.02 && state.time < TIMELINE_END - 0.02
      if (show !== shown) {
        shown = show
        el.classList.toggle('is-shown', show)
      }
      const p = at(state.time)
      if (Math.abs(p - last) < 0.0005) return
      last = p
      fill.current.style.height = `${p * 100}%`
      drop.current.style.top = `${p * 100}%`
      ticks.forEach((tick, i) => tick.classList.toggle('is-passed', state.time >= TICKS[i] - 0.05))
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="progress-rail" aria-hidden="true">
      {TICKS.map((t) => (
        <span key={t} className="progress-rail__tick" style={{ top: `${at(t) * 100}%` }} />
      ))}
      <span ref={fill} className="progress-rail__fill" />
      <span ref={drop} className="progress-rail__drop" />
    </div>
  )
}
