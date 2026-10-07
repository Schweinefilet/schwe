import { useId, useState } from 'react'

// The charts inside the dive drop (CityType.jsx). Hand-drawn SVG, one series each, so no legends: the
// card's title names what is drawn. Lines and areas sit in a stretched viewBox (strokes keep their width
// with non-scaling-stroke); type and dots are HTML placed in percentages, so nothing distorts.
// Colours are the UI's pastels: peach for temperature, mist for water, lavender for everything else.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pct = (v) => `${v.toFixed(3)}%`
export const round = (v) => (v == null ? '–' : Math.round(v))
export const hourOf = (t) => t?.slice(11, 13) ?? ''

function extent(values, pad = 0) {
  const vs = values.filter((v) => v != null)
  if (!vs.length) return [0, 1]
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (hi - lo < 1e-6) hi = lo + 1
  const p = (hi - lo) * pad
  return [lo - p, hi + p]
}

// Smooth path through points (monotone-ish Catmull-Rom → Bézier, tension kept low so peaks stay true).
function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.16
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`
  }
  return d
}

// The next 24 hours: temperature as a soft line over its own glow, and below it, on its own axis, the
// chance of rain as thin bars. Hover (pointer devices) shows one hour in full.
export function HoursChart({ hourly }) {
  const id = useId()
  const [hover, setHover] = useState(null)
  const n = hourly.time.length
  const temps = hourly.tempC
  const [lo, hi] = extent(temps, 0.18)
  const x = (i) => (i / (n - 1)) * 100
  const y = (v) => 100 - ((v - lo) / (hi - lo)) * 100
  const pts = temps.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean)
  const line = smoothPath(pts)
  const area = pts.length ? `${line} L${pts.at(-1)[0]},100 L${pts[0][0]},100 Z` : ''
  const iMax = temps.indexOf(Math.max(...temps.filter((v) => v != null)))
  const iMin = temps.indexOf(Math.min(...temps.filter((v) => v != null)))
  // Direct labels on now, the high and the low only, and never two within three hours of each other.
  const marks = []
  for (const i of [0, iMax, iMin]) if (i >= 0 && temps[i] != null && marks.every((j) => Math.abs(i - j) > 2)) marks.push(i)

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(clamp(Math.round(((e.clientX - r.left) / r.width) * (n - 1)), 0, n - 1))
  }
  const h = hover
  return (
    <div className="wx-hours" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <div className="wx-plot wx-plot--temp">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--ui-peach)" stopOpacity="0.42" />
              <stop offset="1" stopColor="var(--ui-lavender)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((g) => (
            <line key={g} className="wx-grid" x1="0" x2="100" y1={g} y2={g} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill={`url(#${id}a)`} />
          <path d={line} className="wx-line wx-line--temp" vectorEffect="non-scaling-stroke" />
          {h != null && <line className="wx-cross" x1={x(h)} x2={x(h)} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
        </svg>
        {marks.map((i) => (
          <span key={i} className={`wx-dot${i === 0 ? ' wx-dot--now' : ''}`} style={{ left: pct(x(i)), top: pct(y(temps[i])) }}>
            <span className={`wx-dot__label${y(temps[i]) < 30 ? ' is-below' : ''}`}>{round(temps[i])}°</span>
          </span>
        ))}
        {h != null && temps[h] != null && <span className="wx-dot wx-dot--hover" style={{ left: pct(x(h)), top: pct(y(temps[h])) }} />}
      </div>
      <div className="wx-plot wx-plot--chance">
        {hourly.precipProb.map((p, i) => (
          <span key={i} className={`wx-bar${i === h ? ' is-on' : ''}`} style={{ left: pct(x(i)), height: pct(Math.max(3, p ?? 0)) }} />
        ))}
      </div>
      <div className="wx-axis meta">
        {hourly.time.map((t, i) =>
          i % 3 === 0 ? (
            <span key={t} className={i % 6 ? 'is-minor' : undefined} style={{ left: pct(x(i)) }}>
              {i === 0 ? 'now' : hourOf(t)}
            </span>
          ) : null,
        )}
      </div>
      {h != null && (
        <div className={`wx-tip meta${x(h) > 60 ? ' is-left' : ''}`} style={{ left: pct(x(h)) }}>
          <strong>{h === 0 ? 'now' : `${hourOf(hourly.time[h])}:00`}</strong>
          <span>
            {round(temps[h])}° · feels {round(hourly.feelsC[h])}°
          </span>
          <span>
            {round(hourly.precipProb[h])}% rain · {hourly.precipMm[h]?.toFixed(1) ?? '–'} mm
          </span>
          <span>
            {round(hourly.cloud[h])}% cloud · {round(hourly.windKmh[h])} km/h
          </span>
        </div>
      )}
    </div>
  )
}

