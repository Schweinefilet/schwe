import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRaining, shown, usesFootage } from '../src/content/contentSource.js'
import { selectClips } from '../src/content/clipSelector.js'

const cities = [
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { id: 'london', name: 'London', lat: 51.5072, lon: -0.1276, tz: 'Europe/London' },
]
const NO_CLIPS = { version: 1, clips: [] }

test('only footage runs the clip machinery', () => {
  assert.equal(usesFootage('footage'), true)
  assert.equal(usesFootage('sky'), false)
})

test('shown: the sky shows the world, footage the clip that plays', () => {
  const row = { city: 'tokyo', clip: 'tokyo_night_clear', light: 'dusk', weather: 'rain' }
  assert.deepEqual(shown(row, 'sky'), { light: 'dusk', weather: 'rain' })
  assert.deepEqual(shown(row, 'footage'), { light: 'night', weather: 'clear' })
  assert.equal(shown({ ...row, clip: null }, 'footage'), null)
  assert.equal(isRaining(row, 'sky'), true)
  assert.equal(isRaining(row, 'footage'), false)
})

test('sky selection: no clips, rows carry what the sky needs (cloud cover, weather code)', async () => {
  const weather = {
    tokyo: { variant: 'rain', label: 'rain', code: 63, tempC: 21, mmPerHour: 3, rainInMinutes: 0, cloudCover: 0.9 },
  }
  const rows = await selectClips(NO_CLIPS, cities, new Date('2026-09-29T14:30Z'), weather)
  const tokyo = rows.find((r) => r.city === 'tokyo')
  assert.equal(tokyo.clip, null)
  assert.equal(tokyo.weather, 'rain')
  assert.equal(tokyo.cloudCover, 0.9)
  assert.equal(tokyo.code, 63)
  assert.equal(tokyo.light, 'night')
  // A city the weather didn't cover: clear, and no cloud data invented.
  const london = rows.find((r) => r.city === 'london')
  assert.equal(london.weather, 'clear')
  assert.equal(london.cloudCover, null)
  assert.equal(london.code, null)
})
