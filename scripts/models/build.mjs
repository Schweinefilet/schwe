#!/usr/bin/env node
// A city's maquette for the site, from the Overture Maps extract scripts/models/fetch.py wrote
// (data/models/<city>-{buildings,water,infra}.json):
//
//   public/models/<city>.glb          every building and building part on the plinth, raised from its
//                                     outline to its mapped height with its mapped roof shape, and the
//                                     bridges as slabs. COLOR_0: r = ambient occlusion baked per vertex,
//                                     g = a per-building random number (the night windows' seed).
//   public/models/<city>-ground.png   the plinth's top, one texel per two grid cells each way: r = ambient
//                                     occlusion on the ground, g = water.
//
// The model's frame: metres, x east, y up, z south, about the city's centre in src/content/models.json.
// The plinth is that file's rectangle (halfLength along axisBearing, halfWidth across); a building is on
// it when its outline's centre is.
//
// Heights: the mapped height, else mapped floors x FLOOR_M, else the median of the city's known heights
// (a model needs some height for a building nobody has measured; the README of the data says which).
// OpenStreetMap's Simple 3D Buildings rule: an outline with parts is drawn by its parts alone.
//
//   node scripts/models/build.mjs --city new-york

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import zlib from 'node:zlib'
import { Document, NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { meshopt, quantize, reorder } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { Earcut } from 'three/src/extras/Earcut.js'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
const SPECS = JSON.parse(await readFile(new URL('../../src/content/models.json', import.meta.url), 'utf8'))
const spec = SPECS[CITY]
if (!spec) {
  console.error(`usage: node scripts/models/build.mjs --city <${Object.keys(SPECS).join('|')}>`)
  process.exit(1)
}

const RAD = Math.PI / 180
const FLOOR_M = 3.2
const MIN_AREA = 8 // m²: sheds and kiosks below this are left off
const SIMPLIFY_M = 0.4
const WATER_DROP = 5 // the water's surface below the land, for the ground's occlusion at the quays
const TALL = 50 // walls taller than this get a ring of vertices at MID, so the street's shade stays low
const MID = 22
const BRIDGE = { top: 9, thick: 2.5 } // bridge outlines carry no height: a deck this far above the plinth
const [LAT0, LON0] = spec.center
const L = spec.halfLength
const W = spec.halfWidth
const BETA = spec.axisBearing * RAD
const CELL = Math.max(2, (2 * L) / 4096) // the ground map's long side stays within a phone's texture size
const GW = Math.round((2 * L) / CELL)
const GH = Math.round((2 * W) / CELL)

// lon/lat → the plinth's frame: u along its axis, v to the right of it, metres from the centre.
const M_LAT = 110540
const M_LON = 111320 * Math.cos(LAT0 * RAD)
const sinB = Math.sin(BETA)
const cosB = Math.cos(BETA)
const toUV = ([lon, lat]) => {
  const e = (lon - LON0) * M_LON
  const n = (lat - LAT0) * M_LAT
  return [e * sinB + n * cosB, e * cosB - n * sinB]
}
// The plinth's frame → the model's (x east, z south).
const toXZ = (u, v) => [u * sinB + v * cosB, -(u * cosB - v * sinB)]

const load = async (kind) => JSON.parse(await readFile(new URL(`../../data/models/${CITY}-${kind}.json`, import.meta.url), 'utf8'))
const [rawBuildings, rawWater, rawInfra] = await Promise.all([load('buildings'), load('water'), load('infra')])

// ---------------------------------------------------------------------------------------------------
// Outlines

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return a / 2
}

function centroid(ring) {
  let x = 0
  let y = 0
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    x += (ring[j][0] + ring[i][0]) * f
    y += (ring[j][1] + ring[i][1]) * f
    a += f
  }
  return Math.abs(a) < 1e-9 ? ring[0] : [x / (3 * a), y / (3 * a)]
}

