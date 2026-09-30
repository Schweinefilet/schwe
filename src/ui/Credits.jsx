import { SKY } from '../config.js'

// The data the site shows, credited as each license asks: the weather (Open-Meteo, CC BY 4.0), the
// night-sky brightness (the World Atlas, CC BY-NC 4.0; only once its values light the skies) and the
// skylines (OpenStreetMap, ODbL; terrain from the USGS, via Mapzen). `long`: the still page's fuller
// wording; otherwise one compact line for the final screen.
const atlas = SKY.cityGlow.atlas
const ATLAS = Object.keys(atlas.values).length > 0
const VIA_LPM = atlas.source?.startsWith('lightpollutionmap')

const link = (href, text) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
)

export default function Credits({ long = false, className }) {
  if (long) {
    return (
      <div className={className}>
        <p>Weather: {link('https://open-meteo.com/', 'Open-Meteo.com')}, {link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}.</p>
        {ATLAS && (
          <p>
            Night sky brightness: Falchi et al. 2016, The New World Atlas of Artificial Night Sky Brightness,{' '}
            {link('https://doi.org/10.1126/sciadv.1600377', 'Science Advances')} and {link('https://doi.org/10.5880/GFZ.1.4.2016.001', 'GFZ Data Services')},{' '}
            {link('https://creativecommons.org/licenses/by-nc/4.0/', 'CC BY-NC 4.0')}; sampled at each city
            {VIA_LPM ? ', read via Jurij Stare, www.lightpollutionmap.info' : ''}.
          </p>
        )}
        <p>
          Skylines: building data © {link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')},{' '}
          {link('https://opendatacommons.org/licenses/odbl/', 'ODbL')}; terrain data courtesy of the U.S. Geological Survey (3DEP), via Mapzen's
          terrain tiles.
        </p>
      </div>
    )
  }
  return (
    <p className={className}>
      Weather: {link('https://open-meteo.com/', 'Open-Meteo.com')} (CC BY 4.0)
      {ATLAS && (
        <>
          {' · '}night sky: Falchi et al. 2016, {link('https://doi.org/10.1126/sciadv.1600377', 'World Atlas of Artificial Night Sky Brightness')} (CC BY-NC 4.0)
        </>
      )}
      {' · '}skylines: © {link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')}; terrain: USGS 3DEP, Mapzen
    </p>
  )
}
