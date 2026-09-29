import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ALIGN, RAIN, SPLASH } from '../config.js'
import { quality } from '../core/quality.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { setFallStart } from '../core/fall.js'
import { globalUniforms } from '../core/uniforms.js'
import { envUniforms } from '../content/backdrop.js'
import { sampleWord } from '../content/wordPoints.js'
import { overlay } from '../ui/overlay.js'
import { outlinePath } from '../ui/WordOutline.jsx'
import envChunk from '../shaders/env.glsl?raw'
import vertexShader from '../shaders/align.vert.glsl?raw'
import rainFrag from '../shaders/rain.frag.glsl?raw'

const _size = new THREE.Vector2()
const _o = new THREE.Vector3()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
// Mean distance of the word's drops from the eye (density along each sight line ∝ depth^depthPower).
const MEAN_DEPTH = (() => {
  const [a, b] = ALIGN.depth
  const k = ALIGN.depthPower + 1
  return ((k / (k + 1)) * (b ** (k + 1) - a ** (k + 1))) / (b ** k - a ** k)
})()

// Beat 6: anamorphic alignment. Each sampled point of the word becomes a ray from the eye; a drop
// sits at a random depth along it, near to far. From the eye every drop lands on its letter; from
// anywhere else they are frozen rain. Radii stay within the rain's own range: up to where that allows,
// they grow with depth so strokes read evenly from the eye; beyond, drops shrink with distance like
// any other rain.
export default function AlignmentWord() {
  const aspect = useThree((s) => Math.round((s.size.width / s.size.height) * 20) / 20) // rebuild on real shape changes only
  const [word, setWord] = useState(null)

  useEffect(() => {
    let cancelled = false
    sampleWord(ALIGN.text, ALIGN.count[quality.name]).then((w) => !cancelled && setWord(w))
    return () => {
      cancelled = true
    }
  }, [])

  const geometry = useMemo(() => {
    if (!word) return null
    const eye = new THREE.Vector3(...ALIGN.eye)
    const forward = new THREE.Vector3(...ALIGN.target).sub(eye).normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward)

    // Word size in tan-of-angle units at the eye: a share of the screen width, but never taller than
    // a share of its height. Recomputed for the screen's aspect, so it fits portrait phones too.
    const tanY = Math.tan(THREE.MathUtils.degToRad(ALIGN.fov / 2))
    const tanX = tanY * aspect
    const halfW = Math.min(ALIGN.widthFrac * tanX, ALIGN.maxHeightFrac * tanY * word.aspect)
    // Beads shrink with the word (portrait phones), so letters keep the same texture at any size.
    const beadAngle = ALIGN.beadAngle * Math.min(1, halfW / (ALIGN.widthFrac * tanY * (16 / 9)))

    // The drop that will fall in beat 7: the sample nearest the lower middle of the word, placed at a
    // fixed depth and drawn at the falling drop's size, so the hand-off to it is exact.
    let fallIndex = 0
    let best = Infinity
    for (let i = 0; i < word.points.length / 2; i++) {
      const dx = word.points[i * 2]
      const dy = word.points[i * 2 + 1] + 0.12
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy
        fallIndex = i
      }
    }

    let s = 7
    const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
    const n = word.points.length / 2
    const offsets = new Float32Array(n * 3)
    const params = new Float32Array(n * 4)
    const dir = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const x = word.points[i * 2] * halfW
      const y = word.points[i * 2 + 1] * halfW
      dir.copy(forward).addScaledVector(right, x).addScaledVector(up, y).normalize()
      // Depth with density along the ray ∝ t^depthPower (inverse-CDF sampling).
      const k = ALIGN.depthPower + 1
      const [a, b] = ALIGN.depth
      let t = (a ** k + rand() * (b ** k - a ** k)) ** (1 / k)
      let radius = THREE.MathUtils.clamp(beadAngle * t * (0.8 + rand() * 0.4), RAIN.radius[0], RAIN.radius[1])
      if (i === fallIndex) {
        t = ALIGN.fallDepth
        radius = SPLASH.fallRadius
      }
      offsets.set([eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t], i * 3)
      params[i * 4 + 0] = radius
      params[i * 4 + 1] = 0.55 + rand() * 0.45 // the rain's streak brightness range (unused: frozen)
    }
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4))
    g.instanceCount = n
    setFallStart(new THREE.Vector3(offsets[fallIndex * 3], offsets[fallIndex * 3 + 1], offsets[fallIndex * 3 + 2]))
    g.userData.fallIndex = fallIndex
    g.userData.fallRadius = params[fallIndex * 4]
    g.userData.frame = { eye, forward, right, up, halfW }
    return g
  }, [word, aspect])

  useEffect(() => () => geometry?.dispose(), [geometry])

  // The outline's loop fits this word's shape.
  useEffect(() => {
    if (word) overlay.outline?.querySelectorAll('path').forEach((p) => p.setAttribute('d', outlinePath(word.aspect)))
  }, [word])
  const outline = useRef({ last: 0, still: 0, progress: 0 })

  // Same bead shading as frozen rain; built by hand so uniforms stay shared (see Rain.jsx).
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: `${envChunk}\n${rainFrag}`,
        uniforms: {
          ...envUniforms,
          uResolution: { value: new THREE.Vector2(1, 1) },
          uFogDensity: { value: RAIN.fogDensity },
          uBoxCenter: globalUniforms.uBoxCenter,
          uBoxSize: { value: new THREE.Vector3(...RAIN.boxSize) },
          uVisible: { value: new THREE.Vector2(...ALIGN.visibleWithin) },
          uLensGain: { value: RAIN.lensGain },
          uReflGain: { value: RAIN.reflGain },
          uSpec: { value: RAIN.spec },
          uStreakColor: { value: new THREE.Color(...RAIN.streakColor) },
        },
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    []
  )

  useFrame(({ gl, camera, size }, dt) => {
    gl.getDrawingBufferSize(_size)
    material.uniforms.uResolution.value.copy(_size)
    if (geometry) placeOutline(outline.current, geometry.userData.frame, camera, size, dt)
    // Once the drop starts to fall, its bead leaves the word (Splash draws the moving drop).
    if (geometry) {
      const attr = geometry.getAttribute('aParams')
      const i = geometry.userData.fallIndex
      const r = rig.fall > 0 ? 0 : geometry.userData.fallRadius
      if (attr.getX(i) !== r) {
        attr.setX(i, r)
        attr.needsUpdate = true
      }
    }
  })

  if (!geometry) return null
  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

