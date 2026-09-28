import { useMemo } from 'react'
import * as THREE from 'three'
import { CITIES, HERO_DROPS, HERO_RADIUS } from '../config.js'

const colorOf = Object.fromEntries(CITIES.map((c) => [c.id, c.color]))

// Beats 4–5 placeholder: plain spheres tinted with their city's placeholder colour.
// DoubleSide so the colour fills the screen when the camera is inside the dive drop.
export default function HeroDrops() {
  const geometry = useMemo(() => new THREE.SphereGeometry(HERO_RADIUS, 32, 16), [])

  return HERO_DROPS.map((drop, i) => (
    <mesh key={i} position={drop.pos} geometry={geometry}>
      <meshBasicMaterial color={colorOf[drop.city]} side={THREE.DoubleSide} />
    </mesh>
  ))
}
