import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glide, hardBetween, nextStop, restingPoint, stopList } from '../src/core/stops.js'

const stops = stopList([1, 2, 3.05, 3.6, { at: 13, hard: true }, 23.3, 3.6005])

test('stop list: sorted, near-duplicates merged (keeping hard)', () => {
  assert.deepEqual(
    stops.map((s) => s.at),
    [1, 2, 3.05, 3.6, 13, 23.3]
  )
  assert.equal(stopList([{ at: 13, hard: true }, 13.001]).length, 1)
  assert.equal(stopList([13.001, { at: 13, hard: true }])[0].hard, true)
})

test('next stop: either way, none past the ends, not the one the picture is on', () => {
  assert.equal(nextStop(stops, 1, 1).at, 2)
  assert.equal(nextStop(stops, 2, 1).at, 3.05) // resting on 2
  assert.equal(nextStop(stops, 2.5, -1).at, 2)
  assert.equal(nextStop(stops, 2.001, -1).at, 1)
  assert.equal(nextStop(stops, 23.3, 1), null)
  assert.equal(nextStop(stops, 1, -1), null)
})

test('hard stops between two times', () => {
  assert.equal(hardBetween(stops, 3.6, 23.3).at, 13)
  assert.equal(hardBetween(stops, 23.3, 3.6).at, 13)
  assert.equal(hardBetween(stops, 13, 23.3), null) // starting on it
  assert.equal(hardBetween(stops, 3.6, 13), null) // ending on it
})

const opts = { accel: 1.2, tail: 0.3 }
const fly = (from, to, rate = () => 1.5, dt = 1 / 60, max = 30) => {
  let [t, v] = [from, 0]
  const frames = []
  for (let i = 0; i < max * 60; i++) {
    ;[t, v] = glide(t, v, to, rate(t), dt, opts)
    frames.push([t, v])
    if (t === to && v === 0) break
  }
  return frames
}

test('glide: from rest, under the limit, settles exactly on the stop, never past it', () => {
  const frames = fly(3.6, 13)
  const [last] = frames.slice(-1)
  assert.deepEqual(last, [13, 0])
  let prev = [3.6, 0]
  for (const [t, v] of frames) {
    assert.ok(t <= 13 && t >= prev[0], 'monotonic, never past')
    assert.ok(v <= 1.5 + 1e-9, 'under the limit')
    assert.ok(v - prev[1] <= 1.2 / 60 + 1e-9, 'speeds up gently')
    prev = [t, v]
  }
  assert.ok(Math.max(...frames.map((f) => f[1])) > 1.45, 'cruises at the limit on a long leg')
  assert.ok(frames.length / 60 < 9.4 / 1.5 + 4, `arrives in reasonable time (${(frames.length / 60).toFixed(1)} s)`)
})

test('glide: follows a lower limit where there is one', () => {
  const frames = fly(1, 5, (t) => (t > 2 && t < 4 ? 0.45 : 1.5))
  for (const [t, v] of frames) if (t > 2.1 && t < 4) assert.ok(v <= 0.45 + 1e-9, `${t.toFixed(2)}: ${v}`)
})

test('glide: a change of mind slows, turns and comes back', () => {
  let [t, v] = [3, 0]
  for (let i = 0; i < 60; i++) [t, v] = glide(t, v, 5, 1.5, 1 / 60, opts)
  assert.ok(v > 0.5)
  const turned = t
  let furthest = t
  for (let i = 0; i < 600 && !(t === 2 && v === 0); i++) {
    ;[t, v] = glide(t, v, 2, 1.5, 1 / 60, opts)
    furthest = Math.max(furthest, t)
  }
  assert.deepEqual([t, v], [2, 0])
  assert.ok(furthest > turned, 'it carried on a little before turning')
})

test('resting point: where braking at accel ends', () => {
  assert.equal(restingPoint(3, 1.2, 1.2), 3.6)
  assert.equal(restingPoint(3, -1.2, 1.2), 2.4)
  assert.equal(restingPoint(3, 0, 1.2), 3)
})
