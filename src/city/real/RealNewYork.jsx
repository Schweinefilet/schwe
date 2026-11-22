import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { now } from '../../core/clock.js'
import { blendLook, localHour } from '../look.js'
import { prepareModel } from '../Maquette.jsx'
import { cityClock, plasterUniforms } from '../plaster.js'
import { signSpill } from '../newYork.js'
import { obstructionLights } from '../solids.js'
import Precip from '../Precip.jsx'
import { DRIFT, LOOK, RAD, STILL, fitShadow, nightMonth, nightNumber, viewOf } from '../rig.js'
import { Atmosphere } from './atmosphere.js'
import { CLOUDS_GLSL } from './clouds.js'
import { NIGHT_EXPOSURE, exposureFor, realLookFor } from './look.js'
import { groundGeometry, realBuildingMaterial, realGroundMaterial, realUniforms } from './materials.js'
import { Pipeline } from './pipeline.js'

// New York as a photograph: the same model and the same live sun and weather as the studio, rendered the
// way current game engines render cities (docs/rendering-research.md): a physically based sky and
// atmosphere with aerial perspective, image-based light from that sky, procedural PBR facades, water with
// reflections, temporal antialiasing, bloom and a filmic tone curve. Its own render loop (pipeline.js).
//
// ?fx=-taa,-ssr (or any of the names in FX) turns techniques off, to compare.

const params = new URLSearchParams(location.search)
const off = new Set((params.get('fx') ?? '').split(',').filter((f) => f.startsWith('-')).map((f) => f.slice(1)))
export const FX = Object.fromEntries(['aerial', 'ibl', 'pbr', 'ssr', 'taa', 'bloom', 'clouds', 'wet', 'grade'].map((k) => [k, !off.has(k)]))

