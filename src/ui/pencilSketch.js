// The word's sketch: rough pencil passes around its silhouette and through the negative space of some
// letters (wordContours), drawn in like an artist going round the word a few times, then adding the
// letters' inner lines and short accents. Strokes are built once in the word's
// units; drawSketch puts them on screen each frame through an affine map, so they follow the camera.

// When each pass starts and how long it takes (seconds), how much of the outline it covers (1 = once
// round; a little more overshoots its start), how far it wanders, its width (CSS px) and strength.
// Lower tiers draw the first few only.
const PASSES = [
  { at: 0.0, dur: 1.1, len: 1.06, wobble: 1.0, width: 1.0, alpha: 0.6 }, // a quick first loop, from the chime
  { at: 0.25, dur: 1.3, len: 1.1, wobble: 0.7, width: 1.3, alpha: 0.75 }, // the firm one
  { at: 0.8, dur: 0.55, len: 0.32, wobble: 0.5, width: 1.5, alpha: 0.8 },
  { at: 1.0, dur: 1.25, len: 1.04, wobble: 1.3, width: 0.9, alpha: 0.4 },
  { at: 1.5, dur: 0.5, len: 0.28, wobble: 0.6, width: 1.4, alpha: 0.7 },
  { at: 1.8, dur: 0.45, len: 0.22, wobble: 0.8, width: 1.2, alpha: 0.6 },
  { at: 2.05, dur: 0.55, len: 0.38, wobble: 0.5, width: 1.1, alpha: 0.55 },
]
const WOBBLE = 0.011 // in the word's units (its ink spans -1..1 across): a few px on screen
const CHUNK = 8 // points per stroke call: each chunk gets its own pencil pressure

// Smooth 1D value noise in [-1, 1].
function noise(x) {
  const hash = (i) => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return (hash(i) + (hash(i + 1) - hash(i)) * u) * 2 - 1
}

// `contours`: [{ pts, closed, inner }]. Inner lines (a letter's negative space) start `innerDelay`
// seconds after the silhouette and take only the full passes, not the accents, and wander less: they
// are short and close to the drops. An open line is drawn end to end, give or take a little at the
// ends; a closed one starts anywhere and runs on past its start.
export function sketchStrokes(contours, passes = PASSES.length, innerDelay = 0.45, seed = 3) {
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const strokes = []
  for (const pass of PASSES.slice(0, passes)) {
    for (const { pts: c, closed, inner } of contours) {
      if (inner && pass.len < 1) continue
      const n = c.length / 2
      const count = closed ? Math.round(pass.len * n) : Math.round(n * (0.9 + 0.1 * rand()))
      const from = closed ? Math.floor(rand() * n) : Math.floor(rand() * (n - count + 1))
      const wobble = pass.wobble * (inner ? 0.6 : 1)
      const seedA = rand() * 100
      const seedB = rand() * 100
      const drift = (rand() * 2 - 1) * 1.5 * WOBBLE // the end does not meet the start exactly
      const shiftX = (rand() * 2 - 1) * 0.4 * WOBBLE
      const shiftY = (rand() * 2 - 1) * 0.4 * WOBBLE
      const pts = new Float32Array(count * 2)
      for (let j = 0; j < count; j++) {
        const i = (from + j) % n
        const prev = closed ? (i - 1 + n) % n : Math.max(i - 1, 0)
        const next = closed ? (i + 1) % n : Math.min(i + 1, n - 1)
        const tx = c[next * 2] - c[prev * 2]
        const ty = c[next * 2 + 1] - c[prev * 2 + 1]
        const tl = Math.hypot(tx, ty) || 1
        const d = WOBBLE * wobble * noise(j * 0.03 + seedA) + 0.3 * WOBBLE * noise(j * 0.25 + seedB) + (drift * j) / count
        pts[j * 2] = c[i * 2] + (ty / tl) * d + shiftX
        pts[j * 2 + 1] = c[i * 2 + 1] - (tx / tl) * d + shiftY
      }
      strokes.push({ ...pass, at: pass.at + (inner ? innerDelay : 0), pts })
    }
  }
  return { strokes, total: Math.max(...strokes.map((st) => st.at + st.dur)) }
}

// A tileable paper grain: mostly strong, some faint, a few gaps. As a stroke's fill it breaks the
// line up like a white pencil on rough paper.
export function pencilGrain(ctx) {
  const size = 128
  const tile = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const g = tile.getContext('2d')
  const img = g.createImageData(size, size)
  let s = 11
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < size * size; i++) {
    const r = rand()
    img.data[i * 4] = 248
    img.data[i * 4 + 1] = 246
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = r < 0.1 ? 20 : r < 0.35 ? 120 : 200 + 55 * rand()
  }
  g.putImageData(img, 0, 0)
  return ctx.createPattern(tile, 'repeat')
}

// Pencil pressure along a stroke (u: 0..1 of its full length): light at the start, heavier through the
// middle, lifting off at the end. The moving tip is not tapered, so the line looks drawn, not grown.
const pressure = (u) => 0.3 + 0.7 * Math.min(1, u / 0.12, (1 - u) / 0.2) ** 0.7

// Draws the sketch as it stands `clock` seconds in. `m`: [a, b, c, d, e, f], word units → CSS px.
export function drawSketch(ctx, strokes, clock, m) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    const t = Math.min(Math.max((clock - s.at) / s.dur, 0), 1)
    if (t <= 0) continue
    const n = s.pts.length / 2
    const drawn = Math.floor((1 - (1 - t) ** 1.6) * (n - 1)) + 1 // the pencil sets off quickly and slows to finish
    ctx.globalAlpha = s.alpha
    for (let j0 = 0; j0 < drawn - 1; j0 += CHUNK) {
      const j1 = Math.min(j0 + CHUNK, drawn - 1)
      ctx.lineWidth = s.width * pressure((j0 + j1) / 2 / n)
      ctx.beginPath()
      for (let j = j0; j <= j1; j++) {
        const x = s.pts[j * 2]
        const y = s.pts[j * 2 + 1]
        const px = m[0] * x + m[2] * y + m[4]
        const py = m[1] * x + m[3] * y + m[5]
        if (j === j0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}
