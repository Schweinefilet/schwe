#!/usr/bin/env node
// Builds public/sky/stars.bin from the Yale Bright Star Catalogue, 5th Revised Ed.
// (Hoffleit & Warren 1991, NASA Astronomical Data Center), as distributed by CDS (catalogue V/50).
// Positions J2000, visual magnitude, B-V colour. Numbers only, no imagery.
//
//   npm run sky:stars -- [--in catalog.gz] [--max-mag 4.5] [--out public/sky/stars.bin]
//
// Without --in it downloads the catalogue from CDS. Output: Float32 records of
// [ra (rad), dec (rad), V mag, B-V], brightest first. Unknown B-V is written as 9 (drawn white).

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { gunzipSync } from 'node:zlib'

const SOURCE = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const maxMag = Number(arg('max-mag', 4.5))
const out = arg('out', 'public/sky/stars.bin')

const gz = arg('in') ? await readFile(arg('in')) : Buffer.from(await (await fetch(SOURCE)).arrayBuffer())
const text = gunzipSync(gz).toString('latin1')

// Fixed-width columns from the catalogue's ReadMe (1-based, inclusive).
const col = (line, a, b) => line.slice(a - 1, b).trim()
const stars = []
for (const line of text.split('\n')) {
  if (line.length < 114) continue
  const vmag = parseFloat(col(line, 103, 107))
  const rah = col(line, 76, 77)
  if (!Number.isFinite(vmag) || vmag > maxMag || rah === '') continue // novae and galaxies have no J2000 position
  const ra = ((+rah + +col(line, 78, 79) / 60 + +col(line, 80, 83) / 3600) * 15 * Math.PI) / 180
  const sign = col(line, 84, 84) === '-' ? -1 : 1
  const dec = (sign * (+col(line, 85, 86) + +col(line, 87, 88) / 60 + +col(line, 89, 90) / 3600) * Math.PI) / 180
  const bvText = col(line, 110, 114)
  const bv = bvText === '' ? 9 : parseFloat(bvText)
  stars.push([ra, dec, vmag, bv])
}
stars.sort((a, b) => a[2] - b[2])

await mkdir(dirname(out), { recursive: true })
await writeFile(out, Buffer.from(new Float32Array(stars.flat()).buffer))
console.log(`${stars.length} stars to V ${maxMag} → ${out} (${stars.length * 16} bytes); brightest V ${stars[0][2]}`)
