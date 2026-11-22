import * as THREE from 'three'

// The sky and the air over the photoreal New York: Rayleigh and Mie scattering and ozone absorption in a
// spherical atmosphere, after Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique", EGSR 2020. Ported from the paper's reference code, github.com/sebh/UnrealEngineSkyAtmosphere
// (MIT, Copyright (c) 2020 Epic Games, Inc.): the transmittance and multiple-scattering lookup tables, the
// single-scattering integrator with the multiple-scattering term, and the camera volume for aerial
// perspective. The Earth's parameters are the paper's (themselves Bruneton's, BSD).
//
// Changes from the reference: y is up; the sky is ray-marched straight into the environment cube (the
// site's view never shows the sky, only its reflections and its light), so there is no sky-view table;
// the aerial-perspective volume is spaced for this view (everything in frame is 12 to 23 km off); the
// aerosols come from the live weather (below).
//
// Aerosols from the weather. Koschmieder's relation (WMO, Guide to Instruments and Methods of
// Observation, vol. I ch. 9): the visibility V a weather station reports is 3.912 / the extinction
// coefficient at the ground. The air's own Rayleigh extinction at 550 nm is subtracted, the rest is Mie
// (haze, smog, fog, rain), with an urban single-scattering albedo of 0.9 and a 1.2 km scale height.
//
// Units: kilometres inside the atmosphere's shaders; the sun's illuminance outside the atmosphere is
// SUN_E (see below for the scale).

const RAD = Math.PI / 180

// Light units. One unit of luminance is about 100 cd/m², so a lit window reads about 1 (the night
// shaders' scale), and the sun outside the atmosphere (128 000 lux) is 128000 / (100 pi) = 400 units of
// illuminance (L = albedo E / pi).
export const SUN_E = 400

export const EARTH = {
  bottom: 6360,
  top: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighH: 8,
  mieH: 1.2,
  mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3],
}

const RAYLEIGH_550 = 0.0136 // the air's own extinction at 550 nm, per km at sea level
const MIE_ALBEDO = 0.9

// The aerosols for a visibility reading in metres (null when unread: a clear day's 40 km).
export function mieFor(visibilityM) {
  const v = Math.min(80, Math.max(0.2, (visibilityM ?? 40000) / 1000))
  const ext = Math.max(0.004, 3.912 / v - RAYLEIGH_550)
  return { ext, scat: ext * MIE_ALBEDO }
}

// ---------------------------------------------------------------------------------------------------
// CPU: the sun's transmittance from a point at altitude `hKm` along `dir` (y up), and the same for the
// light reaching the city.

function densities(hKm, mieExtScale) {
  const r = Math.exp(-hKm / EARTH.rayleighH)
  const m = Math.exp(-hKm / EARTH.mieH)
  const o = Math.min(1, Math.max(0, hKm < 25 ? hKm / 15 - 2 / 3 : -hKm / 15 + 8 / 3))
  return EARTH.rayleigh.map((b, i) => b * r + mieExtScale * m + EARTH.ozone[i] * o)
}

export function sunTransmittance(dir, mie, hKm = 0.05) {
  const R = EARTH.bottom
  const p = [0, R + hKm, 0]
  // Distance to the top of the atmosphere (or the ground: none).
  const b = p[1] * dir[1]
  const c = p[1] * p[1] - EARTH.top * EARTH.top
  const tTop = -b + Math.sqrt(b * b - c)
  const cg = p[1] * p[1] - R * R
  const disc = b * b - cg
  if (disc > 0 && -b - Math.sqrt(disc) > 0) return [0, 0, 0]
  const N = 64
  const depth = [0, 0, 0]
  let prev = 0
  for (let i = 0; i < N; i++) {
    // Denser steps near the ground, where the air is.
    const t1 = tTop * ((i + 1) / N) ** 2
    const tm = (prev + t1) / 2
    const q = [dir[0] * tm, p[1] + dir[1] * tm, dir[2] * tm]
    const h = Math.hypot(q[0], q[1], q[2]) - R
    const d = densities(h, mie.ext)
    for (let k = 0; k < 3; k++) depth[k] += d[k] * (t1 - prev)
    prev = t1
  }
  return depth.map((d) => Math.exp(-d))
}

