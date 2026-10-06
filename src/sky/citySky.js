import * as THREE from 'three'
import { SKY } from '../config.js'
import SKYLINES from '../content/skylines.json'
import skyChunk from '../shaders/sky/sky.glsl?raw'
import { loadCloudNoise } from './cloudNoise.js'
import { createHillaire, lutTarget } from './hillaire.js'
import { skylineVariant } from './skylineVariant.js'
import { loadStarTexture } from './stars.js'
import { waveEnergy, waveTrains } from './waves.js'

// Sky as a drop's content source. createSkyGlobals() builds what every city shares, once per visit:
// the atmosphere model's tables, the star catalogue and the cloud noise. It returns at once; `ready`
// resolves when the catalogue and noise have arrived, and the model's tables are drawn by the caller
// (atmosphere.init(), or atmosphere.initSteps() one per frame). A CitySky holds one city's sky-view
// texture and the uniforms its drop reads; set() takes new inputs (src/sky/inputs.js) and the texture
// is re-rendered only when an input it depends on has changed.

// The cities' own clock, seconds (their falling rain in sky.glsl). Live, not the site's simulated time:
// the city in a drop goes on when the rain around the drop freezes. Set by the drops each frame.
export const skyClock = { value: 0 }

// `coefficients`: the atmosphere at the channels' wavelengths (SKY.atmosphere; the lab can swap it).
export function createSkyGlobals(renderer, { model = createHillaire, coefficients = SKY.atmosphere } = {}) {
  const atmosphereModel = model(renderer, { coefficients })
  const glow = SKY.cityGlow
  const uniforms = {
    ...atmosphereModel.shared,
    uSkyStars: { value: null },
    uSkyStarCells: { value: SKY.stars.cells },
    uSkySeeing: { value: THREE.MathUtils.degToRad(SKY.stars.seeingDeg) },
    uSkyCloudNoise: { value: null },
    uSkyCityShape: { value: new THREE.Vector3(glow.horizon, glow.cloud, glow.ground) },
    uSkyCityMottle: { value: glow.mottle ?? 0 },
    uSkyTime: skyClock,
  }
  const globals = {
    atmosphere: atmosphereModel,
    maxAnisotropy: renderer.capabilities?.getMaxAnisotropy?.() ?? 1, // the water's streaks read the mirror anisotropically
    stars: null, // until it loads (or if it fails) the sky has no stars
    uniforms,
    dispose() {
      atmosphereModel.dispose()
      uniforms.uSkyStars.value?.dispose()
      uniforms.uSkyCloudNoise.value?.dispose()
    },
  }
  const stars = loadStarTexture(`${import.meta.env.BASE_URL}${SKY.stars.url}`, SKY.stars.cells).then(
    (s) => {
      globals.stars = s
      uniforms.uSkyStars.value = s.texture
    },
    (err) => console.warn('[sky] star catalogue unavailable, sky without stars:', err.message)
  )
  const noise = loadCloudNoise().then((t) => (uniforms.uSkyCloudNoise.value = t))
  globals.ready = Promise.all([stars, noise]).then(() => globals)
  return globals
}

const NO_SKYLINE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
NO_SKYLINE.needsUpdate = true

// Images fetched ahead of need (CitySky.prefetch), held compressed until a set takes them.
const blobs = new Map() // url → Promise<Blob>
async function fetchBlob(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.blob()
}
function takeBlob(url) {
  const blob = blobs.get(url)
  blobs.delete(url)
  return blob ? blob.catch(() => fetchBlob(url)) : fetchBlob(url)
}

// One of a skyline's images, rows bottom-up (v runs up with elevation). RGB is light encoded sRGB, so the
// GPU decodes it before filtering and its mip levels average light as a camera would; alpha is data.
// The decoded image is let go once it is on the GPU.
// `grey`: one linear channel (the trees' sway), not light: kept as one byte a texel.
async function loadSkylineImage(url, anisotropy = 1, grey = false) {
  const blob = await takeBlob(url)
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  if (grey) return greyTexture(bitmap)
  const texture = new THREE.Texture(bitmap)
  texture.flipY = false
  texture.premultiplyAlpha = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = anisotropy
  texture.userData.bytes = (bitmap.width * bitmap.height * 4 * 4) / 3 // on the GPU, with its mip levels
  texture.onUpdate = () => bitmap.close()
  texture.needsUpdate = true
  return texture
}

