import { CITIES } from '../config.js'

// For prefers-reduced-motion and for devices without usable WebGL (bible): one still frame of the
// frozen rain, then the cities as they are right now. Nothing moves.
export default function StillPage({ clips }) {
  const byCity = Object.fromEntries((clips ?? []).map((c) => [c.city, c]))
  return (
    <main className="still">
      <figure className="still__frame">
        <img src={`${import.meta.env.BASE_URL}still.jpg`} alt="Rain frozen in mid-air at night, each drop holding a small inverted city." />
      </figure>
      <h1 className="still__word">schwe</h1>
      <ul className="still__cities">
        {CITIES.map((c) => {
          const row = byCity[c.id]
          return (
            <li key={c.id}>
              <span className="still__city">{c.name}</span>
              <span className="still__meta">
                {row ? `${row.localTime} · ${row.weatherLabel}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