export default function RealNewYork({ city, weather, lite = false, still = false, onReady, onTone }) {
  const { gl, scene, camera, size } = useThree()
  const { scene: gltf } = useGLTF(city.glb, false, true)
  const [groundMap, coverMap] = useLoader(THREE.TextureLoader, [city.ground, `/models/${city.id}-cover.png`])
  const sun = useRef()
  const precip = useRef()
  const s = useRef(null)

  const gpu = useRef(null)
  const { buildings, lights, ground } = useMemo(() => {
    const o = prepareModel(gltf, city)
    o.updateWorldMatrix(true, false)
    const mats = FX.pbr ? [realBuildingMaterial(city.offset, { plain: true }), realBuildingMaterial(city.offset)] : o.material
    const buildings = new THREE.Mesh(o.geometry, mats)
    buildings.matrixAutoUpdate = false
    buildings.matrix.copy(o.matrixWorld)
    buildings.castShadow = buildings.receiveShadow = true
    buildings.frustumCulled = false
    const lights = obstructionLights(o.geometry.userData.peaks, plasterUniforms)
    for (const t of [groundMap, coverMap]) {
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.anisotropy = 8
      t.needsUpdate = true
    }
    const ground = new THREE.Mesh(groundGeometry(200000), realGroundMaterial(groundMap, coverMap, city))
    ground.rotation.y = Math.PI / 2 - city.axisBearing * RAD
    ground.position.set(...city.offset)
    ground.receiveShadow = true
    ground.frustumCulled = false
    return { buildings, lights, ground }
  }, [gltf, city, groundMap, coverMap])

  // The GPU side (tables, targets, passes) lives exactly as long as the component is mounted.
  useEffect(() => {
    const atmosphere = new Atmosphere(gl, CLOUDS_GLSL)
    const pipeline = new Pipeline(gl, atmosphere, { taa: FX.taa && !lite, bloom: FX.bloom })
    gpu.current = { atmosphere, pipeline, sky: null }
    const prev = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, autoUpdate: gl.shadowMap.autoUpdate }
    gl.toneMapping = THREE.AgXToneMapping
    gl.toneMappingExposure = 1
    gl.shadowMap.autoUpdate = false
    scene.add(sun.current.target)
    onTone?.('night')
    onReady?.(city.id)
    return () => {
      camera.near = 400
      camera.far = 160000
      camera.updateProjectionMatrix()
      gl.toneMapping = prev.toneMapping
      gl.toneMappingExposure = prev.exposure
      scene.environment = null
      scene.background = null
      atmosphere.dispose()
      pipeline.dispose()
      gpu.current = null
    }
  }, [gl, scene, camera, lite, city.id, onReady, onTone])

  // Priority 1: this frame's rendering is ours, not React Three Fiber's.
  useFrame((state, dt) => {
    if (!gpu.current) return
    const { atmosphere, pipeline } = gpu.current
    const date = now()
    const aspect = size.width / size.height
    if (!s.current) {
      const l = realLookFor(city, date, weather?.[city.id])
      blendLook(LOOK.current, l, l, 1)
      s.current = { target: l, at: 0, shadowDir: [0, 0, 0], frames: 4, exposure: 1 }
    }
    const st = s.current
    // Dev: a handle for inspecting the passes from the console or a script.
    if (import.meta.env.DEV) window.__real = { buildings, ground, atmosphere, pipeline, gl, LOOK, s }
    st.at -= dt
    if (st.at <= 0) {
      st.target = realLookFor(city, date, weather?.[city.id])
      cityClock[city.id].uHour.value = localHour(city, date)
      cityClock[city.id].uDay.value = nightNumber(city, date)
      cityClock[city.id].uMonth.value = nightMonth(city, date)
      st.at = 1
    }
    // Weather and light ease in, as in the studio.
    blendLook(LOOK.current, LOOK.current, st.target, still ? 1 : 1 - Math.exp(-dt * 1.6))
    const l = LOOK.current

    // The camera: the city's view, drifting.
    const v = viewOf(city, aspect)
    const t = STILL || still ? 0 : state.clock.elapsedTime
    const bearing = (v.bearing + DRIFT.bearing * Math.sin((t * 2 * Math.PI) / DRIFT.bearingS)) * RAD
    const elevation = (v.elevation + DRIFT.elevation * Math.sin((t * 2 * Math.PI) / DRIFT.elevationS)) * RAD
    const flat = v.distance * Math.cos(elevation)
    camera.position.set(v.x - Math.sin(bearing) * flat, v.y + v.distance * Math.sin(elevation), v.z + Math.cos(bearing) * flat)
    camera.lookAt(v.x, v.y, v.z)
    camera.fov = v.fov
    camera.near = 2000
    camera.far = 120000

    // The sky, the tables and the environment: again when the sun or the weather has moved enough.
    const key = [...l.sunTrue, l.mieExt, l.cover, l.night, l.rain, l.cloudH].map((x) => x.toFixed(3)).join()
    if (key !== gpu.current.sky) {
      gpu.current.sky = key
      const env = atmosphere.update({
        mie: { ext: l.mieExt, scat: l.mieScat },
        sunDir: l.sunTrue,
        ground: l.ground,
        nightGlow: l.nightGlow,
        cloudLit: l.cloudLit,
        cloudTh: FX.clouds ? l.cloudTh : 2,
        cloudShift: l.cloudShift,
        deck: FX.clouds ? { h: l.cloudH / 1000, sun: l.sunThrough, L: l.cloudLit.map((v) => v / l.sunE) } : { h: 0, sun: 1, L: [0, 0, 0] },
      })
      scene.environment = FX.ibl ? env : null
      st.exposure = exposureFor(l, atmosphere.skyIrradiance)
    }

    // The sun.
    const sl = sun.current
    const lum = Math.max(...l.sunLight, 1e-6)
    sl.color.setRGB(...l.sunLight.map((e) => e / lum))
    sl.intensity = lum
    if (!FX.ibl) {
      // Without the sky's light, a flat stand-in for it.
      scene.environment = null
    }
    const d = l.sunDir
    const moved = Math.abs(d[0] - st.shadowDir[0]) + Math.abs(d[1] - st.shadowDir[1]) + Math.abs(d[2] - st.shadowDir[2]) > 0.0015
    if (moved || st.frames > 0) {
      st.frames = Math.max(0, st.frames - 1)
      st.shadowDir = [...d]
      fitShadow(sl, city, d)
      gl.shadowMap.needsUpdate = true
    }

    // The shared uniforms.
    plasterUniforms.uNight.value = l.night
    plasterUniforms.uLit.value = l.lit
    plasterUniforms.uLate.value = l.late
    plasterUniforms.uWet.value = l.wet
    plasterUniforms.uTime.value = state.clock.elapsedTime
    signSpill(plasterUniforms.uSpill.value, state.clock.elapsedTime)
    const ru = realUniforms
    ru.uSunDirW.value.fromArray(l.sunDir)
    ru.uCloudTh.value = FX.clouds ? l.cloudTh : 2
    ru.uCloudH.value = l.cloudH
    ru.uCloudShift.value.fromArray(l.cloudShift)
    ru.uCloudOpacity.value = l.cloudOpacity
    ru.uWetness.value = FX.wet ? l.wet : 0
    ru.uWind.value.fromArray(l.wind)
    ru.uWindSpeed.value = l.windMs
    ru.uSsr.value = FX.ssr && !lite ? 1 : 0
    ru.uNightGain.value = 1

    // The frame.
    const buffer = gl.getDrawingBufferSize(new THREE.Vector2())
    pipeline.setSize(buffer.x, buffer.y)
    pipeline.jitter(camera)
    pipeline.render(scene, camera, { buildings: [buildings, lights], ground: [ground], late: [precip.current].filter(Boolean) }, {
      exposure: st.exposure,
      // By day a camera meters the frame itself (half its exposure here); after dark the incident reading
      // and its ceiling decide, so the night is not lifted to grey.
      meter: 0.6 * (1 - l.night),
      key: 0.2,
      exposureMax: NIGHT_EXPOSURE,
      // The grade: a print's contrast and colour, as the reference photographs have (docs/reference.md).
      balance: [1, 1, 1],
      saturation: FX.grade ? 1.12 : 1,
      contrast: FX.grade ? 1.14 : 1,
      lift: 0,
      bloom: 0.04,
      sunE: l.sunE,
      sunDir: l.sunTrue,
      aerial: FX.aerial,
      sky: atmosphere.skyCube.texture,
    })
    // Obstruction lights' size by distance (as Maquette does).
    const u = lights.material.uniforms
    u.uPx.value = gl.getPixelRatio()
    u.uScale.value = (camera.projectionMatrix.elements[5] * size.height * u.uPx.value) / 2
  }, 1)

  return (
    <>
      <directionalLight ref={sun} castShadow shadow-mapSize={[lite ? 2048 : 4096, lite ? 2048 : 4096]} shadow-bias={-0.0004} shadow-normalBias={2.5} shadow-radius={1.5} />
      <primitive object={buildings} />
      <primitive object={lights} />
      <primitive object={ground} />
      <group ref={precip} position={city.offset}>
        <Precip city={city} look={LOOK} count={lite ? 3500 : 9000} />
      </group>
    </>
  )
}
