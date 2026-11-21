import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { buildingMaterial, floorMaterial, plasterUniforms, plinthMaterial } from './plaster.js'
import { buildingTops, obstructionLights, splitByFlags } from './newYork.js'

// One city: its buildings (public/models/<city>.glb), the plinth they stand on with water inlaid, and the
// patch of studio floor under it.

export const PLINTH_DEPTH = 130 // the slab's thickness in the model's metres: about 3 cm at 1:5000

export default function Maquette({ city, onReady }) {
  const { scene } = useGLTF(city.glb, false, true)
  const map = useLoader(THREE.TextureLoader, city.ground)
  const mesh = useRef()
  const frames = useRef(0)

  // The file's one mesh, kept under its own node: its positions are quantized, and the node's transform
  // is what turns them back into metres.
  const { model, lights } = useMemo(() => {
    const buildings = buildingMaterial(city.id, city.offset)
    let lights = null
    scene.traverse((o) => {
      if (!o.isMesh) return
      // GLTFLoader names COLOR_0 `color`; ours is baked occlusion and a seed, not a colour.
      const g = o.geometry
      if (g.getAttribute('color')) {
        g.setAttribute('bake', g.getAttribute('color'))
        g.deleteAttribute('color')
      }
      // New York's night needs each building's height (newYork.js), and its tall roofs carry lights.
      if (city.id === 'new-york') {
        if (!g.userData.peaks) {
          o.updateWorldMatrix(true, false)
          const { tops, kinds, peaks } = buildingTops(g, o.matrixWorld)
          g.setAttribute('top', new THREE.BufferAttribute(tops, 2))
          g.setAttribute('kind', new THREE.BufferAttribute(kinds, 4, true))
          g.userData.peaks = peaks
          splitByFlags(g)
        }
        lights = obstructionLights(g.userData.peaks, plasterUniforms)
      }
      // New York's mesh is two groups (splitByFlags): the plain city, then the solids with the rarer lights.
      o.material = city.id === 'new-york' ? [buildingMaterial(city.id, city.offset, { plain: true }), buildings] : buildings
      o.castShadow = o.receiveShadow = true
      o.frustumCulled = false
      mesh.current = o
    })
    return { model: scene, lights }
  }, [scene, city])

  const { plinth, floor, radius } = useMemo(() => {
    map.flipY = false
    map.colorSpace = THREE.NoColorSpace
    map.generateMipmaps = true
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.anisotropy = 8
    map.needsUpdate = true
    const radius = Math.hypot(city.halfLength, city.halfWidth) * 3.2
    return { plinth: plinthMaterial(map, city, PLINTH_DEPTH), floor: floorMaterial(radius), radius }
  }, [map, city])

  useEffect(() => {
    onReady?.(city.id)
  }, [city.id, onReady])

  // Drawn unculled for its first frames, so the mesh is on the GPU before the camera first swings to it.
  useFrame(({ gl, camera, size }) => {
    if (lights) {
      const u = lights.material.uniforms
      u.uPx.value = gl.getPixelRatio()
      u.uScale.value = (camera.projectionMatrix.elements[5] * size.height * u.uPx.value) / 2
    }
    if (frames.current > 3) return
    frames.current++
    mesh.current.frustumCulled = frames.current > 3
  })

  const turn = Math.PI / 2 - (city.axisBearing * Math.PI) / 180
  return (
    <group position={city.offset}>
      <primitive object={model} />
      {lights && <primitive object={lights} />}
      <mesh rotation-y={turn} position-y={-PLINTH_DEPTH / 2} material={plinth} castShadow receiveShadow>
        <boxGeometry args={[city.halfLength * 2, PLINTH_DEPTH, city.halfWidth * 2]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-PLINTH_DEPTH} material={floor} receiveShadow>
        <circleGeometry args={[radius, 64]} />
      </mesh>
    </group>
  )
}
