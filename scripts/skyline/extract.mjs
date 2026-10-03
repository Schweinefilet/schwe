#!/usr/bin/env node
// Turns a city's OpenStreetMap data into one scene file for Blender (scripts/blender/skyline.py), in
// metres east (x) and north (y) of the vantage: buildings (outlines replaced by their mapped parts,
// as OSM's Simple 3D Buildings asks), water, trees, street lamps, bridges and piers, inside the
// view's wedge. Inputs data/osm/<city>.json (buildings), <city>-water.json (the river's multipolygon)
// and <city>-extra.json (the rest), all from fetch.mjs; output data/skyline/<city>/scene.json. All
// gitignored. Part of `npm run skyline` (build.mjs).
//
//   node scripts/skyline/extract.mjs --city london

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { terrainSampler } from './terrain.mjs'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const NEAR = 2500
const FAR = 7000
const FLOOR = 3.2
const DEFAULT_HEIGHT = 10
const RAD = Math.PI / 180

const vantages = JSON.parse(await readFile(new URL('../../src/content/vantages.json', import.meta.url), 'utf8'))
const view = vantages[CITY]
const [lat0, lon0] = view.from.at
const bearingTo = ([a1, o1], [a2, o2]) =>
  Math.atan2(Math.sin((o2 - o1) * RAD) * Math.cos(a2 * RAD), Math.cos(a1 * RAD) * Math.sin(a2 * RAD) - Math.sin(a1 * RAD) * Math.cos(a2 * RAD) * Math.cos((o2 - o1) * RAD)) / RAD
const mean = (bs) => Math.atan2(bs.reduce((s, b) => s + Math.sin(b * RAD), 0), bs.reduce((s, b) => s + Math.cos(b * RAD), 0)) / RAD
const BEARING = (mean(view.toward.map((t) => bearingTo(view.from.at, t.at))) + 360) % 360
// The panorama's azimuths either side of the bearing (the vantage's `span`), and 5 degrees more for its edges.
const VIEW_SPAN = view.span ?? [-60, 60]
const [LEFT, RIGHT] = [VIEW_SPAN[0] - 5, VIEW_SPAN[1] + 5]

const KX = 111320 * Math.cos(lat0 * RAD)
const KY = 110540
// Cities on uneven ground: each building, tree and lamp stands on the terrain under it (terrain.mjs),
// `datum` metres of it (the tiles' vertical datum) being the scene's z = 0. New York: the Lower
// Manhattan waterfront, 2.5 m above NAVD88 (USGS 3DEP lidar: South Street 1.8 m, Water Street 2.6 m,
// Pearl Street 2.7 m; Broadway at Liberty Street is 9.4 m).
const TERRAIN = { 'new-york': { datum: 2.5 } }[CITY] ?? null
const ground = TERRAIN ? await terrainSampler({ lat0, lon0, r: FAR, kx: KX, ky: KY, cacheDir: new URL('../../data/terrain/', import.meta.url) }) : null
const baseAt = ([x, y]) => {
  if (!ground) return 0
  const e = ground(x, y)
  return e == null ? 0 : +(e - TERRAIN.datum).toFixed(2)
}
const local = ({ lat, lon }) => [+((lon - lon0) * KX).toFixed(2), +((lat - lat0) * KY).toFixed(2)]
const metres = (v) => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
// Inside the view's wedge (and within `r` metres) for any of these points.
const inWedge = (pts, r) =>
  pts.some(([x, y]) => {
    const d = Math.hypot(x, y)
    if (d > r) return false
    const rel = ((Math.atan2(x, y) / RAD - BEARING + 540) % 360) - 180
    return (rel >= LEFT && rel <= RIGHT) || d < 60
  })
