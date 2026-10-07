import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driftSlots, visibleDrops } from '../src/core/visibleDrops.js'

// Ten drops as heroDropsFor('mexico-city') lays them out: nine drift drops, then the dive drop.
const ORDER = ['sydney', 'tokyo', 'hong-kong', 'mumbai', 'istanbul', 'paris', 'london', 'sao-paulo', 'new-york', 'mexico-city']
const drops = ORDER.map((city, i) => ({ pos: [0, 0, -i], city, dive: i === 9 }))
const cities = (shown) => shown.map((d) => d.city)

test('every tier keeps the dive drop and the rain city, each city once', () => {
  for (const count of [10, 8, 4]) {
    const shown = visibleDrops(drops, count, 'sao-paulo')
    assert.equal(shown.length, count)
    assert.ok(shown.some((d) => d.dive && d.city === 'mexico-city'))
    assert.ok(cities(shown).includes('sao-paulo'), `tier of ${count}`)
    assert.equal(new Set(cities(shown)).size, count)
  }
})

test('the rain city takes the last shown slot; positions never move', () => {
  const plain = visibleDrops(drops, 4)
  const kept = visibleDrops(drops, 4, 'sao-paulo')
  assert.deepEqual(
    kept.map((d) => d.pos),
    plain.map((d) => d.pos)
  )
  assert.deepEqual(cities(kept), ['mexico-city', 'tokyo', 'istanbul', 'sao-paulo'])
})

test('a rain city already shown, the dive city, or none changes nothing', () => {
  const plain = visibleDrops(drops, 4)
  assert.deepEqual(visibleDrops(drops, 4, 'tokyo'), plain)
  assert.deepEqual(visibleDrops(drops, 4, 'mexico-city'), plain)
  assert.deepEqual(visibleDrops(drops, 4, null), plain)
  assert.deepEqual(visibleDrops(drops, 4, 'atlantis'), plain)
})

test('the drift drops a tier shows are spread along it, in order, each once', () => {
  assert.deepEqual(driftSlots(9, 9), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(driftSlots(7, 9), [0, 1, 3, 4, 5, 7, 8])
  assert.deepEqual(driftSlots(3, 9), [1, 4, 7])
  for (let k = 1; k <= 9; k++) {
    const s = driftSlots(k, 9)
    assert.equal(new Set(s).size, k)
    assert.ok(s.every((v, i) => i === 0 || v > s[i - 1]) && s[0] >= 0 && s[k - 1] <= 8, `${k}: ${s}`)
  }
})
