import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RAIN } from '../config.js'
import { quality } from '../core/quality.js'
import { globalUniforms } from '../core/uniforms.js'
import envChunk from '../shaders/env.glsl?raw'
import vertexShader from '../shaders/rain.vert.glsl?raw'
import rainFrag from '../shaders/rain.frag.glsl?raw'

const fragmentShader = `${envChunk}\n${rainFrag}`
const _forward = new THREE.Vector3()
const _size = new THREE.Vector2()

// Beats 2–4: the rain field. One instanced draw call for every drop.
export default function Rain() {
  const geometry = useMemo(() => {
    const count = quality.rainCount
    const { boxSize, speed, radius } = RAIN
    const offsets = new Float32Array(count * 3)
    const params = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      offsets[i * 3 + 0] = (Math.random() - 0.5) * boxSize[0]
      offsets[i * 3 + 1] = (Math.random() - 0.5) * boxSize[1]
      offsets[i * 3 + 2] = (Math.random() - 0.5) * boxSize[2]
      // Bigger drops fall faster; most drops are small (squared random skews toward the minimum).
      const s = Math.random() ** 2
      params[i * 4 + 0] = speed[0] + s * (speed[1] - speed[0]) + Math.random() * 1.5
      params[i * 4 + 1] = radius[0] + s * (radius[1] - radius[0])
      params[i * 4 + 2] = 0.55 + Math.random() * 0.45
      params[i * 4 + 3] = Math.random()
    }
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4))
    g.instanceCount = count
    g.userData.maxCount = count
    return g
  }, [])

  // Built by hand, not as <shaderMaterial uniforms={…}>: R3F copies a uniforms prop into a new object,
  // which would cut the link to the shared globalUniforms and leave uTimeScale stuck at 1.
  const material = useMemo(() => {
    const uniforms = {
      uSimTime: globalUniforms.uSimTime,
      uTimeScale: globalUniforms.uTimeScale,
      uShutter: { value: RAIN.shutter },
      uWind: { value: new THREE.Vector2(...RAIN.wind) },
      uBoxCenter: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(...RAIN.boxSize) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFogDensity: { value: RAIN.fogDensity },
      uLensGain: { value: RAIN.lensGain },
      uReflGain: { value: RAIN.reflGain },
      uSpec: { value: RAIN.spec },
      uStreakColor: { value: new THREE.Color(...RAIN.streakColor) },
    }
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [])
  const { uniforms } = material

  useFrame(({ camera, gl }) => {
    // Center the repeating box ahead of the camera so few drops are wasted behind it.
    camera.getWorldDirection(_forward)
    uniforms.uBoxCenter.value.copy(camera.position).addScaledVector(_forward, RAIN.boxSize[2] * RAIN.boxLead)
    gl.getDrawingBufferSize(_size)
    uniforms.uResolution.value.copy(_size)
    geometry.instanceCount = Math.min(geometry.userData.maxCount, quality.rainCount) // follows a live tier drop
  })

  return (
    <mesh geometry={geometry} material={material} frustumCulled={false} />
  )
}