// Douglas-Peucker on a closed ring (first point not repeated).
function simplify(ring, tol) {
  if (ring.length <= 4) return ring
  const keep = new Uint8Array(ring.length)
  // Anchor on the two points farthest apart-ish: the first and the one farthest from it.
  let far = 0
  let best = -1
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2
    if (d > best) {
      best = d
      far = i
    }
  }
  keep[0] = keep[far] = 1
  const walk = (a, b) => {
    // a → b going forward round the ring
    const n = ring.length
    const [ax, ay] = ring[a]
    const [bx, by] = ring[b % n]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-9
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const p = ring[i % n]
      const d = Math.abs((p[0] - ax) * dy - (p[1] - ay) * dx) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > tol) {
      keep[at % n] = 1
      walk(a, at)
      walk(at, b)
    }
  }
  walk(0, far)
  walk(far, ring.length)
  const out = ring.filter((_, i) => keep[i])
  return out.length >= 3 ? out : ring
}

// A GeoJSON polygon → rings in the plinth's frame: outer counter-clockwise, holes clockwise, closed
// points dropped, simplified. Null when it is too small to draw.
function prepare(poly, minArea = MIN_AREA) {
  const rings = []
  for (let k = 0; k < poly.length; k++) {
    let ring = poly[k].map(toUV)
    if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 1e-6) ring = ring.slice(0, -1)
    ring = ring.filter((p, i) => i === 0 || Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) > 0.05)
    if (ring.length < 3) {
      if (k === 0) return null
      continue
    }
    ring = simplify(ring, SIMPLIFY_M)
    const a = signedArea(ring)
    if (k === 0 && Math.abs(a) < minArea) return null
    if (k > 0 && Math.abs(a) < 4) continue
    if (a > 0 !== (k === 0)) ring.reverse()
    rings.push(ring)
  }
  return rings.length ? rings : null
}

const onPlinth = ([u, v], margin = 12) => Math.abs(u) <= L - margin && Math.abs(v) <= W - margin

// ---------------------------------------------------------------------------------------------------
// The height field: the ground map's grid, each cell the top of what stands on it

const field = new Float32Array(GW * GH)
const water = new Uint8Array(GW * GH)
const gx = (u) => (u + L) / CELL
const gy = (v) => (v + W) / CELL

// Even-odd scanline fill of rings (plinth frame) over the grid.
function fill(rings, each) {
  let lo = Infinity
  let hi = -Infinity
  for (const ring of rings)
    for (const p of ring) {
      lo = Math.min(lo, gy(p[1]))
      hi = Math.max(hi, gy(p[1]))
    }
  const y0 = Math.max(0, Math.floor(lo))
  const y1 = Math.min(GH - 1, Math.ceil(hi))
  const xs = []
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5
    xs.length = 0
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ya = gy(ring[j][1])
        const yb = gy(ring[i][1])
        if (ya <= yc === yb <= yc) continue
        const xa = gx(ring[j][0])
        const xb = gx(ring[i][0])
        xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa))
      }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const x1 = Math.min(GW - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = x0; x <= x1; x++) each(y * GW + x)
    }
  }
}

for (const w of rawWater) {
  if (w.subtype === 'human_made' || w.class === 'swimming_pool' || w.class === 'wastewater' || w.class === 'fountain') continue
  for (const poly of polygonsOf(w.geometry)) {
    const rings = prepare(poly, 400)
    if (rings) fill(rings, (i) => (water[i] = 1))
  }
}
const piers = []
const bridges = []
for (const f of rawInfra) {
  for (const poly of polygonsOf(f.geometry)) {
    const rings = prepare(poly, 30)
    if (!rings) continue
    if (f.subtype === 'pier') {
      piers.push(rings)
      fill(rings, (i) => (water[i] = 0))
    } else if (f.class !== 'bridge_support') bridges.push(rings)
  }
}
for (let i = 0; i < field.length; i++) field[i] = water[i] ? -WATER_DROP : 0

// ---------------------------------------------------------------------------------------------------
// Buildings: which to draw, how tall

const heightOf = (b) => b.height ?? (b.num_floors ? b.num_floors * FLOOR_M + (b.roof_height ?? 0) : null)
const known = rawBuildings.map(heightOf).filter((h) => h > 0).sort((a, b) => a - b)
const MEDIAN = known[known.length >> 1]

