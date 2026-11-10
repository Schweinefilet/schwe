import * as THREE from 'three'

// The model's one material: matte off-white plaster. On top of three's standard shading it reads the
// occlusion baked into the mesh (scripts/models/build.mjs) and, after dark, lights windows on the walls.
// All plaster in the scene shares the uniforms in `plasterUniforms`.

export const PLASTER = '#f3f0ea'

export const plasterUniforms = {
  uNight: { value: 0 }, // 0 by day, 1 once it is dark: how much the windows show
  uLit: { value: 0.4 }, // the share of windows lit
  uLate: { value: 0 }, // 0 early evening, 1 deep night: office floors go dark
  uWet: { value: 0 }, // rain on the plaster: a little darker
  uBg: { value: new THREE.Color() },
}

const COMMON_VERT = /* glsl */ `
  attribute vec4 bake;
  varying vec3 vBake;
  varying vec3 vModel;
`
const BEGIN_VERT = /* glsl */ `
  vBake = bake.rgb;
  vModel = position;
`

const COMMON_FRAG = /* glsl */ `
  varying vec3 vBake;
  varying vec3 vModel;
  uniform float uNight;
  uniform float uLit;
  uniform float uLate;
  uniform float uWet;

  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // One level of the window grid: cells of 2^level windows a side. A coarser level lights whole panels at
  // the same average, so a far wall glows in blocks instead of shimmering.
  vec3 windowLevel(vec2 q, float level, float seed, float share) {
    float s = exp2(level);
    vec2 cell = floor(q / s);
    vec2 uv = fract(q / s);
    float r = hash21(cell + seed * 97.0 + level * 13.0);
    float on = step(r, share);
    vec2 edge = smoothstep(vec2(0.14, 0.2), vec2(0.22, 0.3), uv) * smoothstep(vec2(0.14, 0.2), vec2(0.22, 0.3), 1.0 - uv);
    float warm = hash21(cell.yx + seed * 41.0);
    vec3 tint = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.9, 0.74), warm * warm);
    return tint * on * edge.x * edge.y * (0.55 + 0.45 * fract(r * 57.0));
  }

  vec3 windows(vec3 nWorld) {
    if (uNight < 0.004 || vBake.z < 0.75 || abs(nWorld.y) > 0.35 || vModel.y < 1.0) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    vec2 q = vec2(dot(vModel.xz, along) / 3.3, vModel.y / 3.6);
    float seed = vBake.y;
    // Each building keeps its own habits: some are mostly lit, some mostly dark, and about a third are
    // offices that empty as the night goes on.
    float habit = hash21(vec2(seed * 311.0, 7.0));
    float office = step(0.64, hash21(vec2(seed * 173.0, 3.0)));
    float share = uLit * mix(0.35, 1.7, habit) * mix(1.0, mix(1.25, 0.12, uLate), office);
    float px = max(fwidth(q.x), fwidth(q.y));
    float lod = max(0.0, log2(px * 3.2));
    float l0 = floor(lod);
    vec3 glow = mix(windowLevel(q, l0, seed, share), windowLevel(q, l0 + 1.0, seed, share), fract(lod));
    return glow * uNight * 1.9;
  }
`

// After the lights are summed: occlusion on the fill light in full and on the sun in part (a plaster model
// under a soft box shows its creases even on the lit side).
const AO_FRAG = /* glsl */ `
  #include <aomap_fragment>
  {
    float ao = PLASTER_AO;
    reflectedLight.indirectDiffuse *= ao;
    reflectedLight.directDiffuse *= mix(1.0, ao, 0.35);
  }
`

