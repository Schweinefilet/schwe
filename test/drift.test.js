import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDrift } from '../src/core/drift.js'
import { createCameraPath, smoothKeys } from '../src/core/cameraPath.js'

const passes = [3, 4, 5]
const ARGS = {
  from: { at: 1, pos: [0, 5, 14], look: [0, 4, 0] },
  start: { z: 10 },
  end: { at: 6, pos: [0, 4.5, -10], look: [0, 4.5, -16] },
  arrive: { at: 7, pos: [0, 4.5, -11], look: [0, 4.5, -16] },
  y: 4.5,
  passes,
  drops: { pass: 0.12, around: [60, 240], lead: 0.4 },
  timing: { ease: 0.55, sigma: 0.14, rampIn: 1.5, blendOut: 0.7, approach: 1.5 },
  curve: (s) => [1.3 * Math.sin((2 * Math.PI * s) / 18), 0.35 * Math.sin((2 * Math.PI * s) / 11)],
  fade: [4, 5],
  gaze: { ahead: 3, lookToward: 0.35, sway: [0.07, 0.035], swayPeriod: [2.2, 1.6] },
}
const drift = buildDrift(ARGS)
const path = createCameraPath(drift.keys)
const at = (t) => path.sample(t, { pos: null, look: null })
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test('drift: starts at the top and comes to rest inside the drop', () => {
  assert.deepEqual(at(1).pos, [0, 5, 14])
  assert.ok(dist(at(7).pos, [0, 4.5, -11]) < 1e-9)
  assert.ok(dist(at(6.99).pos, at(7).pos) < 1e-4) // arriving at rest
})

test('drift: each drop is passed at exactly its pass distance', () => {
  for (const d of drift.drops) {
    let closest = Infinity
    for (let t = 1; t <= 7; t += 0.001) closest = Math.min(closest, dist(at(t).pos, d))
    assert.ok(Math.abs(closest - 0.12) < 0.003, `closest ${closest}`)
  }
})

test('drift: slowest at each pass moment, never going backwards', () => {
  const speed = (t) => dist(at(t + 0.005).pos, at(t - 0.005).pos) / 0.01
  for (const p of passes) assert.ok(speed(p) < 0.8 * speed(p + 0.25), `at ${p}`)
  // (From rest the first key's neighbour may overshoot by far less than a micrometre: nothing to see.)
  for (let t = 1.01; t < 7; t += 0.01) assert.ok(at(t).pos[2] <= at(t - 0.01).pos[2] + 1e-6, `z at ${t}`)
})

test('smoothKeys: pinned moments stay exact, a hold at the start stays still', () => {
  const keys = [
    { at: 0, pos: [0, 0, 0], look: [0, 0, -1] },
    { at: 1, pos: [0, 0, 0], look: [0, 0, -1] }, // held until 1
    { at: 2, pos: [1, 1, -2], look: [0, 0, -5] },
    { at: 3, pos: [2, 0, -3], look: [1, 0, -6], speed: 0.5 },
    { at: 4, pos: [3, 0, -5], look: [2, 0, -8] },
  ]
  const raw = createCameraPath(keys)
  const smooth = createCameraPath([keys[0], ...smoothKeys(keys, { sigma: 0.15, pins: [3, 4] })])
  const s = (p, t) => p.sample(t, { pos: null, look: null })
  for (const t of [3, 4]) assert.ok(dist(s(smooth, t).pos, s(raw, t).pos) < 1e-6, `pos at ${t}`)
  assert.ok(dist(s(smooth, 0.4).pos, [0, 0, 0]) < 1e-6) // well inside the hold (the pins' bumps reach it only faintly)
})

test('drift: a tier showing some drops slows only at those, past the same drops', () => {
  const show = [0, 2]
  const tier = buildDrift({ ...ARGS, show })
  assert.deepEqual(tier.drops, drift.drops) // positions never depend on what is shown
  assert.equal(tier.passes.length, show.length)
  const tierPath = createCameraPath(tier.keys)
  const pos = (t) => tierPath.sample(t, { pos: null, look: null }).pos
  const speed = (t) => dist(pos(t + 0.005), pos(t - 0.005)) / 0.01
  for (const [k, i] of show.entries()) {
    // Slowest at its pass moment, and that moment is where the camera passes its drop.
    const p = tier.passes[k]
    assert.ok(speed(p) < 0.8 * speed(p + 0.25) && speed(p) < 0.8 * speed(p - 0.25), `drop ${i} at ${p}`)
    let closest = Infinity
    for (let t = 1; t <= 7; t += 0.002) closest = Math.min(closest, dist(pos(t), drift.drops[i]))
    assert.ok(Math.abs(closest - 0.12) < 0.003, `closest ${closest}`)
  }
  // No slow point where the hidden drop was: the camera keeps its cruise there.
  const cruise = Math.max(speed(passes[1] - 0.3), speed(passes[1] + 0.3))
  assert.ok(speed(passes[1]) > 0.9 * cruise, `slowing at the hidden drop: ${speed(passes[1])} of ${cruise}`)
})
