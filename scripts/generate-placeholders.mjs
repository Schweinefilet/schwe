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
import { LIGHT_STATES, WEATHERS, clipId } from '../src/content/naming.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public/clips')
const CITIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/content/cities.json'), 'utf8'))

// Match the intended final encode so decoder load during testing is realistic.
const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const SECONDS = 10

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

function drawFilters(label) {
  const big = Math.round(HEIGHT * 0.06)
  const small = Math.round(HEIGHT * 0.04)
  const gap = Math.round(HEIGHT * 0.05)
  return [
    `drawtext=fontfile='${FONT}':text='${label}':fontcolor=white:fontsize=${big}:x=(w-text_w)/2:y=(h/2)-text_h-${gap / 2}`,
    `drawtext=fontfile='${FONT}':timecode='00\\:00\\:00\\:00':rate=${FPS}:fontcolor=white@0.75:fontsize=${small}:x=(w-text_w)/2:y=(h/2)+${gap / 2}`,
  ].join(',')
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
  const input = ['-f', 'lavfi', '-i', `color=c=0x${job.color}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECONDS}`]
  const vf = ['-vf', drawFilters(job.id)]
  for (const out of job.missing) {
    // Write to a temp name first so an interrupted run never leaves a half-written file with a real name.
    const tmp = out.file.replace(/(\.\w+)$/, '.partial$1')
    await run([...input, ...vf, '-an', ...out.args, tmp])
    fs.renameSync(tmp, out.file)
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const jobs = []
  let skipped = 0
  for (const city of CITIES) {
    for (const light of LIGHT_STATES) {
      for (const weather of WEATHERS) {
        const id = clipId(city.id, light, weather)
        const missing = Object.values(outputs(id)).filter((o) => !fs.existsSync(o.file))
        skipped += 3 - missing.length
        if (missing.length) jobs.push({ id, color: city.color.replace('#', ''), missing })
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