// ---------------------------------------------------------------------------------------------------
// GLSL shared by every pass that reads the atmosphere.

export const ATMOSPHERE_GLSL = /* glsl */ `
  #define A_PI 3.14159265359
  uniform float uBottom;
  uniform float uTop;
  uniform vec3 uRayleigh;
  uniform float uRayleighH;
  uniform vec3 uMieScat;
  uniform vec3 uMieExt;
  uniform float uMieH;
  uniform float uMieG;
  uniform vec3 uOzone;
  uniform sampler2D uTransmittanceLut;
  uniform sampler2D uMultiLut;
  // Under the cloud layer the air is lit by what the clouds let through: a share of the sun (uDeckSun)
  // and the deck's own underside (uDeckL, per unit of the sun's illuminance), which is close to
  // isotropic from above.
  uniform float uDeckH;
  uniform float uDeckSun;
  uniform vec3 uDeckL;

  float raySphere(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    float s = sqrt(disc);
    float t0 = -b - s;
    float t1 = -b + s;
    if (t0 < 0.0 && t1 < 0.0) return -1.0;
    return t0 < 0.0 ? max(0.0, t1) : max(0.0, t0);
  }

  struct Medium { vec3 scatRay; vec3 scatMie; vec3 ext; };
  Medium medium(vec3 p) {
    float h = length(p) - uBottom;
    float dr = exp(-h / uRayleighH);
    float dm = exp(-h / uMieH);
    float o = clamp(h < 25.0 ? h / 15.0 - 2.0 / 3.0 : -h / 15.0 + 8.0 / 3.0, 0.0, 1.0);
    Medium m;
    m.scatRay = uRayleigh * dr;
    m.scatMie = uMieScat * dm;
    m.ext = m.scatRay + uMieExt * dm + uOzone * o;
    return m;
  }

  // Bruneton's parameterisation of the transmittance table (as in the reference code).
  vec2 transmittanceUv(float r, float mu) {
    float H = sqrt(max(0.0, uTop * uTop - uBottom * uBottom));
    float rho = sqrt(max(0.0, r * r - uBottom * uBottom));
    float disc = r * r * (mu * mu - 1.0) + uTop * uTop;
    float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
    float dMin = uTop - r;
    float dMax = rho + H;
    return vec2((d - dMin) / (dMax - dMin), rho / H);
  }
  vec3 transmittanceToSun(vec3 p, vec3 sunDir) {
    float r = length(p);
    return texture(uTransmittanceLut, transmittanceUv(r, dot(p / r, sunDir))).rgb;
  }
  vec3 multiScattering(vec3 p, vec3 sunDir) {
    float r = length(p);
    vec2 uv = clamp(vec2(dot(p / r, sunDir) * 0.5 + 0.5, (r - uBottom) / (uTop - uBottom)), 0.0, 1.0);
    uv = (uv * 31.0 + 0.5) / 32.0;
    return texture(uMultiLut, uv).rgb;
  }

  float rayleighPhase(float c) { return 3.0 / (16.0 * A_PI) * (1.0 + c * c); }
  // Cornette-Shanks, as the reference code uses.
  float miePhase(float g, float c) {
    float k = 3.0 / (8.0 * A_PI) * (1.0 - g * g) / (2.0 + g * g);
    return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
  }

  // Single scattering with the multiple-scattering term (Hillaire 2020, eq. 6 and 11), from o along d for
  // tMax km, in n steps; the sun's illuminance is 1. Returns the in-scattered light; T is set to the path's
  // transmittance.
  vec3 integrate(vec3 o, vec3 d, float tMax, vec3 sunDir, float n, out vec3 T) {
    float c = dot(d, sunDir);
    float pr = rayleighPhase(c);
    float pm = miePhase(uMieG, c);
    vec3 L = vec3(0.0);
    T = vec3(1.0);
    float t = 0.0;
    for (float i = 0.0; i < 64.0; i += 1.0) {
      if (i >= n) break;
      float t1 = tMax * (i + 1.0) / n;
      float dt = t1 - t;
      vec3 p = o + d * (t + 0.3 * dt);
      t = t1;
      Medium m = medium(p);
      vec3 stepT = exp(-m.ext * dt);
      float r = length(p);
      vec3 up = p / r;
      // The planet's shadow.
      float earth = raySphere(p + up * 0.01, sunDir, uBottom) >= 0.0 ? 0.0 : 1.0;
      vec3 S = earth * transmittanceToSun(p, sunDir) * (m.scatRay * pr + m.scatMie * pm) + multiScattering(p, sunDir) * (m.scatRay + m.scatMie);
      if (r - uBottom < uDeckH) S = S * uDeckSun + (m.scatRay + m.scatMie) * uDeckL * 0.5;
      L += T * (S - S * stepT) / max(m.ext, vec3(1e-6));
      T *= stepT;
    }
    return L;
  }
`

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// The transmittance table: optical depth to the top of the atmosphere, by altitude and zenith angle.
const TRANSMITTANCE_FRAG = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  varying vec2 vUv;
  void main() {
    float H = sqrt(uTop * uTop - uBottom * uBottom);
    float rho = H * vUv.y;
    float r = sqrt(rho * rho + uBottom * uBottom);
    float dMin = uTop - r;
    float dMax = rho + H;
    float d = dMin + vUv.x * (dMax - dMin);
    float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
    vec3 o = vec3(0.0, r, 0.0);
    vec3 dir = vec3(sqrt(1.0 - mu * mu), mu, 0.0);
    float tMax = raySphere(o, dir, uTop);
    vec3 depth = vec3(0.0);
    for (float i = 0.0; i < 40.0; i += 1.0) {
      float t = tMax * (i + 0.3) / 40.0;
      depth += medium(o + dir * t).ext * tMax / 40.0;
    }
    gl_FragColor = vec4(exp(-depth), 1.0);
  }
