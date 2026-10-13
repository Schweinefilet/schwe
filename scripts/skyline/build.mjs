#!/usr/bin/env node
// A city's skyline for its drop, end to end: OpenStreetMap data (fetch.mjs, with --fetch), the scene
// (extract.mjs), the panorama rendered in Blender once per variant (scripts/blender/skyline.py: its trees
// in leaf and bare), and packed for the site (scripts/blender/encode.py → public/skyline/<city>.json and
// public/skyline/<city>/<variant>-{light,night,windows}.png), and its smaller copies for the drops that
// show less (scripts/skyline/sets.py → <city>/half/, <city>/small/). Needs Blender 5 on PATH (or BLENDER=…).
//
//   npm run skyline -- --city london [--fetch] [--samples 128] [--scale 1] [--only leaf]
//   npm run skyline -- --city paris --pbf data/osm/pbf/ile-de-france-latest.osm.pbf
//
// Each variant renders five passes of 3840 × 1152 px at 128 samples: about ten minutes on an M-series GPU.

import { spawnSync } from 'node:child_process'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city')
if (!CITY) {
  console.error('usage: npm run skyline -- --city <id> [--fetch] [--samples 128] [--scale 1] [--only leaf|bare]')
  process.exit(1)
}
const BLENDER = process.env.BLENDER ?? 'blender'
// When each variant shows: plane trees are bare from December to March.
const VARIANTS = { leaf: [4, 5, 6, 7, 8, 9, 10, 11], bare: [12, 1, 2, 3] }

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`${cmd} failed (${r.error?.message ?? `exit ${r.status}`})`)
    process.exit(1)
  }
}

// --fetch asks Overpass for everything; --pbf <region.osm.pbf> cuts the buildings and the ground from a
// Geofabrik extract instead (pbf.mjs; the water and extras still from Overpass, with --fetch --only ...).
if (process.argv.includes('--fetch')) run('node', ['scripts/skyline/fetch.mjs', '--city', CITY, ...(arg('pbf') ? ['--only', 'water'] : [])])
if (process.argv.includes('--fetch') && arg('pbf')) run('node', ['scripts/skyline/fetch.mjs', '--city', CITY, '--only', 'extra'])
if (arg('pbf')) run('node', ['scripts/skyline/pbf.mjs', '--city', CITY, '--pbf', arg('pbf')])
run('node', ['scripts/skyline/extract.mjs', '--city', CITY])
// A city on its own ground (Paris): what its ground is made of, as maps (ground.py; skipped where none).
run('python3', ['scripts/skyline/ground.py', '--city', CITY])
for (const [variant, months] of Object.entries(VARIANTS)) {
  if (arg('only') && arg('only') !== variant) continue
  const out = `data/skyline/${CITY}/pano-${variant}`
  run(BLENDER, ['-b', '--factory-startup', '-P', 'scripts/blender/skyline.py', '--', '--city', CITY, '--view', 'pano', '--season', variant, '--scale', arg('scale', '1'), '--samples', arg('samples', '128'), '--out', out])
  run(BLENDER, ['-b', '--factory-startup', '-P', 'scripts/blender/encode.py', '--', '--city', CITY, '--render', out, '--variant', variant, '--months', months.join(',')])
}
run('python3', ['scripts/skyline/sets.py', '--city', CITY])
