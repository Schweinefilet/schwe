import { useCallback, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { CITIES } from '../config.js'
import { localTimeString } from '../content/clipSelector.js'
import { describeWeather } from '../content/weather.js'
import { fetchCityDetail } from '../content/cityWeather.js'
import { now } from '../core/clock.js'
import { rig } from '../core/rig.js'
import WeatherPanel from './WeatherPanel.jsx'
import { Compass, RainRibbon, Ring, TempRibbon, round } from './weatherCharts.jsx'
import { aqiWord, compassPoint, uvWord, visibility } from './weatherWords.js'

const REFRESH_MS = 10 * 60 * 1000

// Beat 5: while the camera is inside the drop, its city is the picture, and the weather keeps to the
// edges: the name, local time, sky and temperature in the corner as a drop's label; the next 24 hours'
// temperature as one soft line along the top and its chance of rain as hairline bars along the bottom;
// a few readings down the left and the week down the right, translucent, on a vignette that leaves the
// middle untouched. "more weather" opens everything (WeatherPanel.jsx) and holds the scroll until it
// closes. Opacity follows rig.cityType on the shared ticker; the detail is fetched for the dive city
// only, once it is known, and every ten minutes after. Whatever was not read is left out.
export default function CityType({ clips, cityId, onLock }) {
  const ref = useRef()
  const city = CITIES.find((c) => c.id === cityId)
  const entry = clips?.find((c) => c.city === cityId)
  const [time, setTime] = useState(() => (city ? localTimeString(city, now()) : ''))
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const detail = useCityDetail(city)

  useEffect(() => {
    if (!city) return
    const tick = () => setTime(localTimeString(city, now()))
    tick()
    const timer = setInterval(tick, 30 * 1000)
    return () => clearInterval(timer)
  }, [city])

  useEffect(() => {
    const el = ref.current
    let last = -1
    const update = () => {
      const v = rig.cityType
      // A jump out of the drop (back to top, a dev goto) closes the expanded view with it.
      if (v < 0.02 && openRef.current) setOpen(false)
      if (Math.abs(v - last) < 0.0005) return
      last = v
      el.style.setProperty('--in', v.toFixed(4))
      el.style.visibility = v > 0.001 ? 'visible' : 'hidden'
    }
    gsap.ticker.add(update)
    return () => gsap.ticker.remove(update)
  }, [])

  useEffect(() => {
    openRef.current = open
    if (!open) return
    onLock?.(true)
    return () => onLock?.(false)
  }, [open, onLock])

  const close = useCallback(() => setOpen(false), [])

  const cur = detail?.current
  const label = (cur?.code != null ? describeWeather(cur.code).label : null) ?? entry?.weatherLabel
  const tempC = cur?.tempC ?? entry?.tempC
  const today = detail?.daily
  const hourly = detail?.hourly
  const peak = hourly ? Math.max(0, ...hourly.precipProb.filter((v) => v != null)) : null

  return (
    <div ref={ref} className={`city-type${detail ? ' has-detail' : ''}${open ? ' is-open' : ''}`} aria-live="polite">
      {open ? (
        <WeatherPanel city={city} time={time} label={label} tempC={tempC} detail={detail} onClose={close} />
      ) : (
        <>
          {hourly && (
            <section className="wx-edge wx-edge--top" aria-label="Temperature, next 24 hours">
              <div className="wx-edge__label meta">temperature · next 24 hours</div>
              <TempRibbon hourly={hourly} />
            </section>
          )}

          {cur && (
            <dl className="wx-edge wx-edge--left">
              {cur.windKmh != null && (
                <Reading glyph={<Compass fromDeg={cur.windFromDeg} bare />} k="wind">
                  {round(cur.windKmh)} km/h {cur.windFromDeg != null && <small>{compassPoint(cur.windFromDeg).toLowerCase()}</small>}
                </Reading>
              )}
              {cur.humidity != null && (
                <Reading glyph={<Ring value={cur.humidity} max={100} />} k="humidity">
                  {round(cur.humidity)}%
                </Reading>
              )}
              {cur.cloud != null && (
                <Reading glyph={<Ring value={cur.cloud} max={100} />} k="cloud">
                  {round(cur.cloud)}%
                </Reading>
              )}
              {cur.uv != null && (
                <Reading glyph={<Ring value={cur.uv} max={11} />} k="uv index">
                  {cur.uv.toFixed(0)} <small>{uvWord(cur.uv)}</small>
                </Reading>
              )}
              {detail.air?.usAqi != null && (
                <Reading glyph={<Ring value={detail.air.usAqi} max={200} />} k="air quality">
                  {round(detail.air.usAqi)} <small>{aqiWord(detail.air.usAqi)}</small>
                </Reading>
              )}
              {cur.pressureHpa != null && (
                <Reading k="pressure">
                  {round(cur.pressureHpa)} <small>hPa</small>
                </Reading>
              )}
              {cur.visibilityM != null && (
                <Reading k="visibility">
                  {visibility(cur.visibilityM)} <small>km</small>
                </Reading>
              )}
            </dl>
          )}

          {today && (
            <section className="wx-edge wx-edge--right" aria-label="This week">
              <div className="wx-edge__label meta">this week</div>
              <MiniWeek daily={today} />
              {today.sunrise?.[0] && (
                <div className="wx-edge__sun meta">
                  ↑ {today.sunrise[0].slice(11, 16)} · {today.sunset[0].slice(11, 16)} ↓
                </div>
              )}
            </section>
          )}

          {hourly && (
            <section className="wx-edge wx-edge--bottom" aria-label="Chance of rain, next 24 hours">
              <div className="wx-edge__label meta">
                chance of rain{peak != null ? ` · up to ${round(peak)}%` : ''}
                {cur?.mmPerHour > 0 ? ` · ${cur.mmPerHour.toFixed(1)} mm/h now` : ''}
              </div>
              <RainRibbon hourly={hourly} />
            </section>
          )}

          <div className="wx-corner">
            <div className="city-type__name">{city?.name}</div>
            <div className="city-type__meta meta">
              {time}
              {label ? ` · ${label}` : ''}
            </div>
            {detail && tempC != null && (
              <div className="wx-corner__temp">
                <span className="wx-corner__deg">{round(tempC)}°</span>
                <span className="meta">
                  {cur?.feelsC != null && <>feels {round(cur.feelsC)}°</>}
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
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
              </svg>
              more weather
            </button>
          )}
        </>
      )}
    </div>
  )
}

function Reading({ glyph, k, children }) {
  return (
    <div className="wx-reading">
      {glyph && <span className="wx-reading__glyph">{glyph}</span>}
      <dt className="meta">{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// The week in the right margin: each day's low to high on one shared scale.
function MiniWeek({ daily }) {
  const lo = Math.min(...daily.minC.filter((v) => v != null))
  const hi = Math.max(...daily.maxC.filter((v) => v != null))
  const at = (v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50)
  const day = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00Z`)).toLowerCase()
  return (
    <ol className="wx-miniweek meta">
      {daily.time.map((t, i) => (
        <li key={t}>
          <span className="wx-miniweek__day">{i === 0 ? 'today' : day(t)}</span>
          <span className="wx-miniweek__t">{round(daily.minC[i])}°</span>
          <span className="wx-miniweek__track">
            {daily.minC[i] != null && daily.maxC[i] != null && (
              <span style={{ left: `${at(daily.minC[i])}%`, width: `${at(daily.maxC[i]) - at(daily.minC[i])}%` }} />
            )}
          </span>
          <span className="wx-miniweek__t">{round(daily.maxC[i])}°</span>
        </li>
      ))}
    </ol>
  )
}

// Fetches the dive city's full weather once it is known, and every REFRESH_MS. A failed refresh keeps
// the reading already shown.
function useCityDetail(city) {
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    if (!city) return
    let cancelled = false
    const load = () =>
      fetchCityDetail(city)
        .then((d) => !cancelled && d && setDetail(d))
        .catch((err) => console.warn('[weather] detail failed:', err.message))
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [city])
  return detail
}
