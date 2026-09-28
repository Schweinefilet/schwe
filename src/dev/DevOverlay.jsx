import { useEffect, useRef } from 'react'
import { state } from '../core/state.js'
import { globalUniforms } from '../core/uniforms.js'
import { liveCount } from '../content/videoManager.js'

const WINDOW_MS = 250

// Dev only (imported behind import.meta.env.DEV). Writes to the DOM directly, no React renders.
// Frame time = interval between animation frames, which is the site's real frame pacing.
export default function DevOverlay() {
  const ref = useRef()

  useEffect(() => {
    let raf
    let last = performance.now()
    let windowStart = last
    let frames = 0
    let worst = 0

    const loop = (now) => {
      const dt = now - last
      last = now
      frames++
      worst = Math.max(worst, dt)
      if (now - windowStart >= WINDOW_MS) {
        const elapsed = now - windowStart
        const fps = (frames * 1000) / elapsed
        ref.current.textContent =
          `fps    ${fps.toFixed(0)}\n` +
          `frame  ${(elapsed / frames).toFixed(1)} ms  (worst ${worst.toFixed(1)})\n` +
          `scroll ${(state.progress * 100).toFixed(1)} %\n` +
          `beat   ${state.beat}\n` +
          `time×  ${globalUniforms.uTimeScale.value.toFixed(2)}\n` +
          `video  ${liveCount()} live`
        windowStart = now
        frames = 0
        worst = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <pre ref={ref} className="dev-overlay" />
}
