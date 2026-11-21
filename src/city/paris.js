import { buildingTops } from './solids.js'
import { KIT_FRAG, KIT_HEADER, KIT_PLINTH, KIT_TRAFFIC, f2 } from './nightKit.js'

// Paris after dark, calibrated against photographs from the Arc de Triomphe and the Eiffel Tower
// (DECISIONS.md, 2026-11-21). Homes behind tall windows, sparser than London's and warm, with white LED here
// and there; few offices, in the 8th and among the ministries; the streets warm, orange to gold, the
// avenues lines of light. The Eiffel Tower is gold from nightfall to 23:45 (1 am in summer) and sparkles
// for the first five minutes of each hour until 23:00; the Invalides' gilded dome burns gold; the Arc de Triomphe, Notre-Dame,
// the Panthéon, the Opéra, the Madeleine and the other monuments are floodlit warm; the Grand Palais's glass
// nave and the Louvre's pyramid glow from inside. The Champs-Élysées carries its traffic, the bridges theirs
// (on the right), the quais their lamps, and the tall roofs red obstruction lights. Everything is keyed to
// the model's frame: metres east (x) and south (z) of the centre in models.json.

// How each landmark is lit: 0 a floodlit façade, 1 glass lit from inside (its roofs; its walls floodlit),
// 2 a gilded dome (gold above where the light starts, the stone below floodlit), 3 the Eiffel Tower.
const WASH = 0
const GLASS = 1
const GILDED = 2
const EIFFEL = 3
// Name; the box its solids' tops stand in (x0, z0, x1, z1); the least top that counts; where the light
// starts (m); its colour (as a camera records it); how it is lit. The first match wins.
const LANDMARKS = [
  ['The Eiffel Tower', [-1915, 35, -1820, 130], 0, 0, [1.0, 0.75, 0.3], EIFFEL],
  ['Les Invalides: the dome', [-600, 390, -495, 490], 15, 50, [1.0, 0.76, 0.26], GILDED],
  ['Arc de Triomphe', [-1860, -1665, -1795, -1600], 15, 0, [1.0, 0.86, 0.64], WASH],
  ['Notre-Dame', [2115, 595, 2265, 705], 15, 0, [1.0, 0.9, 0.76], WASH],
  ['The Panthéon', [1875, 1365, 1960, 1470], 20, 0, [1.0, 0.88, 0.7], WASH],
  ['The Grand Palais', [-620, -895, -495, -690], 15, 0, [1.0, 0.84, 0.62], GLASS],
  ['The Petit Palais', [-425, -850, -330, -700], 8, 0, [1.0, 0.84, 0.62], WASH],
  ['The Opéra', [800, -1500, 910, -1400], 15, 0, [1.0, 0.8, 0.5], WASH],
  ['La Madeleine', [280, -1285, 375, -1150], 15, 0, [1.0, 0.86, 0.66], WASH],
  ['The Palais Bourbon', [-135, -385, -55, -300], 12, 0, [1.0, 0.9, 0.76], WASH],
  ['Saint-Augustin', [-110, -1950, -45, -1850], 15, 0, [1.0, 0.84, 0.62], WASH],
  ['The Louvre: the pyramid', [1138, -246, 1185, -199], 10, 0, [1.0, 0.92, 0.78], GLASS],
  ['The Louvre: the Cour Carrée', [1220, -245, 1355, -110], 10, 0, [1.0, 0.82, 0.56], WASH],
  ["L'Hôtel de Ville", [2320, 205, 2435, 370], 10, 0, [1.0, 0.82, 0.56], WASH],
  ["The Musée d'Orsay", [380, -175, 580, -30], 15, 0, [1.0, 0.84, 0.62], WASH],
  ['La Sainte-Chapelle', [1815, 385, 1855, 415], 20, 0, [1.0, 0.84, 0.62], WASH],
  ['La Tour Saint-Jacques', [2105, 100, 2130, 122], 30, 0, [1.0, 0.9, 0.74], WASH],
  ['The Palais de Chaillot', [-2500, -420, -2200, -250], 8, 0, [1.0, 0.86, 0.66], WASH],
]
const EIFFEL_AT = [-1867.6, 81.5] // its axis, in the model's frame
const inBox = ([x0, z0, x1, z1], x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1

// The river bridges, by where their decks' middles are: whether they carry a road and their lamps (0 warm,
// 1 the gilded candelabra of the Pont Alexandre III). The model's other bridges (Métro line 6's viaducts,
// the railway across the Île aux Cygnes) are left dark.
const BRIDGES = [
  [-2356, 399, true, 0], // Bir-Hakeim
  [-2045, -89, true, 0], // Iéna
  [-1690, -394, false, 0], // Debilly
  [-1328, -510, true, 0], // Alma
  [-704, -506, true, 0], // Invalides
  [-470, -514, true, 1], // Alexandre III
  [-30, -484, true, 0], // Concorde
  [338, -299, false, 0], // Léopold-Sédar-Senghor
  [726, -124, true, 0], // Royal
  [926, -44, true, 0], // Carrousel
  [946, -38, true, 0],
  [962, -27, true, 0],
  [1269, 113, false, 0], // des Arts
  [1513, 270, true, 0], // Neuf
  [1527, 272, true, 0],
  [1538, 277, true, 0],
  [1589, 135, true, 0],
  [1604, 131, true, 0],
  [1615, 139, true, 0],
  [1789, 543, true, 0], // Saint-Michel
  [1794, 558, true, 0],
  [1798, 556, true, 0],
  [1812, 556, true, 0],
  [1952, 248, true, 0], // au Change
  [1968, 240, true, 0],
  [1976, 257, true, 0],
  [1971, 625, true, 0], // Petit-Pont
  [2083, 708, false, 0], // au Double
  [2085, 307, true, 0], // Notre-Dame
  [2096, 315, true, 0],
  [2105, 322, true, 0],
  [2243, 381, true, 0], // d'Arcole
  [2299, 839, true, 0], // de l'Archevêché
  [2305, 841, true, 0],
  [2312, 843, true, 0],
  [2388, 686, false, 0], // Saint-Louis
  [2392, 699, false, 0],
  [2406, 687, false, 0],
  [2521, 568, true, 0], // Louis-Philippe
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

// Offices: the business district of the 8th and 9th (from the Champs-Élysées to the Opéra), the
// ministries of the 7th, the 1st round the Louvre. Elsewhere homes.
function officeZone(x, z) {
  const eighth = smooth(-1600, -1300, x) * (1 - smooth(1100, 1400, x)) * smooth(-2050, -1900, z) * (1 - smooth(-1000, -850, z))
  const seventh = smooth(-950, -800, x) * (1 - smooth(250, 400, x)) * smooth(-420, -300, z) * (1 - smooth(500, 650, z))
  const first = smooth(500, 700, x) * (1 - smooth(1400, 1600, x)) * smooth(-900, -750, z) * (1 - smooth(-250, -150, z))
  return Math.max(eighth * 0.75, seventh * 0.6, first * 0.45)
}

// Bits: 1 a river bridge.
const BRIDGE = 1
function classify({ x, z, y, seed, lit, axis, cx, cz }) {
  if (Math.abs(lit - 0.5) < 0.1) return { flags: 1, kind: [0, 0, 0, 0] } // the Eiffel Tower
  if (lit < 0.25) {
    const b = BRIDGES.find((q) => Math.hypot(cx - q[0], cz - q[1]) < 40)
    if (!b) return { flags: 0, kind: [0, 0, 0, 0] }
    const q = Math.round((axis / Math.PI) * 255) % 255
    const a = (q / 255) * Math.PI
    const across = -Math.sin(a) * cx + Math.cos(a) * cz
    return { flags: 32 * BRIDGE, kind: [q, b[2] ? 255 : 0, Math.round(((((across % 64) + 64) % 64) / 64) * 255), b[3] * 85] }
  }
  const i = LANDMARKS.findIndex((l, k) => k > 0 && inBox(l[1], x, z) && y >= l[2])
  const pOffice = Math.min(0.95, Math.max(0.03, mix(0.08, 0.75, officeZone(x, z)) + 0.4 * smooth(40, 120, y)))
  const office = rand(seed, 1) < pOffice
  // Office lamps: 3000 K, 3500 K, 4000 K, clear white LED, cool LED (officeLamp below).
  const b = rand(seed, 2)
  const lamp = [0, 1, 2, 3, 4].find((k) => b < [0.15, 0.35, 0.65, 0.9, 1][k]) ?? 4
  const cool = rand(seed, 3) < 0.1
  return { flags: i >= 0 ? i + 1 : 0, kind: [office ? 255 : 0, office ? lamp * 51 : cool ? 255 : 0, Math.round(rand(seed, 4) * 255), Math.round(rand(seed, 5) * 255)] }
}

// The attribute values and the roofs over 100 m: the Tour Montparnasse, the towers of the Front de Seine,
// the Eiffel Tower's top.
export const parisTops = (geometry, matrix) => buildingTops(geometry, matrix, classify, { lightsAbove: 100, axes: true })

// Shared by the buildings (the light at the foot of their walls) and the plinth. Streetlights: warm,
// orange to gold (the older sodium lamps and the warm LED replacing them), a few districts white LED.
const STREET = /* glsl */ `
  vec3 paStreet(vec2 xz) {
    vec2 q = xz / 380.0;
    vec2 i = floor(q);
    vec2 f = smoothstep(0.0, 1.0, fract(q));
    float n = mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
    vec3 c = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.8, 0.44), n);
    return mix(c, vec3(1.0, 0.88, 0.7), smoothstep(0.78, 0.92, n));
  }
`

const LM_GLSL = /* glsl */ `
  const int NLM = ${LANDMARKS.length};
  const vec4 LM_LOOK[NLM] = vec4[NLM](${LANDMARKS.map((l) => `vec4(${l[4].map(f2).join(', ')}, ${f2(l[5])})`).join(', ')});
  const float LM_FROM[NLM] = float[NLM](${LANDMARKS.map((l) => f2(l[3])).join(', ')});
`

export const PARIS_FRAG = /* glsl */ `
  ${KIT_HEADER}
  // Tall windows, about 3 m apart, 3.3 m floor to floor.
  #define WIN_W 3.0
  #define WIN_H 3.3
  #define OFFICE_LO vec2(0.1, 0.16)
  #define HOME_LO vec2(0.2, 0.13)
  #define RUN 5.0

  // What lights the windows, as a camera balanced for the night records it (see newYork.js). Offices:
  const vec3 OFFICE_LAMP[5] = vec3[5](
    vec3(1.0, 0.68, 0.24),  // 3000 K
    vec3(1.0, 0.78, 0.4),   // 3500 K
    vec3(1.0, 0.88, 0.64),  // 4000 K
    vec3(1.0, 0.96, 0.88),  // clear white LED
    vec3(0.88, 0.94, 1.0)   // cool LED
  );
  vec3 officeLamp(float k) {
    return OFFICE_LAMP[min(int(k * 5.0 + 0.5), 4)];
  }
  // Homes, lamp by lamp: mostly warm, behind curtains; white LED here and there; some buildings all LED.
  vec3 homeLamp(float w, float cool) {
    w = mix(w, 0.7 + 0.3 * w, cool);
    return w < 0.2 ? vec3(1.0, 0.6, 0.17)     // 2700 K, shaded
         : w < 0.6 ? vec3(1.0, 0.7, 0.26)     // 3000 K
         : w < 0.78 ? vec3(1.0, 0.8, 0.42)    // 3500 K
         : w < 0.95 ? vec3(1.0, 0.9, 0.7)     // white LED
         : w < 0.975 ? vec3(0.88, 0.93, 1.0)  // daylight LED
         : vec3(0.32, 0.45, 0.95);            // a television
  }

  ${KIT_TRAFFIC}
  ${KIT_FRAG}
  ${LM_GLSL}
  ${STREET}

  // The bridges' lamps: warm; the Pont Alexandre III's gilded candelabra.
  const vec3 BRIDGE_LAMP[2] = vec3[2](vec3(1.0, 0.76, 0.46), vec3(1.0, 0.7, 0.3) * 1.4);

  // The Eiffel Tower: gold from nightfall to 23:45 (its lamps sit inside the lattice, so the whole
  // structure glows, its members brighter than the gaps between them); for the first five minutes of each
  // hour until 23:00 its twenty thousand bulbs sparkle over the gold. In summer, when the tower stays open
  // late (taken here as July and August), until 1 am, sparkling at midnight too (toureiffel.paris).
  vec3 paEiffel(vec3 p, vec3 nWorld, vec3 gold) {
    float summer = step(6.5, uMonth) * step(uMonth, 8.5);
    float on = summer > 0.5 ? max(step(12.0, uHour), 1.0 - smoothstep(1.0, 1.017, uHour))
                            : step(12.0, uHour) * (1.0 - smoothstep(23.75, 23.767, uHour));
    if (on <= 0.0) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz - vec2(${EIFFEL_AT.map(f2).join(', ')}), along);
    // The lattice's panels: about 8 m low down, finer toward the top.
    float s = mix(8.0, 3.0, smoothstep(0.0, 280.0, p.y));
    vec2 g = vec2(a + p.y, a - p.y) / s;
    float bar = max(smoothstep(0.32, 0.46, abs(fract(g.x) - 0.5)), smoothstep(0.32, 0.46, abs(fract(g.y) - 0.5)));
    float far = smoothstep(0.25, 0.6, max(fwidth(g.x), fwidth(g.y)));
    float lattice = mix(mix(0.35, 1.0, bar), 0.62, far);
    float facing = 0.55 + 0.45 * abs(dot(nWorld, normalize(vec3(0.62, 0.25, 0.74))));
    vec3 c = gold * lattice * facing * 0.55;
    float sparkle = step(fract(uHour), 5.0 / 60.0) * max(step(uHour, 23.1), summer * step(uHour, 0.1));
    if (sparkle > 0.0) {
      vec2 cell = floor(vec2(a, p.y) / 1.8);
      float tw = step(0.96, hash21(cell + floor(uTime * 12.0) * 1.7));
      float px = smoothstep(0.4, 1.2, max(fwidth(a), fwidth(p.y)) / 1.8);
      c += vec3(1.0, 0.97, 0.92) * 7.0 * mix(tw, 0.025, px);
    }
    return c * on;
  }

  // A landmark's light on this fragment, and how much of the windows it replaces.
  vec3 paLandmark(vec3 p, vec3 nWorld, out float cover) {
    vec4 look = LM_LOOK[vLandmark - 1];
    float from = LM_FROM[vLandmark - 1];
    int style = int(look.a + 0.5);
    cover = 1.0;
    if (style == ${EIFFEL}) return paEiffel(p, nWorld, look.rgb);
    if (style == ${GILDED}) {
      // Gold leaf under the lamps above where the dome starts; the stone below floodlit.
      float dome = smoothstep(from - 2.0, from + 2.0, p.y);
      vec3 stone = kitWash(p, nWorld, vec3(1.0, 0.88, 0.7), 0.0) * 0.6;
      float facing = 0.6 + 0.4 * abs(dot(nWorld, normalize(vec3(0.62, 0.25, 0.74))));
      return mix(stone, look.rgb * 0.95 * facing * mix(0.6, 1.0, vBake.x), dome);
    }
    vec3 c = kitWash(p, nWorld, look.rgb, from) * 0.6;
    // Glass roofs lit from inside: a soft, even glow, paler than the stone.
    if (style == ${GLASS}) c = mix(c, vec3(1.0, 0.94, 0.84) * 0.22, smoothstep(0.3, 0.6, nWorld.y));
    return c;
  }

  // How bright a lit window is (New York's are 1.1; see DECISIONS).
  const float WINDOW_GAIN = 1.9;
  // Fewer windows lit than in London: shutters and curtains.
  const float SHARE = 0.45;

  vec3 parisNight(vec3 nWorld) {
    if (uNight < 0.004) return vec3(0.0);
    vec3 p = vModel - uOrigin;
    float seed = vBake.y;
    float cover = 0.0;
    vec3 lm = vec3(0.0);
    // The bridges and landmarks are drawn on their own with this shader; the rest of the city with
    // CITY_PLAIN, which leaves their code out.
    #ifndef CITY_PLAIN
    if ((vFlags & ${BRIDGE}) != 0) return kitBridge(p, nWorld, BRIDGE_LAMP[int(vKind.w * 3.0 + 0.5)], 1.0) * uNight;
    if (vLandmark > 0) lm = paLandmark(p, nWorld, cover);
    #endif
    if (vBake.z < 0.75) return lm * uNight;
    float office = step(0.5, vKind.x);
    float share = uLit * SHARE * mix(0.35, 1.6, vKind.z) * mix(1.0, mix(1.2, 0.12, uLate), office);
    vec3 win = (abs(nWorld.y) > 0.35 || p.y < 4.0) ? vec3(0.0) : kitWindows(nWorld, seed, share);
    return (win * (1.0 - cover) * WINDOW_GAIN + lm + kitShops(p, nWorld, seed, 0.35, vec3(1.0, 0.8, 0.5)) * (1.0 - cover)) * uNight;
  }
`

// The Champs-Élysées, from the Place de l'Étoile to the Place de la Concorde (its carriageway found in the
// ground map, a few metres right of the line between the two), four lanes each way.
const ETOILE = [-1828, -1634]
const CONCORDE = [92, -725]
const d = [CONCORDE[0] - ETOILE[0], CONCORDE[1] - ETOILE[1]]
const len = Math.hypot(...d)
const A = [ETOILE[0] + (d[0] / len) * 135, ETOILE[1] + (d[1] / len) * 135]
const B = [CONCORDE[0] - (d[0] / len) * 110, CONCORDE[1] - (d[1] / len) * 110]

export const PARIS_PLINTH = /* glsl */ `
  ${KIT_HEADER}
  varying vec3 vWorld;
  ${KIT_TRAFFIC}
  ${KIT_PLINTH}
  ${STREET}

  // The streets (open: the ground map's openness, so the light gathers where the walls stand close), the
  // quais' lamps along the Seine, and the Champs-Élysées.
  vec3 parisGround(vec2 q, float open) {
    return kitStreets(q, open, paStreet(q)) + kitQuayLamps(q, vec3(1.0, 0.72, 0.38) * 0.6)
      + kitAvenue(q, vec2(${A.map(f2).join(', ')}), vec2(${B.map(f2).join(', ')}), 5.0, 4.0, 1.0);
  }
`
