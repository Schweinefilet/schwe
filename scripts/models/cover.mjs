#!/usr/bin/env node
// What covers the open ground of a city's plinth, for the photoreal New York's ground shader, from the
// polygons scripts/models/cover.py fetched (data/models/<city>-cover.json; OpenStreetMap via Overture,
// ODbL):
//
//   public/models/<city>-cover.png   the same frame and size as <city>-ground.png (scripts/models/build.mjs):
//                                    r = parks, gardens, pitches, cemeteries and grass; g = trees
//
//   node scripts/models/cover.mjs --city new-york

import { readFile, writeFile } from 'node:fs/promises'
import zlib from 'node:zlib'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const SPECS = JSON.parse(await readFile(new URL('../../src/content/models.json', import.meta.url), 'utf8'))
const spec = SPECS[CITY]
if (!spec) {
  console.error(`usage: node scripts/models/cover.mjs --city <${Object.keys(SPECS).join('|')}>`)
  process.exit(1)
}

// The plinth's frame and the ground map's grid, exactly as build.mjs sets them.
const RAD = Math.PI / 180
const [LAT0, LON0] = spec.center
const L = spec.halfLength
const W = spec.halfWidth
const BETA = spec.axisBearing * RAD
const CELL = Math.max(2, (2 * L) / 4096)
const GW = Math.round((2 * L) / CELL)
const GH = Math.round((2 * W) / CELL)
const AO_STEP = 2
const aw = Math.ceil(GW / AO_STEP)
const ah = Math.ceil(GH / AO_STEP)
const M_LAT = 110540
const M_LON = 111320 * Math.cos(LAT0 * RAD)
const sinB = Math.sin(BETA)
const cosB = Math.cos(BETA)
const toUV = ([lon, lat]) => {
  const e = (lon - LON0) * M_LON
  const n = (lat - LAT0) * M_LAT
  return [e * sinB + n * cosB, e * cosB - n * sinB]
}

// Supersampled even-odd fill: each output texel is 4 x 4 samples, so edges are fractional.
const SS = 4
const SW = aw * SS
const SH = ah * SS
const sx = (u) => ((u + L) / (2 * L)) * SW
const sy = (v) => ((v + W) / (2 * W)) * SH
function fill(rings, mask) {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rings) for (const p of r) (lo = Math.min(lo, sy(p[1]))), (hi = Math.max(hi, sy(p[1])))
  const y0 = Math.max(0, Math.floor(lo))
  const y1 = Math.min(SH - 1, Math.ceil(hi))
  const xs = []
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5
    xs.length = 0
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ya = sy(r[j][1])
        const yb = sy(r[i][1])
        if (ya <= yc === yb <= yc) continue
        const xa = sx(r[j][0])
        const xb = sx(r[i][0])
        xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa))
      }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const x1 = Math.min(SW - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = x0; x <= x1; x++) mask[y * SW + x] = 1
    }
  }
}

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])
const cover = JSON.parse(await readFile(new URL(`../../data/models/${CITY}-cover.json`, import.meta.url), 'utf8'))
const green = new Uint8Array(SW * SH)
const trees = new Uint8Array(SW * SH)
const counts = { park: 0, grass: 0, trees: 0 }
for (const c of cover)
  for (const poly of polygonsOf(c.geometry)) {
    const rings = poly.map((r) => r.map(toUV))
    fill(rings, c.kind === 'trees' ? trees : green)
    counts[c.kind]++
  }

const png = Buffer.alloc(ah * (1 + aw * 3))
let parkTexels = 0
for (let y = 0; y < ah; y++) {
  const row = y * (1 + aw * 3)
  for (let x = 0; x < aw; x++) {
    let g = 0
    let t = 0
    for (let dy = 0; dy < SS; dy++)
      for (let dx = 0; dx < SS; dx++) {
        const i = (y * SS + dy) * SW + x * SS + dx
        g += green[i]
        t += trees[i]
      }
    const o = row + 1 + x * 3
    png[o] = Math.round((g / (SS * SS)) * 255)
    png[o + 1] = Math.round((t / (SS * SS)) * 255)
    png[o + 2] = 0
    if (g) parkTexels++
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
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

await writeFile(new URL(`../../public/models/${CITY}-cover.png`, import.meta.url), encodePng(png, aw, ah))
console.log(`${CITY}: cover ${aw}x${ah}, ${counts.park} park, ${counts.grass} grass, ${counts.trees} tree polygons; ${((parkTexels / (aw * ah)) * 100).toFixed(1)}% of texels touch green`)