`

// The multiple-scattering table (Hillaire 2020, section 5.5): for each altitude and sun angle, the
// second-order scattering from 64 directions and the geometric series of higher orders. The reference
// does the 64 directions in a compute shader's thread group; here one fragment loops over them.
const MULTI_FRAG = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uGroundAlbedo;
  varying vec2 vUv;
  void main() {
    vec2 uv = (vUv * 32.0 - 0.5) / 31.0;
    float cosSun = uv.x * 2.0 - 1.0;
    vec3 sunDir = vec3(sqrt(clamp(1.0 - cosSun * cosSun, 0.0, 1.0)), cosSun, 0.0);
    float r = uBottom + clamp(uv.y + 0.01, 0.0, 1.0) * (uTop - uBottom - 0.01);
    vec3 o = vec3(0.0, r, 0.0);
    vec3 L2 = vec3(0.0);
    vec3 fms = vec3(0.0);
    for (float i = 0.0; i < 8.0; i += 1.0)
      for (float j = 0.0; j < 8.0; j += 1.0) {
        float theta = 2.0 * A_PI * (i + 0.5) / 8.0;
        float phi = acos(1.0 - 2.0 * (j + 0.5) / 8.0);
        vec3 d = vec3(cos(theta) * sin(phi), cos(phi), sin(theta) * sin(phi));
        float tBottom = raySphere(o, d, uBottom);
        float tTop = raySphere(o, d, uTop);
        float tMax = tBottom > 0.0 ? tBottom : tTop;
        vec3 L = vec3(0.0);
        vec3 ms = vec3(0.0);
        vec3 T = vec3(1.0);
        float t = 0.0;
        for (float s = 0.0; s < 20.0; s += 1.0) {
          float t1 = tMax * (s + 1.0) / 20.0;
          float dt = t1 - t;
          vec3 p = o + d * (t + 0.3 * dt);
          t = t1;
          Medium m = medium(p);
          vec3 scat = m.scatRay + m.scatMie;
          vec3 stepT = exp(-m.ext * dt);
          float earth = raySphere(p + normalize(p) * 0.01, sunDir, uBottom) >= 0.0 ? 0.0 : 1.0;
          vec3 S = earth * transmittanceToSun(p, sunDir) * scat / (4.0 * A_PI);
          vec3 inv = 1.0 / max(m.ext, vec3(1e-6));
          L += T * (S - S * stepT) * inv;
          ms += T * (scat - scat * stepT) * inv;
          T *= stepT;
        }
        // Light bounced off the ground.
        if (tBottom > 0.0) {
          vec3 p = o + d * tBottom;
          float nl = clamp(dot(normalize(p), sunDir), 0.0, 1.0);
          L += transmittanceToSun(p, sunDir) * T * nl * uGroundAlbedo / A_PI;
        }
        L2 += L / 64.0;
        fms += ms / 64.0;
      }
    // Equation 9 and 10: f_ms is the transfer to the next order; the series sums to 1 / (1 - f_ms).
    gl_FragColor = vec4(L2 / (1.0 - fms), 1.0);
  }
`

