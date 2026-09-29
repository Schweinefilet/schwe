import { shown } from './contentSource.js'

// Picks the city the camera dives into: the most interesting one right now, judged by what its drop
// will show (contentSource.js: the sky as it is, or the clip that actually plays).
const LIGHT_SCORE = { dusk: 2, dawn: 2, night: 1, day: 0 }
const RAIN_SCORE = 3

function score(row, source) {
  const s = shown(row, source)
  if (!s) return -Infinity
  return (s.weather === 'rain' ? RAIN_SCORE : 0) + (LIGHT_SCORE[s.light] ?? 0)
}

// `selection`: rows from selectClips(). Ties are broken at random, so visits vary. `exclude`: a city
// that must not be picked (the ending's rain city, so the visitor sees two different cities).
// `source`: CONTENT.source ('sky' or 'footage').
export function chooseDiveCity(selection, fallback, { exclude = null, random = Math.random, source = 'sky' } = {}) {
  let best = []
  let bestScore = -Infinity
  for (const row of selection ?? []) {
    if (row.city === exclude) continue
    const s = score(row, source)
    if (s > bestScore) {
      best = [row]
      bestScore = s
    } else if (s === bestScore) best.push(row)
  }
  if (!best.length || bestScore === -Infinity) return fallback
  return best[Math.floor(random() * best.length)].city
}
