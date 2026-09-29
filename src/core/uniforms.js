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
}

let frozen = false

// Called from the master timeline whenever scroll crosses the freeze label. The target is a pure
// function of scroll; only the rate of change is time-based, so rewinding always restores it.
export function setFrozen(next) {
  if (next === frozen) return
  frozen = next
  gsap.to(globalUniforms.uTimeScale, {
    value: next ? 0 : 1,
    duration: FREEZE_SECONDS,
    ease: 'power2.inOut',
    overwrite: true,
  })
}

export function stepSimTime(dt) {
  globalUniforms.uSimTime.value += dt * globalUniforms.uTimeScale.value
}

export function resetUniforms() {
  gsap.killTweensOf(globalUniforms.uTimeScale)
  frozen = false
  globalUniforms.uTimeScale.value = 1
}
