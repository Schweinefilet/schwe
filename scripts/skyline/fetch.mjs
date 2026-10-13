#!/usr/bin/env node
// Fetches what scripts/skyline/extract.mjs reads, for one city's view, from the Overpass API
// (© OpenStreetMap contributors, ODbL):
//   data/osm/<city>.json        buildings and building parts, ways and multipolygons, in the view's
//                               wedge to 2.5 km, and those with a height or floors to 7 km
//   data/osm/<city>-water.json  water multipolygons (a river's relation) and their member ways near
//   data/osm/<city>-extra.json  water ways, bridges, piers, trees, tree rows and street lamps
// All gitignored. Relations come with their members' geometry (`out geom`, not `out geom tags`,
// which drops the members and with them every multipolygon building's outline).
//
//   node scripts/skyline/fetch.mjs --city london [--only buildings|water|extra]

import { mkdir, readFile, writeFile } from 'node:fs/promises'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const ONLY = arg('only')
if (!CITY) {
  console.error('usage: node scripts/skyline/fetch.mjs --city <id> [--only buildings|water|extra]')
  process.exit(1)
}
// Degrees either side of the bearing: the panorama's (the vantage's `span`, default -60 to 60) and 5 more.
const MARGIN = 5
const NEAR = 2500
const FAR = 7000
const RAD = Math.PI / 180

const vantages = JSON.parse(await readFile(new URL('../../src/content/vantages.json', import.meta.url), 'utf8'))
const view = vantages[CITY]
if (!view) {
  console.error(`no vantage for ${CITY} in src/content/vantages.json`)
  process.exit(1)
}
const [lat0, lon0] = view.from.at
const bearingTo = ([a1, o1], [a2, o2]) =>
  Math.atan2(Math.sin((o2 - o1) * RAD) * Math.cos(a2 * RAD), Math.cos(a1 * RAD) * Math.sin(a2 * RAD) - Math.sin(a1 * RAD) * Math.cos(a2 * RAD) * Math.cos((o2 - o1) * RAD)) / RAD
const mean = (bs) => Math.atan2(bs.reduce((s, b) => s + Math.sin(b * RAD), 0), bs.reduce((s, b) => s + Math.cos(b * RAD), 0)) / RAD
const BEARING = (mean(view.toward.map((t) => bearingTo(view.from.at, t.at))) + 360) % 360
const [LEFT, RIGHT] = view.span ?? [-60, 60]

// The view's wedge as an Overpass polygon, out to r metres (or the part of it from a0 to a1 degrees of the bearing).
function wedge(r, a0 = LEFT - MARGIN, a1 = RIGHT + MARGIN) {
  const pts = [[lat0, lon0]]
  const steps = [...Array(Math.ceil((a1 - a0) / 5)).keys()].map((k) => a0 + k * 5).concat(a1)
  for (const a of steps) {
    const b = (BEARING + a) * RAD
    pts.push([lat0 + (r * Math.cos(b)) / 110540, lon0 + (r * Math.sin(b)) / (111320 * Math.cos(lat0 * RAD))])
  }
  return `poly:"${pts.map(([la, lo]) => `${la.toFixed(6)} ${lo.toFixed(6)}`).join(' ')}"`
}

// A box around the vantage, r metres each way (south, west, north, east).
const bbox = (r) => {
  const dLat = r / 110540
  const dLon = r / (111320 * Math.cos(lat0 * RAD))
  return [lat0 - dLat, lon0 - dLon, lat0 + dLat, lon0 + dLon].map((v) => v.toFixed(5)).join(',')
}
const near = wedge(NEAR)
const far = wedge(FAR)
// Buildings near the view, every one; in a dense city (Paris) as bounding-box tiles of TILE metres
// over the wedge (extract.mjs keeps what is in it): the public servers answer those in seconds, where the
// wedge's polygon times out (504; so does any query asking for a long timeout when the servers are busy:
// tiles ask for 90 s). And those mapped with a height or floors farther.
const nearBuildings = (area) => `[out:json][timeout:90];(
    way["building"](${area});
    way["building:part"](${area});
    relation["building"](${area});
    relation["building:part"](${area});
  );out geom;`
const farBuildings = (area) => `[out:json][timeout:90];(
    way["building"]["height"](${area});
    way["building:part"]["height"](${area});
    way["building"]["building:levels"](${area});
    relation["building"]["height"](${area});
    relation["building"]["building:levels"](${area});
  );out geom;`
