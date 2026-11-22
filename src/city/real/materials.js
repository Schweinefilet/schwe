import * as THREE from 'three'
import { NIGHTS, cityClock, patch, plasterUniforms } from '../plaster.js'
import { CLOUDS_GLSL } from './clouds.js'

// The photoreal New York's materials: the buildings, and the ground (streets, parks, water) with its
// reflections. Physically based throughout (three's MeshStandardMaterial and MeshPhysicalMaterial: GGX
// specular, Lambert diffuse; Karis, "Real Shading in Unreal Engine 4", 2013), with their inputs made here,
// procedurally, from what the model knows about each building at load (height, office or homes, its
// seed) and the ground maps (occlusion, water, parks and trees). No textures. Albedos are in the ranges of
// measured materials (Lagarde and de Rousiers, "Moving Frostbite to Physically Based Rendering 3.0",
// 2014, the albedo chart): brick 0.2 to 0.35, limestone 0.4 to 0.55, asphalt 0.05 to 0.12, tar roofs
// 0.07, cool-roof coating 0.5 to 0.6.
//
// New York's night (newYork.js) is the plaster's, unchanged, scaled by uNightGain for this pipeline's
// exposure.

export const realUniforms = {
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uCloudTh: { value: 2 },
  uCloudH: { value: 1500 }, // metres
  uCloudShift: { value: new THREE.Vector2() }, // km
  uCloudOpacity: { value: 0.9 },
  uWetness: { value: 0 },
  uNightGain: { value: 1 },
  uWind: { value: new THREE.Vector2(1, 0) }, // where it blows to, unit
  uWindSpeed: { value: 4 }, // m/s at 10 m
  tBuild: { value: null }, // the buildings' radiance (rgb) and view depth in metres (a)
  uRes: { value: new THREE.Vector2(1, 1) },
  uFrame: { value: 0 },
  uSsr: { value: 1 },
}

// Shared by both: the cloud layer's shadow, and filtered patterns.
const REAL_COMMON = /* glsl */ `
  uniform vec3 uSunDirW;
  uniform float uCloudTh;
  uniform float uCloudH;
  uniform vec2 uCloudShift;
  uniform float uCloudOpacity;
  uniform float uWetness;
  uniform float uNightGain;
  ${CLOUDS_GLSL}

  // The fraction of the sun the cloud layer lets through at world point p.
  float cloudShadow(vec3 p) {
    if (uCloudTh > 1.5) return 1.0;
    vec2 q = (p.xz + uSunDirW.xz / max(uSunDirW.y, 0.06) * (uCloudH - p.y)) * 0.001 + uCloudShift;
    return 1.0 - cloudCover(q, uCloudTh) * uCloudOpacity;
  }

  // A periodic pulse (on where fract(x) < d), box-filtered over a footprint w: the exact average of the
  // pattern over the pixel, so detail below a pixel averages instead of aliasing (the analytic
  // antialiasing of Apodaca and Gritz, "Advanced RenderMan", 1999, ch. 11).
  float pulseInt(float x, float d) { return floor(x) * d + min(fract(x), d); }
  float pulse(float x, float w, float d) {
    w = max(w, 1e-4);
    return (pulseInt(x + 0.5 * w, d) - pulseInt(x - 0.5 * w, d)) / w;
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
  }
`

// ---------------------------------------------------------------------------------------------------
// Buildings

