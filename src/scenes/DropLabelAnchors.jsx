import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DIVE, HERO } from '../config.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { overlay } from '../ui/overlay.js'

const GAP = 14 // px between the drop's edge and its label
const RISE = 8 // px the label settles by as it fades in
const _p = new THREE.Vector3()
const _view = new THREE.Vector3()
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Places each drop's label (ui/DropLabels.jsx) beside it on screen, on the side toward the middle of
// the screen, so it stays in view while the drop slides outward on a pass. It shows as the drop's city
// does (HERO.near, the fade the shader uses) and gives way to the corner type inside the dive; the dive
// drop's label does not return on the way out, since the corner type has just named its city.
export default function DropLabelAnchors({ drops }) {
  useFrame(({ camera, size }) => {
    const focal = size.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    for (const drop of drops) {
      const el = overlay.labels.get(drop.city)
      if (!el) continue
      _p.fromArray(drop.pos)
      const dist = _p.distanceTo(camera.position)
      let a = (1 - smoothstep(HERO.near[0], HERO.near[1], dist)) * (1 - rig.dive)
      if (drop.dive && state.time > DIVE.outStart) a = 0
      if (_view.copy(_p).applyMatrix4(camera.matrixWorldInverse).z >= 0) a = 0 // behind the camera
      _p.project(camera)
      if (Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2) a = 0
      if (a < 0.002) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      const x = ((_p.x + 1) / 2) * size.width
      const y = ((1 - _p.y) / 2) * size.height
      const r = (HERO.radius / Math.sqrt(Math.max(dist * dist - HERO.radius ** 2, 1e-6))) * focal // a sphere's true angular size, close up too
      const toLeft = x > size.width / 2
      el.style.visibility = 'visible'
      el.style.opacity = a
      el.style.textAlign = toLeft ? 'right' : 'left'
      el.style.transform = `translate3d(${toLeft ? x - r - GAP : x + r + GAP}px, ${y + (1 - a) * RISE}px, 0) translate(${toLeft ? '-100%' : '0'}, -50%)`
    }
  })
  return null
}
