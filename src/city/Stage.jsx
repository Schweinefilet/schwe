import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { now } from '../core/clock.js'
import { CITIES, cityById } from './cities.js'
import { EXPOSURE, blendLook, copyLook, lookFor } from './look.js'
import Maquette, { PLINTH_DEPTH } from './Maquette.jsx'
import { plasterUniforms } from './plaster.js'
import Precip from './Precip.jsx'

// The studio: three plaster cities on a floor, one sun, one long lens. The lens rests on the selected
// city, drifting a few degrees either way; choosing another swings it there across bare floor while the
// light turns into the other city's.

const MOVE_S = 3.4 // a move between cities
const DRIFT = { bearing: 4.5, bearingS: 96, elevation: 0.5, elevationS: 61 }
const LIGHT_DISTANCE = 30000
const TALLEST = 620 // above every roof on the three models
const RAD = Math.PI / 180

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t

// Dev: ?cam=bearing,elevation,distance,fov[,east,up,north] replaces the selected city's view, for choosing one.
const CAM = import.meta.env.DEV ? new URLSearchParams(location.search).get('cam')?.split(',').map(Number) : null
// Dev: ?still stops the drift, so two screenshots of one view match.
const STILL = import.meta.env.DEV && new URLSearchParams(location.search).has('still')

// A city's view for a window of this shape, in world coordinates.
function viewOf(city, aspect) {
  const t = smooth(0.8, 1.45, aspect)
  const a = city.tall
  const b = city.wide
  let bearing = a.bearing + (((b.bearing - a.bearing + 540) % 360) - 180) * t
  let elevation = mix(a.elevation, b.elevation, t)
  // The wide view is composed for 16:9; a squarer window stands farther back to keep the model's width.
  let distance = mix(a.distance, b.distance, t) * Math.max(1, (16 / 9 / Math.max(aspect, 1.45)) ** 0.9) * (aspect < 0.8 ? Math.max(1, (0.5 / aspect) ** 0.7) : 1)
  let fov = mix(a.fov, b.fov, t)
  let at = a.at.map((v, i) => mix(v, b.at[i], t))
  if (CAM) [bearing, elevation, distance, fov, at] = [CAM[0], CAM[1], CAM[2], CAM[3], CAM.length > 6 ? CAM.slice(4, 7) : at]
  return { x: city.offset[0] + at[0], y: at[1], z: city.offset[2] - at[2], bearing, elevation, distance, fov }
}

function blendView(out, a, b, t) {
  for (const k of ['x', 'y', 'z', 'elevation', 'distance', 'fov']) out[k] = mix(a[k], b[k], t)
  out.bearing = a.bearing + (((b.bearing - a.bearing + 540) % 360) - 180) * t
  return out
}

function Rig({ cityId, weather, shadowSize, still, onTone }) {
  const { camera, gl, scene, size } = useThree()
  const sun = useRef()
  const fill = useRef()
  const fog = useMemo(() => new THREE.FogExp2('#ffffff', 0), [])
  const bg = useMemo(() => new THREE.Color(), [])
  const s = useRef(null)

  useEffect(() => {
    scene.background = bg
    scene.fog = fog
    gl.shadowMap.autoUpdate = false
    scene.add(sun.current.target)
  }, [scene, gl, bg, fog])

  // The look the scene shows, shared with the weather above the models.
  const look = useLook()
  useFrame((state, dt) => {
    const aspect = size.width / size.height
    const date = now()
    const city = cityById(cityId)
    if (!s.current) {
      const l = lookFor(city, date, weather?.[city.id])
      s.current = { to: city, p: 1, view: viewOf(city, aspect), fromView: null, fromLook: null, shadowCity: null, shadowDir: [0, 0, 0], target: l, at: 0 }
      blendLook(look.current, l, l, 1)
    }
    const st = s.current
    if (st.to !== city) {
      st.fromView = { ...st.view }
      st.fromLook = copyLook(look.current)
      st.to = city
      st.p = still ? 1 : 0 // reduced motion: no swing (App.jsx dips the picture out round the change)
      st.at = 0
    }
    // The destination's look: the sun moves a quarter of a degree a minute, so once a second is plenty.
    st.at -= dt
    if (st.at <= 0) {
      st.target = lookFor(city, date, weather?.[city.id])
      st.at = 1
    }
    const home = viewOf(city, aspect)
    if (st.p < 1) {
      st.p = Math.min(1, st.p + dt / MOVE_S)
      blendView(st.view, st.fromView, home, ease(st.p))
      blendLook(look.current, st.fromLook, st.target, smooth(0.15, 0.85, st.p))
    } else {
      Object.assign(st.view, home)
      blendLook(look.current, look.current, st.target, still && st.at === 1 && st.fromView ? 1 : 1 - Math.exp(-dt * 1.6))
      if (still) st.fromView = null
    }
    const l = look.current

    // Camera: on a sphere round the point it looks at, drifting slowly.
    const v = st.view
    const t = STILL || still ? 0 : state.clock.elapsedTime
    const bearing = (v.bearing + DRIFT.bearing * Math.sin((t * 2 * Math.PI) / DRIFT.bearingS)) * RAD
    const elevation = (v.elevation + DRIFT.elevation * Math.sin((t * 2 * Math.PI) / DRIFT.elevationS)) * RAD
    const flat = v.distance * Math.cos(elevation)
    camera.position.set(v.x - Math.sin(bearing) * flat, v.y + v.distance * Math.sin(elevation), v.z + Math.cos(bearing) * flat)
    camera.lookAt(v.x, v.y, v.z)
    if (camera.fov !== v.fov) {
      camera.fov = v.fov
      camera.updateProjectionMatrix()
    }

    // Light.
    sun.current.color.setRGB(...l.sunColor)
    sun.current.intensity = l.sunLight
    fill.current.color.setRGB(...l.sky)
    fill.current.groundColor.setRGB(...l.bounce)
    fill.current.intensity = l.skyLight
    bg.setRGB(...l.bg)
    gl.toneMappingExposure = l.exposure
    fog.color.copy(bg)
    fog.density = l.fog * 0.00012
    plasterUniforms.uBg.value.copy(bg)
    plasterUniforms.uNight.value = l.night
    plasterUniforms.uLit.value = l.lit
    plasterUniforms.uLate.value = l.late
    plasterUniforms.uWet.value = l.wet
    // The interface's tone follows what is behind it: ink over a light backdrop, white over a dark one.
    const lum = 0.2126 * l.bg[0] + 0.7152 * l.bg[1] + 0.0722 * l.bg[2]
    const tone = st.tone === 'day' ? (lum < 0.13 ? 'night' : 'day') : lum > 0.19 ? 'day' : 'night'
    if (tone !== st.tone) onTone?.((st.tone = tone))

    // The shadow map follows the city in view: it changes hands half way through a move, over bare floor,
    // and is redrawn only when the sun has moved.
    const shadowCity = st.p < 0.5 && st.fromView ? st.shadowCity ?? city : city
    const d = l.sunDir
    const moved = Math.abs(d[0] - st.shadowDir[0]) + Math.abs(d[1] - st.shadowDir[1]) + Math.abs(d[2] - st.shadowDir[2]) > 0.0015
    if (shadowCity !== st.shadowCity || moved || redraw.frames > 0) {
      if (redraw.frames > 0) redraw.frames--
      st.shadowCity = shadowCity
      st.shadowDir = [...d]
      fitShadow(sun.current, shadowCity, d)
      gl.shadowMap.needsUpdate = true
    }
  })

  return (
    <>
      <directionalLight ref={sun} castShadow shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0004} shadow-normalBias={2.5} shadow-radius={2.2} />
      <hemisphereLight ref={fill} />
      {CITIES.map((c) => (
        <group key={c.id} position={c.offset}>
          <Precip city={c} look={look} count={shadowSize > 2048 ? 9000 : 3500} />
        </group>
      ))}
    </>
  )
}

