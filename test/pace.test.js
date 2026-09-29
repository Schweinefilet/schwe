import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPaceTable, rateAt, smoothDamp } from '../src/core/pace.js'

// Follows a jump to `target` at 60 fps; returns positions and velocities per frame.
function chase(target, maxSpeed, seconds, smoothTime = 0.1) {
  const dt = 1 / 60
  let x = 0
  let v = 0
  const xs = []
  const vs = []
  for (let t = 0; t < seconds; t += dt) {
    ;[x, v] = smoothDamp(x, v, target, smoothTime, maxSpeed, dt)
    xs.push(x)
    vs.push(v)
  }
  return { xs, vs }
}

test('smoothDamp never moves faster than maxSpeed', () => {
  const { xs } = chase(10, 1.5, 12)
  for (let i = 1; i < xs.length; i++) assert.ok((xs[i] - xs[i - 1]) * 60 <= 1.5 + 1e-6, `frame ${i}`)
})

test('smoothDamp arrives and stops without overshooting', () => {
  const { xs, vs } = chase(10, 1.5, 12)
  assert.ok(xs.every((x) => x <= 10))
  assert.ok(10 - xs.at(-1) < 1e-6 && Math.abs(vs.at(-1)) < 1e-6)
})

test('smoothDamp follows a slow target closely (no cap reached)', () => {
  const dt = 1 / 60
  let x = 0
  let v = 0
  let target = 0
  for (let i = 0; i < 120; i++) {
    target += 0.5 * dt // 0.5 units/s, well under the cap
    ;[x, v] = smoothDamp(x, v, target, 0.1, 1.5, dt)
  }
  assert.ok(target - x < 0.5 * 0.1 + 0.01, `lag ${target - x}`) // about speed × smoothTime
})

test('smoothDamp slows smoothly into the target (no jump from full speed to rest)', () => {
  const { vs } = chase(3, 1.5, 6)
  const cruise = vs.findIndex((v) => v > 1.3) // once up to speed (it cruises a little under the cap); the start follows a jump, which Lenis smooths first
  for (let i = cruise + 1; i < vs.length; i++) assert.ok(Math.abs(vs[i] - vs[i - 1]) * 60 < 16, `frame ${i}: ${vs[i - 1]} → ${vs[i]}`)
})

// Camera on the z axis moving 1 world unit per timeline unit; one drop at z = 5.
const cameraAt = (t) => [0, 0, t]
const opts = { from: 0, to: 10, near: [0.9, 1.8], max: 1.5, nearDrop: 0.45, brake: 2.5 }

test('pace table: slow at a drop, full speed far from it', () => {
  const table = buildPaceTable(cameraAt, [[0, 0, 5]], opts)
  assert.ok(Math.abs(rateAt(table, 5) - 0.45) < 1e-9)
  assert.ok(Math.abs(rateAt(table, 0) - 1.5) < 1e-9)
  assert.ok(Math.abs(rateAt(table, 10) - 1.5) < 1e-9)
})

test('pace table: the limit never falls faster than the brake allows', () => {
  const table = buildPaceTable(cameraAt, [[0, 0, 5]], opts)
  const { rate, step } = table
  for (let i = 1; i < rate.length; i++) {
    const [a, b] = [rate[i - 1], rate[i]]
    assert.ok(Math.abs(a * a - b * b) <= 2 * opts.brake * step + 1e-9, `at ${i * step}`)
  }
})

test('pace table: no drops, no slowing', () => {
  const table = buildPaceTable(cameraAt, [], opts)
  assert.ok(table.rate.every((r) => r === 1.5))
})
