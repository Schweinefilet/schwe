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

test('pace table: the view never turns faster than maxTurn', () => {
  // Turning 2 radians per unit between 4 and 6, not at all elsewhere.
  const turnAt = (t) => (t > 4 && t < 6 ? 2 : 0)
  const table = buildPaceTable(cameraAt, [], { ...opts, turnAt, maxTurn: 0.5 })
  assert.ok(Math.abs(rateAt(table, 5) - 0.25) < 1e-9) // 0.5 rad/s ÷ 2 rad/unit
  assert.ok(Math.abs(rateAt(table, 1) - 1.5) < 1e-9)
})

test('pace table: rounding never raises the limit and removes its corners', () => {
  // A hard step: the view starts turning fast at 5, and no braking softens it.
  const step = { ...opts, brake: 1e9, turnAt: (t) => (t > 5 ? 2 : 0), maxTurn: 0.5 }
  const sharp = buildPaceTable(cameraAt, [], step)
  const round = buildPaceTable(cameraAt, [], { ...step, round: 0.3 })
  for (let i = 0; i < sharp.rate.length; i++) assert.ok(round.rate[i] <= sharp.rate[i] + 1e-12, `at ${i}`)
  // The largest change between neighbouring steps: the whole drop at once when sharp, spread out once rounded.
  const jump = ({ rate }) => Math.max(...rate.slice(1).map((v, i) => Math.abs(v - rate[i])))
  assert.ok(jump(sharp) > 1.2 && jump(round) < 0.1, `${jump(round)} vs ${jump(sharp)}`)
})

test('pace table: a drop with `until` stops slowing the camera after that time', () => {
  // The camera sits beside the drop from 4 to 6; the drop counts only until 5.
  const beside = (t) => (t >= 4 && t <= 6 ? [0, 0, 5] : [0, 0, t])
  const table = buildPaceTable(beside, [{ pos: [0, 0, 5], until: 5 }], opts)
  assert.ok(Math.abs(rateAt(table, 4.5) - 0.45) < 1e-9)
  assert.ok(rateAt(table, 5.9) > rateAt(table, 4.5))
  // A plain position still counts throughout.
  const always = buildPaceTable(beside, [[0, 0, 5]], opts)
  assert.ok(Math.abs(rateAt(always, 5.9) - 0.45) < 1e-9)
})

test('pace table: a hold slows to its rate at `at`, and frees the limit soon after', () => {
  const line = (t) => [0, 0, -t] // no drops near: the limit is max everywhere but the hold
  const opts = { from: 0, to: 20, near: [0.5, 1], max: 1.5, nearDrop: 0.45, brake: 2.5, round: 0.5 }
  const table = buildPaceTable(line, [], { ...opts, holds: [{ from: 12.6, at: 13, rate: 0.05 }] })
  const plain = buildPaceTable(line, [], opts)
  assert.ok(Math.abs(rateAt(table, 13) - 0.05) < 1e-9, `at the eye ${rateAt(table, 13)}`)
  assert.ok(rateAt(table, 12.8) < rateAt(plain, 12.8) && rateAt(table, 12.8) > 0.05) // falling
  assert.ok(rateAt(table, 11) === rateAt(plain, 11)) // untouched well before
  assert.ok(rateAt(table, 13.3) > 1) // free again within a few tenths after the eye
  for (let t = 12; t <= 14; t += 0.01) assert.ok(rateAt(table, t) <= rateAt(plain, t) + 1e-9, `never raised at ${t.toFixed(2)}`)
  // Still braked: never falls or rises faster than the brake allows.
  const { rate, step } = table
  for (let i = 1; i < rate.length; i++) assert.ok(Math.abs(rate[i] ** 2 - rate[i - 1] ** 2) <= 2 * 2.5 * step + 1e-9, `step ${i}`)
})
