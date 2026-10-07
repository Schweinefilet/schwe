import { SKY } from '../config.js'

// The data the site shows, credited as each license asks: the weather (Open-Meteo, CC BY 4.0), the
// night-sky brightness (the World Atlas, CC BY-NC 4.0; only once its values light the skies) and the
// skylines (OpenStreetMap, ODbL; terrain from the USGS, via Mapzen). Shown on the still page and in the
// final screen's sheet.
const atlas = SKY.cityGlow.atlas
const ATLAS = Object.keys(atlas.values).length > 0
const VIA_LPM = atlas.source?.startsWith('lightpollutionmap')

const link = (href, text) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
)

// One line per source: what it is, lowercase like the meta lines, then the source with its own capitals
// (as a city keeps its name).
export default function Credits({ className = '' }) {
  return (
    <dl className={`credits ${className}`.trim()}>
      <div>
        <dt>weather</dt>
        <dd>
          {link('https://open-meteo.com/', 'Open-Meteo.com')}, {link('https://creativecommons.org/licenses/by/4.0/', 'CC\u00a0BY\u00a04.0')}
        </dd>
      </div>
      {ATLAS && (
        <div>
          <dt>night sky brightness</dt>
          <dd>
            Falchi et al. 2016, The New World Atlas of Artificial Night Sky Brightness, {link('https://doi.org/10.1126/sciadv.1600377', 'Science Advances')} and{' '}
            {link('https://doi.org/10.5880/GFZ.1.4.2016.001', 'GFZ Data Services')}, {link('https://creativecommons.org/licenses/by-nc/4.0/', 'CC\u00a0BY-NC\u00a04.0')};
            sampled at each city{VIA_LPM ? ', read via Jurij Stare, www.lightpollutionmap.info' : ''}
          </dd>
        </div>
      )}
      <div>
        <dt>skylines</dt>
        <dd>
          building data © {link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors')}, {link('https://opendatacommons.org/licenses/odbl/', 'ODbL')};
          terrain data courtesy of the U.S. Geological Survey (3DEP), via Mapzen’s terrain tiles
        </dd>
      </div>
    </dl>
  )
}
