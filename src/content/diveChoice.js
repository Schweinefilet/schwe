// Picks the city the camera dives into: the most interesting one right now, judged by the clip that
// will actually play (a missing rain clip falls back to clear, so it doesn't count as rain).
const LIGHT_SCORE = { dusk: 2, dawn: 2, night: 1, day: 0 }
const RAIN_SCORE = 3

function score(row) {
  if (!row.clip) return -Infinity
  const [, light, weather] = row.clip.split('_') // city ids are kebab-case, so "_" splits cleanly
  return (weather === 'rain' ? RAIN_SCORE : 0) + (LIGHT_SCORE[light] ?? 0)
}

// `selection`: rows from selectClips(). Ties are broken at random, so visits vary. `exclude`: a city
// that must not be picked (the ending's rain city, so the visitor sees two different cities).
export function chooseDiveCity(selection, fallback, { exclude = null, random = Math.random } = {}) {
  let best = []
  let bestScore = -Infinity
  for (const row of selection ?? []) {
    if (row.city === exclude) continue
    const s = score(row)
    if (s > bestScore) {
      best = [row]
      bestScore = s
    } else if (s === bestScore) best.push(row)
  }
  if (!best.length || bestScore === -Infinity) return fallback
  return best[Math.floor(random() * best.length)].city
}