const contains = (ring, [px, py]) => {
  let odd = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd
  }
  return odd
}
// roof:direction as degrees (OSM allows compass letters too), or null.
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const roofDirection = (v) => {
  if (v == null) return null
  const i = COMPASS.indexOf(String(v).trim().toUpperCase())
  if (i >= 0) return i * 22.5
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const centroid = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
// A multipolygon's rings from its member ways: ways sharing end nodes joined into chains. A chain left
// open (its ways run on outside what was fetched, as the Thames does) is closed across its two ends.
const same = (a, b) => a[0] === b[0] && a[1] === b[1]
function stitch(ways) {
  const chains = ways.filter((w) => w.length > 1).map((w) => [...w])
  const out = []
  while (chains.length) {
    let c = chains.pop()
    let grew = true
    while (grew && !same(c[0], c.at(-1))) {
      grew = false
      for (let i = 0; i < chains.length; i++) {
        const o = chains[i]
        if (same(o[0], c.at(-1))) c = [...c, ...o.slice(1)]
        else if (same(o.at(-1), c.at(-1))) c = [...c, ...o.slice(0, -1).reverse()]
        else if (same(o.at(-1), c[0])) c = [...o, ...c.slice(1)]
        else if (same(o[0], c[0])) c = [...o.slice(1).reverse(), ...c]
        else continue
        chains.splice(i, 1)
        grew = true
        break
      }
    }
    out.push(same(c[0], c.at(-1)) ? c : [...c, c[0]])
  }
  return out
}
// Outer rings and holes of a way or multipolygon relation (members with geometry inline, or given by
// id in `wayGeometry` when the relation was fetched with `out body` and its ways separately).
const wayGeometry = new Map()
function rings(e) {
  if (e.type === 'way' && e.geometry) return { outer: [e.geometry.map(local)], inner: [] }
  if (e.type === 'relation' && e.members) {
    const g = (role) =>
      stitch(
        e.members
          .filter((m) => m.type === 'way' && m.role === role)
          .map((m) => (m.geometry ? m.geometry.map(local) : wayGeometry.get(m.ref)))
          .filter(Boolean),
      )
    return { outer: g('outer'), inner: g('inner') }
  }
  return { outer: [], inner: [] }
}

const osm = JSON.parse(await readFile(new URL(`../../data/osm/${CITY}.json`, import.meta.url), 'utf8'))
const extra = JSON.parse(await readFile(new URL(`../../data/osm/${CITY}-extra.json`, import.meta.url), 'utf8'))
// Water multipolygons (the river): relations and their member ways fetched apart (fetch.mjs).
const waterFile = JSON.parse(await readFile(new URL(`../../data/osm/${CITY}-water.json`, import.meta.url), 'utf8').catch(() => '{"elements":[]}'))
for (const e of waterFile.elements) if (e.type === 'way' && e.geometry) wayGeometry.set(e.id, e.geometry.map(local))

// ---- Buildings ---------------------------------------------------------------------------------
const seen = new Set()
const outlines = []
const parts = []
for (const e of osm.elements) {
  const key = `${e.type}/${e.id}`
  if (seen.has(key)) continue
  seen.add(key)
  const t = e.tags ?? {}
  // Bridges are drawn as bridges (and some are landmarks), never raised as buildings.
  if (t.man_made === 'bridge' || t.bridge) continue
  const { outer, inner } = rings(e)
  if (!outer.length || !outer[0].length) continue
  const all = outer.flat()
  const tall = metres(t.height) ?? (t['building:levels'] ? metres(t['building:levels']) * FLOOR : 0)
  if (!inWedge(all, tall >= 30 ? FAR : NEAR)) continue
  if (outer.some((r) => contains(r, [0, 0]))) continue // the vantage itself
  // A building site's mapped height is what is planned (2 World Trade Center: 373.7 m, opening 2031),
  // not what stands: it gets a low one below.
  let height = t.building === 'construction' || t['building:part'] === 'construction' ? null : metres(t.height)
  const levels = t.building === 'construction' ? null : metres(t['building:levels'])
  if (height == null && levels != null) height = levels * FLOOR + (metres(t['roof:height']) ?? (t['roof:levels'] ? metres(t['roof:levels']) * FLOOR : 0))
  const estimated = height == null
  if (height == null) height = DEFAULT_HEIGHT
  const min = metres(t.min_height) ?? (t['building:min_level'] != null ? metres(t['building:min_level']) * FLOOR : 0)
  const shape = t['roof:shape'] ?? 'flat'
  const roofH = shape === 'flat' ? 0 : Math.min(metres(t['roof:height']) ?? (t['roof:levels'] ? metres(t['roof:levels']) * FLOOR : Math.min(6, height * 0.25)), Math.max(height - min - 0.5, 0))
  const b = {
    id: key,
    name: t.name ?? null,
    outer,
    inner,
    height: +height.toFixed(2),
    min: +min.toFixed(2),
    // `tagged`: OSM gives the roof's shape (untagged roofs are taken as flat; skyline's filler may pitch
    // them); `direction`: a skillion's downhill compass bearing, where mapped.
    roof: {
      shape,
      height: +roofH.toFixed(2),
      colour: t['roof:colour'] ?? null,
      material: t['roof:material'] ?? null,
      tagged: t['roof:shape'] != null,
      direction: roofDirection(t['roof:direction']),
    },
    levels,
    estimated,
    material: t['building:material'] ?? null,
    colour: t['building:colour'] ?? null,
    kind: t.building ?? t['building:part'] ?? 'yes',
    // Listed, historic or a sight (for the masonry facade: Elizabeth Tower carries none of the heritage
    // tags, only tourism=attraction), and the style if mapped.
    listed: Boolean(t.heritage || t.listed_status || t.historic || t['heritage:operator'] || t.tourism === 'attraction'),
    architecture: t['building:architecture'] ?? null,
    within: null,
  }
  if (t['building:part'] && t['building:part'] !== 'no') parts.push(b)
  else outlines.push(b)
}
// Landmarks modelled by hand (scripts/blender/landmarks_<city>.py): their outline is kept for placing
// the model, and neither it nor anything mapped inside it is raised as a building (the London Eye is
// mapped in OSM as dozens of parts, which would make a crude stepped wheel beside the model).
const LANDMARK_OUTLINES = {
  london: ['way/204068874'],
  // One World Trade Center (mapped as parts: its chamfers as skillion roofs, its mast as a pyramid) and the
  // Brooklyn Bridge's Manhattan tower (mapped as an 82.9 m stone block).
  'new-york': ['way/713565776', 'way/1255363983'],
}[CITY] ?? []
// Structures that are not storeyed buildings get small heights when none is mapped (a median of the
// neighbours would raise a canopy or a moored ship to office height).
const LOW = { roof: 4.5, carport: 3, kiosk: 3.5, toilets: 3.5, shed: 3, hut: 3, garage: 3, garages: 3, container: 3, service: 4, construction: 4, ship: 8, boat: 5, houseboat: 5, pier: 3, pavilion: 6, bridge: 0 }
const landmarkOutlines = {}
for (const id of LANDMARK_OUTLINES) {
  const o = outlines.find((b) => b.id === id)
  if (!o) continue
  landmarkOutlines[id] = o.outer
  const inside = (b) => o.outer.some((r) => contains(r, centroid(b.outer[0])))
  for (const list of [outlines, parts]) for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id || inside(list[i])) list.splice(i, 1)
}

