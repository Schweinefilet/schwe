import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseDiveCity } from '../src/content/diveChoice.js'

// Footage: scored on the clip that plays.
const footage = (selection, fallback, opts = {}) => chooseDiveCity(selection, fallback, { source: 'footage', ...opts })
const row = (city, light, weather) => ({ city, clip: `${city}_${light}_${weather}` })
const first = () => 0 // deterministic tie-break: first of the best

test('rain outranks light, dusk/dawn outrank night, night outranks day', () => {
  assert.equal(footage([row('a', 'dusk', 'clear'), row('b', 'day', 'rain')], 'z', { random: first }), 'b')
  assert.equal(footage([row('a', 'night', 'clear'), row('b', 'dawn', 'clear')], 'z', { random: first }), 'b')
  assert.equal(footage([row('a', 'day', 'clear'), row('b', 'night', 'clear')], 'z', { random: first }), 'b')
  assert.equal(footage([row('a', 'day', 'rain'), row('b', 'dusk', 'rain')], 'z', { random: first }), 'b')
})

test('ties are broken by the random source', () => {
  const tie = [row('a', 'dusk', 'clear'), row('b', 'dawn', 'clear'), row('c', 'night', 'clear')]
  assert.equal(footage(tie, 'z', { random: () => 0 }), 'a')
  assert.equal(footage(tie, 'z', { random: () => 0.99 }), 'b')
})

test('excluded city is never picked', () => {
  const sel = [row('mumbai', 'dusk', 'rain'), row('tokyo', 'day', 'clear')]
  assert.equal(footage(sel, 'z', { exclude: 'mumbai' }), 'tokyo')
})

test('no usable rows: fallback', () => {
  assert.equal(footage([], 'mexico-city'), 'mexico-city')
  assert.equal(footage([{ city: 'x', clip: null }], 'mexico-city'), 'mexico-city')
  assert.equal(footage([row('a', 'dusk', 'clear')], 'mexico-city', { exclude: 'a' }), 'mexico-city')
})

// Sky: scored on the light and weather the sky shows, with no clips.
const skyRow = (city, light, weather) => ({ city, clip: null, light, weather })

test('sky: rain outranks light, dusk/dawn outrank night, night outranks day, no clips needed', () => {
  const pick = (sel) => chooseDiveCity(sel, 'z', { source: 'sky', random: first })
  assert.equal(pick([skyRow('a', 'dusk', 'clear'), skyRow('b', 'day', 'rain')]), 'b')
  assert.equal(pick([skyRow('a', 'night', 'clear'), skyRow('b', 'dawn', 'clear')]), 'b')
  assert.equal(pick([skyRow('a', 'day', 'clear'), skyRow('b', 'night', 'clear')]), 'b')
  assert.equal(pick([skyRow('a', 'day', 'snow'), skyRow('b', 'night', 'clear')]), 'b')
})

test('sky: exclude still applies, and an empty selection falls back', () => {
  assert.equal(chooseDiveCity([skyRow('mumbai', 'dusk', 'rain'), skyRow('tokyo', 'night', 'clear')], 'z', { source: 'sky', exclude: 'mumbai' }), 'tokyo')
  assert.equal(chooseDiveCity([], 'mexico-city', { source: 'sky' }), 'mexico-city')
})
