import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUN_E, mieFor, sunAt, sunTransmittance } from '../src/city/real/atmosphere.js'
import { cloudThreshold } from '../src/city/real/clouds.js'
import { NIGHT_EXPOSURE, exposureFor, realLookFor } from '../src/city/real/look.js'

const NY = { lat: 40.7323, lon: -73.9935, tz: 'America/New_York' }

test('haze from visibility follows Koschmieder: 3.912 / V, less the air itself', () => {
  const m = mieFor(20000)
  assert.ok(Math.abs(m.ext + 0.0136 - 3.912 / 20) < 1e-9)
  assert.ok(mieFor(5000).ext > mieFor(40000).ext * 5)
  // Unread: a clear day.
  assert.ok(mieFor(null).ext < 0.1)
})

test('the sun through the air: bright and white overhead, dim and red at the horizon', () => {
  const clear = mieFor(40000)
  const up = sunTransmittance([0, 1, 0], clear)
  assert.ok(up[1] > 0.75 && up[1] < 0.95, `overhead ${up}`)
  const low = sunAt(2, 240, clear)
  assert.ok(low.E[0] > low.E[2] * 2, 'reddened near the horizon')
  assert.ok(low.E[1] < SUN_E * 0.2)
  assert.deepEqual(sunAt(-10, 240, clear).E, [0, 0, 0])
})

test('cloud threshold: more cover, a lower threshold; clear and overcast at the ends', () => {
  assert.equal(cloudThreshold(0), 2)
  assert.equal(cloudThreshold(1), -2)
  assert.ok(cloudThreshold(0.2) > cloudThreshold(0.5) && cloudThreshold(0.5) > cloudThreshold(0.8))
})

test('New York at noon in November: sun up, exposure a photographer would set; at night the ceiling', () => {
  const noon = realLookFor(NY, new Date('2026-11-22T17:00:00Z'), null)
  assert.ok(noon.alt > 25 && noon.alt < 32)
  const e = exposureFor(noon, [40, 42, 50])
  assert.ok(e > 0.005 && e < 0.05, `noon exposure ${e}`)
  const night = realLookFor(NY, new Date('2026-11-23T01:00:00Z'), null)
  assert.equal(exposureFor(night, [0.0001, 0.0001, 0.0001]), NIGHT_EXPOSURE)
  assert.ok(night.sunTrue[1] < -0.4, 'the real sun is well below the horizon at 20:00')
})

test('rain closes the cloud deck and lowers it', () => {
  const wx = { current: { code: 63, cloud: 60, mmPerHour: 3, visibilityM: 9000, windKmh: 20, windFromDeg: 90 } }
  const l = realLookFor(NY, new Date('2026-11-22T19:00:00Z'), wx)
  assert.equal(l.cloudTh, -2)
  assert.ok(l.cloudH < 1000)
  assert.ok(l.sunThrough < 0.05)
})
