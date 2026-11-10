import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Rain and snow over one model: streaks and flakes falling through the air above its plinth, as if the
// weather were scaled down with the city. One draw call each; neither is drawn when there is none.
// `look` is the scene's current look (look.js): rain and snow 0..1, lean, night.

const HEIGHT = 1200 // metres of air above the plinth that the weather falls through

const VERT = /* glsl */ `
  attribute vec4 seed; // xyz: a place in the box, w: 0 at a streak's foot, 1 at its head
  uniform float uTime;
  uniform float uAmount;
  uniform float uFall; // box heights a second
  uniform float uLength;
  uniform float uSway;
  uniform float uSize;
  uniform vec2 uLean;
  uniform vec3 uBox;
  varying float vFade;
  void main() {
    float order = fract(seed.x * 7.13 + seed.z * 3.71);
    float speed = uFall * (0.8 + 0.4 * fract(seed.x * 51.7));
    float t = fract(seed.y + uTime * speed);
    float y = (1.0 - t) * uBox.y;
    vec3 p = vec3((seed.x * 2.0 - 1.0) * uBox.x, y, (seed.z * 2.0 - 1.0) * uBox.z);
    // The fall leans with the wind: farther downwind the lower it is.
    p.xz += uLean * (uBox.y - y);
    p.xz += uSway * vec2(sin(uTime * 0.9 + seed.x * 40.0), cos(uTime * 0.7 + seed.z * 40.0));
    p += seed.w * uLength * normalize(vec3(-uLean.x, 1.0, -uLean.y));
    vFade = step(order, uAmount) * smoothstep(0.0, 0.06, t) * (0.5 + 0.5 * fract(seed.z * 91.3));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + 0.8 * fract(seed.y * 33.1));
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uRound;
  varying float vFade;
  void main() {
    float a = uAlpha * vFade;
    if (uRound > 0.5) a *= smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

function seeds(count, perDrop) {
  const a = new Float32Array(count * perDrop * 4)
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random()]
    for (let k = 0; k < perDrop; k++) a.set([...s, k], (i * perDrop + k) * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('seed', new THREE.BufferAttribute(a, 4))
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * perDrop * 3), 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, HEIGHT / 2, 0), 1e5)
  return g
}

const material = (uniforms) =>
  new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uLean: { value: new THREE.Vector2() },
      uBox: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
      uSway: { value: 0 },
      uSize: { value: 1 },
      ...uniforms,
    },
  })

export default function Precip({ city, look, count }) {
  const rain = useRef()
  const snow = useRef()
  const parts = useMemo(
    () => ({
      rainGeo: seeds(count, 2),
      snowGeo: seeds(Math.round(count * 0.7), 1),
      rainMat: material({ uFall: { value: 0.75 }, uLength: { value: 60 }, uRound: { value: 0 } }),
      snowMat: material({ uFall: { value: 0.07 }, uLength: { value: 0 }, uRound: { value: 1 } }),
    }),
    [count]
  )
  // The plinth's frame: x along its axis, z across (as the plinth's own slab is turned).
  const turn = Math.PI / 2 - (city.axisBearing * Math.PI) / 180
  const sin = Math.sin((city.axisBearing * Math.PI) / 180)
  const cos = Math.cos((city.axisBearing * Math.PI) / 180)

  useFrame(({ clock, gl }) => {
    const l = look.current
    const dpr = gl.getPixelRatio()
    for (const [ref, amount, day, night, alpha, sway, size] of [
      [rain, l.rain, [0.4, 0.44, 0.5], [0.7, 0.76, 0.88], 0.36, 0, 1],
      [snow, l.snow, [1, 1, 1], [0.86, 0.89, 0.95], 0.95, 26, 2.6 * dpr],
    ]) {
      const m = ref.current
      m.visible = amount > 0.01
      if (!m.visible) continue
      const u = m.material.uniforms
      u.uTime.value = clock.elapsedTime
      u.uAmount.value = amount
      u.uBox.value.set(city.halfLength * 1.05, HEIGHT, city.halfWidth * 1.05)
      // look.lean is (east, south) in the model's frame: turn it into the plinth's.
      const [e, s] = l.lean
      u.uLean.value.set(e * sin + -s * cos, e * cos - -s * sin)
      u.uColor.value.setRGB(...day).lerp(TMP.setRGB(...night), l.night)
      u.uAlpha.value = alpha
      u.uSway.value = sway
      u.uSize.value = size
    }
  })

  return (
    <group rotation-y={turn}>
      <lineSegments ref={rain} geometry={parts.rainGeo} material={parts.rainMat} visible={false} />
      <points ref={snow} geometry={parts.snowGeo} material={parts.snowMat} visible={false} />
    </group>
  )
}

const TMP = new THREE.Color()
