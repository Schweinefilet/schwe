import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PUDDLE_RAIN, RAIN, SPLASH, WATER } from '../config.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { fall } from '../core/fall.js'
import { globalUniforms } from '../core/uniforms.js'
import { prewarm } from '../core/prewarm.js'
import { buildSchedule, forEachActive } from '../core/puddleRain.js'
import envChunk from '../shaders/env.glsl?raw'
import { envUniforms } from '../content/backdrop.js'
import waterChunk from '../shaders/water.glsl?raw'
import vertexShader from '../shaders/rainSplash.vert.glsl?raw'
import { plink } from '../audio/audioEngine.js'
import { TAU, WaveSim } from './waves/WaveSim.js'
import { calmField, surfaceUniforms } from './waves/surface.js'
import { overlay } from '../ui/overlay.js'

// Beat 7, after the hero drop: rain on the puddle. Every drop is one of the baked library's splashes
// (blender/splash/bake_rain.py), placed by the schedule (core/puddleRain.js), turned and scaled, played
// at its own frame; before it lands it is a falling bead. The surface between the splashes is a live
// simulation (waves/WaveSim.js) that the splashes drive: near each one the surface is pinned to the
// bake's own (its crater and swell), so the rings that run from it are the bake's. Nothing here depends
// on scroll but the rain's intensity (rig.rain): the rain's clock is the scene's simulated time, so it
// freezes with the rest of the rain and, on the last frame, falls for as long as the page is open.

const CAP = { full: 512, far: 2048, beads: 1024, pins: 8192 }

// The ending's answer and final screen are a title card over the water: no splash stands behind them
// (overlay.typeZone, from EndType.jsx). A splash whose screen box (its crown's reach across, its height
// up from where it lands) comes within KEEP_OUT px of the type's box fades out by how far it reaches in;
// its rings still spread there.
const KEEP_OUT = 28
const _sp = new THREE.Vector3()
function typeClear(camera, size, zone, x, y, z, halfWidth, height) {
  _sp.set(x, y, z).project(camera)
  if (_sp.z > 1) return 1
  const sx = ((_sp.x + 1) / 2) * size.width
  const ground = ((1 - _sp.y) / 2) * size.height
  _sp.set(x, y + height, z).project(camera)
  const top = ((1 - _sp.y) / 2) * size.height
  const half = Math.max((ground - top) * (halfWidth / height), 1)
  // How far the splash's box reaches into the zone grown by KEEP_OUT, in px (≤ 0: clear of it).
  const inX = Math.min(sx + half - (zone[0] - KEEP_OUT), zone[2] + KEEP_OUT - (sx - half))
  const inY = Math.min(ground - (zone[1] - KEEP_OUT), zone[3] + KEEP_OUT - top)
  return 1 - smooth(0, KEEP_OUT, Math.min(inX, inY))
}

// ---- The splashes ---------------------------------------------------------------------------------

const splashFragment = /* glsl */ `
${envChunk}
${waterChunk}
uniform sampler2D uProfile; // the bake's surface against radius, per frame (the part the puddle draws)
uniform float uProfileRow;
uniform float uProfileRows;
uniform float uReach;
uniform float uCap;
uniform float uRough;
uniform float uDropRadius;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vFrame;
varying float vFade;
void main() {
#ifdef PREPASS
  // Depth only: the front-most surface of each near splash, so its colour pass draws one clean layer
  // (blended by fade, the sheets' back and front otherwise showed through each other in patches).
  // One fading out does not hide what is behind it.
  if (vFade < 0.5) discard;
#else
  if (vFade < 0.02) discard;
#endif
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 n = normalize(vNormal);
  if (dot(n, v) > 0.0) n = -n;
  // The puddle draws the water's surface as a height field (pinned to this bake's own profile), so
  // what lies on or under that surface is the puddle's: only what rises off it is drawn here — the
  // crown, the jet, the drops — and the steep walls where it rises.
  float r = length(vLocal.xz);
  float u = r / uReach;
  float surf = u < 1.0 ? min(texture(uProfile, vec2(u, (uProfileRow + vFrame + 0.5) / uProfileRows)).r, uCap) : 0.0;
  float above = vLocal.y - surf;
  float flat_ = smoothstep(0.55, 0.85, abs(n.y));
  if (above < mix(-0.02, 0.25, flat_) * uDropRadius) discard;
#ifdef PREPASS
  gl_FragColor = vec4(0.0);
  return;
#endif
  // Coming and going (the rain's intensity, distance, the bake's end) it fades as a whole; a dither
  // showed its pattern on splashes close to the camera.
  gl_FragColor = vec4(shadeSplash(v, n, uRough), splashAlpha(v, n) * vFade);
}`

