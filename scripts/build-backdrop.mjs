#!/usr/bin/env node
// Writes the backdrop (BACKDROP in config.js) from a 360° HDR photograph (Radiance .hdr, equirectangular):
//   <out>.jpg       sharp, half size (drops are small; the site builds its mipmaps in linear light):
//                   what the drops show, since their image of the far city forms inside the drop
//   <out>-soft.jpg  out of focus, as a lens focused on the rain sees the far city: each direction is the
//                   mean over a disc --bokeh degrees in radius, so every lamp becomes an even, round disc
// Both are log-encoded (src/content/backdropCodec.js), values relative to the panorama's median
// luminance (solid-angle weighted), so BACKDROP.exposure sets the median's final brightness.
//
//   npm run backdrop -- --in data/backdrop/rathaus_2k.hdr --out public/backdrop/rathaus [--bokeh 1.2]
//
// Source: Poly Haven (CC0), https://polyhaven.com/a/rathaus
//   curl -o data/backdrop/rathaus_2k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rathaus_2k.hdr

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

// Log-encode (values already relative to the median) and write a 4:4:4 JPEG: chroma subsampling would
// smear coloured lamps.
async function writeJpeg({ width, height, data }, scale, max, file) {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < data.length; i++) raw[i] = Math.round(encodeBackdrop(data[i] * scale, max) * 255)
  const tmp = join(tmpdir(), `backdrop-${process.pid}.rgb`)
  await writeFile(tmp, raw)
  try {
    await run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', tmp, '-pix_fmt', 'yuvj444p', '-q:v', '3', file])
  } finally {
    await rm(tmp, { force: true })
  }
  console.log(`→ ${file}  ${width}×${height}, ${((await stat(file)).size / 1024).toFixed(0)} KB`)
}

const hdr = readHdr(await readFile(IN))
const median = medianLuminance(hdr)
console.log(`${IN}: ${hdr.width}×${hdr.height}, median luminance ${median.toPrecision(4)}`)
await mkdir(dirname(OUT), { recursive: true })
await writeJpeg(half(hdr), 1 / median, BACKDROP_CODEC.max.sharp, `${OUT}.jpg`)
const t0 = Date.now()
const soft = discBlur(hdr, (BOKEH_DEG * Math.PI) / 180)
console.log(`bokeh ${BOKEH_DEG}° radius, ${TAPS} taps: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
await writeJpeg(soft, 1 / median, BACKDROP_CODEC.max.soft, `${OUT}-soft.jpg`)