// Landmarks modelled whole by hand where OSM's outline is not used, placed by their published position
// (Wikipedia's coordinates): what OSM maps with its centre within `clear` metres is not raised.
const LANDMARK_POINTS = {
  'new-york': {
    'Chrysler Building': { at: [40.751667, -73.975278], clear: 32 },
    '432 Park Avenue': { at: [40.761389, -73.971944], clear: 18 },
  },
}[CITY] ?? {}
const landmarkPoints = {}
for (const [name, { at, clear }] of Object.entries(LANDMARK_POINTS)) {
  const p = local({ lat: at[0], lon: at[1] })
  landmarkPoints[name] = { at: p }
  for (const list of [outlines, parts]) for (let i = list.length - 1; i >= 0; i--) if (Math.hypot(...centroid(list[i].outer[0]).map((v, k) => v - p[k])) < clear) list.splice(i, 1)
}

// An outline with mapped parts is drawn by its parts alone. Each part notes the building it belongs to
// and takes what the building says of itself where the part is silent (listed, style, material, colour).
const partCentres = parts.map((p) => centroid(p.outer[0]))
let replaced = 0
const replacedOutlines = {}
const buildings = [
  ...parts,
  ...outlines.filter((o) => {
    const [x0, x1] = [Math.min(...o.outer[0].map((p) => p[0])), Math.max(...o.outer[0].map((p) => p[0]))]
    const [y0, y1] = [Math.min(...o.outer[0].map((p) => p[1])), Math.max(...o.outer[0].map((p) => p[1]))]
    let has = false
    partCentres.forEach(([x, y], i) => {
      if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1 && o.outer.some((r) => contains(r, [x, y])))) return
      has = true
      const p = parts[i]
      p.listed ||= o.listed // from every building it is part of (a tower of a listed palace)
      if (p.within) return
      p.within = { id: o.id, name: o.name, kind: o.kind }
      p.architecture ??= o.architecture
      p.material ??= o.material
      p.colour ??= o.colour
    })
    if (has) {
      replaced++
      // Named buildings drawn by their parts keep their footprint, for landmarks to be placed by it.
      if (o.name) replacedOutlines[o.id] = { name: o.name, outer: o.outer }
    }
    return !has
  }),
]

