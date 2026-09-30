import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { TIMELINE_START } from '../config.js'
import { state } from '../core/state.js'

// After "enter" nothing moves until the visitor scrolls. If they have not by the time the first shot
// has pulled focus onto the rain (DELAY_S), a small cue at the bottom says to: a drop falling down a
// thin line, and the word. It leaves on the first scroll and does not come back. Its visibility is set
// on the shared ticker, so it never re-renders React.
const DELAY_S = 4.5

export default function ScrollHint() {
  const ref = useRef()

  useEffect(() => {
    const el = ref.current
    let since = null
    let shown = false
    const update = (time) => {
      if (!state.unlocked) return
      since ??= time
      const moved = state.time > TIMELINE_START + 0.02
      const show = !moved && time - since > DELAY_S
      if (show !== shown) {
        shown = show
        el.classList.toggle('is-shown', show)
      }
      if (moved) gsap.ticker.remove(update)
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="scroll-hint" aria-hidden="true">
      <span className="scroll-hint__line">
        <span className="scroll-hint__drop" />
      </span>
      <span className="scroll-hint__label">scroll</span>
    </div>
  )
}
