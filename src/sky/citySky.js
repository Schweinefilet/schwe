import * as THREE from 'three'
import { SKY } from '../config.js'
import skyChunk from '../shaders/sky/sky.glsl?raw'
import { loadCloudNoise } from './cloudNoise.js'
import { createHillaire, lutTarget } from './hillaire.js'
import { skylineVariant } from './skylineVariant.js'
import { loadStarTexture } from './stars.js'

// Sky as a drop's content source. createSkyGlobals() builds what every city shares, once per visit:
// the atmosphere model's tables, the star catalogue and the cloud noise. It returns at once; `ready`
// resolves when the catalogue and noise have arrived, and the model's tables are drawn by the caller
// (atmosphere.init(), or atmosphere.initSteps() one per frame). A CitySky holds one city's sky-view
// texture and the uniforms its drop reads; set() takes new inputs (src/sky/inputs.js) and the texture
// is re-rendered only when an input it depends on has changed.

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
  }
  const globals = {
    atmosphere: atmosphereModel,
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

// One of a skyline's images, rows bottom-up (v runs up with elevation). RGB is light encoded sRGB, so the
// GPU decodes it before filtering and its mip levels average light as a camera would; alpha is data.
async function loadSkylineImage(url) {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const texture = new THREE.Texture(bitmap)
  texture.flipY = false
  texture.premultiplyAlpha = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

// A city's skyline (scripts/blender/: rendered in Blender, packed by encode.py): the variant for this
// month as three textures (daylight and coverage; the fixed lights and distance; the windows), their
// scales, and where the panorama sits in the sky. null when the city has none.
async function loadSkyline(cityId, month = new Date().getUTCMonth() + 1) {
  const base = `${import.meta.env.BASE_URL}${SKY.skyline.url}${cityId}`
  const res = await fetch(`${base}.json`)
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
  const meta = await res.json()
  const variant = meta.version === 2 ? skylineVariant(meta, month) : null
  if (!variant) return null
  const [light, night, windows] = await Promise.all(['light', 'night', 'windows'].map((k) => loadSkylineImage(`${base}/${variant}-${k}.png`)))
  return { meta, variant, scale: meta.variants[variant].scale, textures: { light, night, windows } }
}

export class CitySky {
  constructor(globals, [width, height], cityId = null) {
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
    }
    if (cityId)
      loadSkyline(cityId).then(
        (s) => {
          if (!s) return
          const RAD = Math.PI / 180
          const u = this.uniforms
          this.skyline = s
          u.uSkylineLight.value = s.textures.light
          u.uSkylineNight.value = s.textures.night
          u.uSkylineWindows.value = s.textures.windows
          u.uSkylineScale.value.set(s.scale.light, s.scale.night, s.scale.windows)
          u.uSkylineRect.value.set(s.meta.azimuth[0] * RAD, s.meta.azimuth[1] * RAD, s.meta.elevation[0] * RAD, (s.meta.elevation[1] - s.meta.elevation[0]) * RAD)
          u.uSkylineDist.value.set(Math.log(s.meta.distance[0]), Math.log(s.meta.distance[1] / s.meta.distance[0]))
          u.uSkylineOn.value = 1
        },
        (err) => console.warn(`[sky] no skyline for ${cityId}:`, err.message)
      )
    // What HeroDrop needs to draw this sky: the shader code and the uniforms, shared by reference.
    this.content = { glsl: `${globals.atmosphere.glsl}\n${skyChunk}`, uniforms: this.uniforms }
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
    this.setWeather(inputs.clouds, inputs.haze)
  }

  // Weather only (cloud deck and haze): the site eases these between readings, so a new reading never
  // cuts. Never re-renders the texture, which does not depend on weather.
  setWeather({ cover, tau, baseKm, tileKm }, haze) {
    this.uniforms.uSkyCloud.value.set(cover, tau, baseKm, tileKm)
    this.uniforms.uSkyHaze.value = haze
  }

  render(renderer) {
    if (!this.inputs) return
    this.globals.atmosphere.renderSkyView(this.target, this.inputs, { viewHeightKm: SKY.viewHeightKm, groundAlbedo: SKY.groundAlbedo })
    this.lutKey = this.inputs.lutKey
    this.renders++
  }

  dispose() {
    this.target.dispose()
    for (const t of Object.values(this.skyline?.textures ?? {})) t.dispose()
  }
}
