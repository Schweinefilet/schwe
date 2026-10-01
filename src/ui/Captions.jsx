import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { CAPTIONS } from '../config.js'
import { quality } from '../core/quality.js'
import { state } from '../core/state.js'

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

// What each caption says. The count is the drops this tier shows, which can change during a visit.
const TEXT = {
  drops: () => ['rain, stopped mid-air.', `${WORDS[quality.heroDrops] ?? quality.heroDrops} of the drops each hold a city, as it is right now.`],
  fall: () => ['one of these drops is about to fall.', null],
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// The captions (CAPTIONS in config.js), centred low, set like the answer. Their opacity follows the
// timeline's time on the shared ticker, so they come and go with the scroll in either direction.
export default function Captions() {
  const ref = useRef()

  useEffect(() => {
    const el = ref.current
    const [headline, sub] = el.children
    let current = null // which caption's text is in place, and for how many drops
    const update = () => {
      const t = state.time
      const c = CAPTIONS.find((c) => t > c.from && t < c.to)
      const a = c ? Math.min(smoothstep(c.from, c.from + c.fade, t), 1 - smoothstep(c.to - c.fade, c.to, t)) : 0
      const key = c && `${c.id}:${quality.heroDrops}`
      if (c && key !== current) {
        current = key
        const [h, s] = TEXT[c.id]()
        headline.textContent = h
        sub.textContent = s ?? ''
        sub.hidden = !s
      }
      el.style.opacity = a
      el.style.visibility = a > 0.001 ? 'visible' : 'hidden'
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="caption" aria-live="polite">
      <p className="caption__headline" />
      <p className="caption__sub" />
    </div>
  )
}
