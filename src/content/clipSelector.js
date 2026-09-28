import { FALLBACK_WEATHER, clipId } from './naming.js'
import { clipUrls } from './manifest.js'

function cityClock(city, date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: city.tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  return { hour: get('hour'), minute: get('minute') }
}

export function localTimeString(city, date = new Date()) {
  const { hour, minute } = cityClock(city, date)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// TODO(SunCalc): replace fixed hour bands with sun altitude at city.lat/city.lon:
//   SunCalc.getPosition(date, lat, lon).altitude, plus getTimes() for dawn/dusk boundaries.
//   Keep the return values identical: 'night' | 'dawn' | 'day' | 'dusk'.
export function lightStateAt(city, date = new Date()) {
  const { hour } = cityClock(city, date)
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 21) return 'dusk'
  return 'night'
}

// TODO(Open-Meteo): fetch current weather for city.lat/city.lon
//   (https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=weather_code,precipitation)
//   and map WMO weather codes to 'rain' | 'clear'. Batch all cities into one request, cache,
//   and resolve to FALLBACK_WEATHER on any error or timeout.
export async function weatherFor(_city) {
  return FALLBACK_WEATHER
}

// Fallback chain: exact match, then the same light in clear weather, then any clear clip for the city,
// then any clip for the city. Returns a manifest entry or null.
export function pickClip(manifest, cityId, light, weather) {
  const byId = new Map(manifest.clips.map((c) => [c.id, c]))
  const forCity = manifest.clips.filter((c) => c.city === cityId)
  return (
    byId.get(clipId(cityId, light, weather)) ??
    byId.get(clipId(cityId, light, FALLBACK_WEATHER)) ??
    forCity.find((c) => c.weather === FALLBACK_WEATHER) ??
    forCity[0] ??
    null
  )
}

export async function selectClips(manifest, cities, date = new Date()) {
  return Promise.all(
    cities.map(async (city) => {
      const light = lightStateAt(city, date)
      const weather = await weatherFor(city)
      const entry = pickClip(manifest, city.id, light, weather)
      return {
        city: city.id,
        name: city.name,
        localTime: localTimeString(city, date),
        light,
        weather,
        clip: entry?.id ?? null,
        urls: clipUrls(entry),
      }
    })
  )
}