// ---- The surface pins -----------------------------------------------------------------------------

const pinVertex = /* glsl */ `
uniform float uSize;
attribute vec4 iPin;   // xy: centre (cells), z: radius (cells), w: profile row (fractional frame)
attribute vec4 iPin2;  // x: meters per cell over the splash's scale, y: scale, z: weight, w: reach (m)
varying vec2 vCell;
varying vec4 vPin;
varying vec4 vPin2;
void main() {
  vPin = iPin;
  vPin2 = iPin2;
  vCell = iPin.xy + position.xy * iPin.z;
  gl_Position = vec4(vCell / uSize * 2.0 - 1.0, 0.0, 1.0);
}`

const pinFragment = /* glsl */ `
precision highp float;
uniform sampler2D uProfile;
uniform float uProfileRows;
uniform float uFrameSeconds;
uniform float uInner;
uniform float uOuter;
uniform float uTau;        // the field keeps the rate as ḣ·τ (WaveSim.js)
varying vec2 vCell;
varying vec4 vPin;
varying vec4 vPin2;
float profileAt(float u, float row) { return texture(uProfile, vec2(u, (row + 0.5) / uProfileRows)).r; }
void main() {
  float scale = vPin2.y;
  float rMeters = length(gl_FragCoord.xy - vPin.xy) * vPin2.x; // in the bake's own meters
  float u = rMeters / vPin2.w;
  if (u >= uOuter) discard;
  float w = (1.0 - smoothstep(uInner, uOuter, u)) * vPin2.z;
  float row = vPin.w;
  float h = profileAt(u, row);
  float rate = (profileAt(u, row + 1.0) - profileAt(u, row - 1.0)) / (2.0 * uFrameSeconds);
  // Heights and rates scale with the splash (time does not).
  gl_FragColor = vec4(w * h * scale, w * rate * scale * uTau, 0.0, w);
}`

// ---- The falling drops -----------------------------------------------------------------------------

const beadVertex = /* glsl */ `
attribute vec4 iBead;   // xyz: centre (world), w: radius
attribute vec4 iVel;    // xyz: direction of fall, w: stretch along it (motion blur)
varying vec3 vWorld;
varying vec3 vCenter;
varying float vRadius;
void main() {
  vec3 d = iVel.xyz;
  vec3 p = position * iBead.w;
  p += d * dot(p, d) * iVel.w; // a short streak: the bead stretched along its fall by the shutter
  vec3 w = iBead.xyz + p;
  vWorld = w;
  vCenter = iBead.xyz;
  vRadius = iBead.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`

// A ball lens, as every drop in the scene: refract in, cross the drop, refract out; the image of the
// world behind comes out inverted. Fresnel reflection on top, and a glint.
const beadFragment = /* glsl */ `
${envChunk}
uniform float uFogDensity;
uniform float uLensGain;
varying vec3 vWorld;
varying vec3 vCenter;
varying float vRadius;
void main() {
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 n = normalize(vWorld - vCenter);
  if (dot(n, v) > 0.0) n = -n;
  float cosi = clamp(dot(-v, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
  vec3 t1 = refract(v, n, 1.0 / 1.333);
  vec3 exit = vWorld + t1 * (-2.0 * dot(t1, n) * vRadius);
  vec3 n2 = normalize(exit - vCenter);
  vec3 t2 = refract(t1, -n2, 1.333);
  if (dot(t2, t2) < 0.5) t2 = reflect(t1, -n2);
  float foot = 0.004;
  // Lit like the rain around it (RAIN.lensGain): a bead passes on more of the square's light than a
  // real drop would, as rain caught by a flash.
  vec3 col = envColor(t2, foot) * uLensGain * (1.0 - fresnel) + envColor(reflect(v, n), foot) * fresnel;
  col += vec3(pow(max(dot(reflect(v, n), normalize(vec3(-0.4, 0.8, 0.45))), 0.0), 300.0) * 3.0);
  float fog = exp(-length(vWorld - cameraPosition) * uFogDensity);
  gl_FragColor = vec4(col * fog, 1.0);
}`

