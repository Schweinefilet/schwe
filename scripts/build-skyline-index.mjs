#!/usr/bin/env node
// Lists the cities with a rendered skyline the site can show (public/skyline/<city>.json, version 2:
// scripts/blender/) in src/content/skylines.json, so the page asks only for those and not for every
// city's file. Runs automatically before `npm run dev` and `npm run build`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'public/skyline')
const OUT = path.join(ROOT, 'src/content/skylines.json')

const cities = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).version === 2)
  .map((f) => f.replace(/\.json$/, ''))
  .sort()
const json = `${JSON.stringify(cities)}\n`
if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== json) fs.writeFileSync(OUT, json)
console.log(`Skylines: ${cities.join(', ') || 'none'} → src/content/skylines.json`)
