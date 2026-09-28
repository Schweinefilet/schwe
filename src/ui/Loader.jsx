import { useRef, useState } from 'react'
import gsap from 'gsap'

// Beat 1: black screen, a single faint drop, the word "enter". The click is the user gesture that
// unlocks audio.
export default function Loader({ onEnter }) {
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
      <button className="loader__enter" onClick={handleEnter}>
        enter
      </button>
    </div>
  )
}
