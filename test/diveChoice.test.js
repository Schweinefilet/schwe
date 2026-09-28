import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseDiveCity } from '../src/content/diveChoice.js'

const row = (city, light, weather) => ({ city, clip: `${city}_${light}_${weather}` })
const first = () => 0 // deterministic tie-break: first of the best

test('rain outranks light, dusk/dawn outrank night, night outranks day', () => {
  assert.equal(chooseDiveCity([row('a', 'dusk', 'clear'), row('b', 'day', 'rain')], 'z', { random: first }), 'b')
  assert.equal(chooseDiveCity([row('a', 'night', 'clear'), row('b', 'dawn', 'clear')], 'z', { random: first }), 'b')
  assert.equal(chooseDiveCity([row('a', 'day', 'clear'), row('b', 'night', 'clear')], 'z', { random: first }), 'b')
  assert.equal(chooseDiveCity([row('a', 'day', 'rain'), row('b', 'dusk', 'rain')], 'z', { random: first }), 'b')
})

test('ties are broken by the random source', () => {
  const tie = [row('a', 'dusk', 'clear'), row('b', 'dawn', 'clear'), row('c', 'night', 'clear')]
  assert.equal(chooseDiveCity(tie, 'z', { random: () => 0 }), 'a')
  assert.equal(chooseDiveCity(tie, 'z', { random: () => 0.99 }), 'b')
})

test('excluded city is never picked', () => {
  const sel = [row('mumbai', 'dusk', 'rain'), row('tokyo', 'day', 'clear')]
  assert.equal(chooseDiveCity(sel, 'z', { exclude: 'mumbai' }), 'tokyo')
})

test('no usable rows: fallback', () => {
  assert.equal(chooseDiveCity([], 'mexico-city'), 'mexico-city')
  assert.equal(chooseDiveCity([{ city: 'x', clip: null }], 'mexico-city'), 'mexico-city')
  assert.equal(chooseDiveCity([row('a', 'dusk', 'clear')], 'mexico-city', { exclude: 'a' }), 'mexico-city')
})
