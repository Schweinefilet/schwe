#!/usr/bin/env node
// Writes the backdrop (BACKDROP in config.js) from a 360° HDR photograph (Radiance .hdr, equirectangular):
//   <out>.jpg       sharp, half size (drops are small; the site builds its mipmaps in linear light):
//                   what the drops show, since their image of the far city forms inside the drop
//   <out>-soft.jpg  out of focus, as a lens focused on the rain sees the far city: each direction is the
//                   mean over a disc --bokeh degrees in radius, so every lamp becomes an even, round disc
// Both are log-encoded (src/content/backdropCodec.js), values relative to the panorama's median
// luminance (solid-angle weighted), so BACKDROP.exposure sets the median's final brightness.
//
//   npm run backdrop -- --in data/backdrop/rathaus_2k.hdr --out public/backdrop/rathaus [--bokeh 1.2] [--quality 3]
//
// With --view lon,lat,width,height (degrees, the panorama's own longitude and latitude) it writes only
// the start view (BACKDROP.view): the backdrop the first shot sees in focus, a window of a
// high-resolution copy, pixel for pixel, at full and half size:
//   <out>-view.jpg, <out>-view-half.jpg   in the soft map's range (the screen never shows more)
// --median-from takes the median from another copy (the one the other maps were built from), so all
// of them agree on brightness. It prints the window's exact edges for config.js.
//
//   npm run backdrop -- --in data/backdrop/rathaus_8k.hdr --out public/backdrop/rathaus \
//     --view -56,-4,110,70 --median-from data/backdrop/rathaus_2k.hdr --quality 5
//
// Source: Poly Haven (CC0), https://polyhaven.com/a/rathaus
//   curl -o data/backdrop/rathaus_2k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rathaus_2k.hdr
//   curl -o data/backdrop/rathaus_8k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/8k/rathaus_8k.hdr

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BACKDROP_CODEC, encodeBackdrop } from '../src/content/backdropCodec.js'
import { fail, requireFfmpeg, run } from './lib/ffmpeg.mjs'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const IN = arg('in')
const OUT = arg('out')
const BOKEH_DEG = Number(arg('bokeh', 1.2))
const VIEW = arg('view')?.split(',').map(Number) ?? null
const MEDIAN_FROM = arg('median-from')
const QUALITY = arg('quality', '3') // ffmpeg -q:v, 2 (best) … 31
const TAPS = 256
if (!IN || !OUT) fail('usage: npm run backdrop -- --in <panorama.hdr> --out <public/backdrop/name> [--bokeh 1.2]')
requireFfmpeg()

// Radiance RGBE, flat or new-style run-length scanlines.
function readHdr(buf) {
  let p = 0
  const line = () => {
    let s = ''
    while (buf[p] !== 10) s += String.fromCharCode(buf[p++])
    p++
    return s
  }
  if (!line().startsWith('#?')) fail(`${IN} is not a Radiance .hdr file`)
  let header
  while ((header = line()) !== '') if (header.startsWith('FORMAT=') && header !== 'FORMAT=32-bit_rle_rgbe') fail(`unsupported ${header}`)
  const m = line().match(/^-Y (\d+) \+X (\d+)$/)
  if (!m) fail('unsupported .hdr orientation (expected -Y h +X w)')
  const height = +m[1]
  const width = +m[2]
  const data = new Float32Array(width * height * 3)
  const scan = new Uint8Array(width * 4)
  for (let y = 0; y < height; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === width) {
      p += 4
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width; ) {
          let n = buf[p++]
          if (n > 128) {
            n -= 128
            const v = buf[p++]
            while (n--) scan[x++ * 4 + c] = v
          } else while (n--) scan[x++ * 4 + c] = buf[p++]
        }
      }
    } else for (let i = 0; i < width * 4; i++) scan[i] = buf[p++]
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3]
      const f = e ? 2 ** (e - 136) : 0
      const o = (y * width + x) * 3
      data[o] = scan[x * 4] * f
      data[o + 1] = scan[x * 4 + 1] * f
      data[o + 2] = scan[x * 4 + 2] * f
    }
  }
  return { width, height, data }
}

const lum = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]

// Median luminance, each row weighted by its solid angle (cos latitude), from a log histogram.
function medianLuminance({ width, height, data }) {
  const BINS = 4096
  const hist = new Float64Array(BINS)
  let total = 0
  for (let y = 0; y < height; y++) {
    const w = Math.cos(((y + 0.5) / height - 0.5) * Math.PI)
    for (let x = 0; x < width; x++) {
      const l = lum(data, (y * width + x) * 3)
      const bin = Math.max(0, Math.min(BINS - 1, Math.floor((Math.log2(l + 1e-12) + 32) * 64)))
      hist[bin] += w
      total += w
    }
  }
  for (let i = 0, acc = 0; i < BINS; i++) if ((acc += hist[i]) >= total / 2) return 2 ** ((i + 0.5) / 64 - 32)
}