// The next two hours of rain, fifteen minutes a bar.
export function NowcastChart({ nowcast }) {
  const vals = nowcast.precipMm.map((v) => v ?? 0)
  const max = Math.max(0.5, ...vals)
  const dry = vals.every((v) => v < 0.05)
  return (
    <div className="wx-nowcast">
      <div className="wx-plot wx-plot--nowcast">
        {vals.map((v, i) => (
          <span key={i} className="wx-col" style={{ height: pct(Math.max(2.5, (v / max) * 100)) }} title={`${v.toFixed(1)} mm`} />
        ))}
        {dry && <span className="wx-plot__note meta">dry for the next two hours</span>}
      </div>
      <div className="wx-axis wx-axis--even meta">
        <span>now</span>
        <span>+1 h</span>
        <span>+2 h</span>
      </div>
    </div>
  )
}

// The week: each day's low to high on one shared scale, today's current temperature as a dot.
export function WeekChart({ daily, nowC }) {
  const [lo, hi] = extent([...daily.minC, ...daily.maxC])
  const at = (v) => ((v - lo) / (hi - lo)) * 100
  return (
    <ol className="wx-week">
      {daily.time.map((t, i) => (
        <li key={t} className="wx-week__row meta">
          <span className="wx-week__day">{i === 0 ? 'today' : weekday(t)}</span>
          <span className="wx-week__rain">
            {daily.precipProb[i] != null && daily.precipProb[i] >= 10 ? `${round(daily.precipProb[i])}%` : ''}
          </span>
          <span className="wx-week__lo">{round(daily.minC[i])}°</span>
          <span className="wx-week__track">
            {daily.minC[i] != null && daily.maxC[i] != null && (
              <span
                className="wx-week__range"
                style={{ left: pct(at(daily.minC[i])), width: pct(at(daily.maxC[i]) - at(daily.minC[i])) }}
              />
            )}
            {i === 0 && nowC != null && <span className="wx-week__now" style={{ left: pct(clamp(at(nowC), 0, 100)) }} />}
          </span>
          <span className="wx-week__hi">{round(daily.maxC[i])}°</span>
        </li>
      ))}
    </ol>
  )
}

const weekday = (date) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00Z`)).toLowerCase()

// A ring gauge: value of max, the reading in the middle.
export function Ring({ value, max, children }) {
  const r = 22
  const c = 2 * Math.PI * r
  const f = value == null ? 0 : clamp(value / max, 0, 1)
  return (
    <span className="wx-ring">
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle className="wx-ring__track" cx="28" cy="28" r={r} />
        <circle className="wx-ring__fill" cx="28" cy="28" r={r} strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <span className="wx-ring__value">{children}</span>
    </span>
  )
}

// Wind: where it blows from on a compass rose, the arrow pointing downwind.
export function Compass({ fromDeg, bare = false }) {
  return (
    <span className={`wx-compass${bare ? ' wx-compass--bare' : ''}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="wx-ring__track" cx="50" cy="50" r="40" />
        {!bare &&
          Array.from({ length: 36 }, (_, i) => (
            <line key={i} className="wx-tick" x1="50" y1={i % 9 === 0 ? 13 : 11} x2="50" y2="16" transform={`rotate(${i * 10} 50 50)`} />
          ))}
        {fromDeg != null && (
          <g transform={`rotate(${fromDeg + 180} 50 50)`}>
            <line className="wx-compass__shaft" x1="50" y1="76" x2="50" y2="28" />
            <path className="wx-compass__head" d="M50 20 L57 32 L50 29 L43 32 Z" />
            <circle className="wx-compass__tail" cx="50" cy="78" r="3.2" />
          </g>
        )}
      </svg>
      {!bare &&
        ['N', 'E', 'S', 'W'].map((d) => (
          <span key={d} className={`wx-compass__pt wx-compass__pt--${d}`}>
            {d}
          </span>
        ))}
    </span>
  )
}

