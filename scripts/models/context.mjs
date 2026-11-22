#!/usr/bin/env node
// The country round a city's plinth, for the photoreal New York (src/city/real/), from what
// scripts/models/context.py fetched (OpenStreetMap via Overture Maps, ODbL):
//
//   public/models/<city>-context.png   the box round the plinth in the model's frame (x east, z south),
//                                      north up: r = water, g = buildings' cover, b = parks and grass,
//                                      a = the buildings' height there (sqrt-encoded, 0..400 m)
//   public/models/<city>-context.bin   every building outside the plinth 30 m or taller, as a box on its
//                                      footprint's principal axes: float32 x, z, half length, half width,
//                                      angle (radians from x toward z), height
//   public/models/<city>-context.json  the box's extent and the counts
//
// Heights: mapped height, else floors x 3.2 m, else the median of the known heights in its 1 km cell, else
// the box's; the script prints how many took each (CLAUDE.md). Buildings on the plinth are left out: the model has them.
//
//   node scripts/models/context.mjs --city new-york

import { readFile, writeFile } from 'node:fs/promises'
import zlib from 'node:zlib'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const SPECS = JSON.parse(await readFile(new URL('../../src/content/models.json', import.meta.url), 'utf8'))
const spec = SPECS[CITY]
const RAD = Math.PI / 180
const [LAT0, LON0] = spec.center
const M_LAT = 110540
const M_LON = 111320 * Math.cos(LAT0 * RAD)
const sinB = Math.sin(spec.axisBearing * RAD)
const cosB = Math.cos(spec.axisBearing * RAD)
// lon/lat -> the model's frame (x east, z south), metres.
const toXZ = ([lon, lat]) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT]
// The plinth's frame (u along its axis, v across), as build.mjs.
const onPlinth = ([x, z], margin = 12) => {
  const n = -z
  const u = x * sinB + n * cosB
  const v = x * cosB - n * sinB
  return Math.abs(u) <= spec.halfLength - margin && Math.abs(v) <= spec.halfWidth - margin
}

const BOX = { 'new-york': [-74.13, 40.62, -73.84, 40.87], paris: [2.17, 48.8, 2.53, 48.95] }[CITY]
const [x0, z1] = toXZ([BOX[0], BOX[1]])
const [x1, z0] = toXZ([BOX[2], BOX[3]])
const N = 4096
const sx = (x) => ((x - x0) / (x1 - x0)) * N
const sz = (z) => ((z - z0) / (z1 - z0)) * N

const load = async (k) => JSON.parse(await readFile(new URL(`../../data/models/${CITY}-context-${k}.json`, import.meta.url), 'utf8'))

// Even-odd scanline fill of rings (model frame) into an S x S grid at `scale` samples per texel.
function fill(rings, scale, each) {
  const S = N * scale
  let lo = Infinity
  let hi = -Infinity
  for (const r of rings) for (const p of r) (lo = Math.min(lo, sz(p[1]) * scale)), (hi = Math.max(hi, sz(p[1]) * scale))
  const ya = Math.max(0, Math.floor(lo))
  const yb = Math.min(S - 1, Math.ceil(hi))
  const xs = []
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5
    xs.length = 0
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = sz(r[j][1]) * scale
        const b = sz(r[i][1]) * scale
        if (a <= yc === b <= yc) continue
        const xa = sx(r[j][0]) * scale
        const xb = sx(r[i][0]) * scale
        xs.push(xa + ((yc - a) / (b - a)) * (xb - xa))
      }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5))
      const xb = Math.min(S - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = xa; x <= xb; x++) each(y * S + x)
    }
  }
}
const polygons = (coords) => (typeof coords[0][0][0] === 'number' ? [coords] : coords)
const geoPolygons = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])

// Water, at two samples a texel each way.
const water2 = new Uint8Array(4 * N * N)
for (const w of await load('water')) {
  if (w.subtype === 'human_made' || ['swimming_pool', 'wastewater', 'fountain', 'reflecting_pool'].includes(w.class)) continue
  for (const poly of geoPolygons(w.geometry)) fill(poly.map((r) => r.map(toXZ)), 2, (i) => (water2[i] = 1))
}
const green = new Uint8Array(N * N)
for (const g of await load('green')) for (const poly of geoPolygons(g.geometry)) fill(poly.map((r) => r.map(toXZ)), 1, (i) => (green[i] = 1))