const bitmapPixels = (bitmap) => {
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
}

function greyTexture(bitmap) {
  const { width: w, height: h } = bitmap
  const rgba = bitmapPixels(bitmap)
  bitmap.close()
  const data = new Uint8Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]
  const texture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.unpackAlignment = 1
  texture.userData.bytes = (w * h * 4) / 3
  texture.needsUpdate = true
  return texture
}

// A city's skyline (scripts/blender/: rendered in Blender, packed by encode.py): its meta, the variant
// for this month and its scales. null when the city has none.
async function loadSkylineMeta(cityId, month = new Date().getUTCMonth() + 1) {
  if (!SKYLINES.includes(cityId)) return null // not rendered yet (scripts/build-skyline-index.mjs)
  const base = `${import.meta.env.BASE_URL}${SKY.skyline.url}${cityId}`
  const res = await fetch(`${base}.json`)
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
  const meta = await res.json()
  const variant = meta.version === 2 ? skylineVariant(meta, month) : null
  if (!variant) return null
  return { base, meta, variant, scale: meta.variants[variant].scale }
}

// One set of the skyline's images (SKY.skyline.sets: full size, or a smaller copy): three textures
// (daylight and coverage; the fixed lights and distance; the windows); where the city has water, the same
// three for its reflection (the mirror render); after dark, its glow and halo, and the lens's starbursts
// where it has them. setUrls lists them, loadSkylineSet loads them.
function setUrls({ base, meta, variant, scale }, set) {
  const dir = `${base}/${set}${variant}`
  const urls = { light: `${dir}-light.png`, night: `${dir}-night.png`, windows: `${dir}-windows.png` }
  if (meta.mirror && scale.mirror) Object.assign(urls, { mirrorLight: `${dir}-mirror-light.png`, mirrorNight: `${dir}-mirror-night.png`, mirrorWindows: `${dir}-mirror-windows.png` })
  if (meta.glow && scale.glow) Object.assign(urls, { glow: `${dir}-glow.png`, halo: `${dir}-halo.png` })
  if (meta.glow && scale.glow && scale.star) urls.star = `${dir}-star.png`
  if (scale.trees) urls.trees = `${dir}-trees.png`
  return urls
}

// Dev: ?reach=0 marches every step (mirrorHit), for before/after comparisons.
const MIRROR_REACH = !(import.meta.env.DEV && new URLSearchParams(location.search).get('reach') === '0')

const MIRRORS = new Set(['mirrorLight', 'mirrorNight', 'mirrorWindows']) // the water's streaks read these anisotropically

async function loadSkylineSet(m, set, anisotropy) {
  const entries = Object.entries(setUrls(m, set))
  const loaded = await Promise.all(entries.map(([k, url]) => loadSkylineImage(url, MIRRORS.has(k) ? anisotropy : 1, k === 'trees')))
  const textures = Object.fromEntries(entries.map(([k], i) => [k, loaded[i]]))
  if (textures.mirrorLight) textures.mirrorReach = mirrorReach(textures.mirrorLight.image, textures.mirrorNight.image)
  return textures
}

