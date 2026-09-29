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

// The word's outlines, in the same units as sampleWord's points (so they sit exactly around its drops):
//   - its silhouette widened by `margin` px (at the sampling size): the text drawn with a round-joined
//     stroke of twice the margin merges letters closer than that into one shape, whose outer edge is
//     traced. Closed.
//   - for each letter in `inner.letters`, lines through its negative space, `inner.margin` px off the
//     letter: the letter is closed (its openings bridged, as by a chord across a c's mouth), and the
//     edge of what then lies inside it but outside the letter is traced where it runs along the letter.
//     An enclosed counter (an e's eye) gives a closed loop; an open one gives an arc ending at the
//     stroke ends, so the letter's opening still reads.
// Every line is smoothed and resampled every `spacing` px.
// Returns { contours: [{ pts: Float32Array [x0, y0, …], closed, inner }, …] }.
export async function wordContours(text, margin = 14, spacing = 5, inner = null) {
  await loadFont()
  const size = 240
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = `600 ${size}px "${FAMILY}"`
  const m = probe.measureText(text)
  // sampleWord's canvas is the ink plus 4 px all round; these add room around it.
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 8
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 8
  const draw = (pad, stroke) => {
    const W = w + 2 * pad
    const H = h + 2 * pad
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.font = `600 ${size}px "${FAMILY}"`
    ctx.fillStyle = ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2 * stroke
    ctx.lineJoin = 'round'
    const x0 = m.actualBoundingBoxLeft + 4 + pad
    const y0 = m.actualBoundingBoxAscent + 4 + pad
    ctx.fillText(text, x0, y0)
    if (stroke > 0) ctx.strokeText(text, x0, y0)
    const alpha = ctx.getImageData(0, 0, W, H).data
    const mask = new Uint8Array(W * H)
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3] > 127 ? 1 : 0
    return { mask, W, H, pad }
  }
  // Canvas px → the word's units.
  const toWord = (pts, pad, closed, isInner) => {
    const out = new Float32Array(pts.length)
    for (let p = 0; p < pts.length; p += 2) {
      out[p] = ((pts[p] - pad + 0.5) / w) * 2 - 1
      out[p + 1] = -(((pts[p + 1] - pad + 0.5) / h) * 2 - 1) * (h / w)
    }
    return { pts: out, closed, inner: isInner }
  }

  const contours = []
  const outer = draw(margin + 4, margin)
  for (const { id, start, label } of components(outer.mask, outer.W, outer.H, 0.01)) {
    const edge = traceOuter(label, id, outer.W, outer.H, start % outer.W, Math.floor(start / outer.W))
    contours.push(toWord(resample(smooth(edge, 6, true), spacing, true), outer.pad, true, false))
  }

  if (inner?.letters) {
    // Room for the closing to act without meeting the canvas edge.
    const close = Math.round(0.18 * size) // bridges openings up to about twice this wide
    const glyphs = draw(close + 8, 0)
    const { W, H } = glyphs
    const letters = components(glyphs.mask, W, H, 0.002).sort((a, b) => a.minX - b.minX)
    if (letters.length === text.length) {
      letters.forEach((letter, i) => {
        if (!inner.letters.includes(text[i])) return
        const own = new Uint8Array(W * H)
        for (let j = 0; j < own.length; j++) own[j] = letter.label[j] === letter.id ? 1 : 0
        const toLetter = distanceTo(own, W, H)
        const grown = new Uint8Array(W * H)
        for (let j = 0; j < grown.length; j++) grown[j] = toLetter[j] > close ? 1 : 0 // outside the grown letter
        const toOutside = distanceTo(grown, W, H)
        // Inside the closed letter, outside the letter by at least the inner margin.
        const space = new Uint8Array(W * H)
        for (let j = 0; j < space.length; j++) space[j] = toOutside[j] > close && toLetter[j] >= inner.margin ? 1 : 0
        for (const hole of components(space, W, H, 0.0004)) {
          const edge = traceOuter(hole.label, hole.id, W, H, hole.start % W, Math.floor(hole.start / W))
          for (const run of alongLetter(edge, toLetter, W, inner.margin + 1.5)) {
            if (run.pts.length < 2 * 12) continue // a few px: not worth a line
            contours.push(toWord(resample(smooth(run.pts, 6, run.closed), spacing, run.closed), glyphs.pad, run.closed, true))
          }
        }
      })
    }
  }
  return { contours }
}

