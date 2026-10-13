#!/usr/bin/env node
// A city's OpenStreetMap data from a Geofabrik extract instead of the Overpass API (fetch.mjs), for when the
// public Overpass servers cannot answer (Paris, 2026-10-13: hours of 504s for a dense city's tiles). Needs
// osmium-tool (brew install osmium-tool) and the region's .osm.pbf in data/osm/pbf/ (gitignored):
//
//   curl -L -o data/osm/pbf/ile-de-france-latest.osm.pbf https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf
//   node scripts/skyline/pbf.mjs --city paris --pbf data/osm/pbf/ile-de-france-latest.osm.pbf [--only buildings|ground]
//
// Writes what fetch.mjs would, in Overpass's JSON shape (ways with their geometry; multipolygons as
// relations whose members carry theirs), for extract.mjs to read unchanged:
//   data/osm/<city>.json         every building and part in the view's box to FAR (extract.mjs keeps the
//                                 wedge, and beyond NEAR only those with a height or floors)
//   data/osm/<city>-ground.json  lawns, parks, squares, paths and roads, pitches, parking to GROUND
// © OpenStreetMap contributors, ODbL.

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const PBF = arg('pbf')
const ONLY = arg('only')
if (!CITY || !PBF) {
  console.error('usage: node scripts/skyline/pbf.mjs --city <id> --pbf <region.osm.pbf> [--only buildings|ground]')
  process.exit(1)
}
const RAD = Math.PI / 180
const FAR = 7000
const GROUND = 1900
const vantages = JSON.parse(await readFile(new URL('../../src/content/vantages.json', import.meta.url), 'utf8'))
const view = vantages[CITY]
const [lat0, lon0] = view.from.at
const bearingTo = ([a1, o1], [a2, o2]) =>
  Math.atan2(Math.sin((o2 - o1) * RAD) * Math.cos(a2 * RAD), Math.cos(a1 * RAD) * Math.sin(a2 * RAD) - Math.sin(a1 * RAD) * Math.cos(a2 * RAD) * Math.cos((o2 - o1) * RAD)) / RAD
const mean = (bs) => Math.atan2(bs.reduce((s, b) => s + Math.sin(b * RAD), 0), bs.reduce((s, b) => s + Math.cos(b * RAD), 0)) / RAD
const BEARING = (mean(view.toward.map((t) => bearingTo(view.from.at, t.at))) + 360) % 360
const [LEFT, RIGHT] = view.span ?? [-60, 60]

// The view's wedge (5 degrees margin) to r metres as a lon/lat box.
function box(r) {
  const pts = [[0, 0]]
  for (let a = LEFT - 5; a <= RIGHT + 5; a += 1) pts.push([r * Math.sin((BEARING + a) * RAD), r * Math.cos((BEARING + a) * RAD)])
  const kx = 111320 * Math.cos(lat0 * RAD)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [lon0 + (Math.min(...xs) - 100) / kx, lat0 + (Math.min(...ys) - 100) / 110540, lon0 + (Math.max(...xs) + 100) / kx, lat0 + (Math.max(...ys) + 100) / 110540]
}

function osmium(args) {
  const r = spawnSync('osmium', args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(`osmium ${args[0]} failed (${r.error?.message ?? r.status})`)
  return r.stdout
}

const TMP = new URL('../../data/osm/pbf/tmp/', import.meta.url)
await mkdir(TMP, { recursive: true })

// The features matching `filters` in the box, as Overpass-shaped elements.
function elements(bbox, filters, geometries) {
  const cut = new URL(`${CITY}-cut.osm.pbf`, TMP).pathname
  const sel = new URL(`${CITY}-sel.osm.pbf`, TMP).pathname
  osmium(['extract', '-b', bbox.map((v) => v.toFixed(6)).join(','), '-s', 'smart', '-O', '-o', cut, PBF])
  osmium(['tags-filter', '-O', '-o', sel, cut, ...filters])
  const out = osmium(['export', '-f', 'geojsonseq', '--add-unique-id=type_id', `--geometry-types=${geometries}`, '-x', 'print_record_separator=false', sel])
  const list = []
  for (const line of out.toString().split('\n')) {
    if (!line.trim()) continue
    const f = JSON.parse(line)
    // Ids: w<id> and r<id> for lines; an area is a<n>, from way n / 2 (even) or relation (n - 1) / 2 (odd).
    const uid = String(f.id)
    let type = uid[0] === 'w' ? 'way' : uid[0] === 'r' ? 'relation' : 'node'
    let id = Number(uid.slice(1))
    if (uid[0] === 'a') [type, id] = id % 2 === 0 ? ['way', id / 2] : ['relation', (id - 1) / 2]
    const tags = f.properties
    const g = f.geometry
    const ring = (r) => r.map(([lon, lat]) => ({ lat, lon }))
    if (g.type === 'LineString') list.push({ type, id, tags, geometry: ring(g.coordinates) })
    else if (type === 'way' && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
      list.push({ type, id, tags, geometry: ring(g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]) })
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      const members = polys.flatMap((p) => p.map((r, k) => ({ type: 'way', role: k === 0 ? 'outer' : 'inner', geometry: ring(r) })))
      list.push({ type: 'relation', id, tags, members })
    }
  }
  return list
}

if (!ONLY || ONLY === 'buildings') {
  const els = elements(box(FAR), ['wr/building', 'wr/building:part'], 'polygon')
  await writeFile(new URL(`../../data/osm/${CITY}.json`, import.meta.url), JSON.stringify({ elements: els }))
  console.log(`${CITY}: ${els.length} buildings and parts → data/osm/${CITY}.json`)
}
if (!ONLY || ONLY === 'ground') {
  const els = elements(box(GROUND), ['wr/landuse', 'wr/leisure', 'wr/natural', 'w/highway', 'w/area:highway', 'wr/amenity=parking', 'wr/place=square', 'w/railway', 'w/barrier'], 'linestring,polygon')
  await writeFile(new URL(`../../data/osm/${CITY}-ground.json`, import.meta.url), JSON.stringify({ elements: els }))
  console.log(`${CITY}: ${els.length} ground features → data/osm/${CITY}-ground.json`)
}
await rm(TMP, { recursive: true, force: true })