// What mirrorHit (sky.glsl) needs to skip the steps that cannot hit: for each texel column c of the mirror
// render, the nearest thing (log distance as stored, the night image's alpha over coverage, 0 near to 1
// far) over columns c and c + 1 and, at level j, over 2^j rows, the levels stacked bottom up, each half the
// last's height (rounded up). Rounded down to 8 bits, so it never says farther than the render holds;
// texels with no coverage count as farthest. Read from the decoded images before they go to the GPU.
function mirrorReach(lightBitmap, nightBitmap) {
  const { width: w, height: h } = lightBitmap
  const L = bitmapPixels(lightBitmap)
  const N = bitmapPixels(nightBitmap)
  const heights = [h]
  while (heights.at(-1) > 1) heights.push(Math.ceil(heights.at(-1) / 2))
  const data = new Uint8Array(w * heights.reduce((a, b) => a + b, 0))
  const near = (c, r) => {
    const i = (r * w + c) * 4 + 3
    return L[i] ? Math.min(255, Math.floor((255 * N[i]) / L[i])) : 255
  }
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = Math.min(near(c, r), near(Math.min(c + 1, w - 1), r))
  let below = 0
  for (let j = 1; j < heights.length; j++) {
    const at = below + heights[j - 1]
    for (let r = 0; r < heights[j]; r++) {
      const r0 = below + 2 * r
      const r1 = below + Math.min(2 * r + 1, heights[j - 1] - 1)
      for (let c = 0; c < w; c++) data[(at + r) * w + c] = Math.min(data[r0 * w + c], data[r1 * w + c])
    }
    below = at
  }
  const texture = new THREE.DataTexture(data, w, data.length / w, THREE.RedFormat, THREE.UnsignedByteType)
  texture.minFilter = texture.magFilter = THREE.NearestFilter
  texture.unpackAlignment = 1
  texture.userData.bytes = data.length
  texture.needsUpdate = true
  return texture
}

const disposeAll = (textures) => Object.values(textures ?? {}).forEach((t) => t?.dispose())

const WAVES = SKY.water.waves

const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

