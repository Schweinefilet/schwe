import * as THREE from 'three'
import { FALL_START_DEFAULT, SPLASH } from '../config.js'

// Where the one falling drop starts, where it lands, and where it is now. AlignmentWord sets the
// start (the word sample it picks); Splash reads it; CameraRig looks at `pos` while following.
export const fall = {
  start: new THREE.Vector3(...FALL_START_DEFAULT),
  impact: new THREE.Vector3(FALL_START_DEFAULT[0], SPLASH.groundY, FALL_START_DEFAULT[2]),
  pos: new THREE.Vector3(...FALL_START_DEFAULT),
  handoffHeight: 0.13, // height above the water where the VAT's own drop is at frame 0 (set from splash.json)
}

export function setFallStart(v) {
  fall.start.copy(v)
  fall.impact.set(v.x, SPLASH.groundY, v.z)
}

// Position of the falling drop for fall progress t (0 = frozen in the word, 1 = hand-off to the VAT).
export function fallPosition(t, out = fall.pos) {
  return out.set(fall.start.x, THREE.MathUtils.lerp(fall.start.y, fall.impact.y + fall.handoffHeight, t), fall.start.z)
}
