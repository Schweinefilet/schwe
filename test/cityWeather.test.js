import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDetail } from '../src/content/cityWeather.js'

test('current rain per 15 min becomes an hourly rate; the air comes from its own response', () => {
  const d = parseDetail(
    { current: { time: '2026-10-06T14:00', interval: 900, weather_code: 61, temperature_2m: 21.7, rain: 0.25, showers: 0.25, is_day: 1 }, elevation: 2238 },
    { current: { us_aqi: 38, pm2_5: 5.5 } }
  )
  assert.equal(d.current.mmPerHour, 2)
  assert.equal(d.current.tempC, 21.7)
  assert.equal(d.current.uv, null)
  assert.equal(d.air.usAqi, 38)
  assert.equal(d.hourly, null)
})

test('nothing read is nothing shown: both requests failed gives null', () => {
  assert.equal(parseDetail(null, null), null)
})

test('missing hourly values stay null rather than zero', () => {
  const d = parseDetail({ hourly: { time: ['a', 'b'], temperature_2m: [10, null] } }, null)
  assert.deepEqual(d.hourly.tempC, [10, null])
  assert.deepEqual(d.hourly.precipProb, [null, null])
})
