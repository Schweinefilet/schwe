import { buildingTops } from './solids.js'
import { KIT_FRAG, KIT_HEADER, KIT_PLINTH, KIT_TRAFFIC, f2 } from './nightKit.js'

// London after dark, calibrated against photographs from the Shard (DECISIONS.md, 2026-11-21). The City's
// offices burn white (LED, mostly 4000 K and clear white, some 3000 to 3500 K) and many stay lit late;
// homes are warm; the streets are LED between 2700 and 4000 K, the City's whiter. The landmarks are
// floodlit: the Palace of Westminster in gold with the Elizabeth Tower's four dials, the Abbey, St Paul's,
// the Tower of London and Southwark Cathedral warm, Tower Bridge cool white; the Shard's spire, the
// Gherkin's dome and the Sky Garden glow from inside; the Oxo Tower's letters are red. The London Eye's
// rim takes one colour a night. The river bridges carry their lamps and their traffic (on the left), the
// Embankments their lamps, and the tall roofs red obstruction lights. Everything is keyed to the model's
// frame: metres east (x) and south (z) of the centre in models.json.

// How each landmark is lit: 0 a floodlit façade, 1 a glass top lit from inside, 2 the Elizabeth Tower
// (floodlit, with its dials), 3 the London Eye's rim (tonight's colour), 4 the Oxo Tower's red letters.
const WASH = 0
const GLOW = 1
const CLOCK = 2
const RING = 3
const LETTERS = 4
// Name; the box its solids' tops stand in (x0, z0, x1, z1); the least top that counts; where the light
// starts (m); its colour (as a camera records it); how it is lit. The first match wins.
const LANDMARKS = [
  ['Elizabeth Tower', [-1645, 795, -1621, 819], 40, 0, [1.0, 0.82, 0.52], CLOCK],
  ['Palace of Westminster', [-1735, 790, -1605, 1100], 8, 0, [1.0, 0.8, 0.5], WASH],
  ['Westminster Abbey and St Margaret’s', [-1880, 880, -1770, 1010], 15, 0, [1.0, 0.88, 0.7], WASH],
  ["St Paul's Cathedral", [100, -700, 265, -580], 20, 0, [1.0, 0.9, 0.74], WASH],
  ['Tower Bridge: the towers and walkways', [1740, 220, 1815, 330], 20, 0, [0.82, 0.9, 1.0], WASH],
  ['Tower of London', [1650, -90, 1820, 70], 12, 0, [1.0, 0.88, 0.7], WASH],
  ['Southwark Cathedral', [740, 170, 830, 240], 15, 0, [1.0, 0.88, 0.7], WASH],
  ['The Monument', [1035, -245, 1052, -228], 30, 0, [1.0, 0.86, 0.64], WASH],
  ["The Shard: the spire's glass", [960, 340, 1050, 440], 240, 236, [0.92, 0.95, 1.0], GLOW],
  ["The Gherkin's dome", [1400, -750, 1465, -685], 170, 166, [0.78, 0.88, 1.0], GLOW],
  ['The Sky Garden', [1180, -420, 1250, -340], 150, 136, [0.9, 1.0, 0.82], GLOW],
  ['The London Eye', [-1310, 440, -1280, 590], 0, 0, [1.0, 1.0, 1.0], RING],
  ['The Oxo Tower', [-515, -48, -498, -34], 50, 44, [1.0, 0.1, 0.05], LETTERS],
]
const inBox = ([x0, z0, x1, z1], x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1

// The river bridges, by where their decks' middles are: whether they carry a road and their lamps (0 warm,
// 1 Tower Bridge's cool white, 2 London Bridge's blue, 3 white LED). The model's other bridges are rail
// viaducts over the streets, left dark.
const BRIDGES = [
  [-1569, 1481, true, 0], // Lambeth
  [-1440, 791, true, 0], // Westminster
  [-1349, 221, false, 3], // Hungerford and the Golden Jubilee footbridges
  [-1345, 194, false, 3],
  [-1324, 178, false, 3],
  [-1130, -118, true, 0], // Waterloo
  [-236, -189, true, 0], // Blackfriars
  [-148, -214, false, 0], // Blackfriars railway bridge
  [169, -112, false, 3], // the Millennium footbridge
  [484, -116, true, 0], // Southwark
  [630, -27, false, 0], // Cannon Street railway bridge
  [922, 3, true, 2], // London Bridge
  [1773, 283, true, 1], // Tower Bridge
  [1767, 276, true, 1],
  [1783, 278, true, 1],
]

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const rand = (seed, k) => {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

// Offices: the City (from Blackfriars to Aldgate, north of the river), its towers most of all; then the
// South Bank from Blackfriars Road to More London, and Whitehall's ministries.
function officeZone(x, z) {
  const city = smooth(80, 400, x) * (1 - smooth(1700, 2000, x)) * smooth(0, -150, z) * (1 - smooth(-1350, -1600, z))
  const core = Math.exp(-((x - 1300) ** 2 + (z + 700) ** 2) / 450 ** 2)
  const south = smooth(-700, -400, x) * (1 - smooth(1500, 1700, x)) * smooth(-60, 60, z) * (1 - smooth(450, 650, z))
  const whitehall = smooth(-1800, -1700, x) * (1 - smooth(-1350, -1250, x)) * smooth(-300, -150, z) * (1 - smooth(750, 820, z))
  return Math.max(city * (0.75 + 0.25 * core), south * 0.55, whitehall * 0.6)
}

// Bits: 1 a river bridge.
const BRIDGE = 1
function classify({ x, z, y, seed, lit, axis, cx, cz }) {
  if (lit < 0.25) {
    const eye = LANDMARKS.findIndex((l) => l[5] === RING)
    if (inBox(LANDMARKS[eye][1], x, z)) return { flags: eye + 1, kind: [0, 0, 0, 0] }
    const b = BRIDGES.find((q) => Math.hypot(cx - q[0], cz - q[1]) < 40)
    if (!b) return { flags: 0, kind: [0, 0, 0, 0] }
    // The deck's direction (as the shader will read it back) and where its centre line falls across it.
    const q = Math.round((axis / Math.PI) * 255) % 255
    const a = (q / 255) * Math.PI
    const across = -Math.sin(a) * cx + Math.cos(a) * cz
    return { flags: 32 * BRIDGE, kind: [q, b[2] ? 255 : 0, Math.round(((((across % 64) + 64) % 64) / 64) * 255), b[3] * 85] }
  }
  const i = LANDMARKS.findIndex((l) => inBox(l[1], x, z) && y >= l[2])
  const pOffice = Math.min(0.95, Math.max(0.03, mix(0.12, 0.85, officeZone(x, z)) + 0.3 * smooth(50, 150, y) - 0.15 * (1 - smooth(14, 26, y))))
  const office = rand(seed, 1) < pOffice
  // Office lamps: 3000 K, 3500 K, 4000 K, clear white LED, cool LED, blue glass (officeLamp below). The
  // towers run whiter.
  const b = rand(seed, 2)
  const tower = smooth(60, 160, y)
  const edges = [mix(0.12, 0.05, tower), mix(0.3, 0.16, tower), mix(0.6, 0.42, tower), mix(0.86, 0.72, tower), mix(0.95, 0.88, tower)]
  const lamp = [0, 1, 2, 3, 4].find((k) => b < edges[k]) ?? 5
  const cool = rand(seed, 3) < 0.08
  return { flags: i >= 0 ? i + 1 : 0, kind: [office ? 255 : 0, office ? lamp * 51 : cool ? 255 : 0, Math.round(rand(seed, 4) * 255), Math.round(rand(seed, 5) * 255)] }
}

// The attribute values and the roofs over 100 m (the City's towers and their cranes carry red lights).
export const londonTops = (geometry, matrix) => buildingTops(geometry, matrix, classify, { lightsAbove: 100, axes: true })

// Shared by the buildings (the light at the foot of their walls) and the plinth.
const STREET = /* glsl */ `
  // Streetlights: LED, 2700 to 4000 K, changing from borough to borough and street to street, not lamp to
  // lamp; the City's run whiter.
  vec3 ldStreet(vec2 xz) {
    vec2 q = xz / 420.0;
    vec2 i = floor(q);
    vec2 f = smoothstep(0.0, 1.0, fract(q));
    float n = mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
    float city = smoothstep(80.0, 400.0, xz.x) * smoothstep(-80.0, -300.0, xz.y) * (1.0 - smoothstep(-1350.0, -1600.0, xz.y));
    return mix(vec3(1.0, 0.7, 0.34), vec3(1.0, 0.9, 0.72), clamp(n * 0.8 + city * 0.4, 0.0, 1.0));
  }
`

const LM_GLSL = /* glsl */ `
  const int NLM = ${LANDMARKS.length};
  const vec4 LM_LOOK[NLM] = vec4[NLM](${LANDMARKS.map((l) => `vec4(${l[4].map(f2).join(', ')}, ${f2(l[5])})`).join(', ')});
  const float LM_FROM[NLM] = float[NLM](${LANDMARKS.map((l) => f2(l[3])).join(', ')});
`

export const LONDON_FRAG = /* glsl */ `
  ${KIT_HEADER}
  #define WIN_W 3.3
  #define WIN_H 3.5
  #define OFFICE_LO vec2(0.05, 0.15)
  #define HOME_LO vec2(0.16, 0.2)
  #define RUN 6.0

  // What lights the windows, as a camera balanced for the night records it (see newYork.js). Offices:
  const vec3 OFFICE_LAMP[6] = vec3[6](
    vec3(1.0, 0.68, 0.24),  // 3000 K
    vec3(1.0, 0.78, 0.4),   // 3500 K
    vec3(1.0, 0.88, 0.64),  // 4000 K
    vec3(1.0, 0.96, 0.88),  // clear white LED
    vec3(0.78, 0.88, 1.0),  // cool LED
    vec3(0.5, 0.7, 1.0)     // behind blue glass
  );
  vec3 officeLamp(float k) {
    return OFFICE_LAMP[min(int(k * 5.0 + 0.5), 5)];
  }
  // Homes, lamp by lamp; some buildings all LED.
  vec3 homeLamp(float w, float cool) {
    w = mix(w, 0.72 + 0.28 * w, cool);
    return w < 0.22 ? vec3(1.0, 0.6, 0.17)    // 2700 K, shaded
         : w < 0.55 ? vec3(1.0, 0.7, 0.26)    // 3000 K
         : w < 0.78 ? vec3(1.0, 0.8, 0.42)    // 3500 K
         : w < 0.95 ? vec3(1.0, 0.88, 0.62)   // 4000 K LED
         : w < 0.975 ? vec3(0.88, 0.93, 1.0)  // daylight LED
         : vec3(0.32, 0.45, 0.95);            // a television in a dark room
  }

  ${KIT_TRAFFIC}
  ${KIT_FRAG}
  ${LM_GLSL}
  ${STREET}

  // The bridges' lamps: warm; Tower Bridge's cool white; London Bridge's blue; white LED.
  const vec3 BRIDGE_LAMP[4] = vec3[4](vec3(1.0, 0.86, 0.64), vec3(0.85, 0.92, 1.0), vec3(0.25, 0.45, 1.0), vec3(0.92, 0.96, 1.0));

  // Tonight's colour for the London Eye: white some nights, otherwise pink, red, blue, violet or gold.
  // A stylisation: which colour on which night is not known here. The night turns at noon.
  vec3 ldEyeColour() {
    float h = hash21(vec2(uDay, 3.7));
    float k = fract(h * 7.0) * 5.0;
    vec3 c = k < 1.5 ? vec3(1.0, 0.2, 0.55) : k < 2.5 ? vec3(1.0, 0.08, 0.06) : k < 3.4 ? vec3(0.15, 0.35, 1.0) : k < 4.4 ? vec3(0.6, 0.2, 1.0) : vec3(1.0, 0.62, 0.12);
    return h < 0.25 ? vec3(0.95, 0.96, 1.0) : c;
  }

  // A landmark's light on this fragment, and how much of the windows it replaces.
  vec3 ldLandmark(vec3 p, vec3 nWorld, out float cover) {
    vec4 look = LM_LOOK[vLandmark - 1];
    float from = LM_FROM[vLandmark - 1];
    int style = int(look.a + 0.5);
    cover = 0.0;
    if (style == ${RING}) return ldEyeColour() * 0.8;
    if (style == ${GLOW}) {
      // Glass lit from inside: the whole top above where it starts.
      cover = smoothstep(from - 1.0, from + 2.0, p.y);
      return look.rgb * cover * mix(0.9, 1.3, smoothstep(from, vTop, p.y)) * 1.1;
    }
    if (style == ${LETTERS}) {
      // O, X and O, one above the other on each face.
      if (abs(nWorld.y) > 0.35 || p.y < from || p.y > from + 10.5) return vec3(0.0);
      vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
      float a = dot(p.xz - vec2(-506.6, -41.2), along) / 3.2;
      float v = (p.y - from) / 3.5;
      vec2 uv = vec2(a, fract(v) * 2.0 - 1.0);
      float letter = floor(v) == 1.0 ? step(min(abs(uv.x - uv.y), abs(uv.x + uv.y)), 0.35) : step(abs(length(uv) - 0.65), 0.22);
      float far = smoothstep(0.2, 0.5, fwidth(v));
      cover = 1.0;
      return look.rgb * mix(letter, 0.45, far) * step(abs(uv.x), 1.0) * 2.4;
    }
    cover = 1.0;
    vec3 c = kitWash(p, nWorld, look.rgb, from) * 0.85;
    if (style == ${CLOCK}) {
      // The four dials, 7 m across, their centres 54.5 m up: lit from behind, a warm white.
      vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
      float d = length(vec2(dot(p.xz - vec2(-1633.4, 807.0), along), p.y - 54.5));
      float dial = (1.0 - smoothstep(3.3, 3.6, d)) * step(abs(nWorld.y), 0.35);
      c = mix(c, vec3(1.0, 0.9, 0.72) * 2.6, dial);
    }
    return c;
  }

  // How bright a lit window is (New York's are 1.1; see DECISIONS).
  const float WINDOW_GAIN = 1.5;

  vec3 londonNight(vec3 nWorld) {
    if (uNight < 0.004) return vec3(0.0);
    vec3 p = vModel - uOrigin;
    float seed = vBake.y;
    float cover = 0.0;
    vec3 lm = vec3(0.0);
    // The bridges and landmarks are drawn on their own with this shader; the rest of the city with
    // CITY_PLAIN, which leaves their code out.
    #ifndef CITY_PLAIN
    if ((vFlags & ${BRIDGE}) != 0) return kitBridge(p, nWorld, BRIDGE_LAMP[int(vKind.w * 3.0 + 0.5)], 0.0) * uNight;
    if (vLandmark > 0) lm = ldLandmark(p, nWorld, cover);
    #endif
    if (vBake.z < 0.75) return lm * uNight;
    // City offices stay lit late more than New York's; homes go to bed.
    float office = step(0.5, vKind.x);
    float share = uLit * mix(0.35, 1.6, vKind.z) * mix(1.0, mix(1.3, 0.3, uLate), office);
    vec3 win = (abs(nWorld.y) > 0.35 || p.y < 4.0) ? vec3(0.0) : kitWindows(nWorld, seed, share);
    return (win * (1.0 - cover) * WINDOW_GAIN + lm + kitShops(p, nWorld, seed, 0.3, vec3(1.0, 0.84, 0.58)) * (1.0 - cover)) * uNight;
  }
`

export const LONDON_PLINTH = /* glsl */ `
  ${KIT_HEADER}
  varying vec3 vWorld;
  ${KIT_TRAFFIC}
  ${KIT_PLINTH}
  ${STREET}

  // The streets (open: the ground map's openness, so the light gathers where the walls stand close), and
  // the Embankments' lamps (the Chain of Light) along the river walls.
  vec3 londonGround(vec2 q, float open) {
    return kitStreets(q, open, ldStreet(q)) + kitQuayLamps(q, vec3(1.0, 0.86, 0.62) * 0.6);
  }
`
