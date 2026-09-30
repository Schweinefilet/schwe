import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { TIMELINE_END } from '../config.js'
import { state } from '../core/state.js'
import Credits from './Credits.jsx'

// The final screen's way back, and the credits the data asks for (Credits.jsx): shown once the picture
// holds on the last frame (the ending plays itself there). Its visibility is set on the shared ticker,
// so it never re-renders React.
export default function BackToTop({ onTop }) {
  const ref = useRef()

  useEffect(() => {
    const el = ref.current
    let shown = false
    const update = () => {
      const show = state.time >= TIMELINE_END - 0.02
      if (show === shown) return
      shown = show
      el.classList.toggle('is-shown', show)
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="final-screen">
      <button type="button" className="back-to-top" onClick={onTop}>
        back to top
      </button>
      <Credits className="final-screen__credit" />
    </div>
  )
}
