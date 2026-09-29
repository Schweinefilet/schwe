#!/usr/bin/env node
// Headless check of the whole film, once per ending: starts the dev server, clicks "enter", walks
// every beat forward and back, and checks beat labels, the freeze and its rewind, the ending's text,
// the video decoder budget, and page errors. With the sky as the content source: every drawn city's sky
// is prepared before "enter" appears, and no video ever decodes. Exit code 1 on any failure.
//
// Headless Chrome renders in software, so frame rates here mean nothing; use ?bench on real devices.
//
// Env: CHROME=/path/to/chrome (default: the macOS Google Chrome app).

import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CASES = [
  { name: 'natural (live weather)', query: '' },
  { name: 'raining now', query: '?rain=mumbai', kind: 'now', city: 'mumbai', text: ['Raining hardest now', 'Mumbai'] },
  { name: 'rain soon', query: '?rain=london@40', kind: 'soon', city: 'london', text: ['Rain reaches London in about 40 min'] },
  { name: 'rain imminent', query: '?rain=london@5', kind: 'soon', city: 'london', text: ['Rain is about to reach London'] },
  { name: 'nowhere', query: '?rain=none', kind: 'none', text: ['Nowhere else is it raining right now.'] },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runCase(browser, base, c) {
  const page = await browser.newPage()
  await page.setViewport({ width: 960, height: 600 })
  const failures = []
  const check = (ok, msg) => ok || failures.push(msg)
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  await page.goto(base + c.query, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.loader__enter.is-ready', { timeout: 15000 })
  // Sky mode (skyReady exists): "enter" should wait for the skies, not appear on the 6 s cap.
  const skyMode = await page.evaluate(() => typeof window.__schwe?.skyReady === 'function')
  if (skyMode) check(await page.evaluate(() => window.__schwe.skyReady()), 'enter appeared before the city skies were prepared')
  await sleep(900) // the button fades in
  await page.click('.loader__enter')
  await page.waitForFunction(() => window.__schwe?.state.beat === 'rain', { timeout: 10000 })

  // Watch the decoder budget on every frame for the rest of the run.
  await page.evaluate(() => {
    window.__budget = { max: 0, over: 0 }
    const watch = () => {
      const n = window.__schwe.liveCount()
      window.__budget.max = Math.max(window.__budget.max, n)
      if (n > window.__schwe.quality.decoders) window.__budget.over++
      requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })

  const labels = await page.evaluate(() => Object.entries(window.__schwe.tl.labels).sort((a, b) => a[1] - b[1]))
  const beats = labels.filter(([name]) => name !== 'end')
  const end = labels.find(([name]) => name === 'end')[1]
  const mid = (i) => (beats[i][1] + (beats[i + 1]?.[1] ?? end)) / 2
  const goto = async (t, wait = 600) => {
    await page.evaluate((t) => window.__schwe.goto(t), t)
    await sleep(wait)
  }
  const read = () =>
    page.evaluate(() => ({
      beat: window.__schwe.state.beat,
      timeScale: window.__schwe.uniforms.uTimeScale.value,
      rain: window.__schwe.state.rainCity,
      dive: window.__schwe.state.diveCity,
      endOpacity: Number(document.querySelector('.end-type').style.opacity || 0),
      endText: [...document.querySelector('.end-type').children].map((el) => el.textContent).join(' / '),
    }))

  // Forward through every beat.
  for (let i = 1; i < beats.length; i++) {
    await goto(mid(i))
    const s = await read()
    check(s.beat === beats[i][0], `forward: expected beat ${beats[i][0]} at ${mid(i).toFixed(2)}, got ${s.beat}`)
  }
  await sleep(1200) // let the 1.5 s freeze finish
  check((await read()).timeScale < 0.01, 'time did not freeze')

  // The ending.
  await goto(end - 1.1, 1500)
  const e = await read()
  check(e.endOpacity > 0.99, `ending text not shown (opacity ${e.endOpacity})`)
  if (c.kind) check(e.rain?.kind === c.kind, `ending kind: expected ${c.kind}, got ${e.rain?.kind}`)
  if (c.city) check(e.rain?.city === c.city, `ending city: expected ${c.city}, got ${e.rain?.city}`)
  for (const t of c.text ?? []) check(e.endText.includes(t), `ending text missing "${t}": "${e.endText}"`)
  if (!c.text) check(e.endText.trim().length > 0, 'ending text empty')
  check(!e.rain?.city || e.rain.city !== e.dive, `dive city equals ending city (${e.dive})`)

  // Back through every beat to the top: the text leaves and time runs again.
  for (let i = beats.length - 1; i >= 0; i--) {
    await goto(i === 0 ? beats[0][1] : mid(i))
    const s = await read()
    check(s.beat === beats[i][0], `rewind: expected beat ${beats[i][0]}, got ${s.beat}`)
    if (beats[i][0] === 'align') check(s.endOpacity === 0, 'ending text still visible after rewinding to align')
  }
  await sleep(1800)
  check((await read()).timeScale > 0.99, 'time did not resume after rewinding above the freeze')

  const budget = await page.evaluate(() => window.__budget)
  check(budget.over === 0, `video decoders over budget on ${budget.over} frames`)
  if (skyMode) check(budget.max === 0, `sky mode decoded video (${budget.max} live)`)
  check(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)

  const source = skyMode ? `sky (${(await page.evaluate(() => window.__schwe.skyStats())).cities.length} cities)` : 'footage'
  const summary = `${e.rain?.kind ?? '?'}${e.rain?.city ? ` ${e.rain.city}` : ''}, dive ${e.dive}, ${source}, max live video ${budget.max}`
  await page.close()
  return { failures, summary, ending: e.endText.trim() }
}

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let failed = 0
try {
  for (const c of CASES) {
    const t0 = Date.now()
    try {
      const r = await runCase(browser, base, c)
      const ok = r.failures.length === 0
      if (!ok) failed++
      console.log(`${ok ? '✓' : '✖'} ${c.name.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(0)}s  ${r.summary}\n    "${r.ending}"`)
      for (const f of r.failures) console.log(`    - ${f}`)
    } catch (err) {
      failed++
      console.log(`✖ ${c.name}: ${err.message}`)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(failed ? `\n${failed} of ${CASES.length} failed` : `\nall ${CASES.length} passed`)
process.exit(failed ? 1 : 0)
