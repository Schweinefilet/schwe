#!/usr/bin/env node
// Headless check of how the visitor moves through the film (core/gestures.js, core/film.js), by real
// input: clicks, a held press, wheel notches and a trackpad flick, keys, and on a phone taps and
// swipes. Prints each leg (from stop → to stop, seconds on the way) and fails on anything off: a step
// that skipped or missed a stop, a hold that ran past the word, a flick that moved more than once.
// Starts the dev server; renders on the Mac's GPU (as ui-crawl.mjs), so travel times are real.
//
// Env: CHROME=/path/to/chrome (default: the macOS Google Chrome app).

import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const { ALIGN, STOPS, TIMELINE_END, TIMELINE_START } = await server.ssrLoadModule('/src/config.js')
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
})

const failures = []
const check = (ok, msg) => {
  if (!ok) failures.push(msg)
  return ok
}
const near = (a, b, eps = 0.003) => a !== null && Math.abs(a - b) < eps

async function open(phone) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`))
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  await page.goto(base + '?tier=high', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.loader__enter.is-ready', { timeout: 20000 })
  await sleep(900)
  if (phone) await page.tap('.loader__enter')
  else await page.click('.loader__enter')
  await page.waitForFunction(() => window.__schwe?.state.unlocked, { timeout: 10000 })
  await sleep(1300) // the loader fades
  return page
}

const read = (page) =>
  page.evaluate(() => {
    const { state, drive, stops } = window.__schwe
    return { stop: state.stop, time: state.time, target: drive.target, hold: drive.hold, pinned: drive.pinned, stops: stops() }
  })
// Waits for the film to rest; returns where, and how long it took.
async function rest(page, timeout = 30000) {
  const t0 = Date.now()
  const moving = page.evaluate(() => {
    const from = window.__schwe.state.time
    return new Promise((resolve) => {
      const t0 = performance.now()
      const look = () => {
        const { state, drive } = window.__schwe
        const to = drive.target ?? (state.stop !== null ? state.stop : null)
        if (to !== null && !drive.hold && Math.abs(state.time - to) <= 0.02 * Math.max(Math.abs(to - from), 0.05)) resolve((performance.now() - t0) / 1000)
        else requestAnimationFrame(look)
      }
      requestAnimationFrame(look)
    })
  })
  await sleep(120)
  await page.waitForFunction(() => window.__schwe.state.stop !== null && window.__schwe.drive.target === null && !window.__schwe.drive.hold, { timeout, polling: 30 })
  return { ...(await read(page)), seconds: (Date.now() - t0) / 1000, moving: await moving }
}
const legs = []
const leg = (label, from, r) => {
  legs.push(`${label.padEnd(14)} ${from.toFixed(2).padStart(6)} → ${r.stop.toFixed(2).padStart(6)}  moving ${r.moving.toFixed(1)} s, at rest after ${r.seconds.toFixed(1)} s`)
  return r
}

// ---- Desktop
{
  const page = await open(false)
  const mid = [640, 400]
  let s = await read(page)
  check(near(s.stop, TIMELINE_START), `not resting at the top after enter (${s.stop})`)
  const stops = s.stops
  console.log('stops', stops.map((t) => t.toFixed(2)).join(' '))

  // The hint says how, before the first move.
  await page.waitForSelector('.move-hint.is-shown', { timeout: 6000 }).catch(() => check(false, 'intro hint never showed'))
  const hint = await page.$eval('.move-hint__label', (el) => el.textContent)
  check(hint === 'click, or hold', `intro hint says "${hint}"`)

  // Click by click to the dive: each click one stop on.
  const diveAt = stops.indexOf(STOPS.dive)
  for (let i = 1; i <= diveAt; i++) {
    const from = stops[i - 1]
    await page.mouse.click(...mid)
    const r = leg('click', from, await rest(page))
    if (!check(near(r.stop, stops[i]), `click ${i}: expected stop ${stops[i]}, rested at ${r.stop}`)) break
  }
  check(!(await page.$('.move-hint.is-shown')), 'hint still shown after moving')

  // Two quick clicks from the top of the drift pass one stop without resting (checked further below,
  // on the way back: Home first).

  // Held from the dive: time runs on and stops at the word (a hard stop), however long it is held.
  await page.mouse.move(...mid)
  await page.mouse.down()
  await sleep(1500)
  const running = await read(page)
  check(running.hold === 1 && running.time > STOPS.dive + 0.2, `holding did not run on (time ${running.time.toFixed(2)})`)
  await sleep(9000)
  const pinned = await read(page)
  check(pinned.pinned && near(pinned.time, ALIGN.arrive), `hold not pinned at the word (time ${pinned.time.toFixed(3)})`)
  await page.mouse.up()
  const atWord = leg('hold', STOPS.dive, await rest(page))
  check(near(atWord.stop, ALIGN.arrive), `let go at the word, rested at ${atWord.stop}`)
  await page.waitForSelector('.move-hint.is-shown.is-on', { timeout: 4000 }).catch(() => check(false, 'no "go on" hint at the word'))

  // A trackpad flick (a burst, then its momentum dying away over a second): one step, word → end.
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel({ deltaY: Math.max(1, Math.round(70 * Math.exp(-i / 9))) })
    await sleep(25)
  }
  const ending = leg('flick', ALIGN.arrive, await rest(page, 40000))
  check(near(ending.stop, TIMELINE_END), `the flick from the word rested at ${ending.stop}, not the end`)

  // Back a stop with a key, then Home (a cut to the top).
  await page.keyboard.press('ArrowUp')
  const back = leg('↑ key', TIMELINE_END, await rest(page, 40000))
  check(near(back.stop, ALIGN.arrive), `↑ from the end rested at ${back.stop}`)
  await page.keyboard.press('Home')
  await sleep(1800)
  check(near((await read(page)).time, TIMELINE_START, 0.01), 'Home did not cut to the top')

  // Two quick clicks: past the first stop without resting, to the second.
  await page.mouse.click(...mid)
  await sleep(200)
  await page.mouse.click(...mid)
  const double = leg('2 clicks', TIMELINE_START, await rest(page))
  check(near(double.stop, stops[2]), `two quick clicks rested at ${double.stop}, expected ${stops[2]}`)

  // Three wheel notches, well apart: three stops.
  for (let n = 0; n < 3; n++) {
    await page.mouse.wheel({ deltaY: 100 })
    await rest(page)
  }
  const notched = await read(page)
  check(near(notched.stop, stops[5]), `three notches rested at ${notched.stop}, expected ${stops[5]}`)
  legs.push(`3 notches       ${stops[2].toFixed(2).padStart(6)} → ${notched.stop.toFixed(2).padStart(6)}`)

  // A short hold (just past the threshold) and let go: on to the next stop, not back.
  await page.mouse.down()
  await sleep(STOPS.hold + 120)
  await page.mouse.up()
  const short = leg('short hold', stops[5], await rest(page))
  check(near(short.stop, stops[6]), `a short hold rested at ${short.stop}, expected ${stops[6]}`)

  // Space steps on; Shift+Space back.
  await page.keyboard.press('Space')
  check(near((await rest(page)).stop, stops[7]), 'Space did not step on')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Space')
  await page.keyboard.up('Shift')
  check(near((await rest(page)).stop, stops[6]), 'Shift+Space did not step back')

  // The tier drops mid-travel (the perf guard): the film keeps its place on the path and comes to rest
  // on one of the new tier's stops.
  await page.mouse.click(...mid)
  await sleep(500)
  await page.evaluate(() => import('/src/core/quality.js').then((q) => q.setTier('low')))
  const dropped = await rest(page)
  const lowStops = dropped.stops
  check(lowStops.length < stops.length, `the low tier has ${lowStops.length} stops (high ${stops.length})`)
  check(lowStops.some((t) => near(dropped.stop, t)), `after the tier dropped, rested at ${dropped.stop}, not a stop of the low tier`)
  legs.push(`tier → low     rested at ${dropped.stop.toFixed(2)} (low stops ${lowStops.map((t) => t.toFixed(2)).join(' ')})`)
  await page.mouse.click(...mid)
  const after = await rest(page)
  check(near(after.stop, lowStops[lowStops.findIndex((t) => near(t, dropped.stop)) + 1]), `the next click on the low tier rested at ${after.stop}`)
  await page.close()
}

// ---- Phone: taps and swipes
{
  const page = await open(true)
  const stops = (await read(page)).stops
  await page.waitForSelector('.move-hint.is-shown', { timeout: 6000 }).catch(() => {})
  const hint = await page.$eval('.move-hint__label', (el) => el.textContent)
  check(hint === 'tap, or hold', `phone hint says "${hint}"`)
  const swipe = async (dy) => {
    await page.touchscreen.touchStart(195, 500)
    for (let i = 1; i <= 6; i++) {
      await page.touchscreen.touchMove(195, 500 + (dy * i) / 6)
      await sleep(16)
    }
    await page.touchscreen.touchEnd()
  }
  await page.touchscreen.tap(195, 420)
  const tapped = leg('tap', stops[0], await rest(page))
  check(near(tapped.stop, stops[1]), `tap rested at ${tapped.stop}`)
  await swipe(-220)
  const up = leg('swipe up', stops[1], await rest(page))
  check(near(up.stop, stops[2]), `swipe up rested at ${up.stop}`)
  await swipe(220)
  const down = leg('swipe down', stops[2], await rest(page))
  check(near(down.stop, stops[1]), `swipe down rested at ${down.stop}`)
  const scrolled = await page.evaluate(() => scrollY)
  check(scrolled === 0, `the page scrolled (${scrolled})`)
  await page.close()
}

console.log(legs.join('\n'))
await browser.close()
await server.close()
if (failures.length) {
  console.log(`\n✖ ${failures.length} failed:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ all moves as expected')
