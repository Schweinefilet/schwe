import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { isMuted, setMuted } from '../audio/audioEngine.js'
import { state } from '../core/state.js'

// The sound switch, top right, from "enter" on (sound starts with it). The choice is remembered in this
// browser (audioEngine.js). Hidden before "enter", so it is not in the tab order behind the loader.
export default function SoundToggle() {
  const ref = useRef()
  const [muted, setMutedState] = useState(isMuted)

  useEffect(() => {
    const el = ref.current
    const update = () => {
      if (!state.unlocked) return
      el.classList.add('is-shown')
      gsap.ticker.remove(update)
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  const toggle = () => {
    setMuted(!muted)
    setMutedState(!muted)
  }

  return (
    <button ref={ref} type="button" className="sound-toggle" onClick={toggle} aria-pressed={!muted} aria-label="Sound" title={muted ? 'Sound off' : 'Sound on'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" />
        {muted ? (
          <path d="M15.5 9.5l5 5m0-5l-5 5" />
        ) : (
          <>
            <path d="M15 9.2a4 4 0 0 1 0 5.6" />
            <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
          </>
        )}
      </svg>
    </button>
  )
}
