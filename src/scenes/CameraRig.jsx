import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BACKDROP, CAMERA_FOV, DEFAULT_DIVE_CITY, DIVE_DROP, HERO, heroDropsFor, visibleDrops } from '../config.js'
import { envUniforms } from '../content/backdrop.js'
import { tierPath } from '../core/tierPath.js'
import { applyTurn, createFraming } from '../core/framing.js'
import { quality } from '../core/quality.js'
import { useTier } from '../core/useTier.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { fallPosition } from '../core/fall.js'

const _pos = new THREE.Vector3()
const _look = new THREE.Vector3()
const _dive = new THREE.Vector3(...DIVE_DROP)
const _dir = new THREE.Vector3()
const _side = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

// Resting on a stop (core/film.js) the frame breathes: the view turns a fraction of a degree, slowly,
// about the camera's own position (so the word, which lines up only from the eye, stays whole), on two
// sines per axis so it never reads as a loop. Radians, and periods in seconds.
const BREATH = { yaw: 0.004, pitch: 0.0028, periods: [11, 4.7, 8.3, 3.9] }
const smooth = (x) => x * x * (3 - 2 * x)
function breathe(pos, look, amount, seconds) {
  if (amount <= 0) return
  const [a, b, c, d] = BREATH.periods.map((p) => (2 * Math.PI * seconds) / p)
  const yaw = amount * BREATH.yaw * (0.7 * Math.sin(a) + 0.3 * Math.sin(b + 1.3))
  const pitch = amount * BREATH.pitch * (0.7 * Math.sin(c + 0.4) + 0.3 * Math.sin(d + 2.1))
  _dir.subVectors(look, pos).applyAxisAngle(UP, yaw)
  _side.crossVectors(_dir, UP).normalize()
  look.copy(pos).add(_dir.applyAxisAngle(_side, pitch))
}

const PORTRAIT_PULLBACK = 1.1 // at 390×844 the camera stands ~1.6× farther from the splash
const NEAR = 0.02
// The drop's proxy mesh reaches 1.06 radii; the camera stops 1.28 radii from its centre in the dive.
const PROXY_RADIUS = 1.06 * HERO.radius

export default function CameraRig() {
  const out = useMemo(() => ({ pos: _pos, look: _look }), [])
  // On narrow screens the view turns a little toward each drift drop this tier shows as it comes up,
  // so the drop is fully in frame where its city shows (core/framing.js). Nothing on wide screens.
  const size = useThree((s) => s.size)
  const tier = useTier()
  const framing = useMemo(() => {
    const { path, passes } = tierPath()
    const drops = visibleDrops(heroDropsFor(DEFAULT_DIVE_CITY), quality.heroDrops)
      .filter((d) => !d.dive)
      .map((d, i) => ({ pos: d.pos, at: passes[i] }))
    return createFraming(path, drops, { fov: CAMERA_FOV, aspect: size.width / size.height, height: size.height, radius: HERO.radius })
  }, [size.width, size.height, tier])

  useFrame(({ camera, clock }) => {
    // Position and look are functions of timeline time, so travelling back retraces them exactly. The
    // path is this tier's (it slows only at the drops the tier shows).
    tierPath().path.sample(state.time, out)
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
    breathe(_pos, _look, smooth(state.rest), clock.elapsedTime)
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
