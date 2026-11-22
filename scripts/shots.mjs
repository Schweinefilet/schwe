#!/usr/bin/env node
// Screenshots of a city at noon, golden hour, night and in rain (and, for Paris, overcast), for comparing
// against the reference photographs (docs/reference.md, docs/paris/reference.md). Works against the dev server or a production build (`npm run preview`):
// the moment is fixed by replacing Date (fixClock) and the weather by answering Open-Meteo's request
// with a fixture, so nothing dev-only is needed. Reduced motion stops the camera's drift, so runs match.
//
//   node scripts/shots.mjs [--city new-york|paris] [--url http://localhost:4173/] [--out docs/shots]
//        [--tag final] [--size 1920x1080] [--only noon,night] [--query fx=-taa] [--settle 20000] [--headed]
//        [--jpeg]
//
// --out defaults to docs/shots for New York and docs/paris/shots for Paris.
//
// Runs in headless Chromium by default; --headed uses a window (under xvfb-run on a machine without a
// display). The image is what matters here, not the frame rate (scripts/bench.mjs measures that).

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

// Playwright is not a dependency of the site: any installed copy will do (resolved through NODE_PATH too).
const { chromium } = createRequire(import.meta.url)('playwright')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const URL_ = arg('url', 'http://localhost:5173/')
const CITY = arg('city', 'new-york')
const OUT = arg('out', CITY === 'new-york' ? 'docs/shots' : `docs/${CITY}/shots`)
const TAG = arg('tag', '')
const [W, H] = arg('size', '1920x1080').split('x').map(Number)
const ONLY = arg('only', '')
const HEADED = process.argv.includes('--headed')
const JPEG = process.argv.includes('--jpeg') // smaller files for the many stage shots
const EXTRA = arg('query', '')

// The sets. New York's clocks are on EST (UTC-5) in late November; sunset on 22 November is 16:31,
// so golden hour is 15:50 (the sun about 5.5 degrees up).
export const SHOTS = [
  { name: 'noon', at: '2026-11-22T17:00:00Z', wx: 'clear' },
  { name: 'golden', at: '2026-11-22T20:50:00Z', wx: 'clear' },
  { name: 'night', at: '2026-11-23T01:00:00Z', wx: 'clear' },
  { name: 'rain', at: '2026-11-22T19:00:00Z', wx: 'rain' },
]
// Paris is on CET (UTC+1); on 22 November the sun is highest at 12:37 (21 degrees) and sets at 17:03. Golden
// hour is 16:15 (5.8 degrees, behind the lens's right shoulder: the view looks east-north-east); night is
// 21:20, after the Eiffel Tower's hourly sparkle; the overcast morning is 10:30.
// London is on GMT; on 22 November the sun is highest at 11:47 (18.5 degrees) and sets at 16:03. Golden hour
// is 15:10 (5.8 degrees, behind the landscape view's right shoulder: it looks east-north-east).
export const SHOTS_BY_CITY = {
  'new-york': SHOTS,
  london: [
    { name: 'noon', at: '2026-11-22T12:00:00Z', wx: 'clear' },
    { name: 'overcast', at: '2026-11-22T10:30:00Z', wx: 'overcast' },
    { name: 'golden', at: '2026-11-22T15:10:00Z', wx: 'clear' },
    { name: 'night', at: '2026-11-22T20:00:00Z', wx: 'clear' },
    { name: 'rain', at: '2026-11-22T13:30:00Z', wx: 'rain' },
  ],
  paris: [
    { name: 'noon', at: '2026-11-22T11:50:00Z', wx: 'clear' },
    { name: 'overcast', at: '2026-11-22T09:30:00Z', wx: 'overcast' },
    { name: 'golden', at: '2026-11-22T15:15:00Z', wx: 'clear' },
    { name: 'night', at: '2026-11-22T20:20:00Z', wx: 'clear' },
    { name: 'rain', at: '2026-11-22T12:30:00Z', wx: 'rain' },
  ],
}

