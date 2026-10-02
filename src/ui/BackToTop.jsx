import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES, TIMELINE_END } from '../config.js'
import { state } from '../core/state.js'
import { answerLines } from './answer.js'
import CitySheet from './CitySheet.jsx'

const COPIED_MS = 2400

// The final screen: the way back, and three links. "cities" and "about" open the sheet (CitySheet.jsx)
// at their section; "share" hands the answer and the link to the system's share sheet, or copies them
// where there is none. Shown once the picture holds on the last frame (the ending plays itself there).
// Its visibility is set on the shared ticker, so it never re-renders React.
export default function BackToTop({ onTop, clips, rainCity }) {
  const ref = useRef()
  const [sheet, setSheet] = useState(null) // null | 'cities' | 'about'
  const [copied, setCopied] = useState(false)

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

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const share = async () => {
    const city = CITIES.find((c) => c.id === rainCity?.city)
    const [headline] = answerLines(rainCity, city, '', clips)
    const url = `${location.origin}/`
    const text = headline ? `${headline}.` : 'where is it raining now?'
    if (navigator.share) {
      try {
        await navigator.share({ title: 'schwe', text, url })
      } catch {
        // Dismissed: nothing to do.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setCopied(true)
    } catch {
      // No clipboard either (an insecure context): the address bar still has the link.
    }
  }

  return (
    <div ref={ref} className="final-screen">
      <button type="button" className="pill" onClick={onTop}>
        back to top
      </button>
      <div className="final-screen__links">
        <button type="button" className="text-link" onClick={() => setSheet('cities')}>
          cities
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="text-link" onClick={() => setSheet('about')}>
          about
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className={`text-link final-screen__share${copied ? ' is-copied' : ''}`} onClick={share}>
          <span aria-live="polite">{copied ? 'link copied' : 'share'}</span>
        </button>
      </div>
      {sheet && <CitySheet clips={clips} rainCity={rainCity} section={sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
