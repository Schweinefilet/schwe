#!/usr/bin/env node
// A contact sheet for judging clips side by side: one row per clip.
//   start | end (the loop seam: should flow into start) | middle | in a drop (upside down, at the
//   size a city appears in a drift drop on a 1080p screen, not at thumbnail scale)
//
//   npm run clips:sheet -- [--city tokyo] [--real] [--dir public/clips] [--out review/contact-sheet.jpg]
//
// --real shows only ingested footage (placeholders are skipped).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseClipFilename } from '../src/content/naming.js'
import { fail, font, probe, requireFfmpeg, run } from './lib/ffmpeg.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INGEST_TAG = 'schwe-ingest'
const W = 384
const H = 216
// A city seen through a drift drop spans roughly 1/7 of the frame height; at 1080p that is ~150 px,
// and the image in it is inverted both ways (a ball lens).
const DROP = 150

const { values: opt } = parseArgs({
  options: {
    city: { type: 'string' },
    real: { type: 'boolean', default: false },
    dir: { type: 'string', default: 'public/clips' },
    out: { type: 'string', default: 'review/contact-sheet.jpg' },
  },
})

requireFfmpeg()
const FONT = font()
const dir = path.resolve(ROOT, opt.dir)
if (!fs.existsSync(dir)) fail(`No clip folder at ${dir}`)

const clips = fs
  .readdirSync(dir)
  .map((f) => ({ f, c: parseClipFilename(f) }))
  .filter(({ c }) => c && c.ext === 'mp4' && !c.size && (!opt.city || c.city === opt.city))
  .map(({ f, c }) => ({ ...c, file: path.join(dir, f), meta: probe(path.join(dir, f)) }))
  .map((c) => ({ ...c, real: !!c.meta.comment?.startsWith(INGEST_TAG) }))
  .filter((c) => !opt.real || c.real)
  .sort((a, b) => Number(b.real) - Number(a.real) || a.id.localeCompare(b.id))
if (!clips.length) fail(`No clips match${opt.city ? ` --city ${opt.city}` : ''}${opt.real ? ' --real' : ''} in ${opt.dir}`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schwe-sheet-'))
const label = (text, size, y) => `drawtext=fontfile='${FONT}':text='${text.replace(/[':]/g, ' ')}':fontcolor=white:fontsize=${size}:x=10:y=${y}:box=1:boxcolor=black@0.55:boxborderw=5`
const cell = `scale=${W}:${H}:flags=lanczos,setsar=1`

console.log(`Contact sheet: ${clips.length} clip${clips.length > 1 ? 's' : ''}`)
try {
  for (const [i, c] of clips.entries()) {
    const mid = ((c.meta.duration ?? 10) / 2).toFixed(2)
    const source = c.real ? c.meta.comment.slice(INGEST_TAG.length + 1) : 'placeholder'
    const graph = [
      `[0:v]${cell},${label(c.id, 18, 8)},${label(source, 13, H - 26)}[a]`,
      `[1:v]${cell},${label('end → loops to start', 13, 8)}[b]`,
      `[2:v]${cell},${label('middle', 13, 8)}[c]`,
      // Ball-lens view at its real on-screen size (not thumbnail scale): inverted both ways, on black.
      `[3:v]scale=-2:${DROP}:flags=lanczos,hflip,vflip,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,${label('in a drop, actual size', 13, 8)}[d]`,
      '[a][b][c][d]hstack=4',
    ].join(';')
    await run([
      '-ss', '0', '-i', c.file,
      '-sseof', '-0.1', '-i', c.file,
      '-ss', mid, '-i', c.file,
      '-ss', mid, '-i', c.file,
      '-filter_complex', graph, '-frames:v', '1', path.join(tmp, `${String(i).padStart(3, '0')}.png`),
    ])
    process.stdout.write(`\r  ${i + 1}/${clips.length}`)
  }
  process.stdout.write('\n')
  const out = path.resolve(ROOT, opt.out)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await run(['-framerate', '1', '-i', path.join(tmp, '%03d.png'), '-vf', `tile=1x${clips.length}`, '-frames:v', '1', '-q:v', '3', out])
  const shown = path.relative(ROOT, out)
  console.log(`  → ${shown.startsWith('..') ? out : shown}`)
} catch (err) {
  fail(err.message)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