export class CitySky {
  constructor(globals, [width, height], cityId = null, { detail = 'full', upload = async () => {} } = {}) {
    this.globals = globals
    this.target = lutTarget(width, height, { wrapS: THREE.RepeatWrapping }) // azimuth wraps
    this.lutKey = null
    this.inputs = null
    this.renders = 0
    this.uniforms = {
      ...globals.uniforms,
      uSkyView: { value: this.target.texture },
      uSkyViewSize: { value: new THREE.Vector2(width, height) },
      uSkyViewHeight: { value: SKY.viewHeightKm },
      uSkyCityBasis: { value: new THREE.Matrix3() },
      uSkyEquatorial: { value: new THREE.Matrix3() },
      uSkySunDir: { value: new THREE.Vector3() },
      uSkyMoonDir: { value: new THREE.Vector3() },
      uSkySunE: { value: 0 },
      uSkySunDisk: { value: 0 },
      uSkyMoonE: { value: new THREE.Vector3() },
      uSkyMoonOn: { value: 0 },
      uSkyMoon: { value: new THREE.Vector3() },
      uSkyMoonTint: { value: new THREE.Vector3() },
      uSkyStarScale: { value: 0 },
      uSkyCloud: { value: new THREE.Vector4() },
      uSkyCloudOffset: { value: new THREE.Vector2() },
      uSkyCityGlow: { value: new THREE.Vector3() },
      uSkyHaze: { value: 0 },
      uSkyRain: { value: 0 },
      uSkyPreExposure: { value: 1 },
      uSkyMeter: { value: new THREE.Vector3(SKY.exposure.key, SKY.exposure.ref, SKY.exposure.range) },
      uSkylineLight: { value: NO_SKYLINE },
      uSkylineNight: { value: NO_SKYLINE },
      uSkylineWindows: { value: NO_SKYLINE },
      uSkylineOn: { value: 0 },
      uSkylineRect: { value: new THREE.Vector4() },
      uSkylineDist: { value: new THREE.Vector2() },
      uSkylineScale: { value: new THREE.Vector3() },
      uSkylineLit: { value: new THREE.Vector3() },
      uSkylineGain: { value: new THREE.Vector3(SKY.skyline.lights, SKY.skyline.windows, SKY.skyline.hazePerKm) },
      uSkylineHazeHeight: { value: SKY.skyline.hazeHeight },
      uSkylineMirrorLight: { value: NO_SKYLINE },
      uSkylineMirrorNight: { value: NO_SKYLINE },
      uSkylineMirrorWindows: { value: NO_SKYLINE },
      uSkylineMirrorRect: { value: new THREE.Vector4() },
      uSkylineMirrorScale: { value: new THREE.Vector3() },
      uSkylineWater: { value: new THREE.Vector2() },
      uSkylineMirrorReach: { value: NO_SKYLINE },
      uSkylineMirrorReachOn: { value: 0 },
      uSkyWaves: { value: Array.from({ length: WAVES }, () => new THREE.Vector4()) },
      uSkyWaveTail: { value: new THREE.Vector4() },
      uSkyGlitter: { value: new THREE.Vector3(1, 1, 1) },
      uSkyWaterBody: { value: new THREE.Vector3(...SKY.water.body) },
      uSkylineGlow: { value: NO_SKYLINE },
      uSkylineHalo: { value: NO_SKYLINE },
      uSkylineGlowRect: { value: new THREE.Vector4() },
      uSkylineGlowScale: { value: new THREE.Vector3() },
      uSkylineGlowGain: { value: new THREE.Vector3(SKY.glow.tight, SKY.glow.wide, SKY.glow.haze) },
      uSkylineStar: { value: NO_SKYLINE },
      uSkylineTrees: { value: NO_SKYLINE },
      uSkylineTreeSway: { value: new THREE.Vector4() }, // sway at the crown's top (rad), lean across the view (-1..1), swing (rad/s), flutter share
      uSkylineStarGain: { value: 0 },
      uSkyLift: { value: new THREE.Vector3() },
      uSkyGain: { value: new THREE.Vector3(1, 1, 1) },
      uSkyLook: { value: new THREE.Vector2(1, 1) },
    }
    this.fetch = SKY.water.fetch[cityId] ?? SKY.water.defaultFetch
    this.waves = null // the trains, fixed once the wind is first known (src/sky/waves.js)
    this.wind = 0
    this.rain = 0
    // The skyline: its meta now, a set of its images once a drop asks for one (setDetail). `upload`
    // puts a set's textures on the GPU before they are shown (the site spreads that over frames).
    this.upload = upload
    this.skylineMeta = cityId
      ? loadSkylineMeta(cityId).catch((err) => console.warn(`[sky] no skyline for ${cityId}:`, err.message))
      : Promise.resolve(null)
    this.detail = null // the set asked for (a key of SKY.skyline.sets), null for none
    this.loads = 0
    this.skyline = null // the set shown: { meta, scale, detail, textures }
    this.settled = null
    // What HeroDrop needs to draw this sky: the shader code and the uniforms, shared by reference.
    this.content = { glsl: `${globals.atmosphere.glsl}\n${skyChunk}`, uniforms: this.uniforms }
    this.setDetail(detail)
  }

  // Which set of the skyline's images to hold (a key of SKY.skyline.sets), or null for none. The set
  // shown stays until the new one is on the GPU; the old one is then let go.
  setDetail(detail) {
    if (detail === this.detail) return
    this.detail = detail
    const load = ++this.loads
    const current = () => load === this.loads
    if (!detail) return this.showSkyline(null)
    this.skylineMeta
      .then(async (m) => {
        if (!m && current()) this.settled = detail // nothing to show
        if (!m || !current()) return
        const textures = await loadSkylineSet(m, SKY.skyline.sets[detail], this.globals.maxAnisotropy)
        if (current()) await this.upload(Object.values(textures))
        if (current()) this.showSkyline({ meta: m.meta, scale: m.scale, detail, textures })
        else disposeAll(textures)
      })
      .catch((err) => console.warn(`[sky] skyline set ${detail} unavailable:`, err.message))
  }

  // Dev: the set asked for is the one shown.
  get skylineSettled() {
    return this.settled === this.detail
  }

  // Fetch a set's images now, held compressed until setDetail asks for that set (resolves when they are in).
  prefetch(detail) {
    return this.skylineMeta.then((m) => {
      if (!m) return
      const urls = Object.values(setUrls(m, SKY.skyline.sets[detail]))
      for (const url of urls) if (!blobs.has(url)) blobs.set(url, fetchBlob(url))
      return Promise.allSettled(urls.map((url) => blobs.get(url)))
    })
  }

