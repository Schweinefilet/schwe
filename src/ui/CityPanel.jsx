import { useCallback, useEffect, useState } from 'react'
import { CITIES } from '../city/cities.js'
import { describeWeather } from '../content/cityWeather.js'
import { localTimeString } from '../core/clock.js'
import WeatherPanel from './WeatherPanel.jsx'
import { round } from './weatherCharts.jsx'

// The whole interface, laid over the studio: the selected city's name, its local time and its weather in
// the corner; the three cities to choose from; "more weather", which opens every reading on frosted glass
// (WeatherPanel.jsx). The weather shown is the reading that lights the model (content/cityWeather.js).
// `status` is 'reading' until the first answer, then 'read' or 'failed': when a city's weather could not
// be read the model shows clear skies, and the corner says so.
export default function CityPanel({ cityId, onSelect, weather, status }) {
  const city = CITIES.find((c) => c.id === cityId)
  const detail = weather?.[cityId] ?? null
  const [time, setTime] = useState(() => localTimeString(city))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const tick = () => setTime(localTimeString(city))
    tick()
    const timer = setInterval(tick, 15 * 1000)
    return () => clearInterval(timer)
  }, [city])

  // Another city, or its weather gone: the expanded view closes.
  useEffect(() => {
    if (!detail) setOpen(false)
  }, [detail])
  const close = useCallback(() => setOpen(false), [])

  const cur = detail?.current
  const label = describeWeather(cur?.code)
  const today = detail?.daily

  return (
    <div className={`city-type${open ? ' is-open' : ''}`}>
      <div className="wordmark">schwe</div>

      {open ? (
        <WeatherPanel city={city} time={time} label={label} tempC={cur?.tempC} detail={detail} onClose={close} />
      ) : (
        <>
          <div className="wx-corner" aria-live="polite">
            <div className="city-type__name">{city.name}</div>
            <div className="city-type__meta meta">
              {time}
              {label ? ` · ${label}` : ''}
            </div>
            {!detail && <div className="wx-note meta">{status === 'reading' ? 'reading the weather…' : 'weather unavailable · showing clear skies'}</div>}
            {cur?.tempC != null && (
              <div className="wx-corner__temp">
                <span className="wx-corner__deg">{round(cur.tempC)}°</span>
                <span className="meta">
                  {cur.feelsC != null && <>feels {round(cur.feelsC)}°</>}
                  {today && (
                    <>
                      <br />
                      {round(today.maxC[0])}° / {round(today.minC[0])}°
                    </>
                  )}
                </span>
              </div>
            )}
          </div>

          {detail && (
            <button type="button" className="wx-more" onClick={() => setOpen(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
              </svg>
              more weather
            </button>
          )}
        </>
      )}

      <nav className="cities" aria-label="Cities">
        {CITIES.map((c) => (
          <button key={c.id} type="button" className="cities__item" aria-current={c.id === cityId} onClick={() => onSelect(c.id)}>
            {c.name}
          </button>
        ))}
      </nav>

      <p className="credit">
        buildings ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{' '}
        contributors,{' '}
        <a href="https://overturemaps.org" target="_blank" rel="noreferrer">
          Overture Maps
        </a>{' '}
        · weather by{' '}
        <a href="https://open-meteo.com" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>
      </p>
    </div>
  )
}
