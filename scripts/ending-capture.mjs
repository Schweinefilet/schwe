#!/usr/bin/env node
// Stills (and optionally a clip) of the ending, rendered on this machine's GPU (headless Chrome over
// Metal; the smoke test's SwiftShader is far too slow for the rain on the puddle). Starts the dev server,
// clicks "enter", jumps to each moment, waits, and saves a screenshot to review/ending/.
//
//   node scripts/ending-capture.mjs [--at 16,17.5,19.3,23.3] [--hold 6] [--every 1] [--size 1280x720]
//                                   [--dpr 2] [--query ?rain=mumbai] [--out review/ending] [--video 8] [--overlay]
// --hold: after the last moment, keep capturing every --every seconds for this long (the loop).
// --video: seconds of screencast from the end, encoded to MP4 with ffmpeg.
// --auto N: N seconds of the ending playing itself, from the word (set --at to nothing: --at "").

import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const moments = arg('at', '15.4,16.2,17.3,18.5,19.3,20.5,21.8,23.3').split(',').filter(Boolean).map(Number)
const hold = Number(arg('hold', '6'))
const every = Number(arg('every', '2'))
const [w, h] = arg('size', '1280x720').split('x').map(Number)
const dpr = Number(arg('dpr', '2'))
const query = arg('query', '?rain=mumbai')
const out = arg('out', 'review/ending')
const video = Number(arg('video', '0'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(out, { recursive: true })

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr })
  page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && console.log(`[page ${m.type()}]`, m.text()))
  page.on('pageerror', (e) => console.log('[page error]', e.message))
  await page.goto(base + query, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.loader__enter.is-ready', { timeout: 30000 })
  await sleep(900)
  await page.click('.loader__enter')
  await page.waitForFunction(() => window.__schwe?.state.beat === 'rain', { timeout: 15000 })
  const goto = (t) => page.evaluate((t) => window.__schwe.goto(t), t)
  // Pass the drift so everything loads (the splash data starts at 3.5), then settle at the word.
  await goto(6)
  await sleep(4000)
  await goto(12.9)
  await sleep(2500)
  const shot = async (name) => {
    const info = await page.evaluate(() => ({ t: window.__schwe.state.time, ts: window.__schwe.uniforms.uTimeScale.value }))
    await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 })
    console.log(`${name}: time ${info.t.toFixed(2)}, time scale ${info.ts.toFixed(3)}`)
  }
  // Clean frames: the dev overlay (fps and state) is left out unless --overlay.
  if (!process.argv.includes('--overlay')) await page.addStyleTag({ content: '.dev-overlay { display: none !important; }' })
  // --hide full,far,beads,puddle: leave those out (the puddle: the water itself).
  const hide = arg('hide', '')
  if (hide)
    await page.evaluate((h) => {
      const list = h.split(',')
      if (window.__schwe.puddleRain) window.__schwe.puddleRain.hide = list
      if (list.includes('puddle'))
        window.__schwe.scene.traverse((o) => {
          if (o.material?.uniforms?.uInvViewProj) o.material.visible = false
        })
    }, hide)
  for (const t of moments) {
    await goto(t)
    await sleep(1200)
    await shot(`t${t.toFixed(2)}`)
  }
  for (let s = every; s <= hold; s += every) {
    await sleep(every * 1000)
    await shot(`end+${s.toFixed(1)}s`)
  }
  // --auto N: from the word, one wheel turn sets the ending playing itself (as a visitor's scroll does);
  // record N seconds of it, from the fall through the hold.
  const auto = Number(arg('auto', '0'))
  if (auto > 0) {
    await goto(12.9)
    await sleep(2500)
    await page.mouse.move(w / 2, h / 2)
    const recording = record(`${out}/auto`, auto)
    const wheel = async (n) => {
      for (let i = 0; i < n; i++) {
        await page.mouse.wheel({ deltaY: 120 })
        await sleep(60)
      }
    }
    // Into the word, where the scroll holds (ALIGN.hold); after a rest, on past it and into the ending.
    await wheel(6)
    await page.waitForFunction(() => window.__schwe.word?.holding, { timeout: 10000 }).catch(() => {})
    await sleep(2500)
    await wheel(6)
    await recording
  }
  if (video > 0) await record(out, video)
  async function record(dir, seconds) {
    const frames = `${dir}/frames`
    mkdirSync(frames, { recursive: true })
    const client = await page.createCDPSession()
    let n = 0
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
    client.on('Page.screencastFrame', async ({ data, sessionId }) => {
      await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${frames}/${String(n++).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
    })
    await sleep(seconds * 1000)
    await client.send('Page.stopScreencast')
    const fps = Math.round(n / seconds)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${frames}/%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', `${dir}/ending.mp4`])
    console.log(`video: ${n} frames (${fps} fps) → ${dir}/ending.mp4`)
  }
  const perf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = []
        let last = performance.now()
        const tick = (now) => {
          times.push(now - last)
          last = now
          if (times.length < 120) requestAnimationFrame(tick)
          else resolve(times.slice(10).sort((a, b) => a - b))
        }
        requestAnimationFrame(tick)
      })
  )
  console.log(`frame ms at the end: median ${perf[perf.length >> 1].toFixed(1)}, p95 ${perf[Math.floor(perf.length * 0.95)].toFixed(1)}`)
} finally {
  await browser.close()
  await server.close()
}
