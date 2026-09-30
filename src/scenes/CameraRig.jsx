import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BACKDROP, CAMERA_FOV, CAMERA_KEYS, DEFAULT_DIVE_CITY, DIVE_DROP, DRIFT_PASSES, HERO, heroDropsFor } from '../config.js'
import { envUniforms } from '../content/backdrop.js'
import { createCameraPath } from '../core/cameraPath.js'
import { applyTurn, createFraming } from '../core/framing.js'
import { quality } from '../core/quality.js'
import { useTier } from '../core/useTier.js'
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
  // On narrow screens the view turns a little toward each drift drop this tier shows as it comes up,
  // so the drop is fully in frame where its city shows (core/framing.js). Nothing on wide screens.
  const size = useThree((s) => s.size)
  const tier = useTier()
  const framing = useMemo(() => {
    const drops = heroDropsFor(DEFAULT_DIVE_CITY)
      .filter((d) => !d.dive)
      .slice(0, quality.heroDrops - 1)
      .map((d, i) => ({ pos: d.pos, at: DRIFT_PASSES[i] }))
    return createFraming(path, drops, { fov: CAMERA_FOV, aspect: size.width / size.height, height: size.height, radius: HERO.radius })
  }, [path, size.width, size.height, tier])

  useFrame(({ camera }) => {
    // Position and look are functions of timeline time, so scrolling back retraces them exactly.
    path.sample(state.time, out)
    applyTurn(_pos, _look, framing(state.time))

    // Beat 7: turn toward the falling drop and keep it framed on the way down.
    if (rig.follow > 0) {
      const drop = fallPosition(rig.fall) // computed here too: no one-frame lag
      // Portrait screens see a narrow slice horizontally; back off from the drop so the crown still fits.
      // (From the drop, not the look target: at the end the gaze leaves it for the far side of the puddle.)
      // Once the gaze is free (the camera down on the water) only across it: along the slope to the drop
      // it would sink the camera into the water.
      if (camera.aspect < 1) {
        const back = 1 + (1 - camera.aspect) * PORTRAIT_PULLBACK * rig.follow
        const y = _pos.y
        _pos.sub(drop).multiplyScalar(back).add(drop)
        _pos.y = THREE.MathUtils.lerp(_pos.y, y, rig.lookFree)
      }
      _look.lerp(drop, rig.follow * (1 - rig.lookFree))
    }
    camera.position.copy(_pos)
    camera.lookAt(_look)
    // Down at the puddle the square behind rises, as it would for an eye at its ground (BACKDROP.ground).
    const { lift, from, to } = BACKDROP.ground
    envUniforms.uEnvLift.value = THREE.MathUtils.degToRad(lift) * (1 - THREE.MathUtils.smoothstep(_pos.y, to, from))

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
