import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eiffelLights } from '../src/sky/inputs.js'

test('the Eiffel Tower is lit from nightfall to midnight, 1 am in July and August', () => {
  assert.equal(eiffelLights(21.5, 10, 1).on, 1)
  assert.equal(eiffelLights(23.9, 10, 1).on, 1)
  assert.equal(eiffelLights(0.3, 10, 1).on, 0) // after midnight in October: dark
  assert.equal(eiffelLights(0.3, 7, 1).on, 1) // in July until 1 am
  assert.equal(eiffelLights(1.2, 8, 1).on, 0)
  assert.equal(eiffelLights(4.0, 1, 1).on, 0) // before dawn
  assert.equal(eiffelLights(14, 6, 0).on, 0) // by day
  assert.ok(eiffelLights(19, 10, 0.4).on > 0 && eiffelLights(19, 10, 0.4).on < 1) // coming on at dusk
})

test('it sparkles for the first five minutes of each hour once fully lit', () => {
  assert.equal(eiffelLights(22.02, 10, 1).spark, 1)
  assert.equal(eiffelLights(22.1, 10, 1).spark, 0)
  assert.equal(eiffelLights(23.05, 10, 1).spark, 1)
  assert.equal(eiffelLights(0.02, 10, 1).spark, 0) // the lights are off
  assert.equal(eiffelLights(0.02, 7, 1).spark, 1) // a summer night's midnight sparkle
  assert.equal(eiffelLights(20.02, 10, 0.4).spark, 0) // not yet dark
})
