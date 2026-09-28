import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayHz, percentile, report, summarize } from '../src/bench/stats.js'

test('percentile uses nearest rank', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(s, 50), 5)
  assert.equal(percentile(s, 95), 10)
  assert.equal(percentile(s, 0), 1)
  assert.ok(Number.isNaN(percentile([], 50)))
})

test('summarize: fps, tail, budget and stutter shares', () => {
  const dts = [...Array(90).fill(16.7), ...Array(8).fill(25), 40, 100]
  const s = summarize(dts, dts.map(() => 2), dts.map(() => 1))
  assert.equal(s.frames, 100)
  assert.equal(s.p50, 16.7)
  assert.equal(s.max, 100)
  assert.equal(s.overBudget, 10) // 8 × 25 ms + 40 + 100
  assert.equal(s.stutter, 2) // 40 and 100
  assert.equal(s.liveMax, 1)
})

const rec = (rows) => ({
  dt: rows.map((r) => r[0]),
  cpu: rows.map(() => 1),
  beat: rows.map((r) => r[1]),
  tier: rows.map((r) => r[2]),
  dir: rows.map((r) => r[3]),
  live: rows.map(() => 0),
})

test('report groups by beat and tier, idle separately, and totals only moving frames', () => {
  const r = report(
    rec([
      ...Array(20).fill([8.33, 'rain', 'high', 'idle']),
      ...Array(5).fill([10, 'drift', 'high', 'forward']),
      ...Array(5).fill([30, 'drift', 'medium', 'forward']),
      ...Array(5).fill([12, 'dive', 'medium', 'back']),
    ])
  )
  assert.deepEqual(
    r.rows.map((x) => [x.beat, x.tier, x.frames]),
    [
      ['rain (idle)', 'high', 20],
      ['drift', 'high', 5],
      ['drift', 'medium', 5],
      ['dive', 'medium', 5],
    ]
  )
  assert.equal(r.total.frames, 15)
  assert.equal(r.displayHz, 120)
})

test('display rate snaps to a common refresh rate, needs enough idle frames', () => {
  assert.equal(displayHz(rec(Array(30).fill([16.9, 'rain', 'high', 'idle']))), 60)
  assert.equal(displayHz(rec(Array(5).fill([16.9, 'rain', 'high', 'idle']))), null)
})

test('a device slower than its display at rest reports no display rate', () => {
  assert.equal(displayHz(rec(Array(30).fill([53.6, 'rain', 'low', 'idle']))), null)
})
