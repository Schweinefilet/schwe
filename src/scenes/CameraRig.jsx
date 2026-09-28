import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CAMERA_KEYS } from '../config.js'
import { rig } from '../core/rig.js'

const _pos = new THREE.Vector3()
const _look = new THREE.Vector3()

export default function CameraRig() {
  const { posCurve, lookCurve } = useMemo(() => {
    const curve = (key) =>
      new THREE.CatmullRomCurve3(CAMERA_KEYS.map((k) => new THREE.Vector3(...k[key])), false, 'centripetal')
    return { posCurve: curve('pos'), lookCurve: curve('look') }
  }, [])

  useFrame(({ camera }) => {
    // getPoint (not getPointAt) is parameterised per control point, so key i sits at i / (keys - 1).
    const u = rig.pathT / (CAMERA_KEYS.length - 1)
    posCurve.getPoint(u, _pos)
    lookCurve.getPoint(u, _look)
    camera.position.copy(_pos)
    camera.lookAt(_look)
  })

  return null
}
