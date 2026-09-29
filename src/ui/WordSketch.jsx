import { quality } from '../core/quality.js'
import { overlay } from './overlay.js'
import { pencilGrain } from './pencilSketch.js'

// The canvas the word's pencil sketch is drawn on (ui/pencilSketch.js). AlignmentWord.jsx sizes it to the
// word's area on screen, moves it there and draws each frame while the sketch shows. Lower tiers skip
// the soft glow (a filter over the canvas, repainted while it draws).
export default function WordSketch() {
  const register = (canvas) => {
    if (!canvas) return (overlay.sketch = null)
    const ctx = canvas.getContext('2d')
    overlay.sketch = { canvas, ctx, grain: pencilGrain(ctx) }
  }
  return <canvas ref={register} className={`word-sketch${quality.name === 'low' ? '' : ' word-sketch--glow'}`} aria-hidden="true" />
}
