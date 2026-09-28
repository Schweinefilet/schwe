import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { PUDDLE } from '../config.js'
import { rig } from '../core/rig.js'

const [px, py, pz] = PUDDLE.pos

// Beat 7 placeholder: a flat puddle, one falling drop, one expanding ring.
export default function Puddle() {
  const drop = useRef()
  const ring = useRef()

  useFrame(() => {
    drop.current.position.y = py + rig.dropY
    drop.current.visible = rig.dropY > 0.02
    ring.current.visible = rig.ring > 0
    ring.current.scale.setScalar(0.05 + rig.ring * 3.5)
    ring.current.material.opacity = (1 - rig.ring) * 0.8
  })

  return (
    <group>
      <mesh position={PUDDLE.pos} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[PUDDLE.size, PUDDLE.size]} />
        <meshBasicMaterial color="#15181c" />
      </mesh>
      <mesh ref={drop} position={[px, py + PUDDLE.dropStartY, pz]}>
        <sphereGeometry args={[0.12, 24, 12]} />
        <meshBasicMaterial color="#cfd8e3" />
      </mesh>
      <mesh ref={ring} position={[px, py + 0.01, pz]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1, 96]} />
        <meshBasicMaterial color="#cfd8e3" transparent depthWrite={false} />
      </mesh>
    </group>
  )
}
