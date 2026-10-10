// App-wide mutable state read by non-React consumers (dev overlay, later: video manager, audio).
// Mutated directly; nothing here triggers React renders.
export const state = {
  beat: 'rain',
  progress: 0,
  time: 1, // master timeline time, in units (the top of the page is the rain beat, at 1)
  unlocked: false,
  clips: null, // result of selectClips()
  diveCity: null, // chosen once per visit from the first selection
  // The film at rest (core/film.js): `stop` the stop it rests on (null while travelling), since
  // `restSince` (performance.now ms); `rest` eases 0 → 1 as it settles (the camera breathes, CameraRig);
  // `moves` counts the visitor's steps and holds.
  stop: 1,
  restSince: 0,
  rest: 0,
  moves: 0,
  rainCity: null, // the ending's answer, chosen with it: { kind: 'now' | 'soon' | 'none' | 'unknown', city?, … }
}