// The sky in every direction, for the environment cube. Below the horizon: the ground, lit by the sun and
// the sky, seen through the air. Clouds: a layer whose cover is the reading's (clouds.js).
const SKY_FRAG = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uSunDir;
  uniform float uSunE;
  uniform float uViewH; // km
  uniform vec3 uGround; // the ground's radiance seen from above
  uniform vec3 uNightGlow; // the city's own light, thrown back by the air and the clouds
  uniform vec3 uCloudLit; // a cloud's underside, lit through itself
  uniform float uCloudTh; // cloudThreshold(cover), clouds.js
  uniform float uCloudH;
  uniform vec2 uCloudShift;
  varying vec3 vDir;
  CLOUDS_GLSL
  void main() {
    vec3 d = normalize(vDir);
    vec3 o = vec3(0.0, uBottom + uViewH, 0.0);
    float tGround = raySphere(o, d, uBottom);
    float tTop = raySphere(o, d, uTop);
    float ground = tGround > 0.0 ? 1.0 : 0.0;
    float tMax = ground > 0.5 ? tGround : tTop;
    // Long paths need more steps; the ground is near.
    float n = mix(12.0, 32.0, clamp(tMax / 200.0, 0.0, 1.0));
    vec3 T;
    vec3 L = integrate(o, d, tMax, uSunDir, n, T) * uSunE;
    L += T * uGround * ground;
    // Clouds: their underside where the ray reaches their height, fading into the haze toward the horizon.
    if (d.y > 0.0 && uCloudTh < 1.5) {
      float t = (uCloudH - uViewH) / d.y;
      vec2 at = d.xz * t + uCloudShift;
      float a = cloudCover(at, uCloudTh) * smoothstep(0.0, 0.12, d.y);
      vec3 Tc;
      vec3 Lc = integrate(o, d, t, uSunDir, 8.0, Tc) * uSunE;
      L = mix(L, Lc + Tc * uCloudLit, a);
    }
    // The city's glow on the air and the clouds after dark: strongest low down and under cloud.
    L += uNightGlow * (ground > 0.5 ? 0.3 : mix(1.0, 0.35, smoothstep(0.0, 0.5, d.y)));
    gl_FragColor = vec4(L, 1.0);
  }
`

// Aerial perspective: for each slice of the camera's frustum, the light scattered into the view ray
// between the camera and that depth, and the ray's transmittance (two volumes: rgb in-scattering, rgb
// transmittance). Slice k of N lies at depth k / (N - 1) of AP_RANGE.
export const AP_SIZE = 32
export const AP_RANGE = 40 // km
// The site's camera stands 17 km off with a long lens; every reference photograph (docs/reference.md) was
// taken from 3 to 8 km. The aerial perspective counts the air over the last AP_SCALE of each ray (about 4 km here), the
// part nearest the city, as if the camera stood where the photographers did. Unreal's Sky Atmosphere has
// the same control ("Aerial Perspective View Distance Scale").
export const AP_SCALE = 0.25
const AP_FRAG = /* glsl */ `
  ${ATMOSPHERE_GLSL}
  uniform vec3 uSunDir;
  uniform vec3 uCamKm; // the camera, km, relative to the city's ground
  uniform mat4 uInvViewProj; // the camera's, unjittered
  uniform float uSlice;
  uniform float uWhich; // 0 in-scattering, 1 transmittance
  uniform float uScale; // the share of each ray's air that counts (AP_SCALE)
  varying vec2 vUv;
  void main() {
    vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 near = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec3 d = normalize(far.xyz / far.w - near.xyz / near.w);
    float depth = uSlice / ${AP_SIZE - 1}.0 * ${AP_RANGE}.0;
    // Only the last uScale of the way: the air a camera standing that much nearer would look through.
    vec3 o = vec3(uCamKm.x, uBottom + uCamKm.y, uCamKm.z) + d * depth * (1.0 - uScale);
    vec3 T = vec3(1.0);
    vec3 L = depth > 0.0 ? integrate(o, d, depth * uScale, uSunDir, clamp(uSlice + 2.0, 2.0, 16.0), T) : vec3(0.0);
    gl_FragColor = vec4(uWhich > 0.5 ? T : L, 1.0);
  }
