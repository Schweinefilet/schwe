import * as THREE from 'three'
import { NY_BUILDING_FRAG, NY_BUILDING_VERT, NY_PLINTH_FRAG } from './newYork.js'
import { LONDON_FRAG, LONDON_PLINTH } from './london.js'
import { PARIS_FRAG, PARIS_PLINTH } from './paris.js'
import { KIT_BEGIN, KIT_VERT } from './nightKit.js'

// The model's one material: matte off-white plaster. On top of three's standard shading it reads the
// occlusion baked into the mesh (scripts/models/build.mjs) and, after dark, lights the city: each city's
// night is its own (newYork.js, london.js, paris.js). All plaster in the scene shares the uniforms in
// `plasterUniforms`; each city's clock is in `cityClock`.

export const PLASTER = '#f3f0ea'

export const plasterUniforms = {
  uNight: { value: 0 }, // 0 by day, 1 once it is dark: how much the windows show
  uLit: { value: 0.4 }, // the share of windows lit
  uLate: { value: 0 }, // 0 early evening, 1 deep night: office floors go dark
  uWet: { value: 0 }, // rain on the plaster: a little darker
  uBg: { value: new THREE.Color() },
  uTime: { value: 0 }, // seconds: screens, sparkle, traffic
  uSpill: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, // New York's sign light (newYork.js)
}

// Each city's clock (Stage.jsx sets them): its local hour (the Empire State goes dark at 2 am, the Eiffel
// Tower at 23:45, at 1 am in summer), its month, and which night it is, as a day number that turns at noon (the colours of New York's LED
// crowns and of the London Eye).
export const cityClock = Object.fromEntries(['new-york', 'london', 'paris'].map((id) => [id, { uHour: { value: 20 }, uDay: { value: 0 }, uMonth: { value: 1 } }]))

