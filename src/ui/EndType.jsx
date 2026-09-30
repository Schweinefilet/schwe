import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { now } from '../core/clock.js'
import { rig } from '../core/rig.js'
import { answerLines } from './answer.js'

// Beat 7: the answer, as the rings spread. Opacity follows rig.endType on the shared ticker.
export default function EndType({ clips, rainCity }) {
  const ref = useRef()
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
    const update = () => {
      el.style.opacity = rig.endType
      el.style.visibility = rig.endType > 0.001 ? 'visible' : 'hidden'
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  const [headline, meta, rate] = answerLines(rainCity, city, time, clips)
  return (
    <div ref={ref} className="end-type" aria-live="polite">
      <div className="end-type__headline">{headline}</div>
      {meta && (
        <div className="end-type__meta">
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
  )
}
