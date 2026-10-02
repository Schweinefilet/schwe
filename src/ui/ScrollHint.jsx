import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ALIGN, TIMELINE_START } from '../config.js'
import { state } from '../core/state.js'
import { VERB } from './input.js'

// A small cue at the bottom: a drop falling down a thin line, and the word. It comes twice.
// - After "enter", if the visitor has not scrolled by DELAY_S (as the first shot's focus settles), it
//   says to. It leaves on the first scroll and that cue does not come back.
// - Held on the word (core/scroll.js), once the rest is over, it says to keep going, and the line fills
//   as the visitor's push counts toward letting go, so input that moves nothing still visibly registers.
// Its state is set on the shared ticker, so it never re-renders React.
const DELAY_S = 3
const HOLD_DELAY_MS = 350 // after the hold's rest (ALIGN.hold.dwell), so the word is seen first

export default function ScrollHint() {
  const ref = useRef()
  const label = useRef()
  const fill = useRef()

  useEffect(() => {
    const el = ref.current
    let since = null
    let intro = true // the first cue is still possible
    let mode = null // 'intro' | 'hold' | null
    let lastPush = -1
    const update = (time) => {
      if (!state.unlocked) return
      since ??= time
      if (intro && state.time > TIMELINE_START + 0.02) intro = false
      const word = state.word
      const holding = word?.holding && performance.now() - word.since > ALIGN.hold.dwell * 1000 + HOLD_DELAY_MS
      const next = intro && time - since > DELAY_S ? 'intro' : holding ? 'hold' : null
      if (next !== mode) {
        // The text changes only on the way in; on the way out the old words fade with the cue.
        if (next) label.current.textContent = next === 'hold' ? `keep ${VERB === 'swipe' ? 'swiping' : 'scrolling'}` : VERB
        el.classList.toggle('is-shown', !!next)
        el.classList.toggle('is-hold', next === 'hold')
        mode = next
      }
      const push = next === 'hold' ? Math.min(word.push / ALIGN.hold.push, 1) : 0
      if (Math.abs(push - lastPush) > 0.002) {
        lastPush = push
        fill.current.style.transform = `scaleY(${push})`
      }
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="scroll-hint" aria-hidden="true">
      <span className="scroll-hint__line">
        <span ref={fill} className="scroll-hint__fill" />
        <span className="scroll-hint__drop" />
      </span>
      <span ref={label} className="scroll-hint__label">
        {VERB}
      </span>
    </div>
  )
}
