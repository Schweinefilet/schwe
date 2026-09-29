import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CAMERA_KEYS, DIVE_DROP, HERO } from '../config.js'
import { createCameraPath } from '../core/cameraPath.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { fallPosition } from '../core/fall.js'

const _pos = new THREE.Vector3()
const _look = new THREE.Vector3()
const _dive = new THREE.Vector3(...DIVE_DROP)

const PORTRAIT_PULLBACK = 1.1 // at 390×844 the camera stands ~1.6× farther from the splash
const NEAR = 0.02
// The drop's proxy mesh reaches 1.06 radii; the camera stops 1.28 radii from its centre in the dive.
const PROXY_RADIUS = 1.06 * HERO.radius

export default function CameraRig() {
  const path = useMemo(() => createCameraPath(CAMERA_KEYS), [])
  const out = useMemo(() => ({ pos: _pos, look: _look }), [])

  useFrame(({ camera }) => {
    // Position and look are functions of timeline time, so scrolling back retraces them exactly.
    path.sample(state.time, out)

    // Beat 7: turn toward the falling drop and keep it framed on the way down.
    if (rig.follow > 0) {
      _look.lerp(fallPosition(rig.fall), rig.follow) // computed here too: no one-frame lag
      // Portrait screens see a narrow slice horizontally; back off so the crown still fits.
      if (camera.aspect < 1) {
        const back = 1 + (1 - camera.aspect) * PORTRAIT_PULLBACK * rig.follow
        _pos.sub(_look).multiplyScalar(back).add(_look)
      }
    }
    camera.position.copy(_pos)
    camera.lookAt(_look)

    // The dive drop is small, so the camera gets closer to it than the default near plane: pull the
    // near plane in only while that is true, keeping depth precision everywhere else.
    const near = THREE.MathUtils.clamp(0.5 * (_pos.distanceTo(_dive) - PROXY_RADIUS), 0.002, NEAR)
    if (Math.abs(near - camera.near) > 1e-5) {
      camera.near = near
      camera.updateProjectionMatrix()
    }
  })

  return null
}
