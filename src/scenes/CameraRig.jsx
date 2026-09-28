import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CAMERA_KEYS } from '../config.js'
import { rig } from '../core/rig.js'
import { fall, fallPosition } from '../core/fall.js'

const _pos = new THREE.Vector3()
const _look = new THREE.Vector3()

const PORTRAIT_PULLBACK = 1.1 // at 390×844 the camera stands ~1.6× farther from the splash

const same = (a, b) => a.every((v, i) => v === b[i])

export default function CameraRig() {
  const { posCurve, lookCurve, holds } = useMemo(() => {
    const curve = (key) =>
      new THREE.CatmullRomCurve3(CAMERA_KEYS.map((k) => new THREE.Vector3(...k[key])), false, 'centripetal')
    // Segment i is a hold when keys i and i+1 are identical: a spline would loop there, so it is skipped.
    const holds = CAMERA_KEYS.map((k, i) => i < CAMERA_KEYS.length - 1 && same(k.pos, CAMERA_KEYS[i + 1].pos) && same(k.look, CAMERA_KEYS[i + 1].look))
    return { posCurve: curve('pos'), lookCurve: curve('look'), holds }
  }, [])

  useFrame(({ camera }) => {
    const seg = Math.min(Math.floor(rig.pathT), CAMERA_KEYS.length - 1)
    if (holds[seg]) {
      _pos.set(...CAMERA_KEYS[seg].pos)
      _look.set(...CAMERA_KEYS[seg].look)
    } else {
      // getPoint (not getPointAt) is parameterised per control point, so key i sits at i / (keys - 1).
      const u = rig.pathT / (CAMERA_KEYS.length - 1)
      posCurve.getPoint(u, _pos)
      lookCurve.getPoint(u, _look)
    }
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
  })

  return null
}