const FACADE = /* glsl */ `
  ${REAL_COMMON}

  // Masonry: red brick, brownstone, buff brick, limestone, white glazed brick and stucco, grey concrete,
  // sooty dark brick. Linear albedo.
  const vec3 MASONRY[7] = vec3[7](
    vec3(0.24, 0.11, 0.075), vec3(0.15, 0.09, 0.068), vec3(0.36, 0.29, 0.21), vec3(0.44, 0.41, 0.35),
    vec3(0.52, 0.5, 0.46), vec3(0.28, 0.28, 0.27), vec3(0.14, 0.13, 0.12)
  );
  // Each material's porosity (how much rain darkens it).
  const float POROUS[7] = float[7](0.85, 0.8, 0.75, 0.5, 0.35, 0.65, 0.8);
  // How often each appears on homes and on offices (cumulative).
  const float HOMES[7] = float[7](0.36, 0.54, 0.68, 0.76, 0.86, 0.96, 1.0);
  const float OFFICES[7] = float[7](0.12, 0.17, 0.39, 0.64, 0.78, 0.95, 1.0);
  // Curtain-wall glass tints: blue-green, neutral grey, bronze, blue, and silver reflective.
  const vec3 GLASS[5] = vec3[5](vec3(0.026, 0.040, 0.042), vec3(0.034, 0.036, 0.040), vec3(0.046, 0.036, 0.028), vec3(0.024, 0.031, 0.050), vec3(0.05, 0.055, 0.06));

  struct Mat { vec3 albedo; float rough; float metal; float porous; };

  // metalness m and base colour b that give a dielectric with this diffuse albedo and this F0 (glass
  // with a coating: F0 0.06 to 0.17, more than MeshStandardMaterial's fixed 0.04).
  Mat glassOf(vec3 tint, float f0, float rough) {
    // With x = 1 - m: 0.04 x^2 - (f0 + t) x + t = 0, the root in (0, 1].
    float t = tint.g;
    float x = ((f0 + t) - sqrt(max((f0 + t) * (f0 + t) - 0.16 * t, 0.0))) / 0.08;
    x = clamp(x, 0.05, 1.0);
    return Mat(tint / x, rough, 1.0 - x, 0.0);
  }

  Mat mixMat(Mat a, Mat b, float t) {
    return Mat(mix(a.albedo, b.albedo, t), mix(a.rough, b.rough, t), mix(a.metal, b.metal, t), mix(a.porous, b.porous, t));
  }

  Mat facade(vec3 p, vec3 n, float seed, float top, float office) {
    float r1 = fract(seed * 13.17 + 0.31);
    float r2 = fract(seed * 71.31 + 0.71);
    float r3 = fract(seed * 191.7 + 0.13);
    float r4 = fract(seed * 37.9 + 0.57);
    // Roofs: tar, gravel ballast, silver and white cool-roof coatings, concrete; mechanical clutter as
    // noise at a few metres.
    if (n.y > 0.5) {
      float flatRoof = smoothstep(0.92, 0.98, n.y);
      vec3 a = r3 < 0.3 ? vec3(0.07, 0.07, 0.075) : r3 < 0.6 ? vec3(0.21, 0.2, 0.19) : r3 < 0.85 ? vec3(0.42, 0.42, 0.41) : vec3(0.3, 0.29, 0.28);
      // Bulkheads, plant and water tanks: a few metres across, so below a pixel they average out.
      float clutter = vnoise(p.xz / 5.0 + seed * 50.0);
      float fw = fwidth(p.x / 5.0);
      a *= mix(mix(0.75, 1.12, clutter), 0.97, smoothstep(0.3, 0.8, fw));
      // Pitched roofs and domes: slate.
      a = mix(vec3(0.12, 0.12, 0.13), a, flatRoof);
      return Mat(a, r3 > 0.6 && r3 < 0.85 ? 0.55 : 0.88, 0.0, 0.7 * flatRoof);
    }
    vec2 along = normalize(vec2(-n.z, n.x));
    float u = dot(p.xz, along);
    // The night's window grid (newYork.js): 3.3 m bays, 3.6 m storeys.
    vec2 q = vec2(u / 3.3, p.y / 3.6);
    vec2 fq = fwidth(q);
    float glassP = office * (top > 150.0 ? 0.75 : top > 80.0 ? 0.5 : top > 40.0 ? 0.2 : 0.04);
    // A street-level band of shop fronts.
    float shop = 1.0 - smoothstep(4.5, 5.5, p.y);
    if (r1 < glassP) {
      // Curtain wall: vision glass, a spandrel band at each floor slab, aluminium mullions every 1.5 m.
      int t = int(r2 * 4.999);
      bool silver = r4 < 0.15;
      vec3 tint = GLASS[silver ? 4 : t] * mix(0.85, 1.15, r3);
      Mat vision = glassOf(tint, silver ? 0.16 : mix(0.06, 0.1, r4), 0.05);
      Mat spandrel = glassOf(tint * 1.6, silver ? 0.16 : 0.07, 0.22);
      Mat mullion = Mat(vec3(0.45, 0.46, 0.48), 0.45, 1.0, 0.0);
      float v = pulse(q.y + 0.15, fq.y, 0.7);
      Mat m = mixMat(spandrel, vision, v);
      float mul = 1.0 - pulse(u / 1.5, fwidth(u / 1.5), 0.93);
      return mixMat(m, mullion, mul * 0.8);
    }
    // Masonry with punched windows.
    float k = r2;
    int i = 0;
    for (int j = 0; j < 7; j++) {
      float edge = mix(HOMES[j], OFFICES[j], office);
      if (k > edge) i = j + 1;
    }
    i = min(i, 6);
    vec3 wall = MASONRY[i] * mix(0.85, 1.15, r3) * vec3(1.0, mix(0.97, 1.03, r4), mix(0.95, 1.05, r1));
    // Weathering: a broad patchiness, and grime toward the street.
    wall *= mix(0.88, 1.08, vnoise(vec2(u, p.y) / 18.0 + seed * 9.0)) * mix(0.82, 1.0, smoothstep(0.0, 25.0, p.y));
    Mat stone = Mat(wall, i == 4 ? 0.6 : 0.85, 0.0, POROUS[i]);
    // Windows: dark glass in front of a dark room, blinds drawn in some.
    float blind = step(0.8, hash21(floor(q) + seed * 31.0));
    Mat win = Mat(mix(vec3(0.03, 0.032, 0.035), vec3(0.22, 0.21, 0.19), blind * (1.0 - smoothstep(0.4, 1.0, max(fq.x, fq.y)) * 0.8)), 0.08, 0.0, 0.0);
    float wx = mix(0.42, 0.58, office);
    float wy = mix(0.55, 0.6, office);
    float w = pulse(q.x + 0.5 * wx, fq.x, wx) * pulse(q.y - 0.25, fq.y, wy);
    // No windows on a parapet's last metre and a half; shop windows at street level.
    w *= 1.0 - smoothstep(top - 2.0, top - 1.2, p.y);
    w = mix(w, 0.75 * pulse(u / 8.0, fwidth(u / 8.0), 0.85), shop * step(1.0, p.y));
    return mixMat(stone, win, w);
  }
`