// Connected shapes in a mask (4-neighbour), each at least `minShare` of the canvas: { id, start (its
// first pixel in raster order), minX, label (shared Int32Array of ids) }.
function components(mask, W, H, minShare) {
  const label = new Int32Array(W * H)
  const out = []
  let next = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue
    const id = ++next
    let area = 0
    let minX = W
    const stack = [i]
    label[i] = id
    while (stack.length) {
      const j = stack.pop()
      area++
      const x = j % W
      if (x < minX) minX = x
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= mask.length || label[k] || !mask[k] || Math.abs((k % W) - x) > 1) continue
        label[k] = id
        stack.push(k)
      }
    }
    if (area >= minShare * W * H) out.push({ id, start: i, minX, label })
  }
  return out
}

// Euclidean distance (px) from every pixel to the nearest set pixel of `mask` (Felzenszwalb and
// Huttenlocher's two-pass transform).
function distanceTo(mask, W, H) {
  const INF = 1e20
  const d = new Float64Array(W * H)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const out = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const pass = (len) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      out[q] = (q - v[k]) ** 2 + f[v[k]]
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = d[y * W + x]
    pass(H)
    for (let y = 0; y < H; y++) d[y * W + x] = out[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = d[y * W + x]
    pass(W)
    for (let x = 0; x < W; x++) d[y * W + x] = Math.sqrt(out[x])
  }
  return d
}

// The stretches of a traced edge that run along the letter (within `near` px of it); where the edge
// crosses an opening instead, it is left out. All of it along the letter: one closed line.
function alongLetter(edge, toLetter, W, near) {
  const n = edge.length / 2
  const on = (i) => toLetter[edge[i * 2 + 1] * W + edge[i * 2]] <= near
  const first = Array.from({ length: n }, (_, i) => i).find((i) => !on(i))
  if (first === undefined) return [{ pts: edge, closed: true }]
  const runs = []
  let run = null
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n
    if (on(i)) (run ??= []).push(edge[i * 2], edge[i * 2 + 1])
    else if (run) {
      runs.push({ pts: run, closed: false })
      run = null
    }
  }
  if (run) runs.push({ pts: run, closed: false })
  return runs
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
  pts.length -= 2 // the start, reached again
  return pts
}

// Moving average, `r` points either side (an open line keeps its ends in place).
function smooth(pts, r, closed) {
  const n = pts.length / 2
  const out = new Float32Array(pts.length)
  for (let i = 0; i < n; i++) {
    let sx = 0
    let sy = 0
    let count = 0
    for (let k = -r; k <= r; k++) {
      let j = i + k
      if (closed) j = ((j % n) + n) % n
      else if (j < 0 || j >= n) continue
      sx += pts[j * 2]
      sy += pts[j * 2 + 1]
      count++
    }
    out[i * 2] = sx / count
    out[i * 2 + 1] = sy / count
  }
  return out
}

// Evenly spaced points along a polyline.
function resample(pts, spacing, closed) {
  const n = pts.length / 2
  const out = []
  let carry = 0
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const ax = pts[i * 2]
    const ay = pts[i * 2 + 1]
    const bx = pts[((i + 1) % n) * 2]
    const by = pts[((i + 1) % n) * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay)
    for (let s = carry; s < len; s += spacing) out.push(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len)
    carry = (((carry - len) % spacing) + spacing) % spacing
  }
  if (!closed) out.push(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
  return out
}
