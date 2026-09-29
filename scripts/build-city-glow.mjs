#!/usr/bin/env node
// Writes src/content/cityGlow.json: each city's artificial zenith sky brightness (mcd/m², natural sky
// not included) from the World Atlas of Artificial Night Sky Brightness:
//   Falchi F, Cinzano P, Duriscoe D, Kyba CCM, Elvidge CD, Baugh K, Portnov B, Rybnikova NA,
//   Furgoni R (2016). Supplement to: The New World Atlas of Artificial Night Sky Brightness.
//   GFZ Data Services, doi:10.5880/GFZ.1.4.2016.001. License: CC BY-NC 4.0.
// Two ways in, both reading the same atlas values:
//   npm run sky:glow -- --in World_Atlas_2015.tif [--radius 2]
//       the GFZ GeoTIFF (request access on the DOI's landing page): mean of a (2r+1)² pixel window
//       around each city's coordinates in cities.json (radius 2: 5×5 pixels, about 4 km)
//   npm run sky:glow -- --values "sydney=…,tokyo=…,…"
//       point readouts of the World Atlas 2015 overlay on lightpollutionmap.info (FAQ 31), one per
//       city at the coordinates in cities.json; that site asks to be credited too
// Every city needs a value; nothing is filled in.

import { readFile, writeFile } from 'node:fs/promises'
import { fromFile } from 'geotiff'
import { sampleAtlas } from './lib/atlas.mjs'

const OUT = 'src/content/cityGlow.json'
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}
const cities = JSON.parse(await readFile('src/content/cities.json', 'utf8'))

let values
let source
if (arg('in')) {
  const radius = Number(arg('radius') ?? 2)
  const tiff = await fromFile(arg('in'))
  const image = await tiff.getImage()
  values = {}
  for (const c of cities) {
    const { mean, pixels } = await sampleAtlas(image, c.lat, c.lon, radius)
    values[c.id] = +mean.toPrecision(4)
    console.log(`${c.id.padEnd(12)} ${values[c.id]} mcd/m²  (${pixels} pixels)`)
  }
  source = `GFZ GeoTIFF, mean of ${2 * radius + 1}×${2 * radius + 1} pixels (30″) around each city`
} else if (arg('values')) {
  values = Object.fromEntries(
    arg('values')
      .split(',')
      .map((pair) => pair.split('=').map((s) => s.trim()))
      .map(([id, v]) => [id, Number(v)])
  )
  source = 'lightpollutionmap.info (Jurij Stare), World Atlas 2015 overlay, point readout at each city'
} else {
  console.error('usage: --in <World_Atlas_2015.tif> [--radius 2]  or  --values "sydney=…,tokyo=…"')
  process.exit(1)
}

const missing = cities.filter((c) => !Number.isFinite(values[c.id]) || values[c.id] < 0).map((c) => c.id)
if (missing.length) {
  console.error(`no usable value for: ${missing.join(', ')} (nothing written)`)
  process.exit(1)
}

const doc = JSON.parse(await readFile(OUT, 'utf8'))
await writeFile(OUT, JSON.stringify({ ...doc, source, values: Object.fromEntries(cities.map((c) => [c.id, values[c.id]])) }, null, 2) + '\n')
console.log(`→ ${OUT}`)
