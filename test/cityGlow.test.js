import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { sampleAtlas } from '../scripts/lib/atlas.mjs'
import { cityGlowZenith, NATURAL_SKY_MCD } from '../src/sky/inputs.js'

// A tiny atlas like the real one: lat/lon grid, 30″ pixels, value = column + 100 × row.
async function fixture() {
  const width = 40
  const height = 30
  const values = Float32Array.from({ length: width * height }, (_, i) => (i % width) + 100 * Math.floor(i / width))
  const d = 30 / 3600
  const buffer = writeArrayBuffer(values, {
    width,
    height,
    ModelPixelScale: [d, d, 0],
    ModelTiepoint: [0, 0, 0, 139.5, 35.8, 0], // top-left corner near Tokyo
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2,
    BitsPerSample: [32],
    SampleFormat: [3], // float, as the real atlas
  })
  return { image: await (await fromArrayBuffer(buffer)).getImage(), d }
}

test('atlas sampling: the pixel under a point and the mean of the window around it', async () => {
  const { image, d } = await fixture()
  // The centre of pixel (column 12, row 7).
  const lat = 35.8 - (7 + 0.5) * d
  const lon = 139.5 + (12 + 0.5) * d
  const one = await sampleAtlas(image, lat, lon, 0)
  assert.deepEqual(one.center, [12, 7])
  assert.equal(one.mean, 12 + 700)
  // A 5×5 window of a linear field averages to its centre value.
  const five = await sampleAtlas(image, lat, lon, 2)
  assert.equal(five.pixels, 25)
  assert.equal(five.mean, 712)
})

test('atlas sampling refuses points outside the map', async () => {
  const { image } = await fixture()
  await assert.rejects(() => sampleAtlas(image, 0, 0))
})

test('per-city atlas value (plus the natural sky) wins over the shared constant', () => {
  const glow = { zenith: 0.012, atlas: { values: { tokyo: 20 } } }
  assert.equal(cityGlowZenith('tokyo', glow), (20 + NATURAL_SKY_MCD) / 1000)
  assert.equal(cityGlowZenith('london', glow), 0.012)
  assert.equal(cityGlowZenith('tokyo', { zenith: 0.012, atlas: { values: {} } }), 0.012)
})

test('cityGlow.json: either empty or a value for every city, never partial', () => {
  const doc = JSON.parse(readFileSync(new URL('../src/content/cityGlow.json', import.meta.url)))
  const cities = JSON.parse(readFileSync(new URL('../src/content/cities.json', import.meta.url)))
  const ids = Object.keys(doc.values)
  if (!ids.length) return
  assert.ok(doc.source, 'values need a source')
  for (const c of cities) assert.ok(Number.isFinite(doc.values[c.id]) && doc.values[c.id] >= 0, c.id)
})
