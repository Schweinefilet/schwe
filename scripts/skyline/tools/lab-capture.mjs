#!/usr/bin/env node
// A city's drop as the site shows it, headless, to check a skyline: the drop lab (/?lab=drop) at
// night, dusk and midday, raining and clear, from the drift (a tiny drop) and the dive (inside it), or
// the site itself at the dive (?dive=<city>). Starts its own dev server (port 0, never 5173's).
// Software rendering: slow, and frame rates mean nothing; ?tier=high keeps the tier guard from dropping
// the city's drop.
//
//   node scripts/skyline/tools/lab-capture.mjs --city london [--out review/skyline] [--times night,dusk,day]
//   node scripts/skyline/tools/lab-capture.mjs --city london --dive      the site at timeline 9.4 to 10.2
//
// Times are fixed dates (edit TIMES for the city's own dusk). Env: CHROME=/path/to/chrome.

import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const CITY = arg('city', 'london')
const OUT = arg('out', 'review/skyline')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// UTC. For London: dusk 18:10 in late September; change per city (its local sunset + ~25 min).
const TIMES = { night: '2026-09-29T21:30:00Z', dusk: '2026-09-29T18:10:00Z', day: '2026-09-29T12:00:00Z' }
const WEATHER = { rain: { cloud: 1, rain: 2, fog: false }, clear: { cloud: 0, rain: 0, fog: false } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await mkdir(OUT, { recursive: true })
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
const frames = (n) => page.evaluate((n) => new Promise((done) => { let left = n; const step = () => (--left <= 0 ? done() : requestAnimationFrame(step)); requestAnimationFrame(step) }), n)

if (process.argv.includes('--dive')) {
  await page.goto(`${base}?tier=high&dive=${CITY}&rain=${CITY}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.loader__enter.is-ready', { timeout: 120000 })
  await sleep(900)
  await page.click('.loader__enter')
  await sleep(3500)
  for (const t of [9.4, 9.8, 10.2]) {
    await page.evaluate((t) => window.__schwe.goto(t), t)
    await sleep(4000)
    await page.screenshot({ path: `${OUT}/${CITY}-dive-${t}.jpg`, type: 'jpeg', quality: 90 })
    console.log(`${OUT}/${CITY}-dive-${t}.jpg`)
  }
} else {
  const times = (arg('times') ?? Object.keys(TIMES).join(',')).split(',')
  for (const time of times) {
    await page.goto(`${base}?tier=high&lab=drop&city=${CITY}&at=${TIMES[time]}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__lab, { timeout: 60000 })
    for (const [weather, w] of Object.entries(WEATHER)) {
      await page.evaluate((w) => window.__lab.set(w), w)
      for (const [view, dive] of [['drift', 0], ['dive', 1]]) {
        await page.evaluate((view, dive) => window.__lab.set({ view, dive }), view, dive)
        await frames(2)
        await page.waitForFunction(() => window.__lab.ready(), { timeout: 120000, polling: 250 })
        await frames(3)
        const url = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.92))
        const file = `${OUT}/${CITY}-${time}-${weather}-${view}.jpg`
        await writeFile(file, Buffer.from(url.split(',')[1], 'base64'))
        console.log(file)
      }
    }
  }
}
console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
await server.close()
