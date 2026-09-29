import * as THREE from 'three'
import { SKY } from '../config.js'
import atmosphere from '../shaders/sky/atmosphere.glsl?raw'
import skyChunk from '../shaders/sky/sky.glsl?raw'
import { createCloudNoise } from './cloudNoise.js'
import { createHillaire, lutTarget } from './hillaire.js'
import { loadStarTexture } from './stars.js'

// Sky as a drop's content source. createSkyGlobals() builds what every city shares, once per visit:
// the atmosphere model's tables, the star catalogue and the cloud noise. A CitySky holds one city's
// sky-view texture and the uniforms its drop reads; set() takes new inputs (src/sky/inputs.js) and
// the texture is re-rendered only when an input it depends on has changed.

const GLSL = `${atmosphere}\n${skyChunk}`

export async function createSkyGlobals(renderer, { model = createHillaire } = {}) {
  const atmosphereModel = model(renderer)
  atmosphereModel.init()
  const stars = await loadStarTexture(`${import.meta.env.BASE_URL}${SKY.stars.url}`, SKY.stars.cells).catch((err) => {
    console.warn('[sky] star catalogue unavailable, sky without stars:', err.message)
    return null
  })
  const glow = SKY.cityGlow
  const uniforms = {
    ...atmosphereModel.shared,
    uSkyStars: { value: stars?.texture ?? null },
    uSkyStarCells: { value: SKY.stars.cells },
    uSkySeeing: { value: THREE.MathUtils.degToRad(SKY.stars.seeingDeg) },
    uSkyCloudNoise: { value: createCloudNoise() },
    uSkyCityShape: { value: new THREE.Vector3(glow.horizon, glow.cloud, glow.ground) },
  }
  return {
    atmosphere: atmosphereModel,
    stars,
    uniforms,
    dispose() {
      atmosphereModel.dispose()
      stars?.texture.dispose()
      uniforms.uSkyCloudNoise.value.dispose()
    },
  }
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
    this.content = { glsl: GLSL, uniforms: this.uniforms }
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
    const c = inputs.clouds
    u.uSkyCloud.value.set(c.cover, c.tau, c.baseKm, c.tileKm)
    u.uSkyCloudOffset.value.fromArray(c.offset)
    u.uSkyCityGlow.value.fromArray(inputs.cityGlow)
    u.uSkyHaze.value = inputs.haze
    u.uSkyPreExposure.value = inputs.exposure
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