// A model that has just arrived asks for the shadow map again, for a few frames while it uploads.
const redraw = { frames: 0 }

// One look object for the whole scene, mutated every frame (never React state).
const LOOK = { current: {} }
const useLook = () => LOOK

const X = new THREE.Vector3()
const Y = new THREE.Vector3()
const Z = new THREE.Vector3()
const P = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

// Aims the sun at a city and fits its shadow camera round the plinth and everything on it.
function fitShadow(light, city, dir) {
  const [cx, , cz] = city.offset
  Z.set(dir[0], dir[1], dir[2])
  light.position.set(cx + Z.x * LIGHT_DISTANCE, Z.y * LIGHT_DISTANCE, cz + Z.z * LIGHT_DISTANCE)
  light.target.position.set(cx, 0, cz)
  light.target.updateMatrixWorld()
  X.crossVectors(UP, Z).normalize()
  Y.crossVectors(Z, X)
  const b = city.axisBearing * RAD
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const u of [-city.halfLength, city.halfLength])
    for (const v of [-city.halfWidth, city.halfWidth])
      for (const h of [-PLINTH_DEPTH, TALLEST]) {
        P.set(u * Math.sin(b) + v * Math.cos(b), h, -u * Math.cos(b) + v * Math.sin(b))
        const x = P.dot(X)
        const y = P.dot(Y)
        const z = P.dot(Z)
        box.x0 = Math.min(box.x0, x)
        box.x1 = Math.max(box.x1, x)
        box.y0 = Math.min(box.y0, y)
        box.y1 = Math.max(box.y1, y)
        box.z0 = Math.min(box.z0, z)
        box.z1 = Math.max(box.z1, z)
      }
  const cam = light.shadow.camera
  const pad = 80
  cam.left = box.x0 - pad
  cam.right = box.x1 + pad
  cam.bottom = box.y0 - pad
  cam.top = box.y1 + pad
  cam.near = LIGHT_DISTANCE - box.z1 - 200
  cam.far = LIGHT_DISTANCE - box.z0 + 200
  cam.updateProjectionMatrix()
}

export default function Stage({ cityId, weather, lite = false, still = false, className = 'stage', onReady, onTone }) {
  // Pixels per pixel: the device's, capped; halved toward 1 if the frame rate will not hold.
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2))
  // The selected city first; the other two once it is up, so the first picture is not kept waiting.
  const [mounted, setMounted] = useState([cityId])
  const ready = useCallback(
    (id) => {
      onReady?.(id)
      redraw.frames = 3
      setMounted((m) => (m.length === CITIES.length ? m : [...new Set([...m, id, ...CITIES.map((c) => c.id)])]))
    },
    [onReady]
  )
  useEffect(() => setMounted((m) => (m.includes(cityId) ? m : [...m, cityId])), [cityId])

  return (
    <Canvas
      className={className}
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={dpr}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: EXPOSURE, powerPreference: 'high-performance' }}
      camera={{ fov: 13, near: 400, far: 160000 }}
    >
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d * 0.75))} />
      <Rig cityId={cityId} weather={weather} shadowSize={lite ? 2048 : 4096} still={still} onTone={onTone} />
      {CITIES.filter((c) => mounted.includes(c.id)).map((c) => (
        <Suspense key={c.id} fallback={null}>
          <Maquette city={c} onReady={ready} />
        </Suspense>
      ))}
    </Canvas>
  )
}