// A building with neither height nor floors takes the median height of mapped buildings within
// NEIGHBOURS metres (the district's, not one number for the whole city); tiny ones (under 40 m²,
// kiosks and sheds) 4 m. Stated in the scene's counts.
const NEIGHBOURS = 250
const area = (ring) => Math.abs(ring.reduce((s, [x, y], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * y, 0) / 2)
const known = buildings.filter((b) => !b.estimated).map((b) => ({ c: centroid(b.outer[0]), h: b.height }))
const grid = new Map()
for (const k of known) {
  const key = `${Math.floor(k.c[0] / NEIGHBOURS)},${Math.floor(k.c[1] / NEIGHBOURS)}`
  if (!grid.has(key)) grid.set(key, [])
  grid.get(key).push(k)
}
let byMedian = 0
for (const b of buildings) {
  if (!b.estimated) continue
  if (LOW[b.kind] != null) {
    b.height = LOW[b.kind]
    continue
  }
  if (area(b.outer[0]) < 40) {
    b.height = 4
    continue
  }
  const [cx, cy] = centroid(b.outer[0])
  const gx = Math.floor(cx / NEIGHBOURS)
  const gy = Math.floor(cy / NEIGHBOURS)
  const hs = []
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) for (const k of grid.get(`${gx + dx},${gy + dy}`) ?? []) if (Math.hypot(k.c[0] - cx, k.c[1] - cy) <= NEIGHBOURS) hs.push(k.h)
  if (hs.length >= 5) {
    // The 40th percentile, at most 30 m: towers nearby should not lift the ordinary buildings around them.
    hs.sort((a, c) => a - c)
    b.height = +Math.min(hs[Math.floor(hs.length * 0.4)], 30).toFixed(2)
    byMedian++
  }
}

// Where each stands: the ground under its outline's centre, above the scene's z = 0. A building's parts all
// stand where the building does (each part's own centre would step a flat roof across a slope).
const outlineBase = new Map(outlines.map((o) => [o.id, baseAt(centroid(o.outer[0]))]))
for (const b of buildings) b.base = (b.within && outlineBase.get(b.within.id)) ?? outlineBase.get(b.id) ?? baseAt(centroid(b.outer[0]))
const landmarkBases = Object.fromEntries(Object.entries(landmarkOutlines).map(([id, o]) => [id, baseAt(centroid(o[0]))]))
for (const lp of Object.values(landmarkPoints)) lp.base = baseAt(lp.at)

