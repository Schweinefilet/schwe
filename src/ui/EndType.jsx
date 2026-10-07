import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { now } from '../core/clock.js'
import { rig } from '../core/rig.js'
import { answerLines } from './answer.js'
import { overlay } from './overlay.js'
import AnswerHeadline from './AnswerHeadline.jsx'

// How dark the ending's scrim gets at its foot (.ending-scrim): enough that the answer and the final
// screen read as a title card over the brightest frame the rain makes.
const SCRIM = 0.82

// Beat 7: the answer, as the rings spread, over a scrim rising from the bottom. Opacity follows
// rig.endType on the shared ticker.
export default function EndType({ clips, rainCity }) {
  const ref = useRef()
  const scrim = useRef()
  const city = CITIES.find((c) => c.id === rainCity?.city)
  const [time, setTime] = useState(() => (city ? localTimeString(city, now()) : ''))

  useEffect(() => {
    if (!city) return
    const tick = () => setTime(localTimeString(city, now()))
    tick()
    const timer = setInterval(tick, 30 * 1000)
    return () => clearInterval(timer)
  }, [city])

  useEffect(() => {
    const el = ref.current
    const column = el.parentElement // .ending-ui: the answer and the final screen (its space always kept)
    let last = -1
    let frame = 0
    const update = () => {
      // Measured now and then (the column's layout changes only with the text or the window).
      if (rig.endType > 0.001 && frame++ % 30 === 0) {
        const rects = [el, ...column.querySelectorAll('.final-screen > .pill, .final-screen__links')].map((e) => e.getBoundingClientRect())
        overlay.typeZone = [Math.min(...rects.map((r) => r.left)), Math.min(...rects.map((r) => r.top)), Math.max(...rects.map((r) => r.right)), Math.max(...rects.map((r) => r.bottom))]
      } else if (rig.endType <= 0.001) overlay.typeZone = null
      if (rig.endType === last) return
      last = rig.endType
      el.style.opacity = rig.endType
      el.style.visibility = rig.endType > 0.001 ? 'visible' : 'hidden'
      scrim.current.style.opacity = rig.endType * SCRIM
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  const [headline, meta, rate] = answerLines(rainCity, city, time, clips)
  return (
    <>
      <div ref={scrim} className="ending-scrim" aria-hidden="true" />
      <div ref={ref} className="end-type" aria-live="polite">
      <div className="end-type__headline">
        <AnswerHeadline text={headline} name={city?.name} />
      </div>
      {meta && (
        <div className="end-type__meta meta">
          {meta}
          {rate && (
            <>
              {' · '}
              <span className="end-type__unit">{rate}</span>
            </>
          )}
        </div>
      )}
      </div>
    </>
  )
}
