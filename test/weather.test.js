import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { describeWeather, fetchWeather } from '../src/content/weather.js'

const cities = [
  { id: 'a', lat: 1, lon: 1 },
  { id: 'b', lat: 2, lon: 2 },
]
const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))

// Open-Meteo's shape for several locations: an array, one entry per location, times in UTC.
const location = ({ code = 0, rain = 0, showers = 0, slots = [] } = {}) => ({
  current: { time: '2026-09-28T21:15', interval: 900, weather_code: code, temperature_2m: 12, rain, showers },
  minutely_15: {
    time: slots.map((_, i) => `2026-09-28T${String(21 + Math.floor((15 + i * 15) / 60)).padStart(2, '0')}:${String((15 + i * 15) % 60).padStart(2, '0')}`),
    rain: slots,
    showers: slots.map(() => 0),
  },
})
const mockOnce = (body, ok = true) => (globalThis.fetch = async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))

test('current rain per 15 min is reported per hour, rain and showers together', async () => {
  mockOnce([location({ code: 63, rain: 0.5, showers: 0.25 }), location()])
  const wx = await fetchWeather(cities)
  assert.equal(wx.a.mmPerHour, 3)
  assert.equal(wx.a.variant, 'rain')
  assert.equal(wx.b.mmPerHour, 0)
})

test('minutes until rain: first 15-minute slot at or above 0.1 mm', async () => {
  mockOnce([location({ slots: [0, 0.05, 0, 0.2, 1] }), location({ slots: [0.3] }), ])
  const wx = await fetchWeather(cities)
  assert.equal(wx.a.rainInMinutes, 45) // 22:00 vs now 21:15
  assert.equal(wx.b.rainInMinutes, 0)
})

test('no rain in the forecast: null', async () => {
  mockOnce([location({ slots: [0, 0, 0] }), location()])
  const wx = await fetchWeather(cities)
  assert.equal(wx.a.rainInMinutes, null)
  assert.equal(wx.b.rainInMinutes, null)
})

test('request failure: everything clear, no rain data invented', async () => {
  mockOnce({}, false)
  const wx = await fetchWeather(cities)
  for (const id of ['a', 'b']) {
    assert.equal(wx[id].variant, 'clear')
    assert.equal(wx[id].mmPerHour, null)
    assert.equal(wx[id].rainInMinutes, null)
  }
})

test('snow is its own variant, never rain', () => {
  assert.equal(describeWeather(73).variant, 'snow')
  assert.equal(describeWeather(65).variant, 'rain')
})
