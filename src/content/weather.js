// Current weather for every city in one Open-Meteo request (free for non-commercial use, no key).
// Any failure resolves to clear weather, so the site never waits on or breaks because of the API.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 4000
const RAIN_MM = 0.1 // a 15-minute forecast slot with at least this much rain counts as rain arriving

// WMO weather code → clip variant and a short label for the on-screen type.
// Fog and cloud count as clear for clip choice (bible: launch set).
export function describeWeather(code) {
  if (code == null) return { variant: 'clear', label: 'clear' }
  if (code === 0) return { variant: 'clear', label: 'clear' }
  if (code <= 2) return { variant: 'clear', label: 'partly cloudy' }
  if (code === 3) return { variant: 'clear', label: 'overcast' }
  if (code === 45 || code === 48) return { variant: 'clear', label: 'fog' }
  if (code >= 51 && code <= 57) return { variant: 'rain', label: 'drizzle' }
  if (code === 61 || code === 80) return { variant: 'rain', label: 'light rain' }
  if (code === 63 || code === 81) return { variant: 'rain', label: 'rain' }
  if (code === 65 || code === 82) return { variant: 'rain', label: 'heavy rain' }
  if (code === 66 || code === 67) return { variant: 'rain', label: 'freezing rain' }
  if (code >= 71 && code <= 77) return { variant: 'snow', label: code === 77 ? 'snow grains' : 'snow' }
  if (code === 85 || code === 86) return { variant: 'snow', label: 'snow showers' }
  if (code >= 95) return { variant: 'rain', label: 'thunderstorm' }
  return { variant: 'clear', label: 'clear' }
}

// Returns { [cityId]: { code, variant, label, tempC, mmPerHour, rainInMinutes, cloudCover, windMs, windFromDeg } }.
// Cities missing from the response get clear. Rain amounts count rain and showers only, never snow.
// mmPerHour: current rain rate. rainInMinutes: minutes until the first 15-minute slot in the next 6 h
// with rain (0 = the current slot), or null. cloudCover: total cloud cover 0..1, or null. windMs: wind at
// 10 m (m/s), windFromDeg: where it blows from (clockwise from north), each null when missing.
export async function fetchWeather(cities) {
  const params = new URLSearchParams({
    latitude: cities.map((c) => c.lat).join(','),
    longitude: cities.map((c) => c.lon).join(','),
    current: 'weather_code,temperature_2m,rain,showers,cloud_cover,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms',
    minutely_15: 'rain,showers',
    forecast_minutely_15: '24',
    timezone: 'UTC',
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = Array.isArray(data) ? data : [data] // one location returns an object, several an array
    return Object.fromEntries(
      cities.map((c, i) => {
        const cur = list[i]?.current
        return [
          c.id,
          {
            ...describeWeather(cur?.weather_code),
            code: cur?.weather_code ?? null,
            tempC: cur?.temperature_2m ?? null,
            mmPerHour: rainRate(cur),
            rainInMinutes: minutesUntilRain(list[i]?.minutely_15, cur?.time),
            cloudCover: cur?.cloud_cover == null ? null : cur.cloud_cover / 100,
            windMs: cur?.wind_speed_10m ?? null,
            windFromDeg: cur?.wind_direction_10m ?? null,
          },
        ]
      })
    )
  } catch (err) {
    console.warn('[weather] unavailable, assuming clear:', err.message)
    return Object.fromEntries(
      cities.map((c) => [c.id, { ...describeWeather(null), code: null, tempC: null, mmPerHour: null, rainInMinutes: null, cloudCover: null, windMs: null, windFromDeg: null }])
    )
  } finally {
    clearTimeout(timer)
  }
}

// `current` values are sums over its interval (900 s), so scale them to an hourly rate.
function rainRate(cur) {
  if (!cur || cur.rain == null) return null
  const mm = (cur.rain ?? 0) + (cur.showers ?? 0)
  return (mm * 3600) / (cur.interval || 900)
}

// Times are UTC (timezone=UTC in the request) without a zone suffix.
const utc = (t) => Date.parse(`${t}Z`)

function minutesUntilRain(m15, nowTime) {
  if (!m15?.time || !nowTime) return null
  const now = utc(nowTime)
  for (let i = 0; i < m15.time.length; i++) {
    if ((m15.rain?.[i] ?? 0) + (m15.showers?.[i] ?? 0) >= RAIN_MM) return Math.max(0, Math.round((utc(m15.time[i]) - now) / 60000))
  }
  return null
}
