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
const location = ({ code = 0, rain = 0, showers = 0, slots = [], cloud = 0, wind = 3.4, windFrom = 230 } = {}) => ({
  current: { time: '2026-09-28T21:15', interval: 900, weather_code: code, temperature_2m: 12, rain, showers, cloud_cover: cloud, wind_speed_10m: wind, wind_direction_10m: windFrom },
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
  assert.equal(wx.a.known, true)
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

test('request failure: weather unknown, no label or rain data invented', async () => {
  mockOnce({}, false)
  const wx = await fetchWeather(cities)
  for (const id of ['a', 'b']) {
    assert.equal(wx[id].known, false)
    assert.equal(wx[id].label, null) // nothing on screen claims "clear"
    assert.equal(wx[id].variant, 'clear')
    assert.equal(wx[id].mmPerHour, null)
    assert.equal(wx[id].rainInMinutes, null)
    assert.equal(wx[id].cloudCover, null)
  }
})

test('cloud cover: percent becomes 0..1, missing stays null', async () => {
  const noCloud = location()
  delete noCloud.current.cloud_cover
  mockOnce([location({ cloud: 87 }), noCloud])
  const wx = await fetchWeather(cities)
  assert.equal(wx.a.cloudCover, 0.87)
  assert.equal(wx.b.cloudCover, null)
})

test('wind: m/s and where it blows from, missing stays null', async () => {
  const still = location()
  delete still.current.wind_speed_10m
  delete still.current.wind_direction_10m
  let asked = null
  globalThis.fetch = async (url) => {
    asked = new URL(url)
    return { ok: true, status: 200, json: async () => [location({ wind: 5.2, windFrom: 270 }), still] }
  }
  const wx = await fetchWeather(cities)
  assert.equal(asked.searchParams.get('wind_speed_unit'), 'ms')
  assert.equal(wx.a.windMs, 5.2)
  assert.equal(wx.a.windFromDeg, 270)
  assert.equal(wx.b.windMs, null)
  assert.equal(wx.b.windFromDeg, null)
})

test('snow is its own variant, never rain', () => {
  assert.equal(describeWeather(73).variant, 'snow')
  assert.equal(describeWeather(65).variant, 'rain')
})
