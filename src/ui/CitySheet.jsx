import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import CityList from './CityList.jsx'
import Credits from './Credits.jsx'

// The cities (as they are right now) and the credits the data asks for, over the last frame. Opened
// from the final screen's links. Focus moves into it and back to the link that opened it; Escape closes;
// Tab stays inside. It is its own scroll area (data-lenis-prevent), and sits in a portal so no
// stacking context of the ending's column can put it under the sound switch.
export default function CitySheet({ clips, rainCity, onClose }) {
  const ref = useRef()

  useEffect(() => {
    const el = ref.current
    const opener = document.activeElement
    el.focus()
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
  }, [onClose])

  return createPortal(
    <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="Cities and credits" tabIndex={-1} data-lenis-prevent>
      <button type="button" className="text-link sheet__close" onClick={onClose}>
        close
      </button>
      <div className="sheet__body">
        <h2 className="sheet__title">cities</h2>
        <CityList clips={clips} rainCity={rainCity} />
        <h2 className="sheet__title">credits</h2>
        <Credits className="sheet__credit" />
      </div>
    </div>,
    document.body
  )
}
