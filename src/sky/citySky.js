import * as THREE from 'three'
import { SKY } from '../config.js'
import skyChunk from '../shaders/sky/sky.glsl?raw'
import { loadCloudNoise } from './cloudNoise.js'
import { createHillaire, lutTarget } from './hillaire.js'
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

export class CitySky {
  constructor(globals, [width, height]) {
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
    }
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
  }
}
