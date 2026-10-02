import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { COUNT } from './answer.js'
import CityList from './CityList.jsx'
import Credits from './Credits.jsx'

// The cities (as they are right now), what this is, and the credits the data asks for, over the last
// frame. Opened from the final screen's links at their `section`. Focus moves into it and back to the
// link that opened it; Escape closes; Tab stays inside. It is its own scroll area (data-lenis-prevent),
// and sits in a portal so no stacking context of the ending's column can put it under the sound switch.
export default function CitySheet({ clips, rainCity, section = 'cities', onClose }) {
  const ref = useRef()

  useEffect(() => {
    const el = ref.current
    const opener = document.activeElement
    el.focus()
    if (section !== 'cities') el.querySelector(`#sheet-${section}`)?.scrollIntoView({ block: 'start' })
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll('button, a[href]')]
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose, section])

  return createPortal(
    <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Cities, about and credits" tabIndex={-1} data-lenis-prevent>
      <div className="sheet__bar">
        <button type="button" className="text-link sheet__close" onClick={onClose}>
          close
        </button>
      </div>
      <div className="sheet__body">
        <h2 className="sheet__title" id="sheet-cities">
          cities
        </h2>
        <CityList clips={clips} rainCity={rainCity} />
        <h2 className="sheet__title" id="sheet-about">
          about
        </h2>
        <div className="sheet__about">
          <p>
            schwe reads the weather in {COUNT} cities the moment you arrive. the rain stops mid-air, and some of its drops each hold one
            of those cities as it is right now: its sky, its sun or moon, its stars, its clouds and rain.
          </p>
          <p>then one drop falls, carrying the answer to a single question: where is it raining now?</p>
          <p>the cities aren’t filmed. each sky is computed from its city’s real time and weather, so no two visits look the same.</p>
        </div>
        <h2 className="sheet__title" id="sheet-credits">
          credits
        </h2>
        <Credits className="sheet__credit" />
      </div>
    </div>,
    document.body
  )
}
