// App-wide mutable state read by non-React consumers (dev overlay, later: video manager, audio).
// Mutated directly; nothing here triggers React renders.
export const state = {
  beat: 'loader',
  progress: 0,
  unlocked: false,
  clips: null, // result of selectClips()
}