function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return ((h >>> 0) % 251) / 250
}

const solids = []
let assumed = 0
for (const b of rawBuildings) {
  if (b.kind === 'building' && b.has_parts) continue
  let top = heightOf(b)
  if (!(top > 0)) {
    // A part without a height takes nothing from us: only whole buildings get the median.
    if (b.kind === 'building_part') continue
    top = MEDIAN
    assumed++
  }
  const base = Math.max(0, b.min_height ?? (b.min_floor ? b.min_floor * FLOOR_M : 0))
  if (top - base < 0.3) continue
  for (const poly of polygonsOf(b.geometry)) {
    const rings = prepare(poly)
    if (!rings || !onPlinth(centroid(rings[0]))) continue
    solids.push({
      rings,
      base,
      top,
      shape: b.roof_shape ?? 'flat',
      roofH: b.roof_height ?? null,
      direction: b.roof_direction ?? null,
      orientation: b.roof_orientation ?? null,
      seed: hash01(b.building_id ?? b.id),
    })
  }
}
for (const s of solids) {
  const eave = s.shape === 'flat' ? s.top : s.top - (s.roofH ?? 0) / 2
  fill(s.rings, (i) => {
    if (eave > field[i]) field[i] = eave
  })
}

// ---------------------------------------------------------------------------------------------------
// Ambient occlusion from the height field: how much sky a point sees, 0..1

const STEPS = [2.5, 5, 10, 20, 40, 80]
const heightAt = (u, v) => {
  const x = Math.floor(gx(u))
  const y = Math.floor(gy(v))
  return x < 0 || y < 0 || x >= GW || y >= GH ? 0 : field[y * GW + x]
}
const RING8 = [...Array(8).keys()].map((k) => [Math.cos((k * Math.PI) / 4 + 0.2), Math.sin((k * Math.PI) / 4 + 0.2)])
const FAN = [-70, -45, -22, 0, 22, 45, 70].map((d) => d * RAD)

function skyOver(u, v, h, dirs) {
  let sum = 0
  for (const [dx, dy] of dirs) {
    let tan = 0
    for (const d of STEPS) {
      const t = (heightAt(u + dx * d, v + dy * d) - h) / d
      if (t > tan) tan = t
    }
    sum += 1 - tan / Math.sqrt(1 + tan * tan)
  }
  return sum / dirs.length
}
// At a wall: the half of the sky its outward normal (nx, ny) faces.
function skyAtWall(u, v, h, nx, ny) {
  const dirs = FAN.map((a) => [nx * Math.cos(a) - ny * Math.sin(a), nx * Math.sin(a) + ny * Math.cos(a)])
  return skyOver(u + nx * 1.6, v + ny * 1.6, h, dirs)
}

// ---------------------------------------------------------------------------------------------------
// Mesh

const pos = []
const col = []
const idx = []
let vcount = 0
function vert(u, v, h, ao, seed) {
  const [x, z] = toXZ(u, v)
  pos.push(x, h, z)
  col.push(Math.round(Math.min(1, Math.max(0, ao)) * 255), Math.round(seed * 255), 255, 255)
  return vcount++
}
const tri = (a, b, c) => a !== b && b !== c && a !== c && idx.push(a, b, c)
// In the plinth's frame a counter-clockwise ring seen from above has its outside to the right of travel;
// the model's z points south, which the triangle order below accounts for.
const quad = (a, b, c, d) => {
  tri(a, b, c)
  tri(a, c, d)
}

