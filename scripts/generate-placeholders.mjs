#!/usr/bin/env node
// Generates placeholder clips for every city x light x weather using the final naming convention.
// Existing files are never overwritten, so real footage dropped into public/clips is safe.
// To regenerate a placeholder, delete it and run again.
//
// Env:
//   FFMPEG=/path/to/ffmpeg   (default: ffmpeg on PATH)
//   FONT_FILE=/path/to/font.ttf  (default: first system font found below)

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIGHT_STATES, clipId } from '../src/content/naming.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public/clips')
const CITIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/content/cities.json'), 'utf8'))

// Match the intended final encode so decoder load during testing is realistic.
const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const SECONDS = 10

// Snow is a valid weather state but not part of the launch set, so no placeholders for it.
const PLACEHOLDER_WEATHERS = ['clear', 'rain']

const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FONT_CANDIDATES = [
  process.env.FONT_FILE,
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
].filter(Boolean)

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

if (spawnSync(FFMPEG, ['-version']).error) {
  fail(`ffmpeg not found (${FFMPEG}). Install it (macOS: brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.`)
}
const FONT = FONT_CANDIDATES.find((f) => fs.existsSync(f))
if (!FONT) fail('No font found for drawtext. Set FONT_FILE=/path/to/font.ttf')

// ---- Placeholder scene --------------------------------------------------------------------------
// A crude city: sky gradient, a skyline silhouette standing on a horizon at the lower third (the clip
// spec), lit windows at night, and one light crossing the street so live video is easy to tell from a
// poster. The label sits in the sky, so an upside-down image inside a drop is obvious.

const HORIZON = Math.round(HEIGHT * (2 / 3))

// Sky colors per light state: [top, horizon].
const SKY = {
  night: ['0a0d18', '2a2230'],
  dawn: ['27304f', 'e39a73'],
  day: ['6d9ccc', 'd7e3ea'],
  dusk: ['1b2350', 'e0663a'],
}

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (rgb) => rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mixHex = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t))

// Deterministic per-city randomness, so a city's skyline is the same in every light state.
function rng(seed) {
  let x = seed | 0 || 1
  return () => ((x = (x * 1664525 + 1013904223) | 0) >>> 0) / 4294967296
}

function sceneFilter(job) {
  const [top, horizon] = SKY[job.light].map((c) => mixHex(c, job.color, 0.3))
  const lit = job.light === 'night' || job.light === 'dusk'
  const bodyColor = job.light === 'day' ? mixHex('3a4048', job.color, 0.2) : mixHex('07080b', job.color, 0.15)
  const groundColor = job.light === 'day' ? '4a4d52' : '101114'
  const rand = rng(job.cityIndex * 7919 + 17)

  const f = [`[0]drawbox=x=0:y=${HORIZON}:w=${WIDTH}:h=${HEIGHT - HORIZON}:color=0x${groundColor}:t=fill`]
  let x = -40
  while (x < WIDTH) {
    const w = Math.round(90 + rand() * 150)
    const h = Math.round(90 + rand() * 330)
    const y = HORIZON - h
    f.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x${bodyColor}:t=fill`)
    if (lit) {
      for (let row = y + 24; row < HORIZON - 30; row += 46) {
        for (let col = x + 16; col < x + w - 26; col += 38) {
          if (rand() < 0.35) f.push(`drawbox=x=${col}:y=${row}:w=14:h=20:color=0xffcf8a@0.85:t=fill`)
        }
      }
    }
    x += w + Math.round(rand() * 30)
  }
  if (job.weather === 'rain') f.push(`drawbox=x=0:y=0:w=${WIDTH}:h=${HEIGHT}:color=0x223344@0.35:t=fill`)

  // One headlight crossing the street, looping seamlessly over the clip length.
  const span = WIDTH + 200
  f[f.length - 1] += `[scene];[scene][1]overlay=x='mod(t*${span / SECONDS},${span})-200':y=${HORIZON + 110}:eval=frame`

  const big = Math.round(HEIGHT * 0.06)
  const small = Math.round(HEIGHT * 0.035)
  f.push(`drawtext=fontfile='${FONT}':text='${job.id}':fontcolor=white:fontsize=${big}:x=(w-text_w)/2:y=${Math.round(HEIGHT * 0.12)}`)
  f.push(`drawtext=fontfile='${FONT}':timecode='00\\:00\\:00\\:00':rate=${FPS}:fontcolor=white@0.75:fontsize=${small}:x=(w-text_w)/2:y=${Math.round(HEIGHT * 0.21)}`)
  return { top, horizon, graph: f.join(',') }
}

function outputs(id) {
  return {
    mp4: {
      file: path.join(OUT_DIR, `${id}.mp4`),
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '23',
        '-g', String(FPS), '-movflags', '+faststart'],
    },
    webm: {
      file: path.join(OUT_DIR, `${id}.webm`),
      args: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '36', '-deadline', 'realtime',
        '-cpu-used', '8', '-row-mt', '1', '-g', String(FPS)],
    },
    mp4_720: {
      file: path.join(OUT_DIR, `${id}_720.mp4`),
      scale: true,
      args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '24',
        '-g', String(FPS), '-movflags', '+faststart'],
    },
    webm_720: {
      file: path.join(OUT_DIR, `${id}_720.webm`),
      scale: true,
      args: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '37', '-deadline', 'realtime',
        '-cpu-used', '8', '-row-mt', '1', '-g', String(FPS)],
    },
    poster: {
      file: path.join(OUT_DIR, `${id}.jpg`),
      args: ['-frames:v', '1', '-q:v', '3'],
    },
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`))))
  })
}

async function makeOne(job) {
  const { top, horizon, graph } = sceneFilter(job)
  const input = [
    '-f', 'lavfi', '-i',
    `gradients=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECONDS}:c0=0x${top}:c1=0x${horizon}:x0=0:y0=0:x1=0:y1=${HORIZON}:speed=0.00001`,
    '-f', 'lavfi', '-i', `color=c=0xfff1c9:s=120x10:r=${FPS}:d=${SECONDS}`,
  ]
  for (const out of job.missing) {
    // Write to a temp name first so an interrupted run never leaves a half-written file with a real name.
    const tmp = out.file.replace(/(\.\w+)$/, '.partial$1')
    await run([...input, '-filter_complex', out.scale ? `${graph},scale=1280:720` : graph, '-an', ...out.args, tmp])
    fs.renameSync(tmp, out.file)
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const jobs = []
  let skipped = 0
  for (const [cityIndex, city] of CITIES.entries()) {
    for (const light of LIGHT_STATES) {
      for (const weather of PLACEHOLDER_WEATHERS) {
        const id = clipId(city.id, light, weather)
        const missing = Object.values(outputs(id)).filter((o) => !fs.existsSync(o.file))
        skipped += Object.keys(outputs(id)).length - missing.length
        if (missing.length) jobs.push({ id, cityIndex, light, weather, color: city.color.replace('#', ''), missing })
      }
    }
  }

  console.log(`Placeholders: ${jobs.length} clips to generate, ${skipped} files already present (kept).`)
  const concurrency = Math.max(1, Math.floor(os.cpus().length / 2))
  let done = 0
  const queue = [...jobs]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const job = queue.shift()
      try {
        await makeOne(job)
        done++
        process.stdout.write(`\r  ${done}/${jobs.length}  ${job.id.padEnd(32)}`)
      } catch (e) {
        fail(`${job.id}: ${e.message}`)
      }
    }
  })
  await Promise.all(workers)
  if (jobs.length) process.stdout.write('\n')

  await import('./build-manifest.mjs')
}

main()
