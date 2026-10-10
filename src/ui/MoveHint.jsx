import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ALIGN, TIMELINE_END } from '../config.js'
import { state } from '../core/state.js'
import { VERB } from './input.js'

// A small cue at the bottom: a drop falling down a thin line, and the words. It comes:
// - after "enter", if the visitor has not moved by DELAY_S (as the first shot's focus settles), to say
//   how: a click or a tap moves on, holding lets time run;
// - resting on the word (a hard stop, core/film.js) after WORD_S, so the word is seen first, to say the
//   film goes on;
// - resting anywhere else for REMIND_S, while the visitor has hardly moved yet, as the first time.
// It leaves on the next move. Its state is set on the shared ticker, so it never re-renders React.
const DELAY_S = 3
const WORD_S = 1.4
const REMIND_S = 10
const REMIND_UNTIL_MOVES = 4

const HOW = `${VERB}, or hold`
const ON = `${VERB} to go on`

export default function MoveHint() {
  const ref = useRef()
  const label = useRef()

  useEffect(() => {
    const el = ref.current
    let since = null
    let mode = null // 'how' | 'on' | null
    const update = (time) => {
      if (!state.unlocked) return
      since ??= time
      const rested = state.stop === null ? 0 : (performance.now() - state.restSince) / 1000
      const onWord = state.stop !== null && Math.abs(state.stop - ALIGN.arrive) < 0.01
      const atEnd = state.stop !== null && state.stop > TIMELINE_END - 0.01
      let next = null
      if (state.moves === 0) next = time - since > DELAY_S ? 'how' : null
      else if (onWord) next = rested > WORD_S ? 'on' : null
      else if (!atEnd && state.moves < REMIND_UNTIL_MOVES && rested > REMIND_S) next = 'how'
      if (next !== mode) {
        // The text changes only on the way in; on the way out the old words fade with the cue.
        if (next) label.current.textContent = next === 'on' ? ON : HOW
        el.classList.toggle('is-shown', !!next)
        el.classList.toggle('is-on', next === 'on')
        mode = next
      }
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="move-hint" aria-hidden="true">
      <span className="move-hint__line">
        <span className="move-hint__drop" />
      </span>
      <span ref={label} className="move-hint__label">
        {HOW}
      </span>
    </div>
  )
}
