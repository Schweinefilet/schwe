import * as THREE from 'three'

// The puddle's surface as a live simulation: linear capillary-gravity waves on water of finite depth,
// solved spectrally on a square tile that repeats in both directions.
//
// Each Fourier mode of the surface is a damped oscillator with the water's own dispersion,
//   ω² = (g k + (σ/ρ) k³) tanh(k d),
// so it is advanced exactly (a rotation of height and its rate), stable for any time step and with
// the true dispersion: short capillary ripples run ahead of longer waves, as round a raindrop.
//
// The state lives in Fourier space as one complex field, Z = H + iU: H the height's spectrum, U its
// rate's with the rate kept as ḣ·τ (TAU, about one period of the fastest ripples) so that both are
// numbers of the same size. Since height and rate are real, one inverse FFT of Z gives both, h + iḣτ.
// Unscaled (U the plain rate's spectrum, a thousand times larger), rounding in the rate leaked into the
// height, the fastest modes amplified it every step, and the surface exploded within a second; scaled,
// it stays put. One complex number a cell, in two-channel float textures: the FFT's passes are bound by
// memory, and this moves a quarter of what two separate four-channel transforms did. Each step:
//   1. advance every mode by dt (and scale by 1/N², so the inverse transform needs none)
//   2. inverse FFT → h and ḣτ in real space
//   3. pin: near each splash the baked simulation is the truth, so h and ḣ there are pulled onto the
//      splash's own surface (PuddleRain draws those pins into their own target, merged here)
//   4. forward FFT → Z
// Units: meters and seconds of the splash's physics; the tile is `tile` world units of `worldPerMeter`.
export const TAU = 1e-3

const FFT_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform float uSize;
uniform float uSub;       // subtransform size: 2, 4, …, N
uniform float uHorizontal;
uniform float uSign;      // -1 forward, +1 inverse
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 px = floor(gl_FragCoord.xy);
  float index = mix(px.y, px.x, uHorizontal);
  float halfSub = 0.5 * uSub;
  // Stockham: output[index] = even + w·odd, with the halves of the previous stage N/2 apart.
  float evenIndex = floor(index / uSub) * halfSub + mod(index, halfSub);
  vec2 evenPos = mix(vec2(px.x, evenIndex), vec2(evenIndex, px.y), uHorizontal);
  vec2 oddPos = mix(vec2(px.x, evenIndex + 0.5 * uSize), vec2(evenIndex + 0.5 * uSize, px.y), uHorizontal);
  vec2 even = texelFetch(uInput, ivec2(evenPos), 0).xy;
  vec2 odd = texelFetch(uInput, ivec2(oddPos), 0).xy;
  float a = uSign * 6.283185307179586 * index / uSub;
  gl_FragColor = vec4(even + cmul(vec2(cos(a), sin(a)), odd), 0.0, 1.0);
}`

const ADVANCE = /* glsl */ `
precision highp float;
uniform sampler2D uSpec;
uniform float uSize;
uniform float uLength;    // tile side, meters
uniform float uDt;
uniform float uScale;     // 1/N²
uniform float uGravity;
uniform float uTension;   // σ/ρ, m³/s²
uniform float uDepth;     // meters
uniform float uDamp;      // extra damping, 1/s
uniform float uNu;        // kinematic viscosity, m²/s
uniform float uReset;     // 1: start from calm water
uniform float uTau;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int n = int(uSize);
  ivec2 q = ivec2((n - p.x) % n, (n - p.y) % n);
  vec2 z = texelFetch(uSpec, p, 0).xy;
  vec2 zm = texelFetch(uSpec, q, 0).xy;
  vec2 zmc = vec2(zm.x, -zm.y);
  vec2 H = 0.5 * (z + zmc);
  vec2 iU = 0.5 * (z - zmc);
  vec2 U = vec2(iU.y, -iU.x); // the rate's spectrum × τ
  vec2 f = vec2(p);
  f = mix(f, f - uSize, step(0.5 * uSize, f));
  vec2 kv = 6.283185307179586 * f / uLength;
  float k = length(kv);
  if (k == 0.0 || uReset > 0.5) { gl_FragColor = vec4(0.0); return; }
  float w = sqrt((uGravity * k + uTension * k * k * k) * tanh(k * uDepth));
  float damp = exp(-(uDamp + 2.0 * uNu * k * k) * uDt);
  float c = cos(w * uDt);
  float s = sin(w * uDt);
  float wt = w * uTau;
  vec2 H2 = damp * (H * c + U * (s / wt));
  vec2 U2 = damp * (-H * (wt * s) + U * c);
  gl_FragColor = vec4((H2 + vec2(-U2.y, U2.x)) * uScale, 0.0, 1.0);
}`

// field = pins over the simulated surface: the pins were drawn premultiplied ("over"), so their
// target holds Σ w·(h, ḣτ) in rg and their combined weight in a.
const MERGE = /* glsl */ `
precision highp float;
uniform sampler2D uRaw;
uniform sampler2D uPins;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 pin = texelFetch(uPins, p, 0);
  gl_FragColor = vec4(pin.rg + (1.0 - pin.a) * texelFetch(uRaw, p, 0).xy, 0.0, 1.0);
}`

const FULLSCREEN = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`

