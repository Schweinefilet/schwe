#!/usr/bin/env node
// Every screen, state and transition of the UI, captured at desktop (1440 × 900) and phone (390 × 844,
// touch, mobile UA), on this machine's GPU (headless Chrome over Metal, like ending-capture.mjs). Starts
// the dev server and walks the film as a visitor would: the loader (waiting, ready, hover), "enter", the
// intro hint, both captions, every drift drop's slow point, the dive, the word's hold reached by real
// wheel or touch input (so its sketch and "keep scrolling" show), the ending, the final screen, the
// sheet's three sections, keyboard focus on every control, and the still page. Also writes console.txt
// (every warning and error the page logged) and text.json (every visible text box, its font and whether
// it is clipped or overlaps another), which `--check` reads for the done-when list.
//
//   node scripts/ui-crawl.mjs [--out review/pro-pass/before] [--sizes desktop,phone] [--only loader,drift]
//                             [--tier high] [--query "?rain=mumbai"] [--check]
// --only: sections (loader, enter, captions, drift, tiers, dive, word, ending, final, sheet, focus, still).
// --tiers high,medium,low: the drift's slow points also as the medium and low tiers show them (section tiers).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const OUT = arg('out', 'review/pro-pass/before')
const SIZES = arg('sizes', 'desktop,phone').split(',')
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const TIERS = arg('tiers', 'high').split(',')
// Light rain in London (its label is a drizzle class), heavy in Mumbai: the answer names Mumbai.
const QUERY = arg('query', '?rain=mumbai&weather=mumbai:1:9,london:1:0.4,tokyo:0.6:0')
const CHECK = process.argv.includes('--check')
const want = (section) => !ONLY.length || ONLY.includes(section)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
}

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const { DRIFT_PASSES, DIVE, TIMELINE_END } = await server.ssrLoadModule('/src/config.js')
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
})

const consoleLines = []
const textReport = {}
const perfReport = {} // the dev overlay's frame time at each captured frame (hidden in the shot, still running)

