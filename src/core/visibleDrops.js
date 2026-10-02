// The drops a tier shows (quality.heroDrops of them): the dive drop always, then the first of the rest.
// `keep`: a city that must be among them (the ending's rain city, so the city the answer names has been
// seen on every tier). If the tier would leave it out, it takes the last shown drop's place; positions
// never change.
export function visibleDrops(drops, count, keep = null) {
  const shown = drops.filter((d) => !d.dive).slice(0, count - 1)
  if (keep && shown.length && !shown.some((d) => d.city === keep) && drops.some((d) => !d.dive && d.city === keep)) {
    shown[shown.length - 1] = { ...shown[shown.length - 1], city: keep }
  }
  return [...drops.filter((d) => d.dive), ...shown]
}
