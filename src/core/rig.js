// Values the master timeline tweens. Scene components read them every frame.
const INITIAL = {
  pathT: 0, // position along CAMERA_KEYS, in key-index units (0 .. keys-1)
  dive: 0, // dive drop optics: 0 ball lens, 1 plain window onto the upright clip
  cityType: 0, // opacity of the city / local time / weather type
  alignGlow: 1, // alignment drops' brightness; pulses when the word locks in
  rainFade: 1, // rain field opacity; eased down while the word holds so it reads cleanly
  follow: 0, // camera look target: 0 its spline, 1 the falling drop
  fall: 0, // falling drop: 0 frozen in the word, 1 at the water (hand-off to the baked splash)
  splash: 0, // baked splash progress 0..1 (first to last frame)
  ring: 0, // ripple progress 0..1
}

export const rig = { ...INITIAL }

export function resetRig() {
  Object.assign(rig, INITIAL)
}
