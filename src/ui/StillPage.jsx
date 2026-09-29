import { CITIES, SKY } from '../config.js'

// Attribution the atlas license (CC BY-NC 4.0) asks for, shown once its values light the skies.
const atlas = SKY.cityGlow.atlas
const ATLAS_CREDIT = Object.keys(atlas.values).length > 0

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
      {ATLAS_CREDIT && (
        <p className="still__credit">
          Night sky brightness: Falchi et al. 2016, The New World Atlas of Artificial Night Sky Brightness,{' '}
          <a href="https://doi.org/10.1126/sciadv.1600377">Science Advances</a> and{' '}
          <a href="https://doi.org/10.5880/GFZ.1.4.2016.001">GFZ Data Services</a>,{' '}
          <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>; sampled at each city
          {atlas.source?.startsWith('lightpollutionmap') ? ', read via Jurij Stare, www.lightpollutionmap.info' : ''}.
        </p>
      )}
    </main>
  )
}
