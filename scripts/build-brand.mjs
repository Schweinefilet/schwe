#!/usr/bin/env node
// The site's link preview and icons, set in the site's own type and drawn from its own pictures:
//   public/og.jpg               1200 × 630: the still frame (public/still.jpg), the name in Playwrite AU VIC
//                               and the question, over the same indigo scrim the ending uses
//   public/apple-touch-icon.png 180 × 180, and public/icon-192.png, icon-512.png, icon-maskable-512.png
//                               (site.webmanifest): the favicon's drop on the loader's night and haze
// Rendered in headless Chrome (no GPU needed). Run after the still frame or the type changes:
//   npm run brand

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(resolve(file)).toString('base64')}`
const SCRIPT = dataUrl('src/assets/playwrite-au-vic-latin.woff2', 'font/woff2')
const TEXT = dataUrl('src/assets/source-sans-3-latin.woff2', 'font/woff2')
const STILL = dataUrl('public/still.jpg', 'image/jpeg')
// The favicon's drop without its black disc (as DropMark.jsx draws it).
const DROP = readFileSync('public/favicon.svg', 'utf8').replace(/<circle cx="32" cy="32" r="30" fill="#000"\/>/, '')

const fonts = `
  @font-face { font-family: 'Playwrite AU VIC'; src: url(${SCRIPT}) format('woff2'); font-weight: 100 400; }
  @font-face { font-family: 'Source Sans 3'; src: url(${TEXT}) format('woff2'); font-weight: 200 900; }
  html, body { margin: 0; background: #030307; }
`
// The scrim recipe of styles.css (--scrim): indigo falling off along a cosine.
const scrim = [1, 0.976, 0.905, 0.794, 0.655, 0.5, 0.345, 0.206, 0.095, 0.024, 0].map((a, i) => `rgba(8, 7, 28, ${a}) ${i * 10}%`).join(', ')

const og = `<!doctype html><style>${fonts}
  .card { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #030307 url(${STILL}) 50% 28% / cover; }
  .card::before { content: ''; position: absolute; left: -10%; right: -10%; bottom: -30%; height: 90%; opacity: 0.85;
    background: radial-gradient(60% 100% at 50% 100%, ${scrim}); }
  .type { position: absolute; left: 0; right: 0; bottom: 64px; text-align: center; color: #fff; }
  h1 { margin: 0; font: 200 96px/1.25 'Playwrite AU VIC'; text-shadow: 0 0 28px rgba(230, 227, 255, 0.35), 0 0 2px rgba(8, 7, 28, 0.7); }
  p { margin: 10px 0 0; color: #d4d1ee; font: 300 30px/1.4 'Playwrite AU VIC'; text-shadow: 0 0 2px rgba(8, 7, 28, 0.75), 0 0 7px rgba(8, 7, 28, 0.5); }
</style><div class="card"><div class="type"><h1>schwe</h1><p>where is it raining now?</p></div></div>`

const icon = (size, { pad }) => `<!doctype html><style>${fonts}
  .icon { position: relative; width: ${size}px; height: ${size}px; overflow: hidden; background: #030307; display: grid; place-items: center; }
  .icon::before { content: ''; position: absolute; inset: -12%;
    background: radial-gradient(48% 38% at 50% 44%, rgba(190, 178, 255, 0.3), transparent 72%),
      radial-gradient(36% 30% at 62% 62%, rgba(255, 196, 172, 0.18), transparent 70%),
      radial-gradient(42% 34% at 36% 34%, rgba(164, 202, 255, 0.16), transparent 70%); }
  svg { position: relative; width: ${Math.round(size * (1 - 2 * pad))}px; height: auto; filter: drop-shadow(0 0 ${size / 18}px rgba(230, 227, 255, 0.35)); }
</style><div class="icon">${DROP.replace('viewBox="0 0 64 64"', 'viewBox="4 4 56 56"')}</div>`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
try {
  const page = await browser.newPage()
  const render = async (html, w, h, path, type) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 88 } : {}), clip: { x: 0, y: 0, width: w, height: h } })
    console.log(path)
  }
  await render(og, 1200, 630, 'public/og.jpg', 'jpeg')
  await render(icon(180, { pad: 0.2 }), 180, 180, 'public/apple-touch-icon.png', 'png')
  await render(icon(192, { pad: 0.18 }), 192, 192, 'public/icon-192.png', 'png')
  await render(icon(512, { pad: 0.18 }), 512, 512, 'public/icon-512.png', 'png')
  // Maskable: the drop inside the safe circle (80% of the icon), the haze to the edges.
  await render(icon(512, { pad: 0.28 }), 512, 512, 'public/icon-maskable-512.png', 'png')
} finally {
  await browser.close()
}
