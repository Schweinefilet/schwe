import { useEffect, useState } from 'react'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { now } from '../core/clock.js'
import { overlay } from './overlay.js'

const times = () => Object.fromEntries(CITIES.map((c) => [c.id, localTimeString(c, now())]))

// Beat 4: a label beside each city drop, shown as its city fades in (placed by DropLabelAnchors in the
// scene): the city, its local time and weather. The text changes at most once a minute.
export default function DropLabels({ clips }) {
  const [time, setTime] = useState(times)
  const byCity = Object.fromEntries((clips ?? []).map((c) => [c.city, c]))

  useEffect(() => {
    const timer = setInterval(() => setTime(times()), 30 * 1000)
    return () => clearInterval(timer)
  }, [])

  return CITIES.map((c) => (
    <div key={c.id} ref={(el) => (el ? overlay.labels.set(c.id, el) : overlay.labels.delete(c.id))} className="drop-label" aria-hidden="true">
      <div className="drop-label__name">{c.name}</div>
      <div className="drop-label__meta">
        {time[c.id]}
        {byCity[c.id]?.weatherLabel ? ` · ${byCity[c.id].weatherLabel}` : ''}
      </div>
    </div>
  ))
}
