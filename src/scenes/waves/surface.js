import * as THREE from 'three'
import { PUDDLE_RAIN } from '../../config.js'

// The puddle's live surface, shared by reference: PuddleRain.jsx runs the simulation and points these
// at its field; every material that includes surface.glsl spreads them into its own uniforms.
// Calm water: what uField reads when no simulation runs.
export const calmField = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)
calmField.needsUpdate = true

export const surfaceUniforms = {
  uField: { value: calmField },
  uFieldOrigin: { value: new THREE.Vector2() },
  uFieldTile: { value: PUDDLE_RAIN.tile },
  uFieldSize: { value: 1 },
  uFieldWorld: { value: PUDDLE_RAIN.worldPerMeter },
  uFieldOn: { value: 0 },
}