function patch(material, { ao, emissive = '', header = '', vertex = '' }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, plasterUniforms, material.userData.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\n${vertex}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${material.userData.beginVertex ?? BEGIN_VERT}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}\n${header}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`)
      .replace('#include <aomap_fragment>', AO_FRAG.replace('PLASTER_AO', ao))
  }
  return material
}

// The buildings.
export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: PLASTER, roughness: 0.88, metalness: 0, flatShading: true })
  // The mesh is quantized: its node's matrix makes metres of it. World metres, then (each city's offset on
  // the floor only shifts the window grid).
  m.userData.beginVertex = /* glsl */ `
    vBake = bake.rgb;
    vModel = (modelMatrix * vec4(position, 1.0)).xyz;
  `
  return patch(m, {
    ao: 'mix(0.3, 1.0, vBake.x)',
    emissive: /* glsl */ `
      vec3 nWorld = normalize(cross(dFdx(vModel), dFdy(vModel)));
      totalEmissiveRadiance += windows(nWorld);
      // A floodlit structure (the Eiffel Tower) glows gold all over instead.
      // Lit from below and from one side, so its faces still read.
      float flood = step(0.25, vBake.z) * step(vBake.z, 0.75);
      float facing = 0.4 + 0.6 * abs(dot(nWorld, normalize(vec3(0.62, 0.25, 0.74))));
      totalEmissiveRadiance += uNight * flood * vec3(1.0, 0.66, 0.28) * 0.42 * facing * mix(0.45, 1.0, vBake.x);
      // The streets' own light after dark: warm at the foot of every wall, strongest where the walls stand close.
      totalEmissiveRadiance += uNight * vec3(1.0, 0.6, 0.3) * 0.07 * exp(-max(vModel.y, 0.0) / 20.0) * (1.5 - vBake.x);
      diffuseColor.rgb *= 1.0 - 0.14 * uWet;
    `,
  })
}

// The plinth: a slab whose top carries the ground map (r: occlusion, g: water). Water is a cooler, darker,
// smoother inlay, like tinted resin set into the plaster. `frame` maps a model position to the map.
export function plinthMaterial(map, { halfLength, halfWidth }, depth) {
  const m = new THREE.MeshStandardMaterial({ color: PLASTER, roughness: 0.9, metalness: 0 })
  m.userData.uniforms = { uGround: { value: map }, uHalf: { value: new THREE.Vector2(halfLength, halfWidth) }, uTop: { value: depth / 2 } }
  m.userData.beginVertex = /* glsl */ `
    vBake = vec3(1.0);
    vModel = position;
  `
  return patch(m, {
    header: /* glsl */ `
      uniform sampler2D uGround;
      uniform vec2 uHalf;
      uniform float uTop;
      vec2 groundMap;
      float onTop;
    `,
    // The slab's own frame is the plinth's: x along its axis, z across.
    emissive: /* glsl */ `
      onTop = step(uTop - 0.5, vModel.y);
      groundMap = texture2D(uGround, clamp((vModel.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0)).rg;
      float water = groundMap.g * onTop;
      diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.1 * uWet), vec3(0.655, 0.7, 0.75) * mix(1.0, 0.45, uNight), water);
      roughnessFactor = mix(roughnessFactor, 0.32, water);
      // After dark the streets glow between the buildings (the occlusion map is where they stand close).
      totalEmissiveRadiance += uNight * vec3(1.0, 0.6, 0.3) * 0.11 * onTop * (1.0 - water) * (1.0 - groundMap.r);
    `,
    ao: 'mix(1.0, mix(0.34, 1.0, groundMap.r), onTop)',
  })
}

// The studio floor: plaster-grey under the same light, dissolving into the backdrop's colour away from the
// model so floor and wall are one sweep with no horizon.
export function floorMaterial(radius) {
  const m = new THREE.MeshStandardMaterial({ color: '#e9e6e0', roughness: 0.95, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBg = plasterUniforms.uBg
    shader.uniforms.uRadius = { value: radius }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloor = position.xy;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloor;\nuniform vec3 uBg;\nuniform float uRadius;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, sRGBTransferOETF(vec4(uBg, 1.0)).rgb, smoothstep(0.42, 1.0, length(vFloor) / uRadius));`
      )
  }
  return m
}