// ---- The rest ----------------------------------------------------------------------------------
const water = []
const bridges = []
const piers = []
const trees = []
const lamps = []
const waterRelations = waterFile.elements.filter((e) => e.type === 'relation')
const fetchedApart = new Set(waterRelations.map((e) => e.id))
for (const e of [...waterRelations, ...extra.elements.filter((e) => !(e.type === 'relation' && fetchedApart.has(e.id)))]) {
  const t = e.tags ?? {}
  if (t.natural === 'water' || t.waterway === 'riverbank') {
    const { outer, inner } = rings(e)
    if (outer.length && inWedge(outer.flat(), FAR)) water.push({ id: `${e.type}/${e.id}`, outer, inner })
  } else if (t.man_made === 'bridge' || (t.bridge && e.type === 'way')) {
    const pts = e.geometry?.map(local)
    if (pts && inWedge(pts, NEAR)) bridges.push({ id: `${e.type}/${e.id}`, name: t.name ?? null, area: t.man_made === 'bridge', pts, layer: metres(t.layer) ?? 1, kind: t.railway ?? t.highway ?? t.man_made ?? 'bridge' })
  } else if (t.man_made === 'pier') {
    const pts = e.geometry?.map(local)
    if (pts && inWedge(pts, NEAR)) piers.push({ id: `${e.type}/${e.id}`, name: t.name ?? null, pts, closed: pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] })
  } else if (t.natural === 'tree' && e.type === 'node') {
    const p = local(e)
    if (inWedge([p], 2000)) trees.push({ at: p, base: baseAt(p), height: metres(t.height), crown: metres(t.diameter_crown), leaf: t.leaf_type ?? null, genus: t.genus ?? null, species: t.species ?? null })
  } else if (t.natural === 'tree_row' && e.geometry) {
    const pts = e.geometry.map(local)
    if (inWedge(pts, 2000)) {
      // Trees along the row every 9 m (a row has no individual positions).
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]
        const [bx, by] = pts[i]
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 9))
        for (let k = 0; k < n; k++) {
          const at = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]
          trees.push({ at, base: baseAt(at), height: null, crown: null, leaf: null, row: true })
        }
      }
    }
  } else if (t.highway === 'street_lamp' && e.type === 'node') {
    const p = local(e)
    if (inWedge([p], 1500)) lamps.push({ at: p, base: baseAt(p), colour: t['light:colour'] ?? null, count: metres(t['light:count']) ?? 1 })
  }
}

const out = {
  city: CITY,
  vantage: { name: view.from.name, bearing: +BEARING.toFixed(3), span: VIEW_SPAN },
  source: TERRAIN ? '© OpenStreetMap contributors, ODbL; terrain: USGS 3DEP via Mapzen terrain tiles' : '© OpenStreetMap contributors, ODbL',
  terrain: TERRAIN,
  counts: { buildings: buildings.length, partsReplacingOutlines: replaced, estimatedHeights: buildings.filter((b) => b.estimated).length, heightsFromNeighbours: byMedian, water: water.length, bridges: bridges.length, piers: piers.length, trees: trees.length, lamps: lamps.length },
  buildings,
  landmarkOutlines,
  landmarkBases,
  landmarkPoints,
  replacedOutlines,
  water,
  bridges,
  piers,
  trees,
  lamps,
}
await mkdir(new URL(`../../data/skyline/${CITY}/`, import.meta.url), { recursive: true })
await writeFile(new URL(`../../data/skyline/${CITY}/scene.json`, import.meta.url), JSON.stringify(out))
console.log(`${CITY}: bearing ${BEARING.toFixed(1)}°`, out.counts)
