import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { TIMELINE_END } from '../config.js'
import { state } from '../core/state.js'
import CitySheet from './CitySheet.jsx'

// The final screen's way back, and the sheet with the cities and the credits the data asks for
// (CitySheet.jsx): shown once the picture holds on the last frame (the ending plays itself there). Its
// visibility is set on the shared ticker, so it never re-renders React.
export default function BackToTop({ onTop, clips, rainCity }) {
  const ref = useRef()
  const [sheet, setSheet] = useState(false)

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
      <button type="button" className="pill" onClick={onTop}>
        back to top
      </button>
      <div className="final-screen__links">
        <button type="button" className="text-link" onClick={() => setSheet(true)}>
          cities
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="text-link" onClick={() => setSheet(true)}>
          credits
        </button>
      </div>
      {sheet && <CitySheet clips={clips} rainCity={rainCity} onClose={() => setSheet(false)} />}
    </div>
  )
}