// What the buildings' fragment shader does with it, after three's colour and roughness chunks.
const FACADE_APPLY = /* glsl */ `
  vec3 nWorld = normalize(cross(dFdx(vModel), dFdy(vModel)));
  vec3 pc = vModel - uOrigin;
  Mat fm;
  if (vBake.z < 0.25) fm = Mat(vec3(0.3, 0.3, 0.31), 0.6, 0.0, 0.3); // bridges: painted steel and stone
  else fm = facade(pc, nWorld, vBake.y, vTop, step(0.5, vKind.x));
  // Rain: water fills the pores (darker) and films the surface (smoother); roofs pond (Lagarde, "Water
  // drop 3b: physically based wet surfaces", 2013).
  float wetF = uWetness * fm.porous;
  fm.albedo *= mix(1.0, 0.55, wetF);
  fm.rough = mix(fm.rough, nWorld.y > 0.9 ? 0.08 : 0.35, uWetness * mix(0.6, 1.0, step(0.9, nWorld.y)) * step(0.01, fm.porous));
  diffuseColor.rgb = fm.albedo;
  roughnessFactor = fm.rough;
  metalnessFactor = fm.metal;
  totalEmissiveRadiance += ${NIGHTS['new-york'].night} * uNightGain;
  // The streets' own light after dark, at the foot of every wall.
  totalEmissiveRadiance += uNight * uNightGain * ${NIGHTS['new-york'].street} * 0.07 * exp(-max(vModel.y, 0.0) / 20.0) * (1.5 - vBake.x);
`

// After the lights: the cloud layer's shadow on the sun, and the sky's reflection occluded where the
// streets close in (the baked sky visibility; Lagarde and de Rousiers 2014, section 4.10).
const REAL_POST = /* glsl */ `
  {
    float sunVis = cloudShadow(vModel);
    reflectedLight.directDiffuse *= sunVis;
    reflectedLight.directSpecular *= sunVis;
    // Lagarde and de Rousiers 2014, section 4.10.2: specular occlusion from the ambient occlusion, the view
    // angle and the roughness; and reflections toward the horizon, which in a city meet other buildings
    // long before they meet the sky, dimmed by the sky visibility once more.
    float ao = mix(0.2, 1.0, vBake.x);
    float nv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
    float so = clamp(pow(nv + ao, exp2(-16.0 * roughnessFactor - 1.0)) - 1.0 + ao, 0.0, 1.0);
    vec3 rw = reflect(-geometryViewDir, geometryNormal);
    float up = (inverseTransformDirection(rw, viewMatrix)).y;
    reflectedLight.indirectSpecular *= so * mix(ao * ao, 1.0, smoothstep(0.05, 0.6, up));
  }
`