// The word's outline (ui/WordOutline.jsx). Once the camera has stayed within ALIGN.outline.window of
// the eye for `dwell` seconds, a loop draws around the word; it fades as the camera moves off and is
// drawn afresh on the next stay. It lies on the plane at the drops' mean depth, so from the eye it
// frames the word exactly, and just off the eye it moves with the drops.
function placeOutline(run, frame, camera, size, dt) {
  const svg = overlay.outline
  if (!svg) return
  const O = ALIGN.outline
  const near = 1 - smoothstep(O.window * 0.5, O.window, Math.abs(state.time - ALIGN.arrive))
  run.still = Math.abs(state.time - run.last) < 1e-5 ? run.still + dt : 0
  run.last = state.time
  if (near <= 0) run.progress = 0
  else if (run.progress > 0 || run.still >= O.dwell) run.progress = Math.min(1, run.progress + dt / O.drawSeconds)
  const alpha = near * Math.min(1, run.progress * 5)
  if (alpha < 0.002) {
    if (svg.style.visibility !== 'hidden') svg.style.visibility = 'hidden'
    return
  }
  // Screen positions of the word's centre and of one unit along its x and y: an affine map from the
  // loop's units to CSS px.
  const toScreen = (v, x, y) => {
    const { eye, forward, right, up, halfW } = frame
    v.copy(eye).addScaledVector(forward, MEAN_DEPTH).addScaledVector(right, MEAN_DEPTH * halfW * x).addScaledVector(up, MEAN_DEPTH * halfW * y).project(camera)
    return v.set(((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height, v.z)
  }
  toScreen(_o, 0, 0)
  toScreen(_x, 1, 0)
  toScreen(_y, 0, 1)
  const a = _x.x - _o.x
  const b = _x.y - _o.y
  const scale = Math.hypot(a, b)
  const matrix = `matrix(${a} ${b} ${_y.x - _o.x} ${_y.y - _o.y} ${_o.x} ${_o.y})`
  const drawn = 0.5 - 0.5 * Math.cos(Math.PI * run.progress) // eases in and out
  for (const path of svg.querySelectorAll('path')) {
    path.setAttribute('transform', matrix)
    path.style.strokeDashoffset = 1 - drawn
    path.style.strokeWidth = (path.classList.contains('word-outline__line') ? O.stroke : O.glow) / scale
  }
  svg.style.visibility = 'visible'
  svg.style.opacity = alpha
}
