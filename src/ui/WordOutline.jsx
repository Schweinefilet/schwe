import { quality } from '../core/quality.js'
import { overlay } from './overlay.js'

// One loose loop drawn around "schwe" once the visitor stays on the word: white, with a soft pastel
// glow (lower tiers skip the glow; its blur repaints while it draws). AlignmentWord.jsx sets the
// loop's shape, places it over the word each frame and runs the drawing (ALIGN.outline).
export default function WordOutline() {
  return (
    <svg ref={(el) => (overlay.outline = el)} className="word-outline" aria-hidden="true">
      {quality.name !== 'low' && (
        <g className="word-outline__glow">
          <path pathLength="1" />
        </g>
      )}
      <path className="word-outline__line" pathLength="1" />
    </svg>
  )
}

// The loop in the word's own units (x across the word's ink from -1 to 1, y up, the ink ±1/aspect
// high): a rounded superellipse with a little margin, drawn like a hand-drawn ring. It wobbles
// gently, and runs on past its start, drifting slightly outward so the end passes just outside it.
export function outlinePath(aspect) {
  const A = 1.1
  const B = 1 / aspect + 0.16
  const n = 2.4 // 2 is an ellipse; higher tends to a rounded rectangle
  const start = 0.58 * Math.PI
  const sweep = 2 * Math.PI + 0.32
  const steps = 240
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const s = i / steps
    const t = start + s * sweep
    const r = (1 + 0.022 * Math.sin(3 * t + 1.1) + 0.012 * Math.sin(5 * t + 0.4)) * (1 + 0.04 * s * s)
    const c = Math.cos(t)
    const sn = Math.sin(t)
    const x = A * r * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = B * r * Math.sign(sn) * Math.abs(sn) ** (2 / n)
    pts.push(`${x.toFixed(4)} ${y.toFixed(4)}`)
  }
  return `M ${pts.join(' L ')}`
}