  showSkyline(s) {
    const old = this.skyline
    this.skyline = s
    this.settled = s?.detail ?? null
    const u = this.uniforms
    const t = s?.textures ?? {}
    u.uSkylineLight.value = t.light ?? NO_SKYLINE
    u.uSkylineNight.value = t.night ?? NO_SKYLINE
    u.uSkylineWindows.value = t.windows ?? NO_SKYLINE
    u.uSkylineMirrorLight.value = t.mirrorLight ?? NO_SKYLINE
    u.uSkylineMirrorNight.value = t.mirrorNight ?? NO_SKYLINE
    u.uSkylineMirrorWindows.value = t.mirrorWindows ?? NO_SKYLINE
    u.uSkylineMirrorReach.value = t.mirrorReach ?? NO_SKYLINE
    u.uSkylineMirrorReachOn.value = t.mirrorReach && MIRROR_REACH ? 1 : 0
    u.uSkylineGlow.value = t.glow ?? NO_SKYLINE
    u.uSkylineHalo.value = t.halo ?? NO_SKYLINE
    u.uSkylineStar.value = t.star ?? NO_SKYLINE
    u.uSkylineTrees.value = t.trees ?? NO_SKYLINE
    u.uSkylineOn.value = s ? 1 : 0
    if (s && !old) {
      this.setTrees(this.wind) // its lean follows the panorama's bearing
      const RAD = Math.PI / 180
      const { meta, scale } = s
      u.uSkylineScale.value.set(scale.light, scale.night, scale.windows)
      u.uSkylineRect.value.set(meta.azimuth[0] * RAD, meta.azimuth[1] * RAD, meta.elevation[0] * RAD, (meta.elevation[1] - meta.elevation[0]) * RAD)
      u.uSkylineDist.value.set(Math.log(meta.distance[0]), Math.log(meta.distance[1] / meta.distance[0]))
      if (t.mirrorLight) {
        const m = meta.mirror
        u.uSkylineMirrorScale.value.set(scale.mirror.light, scale.mirror.night, scale.mirror.windows)
        u.uSkylineMirrorRect.value.set(meta.azimuth[0] * RAD, meta.azimuth[1] * RAD, m.elevation[0] * RAD, (m.elevation[1] - m.elevation[0]) * RAD)
        u.uSkylineWater.value.set(1, m.eyeAboveWater)
      }
      if (t.glow) {
        const g = meta.glow
        u.uSkylineGlowScale.value.set(scale.glow, scale.halo, g.lateShare)
        u.uSkylineGlowRect.value.set(meta.azimuth[0] * RAD, meta.azimuth[1] * RAD, g.elevation[0] * RAD, (g.elevation[1] - g.elevation[0]) * RAD)
        u.uSkylineStarGain.value = t.star ? scale.star * SKY.glow.star : 0
      }
    }
    disposeAll(old?.textures)
  }

  get dirty() {
    return this.inputs !== null && this.inputs.lutKey !== this.lutKey
  }

