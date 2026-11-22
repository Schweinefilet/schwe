import * as THREE from 'three'
import { AP_RANGE, AP_SIZE } from './atmosphere.js'
import { realUniforms } from './materials.js'

// The photoreal New York's frame, pass by pass:
//
//   1. the buildings into an HDR target (half float, with a depth texture);
//   2. a copy of their radiance and view depth (float), for the ground's reflections;
//   3. the ground (streets, parks, water) and the rain into the same target, reflecting the copy;
//   4. aerial perspective: each pixel's light dimmed and veiled by the air between it and the lens;
//   5. temporal antialiasing (jittered projection, reprojection from depth, variance clipping);
//   6. bloom (a mip chain, 13-tap down, tent up);
//   7. exposure, colour grade, AgX tone curve, sRGB, to the screen.
//
// The scene is static apart from the camera, so the reprojection needs only depth and last frame's
// matrices. Each pass is a full-screen triangle pair with its own ShaderMaterial.

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const DEPTH_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  // View-space position of the pixel at uv (from the depth buffer).
  vec3 viewPos(vec2 uv) {
    float d = texture(tDepth, uv).r;
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
`

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  ${DEPTH_GLSL}
  varying vec2 vUv;
  void main() {
    float d = texture(tDepth, vUv).r;
    gl_FragColor = vec4(texture(tColor, vUv).rgb, d >= 1.0 ? 1e7 : -viewPos(vUv).z);
  }
`

// Aerial perspective (Hillaire 2020, section 5.6): a read of the camera volume at the pixel's distance.
const AP_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler3D tScatter;
  uniform sampler3D tTransmit;
  uniform float uSunE;
  uniform float uOn;
  ${DEPTH_GLSL}
  varying vec2 vUv;
  void main() {
    vec3 c = texture(tColor, vUv).rgb;
    float d = texture(tDepth, vUv).r;
    if (d >= 1.0 || uOn < 0.5) { gl_FragColor = vec4(c, 1.0); return; }
    float km = length(viewPos(vUv)) * 0.001;
    vec3 w = vec3(vUv, clamp(km / ${AP_RANGE}.0, 0.0, 1.0) * ${(AP_SIZE - 1) / AP_SIZE} + ${0.5 / AP_SIZE});
    vec3 L = texture(tScatter, w).rgb * uSunE;
    vec3 T = texture(tTransmit, w).rgb;
    gl_FragColor = vec4(c * T + L, 1.0);
  }
`

// Temporal antialiasing: Karis, "High Quality Temporal Supersampling", Advances 2014 (jitter, history
// reprojection, neighbourhood clamp, luminance-weighted blend against fireflies); Salvi, "An Excursion in
// Temporal Supersampling", GDC 2016 (variance clipping in YCoCg). History is read with a Catmull-Rom
// filter so it stays sharp under the drift.
const TAA_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tHistory;
  uniform mat4 uInvViewProj;
  uniform mat4 uPrevViewProj;
  uniform vec2 uRes;
  uniform float uReset;
  uniform float uAlpha;
  uniform sampler2D tDepth;
  varying vec2 vUv;

  vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
  vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
  // A tone-mapped space for the blend, so a bright pixel does not dominate (Karis 2014).
  vec3 tm(vec3 c) { return c / (1.0 + max(max(c.r, c.g), c.b)); }
  vec3 itm(vec3 c) {
    c = clamp(c, 0.0, 0.995);
    return c / (1.0 - max(max(c.r, c.g), c.b));
  }

  // Catmull-Rom history read in nine bilinear taps.
  vec3 history(vec2 uv) {
    vec2 pos = uv * uRes;
    vec2 c = floor(pos - 0.5) + 0.5;
    vec2 f = pos - c;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 o12 = w2 / w12;
    vec2 t0 = (c - 1.0) / uRes;
    vec2 t3 = (c + 2.0) / uRes;
    vec2 t12 = (c + o12) / uRes;
    vec3 r = vec3(0.0);
    r += tm(texture(tHistory, vec2(t0.x, t0.y)).rgb) * w0.x * w0.y;
    r += tm(texture(tHistory, vec2(t12.x, t0.y)).rgb) * w12.x * w0.y;
    r += tm(texture(tHistory, vec2(t3.x, t0.y)).rgb) * w3.x * w0.y;
    r += tm(texture(tHistory, vec2(t0.x, t12.y)).rgb) * w0.x * w12.y;
    r += tm(texture(tHistory, vec2(t12.x, t12.y)).rgb) * w12.x * w12.y;
    r += tm(texture(tHistory, vec2(t3.x, t12.y)).rgb) * w3.x * w12.y;
    r += tm(texture(tHistory, vec2(t0.x, t3.y)).rgb) * w0.x * w3.y;
    r += tm(texture(tHistory, vec2(t12.x, t3.y)).rgb) * w12.x * w3.y;
    r += tm(texture(tHistory, vec2(t3.x, t3.y)).rgb) * w3.x * w3.y;
    return max(r, vec3(0.0));
  }

  void main() {
    vec2 px = 1.0 / uRes;
    vec3 cur = tm(texture(tColor, vUv).rgb);
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    vec3 nMin = vec3(1e9);
    vec3 nMax = vec3(-1e9);
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 s = toYCoCg(tm(texture(tColor, vUv + vec2(x, y) * px).rgb));
        m1 += s;
        m2 += s * s;
        nMin = min(nMin, s);
        nMax = max(nMax, s);
      }
    m1 /= 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
    // Where this pixel was last frame: from its depth and last frame's matrices.
    float d = texture(tDepth, vUv).r;
    vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    wp /= wp.w;
    vec4 pc = uPrevViewProj * wp;
    vec2 prev = pc.xy / pc.w * 0.5 + 0.5;
    bool off = prev.x < 0.0 || prev.x > 1.0 || prev.y < 0.0 || prev.y > 1.0;
    if (uReset > 0.5 || off) { gl_FragColor = vec4(itm(cur), 1.0); return; }
    vec3 h = toYCoCg(history(prev));
    // Clip the history toward the neighbourhood's mean, inside its box of 1.25 sigma.
    // (Never outside the neighbourhood's own range: a box wider than it lets the Catmull-Rom read's
    // overshoot through.)
    vec3 lo = max(m1 - 1.25 * sigma, nMin);
    vec3 hi = min(m1 + 1.25 * sigma, nMax);
    vec3 center = 0.5 * (hi + lo);
    vec3 ext = 0.5 * (hi - lo) + 1e-5;
    vec3 v = h - center;
    vec3 a = abs(v / ext);
    float m = max(a.x, max(a.y, a.z));
    if (m > 1.0) h = center + v / m;
    h = fromYCoCg(h);
    gl_FragColor = vec4(itm(mix(h, cur, uAlpha)), 1.0);
  }
`

// Bloom: Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", Advances 2014. The
// 13-tap downsample (with Karis's average on the first level, against fireflies) and the 3x3 tent
// upsample, summed down the chain. No threshold: a few percent of the whole image, as a lens scatters.
const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uFirst;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
  float kw(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
  void main() {
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    if (uFirst > 0.5) {
      float w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
      gl_FragColor = vec4((g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5), 1.0);
    } else {
      gl_FragColor = vec4(g4 * 0.5 + (g0 + g1 + g2 + g3) * 0.125, 1.0);
    }
  }
`
const UP_FRAG = /* glsl */ `
  uniform sampler2D tSrc; // the smaller level, upsampled
  uniform sampler2D tBase; // this level's downsample
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 t = (s(vec2(-1, 1)) + 2.0 * s(vec2(0, 1)) + s(vec2(1, 1)) + 2.0 * s(vec2(-1, 0)) + 4.0 * s(vec2(0, 0)) + 2.0 * s(vec2(1, 0)) + s(vec2(-1, -1)) + 2.0 * s(vec2(0, -1)) + s(vec2(1, -1))) / 16.0;
    gl_FragColor = vec4(texture(tBase, vUv).rgb + t, 1.0);
  }
`

// The camera: exposure, then the grade (white balance, saturation, contrast round middle grey, in linear
// light before the curve), AgX (three's AgXToneMapping: Sobotka's AgX via Filament), sRGB.
const FINAL_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform sampler2D tMeter; // the bloom chain's smallest level: the frame's mean
  uniform float uBloom;
  uniform float uExposure; // incident-light metering (look.js)
  uniform float uMeter; // how much of the exposure is the frame's own mean (a camera's matrix meter)
  uniform float uKey;
  uniform float uExpMax;
  uniform vec3 uBalance;
  uniform float uSaturation;
  uniform float uContrast;
  uniform vec3 uLift;
  varying vec2 vUv;
  void main() {
    vec3 c = texture(tColor, vUv).rgb;
    c = mix(c, texture(tBloom, vUv).rgb / 6.0, uBloom);
    // Reflected-light metering: the mean luminance of the frame (4 x 4 reads of its 1/64 copy), centre
    // weighted, against a key; blended in the log domain with the incident reading.
    float mean = 0.0;
    float wsum = 0.0;
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 4; x++) {
        vec2 at = (vec2(x, y) + 0.5) / 4.0;
        float w = 1.0 - 0.5 * length(at - 0.5);
        mean += dot(texture(tMeter, at).rgb, vec3(0.2126, 0.7152, 0.0722)) * w;
        wsum += w;
      }
    mean /= wsum;
    float reflected = uKey / max(mean, 1e-5);
    float exposure = min(exp(mix(log(uExposure), log(reflected), uMeter)), uExpMax);
    c *= exposure * uBalance;
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(y), c, uSaturation), 0.0);
    // Contrast as a power round 0.18 (log-space contrast), and a lift of the blacks.
    c = 0.18 * pow(c / 0.18 + 1e-6, vec3(uContrast));
    c += uLift;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const HALTON = (i, b) => {
  let f = 1
  let r = 0
  while (i > 0) {
    f /= b
    r += f * (i % b)
    i = Math.floor(i / b)
  }
  return r
}

export class Pipeline {
  constructor(renderer, atmosphere, { taa = true, bloom = true } = {}) {
    this.renderer = renderer
    this.atmosphere = atmosphere
    this.taa = taa
    this.bloomOn = bloom
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quadScene = new THREE.Scene()
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra })
    this.copy = mat(COPY_FRAG, { tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() } })
    this.ap = mat(AP_FRAG, { tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, tScatter: { value: atmosphere.apScatter.texture }, tTransmit: { value: atmosphere.apTransmit.texture }, uSunE: { value: 1 }, uOn: { value: 1 } })
    this.taaMat = mat(TAA_FRAG, { tColor: { value: null }, tHistory: { value: null }, tDepth: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uReset: { value: 1 }, uAlpha: { value: 0.1 } })
    this.down = mat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } })
    this.up = mat(UP_FRAG, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() } })
    this.final = mat(FINAL_FRAG, {
      tColor: { value: null },
      tBloom: { value: null },
      tMeter: { value: null },
      uBloom: { value: 0.04 },
      uExposure: { value: 1 },
      uMeter: { value: 0 },
      uKey: { value: 0.18 },
      uExpMax: { value: 1 },
      uBalance: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uLift: { value: new THREE.Vector3() },
    }, { toneMapped: true })
    this.size = new THREE.Vector2(-1, -1)
    this.frame = 0
    this.prevViewProj = new THREE.Matrix4()
    this.viewProj = new THREE.Matrix4()
    this.invViewProj = new THREE.Matrix4()
    this.unjittered = new THREE.Matrix4()
    this.reset = true
  }

  target(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts })
  }

  setSize(w, h) {
    if (w === this.size.x && h === this.size.y) return
    this.dispose(false)
    this.size.set(w, h)
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType)
    this.sceneRT = this.target(w, h, { depthBuffer: true, depthTexture, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
    this.buildRT = this.target(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
    this.apRT = this.target(w, h)
    this.hist = [this.target(w, h), this.target(w, h)]
    this.downs = []
    this.ups = []
    let bw = w
    let bh = h
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, Math.round(bw / 2))
      bh = Math.max(1, Math.round(bh / 2))
      this.downs.push(this.target(bw, bh))
      this.ups.push(this.target(bw, bh))
    }
    realUniforms.uRes.value.set(w, h)
    this.reset = true
  }

  pass(material, target) {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.camera)
  }

  // Jitters the camera's projection for this frame (Halton 2, 3 over 16 frames).
  jitter(camera) {
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    this.unjittered.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!this.taa) return
    const i = (this.frame % 16) + 1
    const jx = HALTON(i, 2) - 0.5
    const jy = HALTON(i, 3) - 0.5
    camera.projectionMatrix.elements[8] += (2 * jx) / this.size.x
    camera.projectionMatrix.elements[9] += (2 * jy) / this.size.y
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  }

  // `parts`: { buildings: [objects], ground: [objects], late: [objects drawn with the ground] };
  // `look`: { exposure, meter, key, exposureMax, balance, saturation, contrast, lift, bloom, sunE, sunDir,
  // aerial, sky (a texture for the background) }.
  render(scene, camera, parts, look) {
    const r = this.renderer
    const autoClear = r.autoClear
    r.autoClear = false
    camera.updateMatrixWorld()
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.invViewProj.copy(this.viewProj).invert()
    const show = (list, v) => list.forEach((o) => (o.visible = v))

    // 1. Buildings.
    show(parts.ground, false)
    show(parts.late, false)
    scene.background = look.sky ?? null
    r.setRenderTarget(this.sceneRT)
    r.clear(true, true, true)
    r.render(scene, camera)
    // 2. Their radiance and depth, for the ground's reflections.
    this.copy.uniforms.tColor.value = this.sceneRT.texture
    this.copy.uniforms.tDepth.value = this.sceneRT.depthTexture
    this.copy.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse)
    this.pass(this.copy, this.buildRT)
    realUniforms.tBuild.value = this.buildRT.texture
    realUniforms.uFrame.value = this.frame % 64
    // 3. The ground and the rain.
    show(parts.buildings, false)
    show(parts.ground, true)
    show(parts.late, true)
    scene.background = null
    r.setRenderTarget(this.sceneRT)
    r.render(scene, camera)
    show(parts.buildings, true)

    // 4. Aerial perspective.
    this.atmosphere.volume(camera, this.unjitteredInverse(), look.sunDir)
    const ap = this.ap.uniforms
    ap.tColor.value = this.sceneRT.texture
    ap.tDepth.value = this.sceneRT.depthTexture
    ap.uInvProj.value.copy(camera.projectionMatrixInverse)
    ap.uSunE.value = look.sunE
    ap.uOn.value = look.aerial === false ? 0 : 1
    this.pass(this.ap, this.apRT)
    let image = this.apRT

    // 5. Temporal antialiasing.
    if (this.taa) {
      const [prev, next] = this.frame % 2 ? [this.hist[1], this.hist[0]] : [this.hist[0], this.hist[1]]
      const t = this.taaMat.uniforms
      t.tColor.value = this.apRT.texture
      t.tHistory.value = prev.texture
      t.tDepth.value = this.sceneRT.depthTexture
      t.uInvViewProj.value.copy(this.invViewProj)
      t.uPrevViewProj.value.copy(this.prevViewProj)
      t.uRes.value.copy(this.size)
      t.uReset.value = this.reset ? 1 : 0
      this.pass(this.taaMat, next)
      image = next
    }
    this.prevViewProj.copy(this.unjittered)
    this.reset = false

    // 6. Bloom.
    let bloom = null
    if (this.bloomOn) {
      let src = image
      for (let i = 0; i < this.downs.length; i++) {
        const d = this.down.uniforms
        d.tSrc.value = src.texture
        d.uTexel.value.set(1 / src.width, 1 / src.height)
        d.uFirst.value = i === 0 ? 1 : 0
        this.pass(this.down, this.downs[i])
        src = this.downs[i]
      }
      let up = this.downs[this.downs.length - 1]
      for (let i = this.downs.length - 2; i >= 0; i--) {
        const u = this.up.uniforms
        u.tSrc.value = up.texture
        u.tBase.value = this.downs[i].texture
        u.uTexel.value.set(1 / up.width, 1 / up.height)
        this.pass(this.up, this.ups[i])
        up = this.ups[i]
      }
      bloom = up
    }

    // 7. To the screen.
    const f = this.final.uniforms
    f.tColor.value = image.texture
    f.tBloom.value = bloom?.texture ?? image.texture
    f.uBloom.value = bloom ? look.bloom : 0
    f.uExposure.value = look.exposure
    f.tMeter.value = this.bloomOn ? this.downs[this.downs.length - 1].texture : image.texture
    f.uMeter.value = this.bloomOn ? look.meter : 0
    f.uKey.value = look.key
    f.uExpMax.value = look.exposureMax
    f.uBalance.value.fromArray(look.balance)
    f.uSaturation.value = look.saturation
    f.uContrast.value = look.contrast
    f.uLift.value.setScalar(look.lift)
    this.pass(this.final, null)
    r.autoClear = autoClear
    this.frame++
  }

  unjitteredInverse() {
    return (this._uinv ??= new THREE.Matrix4()).copy(this.unjittered).invert()
  }

  dispose(all = true) {
    for (const t of [this.sceneRT, this.buildRT, this.apRT, ...(this.hist ?? []), ...(this.downs ?? []), ...(this.ups ?? [])]) t?.dispose()
    this.sceneRT?.depthTexture?.dispose()
    if (all) for (const m of [this.copy, this.ap, this.taaMat, this.down, this.up, this.final]) m.dispose()
  }
}
