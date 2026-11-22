import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { now } from '../../core/clock.js'
import { blendLook, localHour } from '../look.js'
import { prepareModel } from '../Maquette.jsx'
import { buildingMaterial, cityClock, plasterUniforms } from '../plaster.js'
import { signSpill } from '../newYork.js'
import { obstructionLights } from '../solids.js'
import Precip from '../Precip.jsx'
import { DRIFT, LOOK, RAD, STILL, fitShadow, nightMonth, nightNumber, viewOf } from '../rig.js'
import { Atmosphere } from './atmosphere.js'
import { CLOUDS_GLSL } from './clouds.js'
import { NIGHT_EXPOSURE, exposureFor, realLookFor } from './look.js'
import { groundGeometry, realBuildingMaterial, realGroundMaterial, realUniforms, towerGeometry } from './materials.js'
import { Pipeline } from './pipeline.js'

// New York and Paris as photographs: the same models and the same live sun and weather as the studio,
// rendered the way current game engines render cities (docs/rendering-research.md, docs/paris/
// rendering-research.md): a physically based sky and atmosphere with aerial perspective, image-based light
// from that sky, procedural PBR facades, water with reflections, temporal antialiasing, bloom and a filmic
// tone curve. Its own render loop (pipeline.js). What differs between the two cities is in STYLES.
//
// ?fx=-taa,-ssr (or any of the names in FX) turns techniques off, to compare.

const params = new URLSearchParams(location.search)
// (A '+' in a query string arrives as a space: either spelling turns a trial on.)
const fxList = (params.get('fx') ?? '').split(',').map((f) => f.trim())
const off = new Set(fxList.filter((f) => f.startsWith('-')).map((f) => f.slice(1)))
export const FX = Object.fromEntries(['aerial', 'ibl', 'pbr', 'ssr', 'taa', 'bloom', 'clouds', 'wet', 'grade', 'shafts'].map((k) => [k, !off.has(k)]))
// On trial, off unless asked for (?fx=+gtao).
FX.gtao = fxList.some((f) => f.replace(/^\+/, '') === 'gtao')
// The tone curve: ACES (three's ACESFilmicToneMapping, Narkowicz's fit of the ACES output transform), or
// AgX with ?tm=agx to compare. Against the reference photographs ACES carries their contrast and the
// harbour's saturated blue by day and their amber at night, where AgX flattens both
// (docs/rendering-research.md, docs/shots/*-agx.jpg).
const TONE = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping }[params.get('tm')] ?? null

// Each city's choices, set against its reference photographs (docs/reference.md, docs/paris/reference.md):
//   windowGain, streetGain: the night re-balanced for an aerial photograph (materials.js);
//   apScale: the share of each view ray's air the aerial perspective counts (atmosphere.js): New York's
//     photographers stood about 4 km off where the site's camera stands 17. Paris's stood 6 to 9 km off,
//     as its camera does, but counting all of it (0.8) veiled the city in blue past the photographs (the
//     camera's 1.3 km of height adds air they did not look through), and 0.4 left a 15 km overcast day a
//     pale veil with the tower barely in it, where photograph 04 still draws it: 0.3, about 2.7 km;
//   underDeck: the cloud deck's light on the air is held above the camera (Paris's camera is 1.3 km up,
//     above a November stratus deck, but every photograph is taken from under it and the frame never
//     shows the cloud);
//   cie: the CIE overcast sky's gradient under a full deck (atmosphere.js);
//   neutralDeck: a thick deck's light near neutral (look.js);
//   tone, balance, saturation, contrast: the curve and the grade (Paris's photographs are warmer: limestone
//     in afternoon light, where the model's camera-facing walls are lit from the side at noon in November).
export const STYLES = {
  'new-york': { windowGain: 0.45, streetGain: 2.0, apScale: 0.25, underDeck: false, cie: 0, neutralDeck: false, tone: THREE.ACESFilmicToneMapping, balance: [1, 1, 1], saturation: 1.12, contrast: 1.14 },
  paris: { windowGain: 0.45, streetGain: 2.0, apScale: 0.3, underDeck: true, cie: 1, neutralDeck: true, tone: THREE.ACESFilmicToneMapping, balance: [1.04, 1, 0.94], saturation: 1.1, contrast: 1.18 },
}