  set(inputs) {
    this.inputs = inputs
    const u = this.uniforms
    const { view, right, up } = inputs.cityBasis
    u.uSkyCityBasis.value.set(view[0], right[0], up[0], view[1], right[1], up[1], view[2], right[2], up[2])
    u.uSkyEquatorial.value.set(...inputs.equatorial.flat())
    u.uSkySunDir.value.fromArray(inputs.sun.dir)
    u.uSkyMoonDir.value.fromArray(inputs.moon.dir)
    u.uSkySunE.value = inputs.sunE
    u.uSkySunDisk.value = inputs.sunDisk
    u.uSkyMoonE.value.fromArray(inputs.moonE)
    u.uSkyMoonOn.value = inputs.moonOn ? 1 : 0
    u.uSkyMoon.value.set(inputs.moon.radius, inputs.moonDisk, inputs.earthshine)
    u.uSkyMoonTint.value.fromArray(inputs.moonTint)
    u.uSkyStarScale.value = this.globals.stars ? inputs.starScale : 0
    u.uSkyCloudOffset.value.fromArray(inputs.clouds.offset)
    u.uSkyCityGlow.value.fromArray(inputs.cityGlow)
    u.uSkyPreExposure.value = inputs.exposure
    u.uSkylineLit.value.set(1 - inputs.windows.late, inputs.windows.late, inputs.windows.dark)
    // The camera's look, day and night mixed by how dark it is.
    const { day, night } = SKY.grade
    const k = inputs.windows.dark
    const mix = (a, b) => a + (b - a) * k
    u.uSkyLift.value.set(...day.lift.map((v, i) => mix(v, night.lift[i])))
    u.uSkyGain.value.set(...day.gain.map((v, i) => mix(v, night.gain[i])))
    u.uSkyLook.value.set(mix(day.contrast, night.contrast), mix(day.saturation, night.saturation))
    // The waves run where the wind blows. Their trains are laid once; a later reading turns them only
    // if the wind has swung well round (turning them moves the whole pattern at once).
    const toward = inputs.wind.towardDeg
    if (!this.waves || (toward != null && angleBetween(toward, this.waves.towardDeg) > 45)) this.layWaves(inputs.wind.ms, toward ?? 0)
    this.setWeather(inputs.clouds, inputs.haze, inputs.rain, inputs.wind.ms)
  }

  layWaves(windMs, towardDeg) {
    this.waves = { ...waveTrains({ windMs, towardDeg, fetchM: this.fetch, count: WAVES }), towardDeg }
    const u = this.uniforms
    const g = this.waves.glitter
    u.uSkyGlitter.value.set(g.cell, g.period, g.cycles)
    this.setWaves(windMs, this.rain)
  }

  setWaves(windMs, rain) {
    this.wind = windMs
    this.rain = rain
    if (!this.waves) return
    const w = SKY.water
    const e = waveEnergy(this.waves, { windMs, fetchM: this.fetch, slopeScale: w.slopeScale, rainMmH: rain, rainSlope: w.rainSlope })
    const u = this.uniforms
    this.waves.trains.forEach((t, i) => u.uSkyWaves.value[i].set(t.vector[0], t.vector[1], e.amplitudes[i], t.omega))
    u.uSkyWaveTail.value.set(this.waves.dir[0], this.waves.dir[1], e.tail[0], e.tail[1])
    this.setTrees(windMs)
  }

  // The trees' sway in this wind (SKY.skyline.trees): stronger with it, leaning as it blows across the view.
  setTrees(windMs) {
    const { sway, windFull, period, flutter } = SKY.skyline.trees
    const k = Math.min(Math.max(windMs / windFull, 0), 1)
    const bearing = this.skyline?.meta.bearing ?? 0
    const across = this.waves ? Math.sin(((this.waves.towardDeg - bearing) * Math.PI) / 180) : 0
    const deg = sway[0] + (sway[1] - sway[0]) * k
    this.uniforms.uSkylineTreeSway.value.set((deg * Math.PI) / 180, across * k, (2 * Math.PI) / period, flutter)
  }

  // Weather only (cloud deck, haze, rain, wind): the site eases these between readings, so a new reading
  // never cuts. Never re-renders the texture, which does not depend on weather.
  setWeather({ cover, tau, baseKm, tileKm }, haze, rain = 0, wind = this.wind) {
    this.uniforms.uSkyCloud.value.set(cover, tau, baseKm, tileKm)
    this.uniforms.uSkyHaze.value = haze
    this.uniforms.uSkyRain.value = rain
    if (wind !== this.wind || rain !== this.rain) this.setWaves(wind, rain)
  }

  render(renderer) {
    if (!this.inputs) return
    this.globals.atmosphere.renderSkyView(this.target, this.inputs, { viewHeightKm: SKY.viewHeightKm, groundAlbedo: SKY.groundAlbedo })
    this.lutKey = this.inputs.lutKey
    this.renders++
  }

  dispose() {
    this.target.dispose()
    this.loads++
    disposeAll(this.skyline?.textures)
  }
}