const TILE = { paris: 1000 }[CITY]
function tiles(R = NEAR, query = nearBuildings, TILE_ = TILE) {
  const corners = [[0, 0]]
  for (let a = LEFT - MARGIN; a <= RIGHT + MARGIN; a += 5) corners.push([R * Math.sin((BEARING + a) * RAD), R * Math.cos((BEARING + a) * RAD)])
  const [x0, x1] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))]
  const [y0, y1] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))]
  const out = []
  for (let x = x0; x < x1; x += TILE_)
    for (let y = y0; y < y1; y += TILE_) {
      // Only tiles the wedge reaches (its centre's bearing within the wedge, or the tile near the vantage).
      const [cx, cy] = [x + TILE_ / 2, y + TILE_ / 2]
      const rel = ((Math.atan2(cx, cy) / RAD - BEARING + 540) % 360) - 180
      if (Math.hypot(cx, cy) > TILE_ && (rel < LEFT - MARGIN - 25 || rel > RIGHT + MARGIN + 25)) continue
      const box = [lat0 + y / 110540, lon0 + x / (111320 * Math.cos(lat0 * RAD)), lat0 + Math.min(y + TILE_, y1) / 110540, lon0 + Math.min(x + TILE_, x1) / (111320 * Math.cos(lat0 * RAD))]
      out.push(query(box.map((v) => v.toFixed(6)).join(',')))
    }
  return out
}
const QUERIES = {
  buildings: TILE ? [...tiles(), ...tiles(FAR, farBuildings, 2000)] : [nearBuildings(near), `[out:json][timeout:300];(
    way["building"]["height"](${far});
    way["building:part"]["height"](${far});
    way["building"]["building:levels"](${far});
    relation["building"]["height"](${far});
    relation["building"]["building:levels"](${far});
  );out geom;`],
  water: `[out:json][timeout:300];(
    relation["natural"="water"](${far});
    relation["waterway"="riverbank"](${far});
  )->.r;
  .r out body;
  way(r.r)(${bbox(FAR * 1.6)});
  out geom;`,
  extra: `[out:json][timeout:300][maxsize:1073741824];(
    way["natural"="water"](${far});
    way["waterway"="riverbank"](${far});
    way["man_made"="bridge"](${near});
    way["bridge"](${near});
    way["man_made"="pier"](${near});
    node["natural"="tree"](${wedge(2000)});
    way["natural"="tree_row"](${wedge(2000)});
    node["highway"="street_lamp"](${wedge(1500)});
  );out geom;`,
}
// What the ground is made of, for a city drawn on its own terrain (Paris: the Trocadéro gardens and the
// Champ de Mars in the foreground): lawns, parks, squares, paths and roads (lines and areas), parking,
// pitches, within GROUND metres, as bounding-box tiles.
const GROUND = { paris: 1800 }[CITY]
if (GROUND) {
  const groundQuery = (box) => `[out:json][timeout:90];(
    way["landuse"](${box});
    relation["landuse"](${box});
    way["leisure"](${box});
    relation["leisure"](${box});
    way["natural"](${box});
    relation["natural"](${box});
    way["highway"](${box});
    way["area:highway"](${box});
    way["amenity"="parking"](${box});
    way["place"="square"](${box});
    relation["place"="square"](${box});
    way["railway"](${box});
    way["barrier"~"wall|retaining_wall|fence"](${box});
  );out geom;`
  const out = []
  const k = (lat0 * RAD)
  for (let x = -GROUND; x < GROUND; x += 1000)
    for (let y = -GROUND; y < GROUND; y += 1000) {
      // Only tiles that touch the view's wedge.
      const rel = ((Math.atan2(x + 500, y + 500) / RAD - BEARING + 540) % 360) - 180
      if (Math.hypot(x + 500, y + 500) > 750 && (rel < LEFT - MARGIN - 30 || rel > RIGHT + MARGIN + 30)) continue
      const box = [lat0 + y / 110540, lon0 + x / (111320 * Math.cos(k)), lat0 + (y + 1000) / 110540, lon0 + (x + 1000) / (111320 * Math.cos(k))]
      out.push(groundQuery(box.map((v) => v.toFixed(6)).join(',')))
    }
  QUERIES.ground = out
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
async function overpass(q) {
  // The public instances are often busy: try each a few times, waiting longer between tries.
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'schwe.org site build (skyline data)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
      })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      console.log(`  ${new URL(url).host}: ${res.status}, trying again…`)
    } catch (err) {
      console.log(`  ${new URL(url).host}: ${err.message}, trying again…`)
    }
    await new Promise((r) => setTimeout(r, 5000 * Math.min(attempt + 1, 6)))
  }
  throw new Error('Overpass: every attempt failed')
}

await mkdir(new URL('../../data/osm/', import.meta.url), { recursive: true })
for (const [name, q] of Object.entries(QUERIES)) {
  if (ONLY && ONLY !== name) continue
  const file = new URL(`../../data/osm/${CITY}${name === 'buildings' ? '' : `-${name}`}.json`, import.meta.url)
  console.log(`${CITY}: fetching ${name} around ${view.from.name}…`)
  // A query in parts: their elements merged, each once.
  const parts = []
  // A query in tiles keeps each answer in data/osm/parts/ (by its text's hash), so a run that fails part
  // way resumes where it stopped.
  const { createHash } = await import('node:crypto')
  await mkdir(new URL('../../data/osm/parts/', import.meta.url), { recursive: true })
  for (const [i, part] of [q].flat().entries()) {
    const cache = new URL(`../../data/osm/parts/${CITY}-${createHash('sha1').update(part).digest('hex').slice(0, 16)}.json`, import.meta.url)
    let body = Array.isArray(q) ? await readFile(cache).catch(() => null) : null
    if (!body) {
      body = await overpass(part)
      if (Array.isArray(q)) await writeFile(cache, body)
    }
    parts.push(JSON.parse(body).elements)
    if (Array.isArray(q)) console.log(`  part ${i + 1} of ${q.length}: ${parts.at(-1).length} elements`)
  }
  const seen = new Set()
  const elements = parts.flat().filter((e) => !seen.has(`${e.type}/${e.id}`) && seen.add(`${e.type}/${e.id}`))
  const body = JSON.stringify({ elements })
  const n = elements.length
  await writeFile(file, body)
  console.log(`  ${n} elements → ${file.pathname}`)
}
