#!/usr/bin/env node
// Writes a city's skyline as its drop sees it (SKYLINE in config.js): a panorama from the city's vantage
// point (src/content/vantages.json), `span` degrees wide around the view's bearing, from `el[0]` to
// `el[1]` degrees of elevation. OpenStreetMap buildings are raised to their mapped heights (the
// `height` tag; else `building:levels` × 3.2 m; else DEFAULT_HEIGHT, stated in the output), with
// pyramidal and round roofs; landmarks that are not buildings are drawn from their real dimensions
// (scripts/skyline/landmarks.mjs).
//
//   npm run skyline -- --city london [--fetch]
//
// --fetch downloads the buildings from the Overpass API into data/osm/<city>.json (gitignored; ODbL,
// © OpenStreetMap contributors). Output: public/skyline/<city>.png and .json.
//
// Channels (RGBA, 8 bits, linear, safe to average into mip levels):
//   R coverage (a building fills the pixel)       G distance, log-encoded (DIST_MIN..DIST_MAX m)
//   B window light, evening (share of lit glass)  A window light, late night (a subset of the evening's)
// The window pattern is decoration, not data: floors every FLOOR m, bays every BAY m, which windows
// are lit is seeded per building and floor.

import { mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail, requireFfmpeg, run } from './lib/ffmpeg.mjs'
import { landmarksFor } from './skyline/landmarks.mjs'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
if (!CITY) fail('usage: npm run skyline -- --city <id> [--fetch]')
const FETCH = process.argv.includes('--fetch')
const NEAR = Number(arg('near', 2500)) // every building within this many metres…
const FAR = Number(arg('far', 7000)) // …and tall ones (with a height or floors tag) to this
const EYE = Number(arg('eye', 12)) // eye height above the ground, m
const SPAN = Number(arg('span', 120)) // degrees of azimuth around the view
const EL = [Number(arg('el-min', -4)), Number(arg('el-max', 26))]
const PPD = Number(arg('ppd', 16)) // output pixels per degree
const SS = 3 // supersampling per output pixel, each way

const FLOOR = 3.2
const BAY = 3.0
const DEFAULT_HEIGHT = 10 // a building with neither height nor floors mapped
const DIST_MIN = 20
const DIST_MAX = 8000

const RAD = Math.PI / 180
const vantages = JSON.parse(await readFile(new URL('../src/content/vantages.json', import.meta.url), 'utf8'))
const view = vantages[CITY]
if (!view) fail(`no vantage for ${CITY} in src/content/vantages.json`)
const [lat0, lon0] = view.from.at
const bearingTo = ([lat1, lon1], [lat2, lon2]) => {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD)
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD)
  return Math.atan2(y, x) / RAD
}
const mean = (bs) => Math.atan2(bs.reduce((s, b) => s + Math.sin(b * RAD), 0), bs.reduce((s, b) => s + Math.cos(b * RAD), 0)) / RAD
const BEARING = (mean(view.toward.map((t) => bearingTo(view.from.at, t.at))) + 360) % 360
const AZ0 = BEARING - SPAN / 2

