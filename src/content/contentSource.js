// What the city drops show: 'sky' (each city's sky, computed from its real sun, moon, stars and
// weather) or 'footage' (licensed clips, with the video budget, poster atlas and decoder pins).
// The choice is CONTENT.source in config.js; these helpers take it as an argument so they run in tests.

export const usesFootage = (source) => source === 'footage'

// Light and weather as the visitor will see them. Footage shows the clip that actually plays (a
// missing rain clip falls back to clear, so it doesn't count as rain); the sky shows the world as it is.
export function shown(row, source) {
  if (!usesFootage(source)) return { light: row.light, weather: row.weather }
  if (!row.clip) return null
  const [, light, weather] = row.clip.split('_') // city ids are kebab-case, so "_" splits cleanly
  return { light, weather }
}

export const isRaining = (row, source) => shown(row, source)?.weather === 'rain'
