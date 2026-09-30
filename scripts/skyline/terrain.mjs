// Ground elevations for a city's scene (extract.mjs): AWS Terrain Tiles (Mapzen's terrarium PNGs, open,
// no key; zoom 14 by default, about 7 m a pixel at 40° north, plenty for where a building stands),
// cached in data/terrain/. Bare earth: in the
// United States from USGS 3DEP (formerly NED), heights in metres above NAVD88. Credit, as the tiles'
// attribution asks: "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
// courtesy of the U.S. Geological Survey", and Mapzen.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const URL_OF = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
const RAD = Math.PI / 180

// An 8-bit RGB or RGBA PNG, not interlaced (what terrarium tiles are): its pixels, filters undone.
function decodePng(buf) {
  let off = 8
  let width = 0
  let height = 0
  let channels = 3
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6)) throw new Error('terrain tile: unexpected PNG format')
      channels = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]
      const a = i >= channels ? out[y * stride + i - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels] : 0
      let v = x
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + i] = v & 255
    }
  }
  return { width, height, channels, pixels: out }
}

async function tile(z, x, y, cache) {
  const file = new URL(`${z}-${x}-${y}.png`, cache)
  let buf = await readFile(file).catch(() => null)
  if (!buf) {
    const res = await fetch(URL_OF(z, x, y), { headers: { 'User-Agent': 'schwe.org site build (skyline terrain)' } })
    if (!res.ok) throw new Error(`terrain tile ${z}/${x}/${y}: HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
    await writeFile(file, buf)
  }
  const png = decodePng(buf)
  const elev = new Float32Array(png.width * png.height)
  for (let i = 0; i < elev.length; i++) {
    const p = i * png.channels
    elev[i] = png.pixels[p] * 256 + png.pixels[p + 1] + png.pixels[p + 2] / 256 - 32768
  }
  return elev
}

// A sampler over the box r metres around (lat0, lon0) in the scene's local metres (x east, y north;
// KX, KY as extract.mjs): elevation (m) by bilinear interpolation between tile pixel centres.
export async function terrainSampler({ lat0, lon0, r, kx, ky, zoom = 14, cacheDir }) {
  await mkdir(cacheDir, { recursive: true })
  const n = 2 ** zoom
  const tx = (lon) => ((lon + 180) / 360) * n
  const ty = (lat) => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n
  const lat = (y) => lat0 + y / ky
  const lon = (x) => lon0 + x / kx
  const [x0, x1] = [Math.floor(tx(lon(-r))), Math.floor(tx(lon(r)))]
  const [y0, y1] = [Math.floor(ty(lat(r))), Math.floor(ty(lat(-r)))]
  const tiles = new Map()
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.set(`${x},${y}`, await tile(zoom, x, y, cacheDir))
  const at = (px, py) => {
    const X = Math.floor(px / 256)
    const Y = Math.floor(py / 256)
    const t = tiles.get(`${X},${Y}`)
    if (!t) return null
    return t[(py - Y * 256) * 256 + (px - X * 256)]
  }
  return (x, y) => {
    const fx = tx(lon(x)) * 256 - 0.5
    const fy = ty(lat(y)) * 256 - 0.5
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const u = fx - ix
    const v = fy - iy
    const e = [at(ix, iy), at(ix + 1, iy), at(ix, iy + 1), at(ix + 1, iy + 1)]
    if (e.some((q) => q == null)) return null
    return (e[0] * (1 - u) + e[1] * u) * (1 - v) + (e[2] * (1 - u) + e[3] * u) * v
  }
}