// Buildings.
const raw = await load('buildings')
const known = raw.map(([h, f]) => h ?? (f ? f * 3.2 : null)).filter((h) => h != null && h > 0).sort((a, b) => a - b)
const median = known[Math.floor(known.length / 2)]
// A building with no mapped height takes the median of the known heights round it (the 1 km cell it stands
// in, when at least 25 of the cell's buildings are mapped), else the box's: in Paris the box's median (7 m)
// is the suburbs' houses, and most unmapped buildings stand in the six-storey city (CLAUDE.md: never invent;
// this is the same rule at a finer grain).
const CELL = 1000
const firstPoint = (coords) => {
  let c = coords
  while (Array.isArray(c[0])) c = c[0]
  return toXZ(c)
}
const cellOf = (coords) => {
  const [x, z] = firstPoint(coords)
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
}
const cellKnown = new Map()
for (const [h, f, coords] of raw) {
  const H = h ?? (f ? f * 3.2 : null)
  if (!(H > 0)) continue
  const k = cellOf(coords)
  if (!cellKnown.has(k)) cellKnown.set(k, [])
  cellKnown.get(k).push(H)
}
const cellMedian = new Map([...cellKnown].filter(([, v]) => v.length >= 25).map(([k, v]) => [k, v.sort((a, b) => a - b)[Math.floor(v.length / 2)]]))
let localCount = 0
const cover = new Uint8Array(N * N)
const height = new Float32Array(N * N)
const towers = []
let medianCount = 0
let onModel = 0
for (const [h, f, coords] of raw) {
  let H = h ?? (f ? f * 3.2 : null)
  if (!(H > 0)) {
    H = cellMedian.get(cellOf(coords))
    if (H > 0) localCount++
    else {
      H = median
      medianCount++
    }
  }
  for (const poly of polygons(coords)) {
    const rings = poly.map((r) => r.map(toXZ))
    const outer = rings[0]
    let cx = 0
    let cz = 0
    for (const p of outer) (cx += p[0]), (cz += p[1])
    cx /= outer.length
    cz /= outer.length
    if (onPlinth([cx, cz])) {
      onModel++
      continue
    }
    fill(rings, 1, (i) => {
      cover[i] = 1
      height[i] = Math.max(height[i], H)
    })
    if (H >= 30) {
      // The footprint's principal axes (second moments of its outline's vertices) and its extent along them.
      let sxx = 0
      let szz = 0
      let sxz = 0
      for (const p of outer) {
        const dx = p[0] - cx
        const dz = p[1] - cz
        sxx += dx * dx
        szz += dz * dz
        sxz += dx * dz
      }
      const a = 0.5 * Math.atan2(2 * sxz, sxx - szz)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      let u0 = Infinity
      let u1 = -Infinity
      let v0 = Infinity
      let v1 = -Infinity
      for (const p of outer) {
        const dx = p[0] - cx
        const dz = p[1] - cz
        const u = dx * ca + dz * sa
        const v = -dx * sa + dz * ca
        u0 = Math.min(u0, u)
        u1 = Math.max(u1, u)
        v0 = Math.min(v0, v)
        v1 = Math.max(v1, v)
      }
      const mx = cx + ((u0 + u1) / 2) * ca - ((v0 + v1) / 2) * sa
      const mz = cz + ((u0 + u1) / 2) * sa + ((v0 + v1) / 2) * ca
      if (u1 - u0 > 4 && v1 - v0 > 4) towers.push([mx, mz, (u1 - u0) / 2, (v1 - v0) / 2, a, H])
    }
  }
}

// The map: RGBA, row 0 at the north edge.
const png = Buffer.alloc(N * (1 + N * 4))
let waterTexels = 0
for (let y = 0; y < N; y++) {
  const row = y * (1 + N * 4)
  for (let x = 0; x < N; x++) {
    const i = y * N + x
    const w = water2[(2 * y) * 2 * N + 2 * x] + water2[(2 * y) * 2 * N + 2 * x + 1] + water2[(2 * y + 1) * 2 * N + 2 * x] + water2[(2 * y + 1) * 2 * N + 2 * x + 1]
    const o = row + 1 + x * 4
    png[o] = Math.round((w / 4) * 255)
    png[o + 1] = cover[i] * 255
    png[o + 2] = green[i] * 255
    png[o + 3] = Math.round(Math.sqrt(Math.min(height[i], 400) / 400) * 255)
    if (w >= 2) waterTexels++
  }
}

function encodePng(raw, width, height) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc32 = (buf) => {
    let c = -1
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const out = (name) => new URL(`../../public/models/${CITY}-${name}`, import.meta.url)
const pngBuf = encodePng(png, N, N)
await writeFile(out('context.png'), pngBuf)
const bin = new Float32Array(towers.flat())
await writeFile(out('context.bin'), Buffer.from(bin.buffer))
const meta = { box: { x0, x1, z0, z1 }, towers: towers.length, buildings: raw.length, onModel, medianHeight: median, tookMedian: medianCount, tookLocalMedian: localCount }
await writeFile(out('context.json'), JSON.stringify(meta, null, 1))
console.log(`${CITY}: context ${N}x${N} (${((x1 - x0) / N).toFixed(1)} x ${((z1 - z0) / N).toFixed(1)} m a texel), ${(pngBuf.length / 1e6).toFixed(1)} MB; ${raw.length} buildings, ${onModel} on the plinth left out, ${localCount} without a mapped height took their 1 km cell's median and ${medianCount} the box's, ${median.toFixed(1)} m; ${towers.length} boxes of 30 m and more (${(bin.byteLength / 1e3).toFixed(0)} kB); ${((waterTexels / (N * N)) * 100).toFixed(0)}% water`)
