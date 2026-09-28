import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RAIN } from '../config.js'
import { globalUniforms } from '../core/uniforms.js'
import vertexShader from '../shaders/rain.vert.glsl?raw'
import fragmentShader from '../shaders/rain.frag.glsl?raw'

// Beats 2–3 placeholder: falling points that freeze when uTimeScale reaches 0.
export default function Rain() {
  const dpr = useThree((s) => s.viewport.dpr)

  const geometry = useMemo(() => {
    const { count, boxMin, boxSize, speed } = RAIN
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = boxMin[0] + Math.random() * boxSize[0]
      positions[i * 3 + 1] = boxMin[1] + Math.random() * boxSize[1]
      positions[i * 3 + 2] = boxMin[2] + Math.random() * boxSize[2]
      speeds[i] = speed[0] + Math.random() * (speed[1] - speed[0])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    return g
  }, [])

  const uniforms = useMemo(
    () => ({
      uSimTime: globalUniforms.uSimTime,
      uSize: { value: RAIN.size },
      uPixelRatio: { value: 1 },
      uBoxMin: { value: new THREE.Vector3(...RAIN.boxMin) },
      uBoxSize: { value: new THREE.Vector3(...RAIN.boxSize) },
      uColor: { value: new THREE.Color('#b8c6d6') },
    }),
    []
  )
  uniforms.uPixelRatio.value = dpr

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  )
}