// Each city's night: its vertex and fragment code, how the vertex shader reads its attributes, what the
// buildings' emissive adds, the colour of the light at the foot of the walls, and the plinth's code and
// emissive. `plain`: the define that leaves out the rarer lights, for the solids that have none.
const NIGHTS = {
  'new-york': {
    plain: 'NY_PLAIN',
    vert: NY_BUILDING_VERT,
    begin: 'vTop = top.x; vLandmark = int(top.y + 0.5) & 15; vFlags = int(top.y + 0.5) >> 4; vKind = kind;',
    frag: NY_BUILDING_FRAG,
    night: 'nyNight(nWorld)',
    // (It varies by district; above 90 m its glow is gone, so it is not worked out there.)
    street: '(vModel.y < 90.0 ? nyStreet(vModel.xz - uOrigin.xz) : vec3(0.0))',
    plinth: NY_PLINTH_FRAG,
    // New York's streets, signs and traffic, worked out only on dry ground on top (not the water, which is
    // much of the picture). Brighter than the other cities' streets: from above, New York's street grid is
    // one of its lights.
    ground: /* glsl */ `
      if (uNight > 0.004 && onTop * (1.0 - water) > 0.01) {
        totalEmissiveRadiance += uNight * onTop * (1.0 - water) * (nyStreet(vWorld.xz - uOrigin.xz) * 0.17 * (1.0 - groundMap.r) + nyGround() + nyTraffic(vModel.xz));
      }
      if (uNight > 0.004 && onTop > 0.5) totalEmissiveRadiance += uNight * nyPools(vModel.xz);
    `,
  },
  london: {
    plain: 'CITY_PLAIN',
    vert: KIT_VERT,
    begin: KIT_BEGIN,
    frag: LONDON_FRAG,
    night: 'londonNight(nWorld)',
    street: '(vModel.y < 90.0 ? ldStreet(vModel.xz - uOrigin.xz) : vec3(0.0))',
    plinth: LONDON_PLINTH,
    ground: /* glsl */ `
      if (uNight > 0.004 && onTop * (1.0 - water) > 0.01) totalEmissiveRadiance += uNight * onTop * (1.0 - water) * londonGround(vModel.xz, groundMap.r);
    `,
  },
  paris: {
    plain: 'CITY_PLAIN',
    vert: KIT_VERT,
    begin: KIT_BEGIN,
    frag: PARIS_FRAG,
    night: 'parisNight(nWorld)',
    street: '(vModel.y < 90.0 ? paStreet(vModel.xz - uOrigin.xz) : vec3(0.0))',
    plinth: PARIS_PLINTH,
    ground: /* glsl */ `
      if (uNight > 0.004 && onTop * (1.0 - water) > 0.01) totalEmissiveRadiance += uNight * onTop * (1.0 - water) * parisGround(vModel.xz, groundMap.r);
    `,
  },
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

// key: which program this is (three would otherwise share one program among all the materials patched
// here, whose onBeforeCompile is the same function).
function patch(material, { key, ao, emissive = '', header = '', vertex = '' }) {
  material.customProgramCacheKey = () => key
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

// The buildings: `origin` is where the city's model stands on the floor. `plain`: the city without its
// rarer lights (New York's crowns, signs and names on roofs; London's and Paris's landmarks and bridges),
// for the solids that have none.
export function buildingMaterial(cityId, origin = [0, 0, 0], { plain = false } = {}) {
  const night = NIGHTS[cityId]
  const m = new THREE.MeshStandardMaterial({ color: PLASTER, roughness: 0.88, metalness: 0, flatShading: true })
  if (plain) m.defines = { [night.plain]: '' }
  m.userData.uniforms = { uOrigin: { value: new THREE.Vector3(...origin) }, ...cityClock[cityId] }
  // The mesh is quantized: its node's matrix makes metres of it. World metres, then (each city's offset on
  // the floor only shifts the window grid).
  m.userData.beginVertex = /* glsl */ `
    vBake = bake.rgb;
    vModel = (modelMatrix * vec4(position, 1.0)).xyz;
    ${night.begin}
  `
  return patch(m, {
    key: `buildings:${cityId}${plain ? ':plain' : ''}`,
    ao: 'mix(0.3, 1.0, vBake.x)',
    vertex: night.vert,
    header: night.frag,
    emissive: /* glsl */ `
      vec3 nWorld = normalize(cross(dFdx(vModel), dFdy(vModel)));
      totalEmissiveRadiance += ${night.night};
      // The streets' own light after dark: at the foot of every wall, strongest where the walls stand close.
      totalEmissiveRadiance += uNight * ${night.street} * 0.07 * exp(-max(vModel.y, 0.0) / 20.0) * (1.5 - vBake.x);
      diffuseColor.rgb *= 1.0 - 0.14 * uWet;
    `,
  })
}

// The plinth: a slab whose top carries the ground map (r: occlusion, g: water). Water is a cooler, darker,
// smoother inlay, like tinted resin set into the plaster. `frame` maps a model position to the map.
export function plinthMaterial(map, { id, halfLength, halfWidth, offset = [0, 0, 0] }, depth) {
  const night = NIGHTS[id]
  const m = new THREE.MeshStandardMaterial({ color: PLASTER, roughness: 0.9, metalness: 0 })
  m.userData.uniforms = {
    uGround: { value: map },
    uHalf: { value: new THREE.Vector2(halfLength, halfWidth) },
    uTop: { value: depth / 2 },
    uOrigin: { value: new THREE.Vector3(...offset) },
    ...cityClock[id],
  }
  m.userData.beginVertex = /* glsl */ `
    vBake = vec3(1.0);
    vModel = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  `
  return patch(m, {
    key: `plinth:${id}`,
    vertex: 'varying vec3 vWorld;',
    header: /* glsl */ `
      uniform sampler2D uGround;
      uniform vec2 uHalf;
      uniform float uTop;
      vec2 groundMap;
      float onTop;
      ${night.plinth}
    `,
    // The slab's own frame is the plinth's: x along its axis, z across.
    emissive: /* glsl */ `
      onTop = step(uTop - 0.5, vModel.y);
      groundMap = texture2D(uGround, clamp((vModel.xz + uHalf) / (2.0 * uHalf), 0.0, 1.0)).rg;
      float water = groundMap.g * onTop;
      diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.1 * uWet), vec3(0.655, 0.7, 0.75) * mix(1.0, 0.45, uNight), water);
      roughnessFactor = mix(roughnessFactor, 0.32, water);
      // After dark the streets glow between the buildings (the occlusion map is where they stand close).
      ${night.ground}
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
