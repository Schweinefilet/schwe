import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { COUNT } from './answer.js'

// The screen over the rain before it starts: the name, the question the site answers, a faint drop and
// "enter". The click is the user gesture that unlocks audio and scrolling; the screen fades and the
// page stays where it is, at the rain. "enter" appears once `ready` (the dive city is chosen and, with
// the sky as the source, the city skies are prepared), so nothing changes after it. Until then the
// same place says what is being waited for (after SLOW_MS: a quick load never flashes it), so a slow
// connection is never just a black screen.
const SLOW_MS = 1200

export default function Loader({ onEnter, ready }) {
  const ref = useRef()
  const [gone, setGone] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [])

  const handleEnter = () => {
    onEnter()
    gsap.to(ref.current, { autoAlpha: 0, duration: 1.2, ease: 'power1.out', onComplete: () => setGone(true) })
  }

  if (gone) return null
  return (
    <div ref={ref} className="loader">
      <div className="loader__drop" aria-hidden="true" />
      <h1 className="loader__title">schwe</h1>
      <p className="loader__question">where is it raining now?</p>
      <div className="loader__action">
        <p className={`loader__status${slow && !ready ? ' is-shown' : ''}`} role="status">
          reading the weather in {COUNT} cities
        </p>
        <button className={`pill pill--lg loader__enter${ready ? ' is-ready' : ''}`} onClick={handleEnter} disabled={!ready}>
          enter
        </button>
      </div>
      <p className="loader__note">best with sound · scroll to move through the rain</p>
    </div>
  )
}