`

function quad(material) {
  const g = new THREE.PlaneGeometry(2, 2)
  const m = new THREE.Mesh(g, material)
  m.frustumCulled = false
  return m
}

const halfTarget = (w, h, opts = {}) =>
  new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts })

// The atmosphere's state and its passes. `update(look)` recomputes the tables and the sky when the sun or
// the weather changes; `volume(camera)` recomputes the aerial-perspective volume (each frame).
export class Atmosphere {
  constructor(renderer, cloudsGlsl) {
    this.renderer = renderer
    this.uniforms = {
      uBottom: { value: EARTH.bottom },
      uTop: { value: EARTH.top },
      uRayleigh: { value: new THREE.Vector3(...EARTH.rayleigh) },
      uRayleighH: { value: EARTH.rayleighH },
      uMieScat: { value: new THREE.Vector3() },
      uMieExt: { value: new THREE.Vector3() },
      uMieH: { value: EARTH.mieH },
      uMieG: { value: EARTH.mieG },
      uOzone: { value: new THREE.Vector3(...EARTH.ozone) },
      uTransmittanceLut: { value: null },
      uMultiLut: { value: null },
      uDeckH: { value: 0 },
      uDeckSun: { value: 1 },
      uDeckL: { value: new THREE.Vector3() },
    }
    this.transmittance = halfTarget(256, 64)
    this.multi = halfTarget(32, 32)
    this.uniforms.uTransmittanceLut.value = this.transmittance.texture
    this.uniforms.uMultiLut.value = this.multi.texture
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.scene = new THREE.Scene()
    const mat = (frag, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms: { ...this.uniforms, ...extra }, depthTest: false, depthWrite: false })
    this.transmittanceQuad = quad(mat(TRANSMITTANCE_FRAG))
    this.multiQuad = quad(mat(MULTI_FRAG, { uGroundAlbedo: { value: new THREE.Vector3(0.1, 0.1, 0.1) } }))
    this.apUniforms = { uSunDir: { value: new THREE.Vector3() }, uCamKm: { value: new THREE.Vector3() }, uInvViewProj: { value: new THREE.Matrix4() }, uSlice: { value: 0 }, uWhich: { value: 0 }, uScale: { value: AP_SCALE } }
    this.apQuad = quad(mat(AP_FRAG, this.apUniforms))
    const ap = () => {
      const t = new THREE.WebGL3DRenderTarget(AP_SIZE, AP_SIZE, AP_SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter
      t.texture.wrapS = t.texture.wrapT = t.texture.wrapR = THREE.ClampToEdgeWrapping
      return t
    }
    this.apScatter = ap()
    this.apTransmit = ap()

    // The sky cube and its prefiltered version for image-based lighting.
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunE: { value: SUN_E },
      uViewH: { value: 0.3 },
      uGround: { value: new THREE.Vector3() },
      uNightGlow: { value: new THREE.Vector3() },
      uCloudLit: { value: new THREE.Vector3() },
      uCloudTh: { value: 2 },
      uCloudH: { value: 1.5 },
      uCloudShift: { value: new THREE.Vector2() },
    }
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: SKY_FRAG.replace('CLOUDS_GLSL', cloudsGlsl),
      uniforms: { ...this.uniforms, ...this.skyUniforms },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    })
    this.skyScene = new THREE.Scene()
    this.skyScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), skyMat))
    this.skyCube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false })
    this.cubeCamera = new THREE.CubeCamera(0.1, 100, this.skyCube)
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.env = null
    // The sky's irradiance on a level surface, read back once per update (for the camera's exposure).
    this.irrTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false })
    this.irrUniforms = { uEnv: { value: null } }
    this.irrQuad = quad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
          uniform samplerCube uEnv;
          void main() {
            // Cosine-weighted mean over the upper hemisphere, 32 x 12 samples of the cube.
            vec3 sum = vec3(0.0);
            float w = 0.0;
            for (float i = 0.0; i < 32.0; i += 1.0)
              for (float j = 0.0; j < 12.0; j += 1.0) {
                float az = (i + 0.5) / 32.0 * 6.2831853;
                float el = (j + 0.5) / 12.0 * 1.5707963;
                vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
                float k = sin(el) * cos(el);
                sum += texture(uEnv, d).rgb * k;
                w += k;
              }
            gl_FragColor = vec4(3.14159265 * sum / w, 1.0);
          }
        `,
        uniforms: this.irrUniforms,
        depthTest: false,
        depthWrite: false,
      })
    )
    this.skyIrradiance = [0, 0, 0]
  }

  pass(mesh, target, layer) {
    const r = this.renderer
    this.scene.clear()
    this.scene.add(mesh)
    r.setRenderTarget(target, layer)
    r.render(this.scene, this.camera)
  }

  // The tables and the sky, for this look: `a` is { mie, sunDir, ground, nightGlow, cloudLit, cloudTh,
  // cloudShift, deck: { h km, sun, L } } (cloudShift in km).
  update(a) {
    const u = this.uniforms
    u.uMieScat.value.setScalar(a.mie.scat)
    u.uMieExt.value.setScalar(a.mie.ext)
    u.uDeckH.value = a.deck.h
    u.uDeckSun.value = a.deck.sun
    u.uDeckL.value.fromArray(a.deck.L)
    const r = this.renderer
    const prev = r.getRenderTarget()
    const autoClear = r.autoClear
    r.autoClear = true
    this.pass(this.transmittanceQuad, this.transmittance)
    this.pass(this.multiQuad, this.multi)
    const s = this.skyUniforms
    s.uSunDir.value.fromArray(a.sunDir)
    s.uGround.value.fromArray(a.ground)
    s.uNightGlow.value.fromArray(a.nightGlow)
    s.uCloudLit.value.fromArray(a.cloudLit)
    s.uCloudTh.value = a.cloudTh
    s.uCloudShift.value.fromArray(a.cloudShift)
    this.cubeCamera.update(r, this.skyScene)
    const old = this.env
    this.env = this.pmrem.fromCubemap(this.skyCube.texture)
    old?.dispose()
    this.irrUniforms.uEnv.value = this.skyCube.texture
    this.pass(this.irrQuad, this.irrTarget)
    const px = new Float32Array(4)
    r.readRenderTargetPixels(this.irrTarget, 0, 0, 1, 1, px)
    this.skyIrradiance = [px[0], px[1], px[2]]
    r.setRenderTarget(prev)
    r.autoClear = autoClear
    return this.env.texture
  }

  // The aerial-perspective volumes for this camera (world metres; the city's ground at y = 0).
  volume(camera, invViewProj, sunDir) {
    const u = this.apUniforms
    u.uSunDir.value.fromArray(sunDir)
    u.uCamKm.value.copy(camera.position).multiplyScalar(0.001)
    u.uInvViewProj.value.copy(invViewProj)
    const r = this.renderer
    const prev = r.getRenderTarget()
    for (let k = 0; k < AP_SIZE; k++) {
      u.uSlice.value = k
      u.uWhich.value = 0
      this.pass(this.apQuad, this.apScatter, k)
      u.uWhich.value = 1
      this.pass(this.apQuad, this.apTransmit, k)
    }
    r.setRenderTarget(prev)
  }

  dispose() {
    for (const t of [this.transmittance, this.multi, this.apScatter, this.apTransmit, this.skyCube, this.irrTarget]) t.dispose()
    this.env?.dispose()
    this.pmrem.dispose()
  }
}

// The light reaching the city from the sun: its direction, colour and illuminance at the ground.
export function sunAt(altDeg, azDeg, mie) {
  const alt = altDeg * RAD
  const az = azDeg * RAD
  const dir = [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)]
  const T = altDeg > -1 ? sunTransmittance(dir, mie) : [0, 0, 0]
  // The disc sinks below the horizon over about half a degree.
  const rim = Math.min(1, Math.max(0, (altDeg + 0.27) / 0.54))
  return { dir, E: T.map((t) => t * SUN_E * rim) }
}
