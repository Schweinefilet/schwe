import { CITIES } from '../config.js'

// The cities as they are right now: name, and its local time and weather. The answer's city in peach.
// Used by the still page and by the final screen's sheet.
export default function CityList({ clips, rainCity }) {
  const byCity = Object.fromEntries((clips ?? []).map((c) => [c.city, c]))
  return (
    <ul className="city-list">
      {CITIES.map((c) => {
        const row = byCity[c.id]
        return (
          <li key={c.id} className={c.id === rainCity?.city ? 'is-answer' : undefined}>
            <span className="city-list__name">{c.name}</span>
            <span className="city-list__meta">{row ? [row.localTime, row.weatherLabel].filter(Boolean).join(' · ') : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}