// ---- Loading ------------------------------------------------------------------------------------

// Decoded off the main thread into an ImageBitmap (exact values: no colour conversion, no alpha), which
// Chrome uploads without the per-pixel conversion an <img> goes through: the largest (4096 × 2600)
// otherwise held a frame for about 80 ms.
async function loadTexture(url) {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const t = new THREE.Texture(bitmap)
  t.flipY = false
  t.colorSpace = THREE.NoColorSpace
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

async function loadVat(base) {
  const [meta, hi, lo, nrm, idx] = await Promise.all([
    fetch(`${base}splash.json`).then((r) => {
      if (!r.ok) throw new Error(`${base}splash.json: ${r.status}`)
      return r.json()
    }),
    loadTexture(`${base}splash_hi.png`),
    loadTexture(`${base}splash_lo.png`),
    loadTexture(`${base}splash_nrm.png`),
    loadTexture(`${base}splash_idx.png`),
  ])
  const table = new Float32Array(meta.frames * 4)
  for (let f = 0; f < meta.frames; f++) table.set([meta.vertexRows[f], meta.indexRows[f], meta.trisPerFrame[f], 0], f * 4)
  const frames = new THREE.DataTexture(table, meta.frames, 1, THREE.RGBAFormat, THREE.FloatType)
  frames.needsUpdate = true
  return { meta, hi, lo, nrm, idx, frames, textures: [hi, lo, nrm, idx, frames] }
}

async function loadLibrary(base) {
  const variants = await Promise.all(
    PUDDLE_RAIN.variants.map(async (v) => {
      try {
        const [full, far] = await Promise.all([loadVat(`${base}${v.id}/`), loadVat(`${base}${v.id}/far/`)])
        return { ...v, full, far, meta: full.meta }
      } catch (err) {
        console.warn(`[rain] ${v.id} not available:`, err.message)
        return null
      }
    })
  )
  const found = variants.filter(Boolean)
  if (!found.length) throw new Error('no rain splashes baked')
  // All the variants' surface profiles in one texture: a row per frame, a column per ring. Each
  // variant's first and last rows are repeated once outside it, so reading a frame on either side
  // (for the surface's rate) never reaches into the next variant.
  const bins = found[0].meta.profile.bins
  let rows = 0
  for (const v of found) {
    v.profileRow = rows + 1
    rows += v.meta.frames + 2
  }
  const data = new Float32Array(bins * rows)
  for (const v of found) {
    const heights = v.meta.profile.heights
    const put = (row, f) => heights[f].forEach((h, b) => (data[row * bins + b] = h * 1e-6))
    heights.forEach((_, f) => put(v.profileRow + f, f))
    put(v.profileRow - 1, 0)
    put(v.profileRow + heights.length, heights.length - 1)
  }
  const profile = new THREE.DataTexture(data, bins, rows, THREE.RedFormat, THREE.FloatType)
  profile.minFilter = profile.magFilter = THREE.LinearFilter
  profile.wrapS = profile.wrapT = THREE.ClampToEdgeWrapping
  profile.needsUpdate = true
  return { variants: found, profile, profileRows: rows }
}

// ---- Scene objects ------------------------------------------------------------------------------

function splashMesh(vat, variant, library, lod) {
  const { meta } = vat
  const n = meta.maxCorners
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aIndex', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1))
  const cap = CAP[lod]
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const b = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iPosFrame', a)
  g.setAttribute('iRotScale', b)
  g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: splashFragment,
    uniforms: {
      ...envUniforms,
      uHi: { value: vat.hi },
      uLo: { value: vat.lo },
      uNrm: { value: vat.nrm },
      uIdx: { value: vat.idx },
      uFrames: { value: vat.frames },
      uWidth: { value: meta.width },
      uBoundsMin: { value: new THREE.Vector3(...meta.boundsMin) },
      uBoundsMax: { value: new THREE.Vector3(...meta.boundsMax) },
      uQuantMax: { value: meta.quantMax },
      uSurfaceY: { value: meta.surfaceY },
      uWorldPerMeter: { value: PUDDLE_RAIN.worldPerMeter },
      uProfile: { value: library.profile },
      uProfileRow: { value: variant.profileRow },
      uProfileRows: { value: library.profileRows },
      uReach: { value: variant.meta.profile.reach },
      uCap: { value: variant.meta.profile.cap },
      uRough: { value: PUDDLE_RAIN.rough },
      uDropRadius: { value: meta.dropRadius },
      uReflGain: { value: WATER.reflGain },
      uDeep: { value: new THREE.Color(...WATER.deep) },
      uTransGain: { value: WATER.transGain },
    },
    side: THREE.DoubleSide,
    transparent: true,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.renderOrder = 2
  // Near splashes are big enough to show their self-overlap: a depth prepass of the same instances.
  let prepass = null
  if (lod === 'full') {
    const pm = m.clone()
    pm.defines = { PREPASS: '' }
    pm.colorWrite = false
    pm.transparent = true
    prepass = new THREE.Mesh(g, pm)
    prepass.frustumCulled = false
    prepass.visible = false
    prepass.renderOrder = 1
    m.depthWrite = false
    m.depthFunc = THREE.LessEqualDepth
  }
  return { mesh, prepass, a, b, cap, count: 0, frames: meta.frames }
}

function beadMesh() {
  const sphere = new THREE.IcosahedronGeometry(1, 3)
  const g = new THREE.InstancedBufferGeometry()
  g.index = sphere.index
  g.setAttribute('position', sphere.getAttribute('position'))
  const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP.beads * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const b = new THREE.InstancedBufferAttribute(new Float32Array(CAP.beads * 4), 4).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iBead', a)
  g.setAttribute('iVel', b)
  g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    vertexShader: beadVertex,
    fragmentShader: beadFragment,
    uniforms: { ...envUniforms, uFogDensity: { value: 0.08 }, uLensGain: { value: RAIN.lensGain } },
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.visible = false
  return { mesh, a, b, count: 0 }
}

function pinMesh(sim, library) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP.pins * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const b = new THREE.InstancedBufferAttribute(new Float32Array(CAP.pins * 4), 4).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iPin', a)
  g.setAttribute('iPin2', b)
  g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    vertexShader: pinVertex,
    fragmentShader: pinFragment,
    uniforms: {
      uSize: { value: sim.size },
      uProfile: { value: library.profile },
      uProfileRows: { value: library.profileRows },
      uFrameSeconds: { value: library.variants[0].meta.frameSeconds },
      uInner: { value: PUDDLE_RAIN.pin.inner },
      uOuter: { value: PUDDLE_RAIN.pin.outer },
      uTau: { value: TAU },
    },
    // Pull the field onto the pinned surface by the pin's weight: dst = w·target + (1 − w)·dst.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  return { mesh, a, b, count: 0 }
}

