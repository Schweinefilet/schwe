import { getPosition } from 'suncalc'
import { FALLBACK_WEATHER, clipId } from './naming.js'
import { clipUrls } from './manifest.js'
import { fetchWeather } from './weather.js'

export function localTimeString(city, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: city.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

// suncalc 2 returns the apparent altitude in degrees, refraction included.
const altitudeAt = (city, date) => getPosition(date, city.lat, city.lon).altitude

// Light state from the sun's real altitude at the city (bible): night below −6°, day above 6°,
// dawn or dusk in between. Rising vs setting is read from the altitude ten minutes later, which
// works at any latitude and date without relying on sunrise/sunset times existing.
export function lightStateAt(city, date = new Date()) {
  const alt = altitudeAt(city, date)
  if (alt < -6) return 'night'
  if (alt > 6) return 'day'
  const rising = altitudeAt(city, new Date(date.getTime() + 10 * 60 * 1000)) > alt
  return rising ? 'dawn' : 'dusk'
}

// Fallback chain: exact match, then the same light in clear weather (bible), then any clear clip for
// the city, then any clip for the city. Returns a manifest entry or null.
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

// One row per city: what to show and the facts for the on-screen type.
// `weather` can be passed in (tests, or a cached result); otherwise it is fetched.
export async function selectClips(manifest, cities, date = new Date(), weather = null) {
  const wx = weather ?? (await fetchWeather(cities))
  return cities.map((city) => {
    const light = lightStateAt(city, date)
    const w = wx[city.id] ?? { variant: FALLBACK_WEATHER, label: 'clear', tempC: null }
    const entry = pickClip(manifest, city.id, light, w.variant)
    return {
      city: city.id,
      name: city.name,
      localTime: localTimeString(city, date),
      light,
      weather: w.variant,
      weatherLabel: w.label,
      tempC: w.tempC,
      clip: entry?.id ?? null,
      urls: clipUrls(entry),
    }
  })
}
