import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blendLook, dirFromAltAz, lookFor, occupancy, weatherOf } from '../src/city/look.js'

const NY = { lat: 40.7323, lon: -73.9935, tz: 'America/New_York' }
const LONDON = { lat: 51.508, lon: -0.101, tz: 'Europe/London' }

test('the sun: south at noon, in the model frame (x east, y up, z south)', () => {
  const [x, y, z] = dirFromAltAz(30, 180)
  assert.ok(Math.abs(x) < 1e-9 && y > 0 && z > 0)
})

test('New York at local noon in November: the sun is up, in the south, and no windows show', () => {
  const l = lookFor(NY, new Date('2026-11-10T17:00:00Z'), null)
  assert.ok(l.sunLight > 2)
  assert.ok(l.sunDir[2] > 0.5, 'toward the south')
  assert.equal(l.night, 0)
})

test('London at midnight: no sun, dark backdrop, windows on, few of them', () => {
  const l = lookFor(LONDON, new Date('2026-11-10T00:00:00Z'), null)
  assert.equal(l.sunLight, 0)
  assert.equal(l.night, 1)
  assert.ok(Math.max(...l.bg) < 0.05)
  assert.ok(l.lit > 0.1 && l.lit < 0.3)
})

test('more windows are lit in the evening than in the small hours', () => {
  assert.ok(occupancy(20) > occupancy(3) * 3)
})

test('unread weather is a clear sky, never an invented one', () => {
  assert.deepEqual(weatherOf(null), { cloud: 0, rain: 0, snow: 0, fog: 0, windKmh: 0, windFromDeg: 0 })
})

test('rain, snow and fog come from the reading: code, rate, visibility', () => {
  assert.ok(weatherOf({ current: { code: 63, mmPerHour: 4, cloud: 100 } }).rain > 0.5)
  assert.equal(weatherOf({ current: { code: 63, mmPerHour: 4 } }).snow, 0)
  assert.ok(weatherOf({ current: { code: 73, snowCm: 0.5 } }).snow > 0.3)
  assert.ok(weatherOf({ current: { code: 45 } }).fog > 0.5)
  assert.ok(weatherOf({ current: { code: 3, visibilityM: 800 } }).fog > 0.8)
  assert.equal(weatherOf({ current: { code: 0, visibilityM: 24000 } }).fog, 0)
})

test('overcast dims the sun and rain falls in the look', () => {
  const date = new Date('2026-11-10T17:00:00Z')
  const clear = lookFor(NY, date, null)
  const rain = lookFor(NY, date, { current: { code: 65, mmPerHour: 9, cloud: 100, windKmh: 30, windFromDeg: 270 } })
  assert.ok(rain.sunLight < clear.sunLight * 0.4)
  assert.ok(rain.rain > 0.9)
  assert.ok(rain.lean[0] > 0, 'a west wind leans the rain east')
})

test('a blend half way between two looks is half way, with a unit sun direction', () => {
  const a = lookFor(NY, new Date('2026-11-10T17:00:00Z'), null)
  const b = lookFor(LONDON, new Date('2026-11-10T00:00:00Z'), null)
  const m = blendLook({}, a, b, 0.5)
  assert.ok(Math.abs(m.night - 0.5) < 1e-9)
  assert.ok(Math.abs(Math.hypot(...m.sunDir) - 1) < 1e-9)
})