export function realBuildingMaterial(origin = [0, 0, 0], { plain = false } = {}) {
  const night = NIGHTS['new-york']
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, flatShading: true })
  if (plain) m.defines = { [night.plain]: '' }
  m.userData.uniforms = { uOrigin: { value: new THREE.Vector3(...origin) }, ...cityClock['new-york'], ...realUniforms }
  m.userData.beginVertex = /* glsl */ `
    vBake = bake.rgb;
    vModel = (modelMatrix * vec4(position, 1.0)).xyz;
    ${night.begin}
  `
  return patch(m, {
    key: `real-buildings${plain ? ':plain' : ''}`,
    ao: 'mix(0.25, 1.0, vBake.x)',
    vertex: night.vert,
    header: night.frag + FACADE,
    emissive: FACADE_APPLY,
    post: REAL_POST,
  })
}

// ---------------------------------------------------------------------------------------------------
// The ground: the plinth's top (ground map: r occlusion, g water; cover map: r parks and grass, g trees)
// and, beyond it, open water.

const GROUND_HEADER = /* glsl */ `
  ${REAL_COMMON}
  uniform sampler2D uGround;
  uniform sampler2D uCover;
  uniform vec2 uHalf;
  uniform vec2 uWind;
  uniform float uWindSpeed;
  uniform sampler2D tBuild;
  uniform mat4 projectionMatrix; // three sets it for every program; its fragment prefix does not declare it
  uniform vec2 uRes;
  uniform float uFrame;
  uniform float uSsr;
  vec2 groundMap;
  float onTop;
  float waterF;
  float ssrRough;
  float ctxRoof;
  float ctxShade;
  float ctxAo = 1.0;
  vec3 ctxNormal = vec3(0.0, 1.0, 0.0);
  float ctxHitY = 0.0;
  float ctxWall = 0.0;
  uniform sampler2D uContext;
  uniform vec4 uCtxBox; // x0, x1, z0, z1 (world metres)
  ${NIGHTS['new-york'].plinth}

  // The country round the plinth (scripts/models/context.mjs): r water, g buildings' cover, b parks,
  // a height (sqrt-encoded, 0..400 m). Its low buildings are drawn on the ground, lit as a height field:
  // a normal from the heights round the pixel and a short march toward the sun for their shadows.
  vec2 ctxUv(vec2 xz) { return (xz - uCtxBox.xz) / (uCtxBox.yw - uCtxBox.xz); }
  float ctxHeight(vec2 uv) { float a = textureLod(uContext, uv, 0.0).a; return a * a * 400.0; }

  // Wind waves: a few directional octaves round the wind's heading, deep-water dispersion
  // (omega^2 = g k; Tessendorf, "Simulating Ocean Water", 2001). Their slopes take the part of the
  // Cox-Munk slope variance (0.003 + 0.00512 U, U in m/s at 12.5 m; Cox and Munk 1954) that the pixel
  // resolves; the rest, and any octave too fine for the pixel, goes into the roughness (as LEAN mapping
  // folds filtered normal variance into the lobe).
  vec3 waves(vec2 xz, float t, out float rough) {
    float U = max(uWindSpeed, 0.5);
    float variance = 0.003 + 0.00512 * U;
    vec2 g = vec2(0.0);
    float resolved = 0.0;
    float px = length(fwidth(xz));
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float lambda = 64.0 * pow(0.62, fi);
      float k = 6.2831853 / lambda;
      float ang = (hash21(vec2(fi, 3.0)) - 0.5) * 1.6;
      vec2 dir = vec2(cos(ang) * uWind.x - sin(ang) * uWind.y, sin(ang) * uWind.x + cos(ang) * uWind.y);
      float w = sqrt(9.81 * k);
      float slope = sqrt(variance * 0.35 / 6.0) * 1.414;
      // Fades out when the wave is under two pixels long.
      float keep = 1.0 - smoothstep(0.25, 0.5, px / lambda);
      float ph = k * dot(dir, xz) - w * t + hash21(vec2(fi, 9.0)) * 6.2831853;
      g += dir * slope * keep * cos(ph);
      resolved += slope * slope * 0.5 * keep;
    }
    // Cox-Munk's slope variance is the GGX alpha squared over two (alpha^2 = 2 sigma^2).
    float alpha = sqrt(2.0 * max(variance - resolved, 0.002));
    rough = sqrt(alpha);
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  // GGX's distribution of normals (Walter et al. 2007), sampled: the half vector for a reflection ray.
  vec3 ggxSample(vec3 N, float a, vec2 xi) {
    float phi = 6.2831853 * xi.x;
    float c = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    float s = sqrt(1.0 - c * c);
    vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    return normalize(T * s * cos(phi) + B * s * sin(phi) + N * c);
  }

  // Screen-space reflection of the buildings (McGuire and Mara, "Efficient GPU Screen-Space Ray
  // Tracing", JCGT 2014: a march through the depth buffer; here in view space, with a binary search to
  // the hit), stochastic over the GGX lobe and resolved by the temporal antialiasing (Stachowiak,
  // "Stochastic Screen-Space Reflections", Advances 2015). The buildings' radiance and depth come from a
  // copy taken before the ground is drawn. Returns the reflected radiance and its confidence.
  vec4 ssr(vec3 P, vec3 R, float jitter) {
    const float MAXD = 3000.0;
    const int N = 20;
    float t = 0.0;
    float stepL = 40.0;
    for (int i = 0; i < N; i++) {
      float prev = t;
      t += stepL * (i == 0 ? jitter : 1.0);
      stepL *= 1.16;
      vec3 Q = P + R * t;
      vec4 c = projectionMatrix * vec4(Q, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || t > MAXD) return vec4(0.0);
      float diff = -Q.z - texture(tBuild, uv).a;
      if (diff > 0.0 && diff < (t - prev) * 1.2 + 30.0) {
        float a = prev;
        float b = t;
        for (int k = 0; k < 5; k++) {
          float m = 0.5 * (a + b);
          vec3 M = P + R * m;
          vec4 cm = projectionMatrix * vec4(M, 1.0);
          vec2 um = cm.xy / cm.w * 0.5 + 0.5;
          if (-M.z - texture(tBuild, um).a > 0.0) { b = m; uv = um; } else a = m;
        }
        vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - uv);
        return vec4(texture(tBuild, uv).rgb, e.x * e.y * (1.0 - smoothstep(0.6, 1.0, t / MAXD)));
      }
    }
    return vec4(0.0);
  }
`

