import gsap from 'gsap'
import * as THREE from 'three'
import { FREEZE_SECONDS } from '../config.js'

// Uniforms shared by reference across every material that needs them.
// uTimeScale: 1 = real-time rain, 0 = frozen.
// uSimTime: time integrated with uTimeScale. Shaders animate with this, never with wall-clock time.
export const globalUniforms = {
  uTimeScale: { value: 1 },
  uSimTime: { value: 0 },
  // Centre of the rain field's box (it tracks the camera). Rain wraps and fades at its faces; the
  // word's drops fade at the same faces, so they appear and vanish exactly like rain.
  uBoxCenter: { value: new THREE.Vector3() },
  // Where the lens is focused (core/focus.js): 0 on the backdrop, 1 on the rain (the usual look).
  uFocus: { value: 1 },
}

let target = 1

// Called from the master timeline on every update with the time scale the scroll position calls for
// (1 falling, 0 frozen, a slow fall again at the end). The target is a pure function of scroll; only
// the rate of change is time-based (`seconds`, `ease`), so rewinding always restores it.
export function setTimeTarget(value, seconds = FREEZE_SECONDS, ease = 'power2.inOut') {
  if (value === target) return
  target = value
  gsap.to(globalUniforms.uTimeScale, { value, duration: seconds, ease, overwrite: true })
}

export function stepSimTime(dt) {
  globalUniforms.uSimTime.value += dt * globalUniforms.uTimeScale.value
}

export function resetUniforms() {
  gsap.killTweensOf(globalUniforms.uTimeScale)
  target = 1
  globalUniforms.uTimeScale.value = 1
}