// The photoreal cities: fetch what they need as soon as the module loads.
for (const id of ['new-york', 'paris']) {
  useLoader.preload(THREE.TextureLoader, [`/models/${id}-ground.png`, `/models/${id}-cover.png`, `/models/${id}-context.png`])
  useLoader.preload(THREE.FileLoader, [`/models/${id}-context.json`, `/models/${id}-context.bin`], (l) => l.setResponseType('arraybuffer'))
}

export default function RealCity({ city, weather, lite = false, still = false, onReady, onTone }) {
  const style = STYLES[city.id]
  const { gl, scene, camera, size } = useThree()
  const { scene: gltf } = useGLTF(city.glb, false, true)
  const [groundMap, coverMap, contextMap] = useLoader(THREE.TextureLoader, [city.ground, `/models/${city.id}-cover.png`, `/models/${city.id}-context.png`])
  // The country round the plinth: its extent, and its towers (scripts/models/context.mjs).
  const [contextJson, towersBin] = useLoader(THREE.FileLoader, [`/models/${city.id}-context.json`, `/models/${city.id}-context.bin`], (l) => l.setResponseType('arraybuffer'))
  const sun = useRef()
  const precip = useRef()
  const s = useRef(null)

  const gpu = useRef(null)
  const { buildings, lights, ground, towers } = useMemo(() => {
    const o = prepareModel(gltf, city)
    o.updateWorldMatrix(true, false)
    // Without the PBR materials (?fx=-pbr, to compare): the studio's plaster.
    const mats = FX.pbr ? [realBuildingMaterial(city.offset, { plain: true, city: city.id }), realBuildingMaterial(city.offset, { city: city.id })] : [buildingMaterial(city.id, city.offset, { plain: true }), buildingMaterial(city.id, city.offset)]
    const buildings = new THREE.Mesh(o.geometry, mats)
    buildings.matrixAutoUpdate = false
    // The model's own transform (it is quantized), then where the city stands on the studio floor.
    buildings.matrix.copy(o.matrixWorld).premultiply(new THREE.Matrix4().makeTranslation(...city.offset))
    buildings.castShadow = buildings.receiveShadow = true
    buildings.frustumCulled = false
    const lights = obstructionLights(o.geometry.userData.peaks, plasterUniforms)
    lights.position.set(...city.offset)
    for (const t of [groundMap, coverMap, contextMap]) {
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.anisotropy = 8
      t.needsUpdate = true
    }
    // Straight alpha: the height channel must not be premultiplied into the others.
    contextMap.premultiplyAlpha = false
    const meta = JSON.parse(new TextDecoder().decode(contextJson))
    const ground = new THREE.Mesh(groundGeometry(200000), realGroundMaterial(groundMap, coverMap, { texture: contextMap, box: meta.box }, city))
    ground.rotation.y = Math.PI / 2 - city.axisBearing * RAD
    ground.position.set(...city.offset)
    ground.receiveShadow = true
    ground.frustumCulled = false
    const towers = new THREE.Mesh(towerGeometry(towersBin), FX.pbr ? realBuildingMaterial(city.offset, { plain: true, city: city.id }) : buildingMaterial(city.id, city.offset, { plain: true }))
    towers.position.set(...city.offset)
    towers.castShadow = towers.receiveShadow = true
    towers.frustumCulled = false
    return { buildings, lights, ground, towers }
  }, [gltf, city, groundMap, coverMap, contextMap, contextJson, towersBin])

  // The meshes' own GPU resources go when they do (the model's geometry is the loader's, shared).
  useEffect(
    () => () => {
      for (const m of [buildings.material, towers.material, ground.material, lights.material].flat()) m.dispose()
      towers.geometry.dispose()
      ground.geometry.dispose()
      lights.geometry.dispose()
    },
    [buildings, towers, ground, lights]
  )

  // The GPU side (tables, targets, passes) lives exactly as long as the component is mounted.
  useEffect(() => {
    const atmosphere = new Atmosphere(gl, CLOUDS_GLSL)
    const pipeline = new Pipeline(gl, atmosphere, { taa: FX.taa, bloom: FX.bloom })
    gpu.current = { atmosphere, pipeline, sky: null }
    const prev = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, autoUpdate: gl.shadowMap.autoUpdate }
    gl.toneMapping = TONE ?? STYLES[city.id].tone
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
      const l = realLookFor(city, date, weather?.[city.id], style)
      blendLook(LOOK.current, l, l, 1)
      s.current = { target: l, at: 0, shadowDir: [0, 0, 0], frames: 4, exposure: 1 }
    }
    const st = s.current
    // Dev: a handle for inspecting the passes from the console or a script.
    if (import.meta.env.DEV) window.__real = { buildings, ground, atmosphere, pipeline, gl, LOOK, s }
    st.at -= dt
    if (st.at <= 0) {
      st.target = realLookFor(city, date, weather?.[city.id], style)
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
    // The deck's light on the air: at the cloud's height, or (Paris) above the camera.
    const deckH = style.underDeck ? Math.max(l.cloudH, Math.round((camera.position.y + 400) / 100) * 100) : l.cloudH
    const key = [...l.sunTrue, l.mieExt, l.cover, l.night, l.rain, deckH].map((x) => x.toFixed(3)).join()
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
        // The share of the sky the deck covers lights the air beneath it.
        deck: FX.clouds ? { h: deckH / 1000, sun: l.sunThrough, L: l.cloudLit.map((v) => (v * l.cover) / l.sunE) } : { h: 0, sun: 1, L: [0, 0, 0] },
        cie: FX.clouds ? style.cie * Math.min(1, Math.max(0, (l.cover - 0.7) / 0.3)) : 0,
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
    // A sky under an eighth covered casts too little shadow to be worth the noise in every pixel; the
    // reflections still show its clouds (the sky cube keeps them).
    ru.uCloudTh.value = FX.clouds && l.cover >= 0.12 ? l.cloudTh : 2
    ru.uCloudH.value = l.cloudH
    ru.uCloudShift.value.fromArray(l.cloudShift)
    ru.uCloudOpacity.value = l.cloudOpacity
    ru.uWetness.value = FX.wet ? l.wet : 0
    ru.uWind.value.fromArray(l.wind)
    ru.uWindSpeed.value = l.windMs
    ru.uSsr.value = FX.ssr && !lite ? 1 : 0
    ru.uNightGain.value = 1
    ru.uWindowGain.value = style.windowGain
    ru.uStreetGain.value = style.streetGain

    // The frame.
    const buffer = gl.getDrawingBufferSize(new THREE.Vector2())
    pipeline.setSize(buffer.x, buffer.y)
    pipeline.jitter(camera)
    pipeline.render(scene, camera, { buildings: [buildings, lights, towers], ground: [ground], late: [precip.current].filter(Boolean) }, {
      exposure: st.exposure,
      // By day a camera meters the frame itself (half its exposure here); after dark the incident reading
      // and its ceiling decide, so the night is not lifted to grey.
      meter: 0.6 * (1 - l.night),
      // A grey day is printed grey, not lifted to a bright one: rain and fog metered darker.
      key: 0.2 * (1 - 0.35 * Math.max(l.rain, l.fog, l.snow * 0.5)),
      exposureMax: NIGHT_EXPOSURE,
      // The grade: a print's contrast and colour, as the reference photographs have (docs/reference.md).
      balance: FX.grade ? style.balance : [1, 1, 1],
      saturation: FX.grade ? style.saturation : 1,
      contrast: FX.grade ? style.contrast : 1,
      lift: 0,
      bloom: 0.04,
      sunE: l.sunE,
      sunDir: l.sunTrue,
      aerial: FX.aerial,
      sky: atmosphere.skyCube.texture,
      // Only with a sun to cast them.
      shafts: FX.shafts && l.sunLight[1] * l.sunThrough > 1,
      shadow: sl.shadow.map ? { map: sl.shadow.map.depthTexture, matrix: sl.shadow.matrix } : null,
      sunL: l.sunLight.map((e) => e * l.sunThrough),
      sunDirW: l.sunDir,
      mieScat: l.mieScat,
      gtao: FX.gtao ? 0.6 : 0,
      origin: city.offset,
      apScale: style.apScale,
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
      <primitive object={towers} />
      <primitive object={lights} />
      <primitive object={ground} />
      <group ref={precip} position={city.offset}>
        <Precip city={city} look={LOOK} count={lite ? 3500 : 9000} />
      </group>
    </>
  )
}
