import { CITIES } from '../config.js'
import { answerLines } from './answer.js'
import Credits from './Credits.jsx'

// For prefers-reduced-motion and for devices without usable WebGL (bible): one still frame of the
// frozen rain, the question and its answer, then the cities as they are right now. Nothing moves.
export default function StillPage({ clips, rainCity }) {
  const byCity = Object.fromEntries((clips ?? []).map((c) => [c.city, c]))
  const answerCity = CITIES.find((c) => c.id === rainCity?.city)
  const [headline, meta, rate] = answerLines(rainCity, answerCity, answerCity ? byCity[answerCity.id]?.localTime : '', clips)
  return (
    <main className="still">
      <figure className="still__frame">
        <img src={`${import.meta.env.BASE_URL}still.jpg`} alt="Rain frozen in mid-air over a lit square at night; one drop holds a small inverted city." />
      </figure>
      <header className="still__head">
        <h1 className="still__word">schwe</h1>
        <p className="still__question">where is it raining now?</p>
      </header>
      <section className="still__answer" aria-live="polite">
        {headline ? (
          <>
            <p className="still__headline">{headline}</p>
            {meta && (
              <p className="still__meta">
                {meta}
                {rate && (
                  <>
                    {' · '}
                    <span className="still__unit">{rate}</span>
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="still__meta">reading the weather…</p>
        )}
      </section>
      <ul className="still__cities">
        {CITIES.map((c) => {
          const row = byCity[c.id]
          return (
            <li key={c.id} className={c.id === rainCity?.city ? 'is-answer' : undefined}>
              <span className="still__city">{c.name}</span>
              <span className="still__cityMeta">{row ? [row.localTime, row.weatherLabel].filter(Boolean).join(' · ') : ''}</span>
            </li>
          )
        })}
      </ul>
      <Credits long className="still__credit" />
    </main>
  )
}
