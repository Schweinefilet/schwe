// The ending answers "where is it raining hardest right now?". Only cities whose rain clip actually
// plays count as raining (a missing rain clip falls back to clear, and the drop must show rain).
// Returns one of:
//   { kind: 'now',  city, mmPerHour, label }   hardest rain right now
//   { kind: 'soon', city, minutes }            nowhere raining: the city rain reaches first (next 6 h)
//   { kind: 'none' }                           no rain now or in the next 6 h in any city

// Heavier first; ties on rain rate fall back to how the weather code describes it.
const SEVERITY = ['drizzle', 'freezing rain', 'light rain', 'rain', 'heavy rain', 'thunderstorm']
const severity = (label) => SEVERITY.indexOf(label)

export function chooseRainCity(selection) {
  const rows = (selection ?? []).filter((r) => r.clip)

  const raining = rows.filter((r) => r.clip.endsWith('_rain'))
  if (raining.length) {
    raining.sort((a, b) => (b.mmPerHour ?? 0) - (a.mmPerHour ?? 0) || severity(b.weatherLabel) - severity(a.weatherLabel))
    const r = raining[0]
    return { kind: 'now', city: r.city, mmPerHour: r.mmPerHour, label: r.weatherLabel }
  }

  const soon = rows.filter((r) => r.rainInMinutes != null).sort((a, b) => a.rainInMinutes - b.rainInMinutes)
  if (soon.length) return { kind: 'soon', city: soon[0].city, minutes: soon[0].rainInMinutes }

  return { kind: 'none' }
}