// Outward normals at a ring's corners (the mean of its two edges'), for where to sample the sky.
function cornerNormals(ring) {
  const n = ring.length
  const edge = ring.map((p, i) => {
    const q = ring[(i + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    return [dy / len, -dx / len]
  })
  return ring.map((_, i) => {
    const a = edge[(i + n - 1) % n]
    const b = edge[i]
    const x = a[0] + b[0]
    const y = a[1] + b[1]
    const len = Math.hypot(x, y)
    return len < 1e-3 ? b : [x / len, y / len]
  })
}

function triangulate(rings) {
  const flat = []
  const holes = []
  for (let k = 0; k < rings.length; k++) {
    if (k > 0) holes.push(flat.length / 2)
    for (const p of rings[k]) flat.push(p[0], p[1])
  }
  return Earcut.triangulate(flat, holes, 2)
}

// The minimum-area bounding rectangle of a ring: centre, long axis, half extents.
function orientedBox(ring) {
  let best = null
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len < 0.5) continue
    const ax = (q[0] - p[0]) / len
    const ay = (q[1] - p[1]) / len
    let a0 = Infinity
    let a1 = -Infinity
    let b0 = Infinity
    let b1 = -Infinity
    for (const r of ring) {
      const a = r[0] * ax + r[1] * ay
      const b = -r[0] * ay + r[1] * ax
      a0 = Math.min(a0, a)
      a1 = Math.max(a1, a)
      b0 = Math.min(b0, b)
      b1 = Math.max(b1, b)
    }
    const area = (a1 - a0) * (b1 - b0)
    if (!best || area < best.area) best = { area, ax, ay, a: (a0 + a1) / 2, b: (b0 + b1) / 2, ha: (a1 - a0) / 2, hb: (b1 - b0) / 2 }
  }
  if (!best) return null
  const c = [best.a * best.ax - best.b * best.ay, best.a * best.ay + best.b * best.ax]
  return best.ha >= best.hb
    ? { c, axis: [best.ax, best.ay], half: best.ha, across: best.hb }
    : { c, axis: [-best.ay, best.ax], half: best.hb, across: best.ha }
}

const RIDGED = new Set(['gabled', 'hipped', 'half_hipped', 'gambrel', 'saltbox', 'mansard', 'round'])
const POINTED = new Set(['pyramidal', 'cone', 'dome', 'onion'])

