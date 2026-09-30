import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRainCity } from '../src/content/rainChoice.js'

// Footage: only a playing rain clip counts as rain.
const footage = (selection) => chooseRainCity(selection, { source: 'footage' })
const sky = (selection) => chooseRainCity(selection, { source: 'sky' })

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
  const r = footage([row('london', 'rain', { mmPerHour: 1.2 }), row('mumbai', 'rain', { mmPerHour: 7 }), row('paris', 'clear')])
  assert.deepEqual(r, { kind: 'now', city: 'mumbai', mmPerHour: 7, label: 'rain', of: 2 })
})

test('equal rain rate falls back to the heavier weather description', () => {
  const r = footage([
    row('a', 'rain', { mmPerHour: 2, weatherLabel: 'drizzle' }),
    row('b', 'rain', { mmPerHour: 2, weatherLabel: 'thunderstorm' }),
    row('c', 'rain', { mmPerHour: 2, weatherLabel: 'heavy rain' }),
  ])
  assert.equal(r.city, 'b')
})

test('a raining city without a rain clip does not count as raining', () => {
  const noRainClip = { ...row('tokyo', 'clear'), weatherLabel: 'heavy rain', mmPerHour: 9 }
  const r = footage([noRainClip, row('london', 'clear', { rainInMinutes: 40 })])
  assert.deepEqual(r, { kind: 'soon', city: 'london', minutes: 40 })
})

test('rain-clip city with no measured rate still beats a dry world', () => {
  const r = footage([row('paris', 'rain'), row('london', 'clear', { rainInMinutes: 0 })])
  assert.equal(r.kind, 'now')
  assert.equal(r.city, 'paris')
})

test('dry now: the city rain reaches first', () => {
  const r = footage([row('a', 'clear', { rainInMinutes: 95 }), row('b', 'clear', { rainInMinutes: 15 }), row('c', 'clear')])
  assert.deepEqual(r, { kind: 'soon', city: 'b', minutes: 15 })
})

test('rows without any clip are ignored', () => {
  const r = footage([{ city: 'x', clip: null, rainInMinutes: 5 }, row('y', 'clear', { rainInMinutes: 50 })])
  assert.equal(r.city, 'y')
})

test('no rain now or forecast: none', () => {
  assert.deepEqual(footage([row('a', 'clear'), row('b', 'clear')]), { kind: 'none' })
  assert.deepEqual(footage([]), { kind: 'none' })
  assert.deepEqual(footage(null), { kind: 'none' })
})

// Sky: every city can show rain, so the weather decides; there are no clips at all.
const skyRow = (city, weather, extra = {}) => ({ city, clip: null, light: 'night', weather, weatherLabel: weather === 'rain' ? 'rain' : 'clear', mmPerHour: null, rainInMinutes: null, ...extra })

test('sky: a raining city counts without any clip', () => {
  const r = sky([skyRow('tokyo', 'rain', { mmPerHour: 9, weatherLabel: 'heavy rain' }), skyRow('london', 'clear', { rainInMinutes: 40 })])
  assert.deepEqual(r, { kind: 'now', city: 'tokyo', mmPerHour: 9, label: 'heavy rain', of: 1 })
})

test('sky: rain the footage would have hidden (clear clip) still counts', () => {
  const r = sky([{ ...row('tokyo', 'clear'), weather: 'rain', weatherLabel: 'rain', mmPerHour: 3 }])
  assert.equal(r.city, 'tokyo')
  assert.equal(footage([{ ...row('tokyo', 'clear'), weather: 'rain', mmPerHour: 3 }]).kind, 'none')
})

test('sky: snow is not rain; heaviest rain wins; dry world falls back to soon, then none', () => {
  assert.equal(sky([skyRow('a', 'snow'), skyRow('b', 'rain', { mmPerHour: 1 }), skyRow('c', 'rain', { mmPerHour: 4 })]).city, 'c')
  assert.deepEqual(sky([skyRow('a', 'snow'), skyRow('b', 'clear', { rainInMinutes: 30 })]), { kind: 'soon', city: 'b', minutes: 30 })
  assert.deepEqual(sky([skyRow('a', 'clear'), skyRow('b', 'snow')]), { kind: 'none' })
})

test('the site default is the sky', () => {
  assert.equal(chooseRainCity([skyRow('mumbai', 'rain', { mmPerHour: 2 })]).city, 'mumbai')
})

// Unknown weather (the request failed or timed out): no answer is made up.
test('no weather read at all: unknown, not "dry everywhere"', () => {
  const unread = (city) => skyRow(city, 'clear', { weatherLabel: null, weatherKnown: false })
  assert.deepEqual(sky([unread('a'), unread('b')]), { kind: 'unknown' })
  assert.deepEqual(footage([{ ...row('a', 'clear'), weatherKnown: false }]), { kind: 'unknown' })
})

test('cities whose weather was not read are left out of the answer', () => {
  const r = sky([skyRow('a', 'clear', { weatherKnown: false, rainInMinutes: 5 }), skyRow('b', 'rain', { mmPerHour: 0.4, weatherKnown: true })])
  assert.deepEqual(r, { kind: 'now', city: 'b', mmPerHour: 0.4, label: 'rain', of: 1 })
  assert.deepEqual(sky([skyRow('a', 'clear', { weatherKnown: false, rainInMinutes: 5 }), skyRow('b', 'clear', { weatherKnown: true })]), { kind: 'none' })
})
