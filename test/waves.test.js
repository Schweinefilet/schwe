import { test } from 'node:test'
import assert from 'node:assert/strict'
import { omega, peakWavelength, slopeVariance, waveEnergy, waveTrains } from '../src/sky/waves.js'

const LOOP = 600

test('the waves together carry Cox and Munk\'s slope variance, scaled', () => {
  for (const windMs of [0, 2, 5, 12]) {
    const set = waveTrains({ windMs, towardDeg: 45, fetchM: 290, loop: LOOP })
    const e = waveEnergy(set, { windMs, fetchM: 290, slopeScale: 0.15 })
    const trains = set.trains.reduce((s, t, i) => s + 0.5 * (e.amplitudes[i] * t.k) ** 2, 0)
    const [along, across] = slopeVariance(windMs, { slopeScale: 0.15 })
    assert.ok(Math.abs(trains + e.tail[0] + e.tail[1] - (along + across)) < 1e-9)
    // The sum of the along and across fits (their own total fit, 5.12e-3 U, differs slightly).
    assert.ok(Math.abs(along + across - 0.15 * (0.003 + 5.08e-3 * windMs)) < 1e-9)
  }
})

test('every wave repeats within the clock loop, at nearly its true speed', () => {
  const set = waveTrains({ windMs: 4, towardDeg: 200, fetchM: 290, loop: LOOP })
  for (const t of set.trains) {
    const turns = (t.omega * LOOP) / (2 * Math.PI)
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9)
    assert.ok(Math.abs(t.omega / omega(t.k) - 1) < 0.02)
  }
  assert.ok(Number.isInteger(set.glitter.cycles) && Math.abs(set.glitter.period * set.glitter.cycles - LOOP) < 1e-9)
})

test('fetch-limited: short waves on a river, longer with more wind or fetch', () => {
  const river = peakWavelength(5, 290)
  assert.ok(river > 0.4 && river < 1.2, `${river}`) // JONSWAP over 290 m at 5 m/s: about 0.8 m
  assert.ok(peakWavelength(10, 290) > river)
  assert.ok(peakWavelength(5, 5000) > river)
  // Never longer than a fully developed sea's.
  assert.ok(peakWavelength(5, 1e9) <= 9.81 / (2 * Math.PI * (0.14 * 9.81 / 5) ** 2) + 1e-9)
})

test('trains run with the wind, spread either side of it', () => {
  const set = waveTrains({ windMs: 4, towardDeg: 90, fetchM: 290 }) // toward the east: +x
  assert.ok(Math.abs(set.dir[0] - 1) < 1e-9 && Math.abs(set.dir[1]) < 1e-9)
  const [kx, kz] = set.trains[0].vector
  assert.ok(kx > 0 && Math.abs(kz) < 1e-9)
  assert.ok(set.trains.every((t) => t.vector[0] > -1e-9)) // none against the wind
})

test('rain adds roughness to both directions alike', () => {
  const dry = slopeVariance(3, { slopeScale: 0.15 })
  const wet = slopeVariance(3, { slopeScale: 0.15, rainMmH: 4, rainSlope: 0.002 })
  assert.ok(Math.abs(wet[0] - dry[0] - 0.002) < 1e-12 && Math.abs(wet[1] - dry[1] - 0.002) < 1e-12)
})
