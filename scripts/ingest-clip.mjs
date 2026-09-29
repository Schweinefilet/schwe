#!/usr/bin/env node
// Turns one piece of footage into a site clip under the naming convention:
//   {city}_{light}_{weather}.mp4/.webm (1920×1080), _720.mp4/.webm (1280×720), .jpg poster
// then rebuilds the manifest.
//
//   npm run clips:ingest -- <file> --city tokyo --light night --weather rain
//        [--start 3.5] [--duration 10] [--fade 1] [--focus 0.5] [--out public/clips] [--force]
//
// The clip loops seamlessly: `duration` + `fade` seconds are read, and the extra tail is crossfaded
// over the start, so the last frame runs straight into the first. Video only (city sound ships as
// separate audio), 30 fps, filled to 16:9 with a centre crop (`focus` moves it: 0 left, 1 right).
// Colour is left neutral and tagged Rec.709: the site's one LUT grades everything.
//
// Placeholders are replaced freely. A clip ingested before is only overwritten with --force.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { LIGHT_STATES, WEATHERS, clipId } from '../src/content/naming.js'
import { fail, probe, requireFfmpeg, run } from './lib/ffmpeg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CITIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/content/cities.json'), 'utf8'))
const FPS = 30
export const INGEST_TAG = 'schwe-ingest'

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    city: { type: 'string' },
    light: { type: 'string' },
    weather: { type: 'string' },
    start: { type: 'string', default: '0' },
    duration: { type: 'string', default: '10' },
    fade: { type: 'string', default: '1' },
    focus: { type: 'string', default: '0.5' },
    out: { type: 'string', default: 'public/clips' },
    force: { type: 'boolean', default: false },
  },
})

const source = positionals[0]
if (!source) fail('Usage: npm run clips:ingest -- <file> --city <id> --light <night|dawn|day|dusk> --weather <clear|rain|snow>')
if (!CITIES.some((c) => c.id === opt.city)) fail(`--city must be one of: ${CITIES.map((c) => c.id).join(', ')}`)
if (!LIGHT_STATES.includes(opt.light)) fail(`--light must be one of: ${LIGHT_STATES.join(', ')}`)
if (!WEATHERS.includes(opt.weather)) fail(`--weather must be one of: ${WEATHERS.join(', ')}`)
const start = Number(opt.start)
const duration = Number(opt.duration)
const fade = Number(opt.fade)
const focus = Number(opt.focus)
if (![start, duration, fade, focus].every(Number.isFinite) || duration <= 0 || fade < 0 || fade >= duration || focus < 0 || focus > 1) {
  fail('--start/--duration/--fade/--focus: numbers, 0 ≤ fade < duration, 0 ≤ focus ≤ 1')
}

requireFfmpeg()
const src = probe(source)
if (!src.exists) fail(`No video stream in ${source}`)
if (src.hdr) fail(`${path.basename(source)} is HDR (${src.info}).\nExport an SDR Rec.709 version (e.g. from Resolve) and ingest that; converting HDR here would look wrong and fight the grade.`)
if (src.duration != null && src.duration < start + duration + fade - 0.01) {
  fail(`${path.basename(source)} is ${src.duration.toFixed(2)} s; need start + duration + fade = ${(start + duration + fade).toFixed(2)} s (lower --duration or --fade)`)
}
const warnings = []
if (src.height && src.height < 1080) warnings.push(`source is ${src.width}×${src.height}: upscaled to 1080p, will look soft`)
if (src.width && src.height && src.height > src.width) warnings.push('source is portrait: the 16:9 crop keeps only its middle band')
if (src.fps && Math.abs(src.fps - FPS) > 0.5 && Math.abs(src.fps - 2 * FPS) > 0.5) warnings.push(`source is ${src.fps} fps: resampled to ${FPS} (may judder)`)

const outDir = path.resolve(ROOT, opt.out)
fs.mkdirSync(outDir, { recursive: true })
const id = clipId(opt.city, opt.light, opt.weather)
const file = (suffix, ext) => path.join(outDir, `${id}${suffix}.${ext}`)
const targets = { mp4: file('', 'mp4'), webm: file('', 'webm'), mp4_720: file('_720', 'mp4'), webm_720: file('_720', 'webm'), poster: file('', 'jpg') }

// Protect earlier real footage; placeholders carry no ingest tag.
const existing = probe(targets.mp4)
if (existing.exists && existing.comment?.startsWith(INGEST_TAG) && !opt.force) {
  fail(`${id} already holds ingested footage (${existing.comment}). Re-run with --force to replace it.`)
}

// Seamless loop: main = [0, d), tail = [d, d + fade). The tail, fading out, is laid over the start of
// main, so frame 0 continues straight from main's last frame and the crossfade hides the cut.
const d = duration.toFixed(3)
const e = (duration + fade).toFixed(3)
const prep = [
  `fps=${FPS}`,
  'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos',
  `crop=1920:1080:(iw-1920)*${focus}:(ih-1080)/2`,
  'setsar=1',
].join(',')
const graph = [
  `[0:v]${prep},split=2[a][b]`,
  `[a]trim=0:${d},setpts=PTS-STARTPTS[main]`,
  fade > 0
    ? `[b]trim=${d}:${e},setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:st=0:d=${fade}:alpha=1[tail];[main][tail]overlay=eof_action=pass:format=auto,format=yuv420p,split=4[f1][f2][s1][s2]`
    : `[b]nullsink;[main]format=yuv420p,split=4[f1][f2][s1][s2]`,
  '[s1]scale=1280:720:flags=lanczos[h1]',
  '[s2]scale=1280:720:flags=lanczos[h2]',
].join(';')

const tag = `${INGEST_TAG}:${path.basename(source)}@${start}s`
const common = ['-an', '-r', String(FPS), '-g', String(FPS), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-metadata', `comment=${tag}`]
const h264 = (crf, maxrate) => ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(crf), '-maxrate', maxrate, '-bufsize', maxrate.replace(/\d+/, (n) => String(n * 2)), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
const vp9 = (crf, cap) => ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', cap, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-tile-columns', '2', '-pix_fmt', 'yuv420p']

const partial = (f) => f.replace(/(\.\w+)$/, '.partial$1')
const t0 = Date.now()
console.log(`Ingesting ${path.basename(source)} → ${id} (${duration}s loop, ${fade}s crossfade, from ${start}s)`)
for (const w of warnings) console.warn(`  ! ${w}`)

try {
  await run([
    '-ss', String(start), '-t', String(duration + fade), '-i', source,
    '-filter_complex', graph,
    '-map', '[f1]', ...common, ...h264(20, '8M'), partial(targets.mp4),
    '-map', '[f2]', ...common, ...vp9(31, '6M'), partial(targets.webm),
    '-map', '[h1]', ...common, ...h264(21, '4M'), partial(targets.mp4_720),
    '-map', '[h2]', ...common, ...vp9(33, '3M'), partial(targets.webm_720),
  ])
  // Poster = the loop's first frame, so the poster → video crossfade never jumps.
  await run(['-i', partial(targets.mp4), '-frames:v', '1', '-vf', 'scale=960:540:flags=lanczos', '-q:v', '3', partial(targets.poster)])
} catch (err) {
  for (const f of Object.values(targets)) fs.rmSync(partial(f), { force: true })
  fail(err.message)
}
for (const f of Object.values(targets)) fs.renameSync(partial(f), f)

const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(0)} s: ${Object.values(targets).map((f) => `${path.basename(f)} ${kb(f)}`).join(', ')}`)

if (path.resolve(outDir) === path.join(ROOT, 'public/clips')) await import('./build-manifest.mjs')
