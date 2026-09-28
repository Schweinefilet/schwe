import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { rig } from '../core/rig.js'

// Beat 7: the answer, as the rings spread. Opacity follows rig.endType on the shared ticker.
export default function EndType({ clips, rainCity }) {
  const ref = useRef()
  const city = CITIES.find((c) => c.id === rainCity?.city)
  const [time, setTime] = useState(() => (city ? localTimeString(city) : ''))

  useEffect(() => {
    if (!city) return
    const tick = () => setTime(localTimeString(city))
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

  const [headline, meta] = lines(rainCity, city, time, clips)
  return (
    <div ref={ref} className="end-type" aria-live="polite">
      <div className="end-type__headline">{headline}</div>
      {meta && <div className="end-type__meta">{meta}</div>}
    </div>
  )
}

function lines(rain, city, time, clips) {
  if (!rain) return ['', null]
  if (rain.kind === 'now' && city) {
    const mm = rain.mmPerHour > 0 ? ` · ${rain.mmPerHour < 1 ? rain.mmPerHour.toFixed(1) : Math.round(rain.mmPerHour)} mm/h` : ''
    return ['Raining hardest now', `${city.name} · ${time} · ${rain.label}${mm}`]
  }
  if (rain.kind === 'soon' && city) {
    const weather = clips?.find((c) => c.city === city.id)?.weatherLabel
    return [arrival(city.name, rain.minutes), `${city.name} · ${time}${weather ? ` · ${weather}` : ''}`]
  }
  return ['Nowhere else is it raining right now.', null]
}

function arrival(name, minutes) {
  if (minutes < 10) return `Rain is about to reach ${name}`
  if (minutes < 60) return `Rain reaches ${name} in about ${Math.round(minutes / 5) * 5} min`
  const hours = Math.round(minutes / 30) / 2
  return `Rain reaches ${name} in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}
