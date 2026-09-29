import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import envChunk from '../shaders/env.glsl?raw'
import { envUniforms, loadBackdrop } from '../content/backdrop.js'
import { globalUniforms } from '../core/uniforms.js'
import { BACKDROP } from '../config.js'

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // sphere centered on the camera: local position is the view direction
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // depth = 1: always behind everything
}`

// Focused on the rain (uFocus 1) the backdrop is the soft copy. Focused far (0, the first shot) it is
// the sharp copy, its lamps held to the soft copy's range so they do not flare in the bloom; in between
// the sharp copy blurs through its mip levels (the blur grows with uFocus) and hands over to the soft
// one's round bokeh.
const fragmentShader = /* glsl */ `
${envChunk}
uniform float uFocus;
uniform float uBokeh; // the soft copy's blur radius, radians
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float pixel = length(fwidth(d)); // outside the branch: derivatives need every pixel
  vec3 soft = envSoft(d);
  if (uFocus >= 1.0) {
    gl_FragColor = vec4(soft, 1.0);
    return;
  }
  vec3 softMax = vec3(uEnvCodecSoft.y * (exp2(uEnvCodecSoft.x) - 1.0));
  vec3 sharp = min(envColor(d, max(pixel, 2.0 * uFocus * uBokeh)), softMax);
  gl_FragColor = vec4(mix(sharp, soft, smoothstep(0.35, 1.0, uFocus)), 1.0);
}`

// The world at infinity: the backdrop photograph (BACKDROP in config.js), out of focus except in the
// first shot. Follows the camera. Starts the backdrop's download and upload; the loader's "enter"
// waits for it.
export default function Sky() {
  const ref = useRef()
  const gl = useThree((s) => s.gl)
  useEffect(() => void loadBackdrop(gl), [gl])
  useFrame(({ camera }) => ref.current.position.copy(camera.position))

  // Built by hand so the uniforms stay the shared envUniforms (see Rain.jsx).
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { ...envUniforms, uFocus: globalUniforms.uFocus, uBokeh: { value: THREE.MathUtils.degToRad(BACKDROP.bokeh) } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  )

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false} material={material}>
      <sphereGeometry args={[100, 48, 24]} />
    </mesh>
  )
}
