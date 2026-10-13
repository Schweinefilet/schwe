// Ground elevations for a French city's scene (extract.mjs): IGN's RGE ALTI, the bare-earth model at 1 m
// (buildings, bridges and trees removed; heights in metres NGF-IGN69), from the Géoplateforme's raster WMS
// (open, no key) as float GeoTIFFs, cached in data/terrain/. Licence Ouverte Etalab 2.0: credit "IGN".
//
// A grid is asked for in the scene's own metres (x east, y north of the vantage; KX, KY as extract.mjs):
// its lat/lon box is the metre box under the same linear map, so each pixel is `res` metres square in the
// scene. Large grids come in tiles of at most TILE pixels a side.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fromArrayBuffer } from 'geotiff'

const WMS = 'https://data.geopf.fr/wms-r/wms'
const LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES'
const TILE = 2000

async function tile({ lat0, lon0, kx, ky, x0, y0, w, h, res, cacheDir }) {
  // WMS 1.3.0 in EPSG:4326 takes the box as lat, lon. Pixel centres sit res/2 inside it.
  const box = [lat0 + y0 / ky, lon0 + x0 / kx, lat0 + (y0 + h * res) / ky, lon0 + (x0 + w * res) / kx]
  const key = `ign-${box.map((v) => v.toFixed(6)).join('_')}-${w}x${h}.tif`
  const file = new URL(key, cacheDir)
  let buf = await readFile(file).catch(() => null)
  if (!buf) {
    const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYER}&STYLES=&CRS=EPSG:4326&BBOX=${box.join(',')}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/geotiff`
    for (let attempt = 0; ; attempt++) {
      const res_ = await fetch(url, { headers: { 'User-Agent': 'schwe.org site build (skyline terrain)' } }).catch((e) => ({ ok: false, status: e.message }))
      if (res_.ok && (res_.headers.get('content-type') ?? '').includes('tiff')) {
        buf = Buffer.from(await res_.arrayBuffer())
        break
      }
      if (attempt >= 4) throw new Error(`IGN WMS: ${res_.status}`)
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
    }
    await writeFile(file, buf)
  }
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const img = await tiff.getImage()
  const [data] = await img.readRasters()
  return data // rows from the north (top) down
}

// A grid of elevations (m NGF) over x0..x1, y0..y1 at `res` metres: { x0, y0, res, w, h, z } with z row by row
// from the south (y0) up, so z[j * w + i] is at (x0 + (i + 0.5) res, y0 + (j + 0.5) res).
export async function ignGrid({ lat0, lon0, kx, ky, x0, x1, y0, y1, res, cacheDir }) {
  await mkdir(cacheDir, { recursive: true })
  const w = Math.round((x1 - x0) / res)
  const h = Math.round((y1 - y0) / res)
  const z = new Float32Array(w * h)
  for (let ty = 0; ty < h; ty += TILE)
    for (let tx = 0; tx < w; tx += TILE) {
      const tw = Math.min(TILE, w - tx)
      const th = Math.min(TILE, h - ty)
      const d = await tile({ lat0, lon0, kx, ky, x0: x0 + tx * res, y0: y0 + ty * res, w: tw, h: th, res, cacheDir })
      for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) z[(ty + th - 1 - r) * w + tx + c] = d[r * tw + c]
    }
  // No-data (the WMS writes a large negative value) from its neighbours: a few pixels at most.
  for (let i = 0; i < z.length; i++) if (!(z[i] > -100)) z[i] = NaN
  for (let pass = 0; pass < 8; pass++)
    for (let i = 0; i < z.length; i++)
      if (Number.isNaN(z[i])) {
        const n = [i - 1, i + 1, i - w, i + w].map((k) => z[k]).filter((v) => v > -100)
        if (n.length) z[i] = n.reduce((a, b) => a + b) / n.length
      }
  return { x0, y0, res, w, h, z }
}

// Bilinear elevation at (x, y) from the first grid that holds it, or null.
export function gridSampler(grids) {
  return (x, y) => {
    for (const g of grids) {
      const fx = (x - g.x0) / g.res - 0.5
      const fy = (y - g.y0) / g.res - 0.5
      if (fx < 0 || fy < 0 || fx > g.w - 1 || fy > g.h - 1) continue
      const i = Math.min(Math.floor(fx), g.w - 2)
      const j = Math.min(Math.floor(fy), g.h - 2)
      const u = fx - i
      const v = fy - j
      const at = (a, b) => g.z[(j + b) * g.w + i + a]
      return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v
    }
    return null
  }
}