function addSolid(s) {
  const { rings, base, top, seed } = s
  const outer = rings[0]
  let shape = s.shape
  const simple = rings.length === 1
  if ((RIDGED.has(shape) || POINTED.has(shape)) && !simple) shape = 'flat'
  if (RIDGED.has(shape) && outer.length > 16) shape = 'flat'
  let roofH = s.roofH
  if (shape !== 'flat' && roofH == null) {
    const box = orientedBox(outer)
    roofH = Math.min(top - base, shape === 'skillion' ? 0 : (box?.across ?? 3) * (POINTED.has(shape) ? 1 : 0.6))
  }
  if (shape === 'skillion' && (s.direction == null || !roofH)) shape = 'flat'
  if (shape === 'flat') roofH = 0
  roofH = Math.min(roofH, top - base)
  const eave = top - roofH

  // Each eave vertex's height: level, or for a skillion falling along its direction.
  let eaveAt = () => eave
  if (shape === 'skillion') {
    // roof:direction is the compass bearing the roof faces (falls toward).
    const d = s.direction * RAD
    const e = Math.sin(d)
    const n = Math.cos(d)
    const du = e * sinB + n * cosB
    const dv = e * cosB - n * sinB
    let lo = Infinity
    let hi = -Infinity
    for (const p of outer) {
      const t = p[0] * du + p[1] * dv
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    eaveAt = (p) => top - roofH * ((p[0] * du + p[1] * dv - lo) / (hi - lo || 1))
  }

  const topIdx = []
  const botIdx = []
  for (const ring of rings) {
    const normals = cornerNormals(ring)
    const n = ring.length
    const bot = []
    const mid = []
    const up = []
    const tall = eave - base > TALL
    for (let i = 0; i < n; i++) {
      const [u, v] = ring[i]
      const [nx, ny] = normals[i]
      const h = Math.max(base + 0.01, eaveAt(ring[i]))
      bot.push(vert(u, v, base, skyAtWall(u, v, base + 1, nx, ny), seed))
      if (tall) mid.push(vert(u, v, base + MID, skyAtWall(u, v, base + MID, nx, ny), seed))
      up.push(vert(u, v, h, skyAtWall(u, v, h, nx, ny), seed))
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      if (tall) {
        quad(bot[i], mid[i], mid[j], bot[j])
        quad(mid[i], up[i], up[j], mid[j])
      } else quad(bot[i], up[i], up[j], bot[j])
    }
    topIdx.push(...up)
    botIdx.push(...bot)
  }

  // An overhang's underside (a part that starts above the ground).
  if (base > 0.5) {
    const t = triangulate(rings)
    for (let i = 0; i < t.length; i += 3) tri(botIdx[t[i]], botIdx[t[i + 1]], botIdx[t[i + 2]])
  }

  const n = outer.length
  const roofSky = (u, v, h) => skyOver(u, v, h + 0.5, RING8)
  if (shape === 'flat' || shape === 'skillion') {
    const t = triangulate(rings)
    for (let i = 0; i < t.length; i += 3) tri(topIdx[t[i]], topIdx[t[i + 2]], topIdx[t[i + 1]])
    return
  }
  if (POINTED.has(shape)) {
    const [cu, cv] = centroid(outer)
    // Rings from the eave to the apex: straight for a pyramid, a quarter circle for a dome, a bulb for an onion.
    const profile =
      shape === 'dome'
        ? [1, 2, 3, 4, 5].map((k) => [Math.cos((k / 6) * 90 * RAD), Math.sin((k / 6) * 90 * RAD)])
        : shape === 'onion'
          ? [[1.18, 0.18], [1.12, 0.36], [0.8, 0.55], [0.4, 0.72], [0.14, 0.86]]
          : []
    let prev = topIdx
    for (const [r, t] of profile) {
      const h = eave + roofH * t
      const ring = outer.map(([u, v]) => {
        const pu = cu + (u - cu) * r
        const pv = cv + (v - cv) * r
        return vert(pu, pv, h, roofSky(pu, pv, h), seed)
      })
      for (let i = 0; i < n; i++) quad(prev[i], ring[i], ring[(i + 1) % n], prev[(i + 1) % n])
      prev = ring
    }
    const apex = vert(cu, cv, top, roofSky(cu, cv, top), seed)
    for (let i = 0; i < n; i++) tri(prev[i], apex, prev[(i + 1) % n])
    return
  }
  // Ridged roofs: every eave vertex rises to its nearest point on the ridge, a line along the outline's
  // long side (or across it, when mapped so). A hipped roof's ridge stops short of the ends; a gabled
  // one's runs through, which stands its end walls up as gables.
  const box = orientedBox(outer)
  if (!box) return
  let { axis, half, across } = box
  if (s.orientation === 'across') {
    axis = [-axis[1], axis[0]]
    ;[half, across] = [across, half]
  }
  const ridgeHalf = shape === 'hipped' || shape === 'mansard' ? Math.max(0, half - across) : shape === 'half_hipped' ? Math.max(0, half - across / 2) : half
  const onRidge = ([u, v]) => {
    const t = Math.min(ridgeHalf, Math.max(-ridgeHalf, (u - box.c[0]) * axis[0] + (v - box.c[1]) * axis[1]))
    return [box.c[0] + axis[0] * t, box.c[1] + axis[1] * t]
  }
  if (shape === 'mansard') {
    // Steep sides to a flat top a third of the way in.
    const inner = outer.map((p) => {
      const r = onRidge(p)
      return [p[0] + (r[0] - p[0]) * 0.3, p[1] + (r[1] - p[1]) * 0.3]
    })
    const ring = inner.map(([u, v]) => vert(u, v, top, roofSky(u, v, top), seed))
    for (let i = 0; i < n; i++) quad(topIdx[i], ring[i], ring[(i + 1) % n], topIdx[(i + 1) % n])
    const t = triangulate([inner])
    for (let i = 0; i < t.length; i += 3) tri(ring[t[i]], ring[t[i + 2]], ring[t[i + 1]])
    return
  }
  const ridge = outer.map((p) => {
    const [u, v] = onRidge(p)
    return vert(u, v, top, roofSky(u, v, top), seed)
  })
  const same = (i, j) => {
    const a = onRidge(outer[i])
    const b = onRidge(outer[j])
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (same(i, j)) tri(topIdx[i], ridge[i], topIdx[j])
    else quad(topIdx[i], ridge[i], ridge[j], topIdx[j])
  }
}

for (const s of solids) addSolid(s)
const buildingTris = idx.length / 3

// Bridges: their outlines as decks. Only those over water or wider than a footbridge read at this scale.
let bridgeCount = 0
for (const rings of bridges) {
  if (!onPlinth(centroid(rings[0]), 4) || Math.abs(signedArea(rings[0])) < 150) continue
  addSolid({ rings, base: BRIDGE.top - BRIDGE.thick, top: BRIDGE.top, shape: 'flat', seed: 0 })
  bridgeCount++
}

// ---------------------------------------------------------------------------------------------------
// The ground map

const AO_STEP = 2 // occlusion on every other cell each way, spread over the rest
const aw = Math.ceil(GW / AO_STEP)
const ah = Math.ceil(GH / AO_STEP)
const groundAo = new Float32Array(aw * ah)
for (let y = 0; y < ah; y++)
  for (let x = 0; x < aw; x++) {
    const u = (x * AO_STEP + 0.5) * CELL - L
    const v = (y * AO_STEP + 0.5) * CELL - W
    const h = heightAt(u, v)
    // Under a building the ground is never seen; give it its neighbours' shade rather than black.
    groundAo[y * aw + x] = h > 0.5 ? -1 : skyOver(u, v, h, RING8)
  }
// Cells under a building take the mean of their open neighbours (texture filtering reaches under the walls).
const openAo = (x, y) => {
  let sum = 0
  let n = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const a = groundAo[Math.min(ah - 1, Math.max(0, y + dy)) * aw + Math.min(aw - 1, Math.max(0, x + dx))]
      if (a < 0) continue
      sum += a
      n++
    }
  return n ? sum / n : 0.35
}
const png = Buffer.alloc(ah * (1 + aw * 3))
for (let y = 0; y < ah; y++) {
  const row = y * (1 + aw * 3)
  for (let x = 0; x < aw; x++) {
    const a = groundAo[y * aw + x]
    let wet = 0
    let cells = 0
    for (let dy = 0; dy < AO_STEP; dy++)
      for (let dx = 0; dx < AO_STEP; dx++) {
        const cx = x * AO_STEP + dx
        const cy = y * AO_STEP + dy
        if (cx >= GW || cy >= GH) continue
        wet += water[cy * GW + cx]
        cells++
      }
    const o = row + 1 + x * 3
    png[o] = Math.round((a < 0 ? openAo(x, y) : a) * 255)
    png[o + 1] = Math.round((wet / cells) * 255)
    png[o + 2] = 0
  }
}

