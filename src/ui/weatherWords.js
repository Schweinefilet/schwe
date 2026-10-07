// Words and small conversions for the weather inside the dive drop (CityType.jsx, WeatherPanel.jsx).
import { round } from './weatherCharts.jsx'

// One or two plain sentences about the next 24 hours, read off the hourly forecast.
export function outlook(h) {
  const hh = (i) => `${h.time[i].slice(11, 13)}:00`
  const wet = (i) => (h.precipProb[i] ?? 0) >= 50
  const n = h.time.length
  let rain
  if (wet(0)) {
    const end = h.time.findIndex((_, i) => i > 0 && (h.precipProb[i] ?? 0) < 40)
    rain = end < 0 ? 'Rain likely all day and night.' : `Rain likely until about ${hh(end)}, then easing.`
  } else {
    const start = h.time.findIndex((_, i) => wet(i))
    const peak = Math.max(0, ...h.precipProb.filter((v) => v != null))
    rain =
      start >= 0
        ? `Rain likely from about ${hh(start)}.`
        : peak >= 20
          ? `A ${round(peak)}% chance of a shower.`
          : 'Staying dry for the next day.'
  }
  const temps = h.tempC.map((v) => v ?? NaN)
  const iMin = temps.indexOf(Math.min(...temps.filter(Number.isFinite)))
  const iMax = temps.indexOf(Math.max(...temps.filter(Number.isFinite)))
  const next =
    iMin > 0 && (iMax <= 0 || iMin < iMax)
      ? `Cooling to ${round(temps[iMin])}° by ${hh(iMin)}.`
      : iMax > 0
        ? `Warming to ${round(temps[iMax])}° by ${hh(iMax)}.`
        : ''
  return n ? `${rain} ${next}`.trim() : null
}

// At night the arc is empty: say when the sun comes back.
export function sunDown(today, time) {
  const t = minutesOf(time)
  const rise = minutesOf(today.sunrise[0])
  const set = minutesOf(today.sunset[0])
  if (t == null || rise == null || set == null || (t >= rise && t <= set)) return null
  const next = t < rise ? today.sunrise[0] : today.sunrise[1]
  return next ? `below the horizon · up at ${next.slice(11, 16)}` : 'below the horizon'
}

export const minutesOf = (s) => {
  const m = /(\d{2}):(\d{2})/.exec(s ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export const compassPoint = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
export const visibility = (m) => (m >= 10000 ? round(m / 1000) : (m / 1000).toFixed(1))
export const daylight = (s) => (s == null ? null : `${Math.floor(s / 3600)} h ${round((s % 3600) / 60)} min of daylight`)

export function rainNote(cur) {
  if (cur?.mmPerHour == null) return null
  return cur.mmPerHour > 0 ? `${cur.mmPerHour.toFixed(1)} mm/h now` : 'none falling now'
}
export function cloudWord(c) {
  if (c < 12) return 'clear'
  if (c < 40) return 'a few clouds'
  if (c < 75) return 'partly cloudy'
  if (c < 95) return 'mostly cloudy'
  return 'overcast'
}
export function uvWord(u) {
  if (u < 3) return 'low'
  if (u < 6) return 'moderate'
  if (u < 8) return 'high'
  if (u < 11) return 'very high'
  return 'extreme'
}
export function aqiWord(a) {
  if (a <= 50) return 'good'
  if (a <= 100) return 'moderate'
  if (a <= 150) return 'unhealthy for some'
  if (a <= 200) return 'unhealthy'
  return 'very unhealthy'
}
// Beaufort, by wind at 10 m in km/h.
const BEAUFORT = [
  [1, 'calm'],
  [6, 'light air'],
  [12, 'light breeze'],
  [20, 'gentle breeze'],
  [29, 'moderate breeze'],
  [39, 'fresh breeze'],
  [50, 'strong breeze'],
  [62, 'near gale'],
  [75, 'gale'],
  [89, 'strong gale'],
  [103, 'storm'],
  [118, 'violent storm'],
]
export const beaufort = (kmh) => (kmh == null ? null : (BEAUFORT.find(([max]) => kmh < max)?.[1] ?? 'hurricane force'))
