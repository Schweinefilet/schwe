import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import envChunk from '../shaders/env.glsl?raw'

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
  gl_FragColor = vec4(envColor(normalize(vDir)), 1.0);
}`

// The environment at infinity: dark sky, warm street glow far below. Follows the camera.
export default function Sky() {
  const ref = useRef()
  useFrame(({ camera }) => ref.current.position.copy(camera.position))

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[100, 48, 24]} />
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  )
}
