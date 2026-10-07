// Everything Open-Meteo knows about one city, for the stats inside the dive drop (ui/CityType.jsx): the
// current reading in full, the next 24 hours, the week, the next two hours of rain and the air. Two
// requests (forecast and air quality, both free, no key, CC BY 4.0 like content/weather.js), made only
// for the dive city. Either can fail on its own: its part is then null, and the panel leaves it out
// rather than inventing a reading.

const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const TIMEOUT_MS = 20000

const CURRENT = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'is_day',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'visibility',
  'uv_index',
]
const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'cloud_cover',
  'relative_humidity_2m',
  'wind_speed_10m',
]
const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'precipitation_sum',
  'precipitation_probability_max',
  'uv_index_max',
  'wind_speed_10m_max',
]

async function getJson(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Times come back in the city's own zone (timezone=auto) without a suffix: they are kept as local
// wall-clock strings ("2026-10-06T14:00"), which is what the panel prints.
export async function fetchCityDetail(city) {
  const where = { latitude: city.lat, longitude: city.lon, timezone: 'auto' }
  const forecast = new URLSearchParams({
    ...where,
    current: CURRENT.join(','),
    hourly: HOURLY.join(','),
    forecast_hours: '24',
    daily: DAILY.join(','),
    forecast_days: '7',
    minutely_15: 'precipitation',
    forecast_minutely_15: '8',
    wind_speed_unit: 'kmh',
  })
  const air = new URLSearchParams({ ...where, current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide' })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const [fc, aq] = await Promise.allSettled([getJson(`${FORECAST}?${forecast}`, ctrl.signal), getJson(`${AIR}?${air}`, ctrl.signal)])
    if (fc.status === 'rejected') console.warn('[weather] detail unavailable:', fc.reason?.message)
    return parseDetail(fc.status === 'fulfilled' ? fc.value : null, aq.status === 'fulfilled' ? aq.value : null)
  } finally {
    clearTimeout(timer)
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const column = (block, key) => (block?.time ?? []).map((_, i) => num(block?.[key]?.[i]))

export function parseDetail(fc, aq) {
  const c = fc?.current
  const current = c
    ? {
        time: c.time,
        code: num(c.weather_code),
        isDay: c.is_day === 1,
        tempC: num(c.temperature_2m),
        feelsC: num(c.apparent_temperature),
        humidity: num(c.relative_humidity_2m),
        dewPointC: num(c.dew_point_2m),
        precipMm: num(c.precipitation),
        // `current` sums are over its interval (900 s): an hourly rate, rain and showers together.
        mmPerHour: c.rain == null ? null : (((c.rain ?? 0) + (c.showers ?? 0)) * 3600) / (c.interval || 900),
        snowCm: num(c.snowfall),
        cloud: num(c.cloud_cover),
        pressureHpa: num(c.pressure_msl),
        windKmh: num(c.wind_speed_10m),
        gustKmh: num(c.wind_gusts_10m),
        windFromDeg: num(c.wind_direction_10m),
        visibilityM: num(c.visibility),
        uv: num(c.uv_index),
      }
    : null
  const h = fc?.hourly
  const hourly = h?.time?.length
    ? {
        time: h.time,
        tempC: column(h, 'temperature_2m'),
        feelsC: column(h, 'apparent_temperature'),
        precipProb: column(h, 'precipitation_probability'),
        precipMm: column(h, 'precipitation'),
        cloud: column(h, 'cloud_cover'),
        humidity: column(h, 'relative_humidity_2m'),
        windKmh: column(h, 'wind_speed_10m'),
      }
    : null
  const d = fc?.daily
  const daily = d?.time?.length
    ? {
        time: d.time,
        code: column(d, 'weather_code'),
        maxC: column(d, 'temperature_2m_max'),
        minC: column(d, 'temperature_2m_min'),
        sunrise: d.sunrise ?? [],
        sunset: d.sunset ?? [],
        daylightS: column(d, 'daylight_duration'),
        precipMm: column(d, 'precipitation_sum'),
        precipProb: column(d, 'precipitation_probability_max'),
        uvMax: column(d, 'uv_index_max'),
        windMaxKmh: column(d, 'wind_speed_10m_max'),
      }
    : null
  const m = fc?.minutely_15
  const nowcast = m?.time?.length ? { time: m.time, precipMm: column(m, 'precipitation') } : null
  const a = aq?.current
  const air = a ? { usAqi: num(a.us_aqi), pm25: num(a.pm2_5), pm10: num(a.pm10), ozone: num(a.ozone), no2: num(a.nitrogen_dioxide) } : null
  if (!current && !hourly && !daily && !air) return null
  return { current, hourly, daily, nowcast, air, elevationM: num(fc?.elevation), tzAbbr: fc?.timezone_abbreviation ?? null }
}