// ---- OpenStreetMap ------------------------------------------------------------------------------
const osmFile = new URL(`../data/osm/${CITY}.json`, import.meta.url)
if (FETCH) {
  const q = `[out:json][timeout:180];(
    way["building"](around:${NEAR},${lat0},${lon0});
    way["building:part"](around:${NEAR},${lat0},${lon0});
    relation["building"](around:${NEAR},${lat0},${lon0});
    way["building"]["height"](around:${FAR},${lat0},${lon0});
    way["building:part"]["height"](around:${FAR},${lat0},${lon0});
    way["building"]["building:levels"](around:${FAR},${lat0},${lon0});
  );out geom tags;`
  await mkdir(new URL('../data/osm/', import.meta.url), { recursive: true })
  console.log(`fetching buildings around ${view.from.name} from the Overpass API…`)
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'schwe.org site build (skyline data)', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(q)}`,
  })
  if (!res.ok) fail(`Overpass: ${res.status} ${await res.text()}`)
  await writeFile(osmFile, Buffer.from(await res.arrayBuffer()))
}
let osm
try {
  osm = JSON.parse(await readFile(osmFile, 'utf8'))
} catch {
  fail(`no data/osm/${CITY}.json: run with --fetch first`)
}

// Local metres east (x) and north (y) of the vantage.
const KX = 111320 * Math.cos(lat0 * RAD)
const KY = 110540
const local = ({ lat, lon }) => [(lon - lon0) * KX, (lat - lat0) * KY]
const metres = (v) => {
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

const landmarks = landmarksFor(CITY, { local, eye: EYE, osm })
const replaced = new Set(landmarks.flatMap((l) => l.replaces ?? []))
const lights = Object.assign({}, ...landmarks.map((l) => l.lights ?? {})) // OSM element → lit height ranges
const buildings = []
let defaulted = 0
const seen = new Set()
for (const e of osm.elements) {
  const key = `${e.type}/${e.id}`
  if (seen.has(key) || replaced.has(key)) continue
  seen.add(key)
  const t = e.tags ?? {}
  let rings = []
  if (e.type === 'way' && e.geometry) rings = [e.geometry.map(local)]
  else if (e.type === 'relation') rings = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map(local))
  if (!rings.length) continue
  let height = metres(t.height)
  if (height == null && t['building:levels'] != null) height = metres(t['building:levels']) * FLOOR + (metres(t['roof:height']) ?? 0)
  if (height == null) {
    height = DEFAULT_HEIGHT
    defaulted++
  }
  const min = metres(t.min_height) ?? (t['building:min_level'] != null ? metres(t['building:min_level']) * FLOOR : 0)
  const shape = t['roof:shape'] ?? 'flat'
  const roof = ['pyramidal', 'dome', 'round', 'onion', 'cone'].includes(shape) ? Math.min(metres(t['roof:height']) ?? height * 0.3, height - min) : 0
  for (const ring of rings) {
    if (ring.length < 3) continue
    // The vantage itself (standing on a tower, say) never hides the view.
    if (inside(ring, [0, 0])) continue
    const c = centroid(ring)
    const rmax = Math.max(...ring.map(([x, y]) => Math.hypot(x - c[0], y - c[1])))
    buildings.push({ id: e.id, type: e.type, ring, min, height, wall: height - roof, roof, shape, c, rmax })
  }
}

function inside(ring, [px, py]) {
  let odd = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd
  }
  return odd
}
function centroid(ring) {
  const n = ring.length
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
}

// ---- Raster -------------------------------------------------------------------------------------
const W = Math.round(SPAN * PPD) * SS
const H = Math.round((EL[1] - EL[0]) * PPD) * SS
const azOf = (col) => AZ0 + ((col + 0.5) / W) * SPAN // degrees, clockwise from north
const elOfRow = (row) => EL[1] - ((row + 0.5) / H) * (EL[1] - EL[0]) // row 0 at the top
const rowOfEl = (el) => ((EL[1] - el) / (EL[1] - EL[0])) * H - 0.5

// Which columns each building can cover: its angular extent seen from the vantage.
const columns = Array.from({ length: W }, () => [])
buildings.forEach((b, index) => {
  const angles = b.ring.map(([x, y]) => Math.atan2(x, y) / RAD)
  const near = Math.min(...b.ring.map(([x, y]) => Math.hypot(x, y)))
  if (near > FAR) return
  // Unwrap around the view's bearing so extents never straddle ±180.
  const rel = angles.map((a) => ((a - AZ0 + 540) % 360) - 180)
  const lo = Math.min(...rel)
  const hi = Math.max(...rel)
  if (hi - lo > 180) return // the vantage sits in a gap of a ring around it: skip
  const c0 = Math.max(0, Math.floor((lo / SPAN) * W))
  const c1 = Math.min(W - 1, Math.ceil((hi / SPAN) * W))
  for (let c = c0; c <= c1; c++) columns[c].push(index)
})

const cover = new Uint8Array(W * H)
const dist = new Float32Array(W * H)
const lit = new Uint8Array(W * H) // 0 none, 1 late (and evening), 2 evening only

const hash = (a, b, c) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Height of a building's top at a point inside it (the roof shapes that change its silhouette).
function topAt(b, x, y) {
  if (!b.roof) return b.height
  const r = Math.min(Math.hypot(x - b.c[0], y - b.c[1]) / b.rmax, 1)
  const f = b.shape === 'pyramidal' || b.shape === 'cone' ? 1 - r : Math.sqrt(Math.max(0, 1 - r * r))
  return b.wall + b.roof * f
}

// Ray (from the vantage along unit d) against a ring: nearest entry and farthest exit, with the entry
// edge (for the window grid along the wall).
function hit(ring, dx, dy) {
  let tin = Infinity
  let tout = -Infinity
  let along = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]
    const [bx, by] = ring[i]
    const ex = bx - ax
    const ey = by - ay
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-12) continue
    const t = (ax * ey - ay * ex) / den
    const u = (ax * dy - ay * dx) / den
    if (u < 0 || u > 1 || t <= 0) continue
    if (t < tin) {
      tin = t
      along = u * Math.hypot(ex, ey)
    }
    if (t > tout) tout = t
  }
  return tin < Infinity ? { tin, tout, along } : null
}

for (let col = 0; col < W; col++) {
  const az = azOf(col) * RAD
  const dx = Math.sin(az)
  const dy = Math.cos(az)
  const hits = []
  for (const index of columns[col]) {
    const b = buildings[index]
    const h = hit(b.ring, dx, dy)
    if (!h || h.tin > FAR || h.tin < 2) continue
    hits.push({ b, ...h })
  }
  // Landmarks drawn from their dimensions come in as spans of their own.
  for (const lm of landmarks) for (const span of lm.spans(dx, dy)) hits.push({ landmark: span, tin: span.dist })
  hits.sort((p, q) => p.tin - q.tin)
  for (const h of hits) {
    const spans = h.landmark ? [h.landmark] : [buildingSpan(h)]
    for (const s of spans) fill(col, s)
  }
}

function buildingSpan({ b, tin, tout, along }) {
  return { dist: tin, tout, b, along }
}

function fill(col, s) {
  const d = s.dist
  if (s.b) {
    // Building: the wall at its nearest face, then the roof's highest point along the ray.
    const { b, along } = s
    const az = azOf(col) * RAD
    let top = Math.atan2(b.wall - EYE, d) / RAD
    if (b.roof) {
      for (let k = 0; k <= 12; k++) {
        const t = d + ((s.tout - d) * k) / 12
        top = Math.max(top, Math.atan2(topAt(b, t * Math.sin(az), t * Math.cos(az)) - EYE, t) / RAD)
      }
    }
    const bottom = Math.atan2(b.min - EYE, d) / RAD
    paint(col, bottom, top, d, (el) => {
      const z = EYE + d * Math.tan(el * RAD) // height on the wall
      if (z > b.wall) return 0 // roof: no windows
      const floor = Math.floor((z - b.min) / FLOOR)
      const bay = Math.floor(along / BAY)
      const fx = along / BAY - bay
      const fy = (z - b.min) / FLOOR - floor
      const light = lights[`${b.type}/${b.id}`]
      if (light && light.some(([lo, hi]) => z >= lo && z <= hi)) return 1 // a landmark's own lights
      if (fx < 0.25 || fx > 0.75 || fy < 0.3 || fy > 0.75) return 0 // wall between windows
      // How busy this building is tonight, then this window: evening's lit ones, and the fewer still on late.
      const busy = 0.15 + 0.85 * hash(b.id, 7919, 104729)
      const r = hash(b.id, floor, bay)
      if (floor === 0) return r < 0.06 ? 1 : r < 0.15 ? 2 : 0 // shopfronts and lobbies
      return r < busy * 0.1 ? 1 : r < busy * 0.32 ? 2 : 0 // about 18% lit in the evening, 6% late
    })
  } else {
    paint(col, s.bottom, s.top, d, s.light)
  }
}

function paint(col, bottom, top, d, lightAt) {
  const r0 = Math.max(0, Math.ceil(rowOfEl(top)))
  const r1 = Math.min(H - 1, Math.floor(rowOfEl(bottom)))
  for (let row = r0; row <= r1; row++) {
    const i = row * W + col
    if (cover[i]) continue // something nearer already fills it
    cover[i] = 1
    dist[i] = d
    lit[i] = lightAt(elOfRow(row))
  }
}

// ---- Downsample and write ---------------------------------------------------------------------------
const w = W / SS
const h = H / SS
const out = Buffer.alloc(w * h * 4)
const logRange = Math.log(DIST_MAX / DIST_MIN)
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    let c = 0
    let logd = 0
    let eve = 0
    let late = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const i = (y * SS + sy) * W + x * SS + sx
        if (!cover[i]) continue
        c++
        logd += Math.log(Math.min(Math.max(dist[i], DIST_MIN), DIST_MAX) / DIST_MIN) / logRange
        if (lit[i]) eve++
        if (lit[i] === 1) late++
      }
    const o = (y * w + x) * 4
    const n = SS * SS
    out[o] = Math.round((255 * c) / n)
    out[o + 1] = c ? Math.round((255 * logd) / c) : 255
    out[o + 2] = Math.round((255 * eve) / n)
    out[o + 3] = Math.round((255 * late) / n)
  }

requireFfmpeg()
await mkdir(new URL('../public/skyline/', import.meta.url), { recursive: true })
const tmp = join(tmpdir(), `skyline-${process.pid}.rgba`)
await writeFile(tmp, out)
const png = new URL(`../public/skyline/${CITY}.png`, import.meta.url).pathname
try {
  await run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', tmp, '-pix_fmt', 'rgba', '-compression_level', '9', png])
} finally {
  await rm(tmp, { force: true })
}
const meta = {
  city: CITY,
  from: view.from.name,
  bearing: +BEARING.toFixed(3),
  azimuth: [+AZ0.toFixed(3), SPAN], // degrees clockwise from north, where the image starts, and its width
  elevation: EL, // degrees, bottom and top rows
  eye: EYE,
  distance: [DIST_MIN, DIST_MAX],
  size: [w, h],
  buildings: buildings.length,
  defaultedHeights: defaulted,
  defaultHeight: DEFAULT_HEIGHT,
  landmarks: landmarks.map((l) => l.name),
  source: '© OpenStreetMap contributors (ODbL); heights from height, else building:levels × 3.2 m, else the default; window pattern decorative',
}
await writeFile(new URL(`../public/skyline/${CITY}.json`, import.meta.url), JSON.stringify(meta, null, 2) + '\n')
console.log(`→ ${png}  ${w}×${h}, ${((await stat(png)).size / 1024).toFixed(0)} KB · ${buildings.length} buildings (${defaulted} at the default ${DEFAULT_HEIGHT} m) · bearing ${BEARING.toFixed(1)}°`)