// Open-Meteo's `current` block for each kind of weather (the fields cityWeather.js reads).
const CURRENT = {
  clear: { weather_code: 0, cloud_cover: 5, rain: 0, showers: 0, snowfall: 0, visibility: 30000, wind_speed_10m: 9, wind_direction_10m: 300, temperature_2m: 9, apparent_temperature: 7, relative_humidity_2m: 52, dew_point_2m: 0, precipitation: 0, pressure_msl: 1021, wind_gusts_10m: 18, uv_index: 2, is_day: 1 },
  // Paris's usual November sky: a low, unbroken deck, dry, the far side of the city in haze.
  overcast: { weather_code: 3, cloud_cover: 100, rain: 0, showers: 0, snowfall: 0, visibility: 15000, wind_speed_10m: 12, wind_direction_10m: 240, temperature_2m: 8, apparent_temperature: 6, relative_humidity_2m: 86, dew_point_2m: 6, precipitation: 0, pressure_msl: 1015, wind_gusts_10m: 24, uv_index: 1, is_day: 1 },
  rain: { weather_code: 63, cloud_cover: 100, rain: 1.1, showers: 0, snowfall: 0, visibility: 12000, wind_speed_10m: 22, wind_direction_10m: 70, temperature_2m: 8, apparent_temperature: 4, relative_humidity_2m: 94, dew_point_2m: 7, precipitation: 1.1, pressure_msl: 1004, wind_gusts_10m: 40, uv_index: 0, is_day: 1 },
}

function forecast(at, wx) {
  const t = new Date(at)
  const local = (d) => d.toISOString().slice(0, 16)
  const hours = Array.from({ length: 24 }, (_, i) => local(new Date(t.getTime() + i * 3600e3)))
  const days = Array.from({ length: 7 }, (_, i) => new Date(t.getTime() + i * 86400e3).toISOString().slice(0, 10))
  const c = CURRENT[wx]
  const one = {
    elevation: 10,
    timezone_abbreviation: 'GMT',
    current: { time: local(t), interval: 900, ...c },
    hourly: { time: hours, temperature_2m: hours.map(() => c.temperature_2m), apparent_temperature: hours.map(() => c.apparent_temperature), precipitation_probability: hours.map(() => (c.rain ? 90 : 0)), precipitation: hours.map(() => c.rain * 4), cloud_cover: hours.map(() => c.cloud_cover), relative_humidity_2m: hours.map(() => c.relative_humidity_2m), wind_speed_10m: hours.map(() => c.wind_speed_10m) },
    daily: { time: days, weather_code: days.map(() => c.weather_code), temperature_2m_max: days.map(() => 11), temperature_2m_min: days.map(() => 3), sunrise: days.map((d) => `${d}T06:50`), sunset: days.map((d) => `${d}T16:31`), daylight_duration: days.map(() => 34500), precipitation_sum: days.map(() => (c.rain ? 9 : 0)), precipitation_probability_max: days.map(() => (c.rain ? 90 : 0)), uv_index_max: days.map(() => 2), wind_speed_10m_max: days.map(() => 25) },
  }
  return [one, one, one]
}

// Fixes "now" at this moment: Date.now() and new Date() return it, everything else about Date and every
// timer is left alone (Playwright's own clock would replace requestAnimationFrame, which the benchmark
// times).
export async function fixClock(page, at) {
  await page.addInitScript((ms) => {
    const Real = Date
    class Fixed extends Real {
      constructor(...a) {
        super(...(a.length ? a : [ms]))
      }
      static now() {
        return ms
      }
    }
    window.Date = Fixed
  }, new Date(at).getTime())
}

// Answers Open-Meteo's two requests with the fixture for this moment and weather.
export async function fixtureRoutes(page, at, wx) {
  const headers = { 'access-control-allow-origin': '*' }
  await page.route(/air-quality-api\.open-meteo\.com/, (r) => r.fulfill({ json: [{}, {}, {}], headers }))
  await page.route(/[^-]api\.open-meteo\.com/, (r) => r.fulfill({ json: forecast(at, wx), headers }))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: !HEADED, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
  for (const shot of SHOTS_BY_CITY[CITY]) {
    if (ONLY && !ONLY.split(',').includes(shot.name)) continue
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    await fixClock(page, shot.at)
    await fixtureRoutes(page, shot.at, shot.wx)
    const q = new URLSearchParams(EXTRA)
    if (!q.has('lite')) q.set('lite', '0')
    const url = `${URL_}?${q}#${CITY}`
    await page.goto(url)
    await page.waitForSelector('.loader.is-done', { timeout: 180000 })
    // Let the look settle (weather eases in) and the shadow map draw.
    await page.waitForTimeout(Number(arg('settle', 9000)))
    const file = path.join(OUT, `${shot.name}${TAG ? `-${TAG}` : ''}.${JPEG ? 'jpg' : 'png'}`)
    await page.screenshot(JPEG ? { path: file, type: 'jpeg', quality: 88 } : { path: file })
    console.log(file, errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors')
    await ctx.close()
  }
  await browser.close()
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
