import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchedule, forEachActive, nearestCopy } from '../src/core/puddleRain.js'

const variants = [
  { weight: 2, slant: 0 },
  { weight: 1, slant: 7 },
]
const schedule = buildSchedule({ seed: 7, period: 2, tile: 4, rate: 50, variants, wind: [0.12, 0.04] })

test('puddle rain: the schedule is sorted, inside its tile and period, and the same every time', () => {
  assert.equal(schedule.count, Math.round(50 * 4 * 4 * 2))
  for (let i = 1; i < schedule.count; i++) assert.ok(schedule.t[i] >= schedule.t[i - 1])
  for (let i = 0; i < schedule.count; i++) {
    assert.ok(schedule.t[i] >= 0 && schedule.t[i] < 2)
    assert.ok(schedule.x[i] >= 0 && schedule.x[i] < 4 && schedule.z[i] >= 0 && schedule.z[i] < 4)
  }
  const again = buildSchedule({ seed: 7, period: 2, tile: 4, rate: 50, variants, wind: [0.12, 0.04] })
  assert.deepEqual([...again.x.slice(0, 20)], [...schedule.x.slice(0, 20)])
})

test('puddle rain: variants follow their weights; slanted drops come from the wind side', () => {
  const n = [0, 0]
  for (let i = 0; i < schedule.count; i++) n[schedule.variant[i]]++
  assert.ok(Math.abs(n[0] / schedule.count - 2 / 3) < 0.05)
  const windAngle = Math.atan2(-0.04, 0.12)
  for (let i = 0; i < schedule.count; i++) {
    if (schedule.variant[i] !== 1) continue
    const d = Math.atan2(Math.sin(schedule.rot[i] - windAngle), Math.cos(schedule.rot[i] - windAngle))
    assert.ok(Math.abs(d) <= 0.35 + 1e-6)
  }
})

function active(clock, lead, life) {
  const seen = []
  forEachActive(schedule, clock, lead, life, (i, age) => seen.push([i, age]))
  return seen
}

test('puddle rain: active impacts are exactly those in the window, across the repeat', () => {
  for (const clock of [0.05, 1.0, 1.97, 2.03, 7.5, -0.5]) {
    const seen = active(clock, 0.06, 0.2)
    // Brute force over nearby repeats.
    const expect = []
    for (let i = 0; i < schedule.count; i++) {
      for (let c = -5; c <= 5; c++) {
        const age = clock - (schedule.t[i] + 2 * c)
        if (age > -0.06 && age <= 0.2) expect.push([i, age])
      }
    }
    const key = (a) => a.map(([i, age]) => `${i}:${age.toFixed(9)}`).sort()
    assert.deepEqual(key(seen), key(expect), `clock ${clock}`)
  }
})

test('puddle rain: the rain loops exactly: clock and clock + period show the same impacts', () => {
  const a = active(0.7, 0.06, 0.2)
  const b = active(0.7 + 2, 0.06, 0.2)
  assert.equal(a.length, b.length)
  a.forEach(([i, age], k) => {
    assert.equal(b[k][0], i)
    assert.ok(Math.abs(b[k][1] - age) < 1e-9)
  })
})

test('puddle rain: nearestCopy picks the repeat of a tile point closest to the focus', () => {
  const out = [0, 0]
  nearestCopy(0.5, 3.5, -2, -2, 4, 0, 0, out)
  assert.deepEqual(out, [-1.5, 1.5])
  nearestCopy(0.5, 3.5, -2, -2, 4, 10, 10, out)
  assert.deepEqual(out, [10.5, 9.5])
})