async function openPage(size, query, { holdBackdrop = 0 } = {}) {
  const d = DEVICES[size]
  const page = await browser.newPage()
  if (d.ua) await page.setUserAgent(d.ua)
  await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.deviceScaleFactor, isMobile: !!d.isMobile, hasTouch: !!d.hasTouch })
  page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && consoleLines.push(`[${size}${query}] ${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => consoleLines.push(`[${size}${query}] pageerror: ${e.message}`))
  if (holdBackdrop) {
    // Keeps the loader waiting (the backdrop is one of what "enter" waits for), so its status line shows.
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      if (req.url().includes('/backdrop/rathaus.jpg')) await sleep(holdBackdrop)
      req.continue().catch(() => {})
    })
  }
  await page.goto(base + query, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: '.dev-overlay { display: none !important; }' }).catch(() => {})
  return page
}

const dir = (size) => {
  const p = `${OUT}/${size}`
  mkdirSync(p, { recursive: true })
  return p
}

// A frame, and every visible text box on it: font, size, whether it is cut off by the viewport or by
// an ancestor's overflow, and which other text boxes it overlaps.
async function shot(page, size, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.screenshot({ path: `${dir(size)}/${name}.jpg`, type: 'jpeg', quality: 86 })
  const boxes = await page.evaluate(() => {
    // Everything hittable while measuring, so elementFromPoint finds the type laid over the film.
    const probe = document.createElement('style')
    probe.textContent = '* { pointer-events: auto !important; }'
    document.head.append(probe)
    const out = []
    const visible = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false
      }
      return true
    }
    // The block a run of text sits in: inline pieces of one paragraph flow together and never overlap.
    const blocks = new Map()
    const blockOf = (el) => {
      let e = el
      while (e.parentElement && getComputedStyle(e).display.startsWith('inline')) e = e.parentElement
      if (!blocks.has(e)) blocks.set(e, blocks.size)
      return blocks.get(e)
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim()
      if (!text) continue
      const el = n.parentElement
      if (!el || el.closest('.dev-overlay, script, style') || !visible(el)) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const cs = getComputedStyle(el)
      // Cut off: by the screen, for type laid over the film (fixed, not in a scroll area); or by an
      // ancestor that hides its overflow.
      let fixed = false
      let scrolls = false
      let clipped = false
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const ecs = getComputedStyle(e)
        if (ecs.position === 'fixed') fixed = true
        if (/(auto|scroll)/.test(ecs.overflowY) && e.scrollHeight > e.clientHeight + 1) scrolls = true
        if (e !== el && ecs.overflow !== 'visible' && !/(auto|scroll)/.test(ecs.overflowY)) {
          const er = e.getBoundingClientRect()
          if (r.left < er.left - 1 || r.right > er.right + 1 || r.top < er.top - 1 || r.bottom > er.bottom + 1) clipped = true
        }
      }
      if (fixed && !scrolls && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) clipped = true
      out.push({
        text: text.slice(0, 80),
        family: cs.fontFamily.split(',')[0].replace(/['"]/g, ''),
        px: parseFloat(cs.fontSize),
        tracking: cs.letterSpacing,
        rect: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)),
        // Each line as its line box (a script's content area, its tall ascent and descent, runs past it),
        // and only where the text is on top: text under the opaque sheet, or scrolled under its bar's
        // close button, is not seen.
        lines: [...range.getClientRects()]
          .filter((q) => {
            const hitEl = document.elementFromPoint(Math.min(Math.max(q.left + q.width / 2, 0), innerWidth - 1), Math.min(Math.max(q.top + q.height / 2, 0), innerHeight - 1))
            return !hitEl || hitEl === el || el.contains(hitEl) || hitEl.contains(el) || q.top + q.height / 2 > innerHeight || q.top + q.height / 2 < 0
          })
          .map((q) => {
            const lh = parseFloat(cs.lineHeight)
            const h = lh && lh < q.height ? lh : q.height
            const mid = q.top + q.height / 2
            return [q.left, mid - h / 2, q.right, mid + h / 2].map((v) => Math.round(v))
          }),
        block: blockOf(el),
        clipped,
      })
    }
    probe.remove()
    return out
  })
  // Overlaps between text in different blocks, line box against line box.
  const hit = (a, b) => a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2
  for (const [i, a] of boxes.entries())
    a.overlaps = boxes.filter((b, j) => j !== i && b.block !== a.block && a.lines.some((la) => b.lines.some((lb) => hit(la, lb)))).map((b) => b.text)
  for (const b of boxes) delete b.lines
  textReport[`${size}/${name}`] = boxes
  const overlay = await page.evaluate(() => document.querySelector('.dev-overlay')?.textContent ?? '')
  const fps = overlay.match(/fps\s+([\d.]+)/)?.[1]
  if (fps) perfReport[`${size}/${name}`] = Number(fps)
  console.log(`${size}/${name}`)
}

const goto = (page, t) => page.evaluate((t) => window.__schwe.goto(t), t)
const enter = async (page, size) => {
  await page.waitForSelector('.loader__enter.is-ready', { timeout: 60000 })
  await sleep(1200)
  if (DEVICES[size].hasTouch) await page.tap('.loader__enter')
  else await page.click('.loader__enter')
  await page.waitForFunction(() => window.__schwe?.state.beat === 'rain', { timeout: 15000 })
}
// Drags the page up by `dy` px, as a finger does (CDP's synthesized touch scroll).
const swipe = async (page, size, dy) => {
  const client = await page.createCDPSession()
  const { width, height } = DEVICES[size]
  await client.send('Input.synthesizeScrollGesture', { x: width / 2, y: height * 0.7, yDistance: -dy, speed: 2400, gestureSourceType: 'touch' })
}
const wheel = async (page, n, delta = 120) => {
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel({ deltaY: delta })
    await sleep(60)
  }
}

async function crawl(size) {
  const touch = size === 'phone'
  if (want('loader')) {
    const page = await openPage(size, QUERY, { holdBackdrop: 9000 })
    await sleep(2600)
    await shot(page, size, 'loader-1-waiting')
    await page.waitForSelector('.loader__enter.is-ready', { timeout: 60000 })
    await sleep(2600)
    await shot(page, size, 'loader-2-ready')
    if (!touch) {
      await page.hover('.loader__enter')
      await sleep(700)
      await shot(page, size, 'loader-3-hover')
    }
    // Keyboard: Tab to "enter".
    await page.mouse.move(2, 2)
    await page.keyboard.press('Tab')
    await sleep(400)
    await shot(page, size, 'focus-loader-enter')
    await page.close()
  }

  // One page walks the film; a section that fails is logged, and the next starts on a fresh page.
  let page = null
  const fresh = async () => {
    await page?.close().catch(() => {})
    page = await openPage(size, QUERY + '&tier=high')
    await enter(page, size)
  }
  const run = async (name, fn) => {
    if (!want(name)) return
    try {
      if (!page || page.isClosed() || page.mainFrame().detached) await fresh()
      await fn()
    } catch (err) {
      consoleLines.push(`[${size}] crawl: ${name} failed: ${err.message.split('\n')[0]}`)
      console.log(`  ${size}/${name} failed: ${err.message.split('\n')[0]}`)
      await page?.close().catch(() => {})
      page = null
    }
  }
  await run('enter', async () => {
    await sleep(1400)
    await shot(page, size, 'enter-1-after')
    await page.waitForSelector('.scroll-hint.is-shown', { timeout: 10000 })
    await sleep(1600)
    await shot(page, size, 'enter-2-intro-hint')
  })
  await run('captions', async () => {
    await goto(page, 2.0)
    await sleep(2200)
    await shot(page, size, 'caption-1-drops')
  })
  await run('drift', async () => {
    // Everything streams in through the drift: one pass over it first.
    await goto(page, 6)
    await sleep(2500)
    for (const [i, t] of DRIFT_PASSES.entries()) {
      await goto(page, t)
      await sleep(1500)
      await shot(page, size, `drift-${i + 1}`)
    }
  })
  await run('dive', async () => {
    for (const [name, t] of [['approach', 8.5], ['inside', 9.4], ['city-type', (DIVE.typeIn + DIVE.typeOut) / 2 + 0.05]]) {
      await goto(page, t)
      await sleep(1500)
      await shot(page, size, `dive-${name}`)
    }
    // Inside the drop, "more weather" opens the expanded view and holds the scroll; hovering the day's
    // chart shows one hour in full (pointer devices); Escape closes it.
    if (await page.$('.wx-more')) {
      if (DEVICES[size].hasTouch) await page.tap('.wx-more')
      else await page.click('.wx-more')
      await sleep(900)
      const held = await page.evaluate(() => document.documentElement.classList.contains('lenis-stopped'))
      await shot(page, size, 'dive-weather-open')
      const hours = await page.$('.wx-hours')
      if (hours && !DEVICES[size].hasTouch) {
        const box = await hours.boundingBox()
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
        await sleep(300)
        await shot(page, size, 'dive-weather-hover')
        await page.mouse.move(4, 4)
      }
      await page.keyboard.press('Escape')
      await sleep(300)
      const closed = await page.evaluate(() => !document.querySelector('.wx-panel') && !document.documentElement.classList.contains('lenis-stopped'))
      console.log(`more weather (${size}): scroll held ${held}, Escape closes ${closed}`)
    }
    // "h" hides the dev overlay and brings it back.
    const hidden = () => page.evaluate(() => document.querySelector('.dev-overlay')?.hidden)
    const before = await hidden()
    await page.keyboard.press('h')
    const after = await hidden()
    await page.keyboard.press('h')
    console.log(`dev overlay "h": ${before} → ${after} → ${await hidden()}`)
  })
  await run('captions', async () => {
    await goto(page, 11.7)
    await sleep(1800)
    await shot(page, size, 'caption-2-fall')
  })
  await run('word', async () => {
    // The word reached by real input: the hold, its sketch, "keep scrolling".
    await goto(page, 12.3)
    await sleep(2000)
    await page.mouse.move(DEVICES[size].width / 2, DEVICES[size].height / 2)
    for (let i = 0; i < 12; i++) {
      if (await page.evaluate(() => window.__schwe.word.holding)) break
      if (touch) await swipe(page, size, 260)
      else await wheel(page, 3)
      await sleep(500)
    }
    const held = await page.evaluate(() => window.__schwe.word.holding)
    if (!held) console.log(`  ${size}: the word did not hold`)
    await sleep(2600)
    await shot(page, size, 'word-hold')
    // Part of the push that lets go: the hint's line fills (a wheel notch; on touch, an arrow key's worth).
    if (touch) await page.keyboard.press('ArrowDown')
    else await wheel(page, 1)
    await sleep(500)
    await shot(page, size, 'word-hold-push')
  })
  await run('ending', async () => {
    for (const t of [15, 16.5, 19.5, 21.5]) {
      await goto(page, t)
      await sleep(t === 15 ? 3000 : 1600)
      await shot(page, size, `ending-${String(t).replace('.', '_')}`)
    }
  })
  const atEnd = async () => {
    await goto(page, TIMELINE_END)
    await sleep(3200)
  }
  await run('final', async () => {
    await atEnd()
    await shot(page, size, 'final')
  })
  await run('focus', async () => {
    // Every control on the final screen, in tab order, then the sound switch.
    await atEnd()
    await page.evaluate(() => document.activeElement?.blur())
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      await sleep(350)
      const name = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return 'body'
        return (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
      })
      await shot(page, size, `focus-final-${i + 1}-${name}`)
    }
  })
  await run('sheet', async () => {
    await atEnd()
    for (const section of ['cities', 'about']) {
      await page.evaluate((s) => [...document.querySelectorAll('.final-screen .text-link')].find((b) => b.textContent.trim() === s)?.click(), section)
      await sleep(900)
      await shot(page, size, `sheet-${section}`)
      if (section === 'about') {
        await page.evaluate(() => document.querySelector('#sheet-credits')?.scrollIntoView({ block: 'start' }))
        await sleep(500)
        await shot(page, size, 'sheet-credits')
        // Keyboard inside the sheet: Tab to the first control, and on.
        await page.keyboard.press('Tab')
        await sleep(300)
        await shot(page, size, 'focus-sheet-1')
        await page.keyboard.press('Tab')
        await sleep(300)
        await shot(page, size, 'focus-sheet-2')
      }
      await page.keyboard.press('Escape')
      await sleep(700)
    }
    await shot(page, size, 'sheet-closed')
  })
  await page?.close().catch(() => {})

  // Lower tiers: the drift's slow points as each shows them.
  if (want('tiers'))
    for (const tier of TIERS.filter((t) => t !== 'high')) {
      const p = await openPage(size, QUERY + `&tier=${tier}`)
      await enter(p, size)
      await goto(p, 6)
      await sleep(2500)
      const passes = await p.evaluate(() => window.__schwe.driftPasses?.() ?? null)
      for (const [i, t] of (passes ?? DRIFT_PASSES).entries()) {
        await goto(p, t)
        await sleep(1400)
        await shot(p, size, `drift-${tier}-${i + 1}`)
      }
      await p.close()
    }

  if (want('still')) {
    const p = await openPage(size, QUERY + '&still')
    await sleep(3500)
    await p.screenshot({ path: `${dir(size)}/still.jpg`, type: 'jpeg', quality: 86, fullPage: true })
    await shot(p, size, 'still-top')
    await p.close()
  }
}

// Done-when checks over text.json: clipped, overlapping, under 12 px, letter-spaced script, and "z" set
// in the script (Playwrite draws it as ʒ).
function check(report) {
  const problems = []
  for (const [frame, boxes] of Object.entries(report)) {
    for (const b of boxes) {
      const script = b.family.startsWith('Playwrite')
      if (b.clipped) problems.push(`${frame}: clipped "${b.text}"`)
      if (b.overlaps.length) problems.push(`${frame}: "${b.text}" overlaps ${b.overlaps.map((t) => `"${t}"`).join(', ')}`)
      if (b.px < 12) problems.push(`${frame}: ${b.px}px "${b.text}"`)
      if (script && b.tracking !== 'normal' && Math.abs(parseFloat(b.tracking)) > 0.02 * b.px) problems.push(`${frame}: letter-spaced script (${b.tracking}) "${b.text}"`)
      if (script && /z/i.test(b.text)) problems.push(`${frame}: "z" in the script "${b.text}"`)
    }
  }
  return problems
}

try {
  for (const size of SIZES) await crawl(size)
} finally {
  await browser.close()
  await server.close()
}
mkdirSync(OUT, { recursive: true })
// A partial run (--only, --sizes) adds to what an earlier run into the same folder wrote.
appendFileSync(`${OUT}/console.txt`, consoleLines.map((l) => l + '\n').join(''))
const merged = existsSync(`${OUT}/text.json`) ? { ...JSON.parse(readFileSync(`${OUT}/text.json`, 'utf8')), ...textReport } : textReport
writeFileSync(`${OUT}/text.json`, JSON.stringify(merged, null, 1))
const perf = existsSync(`${OUT}/perf.json`) ? { ...JSON.parse(readFileSync(`${OUT}/perf.json`, 'utf8')), ...perfReport } : perfReport
writeFileSync(`${OUT}/perf.json`, JSON.stringify(perf, null, 1))
const low = Object.entries(perf).filter(([, f]) => f < 55)
console.log(`fps (dev overlay): ${Object.keys(perf).length} frames, ${low.length ? `under 55 at ${low.map(([k, f]) => `${k} ${f}`).join(', ')}` : 'all 55 or more'}`)
console.log(`console: ${consoleLines.length} lines → ${OUT}/console.txt`)
if (CHECK) {
  const problems = check(merged)
  console.log(problems.length ? problems.join('\n') : 'text: nothing clipped, overlapping, under 12 px, letter-spaced in the script, or "z" in the script')
  process.exitCode = problems.length ? 1 : 0
}
