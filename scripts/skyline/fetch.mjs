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
const SPAN = 130 // degrees: the panorama's 120 and a margin
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

// The view's wedge as an Overpass polygon, out to r metres.
function wedge(r) {
  const pts = [[lat0, lon0]]
  for (let a = -SPAN / 2; a <= SPAN / 2; a += 5) {
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
const QUERIES = {
  buildings: `[out:json][timeout:300][maxsize:1073741824];(
    way["building"](${near});
    way["building:part"](${near});
    relation["building"](${near});
    relation["building:part"](${near});
    way["building"]["height"](${far});
    way["building:part"]["height"](${far});
    way["building"]["building:levels"](${far});
    relation["building"]["height"](${far});
    relation["building"]["building:levels"](${far});
  );out geom;`,
  // Water multipolygons apart: a river's relation runs the river's whole length, so it comes as its
  // member list alone, with only the member ways near the view (extract.mjs stitches them).
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

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
async function overpass(q) {
  // The public instances are often busy: try each a few times, waiting longer between tries.
  for (let attempt = 0; attempt < 6; attempt++) {
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
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)))
  }
  throw new Error('Overpass: every attempt failed')
}

await mkdir(new URL('../../data/osm/', import.meta.url), { recursive: true })
for (const [name, q] of Object.entries(QUERIES)) {
  if (ONLY && ONLY !== name) continue
  const file = new URL(`../../data/osm/${CITY}${name === 'buildings' ? '' : `-${name}`}.json`, import.meta.url)
  console.log(`${CITY}: fetching ${name} around ${view.from.name}…`)
  const body = await overpass(q)
  const n = JSON.parse(body).elements.length
  await writeFile(file, body)
  console.log(`  ${n} elements → ${file.pathname}`)
}
