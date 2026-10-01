import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { TIMELINE_END, TIMELINE_START } from '../config.js'
import { state } from '../core/state.js'

// The way through, on the right edge: a thin line that fills as the page is scrolled, a drop at its
// head. Shown from "enter" on. Its position is set on the shared ticker, so it never re-renders React.
export default function ProgressRail() {
  const ref = useRef()
  const fill = useRef()
  const drop = useRef()

  useEffect(() => {
    const el = ref.current
    let shown = false
    let last = -1
    const update = () => {
      if (!shown && state.unlocked) {
        shown = true
        el.classList.add('is-shown')
      }
      const p = Math.min(Math.max((state.time - TIMELINE_START) / (TIMELINE_END - TIMELINE_START), 0), 1)
      if (Math.abs(p - last) < 0.0005) return
      last = p
      fill.current.style.height = `${p * 100}%`
      drop.current.style.top = `${p * 100}%`
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="progress-rail" aria-hidden="true">
      <span ref={fill} className="progress-rail__fill" />
      <span ref={drop} className="progress-rail__drop" />
    </div>
  )
}
