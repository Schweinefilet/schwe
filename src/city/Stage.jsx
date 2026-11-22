import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { now } from '../core/clock.js'
import { CITIES, cityById } from './cities.js'
import { EXPOSURE, blendLook, copyLook, localHour, lookFor } from './look.js'
import Maquette from './Maquette.jsx'
import { CAM, DRIFT, LOOK, MOVE_S, RAD, STILL, blendView, ease, fitShadow, nightMonth, nightNumber, redraw, smooth, viewOf } from './rig.js'
import { cityClock, plasterUniforms } from './plaster.js'
import { signSpill } from './newYork.js'
import Precip from './Precip.jsx'
import RealNewYork from './real/RealNewYork.jsx'

// The studio: three plaster cities on a floor, one sun, one long lens. The lens rests on the selected
// city, drifting a few degrees either way; choosing another swings it there across bare floor while the
// light turns into the other city's.

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
  const look = LOOK
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
      for (const c of CITIES) {
        cityClock[c.id].uHour.value = localHour(c, date)
        cityClock[c.id].uDay.value = nightNumber(c, date)
        cityClock[c.id].uMonth.value = nightMonth(c, date)
      }
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
    if (camera.fov !== v.fov || (CAM?.[7] && camera.near !== CAM[7])) {
      camera.fov = v.fov
      if (CAM?.[7]) camera.near = CAM[7]
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
    plasterUniforms.uTime.value = state.clock.elapsedTime
    signSpill(plasterUniforms.uSpill.value, state.clock.elapsedTime)
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

export default function Stage({ cityId, real = false, weather, lite = false, still = false, className = 'stage', onReady, onTone }) {
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
      {real ? (
        <Suspense fallback={null}>
          <RealNewYork city={cityById(cityId)} weather={weather} lite={lite} still={still} onReady={ready} onTone={onTone} />
        </Suspense>
      ) : (
        <>
          <Rig cityId={cityId} weather={weather} shadowSize={lite ? 2048 : 4096} still={still} onTone={onTone} />
          {CITIES.filter((c) => mounted.includes(c.id)).map((c) => (
            <Suspense key={c.id} fallback={null}>
              <Maquette city={c} onReady={ready} />
            </Suspense>
          ))}
        </>
      )}
    </Canvas>
  )
}
