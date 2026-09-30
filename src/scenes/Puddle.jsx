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
import surfaceChunk from '../shaders/surface.glsl?raw'
import { surfaceUniforms } from './waves/surface.js'

// The water is a projected grid: a grid over the screen, each vertex cast along its view ray onto the
// ground and lifted by the live surface (waves/WaveSim.js), so its detail follows the screen: dense up
// close, where craters and ripples have real depth, and never wasted on the distance.
const GRID = [640, 400]
const FAR = 400 // world units: rays that miss the ground land here, at the horizon

const vertexShader = /* glsl */ `
${surfaceChunk}
uniform mat4 uInvViewProj;
uniform float uGroundY;
varying vec3 vWorld;
void main() {
  vec4 a = uInvViewProj * vec4(position.xy, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(position.xy, 1.0, 1.0);
  a /= a.w;
  b /= b.w;
  vec3 dir = normalize(b.xyz - a.xyz);
  vec3 o = cameraPosition;
  vec2 xz;
  if (dir.y < -1e-5) {
    float t = min((uGroundY - o.y) / dir.y, ${FAR.toFixed(1)});
    xz = o.xz + dir.xz * t;
  } else {
    xz = o.xz + normalize(dir.xz + vec2(1e-6)) * ${FAR.toFixed(1)};
  }
  float dist = length(xz - o.xz);
  // The surface lifts the grid near the camera; far away it would only alias, and only the normals
  // (below) carry it.
  float h = surfaceAt(xz).x * uFieldWorld * (1.0 - smoothstep(5.0, 10.0, dist));
  vWorld = vec3(xz.x, uGroundY + h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`

// Rings spread from the hero drop's impact point. Each ring is a travelling wave packet: a sine under a
// Gaussian envelope moving outward at speed c, fading as it spreads. Only the slope is needed (for the
// normal), so the height itself is never computed. They are scroll-driven, like the hero's splash; the
// rain's rings come from the live surface and add to them (small waves add).
const fragmentShader = /* glsl */ `
${envChunk}
${waterChunk}
${surfaceChunk}
uniform vec2 uCenter;
uniform float uTime;       // seconds since the rings started (scroll-driven, can run backward)
uniform float uRingFade;
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
  vec2 grad = slope * uRingFade * d / r;

  // The live surface. Where a pixel covers several of its cells, the ripples in it average out:
  // their slopes fade toward the distance instead of turning into noise.
  vec3 s = surfaceAt(vWorld.xz);
  float cell = uFieldTile / uFieldSize;
  float foot = length(fwidth(vWorld.xz));
  // Far from where the lens is focused (the splashes near the camera), the water is out of focus, as
  // the square behind it is: its ripples blur into broad streaks of reflected light.
  float dist = length(vWorld.xz - cameraPosition.xz);
  float focus = mix(1.0, 0.3, smoothstep(2.5, 9.0, dist));
  grad += s.yz * clamp(1.5 * cell / max(foot, 1e-6), 0.1, 1.0) * focus;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 v = normalize(vWorld - cameraPosition);
  vec3 col = shadeWater(v, n);
  float fog = exp(-length(vWorld - cameraPosition) * uFogDensity);
  // A puddle, not a floor: it thins out into the dark far from the impact.
  float extent = 1.0 - smoothstep(9.0, 26.0, r);
  gl_FragColor = vec4(col * fog, extent * uOpacity);
}`

function gridGeometry([nx, ny]) {
  const margin = 1.08 // past the screen's edges, so the lifted grid never pulls in from them
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3)
  for (let j = 0, k = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++, k += 3) {
      pos[k] = (i / nx) * 2 * margin - margin
      pos[k + 1] = (j / ny) * 2 * margin - margin
    }
  const index = new Uint32Array(nx * ny * 6)
  for (let j = 0, k = 0; j < ny; j++)
    for (let i = 0; i < nx; i++, k += 6) {
      const a = j * (nx + 1) + i
      index.set([a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1], k)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  return g
}

// The wet ground under the fall. The rest of the frame is dark water fading into the night.
export default function Puddle() {
  const geometry = useMemo(() => gridGeometry(GRID), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...envUniforms,
          ...surfaceUniforms,
          uInvViewProj: { value: new THREE.Matrix4() },
          uGroundY: { value: SPLASH.groundY - 0.0005 },
          uCenter: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uRingFade: { value: 1 },
          uFogDensity: { value: 0.08 },
          uOpacity: { value: 0 },
          uReflGain: { value: WATER.reflGain },
          uDeep: { value: new THREE.Color(...WATER.deep) },
          uTransGain: { value: 0 },
        },
        transparent: true,
        // Writes depth so the underside of the baked craters never shows through the water.
      }),
    []
  )
  const mesh = useRef()

  // Compiled while the loader is up, not on the frame the camera first turns down to the water.
  const { gl, camera, scene } = useThree()
  useEffect(() => prewarm(gl, mesh.current, camera, scene), [gl, camera, scene])

  useEffect(() => {
    // The grid is cast from the camera that draws it, with its matrices as they are at that moment.
    mesh.current.onBeforeRender = (_r, _s, cam) => {
      material.uniforms.uInvViewProj.value.copy(cam.matrixWorld).multiply(cam.projectionMatrixInverse)
    }
  }, [material])

  useFrame(() => {
    material.uniforms.uCenter.value.set(fall.impact.x, fall.impact.z)
    material.uniforms.uTime.value = rig.ring * SPLASH.ringSeconds
    // The hero's rings give way to the rain's as they spread.
    material.uniforms.uRingFade.value = 1 - THREE.MathUtils.smoothstep(rig.ring, 0.35, 0.9)
    // Only part of beat 7: it appears as the camera turns down toward it.
    material.uniforms.uOpacity.value = rig.follow
    mesh.current.visible = rig.follow > 0
  })

  return <mesh ref={mesh} renderOrder={-0.5} material={material} geometry={geometry} frustumCulled={false} />
}