// The sun's day: an arc from sunrise to sunset, the sun where it is now.
export function SunArc({ rise, set, nowMin }) {
  const f = rise != null && set != null && set > rise ? (nowMin - rise) / (set - rise) : null
  const up = f != null && f >= 0 && f <= 1
  const a = Math.PI * (1 - clamp(f ?? 0, 0, 1))
  const sx = 100 + 82 * Math.cos(a)
  const sy = 92 - 74 * Math.sin(a)
  const id = useId()
  return (
    <svg className="wx-sun" viewBox="0 0 200 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--ui-lavender)" />
          <stop offset="0.5" stopColor="var(--ui-peach)" />
          <stop offset="1" stopColor="var(--ui-lavender)" />
        </linearGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor="#fff6ee" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="var(--ui-peach)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--ui-peach)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <line className="wx-grid" x1="8" x2="192" y1="92" y2="92" />
      <path className="wx-sun__path" d="M18 92 A82 74 0 0 1 182 92" />
      {up && <path d={`M18 92 A82 74 0 0 1 ${sx} ${sy}`} fill="none" stroke={`url(#${id}s)`} strokeWidth="2.5" strokeLinecap="round" />}
      {up && <circle cx={sx} cy={sy} r="14" fill={`url(#${id}g)`} />}
      {up && <circle cx={sx} cy={sy} r="4.5" fill="#fff8f2" />}
    </svg>
  )
}

// The edges' versions (CityType.jsx): thin, translucent, no axes but a few hours, no hover. They sit
// over the city itself, so they say little and let it show through.

// The next 24 hours' temperature as one soft line along the top of the screen.
export function TempRibbon({ hourly }) {
  const id = useId()
  const temps = hourly.tempC
  const n = temps.length
  const [lo, hi] = extent(temps, 0.12)
  const x = (i) => (i / (n - 1)) * 100
  const y = (v) => 100 - ((v - lo) / (hi - lo)) * 100
  const pts = temps.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean)
  const line = smoothPath(pts)
  const finite = temps.filter((v) => v != null)
  const iMax = temps.indexOf(Math.max(...finite))
  const iMin = temps.indexOf(Math.min(...finite))
  const marks = []
  for (const i of [0, iMax, iMin]) if (i >= 0 && temps[i] != null && marks.every((j) => Math.abs(i - j) > 2)) marks.push(i)
  return (
    <div className="wx-ribbon">
      <div className="wx-plot wx-ribbon__plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.08" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.92" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={`${id}m`}>
              <rect x="-5" y="-50" width="110" height="200" fill={`url(#${id}f)`} />
            </mask>
          </defs>
          <path d={line} className="wx-line wx-line--temp wx-line--soft" vectorEffect="non-scaling-stroke" mask={`url(#${id}m)`} />
        </svg>
        {marks.map((i) => (
          <span
            key={i}
            className={`wx-dot wx-dot--small${i === 0 ? ' wx-dot--now' : ''}`}
            style={{ left: pct(x(i)), top: pct(y(temps[i])) }}
          >
            <span className={`wx-dot__label${y(temps[i]) > 55 ? ' is-below' : ''}${x(i) < 8 ? ' is-start' : x(i) > 92 ? ' is-end' : ''}`}>
              {i === 0 ? 'now ' : ''}
              {round(temps[i])}°{i > 0 ? ` · ${hourOf(hourly.time[i])}:00` : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// The next 24 hours' chance of rain as hairline bars along the bottom of the screen.
export function RainRibbon({ hourly }) {
  const n = hourly.time.length
  const x = (i) => (i / (n - 1)) * 100
  return (
    <div className="wx-ribbon wx-ribbon--rain">
      <div className="wx-plot wx-ribbon__bars">
        {hourly.precipProb.map((p, i) => (
          <span key={i} className="wx-bar wx-bar--thin" style={{ left: pct(x(i)), height: pct(Math.max(4, p ?? 0)) }} />
        ))}
      </div>
      <div className="wx-axis meta">
        {hourly.time.map((t, i) =>
          i % 6 === 0 ? (
            <span key={t} style={{ left: pct(x(i)) }}>
              {i === 0 ? 'now' : `${hourOf(t)}:00`}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}
