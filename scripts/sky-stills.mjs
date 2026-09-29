#!/usr/bin/env node
// Stills of the computed sky in a drop (the lab, /?lab=drop), for review. For each scene: the drop at
// true size as the drift frames it, and the dive's full-screen framing, at 1920×1080. Weather comes
// from the lab's sliders, so these preview conditions; they are not live readings. Also writes
// review/sky-sheet.jpg: every scene in a row (drift frame, the drop at 1:1, dive).
//
//   npm run sky:stills          (CHROME=/path/to/chrome, default: the macOS Google Chrome app)
//
// Headless Chrome renders in software: the stills show the look, never the speed.

import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { getPosition } from 'suncalc'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = 'review'
const W = 1920
const H = 1080

// The first minute in [from, to) where the sun at `city` crosses `alt` degrees, rising or setting.
function sunCrossing(lat, lon, alt, from, to, rising) {
  for (let t = Date.parse(from); t < Date.parse(to); t += 60000) {
    const a = getPosition(new Date(t), lat, lon).altitude
    const b = getPosition(new Date(t + 60000), lat, lon).altitude
    if (rising ? a < alt && b >= alt : a > alt && b <= alt) return new Date(t).toISOString().slice(0, 16) + 'Z'
  }
  throw new Error('no crossing found')
}

const SCENES = [
  { name: 'tokyo-night-rain', city: 'tokyo', at: '2026-09-29T14:30Z', set: { cloud: 1, rain: 6, fog: false } },
  { name: 'mumbai-dusk', city: 'mumbai', at: sunCrossing(19.076, 72.8777, -3, '2026-09-29T10:00Z', '2026-09-29T16:00Z', false), set: { cloud: 0.3, rain: 0, fog: false } },
  { name: 'london-overcast-midday', city: 'london', at: '2026-09-29T11:30Z', set: { cloud: 1, rain: 0, fog: false } },
  { name: 'sydney-clear-dawn', city: 'sydney', at: sunCrossing(-33.8688, 151.2093, -3, '2026-09-28T17:00Z', '2026-09-28T22:00Z', true), set: { cloud: 0, rain: 0, fog: false } },
]

const frames = (page, n) =>
  page.evaluate((n) => new Promise((done) => {
    let left = n
    const step = () => (--left <= 0 ? done() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  }), n)

async function capture(page, base, scene) {
  await page.goto(`${base}?lab=drop&city=${scene.city}&at=${scene.at}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__lab, { timeout: 30000 })
  await page.evaluate((o) => window.__lab.set(o), scene.set)
  const shots = {}
  for (const [view, dive] of [['drift', 0], ['dive', 1]]) {
    await page.evaluate((view, dive) => window.__lab.set({ view, dive }), view, dive)
    await frames(page, 2)
    await page.waitForFunction(() => window.__lab.ready(), { timeout: 60000, polling: 250 })
    await frames(page, 3)
    const shot = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      const { camera } = window.__schwe
      const p = new camera.position.constructor(0, 0, 0).project(camera) // the drop's centre on screen
      return { url: canvas.toDataURL('image/jpeg', 0.94), x: (p.x + 1) / 2, y: (1 - p.y) / 2, inputs: window.__lab.inputs() }
    })
    const file = `${OUT}/sky-${scene.name}-${view}.jpg`
    await writeFile(file, Buffer.from(shot.url.split(',')[1], 'base64'))
    shots[view] = shot
    const i = shot.inputs
    console.log(`${file}  sun ${i.sun.alt.toFixed(1)}° moon ${i.moon.alt.toFixed(1)}° (${Math.round(i.moon.fraction * 100)}%) cloud ${Math.round(i.cloud * 100)}% rain ${i.rain} mm/h`)
  }
  return shots
}

// One row per scene: the drift frame, the drop at 1:1 around its centre, the dive frame.
async function sheet(page, rows) {
  const url = await page.evaluate(async (rows, W, H) => {
    const load = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = src })
    const rowH = H / 2
    const crop = rowH
    const canvas = Object.assign(document.createElement('canvas'), { width: W / 2 + crop + W / 2, height: rowH * rows.length })
    const g = canvas.getContext('2d')
    g.fillStyle = '#000'
    g.fillRect(0, 0, canvas.width, canvas.height)
    for (const [r, { drift, dive, name }] of rows.entries()) {
      const a = await load(drift.url)
      const b = await load(dive.url)
      const y = r * rowH
      g.drawImage(a, 0, y, W / 2, rowH)
      g.drawImage(a, drift.x * W - crop / 2, drift.y * H - crop / 2, crop, crop, W / 2, y, crop, crop)
      g.drawImage(b, W / 2 + crop, y, W / 2, rowH)
      g.fillStyle = '#fff'
      g.font = '20px monospace'
      g.fillText(name, 12, y + 30)
    }
    return canvas.toDataURL('image/jpeg', 0.9)
  }, rows, W, H)
  await writeFile(`${OUT}/sky-sheet.jpg`, Buffer.from(url.split(',')[1], 'base64'))
}

await mkdir(OUT, { recursive: true })
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  protocolTimeout: 300000,
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('page error:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
  const rows = []
  for (const scene of SCENES) rows.push({ name: `${scene.name}  ${scene.at}`, ...(await capture(page, base, scene)) })
  await sheet(page, rows)
  console.log(`${OUT}/sky-sheet.jpg`)
} finally {
  await browser.close()
  await server.close()
}
