import fontUrl from '@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff2?url'

// Samples points evenly over a word's glyphs. The word is drawn into an offscreen canvas with a
// self-hosted font, then a jittered grid picks roughly `count` filled pixels.
// Returns { points: Float32Array [x0, y0, x1, y1, …], aspect } with x in [-1, 1] across the word's
// ink and y scaled the same way (so y spans ±1/aspect), y up.

const FAMILY = 'schwe-word'
let fontReady = null

function loadFont() {
  if (!fontReady) {
    const face = new FontFace(FAMILY, `url(${fontUrl})`, { weight: '600' })
    fontReady = face.load().then((f) => document.fonts.add(f))
  }
  return fontReady
}

export async function sampleWord(text, count, seed = 1) {
  await loadFont()
  const size = 240
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.font = `600 ${size}px "${FAMILY}"`
  const m = ctx.measureText(text)
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 8
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 8
  canvas.width = w
  canvas.height = h
  ctx.font = `600 ${size}px "${FAMILY}"`
  ctx.fillStyle = '#fff'
  ctx.fillText(text, m.actualBoundingBoxLeft + 4, m.actualBoundingBoxAscent + 4)
  const data = ctx.getImageData(0, 0, w, h).data

  let filled = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) filled++
  const cell = Math.max(1, Math.sqrt(filled / count))

  // Seeded random so the word is laid out identically on every visit.
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646

  const out = []
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      for (let tries = 0; tries < 4; tries++) {
        const x = Math.floor(cx + rand() * cell)
        const y = Math.floor(cy + rand() * cell)
        if (x >= w || y >= h || data[(y * w + x) * 4 + 3] <= 127) continue
        out.push(((x + 0.5) / w) * 2 - 1, -(((y + 0.5) / h) * 2 - 1) * (h / w))
        break
      }
    }
  }
  return { points: new Float32Array(out), aspect: w / h }
}
