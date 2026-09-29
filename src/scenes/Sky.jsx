import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import envChunk from '../shaders/env.glsl?raw'
import { envUniforms, loadBackdrop } from '../content/backdrop.js'

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // sphere centered on the camera: local position is the view direction
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // depth = 1: always behind everything
}`

const fragmentShader = /* glsl */ `
${envChunk}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(envSoft(normalize(vDir)), 1.0);
}`

// The world at infinity: the backdrop photograph (BACKDROP in config.js), out of focus. Follows the
// camera. Starts the backdrop's download and upload; the loader's "enter" waits for it.
export default function Sky() {
  const ref = useRef()
  const gl = useThree((s) => s.gl)
  useEffect(() => void loadBackdrop(gl), [gl])
  useFrame(({ camera }) => ref.current.position.copy(camera.position))

  // Built by hand so the uniforms stay the shared envUniforms (see Rain.jsx).
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...envUniforms }, side: THREE.BackSide, depthWrite: false }),
    []
  )

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false} material={material}>
      <sphereGeometry args={[100, 48, 24]} />
    </mesh>
  )
}
