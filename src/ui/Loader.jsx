import { useRef, useState } from 'react'
import gsap from 'gsap'

// A black screen over the rain, a single faint drop, the word "enter". The click is the user gesture
// that unlocks audio and scrolling; the screen fades and the page stays where it is, at the rain. "enter" appears once `ready` (the dive city is chosen and, with the sky as the source,
// the city skies are prepared), so nothing changes after it.
export default function Loader({ onEnter, ready }) {
  const ref = useRef()
  const [gone, setGone] = useState(false)

  const handleEnter = () => {
    onEnter()
    gsap.to(ref.current, { autoAlpha: 0, duration: 1.2, ease: 'power1.out', onComplete: () => setGone(true) })
  }

  if (gone) return null
  return (
    <div ref={ref} className="loader">
      <div className="loader__drop" aria-hidden="true" />
      <button className={`loader__enter${ready ? ' is-ready' : ''}`} onClick={handleEnter} disabled={!ready}>
        enter
      </button>
    </div>
  )
}
