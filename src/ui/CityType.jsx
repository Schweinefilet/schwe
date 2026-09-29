import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { now } from '../core/clock.js'
import { rig } from '../core/rig.js'

// Beat 5: small type in a corner while the camera is inside the drop: city, local time, weather.
// Opacity follows rig.cityType on the shared ticker; the text itself only changes once a minute.
export default function CityType({ clips, cityId }) {
  const ref = useRef()
  const city = CITIES.find((c) => c.id === cityId)
  const entry = clips?.find((c) => c.city === cityId)
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
      el.style.opacity = rig.cityType
      el.style.visibility = rig.cityType > 0.001 ? 'visible' : 'hidden'
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  return (
    <div ref={ref} className="city-type" aria-live="polite">
      <div className="city-type__name">{city?.name}</div>
      <div className="city-type__meta">
        {time}
        {entry?.weatherLabel ? ` · ${entry.weatherLabel}` : ''}
      </div>
    </div>
  )
}
