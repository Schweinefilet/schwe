import { PUDDLE } from '../config.js'

// Values the master timeline tweens. Scene components read them every frame.
const INITIAL = {
  pathT: 0, // position along CAMERA_KEYS, in key-index units (0 .. keys-1)
  dive: 0, // dive drop optics: 0 ball lens, 1 plain window onto the upright clip
  cityType: 0, // opacity of the city / local time / weather type
  alignGlow: 1, // alignment drops' brightness; pulses when the word locks in
  rainFade: 1, // rain field opacity; eased down while the word holds so it reads cleanly
  dropY: PUDDLE.dropStartY, // falling drop height
  ring: 0, // ripple progress 0..1
}

export const rig = { ...INITIAL }

export function resetRig() {
  Object.assign(rig, INITIAL)
}