const GROUND_APPLY = /* glsl */ `
  vec2 plinthUv = (vModel.xz + uHalf) / (2.0 * uHalf);
  onTop = step(abs(vModel.x), uHalf.x) * step(abs(vModel.z), uHalf.y);
  vec2 cuv = ctxUv(vWorld.xz);
  vec4 ctx = texture2D(uContext, cuv);
  groundMap = onTop > 0.5 ? texture2D(uGround, plinthUv).rg : vec2(0.6, ctx.r);
  vec2 cover = onTop > 0.5 ? texture2D(uCover, plinthUv).rg : vec2(ctx.b, 0.0);
  float water = groundMap.g;
  waterF = water;
  float land = 1.0 - water;
  // Land: asphalt in the narrow streets, lighter paving where it opens out; parks (November's olive and
  // rust) and tree canopy from the cover map.
  float open = groundMap.r;
  float grain = vnoise(vWorld.xz / 6.0);
  vec3 paving = mix(vec3(0.085, 0.085, 0.09), vec3(0.2, 0.195, 0.185), smoothstep(0.35, 0.85, open)) * mix(0.85, 1.15, grain);
  vec3 grass = vec3(0.11, 0.115, 0.06) * mix(0.8, 1.2, vnoise(vWorld.xz / 9.0));
  vec3 canopy = vec3(0.075, 0.065, 0.045) * mix(0.6, 1.3, vnoise(vWorld.xz / 3.5));
  float green = clamp(cover.r, 0.0, 1.0);
  float trees = max(clamp(cover.g, 0.0, 1.0), green * smoothstep(0.45, 0.75, vnoise(vWorld.xz / 14.0 + 3.0)) * 0.8);
  vec3 landC = mix(mix(paving, grass, green), canopy, trees);
  float landR = mix(mix(0.9, 0.95, green), 0.95, trees);
  ctxRoof = 0.0;
  ctxShade = 1.0;
  if (onTop < 0.5) {
    // Beyond the plinth: the blocks as a height field, found by marching the view ray through it (relief
    // mapping: Policarpo and Oliveira, "Relief Mapping of Non-Height-Field Surface Details", 2005;
    // Tatarchuk, "Practical Parallax Occlusion Mapping", 2006). From 14 degrees up a ten-metre building
    // shows twice as much wall as roof, so the walls matter more than the roofs. Heights over RELIEF are
    // cut: the towers are boxes of their own.
    const float RELIEF = 40.0;
    vec3 V = normalize(vWorld - cameraPosition);
    vec3 ps = vWorld - V * (RELIEF / max(-V.y, 0.05));
    vec3 pe = vWorld;
    vec3 hit = pe;
    float hitH = 0.0;
    float prevH = 0.0;
    vec3 prevP = ps;
    for (int i = 1; i <= 20; i++) {
      vec3 q = mix(ps, pe, float(i) / 20.0);
      float h = min(ctxHeight(ctxUv(q.xz)), RELIEF);
      if (q.y <= h) {
        // Refine between the last point above and this one.
        vec3 lo = prevP;
        vec3 hi = q;
        for (int k = 0; k < 4; k++) {
          vec3 m = 0.5 * (lo + hi);
          if (m.y <= min(ctxHeight(ctxUv(m.xz)), RELIEF)) hi = m; else lo = m;
        }
        hit = hi;
        hitH = min(ctxHeight(ctxUv(hi.xz)), RELIEF);
        prevH = min(ctxHeight(ctxUv(lo.xz)), RELIEF);
        break;
      }
      prevP = q;
    }
    vec2 huv = ctxUv(hit.xz);
    vec4 hc = texture2D(uContext, huv);
    // A wall where the ray met a building's side (the height jumped under it), a roof where it came down
    // on top, the street or a park otherwise.
    float wall = step(0.5, hitH - prevH) * step(1.0, hitH);
    float roofs = (1.0 - wall) * step(1.0, hitH) * (1.0 - hc.r);
    float closeIn = textureLod(uContext, huv, 2.0).g;
    vec3 street = vec3(0.09, 0.09, 0.095) * mix(1.0, 0.55, closeIn);
    // Each building its own materials, chosen by where it stands (30 m cells).
    float k = hash21(floor(hit.xz / 30.0) + 0.5);
    float k2 = hash21(floor(hit.xz / 9.0) + 3.5);
    vec3 roof = (k2 < 0.35 ? vec3(0.08, 0.08, 0.085) : k2 < 0.7 ? vec3(0.2, 0.19, 0.18) : k2 < 0.85 ? vec3(0.36, 0.36, 0.35) : vec3(0.2, 0.12, 0.09));
    vec3 brick = k < 0.4 ? vec3(0.24, 0.11, 0.075) : k < 0.6 ? vec3(0.15, 0.09, 0.068) : k < 0.75 ? vec3(0.36, 0.29, 0.21) : k < 0.88 ? vec3(0.44, 0.41, 0.35) : vec3(0.28, 0.28, 0.27);
    // Windows on the walls: a quarter of the wall, dark glass, averaged below a pixel.
    float storey = pulse(hit.y / 3.0, fwidth(hit.y / 3.0), 0.5);
    brick = mix(brick, vec3(0.035), 0.3 * storey) * mix(0.82, 1.0, smoothstep(0.0, 12.0, hit.y));
    vec3 grassC = vec3(0.11, 0.115, 0.06) * mix(0.8, 1.2, vnoise(hit.xz / 9.0));
    vec3 groundC = mix(street, grassC, hc.b);
    landC = mix(mix(groundC, roof, roofs), brick, wall);
    landR = mix(mix(0.9, 0.85, roofs), 0.85, wall);
    // The wall's normal: down the height field's slope, level.
    vec2 texel = 1.0 / vec2(4096.0);
    float hx = min(ctxHeight(huv + vec2(texel.x, 0.0)), RELIEF) - min(ctxHeight(huv - vec2(texel.x, 0.0)), RELIEF);
    float hz = min(ctxHeight(huv + vec2(0.0, texel.y)), RELIEF) - min(ctxHeight(huv - vec2(0.0, texel.y)), RELIEF);
    vec3 wn = normalize(vec3(-hx, 0.0, -hz) + vec3(0.0, 1e-3, 0.0));
    if (dot(wn, -V) < 0.0) wn = normalize(vec3(-V.x, 0.0, -V.z));
    ctxNormal = wall > 0.5 ? wn : vec3(0.0, 1.0, 0.0);
    // Its shadow: a march toward the sun through the same height field.
    float lit = 1.0;
    if (uSunDirW.y > 0.02) {
      vec2 dir = normalize(uSunDirW.xz);
      float rise = uSunDirW.y / length(uSunDirW.xz);
      vec3 start = hit + ctxNormal * 1.5;
      for (int i = 1; i <= 8; i++) {
        float d = 8.0 * float(i);
        float hh = min(ctxHeight(ctxUv(start.xz + dir * d)), RELIEF);
        lit = min(lit, smoothstep(-1.5, 1.5, start.y + rise * d - hh));
      }
    }
    ctxShade = lit;
    ctxRoof = roofs + wall;
    ctxHitY = hit.y;
    ctxWall = wall;
    ctxAo = mix(1.0, 0.5, closeIn * (1.0 - roofs) * (1.0 - wall) * (1.0 - hc.r)) * mix(0.6, 1.0, smoothstep(0.0, 15.0, hit.y) * wall + (1.0 - wall));
    ctx = hc;
    water = hc.r * (1.0 - step(1.0, hitH));
    waterF = water;
    land = 1.0 - water;
    groundMap.g = water;
  }
  // Puddles on the paving as the rain goes on.
  float puddle = uWetness * smoothstep(0.55, 0.75, vnoise(vWorld.xz / 7.0) + 0.25 * uWetness) * (1.0 - green) * (1.0 - trees);
  landC *= mix(1.0, 0.6, uWetness * (1.0 - trees));
  landR = mix(mix(landR, 0.4, uWetness * (1.0 - trees)), 0.04, puddle);
  // Water: the harbour's own dark, silty green-grey under the reflection.
  float waveRough;
  vec3 wvn = waves(vWorld.xz, uTime, waveRough);
  vec3 waterC = vec3(0.018, 0.026, 0.026);
  diffuseColor.rgb = mix(landC, waterC, water);
  roughnessFactor = mix(landR, waveRough, water);
  metalnessFactor = 0.0;
  ssrRough = roughnessFactor;
  // The surface normal: waves on the water, flat elsewhere.
  vec3 nW = normalize(mix(onTop > 0.5 ? vec3(0.0, 1.0, 0.0) : ctxNormal, wvn, water));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  // After dark beyond the plinth: the street grid's lamps (as New York's, newYork.js) and lit windows on
  // the walls.
  if (onTop < 0.5 && uNight > 0.004) {
    float near = textureLod(uContext, ctxUv(vWorld.xz), 2.0).g;
    float streets = (1.0 - ctx.g) * (1.0 - ctx.b) * land * (1.0 - ctxRoof) * smoothstep(0.15, 0.6, near);
    vec3 lamp = nyStreet(vWorld.xz) * 0.16;
    // Windows a third of each 3 m cell, lit at the hour's share (look.js), averaged below a pixel.
    vec2 wq = vec2(dot(vWorld.xz, vec2(0.7071)) / 3.0, ctxHitY / 3.0);
    vec2 fq = vec2(max(fwidth(wq.x), 1e-3), max(fwidth(wq.y), 1e-3));
    float on = step(hash21(floor(wq) + 7.0), uLit * 0.5);
    float pane = pulse(wq.x + 0.25, fq.x, 0.5) * pulse(wq.y - 0.3, fq.y, 0.6);
    vec3 win = mix(vec3(1.0, 0.62, 0.2), vec3(1.0, 0.85, 0.6), hash21(floor(wq) + 3.0)) * on * pane;
    win = mix(win, vec3(1.0, 0.7, 0.35) * uLit * 0.5 * 0.15, smoothstep(0.4, 1.0, max(fq.x, fq.y)));
    totalEmissiveRadiance += uNight * uNightGain * (lamp * streets + win * ctxWall * 0.9);
  }
  // After dark: the streets, the signs' light, the traffic and the memorial pools (newYork.js).
  float onTopSave = onTop;
  ${NIGHTS['new-york'].ground.replace(/totalEmissiveRadiance \+=/g, 'totalEmissiveRadiance += uNightGain *')}
  onTop = onTopSave;
`

