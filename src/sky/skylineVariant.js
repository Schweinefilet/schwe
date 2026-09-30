// Which of a city's rendered skylines to show this month (public/skyline/<city>.json: its trees in leaf
// or bare): the variant whose months include it, else the first listed; null when there is none.
export function skylineVariant(meta, month) {
  const entries = Object.entries(meta?.variants ?? {})
  return (entries.find(([, v]) => v.months?.includes(month)) ?? entries[0])?.[0] ?? null
}
