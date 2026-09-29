import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPLASH, WATER } from '../config.js'
import { rig } from '../core/rig.js'
import { fall } from '../core/fall.js'
import { prewarm } from '../core/prewarm.js'
import envChunk from '../shaders/env.glsl?raw'
import { envUniforms } from '../content/backdrop.js'
import waterChunk from '../shaders/water.glsl?raw'

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

// Rings spread from the impact point. Each ring is a travelling wave packet: a sine under a
// Gaussian envelope moving outward at speed c, fading as it spreads. Only the slope is needed
// (for the normal), so the height itself is never computed.
const fragmentShader = /* glsl */ `
${envChunk}
${waterChunk}
uniform vec2 uCenter;
uniform float uTime;       // seconds since the rings started (scroll-driven, can run backward)
uniform float uFogDensity;
uniform float uOpacity;
varying vec3 vWorld;

float ringSlope(float r, float t, float delay, float amp) {
  float tt = t - delay;
  if (tt <= 0.0) return 0.0;
  float front = 0.35 * tt;                      // wave speed, world units per second
  float x = r - front;
  float envelope = exp(-x * x / 0.004) * amp / (1.0 + 6.0 * front);
  return 60.0 * cos(60.0 * x) * envelope;       // d/dr of sin(60 x) × envelope (envelope slope ignored)
}

void main() {
  vec2 d = vWorld.xz - uCenter;
  float r = max(length(d), 1e-4);
  float slope = ringSlope(r, uTime, 0.0, 0.004) + ringSlope(r, uTime, 0.35, 0.0025) + ringSlope(r, uTime, 0.75, 0.0015);
  vec2 grad = slope * d / r;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 v = normalize(vWorld - cameraPosition);
  vec3 col = shadeWater(v, n);
  float fog = exp(-length(vWorld - cameraPosition) * uFogDensity);
  // A puddle, not a floor: it thins out a few units from the impact.
  float extent = 1.0 - smoothstep(2.5, 7.0, r);
  gl_FragColor = vec4(col * fog, extent * uOpacity);
}`

const RING_SECONDS = 4 // ring time covered by the ripple beat

// The wet ground under the fall. The rest of the frame is dark water fading into the night.
export default function Puddle() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...envUniforms,
          uCenter: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uFogDensity: { value: 0.08 },
          uOpacity: { value: 0 },
          uReflGain: { value: WATER.reflGain },
          uDeep: { value: new THREE.Color(...WATER.deep) },
          uTransGain: { value: 0 },
        },
        transparent: true,
        // Writes depth so the underside of the baked crater never shows through the water.
      }),
    []
  )
  const mesh = useRef()

  // Compiled while the loader is up, not on the frame the camera first turns down to the water.
  const { gl, camera, scene } = useThree()
  useEffect(() => prewarm(gl, mesh.current, camera, scene), [gl, camera, scene])

  useFrame(() => {
    material.uniforms.uCenter.value.set(fall.impact.x, fall.impact.z)
    material.uniforms.uTime.value = rig.ring * RING_SECONDS
    // Only part of beat 7: it appears as the camera turns down toward it.
    material.uniforms.uOpacity.value = rig.follow
    mesh.current.visible = rig.follow > 0
  })

  return (
    <mesh ref={mesh} renderOrder={-0.5} material={material} position={[fall.impact.x, SPLASH.groundY - 0.0005, fall.impact.z]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[SPLASH.puddleSize, SPLASH.puddleSize]} />
    </mesh>
  )
}
