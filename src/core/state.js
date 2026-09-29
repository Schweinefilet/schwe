// App-wide mutable state read by non-React consumers (dev overlay, later: video manager, audio).
// Mutated directly; nothing here triggers React renders.
export const state = {
  beat: 'rain',
  progress: 0,
  time: 1, // master timeline time, in units (the top of the page is the rain beat, at 1)
  unlocked: false,
  clips: null, // result of selectClips()
  diveCity: null, // chosen once per visit from the first selection
  rainCity: null, // the ending's answer, chosen with it: { kind: 'now' | 'soon' | 'none', city?, … }
}