function target(size, format = THREE.RGFormat) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.FloatType,
    format,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  })
}

export class WaveSim {
  constructor(renderer, { size = 2048, tile, worldPerMeter, depth = 0.02, damping = 0.4, gravity = 9.81, tension = 0.0728 / 1000, viscosity = 1e-6 }) {
    this.renderer = renderer
    this.size = size
    this.tile = tile // world units
    this.worldPerMeter = worldPerMeter
    this.length = tile / worldPerMeter // meters
    this.spec = target(size) // Z, persistent
    this.field = target(size) // h and ḣτ in real space, pinned: drawn, and the next step's start
    this.raw = target(size) // the same before the pins
    this.pins = target(size, THREE.RGBAFormat)
    this.a = target(size)
    this.b = target(size)
    this.passes = Math.log2(size)
    if (!Number.isInteger(this.passes)) throw new Error('WaveSim: size must be a power of two')

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const tri = new THREE.BufferGeometry()
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.fftMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN,
      fragmentShader: FFT_PASS,
      uniforms: { uInput: { value: null }, uSize: { value: size }, uSub: { value: 2 }, uHorizontal: { value: 1 }, uSign: { value: -1 } },
      depthTest: false,
      depthWrite: false,
    })
    this.advanceMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN,
      fragmentShader: ADVANCE,
      uniforms: {
        uSpec: { value: null },
        uSize: { value: size },
        uLength: { value: this.length },
        uDt: { value: 0 },
        uScale: { value: 1 / (size * size) },
        uGravity: { value: gravity },
        uTension: { value: tension },
        uDepth: { value: depth },
        uDamp: { value: damping },
        uNu: { value: viscosity },
        uReset: { value: 1 },
        uTau: { value: TAU },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.mergeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN,
      fragmentShader: MERGE,
      uniforms: { uRaw: { value: this.raw.texture }, uPins: { value: this.pins.texture } },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(tri, this.fftMaterial)
    this.quad.frustumCulled = false
    this.scene = new THREE.Scene()
    this.scene.add(this.quad)
    this.pinScene = new THREE.Scene() // PuddleRain adds its pin splats here
    this.resetPending = true
    this.time = 0
  }

  // Calm water on the next step.
  reset() {
    this.resetPending = true
  }

  pass(material, input, output) {
    this.quad.material = material
    if (material.uniforms.uInput) material.uniforms.uInput.value = input.texture
    this.renderer.setRenderTarget(output)
    this.renderer.render(this.scene, this.camera)
  }

  // 2D FFT of `from`, result in `to` (from is left as scratch-free: the first pass reads it only).
  fft(from, to, sign) {
    const m = this.fftMaterial
    m.uniforms.uSign.value = sign
    const total = 2 * this.passes
    let input = from
    let i = 0
    for (const horizontal of [1, 0]) {
      m.uniforms.uHorizontal.value = horizontal
      for (let s = 1; s <= this.passes; s++) {
        m.uniforms.uSub.value = 2 ** s
        i++
        const output = i === total ? to : input === this.a ? this.b : this.a
        this.pass(m, input, output)
        input = output
      }
    }
  }

  // Advances the surface by dt seconds of physics. `pin`: whether the pin scene has anything in it.
  step(dt, pin) {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevAutoClear = r.autoClear
    const prevClear = r.getClearColor(new THREE.Color())
    const prevAlpha = r.getClearAlpha()
    r.autoClear = false
    const adv = this.advanceMaterial
    adv.uniforms.uSpec.value = this.spec.texture
    adv.uniforms.uDt.value = dt
    adv.uniforms.uReset.value = this.resetPending ? 1 : 0
    this.resetPending = false
    this.quad.material = adv
    r.setRenderTarget(this.a)
    r.render(this.scene, this.camera)
    if (pin) {
      this.fft(this.a, this.raw, 1)
      r.setRenderTarget(this.pins)
      r.setClearColor(0x000000, 0)
      r.clear(true, false, false)
      r.render(this.pinScene, this.camera)
      this.quad.material = this.mergeMaterial
      r.setRenderTarget(this.field)
      r.render(this.scene, this.camera)
    } else {
      this.fft(this.a, this.field, 1)
    }
    this.fft(this.field, this.spec, -1)
    r.setRenderTarget(prevTarget)
    r.setClearColor(prevClear, prevAlpha)
    r.autoClear = prevAutoClear
    this.time += dt
  }

  dispose() {
    for (const t of [this.spec, this.field, this.raw, this.pins, this.a, this.b]) t.dispose()
    this.fftMaterial.dispose()
    this.mergeMaterial.dispose()
    this.advanceMaterial.dispose()
    this.quad.geometry.dispose()
  }
}
