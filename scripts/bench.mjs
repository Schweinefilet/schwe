#!/usr/bin/env node
// Frame time for a city (New York unless --city) at 1920 x 1080, in a headed Chrome window with GPU acceleration asked for.
//
//   node scripts/bench.mjs [--city new-york|paris] [--url http://localhost:4173/] [--seconds 20] [--shot noon|golden|night|rain]
//        [--at 2026-11-23T01:00:00Z] [--wx clear|rain] [--query real=0] [--headless]
//
// Chrome paces requestAnimationFrame to the display (60 Hz here even with vsync and its frame-rate limit
// switched off), so the interval between frames hides any cost under 16.7 ms. The script therefore also
// times each frame's work directly: every animation-frame callback, plus a one-pixel read of the canvas
// afterwards that makes the CPU wait until the GPU has finished the frame. That is the cost of a frame
// with the CPU and GPU serialized: pessimistic by whatever overlap the browser would otherwise get.
// The camera drifts as on the site (reduced motion off) and the moment and weather are
// fixed the way scripts/shots.mjs fixes them (a fixed Date, an Open-Meteo fixture), so runs compare.
// It prints the WebGL renderer: a software one (SwiftShader, llvmpipe) makes the numbers a relative
// measure at best (CLAUDE.md).
//
// On a machine without a display, run it under xvfb-run (which still renders in software).

import { createRequire } from 'node:module'
import { SHOTS_BY_CITY, fixClock, fixtureRoutes } from './shots.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const URL_ = arg('url', 'http://localhost:5173/')
const SECONDS = Number(arg('seconds', 20))
const WARMUP = Number(arg('warmup', 8))
const CITY = arg('city', 'new-york')
const SHOT = SHOTS_BY_CITY[CITY].find((s) => s.name === arg('shot', 'night'))
const AT = arg('at', SHOT.at)
const WX = arg('wx', SHOT.wx)
const QUERY = arg('query', '')
const HEADLESS = process.argv.includes('--headless')

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

const browser = await chromium.launch({
  headless: HEADLESS,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080'],
})
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(e.message))
await fixClock(page, AT)
// Time every animation-frame callback and make the GPU finish before the frame ends.
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window)
  const spans = []
  let gl = null
  const px = new Uint8Array(4)
  window.__schweSpans = spans
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const t0 = performance.now()
      cb(t)
      gl ??= document.querySelector('canvas')?.getContext('webgl2') ?? null
      if (gl && !gl.isContextLost()) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      }
      spans.push([t, t0, performance.now()])
    })
})
await fixtureRoutes(page, AT, WX)
const q = new URLSearchParams(QUERY)
q.set('lite', '0')
await page.goto(`${URL_}?${q}#${CITY}`)
await page.waitForSelector('.loader.is-done', { timeout: 300000 })
await page.waitForTimeout(WARMUP * 1000)

const result = await page.evaluate(async (seconds) => {
  const gl = document.querySelector('canvas').getContext('webgl2')
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  const dpr = window.devicePixelRatio
  const canvas = document.querySelector('canvas')
  const frames = []
  window.__schweSpans.length = 0
  let last = performance.now()
  const end = last + seconds * 1000
  await new Promise((done) => {
    const tick = (t) => {
      frames.push(t - last)
      last = t
      if (t < end) requestAnimationFrame(tick)
      else done()
    }
    requestAnimationFrame(tick)
  })
  // A frame's callbacks share its timestamp: its cost runs from the first one's start to the last one's end.
  const byFrame = new Map()
  for (const [t, a, b] of window.__schweSpans) {
    const f = byFrame.get(t)
    if (f) f[1] = b
    else byFrame.set(t, [a, b])
  }
  const work = [...byFrame.values()].map(([a, b]) => b - a).slice(1)
  return { renderer, dpr, size: [canvas.width, canvas.height], frames: frames.slice(1), work }
}, SECONDS)

const med = median(result.work)
console.log(JSON.stringify({
  city: CITY,
  shot: SHOT.name,
  url: page.url(),
  renderer: result.renderer,
  software: /swiftshader|llvmpipe|software/i.test(result.renderer),
  canvas: result.size,
  frames: result.work.length,
  medianMs: +med.toFixed(2),
  p90Ms: +pct(result.work, 0.9).toFixed(2),
  medianFps: +(1000 / med).toFixed(1),
  intervalMedianMs: +median(result.frames).toFixed(2),
  consoleErrors: errors,
}, null, 2))
await browser.close()