// Inside the lights: the screen-space reflection replaces the sky's where it finds something.
const GROUND_SSR = /* glsl */ `
  #include <lights_fragment_maps>
  if (uSsr > 0.5 && (waterF > 0.01 || ssrRough < 0.5)) {
    vec3 Pv = -vViewPosition;
    vec3 Vv = normalize(vViewPosition);
    vec2 xi = vec2(hash21(gl_FragCoord.xy + uFrame * 17.31), hash21(gl_FragCoord.yx * 1.3 + uFrame * 7.77));
    float a = ssrRough * ssrRough;
    vec3 H = ggxSample(normal, a, xi);
    vec3 R = reflect(-Vv, H);
    if (dot(R, normal) <= 0.0) R = reflect(-Vv, normal);
    vec4 hit = ssr(Pv, R, hash21(gl_FragCoord.xy * 0.71 + uFrame * 3.1));
    radiance = mix(radiance, hit.rgb, hit.a);
  }
`

export function realGroundMaterial(ground, cover, context, { id, halfLength, halfWidth, offset = [0, 0, 0] }) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, ior: 1.333 })
  m.userData.uniforms = {
    uGround: { value: ground },
    uCover: { value: cover },
    uContext: { value: context.texture },
    uCtxBox: { value: new THREE.Vector4(context.box.x0, context.box.x1, context.box.z0, context.box.z1) },
    uHalf: { value: new THREE.Vector2(halfLength, halfWidth) },
    uOrigin: { value: new THREE.Vector3(...offset) },
    ...cityClock[id],
    ...realUniforms,
  }
  m.userData.beginVertex = /* glsl */ `
    vBake = vec3(1.0);
    vModel = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  `
  return patch(m, {
    key: 'real-ground',
    vertex: 'varying vec3 vWorld;',
    header: GROUND_HEADER,
    emissive: GROUND_APPLY,
    ao: 'mix(1.0, mix(0.34, 1.0, groundMap.r), onTop * (1.0 - waterF))',
    post: /* glsl */ `
      {
        float sunVis = cloudShadow(vWorld) * mix(1.0, ctxShade, onTop < 0.5 ? 1.0 : 0.0);
        reflectedLight.directDiffuse *= sunVis;
        reflectedLight.directSpecular *= sunVis;
        reflectedLight.indirectDiffuse *= ctxAo;
      }
    `,
    edit: (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', GROUND_SSR)
    },
  })
}

