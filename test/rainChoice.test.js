import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRainCity } from '../src/content/rainChoice.js'

// A selection row as selectClips() returns it. `weather` is the clip that plays.
const row = (city, weather, extra = {}) => ({
  city,
  clip: `${city}_night_${weather}`,
  weatherLabel: weather === 'rain' ? 'rain' : 'clear',
  mmPerHour: null,
  rainInMinutes: null,
  ...extra,
})

test('heaviest rain wins', () => {
  const r = chooseRainCity([row('london', 'rain', { mmPerHour: 1.2 }), row('mumbai', 'rain', { mmPerHour: 7 }), row('paris', 'clear')])
  assert.deepEqual(r, { kind: 'now', city: 'mumbai', mmPerHour: 7, label: 'rain' })
})

test('equal rain rate falls back to the heavier weather description', () => {
  const r = chooseRainCity([
    row('a', 'rain', { mmPerHour: 2, weatherLabel: 'drizzle' }),
    row('b', 'rain', { mmPerHour: 2, weatherLabel: 'thunderstorm' }),
    row('c', 'rain', { mmPerHour: 2, weatherLabel: 'heavy rain' }),
  ])
  assert.equal(r.city, 'b')
})

test('a raining city without a rain clip does not count as raining', () => {
  const noRainClip = { ...row('tokyo', 'clear'), weatherLabel: 'heavy rain', mmPerHour: 9 }
  const r = chooseRainCity([noRainClip, row('london', 'clear', { rainInMinutes: 40 })])
  assert.deepEqual(r, { kind: 'soon', city: 'london', minutes: 40 })
})

test('rain-clip city with no measured rate still beats a dry world', () => {
  const r = chooseRainCity([row('paris', 'rain'), row('london', 'clear', { rainInMinutes: 0 })])
  assert.equal(r.kind, 'now')
  assert.equal(r.city, 'paris')
})

test('dry now: the city rain reaches first', () => {
  const r = chooseRainCity([row('a', 'clear', { rainInMinutes: 95 }), row('b', 'clear', { rainInMinutes: 15 }), row('c', 'clear')])
  assert.deepEqual(r, { kind: 'soon', city: 'b', minutes: 15 })
})

test('rows without any clip are ignored', () => {
  const r = chooseRainCity([{ city: 'x', clip: null, rainInMinutes: 5 }, row('y', 'clear', { rainInMinutes: 50 })])
  assert.equal(r.city, 'y')
})

test('no rain now or forecast: none', () => {
  assert.deepEqual(chooseRainCity([row('a', 'clear'), row('b', 'clear')]), { kind: 'none' })
  assert.deepEqual(chooseRainCity([]), { kind: 'none' })
  assert.deepEqual(chooseRainCity(null), { kind: 'none' })
})
