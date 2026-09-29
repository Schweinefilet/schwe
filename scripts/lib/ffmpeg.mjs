// Shared ffmpeg helpers for the clip scripts (ingest, contact sheet).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'

export const FFMPEG = process.env.FFMPEG || 'ffmpeg'

const FONT_CANDIDATES = [
  process.env.FONT_FILE,
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
].filter(Boolean)

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

export function requireFfmpeg() {
  if (spawnSync(FFMPEG, ['-version']).error) {
    fail(`ffmpeg not found (${FFMPEG}). Install it (macOS: brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.`)
  }
}

export function font() {
  const f = FONT_CANDIDATES.find((p) => fs.existsSync(p))
  if (!f) fail('No font found for drawtext. Set FONT_FILE=/path/to/font.ttf')
  return f
}

export function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`))))
  })
}

// What ffmpeg reports about a file, parsed from `ffmpeg -i` (no ffprobe needed).
export function probe(file) {
  const { stderr } = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const text = stderr ?? ''
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text)
  const video = /Stream #\S+.*?: Video: (.*)/.exec(text)?.[1] ?? null
  const size = video && /, (\d{2,5})x(\d{2,5})[, ]/.exec(video)
  const fps = video && /([\d.]+) fps/.exec(video)
  return {
    exists: !!video,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    // HLG / PQ / BT.2020 sources need tone mapping; they would look wrong converted naively.
    hdr: !!video && /bt2020|arib-std-b67|smpte2084/.test(video),
    comment: /^\s*comment\s*:\s*(.*)$/im.exec(text)?.[1]?.trim() ?? null,
    info: video,
  }
}