function encodePng(raw, width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8 // bit depth
  head[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------------------------------
// Write

const doc = new Document()
const buffer = doc.createBuffer()
const position = doc.createAccessor('position').setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer)
const color = doc.createAccessor('color').setType('VEC4').setArray(new Uint8Array(col)).setNormalized(true).setBuffer(buffer)
const indices = doc.createAccessor('indices').setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer)
const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('COLOR_0', color).setIndices(indices)
const mesh = doc.createMesh('city').addPrimitive(prim)
doc.createScene('city').addChild(doc.createNode('city').setMesh(mesh))
doc.getRoot().getAsset().copyright = 'Buildings: © OpenStreetMap contributors, Overture Maps Foundation (ODbL)'
doc.createExtension(KHRMeshQuantization).setRequired(true)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
await MeshoptEncoder.ready
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 16, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))

const outDir = new URL('../../public/models/', import.meta.url)
await mkdir(outDir, { recursive: true })
const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const glb = await io.writeBinary(doc)
await writeFile(new URL(`${CITY}.glb`, outDir), glb)
const groundPng = encodePng(png, aw, ah)
await writeFile(new URL(`${CITY}-ground.png`, outDir), groundPng)

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`
console.log(
  `${CITY}: ${solids.length} solids (${assumed} at the median ${MEDIAN.toFixed(1)} m), ${bridgeCount} bridges, ${piers.length} piers; ` +
    `${vcount} vertices, ${idx.length / 3} triangles (${buildingTris} buildings); glb ${mb(glb.length)}, ground ${aw}x${ah} ${mb(groundPng.length)}`
)
