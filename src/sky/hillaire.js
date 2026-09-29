import * as THREE from 'three'
import atmosphere from '../shaders/sky/atmosphere.glsl?raw'
import transmittanceFrag from '../shaders/sky/transmittance.frag.glsl?raw'
import multiscatterFrag from '../shaders/sky/multiscatter.frag.glsl?raw'
import skyviewFrag from '../shaders/sky/skyview.frag.glsl?raw'

// The atmosphere model: Hillaire 2020. What the rest of the sky code relies on is only this object's
// shape, so a different model can replace it:
//   shared            uniforms every sky shader samples (uTransmittance, Bruneton's layout; uMultiScattering)
//   init()            per-visit precompute
//   renderSkyView(target, inputs, { viewHeightKm, groundAlbedo })
//                     one city's clear sky, every direction, into its sky-view texture (atmosphere.glsl layout)
// Units: km; light values arrive already multiplied by the city's exposure.

const vertexShader = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`

// One triangle that covers the whole target.
const triangle = new THREE.BufferGeometry()
triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
const camera = new THREE.Camera()

function makePass(fragment, uniforms) {
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: `${atmosphere}\n${fragment}`, uniforms, depthTest: false, depthWrite: false })
  const mesh = new THREE.Mesh(triangle, material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  return { scene, material }
}

export function lutTarget(width, height, options = {}) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
    ...options,
  })
}

export function drawPass(renderer, pass, target) {
  const previous = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  renderer.render(pass.scene, camera)
  renderer.setRenderTarget(previous)
}

export function createHillaire(renderer) {
  const transmittance = lutTarget(256, 64)
  const multi = lutTarget(32, 32)
  const shared = {
    uTransmittance: { value: transmittance.texture },
    uMultiScattering: { value: multi.texture },
  }
  const transmittancePass = makePass(transmittanceFrag, {})
  const multiPass = makePass(multiscatterFrag, { ...shared })
  const skyUniforms = {
    ...shared,
    uSize: { value: new THREE.Vector2() },
    uViewHeight: { value: 0.2 },
    uGroundAlbedo: { value: 0.1 },
    uSunDir: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3() },
    uSunE: { value: 0 },
    uMoonE: { value: new THREE.Vector3() },
    uMoonOn: { value: 0 },
  }
  const skyPass = makePass(skyviewFrag, skyUniforms)

  return {
    name: 'hillaire',
    shared,
    init() {
      drawPass(renderer, transmittancePass, transmittance)
      drawPass(renderer, multiPass, multi)
    },
    renderSkyView(target, inputs, { viewHeightKm, groundAlbedo }) {
      const u = skyUniforms
      u.uSize.value.set(target.width, target.height)
      u.uViewHeight.value = viewHeightKm
      u.uGroundAlbedo.value = groundAlbedo
      u.uSunDir.value.fromArray(inputs.sun.dir)
      u.uMoonDir.value.fromArray(inputs.moon.dir)
      u.uSunE.value = inputs.sunE
      u.uMoonE.value.fromArray(inputs.moonE)
      u.uMoonOn.value = inputs.moonOn ? 1 : 0
      drawPass(renderer, skyPass, target)
    },
    dispose() {
      transmittance.dispose()
      multi.dispose()
      for (const p of [transmittancePass, multiPass, skyPass]) p.material.dispose()
    },
  }
}