function createWorld(gl, library) {
  const sim = new WaveSim(gl, {
    size: PUDDLE_RAIN.sim.size,
    tile: PUDDLE_RAIN.tile,
    worldPerMeter: PUDDLE_RAIN.worldPerMeter,
    depth: PUDDLE_RAIN.sim.depth,
    damping: PUDDLE_RAIN.sim.damping,
  })
  const pins = pinMesh(sim, library)
  sim.pinScene.add(pins.mesh)
  const splashes = library.variants.map((v) => ({
    variant: v,
    full: splashMesh(v.full, v, library, 'full'),
    far: splashMesh(v.far, v, library, 'far'),
    life: v.meta.frames * v.meta.frameSeconds,
    lead: v.meta.impactSeconds,
  }))
  return { sim, pins, splashes, beads: beadMesh(), clock: 0, lastSim: null, running: false }
}

function isSoftwareRenderer(renderer) {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  return /swiftshader|llvmpipe|softpipe|software/i.test(String(name))
}

// ---- The component -----------------------------------------------------------------------------

const _cam = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

export default function PuddleRain() {
  const { gl, camera, scene, size } = useThree()
  const group = useRef()

  const [wanted, setWanted] = useState(false)
  const [library, setLibrary] = useState(null)
  // A software rasterizer (SwiftShader, llvmpipe: no GPU, as in headless checks) would take seconds a
  // frame here: it keeps the hero's splash alone, as the ending was before the rain.
  const software = useMemo(() => isSoftwareRenderer(gl), [gl])
  useFrame(() => {
    if (!wanted && !software && state.time >= PUDDLE_RAIN.loadAfter) setWanted(true)
  })
  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    loadLibrary(`${import.meta.env.BASE_URL}${PUDDLE_RAIN.url}`)
      .then((l) => !cancelled && setLibrary(l))
      .catch((err) => console.warn('[rain] rain on the puddle not available:', err.message))
    return () => {
      cancelled = true
    }
  }, [wanted])

  const schedule = useMemo(() => {
    if (!library) return null
    const wind = RAIN.wind
    return buildSchedule({
      seed: PUDDLE_RAIN.seed,
      period: PUDDLE_RAIN.period,
      tile: PUDDLE_RAIN.tile,
      rate: PUDDLE_RAIN.rate,
      variants: library.variants.map((v) => ({ weight: v.weight, slant: v.meta.slant ?? 0 })),
      wind: [wind[0], wind[1]],
    })
  }, [library])

  // Everything that draws, and the simulation, once the library is here: built in the effect, so
  // every mount gets its own and the unmount disposes exactly what it built.
  const worldRef = useRef(null)
  useEffect(() => {
    if (!library) return
    const world = createWorld(gl, library)
    worldRef.current = world
    // Dev hook for scripted checks (scripts/ending-capture.mjs): the simulation, the rain's clock, and
    // `hide` (a list of 'full', 'far', 'beads' not to draw).
    if (import.meta.env.DEV) window.__schwe = Object.assign(window.__schwe ?? {}, { puddleRain: world })
    const g = group.current
    for (const s of world.splashes) g.add(s.full.prepass, s.full.mesh, s.far.mesh)
    g.add(world.beads.mesh)
    // Ready it during the drift, not when the first drop lands, and a little each frame (the camera is
    // moving): one texture upload per frame (the largest are 4096 × 2600), then each shader's compile,
    // then one still step of the simulation, which compiles its passes.
    const textures = new Set()
    for (const s of world.splashes)
      for (const l of [s.full, s.far]) for (const u of Object.values(l.mesh.material.uniforms)) if (u.value?.isTexture) textures.add(u.value)
    world.warm = [
      ...[...textures].map((t) => () => gl.initTexture(t)),
      ...world.splashes.flatMap((s) => [s.full.prepass, s.full.mesh, s.far.mesh].map((m) => () => prewarm(gl, m, camera, scene))),
      () => prewarm(gl, world.beads.mesh, camera, scene),
      () => world.sim.step(0, false),
    ]
    return () => {
      worldRef.current = null
      for (const s of world.splashes)
        for (const l of [s.full, s.far]) {
          g.remove(l.mesh)
          l.mesh.geometry.dispose()
          l.mesh.material.dispose()
          if (l.prepass) {
            g.remove(l.prepass)
            l.prepass.material.dispose()
          }
        }
      g.remove(world.beads.mesh)
      world.beads.mesh.geometry.dispose()
      world.beads.mesh.material.dispose()
      world.pins.mesh.geometry.dispose()
      world.pins.mesh.material.dispose()
      world.sim.dispose()
      surfaceUniforms.uFieldOn.value = 0
      surfaceUniforms.uField.value = calmField
    }
  }, [library, gl, camera, scene])

  useFrame(() => {
    const world = worldRef.current
    if (!world || !schedule) return
    world.warm.shift()?.()
    const { sim, splashes, beads, pins } = world
    // Nothing until the rain starts; once it has, the surface runs as long as the puddle is in view
    // (scrolled back before the rain, its rings die away), and starts calm again next time.
    if (rig.follow === 0 || (!world.running && rig.rain === 0)) {
      for (const s of splashes) s.full.mesh.visible = s.full.prepass.visible = s.far.mesh.visible = false
      beads.mesh.visible = false
      if (world.running) {
        sim.reset()
        world.running = false
        world.lastSim = null
        surfaceUniforms.uFieldOn.value = 0
      }
      return
    }

    // The rain's clock is the scene's simulated time, scaled to the bakes' real seconds.
    const simTime = globalUniforms.uSimTime.value
    const dt = world.lastSim === null ? 0 : Math.max(0, simTime - world.lastSim) * PUDDLE_RAIN.clock
    world.lastSim = simTime
    world.clock += dt
    const clock = world.clock
    world.running = true

    // The tile's corner: the hero's impact at its centre.
    const tile = PUDDLE_RAIN.tile
    const ox = fall.impact.x - tile / 2
    const oz = fall.impact.z - tile / 2
    surfaceUniforms.uField.value = sim.field.texture
    surfaceUniforms.uFieldOrigin.value.set(ox, oz)
    surfaceUniforms.uFieldTile.value = tile
    surfaceUniforms.uFieldSize.value = sim.size
    surfaceUniforms.uFieldOn.value = 1

    camera.getWorldPosition(_cam)
    camera.getWorldDirection(_fwd)
    const groundY = SPLASH.groundY
    const { full: fullDist, far: farDist, fade: fadeDist } = PUDDLE_RAIN.lod
    const intensity = rig.rain
    const heroSettled = smooth(0.7, 1.0, rig.splash)
    const hx = fall.impact.x - ox
    const hz = fall.impact.z - oz
    const wpm = PUDDLE_RAIN.worldPerMeter
    const cellsPerWorld = sim.size / tile
    const release = PUDDLE_RAIN.pin.release
    const zone = overlay.typeZone

    for (const s of splashes) s.full.count = s.far.count = 0
    beads.count = 0
    pins.count = 0
    let lifeMax = 0
    for (const s of splashes) lifeMax = Math.max(lifeMax, s.life)

    forEachActive(schedule, clock, PUDDLE_RAIN.lead, lifeMax, (i, age) => {
      const s = splashes[schedule.variant[i]]
      const meta = s.variant.meta
      const local = age + s.lead // seconds since the bake's frame 0
      if (local >= s.life) return
      // Thinning: the rain comes in by rank; round the hero the rain waits for its jets.
      let fade = Math.min(Math.max((intensity * 1.05 - schedule.rank[i]) / 0.05, 0), 1)
      if (fade <= 0) return
      const x = schedule.x[i]
      const z = schedule.z[i]
      let dxh = x - hx
      let dzh = z - hz
      dxh -= tile * Math.round(dxh / tile)
      dzh -= tile * Math.round(dzh / tile)
      const heroMask = smooth(0.08, PUDDLE_RAIN.heroClear, Math.hypot(dxh, dzh))
      fade *= heroMask + (1 - heroMask) * heroSettled
      // The repeat of the tile nearest the camera; the others within reach are drawn too (below).
      let bx = ox + x
      let bz = oz + z
      bx += tile * Math.round((_cam.x - bx) / tile)
      bz += tile * Math.round((_cam.z - bz) / tile)
      if (fade <= 0.01) return
      const scale = schedule.scale[i]
      const clear = PUDDLE_RAIN.clear * meta.dropRadius * scale * wpm
      const crownHalf = meta.profile.reach * wpm // world units at scale 1
      const crownHeight = (meta.boundsMax[1] - meta.surfaceY) * wpm
      const cos = Math.cos(schedule.rot[i])
      const sin = Math.sin(schedule.rot[i])

      if (local >= 0) {
        const frame = Math.min(Math.floor(local / meta.frameSeconds), s.life / meta.frameSeconds - 1)
        // Pin the surface to the bake's, in every copy the pin overlaps (it may cross the tile's edge).
        const w = fade * (1 - smooth(1 - release, 1, frame / (meta.frames - 1)))
        if (w > 0.001 && pins.count < CAP.pins) {
          const radiusCells = meta.profile.reach * PUDDLE_RAIN.pin.outer * scale * wpm * cellsPerWorld + 2
          const cx = x * cellsPerWorld
          const cz = z * cellsPerWorld
          const N = sim.size
          // A pin sticking out past one edge of the tile comes back in at the opposite one.
          const xs = [cx]
          if (cx + radiusCells > N) xs.push(cx - N)
          if (cx - radiusCells < 0) xs.push(cx + N)
          const zs = [cz]
          if (cz + radiusCells > N) zs.push(cz - N)
          if (cz - radiusCells < 0) zs.push(cz + N)
          const row = s.variant.profileRow + local / meta.frameSeconds
          for (const px of xs)
            for (const pz of zs) {
              if (pins.count >= CAP.pins) break
              const k = pins.count++ * 4
              pins.a.array.set([px, pz, radiusCells, row], k)
              pins.b.array.set([1 / (cellsPerWorld * wpm * scale), scale, w, meta.profile.reach], k)
            }
        }
        // The bake ends with its water still moving: the splash fades out over its last quarter while its
        // pin lets go, and the live surface carries on from the shape it was held to.
        const ending = 1 - smooth(0.75, 1, frame / (meta.frames - 1))
        for (let cx = -1; cx <= 1; cx++)
          for (let cz = -1; cz <= 1; cz++) {
            const wx = bx + cx * tile
            const wz = bz + cz * tile
            const dist = Math.hypot(wx - _cam.x, wz - _cam.z)
            if (dist > farDist) continue
            // Behind the camera: skip (the ground point's direction against the view).
            const ahead = (wx - _cam.x) * _fwd.x + (wz - _cam.z) * _fwd.z
            if (ahead < -0.5) continue
            let f = fade * ending * (1 - smooth(fadeDist, farDist, dist)) * smooth(clear * 0.6, clear, dist)
            if (f <= 0.01) continue
            if (zone) f *= typeClear(camera, size, zone, wx, groundY, wz, crownHalf * scale, crownHeight * scale)
            if (f <= 0.01) continue
            // A drop close by that landed during this step is heard.
            if (local < dt && dist < 2.2 && f > 0.5) {
              const side = ((wx - _cam.x) * -_fwd.z + (wz - _cam.z) * _fwd.x) / Math.max(dist, 1e-3)
              plink(meta.dropRadius * 1000 * scale, dist, side)
            }
            const lod = dist < fullDist ? s.full : s.far
            if (lod.count >= lod.cap) continue
            const k = lod.count++ * 4
            lod.a.array.set([wx, groundY, wz, frame], k)
            lod.b.array.set([cos, sin, scale, f], k)
          }
      } else if (beads.count < CAP.beads) {
        // Still falling: the bead is the bake's drop, before its first frame.
        const [vx, vy] = meta.velocity
        const px = meta.dropStartX + vx * local
        const height = meta.dropStartAbove + vy * local
        const rw = scale * wpm
        const speed = Math.hypot(vx, vy)
        const onScreen = speed * rw * (PUDDLE_RAIN.clock * globalUniforms.uTimeScale.value) // world units per second, as seen
        for (let cx = -1; cx <= 1; cx++)
          for (let cz = -1; cz <= 1; cz++) {
            const wx = bx + cx * tile
            const wz = bz + cz * tile
            const dist = Math.hypot(wx - _cam.x, wz - _cam.z)
            if (dist > farDist || dist < clear * 0.6 || beads.count >= CAP.beads) continue
            const k = beads.count++ * 4
            // Local +x turned by the instance's rotation: (cos, -sin) in world x, z.
            beads.a.array.set([wx + cos * px * rw, groundY + height * rw, wz - sin * px * rw, meta.dropRadius * rw], k)
            // Stretched by half its motion blur: a solid bead drawn as long as the whole blur reads as a rod.
            beads.b.array.set([(cos * vx) / speed, vy / speed, (-sin * vx) / speed, (0.5 * onScreen * RAIN.shutter) / (2 * meta.dropRadius * rw)], k)
          }
      }
    })

    const hide = import.meta.env.DEV ? world.hide : null // dev: 'full', 'far', 'beads'
    const upload = (l, name) => {
      l.mesh.geometry.instanceCount = l.count
      l.mesh.visible = l.count > 0 && !hide?.includes(name)
      if (l.prepass) l.prepass.visible = l.mesh.visible
      if (l.count) {
        l.a.needsUpdate = true
        l.b.needsUpdate = true
      }
    }
    for (const s of splashes) {
      upload(s.full, 'full')
      upload(s.far, 'far')
    }
    upload(beads, 'beads')
    pins.mesh.geometry.instanceCount = pins.count
    if (pins.count) {
      pins.a.needsUpdate = true
      pins.b.needsUpdate = true
    }
    if (dt > 0) sim.step(dt, pins.count > 0)
  })

  return <group ref={group} />
}
