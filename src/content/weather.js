// Current weather for every city in one Open-Meteo request (free for non-commercial use, no key).
// Any failure resolves to clear weather, so the site never waits on or breaks because of the API.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 4000

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

// Returns { [cityId]: { variant, label, tempC } }. Cities missing from the response get clear.
export async function fetchWeather(cities) {
  const params = new URLSearchParams({
    latitude: cities.map((c) => c.lat).join(','),
    longitude: cities.map((c) => c.lon).join(','),
    current: 'weather_code,temperature_2m',
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
        return [c.id, { ...describeWeather(cur?.weather_code), tempC: cur?.temperature_2m ?? null }]
      })
    )
  } catch (err) {
    console.warn('[weather] unavailable, assuming clear:', err.message)
    return Object.fromEntries(cities.map((c) => [c.id, { ...describeWeather(null), tempC: null }]))
  } finally {
    clearTimeout(timer)
  }
}