// The country's towers (scripts/models/context.mjs: x, z, half length, half width, angle, height) as
// boxes with the attributes the buildings' material reads: occlusion low at the foot, a seed, windows;
// the top and kind as New York's solids have them (no landmarks: the plain material).
export function towerGeometry(bin) {
  const f = new Float32Array(bin)
  const n = f.length / 6
  const pos = new Float32Array(n * 8 * 3)
  const bake = new Float32Array(n * 8 * 4)
  const top = new Float32Array(n * 8 * 2)
  const kind = new Uint8Array(n * 8 * 4)
  const index = new Uint32Array(n * 30)
  const rand = (i, k) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  for (let i = 0; i < n; i++) {
    const [x, z, hl, hw, a, h] = f.subarray(i * 6, i * 6 + 6)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const seed = rand(i, 1)
    const office = rand(i, 2) < Math.min(0.85, 0.25 + h / 250)
    const k = [office ? 255 : 0, Math.floor(rand(i, 3) * 6) * 51, Math.round(rand(i, 4) * 255), Math.round(rand(i, 5) * 255)]
    for (let c = 0; c < 8; c++) {
      const u = c & 1 ? hl : -hl
      const v = c & 2 ? hw : -hw
      const y = c & 4 ? h : 0
      const o = i * 8 + c
      pos.set([x + u * ca - v * sa, y, z + u * sa + v * ca], o * 3)
      bake.set([c & 4 ? 1 : 0.35, seed, 1, 1], o * 4)
      top.set([h, 0], o * 2)
      kind.set(k, o * 4)
    }
    const b = i * 8
    // Four walls and the roof, wound outward.
    const quads = [[0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6], [4, 5, 7, 6]]
    quads.forEach(([p, q, r, s2], j) => index.set([b + p, b + r, b + q, b + p, b + s2, b + r], i * 30 + j * 6))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('bake', new THREE.BufferAttribute(bake, 4))
  g.setAttribute('top', new THREE.BufferAttribute(top, 2))
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 4, true))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

// The ground's mesh: a square of `size` metres in the plinth's own frame (x along its axis, z across),
// to be turned like the plinth.
export function groundGeometry(size) {
  const g = new THREE.BufferGeometry()
  const h = size / 2
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-h, 0, -h, -h, 0, h, h, 0, h, h, 0, -h]), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

export { plasterUniforms }
