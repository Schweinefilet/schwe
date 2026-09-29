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

// The word's silhouette, widened by `margin` px at the sampling size, as closed outlines in the same
// units as sampleWord's points (so they sit exactly around its drops). The text is drawn once with a
// round-joined stroke of twice the margin, which merges letters closer than that into one shape; each
// shape's outer edge is traced, smoothed and resampled every `spacing` px.
// Returns { contours: [Float32Array [x0, y0, x1, y1, …], …] }.
export async function wordContours(text, margin = 14, spacing = 5) {
  await loadFont()
  const size = 240
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = `600 ${size}px "${FAMILY}"`
  const m = probe.measureText(text)
  // sampleWord's canvas: the ink plus 4 px all round. This one adds room for the margin.
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 8
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 8
  const pad = margin + 4
  const W = w + 2 * pad
  const H = h + 2 * pad
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.font = `600 ${size}px "${FAMILY}"`
  ctx.fillStyle = ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2 * margin
  ctx.lineJoin = 'round'
  const x0 = m.actualBoundingBoxLeft + 4 + pad
  const y0 = m.actualBoundingBoxAscent + 4 + pad
  ctx.fillText(text, x0, y0)
  ctx.strokeText(text, x0, y0)
  const alpha = ctx.getImageData(0, 0, W, H).data
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3] > 127 ? 1 : 0

  const contours = []
  const label = new Int32Array(W * H)
  let next = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue
    // A new shape: label it (flood fill); its first pixel in raster order starts the outer edge.
    const id = ++next
    let area = 0
    const stack = [i]
    label[i] = id
    while (stack.length) {
      const j = stack.pop()
      area++
      const x = j % W
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= mask.length || label[k] || !mask[k] || (Math.abs((k % W) - x) > 1)) continue
        label[k] = id
        stack.push(k)
      }
    }
    if (area < 0.01 * W * H) continue // specks (the i's dot, if any) are not worth a line
    const edge = traceOuter(label, id, W, H, i % W, Math.floor(i / W))
    const pts = resample(smooth(edge, 6), spacing)
    const out = new Float32Array(pts.length)
    for (let p = 0; p < pts.length; p += 2) {
      out[p] = ((pts[p] - pad + 0.5) / w) * 2 - 1
      out[p + 1] = -(((pts[p + 1] - pad + 0.5) / h) * 2 - 1) * (h / w)
    }
    contours.push(out)
  }
  return { contours }
}

// Moore-neighbour tracing of one shape's outer edge, clockwise on screen, from its first pixel in
// raster order (whose west and north neighbours are outside). Returns [x0, y0, x1, y1, …].
const DX = [1, 1, 0, -1, -1, -1, 0, 1] // E, SE, S, SW, W, NW, N, NE
const DY = [0, 1, 1, 1, 0, -1, -1, -1]
const DIR = (dx, dy) => DX.findIndex((x, i) => x === dx && DY[i] === dy)
function traceOuter(label, id, W, H, sx, sy) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === id
  const pts = [sx, sy]
  let x = sx
  let y = sy
  let from = 4 // the west neighbour, known to be outside
  let first = -1
  for (let guard = 0; guard < 4 * W * H; guard++) {
    let found = -1
    for (let i = 1; i <= 8; i++) {
      const d = (from + i) % 8
      if (inside(x + DX[d], y + DY[d])) {
        found = d
        break
      }
    }
    if (found < 0) break // a single pixel
    const prev = (found + 7) % 8 // the last outside neighbour checked, seen from the new pixel
    const nx = x + DX[found]
    const ny = y + DY[found]
    from = DIR(x + DX[prev] - nx, y + DY[prev] - ny)
    if (x === sx && y === sy) {
      if (first === found) break // back where it started, leaving the same way: closed
      if (first < 0) first = found
    }
    x = nx
    y = ny
    pts.push(x, y)
  }
  return pts
}

// Moving average over a closed polyline, `r` points either side.
function smooth(pts, r) {
  const n = pts.length / 2
  const out = new Float32Array(pts.length)
  for (let i = 0; i < n; i++) {
    let sx = 0
    let sy = 0
    for (let k = -r; k <= r; k++) {
      const j = (((i + k) % n) + n) % n
      sx += pts[j * 2]
      sy += pts[j * 2 + 1]
    }
    out[i * 2] = sx / (2 * r + 1)
    out[i * 2 + 1] = sy / (2 * r + 1)
  }
  return out
}

// Evenly spaced points along a closed polyline.
function resample(pts, spacing) {
  const n = pts.length / 2
  const out = []
  let carry = 0
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2]
    const ay = pts[i * 2 + 1]
    const bx = pts[((i + 1) % n) * 2]
    const by = pts[((i + 1) % n) * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay)
    for (let s = carry; s < len; s += spacing) out.push(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len)
    carry = (((carry - len) % spacing) + spacing) % spacing
  }
  return out
}
