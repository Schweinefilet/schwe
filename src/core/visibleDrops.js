// Which of the drift's drops a tier showing `shown` of its `total` shows: spread evenly along it, so on
// every tier the drift has drops from its start to the dive, and each of its slow points one in view
// (config.js times the camera's slow points to these, driftFor).
export function driftSlots(shown, total) {
  if (shown >= total) return Array.from({ length: total }, (_, i) => i)
  return Array.from({ length: Math.max(shown, 0) }, (_, i) => Math.round(((i + 0.5) * total) / shown - 0.5))
}

// The drops a tier shows (quality.heroDrops of them): the dive drop always, then the drift's drops at
// driftSlots. `keep`: a city that must be among them (the ending's rain city, so the city the answer
// names has been seen on every tier). If the tier would leave it out, it takes the last shown drop's
// place; positions never change.
export function visibleDrops(drops, count, keep = null) {
  const drift = drops.filter((d) => !d.dive)
  const shown = driftSlots(count - 1, drift.length).map((i) => drift[i])
  if (keep && shown.length && !shown.some((d) => d.city === keep) && drift.some((d) => d.city === keep)) {
    shown[shown.length - 1] = { ...shown[shown.length - 1], city: keep }
  }
  return [...drops.filter((d) => d.dive), ...shown]
}
