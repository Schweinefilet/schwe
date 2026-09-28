#!/usr/bin/env node
// Builds public/clips/manifest.json from whatever clips exist in public/clips.
// Runs automatically before `npm run dev` and `npm run build`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIGHT_STATES, MANIFEST_FILE, POSTER_EXT, parseClipFilename } from '../src/content/naming.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIP_DIR = path.join(ROOT, 'public/clips')
const CITIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/content/cities.json'), 'utf8'))

fs.mkdirSync(CLIP_DIR, { recursive: true })

const entries = new Map()
const ignored = []
for (const file of fs.readdirSync(CLIP_DIR).sort()) {
  if (file.startsWith('.') || file === MANIFEST_FILE || file.includes('.partial.')) continue
  const parsed = parseClipFilename(file)
  if (!parsed) {
    ignored.push(file)
    continue
  }
  const { id, city, light, weather, size, ext } = parsed
  if (!entries.has(id)) entries.set(id, { id, city, light, weather, sources: {}, poster: null })
  const entry = entries.get(id)
  if (ext === POSTER_EXT) entry.poster = file
  else entry.sources[size ? `${ext}_${size}` : ext] = file
}

const clips = [...entries.values()].filter((e) => e.sources.mp4 || e.sources.webm)
const manifest = { version: 1, generatedAt: new Date().toISOString(), clips }
fs.writeFileSync(path.join(CLIP_DIR, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')

const expected = CITIES.length * LIGHT_STATES.length * 2 // launch set: clear + rain; snow is optional
const noPoster = clips.filter((c) => !c.poster).map((c) => c.id)
const oneFormat = clips.filter((c) => !c.sources.mp4 || !c.sources.webm).map((c) => c.id)
const no720 = clips.filter((c) => !c.sources.mp4_720).map((c) => c.id)
console.log(`Manifest: ${clips.length}/${expected} clips → public/clips/${MANIFEST_FILE}`)
if (noPoster.length) console.warn(`  missing poster: ${noPoster.join(', ')}`)
if (oneFormat.length) console.warn(`  only one video format: ${oneFormat.join(', ')}`)
if (no720.length) console.warn(`  no 720p encode (drops will decode the full size): ${no720.length} clips`)
if (ignored.length) console.warn(`  ignored (name does not match city_light_weather.ext): ${ignored.join(', ')}`)
