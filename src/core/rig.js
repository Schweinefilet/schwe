// Values the master timeline tweens. Scene components read them every frame.
const INITIAL = {
  dive: 0, // dive drop optics: 0 ball lens, 1 plain window onto the upright clip
  cityType: 0, // opacity of the city / local time / weather type
  follow: 0, // camera look target: 0 its spline, 1 the falling drop
  fall: 0, // falling drop: 0 frozen in the word, 1 at the water (hand-off to the baked splash)
  splash: 0, // baked splash progress 0..1 (first to last frame)
  ring: 0, // ripple progress 0..1
  endType: 0, // opacity of the ending's answer (where it is raining hardest now)
}

export const rig = { ...INITIAL }

export function resetRig() {
  Object.assign(rig, INITIAL)
}
