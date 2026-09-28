// Web Audio entry point. Phase 1 only unlocks the context; sounds arrive in the audio phase.
let ctx = null

// Must be called synchronously inside a user gesture (the "enter" click), or browsers keep it suspended.
export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  // Older iOS Safari needs a sound started inside the gesture: play one silent sample.
  const src = ctx.createBufferSource()
  src.buffer = ctx.createBuffer(1, 1, 22050)
  src.connect(ctx.destination)
  src.start(0)
  return ctx
}

export const getAudioContext = () => ctx
