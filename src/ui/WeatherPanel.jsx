import { useEffect, useRef } from 'react'
import { Compass, HoursChart, NowcastChart, Ring, SunArc, WeekChart, round } from './weatherCharts.jsx'
import {
  aqiWord,
  beaufort,
  cloudWord,
  compassPoint,
  daylight,
  minutesOf,
  outlook,
  rainNote,
  sunDown,
  uvWord,
  visibility,
} from './weatherWords.js'

// The expanded view inside the dive drop, opened from the edges' "more weather" (CityType.jsx): every
// reading Open-Meteo has for the city, on frosted pastel glass over its sky. The scroll is held while
// it is open (CityType); focus moves into it and back to the opener, Escape closes, Tab stays inside.
export default function WeatherPanel({ city, time, label, tempC, detail, onClose }) {
  const closeRef = useRef()
  const cur = detail.current
  const today = detail.daily

  useEffect(() => {
    const opener = document.activeElement
    closeRef.current.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="wx-panel" role="dialog" aria-modal="true" aria-label={`Weather in ${city?.name}`}>
      {/* Outside the cards (their transforms would hold a fixed child): where "more weather" was. */}
      <button ref={closeRef} type="button" className="wx-close" onClick={onClose}>
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
          <path d="M3.5 3.5l9 9m0-9l-9 9" />
        </svg>
        close
      </button>
      <section className="wx-card wx-head" style={{ '--i': 0 }}>
        <div className="city-type__name">{city?.name}</div>
        <div className="city-type__meta meta">
          {time}
          {label ? ` · ${label}` : ''}
          {detail?.tzAbbr ? ` · ${detail.tzAbbr}` : ''}
        </div>
        {detail?.hourly && <p className="wx-head__outlook">{outlook(detail.hourly)}</p>}
        {tempC != null && (
          <div className="wx-head__temp">
            <span className="wx-head__deg">{round(tempC)}°</span>
            <span className="wx-head__aside meta">
              {cur?.feelsC != null && <span>feels like {round(cur.feelsC)}°</span>}
              {today && (
                <span>
                  high {round(today.maxC[0])}° · low {round(today.minC[0])}°
                </span>
              )}
            </span>
          </div>
        )}
      </section>

      {detail.hourly && (
        <Card area="hours" i={1} title="next 24 hours" note="temperature · chance of rain">
          <HoursChart hourly={detail.hourly} />
        </Card>
      )}

      {today && (
        <Card area="week" i={2} title="this week" note="low – high">
          <WeekChart daily={today} nowC={tempC} />
        </Card>
      )}

      {detail.nowcast && (
        <Card area="rain" i={3} title="rain, next 2 hours" note={rainNote(cur)}>
          <NowcastChart nowcast={detail.nowcast} />
        </Card>
      )}

      {cur && (
        <Card area="wind" i={4} title="wind" note={beaufort(cur.windKmh)}>
          <div className="wx-wind">
            <Compass fromDeg={cur.windFromDeg} />
            <dl className="wx-facts">
              <Fact k="speed" v={cur.windKmh} unit="km/h" />
              <Fact k="gusts" v={cur.gustKmh} unit="km/h" />
              <Fact k="from" text={cur.windFromDeg == null ? null : `${compassPoint(cur.windFromDeg)} ${round(cur.windFromDeg)}°`} />
            </dl>
          </div>
        </Card>
      )}

      {today?.sunrise?.[0] && (
        <Card area="sun" i={5} title="sun" note={daylight(today.daylightS[0])}>
          <SunArc rise={minutesOf(today.sunrise[0])} set={minutesOf(today.sunset[0])} nowMin={minutesOf(time)} />
          {sunDown(today, time) && <div className="wx-sun__note meta">{sunDown(today, time)}</div>}
          <div className="wx-sun__times meta">
            <span>↑ {today.sunrise[0].slice(11, 16)}</span>
            <span>{today.sunset[0].slice(11, 16)} ↓</span>
          </div>
        </Card>
      )}

      <div className="wx-stats" style={{ '--i': 6 }}>
        {cur?.humidity != null && (
          <Stat k="humidity" note={cur.dewPointC != null ? `dew point ${round(cur.dewPointC)}°` : null}>
            <Ring value={cur.humidity} max={100}>
              {round(cur.humidity)}%
            </Ring>
          </Stat>
        )}
        {cur?.cloud != null && (
          <Stat k="cloud cover" note={cloudWord(cur.cloud)}>
            <Ring value={cur.cloud} max={100}>
              {round(cur.cloud)}%
            </Ring>
          </Stat>
        )}
        {cur?.uv != null && (
          <Stat k="uv index" note={`${uvWord(cur.uv)}${today?.uvMax?.[0] != null ? ` · max ${today.uvMax[0].toFixed(0)}` : ''}`}>
            <Ring value={cur.uv} max={11}>
              {cur.uv.toFixed(0)}
            </Ring>
          </Stat>
        )}
        {detail.air?.usAqi != null && (
          <Stat
            k="air quality"
            note={
              <>
                {aqiWord(detail.air.usAqi)}
                {detail.air.pm25 != null && <span className="wx-wide"> · pm2.5 {detail.air.pm25.toFixed(0)}</span>}
              </>
            }
          >
            <Ring value={detail.air.usAqi} max={200}>
              {round(detail.air.usAqi)}
            </Ring>
          </Stat>
        )}
        {cur?.pressureHpa != null && <Stat k="pressure" big={round(cur.pressureHpa)} unit="hPa" note="at sea level" />}
        {cur?.visibilityM != null && (
          <Stat
            k="visibility"
            big={visibility(cur.visibilityM)}
            unit="km"
            note={detail.elevationM != null ? `${round(detail.elevationM)} m up` : null}
          />
        )}
        {cur && (
          <Stat
            k="precipitation"
            big={(cur.mmPerHour ?? 0).toFixed(1)}
            unit="mm/h"
            note={
              today?.precipMm?.[0] != null
                ? `${today.precipMm[0].toFixed(1)} mm today${cur.snowCm ? ` · ${cur.snowCm} cm snow` : ''}`
                : null
            }
          />
        )}
        {today?.precipProb?.[0] != null && <Stat k="chance of rain" big={round(today.precipProb[0])} unit="%" note="today" />}
      </div>
    </div>
  )
}

function Card({ area, i, title, note, children }) {
  return (
    <section className={`wx-card wx-card--${area}`} style={{ '--i': i }}>
      <header className="wx-card__head">
        <h3 className="wx-card__title">{title}</h3>
        {note && <span className="wx-card__note meta">{note}</span>}
      </header>
      {children}
    </section>
  )
}

function Stat({ k, big, unit, note, children }) {
  return (
    <section className="wx-card wx-stat">
      <h3 className="wx-card__title">{k}</h3>
      {children ?? (
        <div className="wx-stat__big">
          {big}
          <small>{unit}</small>
        </div>
      )}
      {note && <div className="wx-card__note meta">{note}</div>}
    </section>
  )
}

function Fact({ k, v, unit, text }) {
  const shown = text ?? (v == null ? null : `${round(v)} ${unit}`)
  if (shown == null) return null
  return (
    <div className="wx-fact">
      <dt className="meta">{k}</dt>
      <dd>{shown}</dd>
    </div>
  )
}