// Disc blur on the sphere. Taps are a golden-angle spiral over the unit disc, placed in each row's
// tangent plane (east: 1 / cos latitude pixels per radian of longitude). Longitude wraps; latitude clamps.
function discBlur({ width, height, data }, radiusRad) {
  const out = new Float32Array(data.length)
  const perRad = width / (2 * Math.PI)
  const taps = Array.from({ length: TAPS }, (_, k) => {
    const r = Math.sqrt((k + 0.5) / TAPS)
    const a = k * Math.PI * (3 - Math.sqrt(5))
    return [r * Math.cos(a), r * Math.sin(a)]
  })
  const dx = new Float32Array(TAPS)
  const dy = taps.map(([, sy]) => -sy * radiusRad * perRad)
  for (let y = 0; y < height; y++) {
    const cosLat = Math.max(Math.cos(((y + 0.5) / height - 0.5) * Math.PI), 0.02)
    for (let k = 0; k < TAPS; k++) dx[k] = Math.max(-width / 2, Math.min(width / 2, (taps[k][0] * radiusRad * perRad) / cosLat))
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < TAPS; k++) {
        const u = x + dx[k]
        const v = Math.max(0, Math.min(height - 1.001, y + dy[k]))
        const x0 = Math.floor(u)
        const y0 = Math.floor(v)
        const fx = u - x0
        const fy = v - y0
        const xa = ((x0 % width) + width) % width
        const xb = (xa + 1) % width
        const i00 = (y0 * width + xa) * 3
        const i01 = (y0 * width + xb) * 3
        const i10 = i00 + width * 3
        const i11 = i01 + width * 3
        const w00 = (1 - fx) * (1 - fy)
        const w01 = fx * (1 - fy)
        const w10 = (1 - fx) * fy
        const w11 = fx * fy
        r += data[i00] * w00 + data[i01] * w01 + data[i10] * w10 + data[i11] * w11
        g += data[i00 + 1] * w00 + data[i01 + 1] * w01 + data[i10 + 1] * w10 + data[i11 + 1] * w11
        b += data[i00 + 2] * w00 + data[i01 + 2] * w01 + data[i10 + 2] * w10 + data[i11 + 2] * w11
      }
      const o = (y * width + x) * 3
      out[o] = r / TAPS
      out[o + 1] = g / TAPS
      out[o + 2] = b / TAPS
    }
  }
  return { width, height, data: out }
}

// Half size, each texel the mean of four (in linear light).
function half({ width, height, data }) {
  const w = width >> 1
  const h = height >> 1
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const i = (2 * y * width + 2 * x) * 3 + c
        out[(y * w + x) * 3 + c] = (data[i] + data[i + 3] + data[i + width * 3] + data[i + width * 3 + 3]) / 4
      }
  return { width: w, height: h, data: out }
}

// A window of the panorama, pixel for pixel (longitude wraps), and its exact edges in degrees.
function crop({ width, height, data }, [lon, lat, spanLon, spanLat]) {
  const w = 2 * Math.round(((spanLon / 360) * width) / 2) // even, for the half-size copy
  const h = 2 * Math.round(((spanLat / 180) * height) / 2)
  const x0 = Math.round(((lon - spanLon / 2) / 360 + 0.5) * width)
  const y0 = Math.round((0.5 - (lat + spanLat / 2) / 180) * height)
  if (y0 < 0 || y0 + h > height) fail('--view reaches past a pole')
  const out = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + ((((x0 + x) % width) + width) % width)) * 3
      out.set(data.subarray(i, i + 3), (y * w + x) * 3)
    }
  const deg = (v) => +v.toFixed(4)
  const edges = {
    lon: [deg((x0 / width - 0.5) * 360), deg(((x0 + w) / width - 0.5) * 360)],
    lat: [deg((0.5 - (y0 + h) / height) * 180), deg((0.5 - y0 / height) * 180)],
  }
  return { width: w, height: h, data: out, edges }
}

// Log-encode (values already relative to the median) and write a 4:4:4 JPEG: chroma subsampling would
// smear coloured lamps.
async function writeJpeg({ width, height, data }, scale, max, file) {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < data.length; i++) raw[i] = Math.round(encodeBackdrop(data[i] * scale, max) * 255)
  const tmp = join(tmpdir(), `backdrop-${process.pid}.rgb`)
  await writeFile(tmp, raw)
  try {
    await run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', tmp, '-pix_fmt', 'yuvj444p', '-q:v', QUALITY, file])
  } finally {
    await rm(tmp, { force: true })
  }
  console.log(`→ ${file}  ${width}×${height}, ${((await stat(file)).size / 1024).toFixed(0)} KB`)
}

const hdr = readHdr(await readFile(IN))
const ownMedian = medianLuminance(hdr)
console.log(`${IN}: ${hdr.width}×${hdr.height}, median luminance ${ownMedian.toPrecision(4)}`)
const median = MEDIAN_FROM ? medianLuminance(readHdr(await readFile(MEDIAN_FROM))) : ownMedian
if (MEDIAN_FROM) console.log(`${MEDIAN_FROM}: median luminance ${median.toPrecision(4)} (used)`)
await mkdir(dirname(OUT), { recursive: true })
if (VIEW) {
  if (VIEW.length !== 4 || VIEW.some(Number.isNaN)) fail('--view lon,lat,width,height (degrees)')
  const view = crop(hdr, VIEW)
  await writeJpeg(view, 1 / median, BACKDROP_CODEC.max.soft, `${OUT}-view.jpg`)
  await writeJpeg(half(view), 1 / median, BACKDROP_CODEC.max.soft, `${OUT}-view-half.jpg`)
  console.log(`view edges (config.js BACKDROP.view): lon: [${view.edges.lon.join(', ')}], lat: [${view.edges.lat.join(', ')}]`)
  process.exit(0)
}
await writeJpeg(half(hdr), 1 / median, BACKDROP_CODEC.max.sharp, `${OUT}.jpg`)
const t0 = Date.now()
const soft = discBlur(hdr, (BOKEH_DEG * Math.PI) / 180)
console.log(`bokeh ${BOKEH_DEG}° radius, ${TAPS} taps: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
await writeJpeg(soft, 1 / median, BACKDROP_CODEC.max.soft, `${OUT}-soft.jpg`)
