import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveTier } from '../src/core/gpuScore.js'

const m5 = 'apple, angle metal renderer: apple m5, unspecified version (ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version))'

test('known GPUs keep their benchmark tier', () => {
  assert.equal(effectiveTier({ type: 'BENCHMARK', tier: 1, gpu: 'intel hd 4000' }), 1)
  assert.equal(effectiveTier({ type: 'BENCHMARK', tier: 3, gpu: 'apple m4' }), 3)
})

test('unknown Apple Silicon (newer than the data) starts at tier 3', () => {
  assert.equal(effectiveTier({ type: 'FALLBACK', tier: 1, gpu: m5 }), 3)
})

test('any other unknown GPU starts at tier 2, not 1', () => {
  assert.equal(effectiveTier({ type: 'FALLBACK', tier: 1, gpu: 'some future gpu' }), 2)
  assert.equal(effectiveTier({ type: 'FALLBACK', tier: 1 }), 2)
})
