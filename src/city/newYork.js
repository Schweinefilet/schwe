import { buildingTops as solidTops } from './solids.js'

// New York after dark. The other cities' windows are one warm colour; New York's are not, because the real
// one is not. Calibrated against photographs of Manhattan at night (DECISIONS.md, 2026-11-20): homes burn
// warm, office floors gold to pale yellow with some green and blue glass, lit a floor at a time; Times
// Square and a few other corners are walls of screens that bathe the towers round them in violet and
// white; the landmark crowns are floodlit (the Empire State in its Signature White, sunset to 2 am,
// sparkling for a few minutes on the hour), other towers' crowns in white, gold and colour; names glow on
// Midtown's roofs; the avenues carry tail lights and headlights; the streetlights are DOT's LED; the tall
// roofs carry red obstruction lights. The colour of a given night's Empire State is not known here, so it
// is never coloured. Everything is keyed to the model's own frame: metres east (x) and south (z) of the
// centre in models.json, the frame scripts/models/build.mjs writes.

// The floodlit crowns: where each stands (x, z), how far from there its parts reach, the height the light
// starts at, its colour, and how it is lit (0 a wash, 1 the Chrysler's chevrons, 2 the Empire State, 3 a
// programmable LED top that changes colour from night to night). For 3 the night's colour is a
// stylisation, like the occupancy curve: the real schedules are not read here. It is white about half the
// nights, otherwise one of a few colours, the same all night (the night turns at noon), different for
// each tower. The Empire State, whose colours are a published schedule, stays in its Signature White.
const LANDMARKS = [
  ['Empire State Building: from the 72nd floor to the mast', 661, -1782, 40, 262, [0.95, 0.97, 1.0], 2],
  ["Chrysler Building: the crown's chevrons", 1533, -2134, 30, 236, [0.9, 0.95, 1.0], 1],
  ['One World Trade Center: the spire', -1661, 2133, 45, 418, [0.92, 0.96, 1.0], 0],
  ['New York Life: the gilded pyramid', 667, -1154, 35, 160, [1.0, 0.62, 0.18], 0],
  ['Metropolitan Life Tower: the cupola', 517, -991, 30, 168, [1.0, 0.84, 0.58], 0],
  ['Woolworth Building: the crown', -1239, 2201, 32, 182, [1.0, 0.8, 0.52], 0],
  ['Municipal Building: the colonnaded crown', -853, 2138, 35, 138, [1.0, 0.7, 0.32], 0],
  ["Con Edison's Tower of Light", 436, -195, 30, 112, [1.0, 0.84, 0.6], 0],
  ['Bank of America Tower: the spire', 762, -2553, 40, 290, [0.9, 0.95, 1.0], 3],
  ['One Vanderbilt: the crown', 1265, -2280, 40, 335, [0.8, 0.82, 0.86], 3],
  ['4 Times Square: the mast', 655, -2615, 30, 250, [0.9, 0.95, 1.0], 3],
  ['70 Pine Street: the crown', -1196, 2859, 30, 232, [1.0, 0.86, 0.64], 0],
  ['40 Wall Street: the pyramid', -1366, 2801, 30, 236, [1.0, 0.84, 0.6], 0],
]
const f = (v) => v.toFixed(2)
const LM_GLSL = /* glsl */ `
  const int NLM = ${LANDMARKS.length};
  const vec4 LM_AT[NLM] = vec4[NLM](${LANDMARKS.map((l) => `vec4(${f(l[1])}, ${f(l[2])}, ${f(l[3])}, ${f(l[4])})`).join(', ')});
  const vec4 LM_LOOK[NLM] = vec4[NLM](${LANDMARKS.map((l) => `vec4(${l[5].map(f).join(', ')}, ${f(l[6])})`).join(', ')});
`

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const rand = (seed, k) => {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}
// 1 in the office districts (Midtown from about 28th Street up, the Financial District), 0 in the
// residential middle; Hudson Yards and the Flatiron district in between.
// Where the signs are: a stretch of street (two points in the model's frame), how far from it the screens
// reach, how bright they are, how high they climb, and 1 where they wrap every face rather than face the
// street. Times Square, Broadway and Seventh Avenue from 42nd to 47th Street; One Times Square, screens on
// every face nearly to its roof; Herald Square (Macy's and the screens on 34th Street); Seventh Avenue
// along Madison Square Garden. Their light reaches three times as far as the screens.
const SIGN_LIST = [
  [548, -2642, 740, -2990, 78, 1.0, 120, 0],
  [603, -2668, 603, -2668, 26, 1.1, 108, 1],
  [420, -1925, 525, -2000, 45, 0.55, 30, 0],
  [70, -1955, 115, -2060, 40, 0.4, 24, 0],
]
function toSign([ax, az, bx, bz], x, z) {
  const l = (bx - ax) ** 2 + (bz - az) ** 2
  const t = l ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l)) : 0
  return Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t)
}

function officeZone(x, z) {
  const midtown = smooth(-1250, -1900, z) * (1 - 0.45 * smooth(-300, -900, x))
  return Math.max(midtown, smooth(-500, -1000, z) * 0.45, smooth(1500, 2100, z))
}

// What each solid is (solids.js does the finding): which landmark it belongs to (1 + its index in
// LANDMARKS, by where its top stands; 0 for none), so the shader looks it up instead of testing all twelve;
// which of the rarer lights it can show; and what kind of building it is, decided once here rather than in
// every pixel: an office or homes (more often an office in the office districts and the taller it is), the
// office's lamp or whether the homes are all-LED, how many of its windows tend to be lit, how bright it is.
function classify({ x, z, y, seed }) {
  const i = LANDMARKS.findIndex((l) => Math.hypot(x - l[1], z - l[2]) < l[3] && y > l[4] - 6)
  // Which of the rarer lights this solid can show at all, so every other pixel skips them: 1 a washed
  // crown (about a third of the towers over 160 m), 2 a lit name on the roof (Midtown, more often near
  // Times Square), 4 within reach of the signs' light (its middle within the signs' box, plus a margin).
  const crown = y >= 160 && rand(seed, 6) < 0.3
  const near = toSign(SIGN_LIST[0], x, z)
  const roofSign = y >= 45 && y <= 260 && z < -1300 && rand(seed, 7) < smooth(-1300, -1800, z) * (0.05 + 0.25 * (1 - smooth(120, 800, near)))
  // (A solid's middle is up to about 60 m from its walls.)
  const signs = SIGN_LIST.some((g) => toSign(g, x, z) < g[4] * 3 + 60)
  const flags = (i >= 0 ? i + 1 : 0) + 16 * ((crown ? 1 : 0) + (roofSign ? 2 : 0) + (signs ? 4 : 0))
  const pOffice = Math.min(0.95, Math.max(0.02, mix(0.15, 0.72, officeZone(x, z)) + 0.3 * smooth(60, 200, y) - 0.2 * (1 - smooth(20, 35, y))))
  const office = rand(seed, 1) < pOffice
  // Lamps: mostly 3000 to 4000 K, some clear white LED, a few behind green or blue glass. The Financial
  // District and the very tall new towers run whiter (eight recent night photographs from Brooklyn and
  // 70 Pine Street: Lower Manhattan reads white and gold, almost never blue).
  const b = rand(seed, 2)
  const cooler = Math.max(smooth(1500, 2100, z), smooth(230, 320, y))
  const edges = [mix(0.3, 0.15, cooler), mix(0.58, 0.35, cooler), mix(0.82, 0.6, cooler), mix(0.87, 0.65, cooler), mix(0.885, 0.67, cooler)]
  const lamp = [0, 1, 2, 3, 4].find((k) => b < edges[k]) ?? 5
  const cool = rand(seed, 3) < 0.05
  return { flags, kind: [office ? 255 : 0, office ? lamp * 51 : cool ? 255 : 0, Math.round(rand(seed, 4) * 255), Math.round(rand(seed, 5) * 255)] }
}

// The attribute values (top, flags; kind) and the roofs over 180 m, for the red obstruction lights.
export const buildingTops = (geometry, matrix) => solidTops(geometry, matrix, classify, { lightsAbove: 180 })

// The colour the signs throw on what is round them: white and violet-magenta (photographs from the Empire
// State Building show the towers round Times Square bathed in it), drifting toward blue and red. The same
// for every pixel, so worked out once a frame into the uSpill uniform (Stage.jsx).
const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
export function signSpill(out, time) {
  out.forEach((v, k) => {
    let tint = mixv([0.85, 0.3, 1.0], [1.0, 0.22, 0.55], 0.5 + 0.5 * Math.sin(time * 0.23 + k * 3))
    tint = mixv(tint, [0.25, 0.45, 1.0], 0.36 + 0.3 * Math.sin(time * 0.17 + k))
    v.fromArray(mixv([1.0, 0.92, 0.88], tint, 0.5))
  })
}

// Shared by the buildings and the plinth: where the signs are. Each is a stretch of street (two points in
// the model's frame), how far from it the signs reach, how bright they are, and how high they climb.
const SIGNS = /* glsl */ `
  // SIGN_LIST, above.
  const int NSIGN = ${SIGN_LIST.length};
  const vec4 SIGN_AT[NSIGN] = vec4[NSIGN](${SIGN_LIST.map((g) => `vec4(${g.slice(0, 4).map(f).join(', ')})`).join(', ')});
  const vec4 SIGN_K[NSIGN] = vec4[NSIGN](${SIGN_LIST.map((g) => `vec4(${g.slice(4).map(f).join(', ')})`).join(', ')});

  // Everything the signs light (their reach, three times over for the light they throw) lies in here.
  const vec4 SIGN_BOX = vec4(-170.0, -3230.0, 980.0, -1690.0);

  float nySeg(vec2 p, vec2 a, vec2 b, out vec2 c) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    c = a + ab * t;
    return length(p - c);
  }

  // The colour each sign cluster throws on what is round them (signSpill below, once a frame).
  uniform vec3 uSpill[NSIGN];
  vec3 signSpill(float k) {
    return uSpill[int(k)];
  }

  // Streetlights: DOT's LED, 4000 K where the first retrofit (2013 to 2017) still stands, 3000 K where
  // it has been replaced; it changes from district to district, not lamp to lamp.
  vec3 nyStreet(vec2 xz) {
    vec2 q = xz / 520.0;
    vec2 i = floor(q);
    vec2 f = smoothstep(0.0, 1.0, fract(q));
    float n = mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
    return mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.86, 0.7), n);
  }
`

const HEADER = /* glsl */ `
  uniform float uTime;
  uniform float uHour;
  uniform float uDay;
  uniform vec3 uOrigin;
  ${SIGNS}
`

export const NY_BUILDING_VERT = /* glsl */ `
  attribute vec2 top;
  attribute vec4 kind;
  varying float vTop;
  flat varying int vLandmark;
  flat varying int vFlags;
  flat varying vec4 vKind;
`

export const NY_BUILDING_FRAG = /* glsl */ `
  ${HEADER}
  varying float vTop;
  flat varying int vLandmark; // 1 + its index in LANDMARKS, or 0
  flat varying int vFlags; // 1 a washed crown, 2 a lit name on the roof, 4 within the signs' light
  flat varying vec4 vKind; // office (0 or 1); its lamp (0..4, in fifths) or, for homes, all-LED; habit; brightness

  // What lights a building's windows. An office has one lamp throughout (and a glass that tints it);
  // a home is lit lamp by lamp, mostly warm, with the odd LED and television. The colours are lamps as a
  // camera balanced for the night sky records them (3000 K reads gold, 4000 K pale yellow), as in the
  // reference photographs: paler, they clip to white in the tone curve and the city goes grey.
  const vec3 OFFICE_LAMP[6] = vec3[6](
    vec3(1.0, 0.58, 0.15),  // 3000 K
    vec3(1.0, 0.71, 0.25),  // 3500 K
    vec3(1.0, 0.8, 0.36),   // 4000 K
    vec3(0.78, 0.98, 0.55), // fluorescent behind green glass
    vec3(0.55, 0.74, 1.0),  // 5500 K LED behind blue glass
    vec3(1.0, 0.95, 0.84)   // 4500 K LED, clear glass: reads white
  );
  vec3 nyHomeLamp(float w) {
    return w < 0.38 ? vec3(1.0, 0.53, 0.12)   // 2700 K, shaded
         : w < 0.7 ? vec3(1.0, 0.63, 0.18)    // 3000 K
         : w < 0.85 ? vec3(1.0, 0.74, 0.3)    // 3500 K
         : w < 0.955 ? vec3(1.0, 0.82, 0.4)   // 4000 K LED
         : w < 0.975 ? vec3(0.86, 0.92, 1.0)  // daylight LED
         : vec3(0.32, 0.45, 0.95);            // a television in a dark room
  }

  // One level of the window grid (see plaster.js windowLevel). The building's own values come in
  // worked out once: whether it is an office, its office lamp, whether its homes are all-LED.
  vec3 nyWindowLevel(vec2 q, float level, float seed, float share, float office, vec3 officeLamp, float cool) {
    float s = exp2(level);
    vec2 cell = floor(q / s);
    vec2 uv = fract(q / s);
    float r = hash21(cell + seed * 97.0 + level * 13.0);
    float on;
    vec3 lamp;
    vec2 lo;
    float bright;
    if (office > 0.5) {
      // Offices light a floor at a time, in runs of about seven bays, glazed nearly edge to edge.
      float run = hash21(vec2(cell.y, floor(cell.x * s / 7.0)) + seed * 61.0 + level * 5.0);
      on = step(run, share) * step(fract(r * 31.0), 0.88);
      // One lamp throughout, but no two windows quite alike: tubes age, blinds tint.
      lamp = officeLamp * vec3(1.0, mix(0.86, 1.08, fract(r * 13.0)), mix(0.75, 1.2, fract(r * 29.0))) * mix(0.88, 1.08, fract(r * 7.0));
      lo = vec2(0.04, 0.16);
      bright = 0.8 + 0.2 * fract(r * 57.0);
    } else {
      // Homes window by window, each its own lamp; some new towers are all-LED.
      on = step(r, share);
      float w = fract(r * 71.0 + 0.37);
      lamp = nyHomeLamp(mix(w, 0.72 + 0.28 * w, cool));
      lo = vec2(0.14, 0.2);
      bright = 0.45 + 0.55 * fract(r * 57.0);
    }
    vec2 hi = lo + vec2(0.08, 0.1);
    vec2 edge = smoothstep(lo, hi, uv) * smoothstep(lo, hi, 1.0 - uv);
    return lamp * on * edge.x * edge.y * bright;
  }

  vec3 nyWindows(vec3 nWorld, vec3 p, float seed) {
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    vec2 q = vec2(dot(vModel.xz, along) / 3.3, vModel.y / 3.6);
    float office = step(0.5, vKind.x);
    vec3 officeLamp = OFFICE_LAMP[min(int(vKind.y * 5.0 + 0.5), 5)];
    float cool = step(0.5, vKind.y) * (1.0 - office);
    float share = uLit * mix(0.35, 1.6, vKind.z) * mix(1.0, mix(1.3, 0.14, uLate), office);
    float px = max(fwidth(q.x), fwidth(q.y));
    float lod = max(0.0, log2(px * 3.2));
    float l0 = floor(lod);
    float f = fract(lod);
    vec3 glow = nyWindowLevel(q, l0, seed, share, office, officeLamp, cool) * (1.0 - f);
    // The next level only where it shows.
    if (f > 0.03) glow += nyWindowLevel(q, l0 + 1.0, seed, share, office, officeLamp, cool) * f;
    // Some buildings are simply brighter than others.
    return glow * mix(0.7, 1.15, vKind.w);
  }


  ${LM_GLSL}

  // The crown light on this fragment, and how much of the windows it replaces (0..1).
  vec3 nyCrowns(vec3 p, vec3 nWorld, float seed, out float cover) {
    cover = 0.0;
    // Every crown starts above 105 m and every generic one is on a tower over 160: most fragments leave here.
    if (p.y < 105.0) return vec3(0.0);
    float facing = 0.5 + 0.5 * abs(dot(nWorld, normalize(vec3(-0.55, 0.3, 0.78))));
    if (vLandmark > 0 && p.y > LM_AT[vLandmark - 1].w - 6.0) {
      vec4 at = LM_AT[vLandmark - 1];
      vec4 look = LM_LOOK[vLandmark - 1];
      float up = smoothstep(at.w - 6.0, at.w + 10.0, p.y);
      cover = up;
      vec3 c = look.rgb * facing;
      if (look.a > 2.5) {
        // Tonight's colour: white half the nights, else red, green, blue, violet, gold or magenta.
        float h = hash21(vec2(uDay, float(vLandmark) * 7.31));
        float k = fract(h * 2.0) * 6.0;
        vec3 led = k < 1.0 ? vec3(1.0, 0.08, 0.05) : k < 2.0 ? vec3(0.12, 1.0, 0.3) : k < 3.0 ? vec3(0.1, 0.3, 1.0)
                 : k < 4.0 ? vec3(0.6, 0.2, 1.0) : k < 5.0 ? vec3(1.0, 0.62, 0.1) : vec3(1.0, 0.12, 0.6);
        c = (h < 0.5 ? look.rgb : led) * facing;
      } else if (look.a > 1.5) {
        // The Empire State: lit sunset to 2 am; for the first five minutes of each hour it sparkles.
        float on = 1.0 - smoothstep(2.0, 2.05, uHour) * (1.0 - smoothstep(11.0, 11.05, uHour));
        vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
        vec2 cell = floor(vec2(dot(p.xz, along), p.y) / 2.5);
        float sparkle = step(fract(uHour), 5.0 / 60.0) * step(0.975, hash21(cell + floor(uTime * 9.0) * 1.7));
        // Floodlit from its setbacks: brightest just above each, the piers lighter than the window bays.
        float pier = smoothstep(0.25, 0.4, abs(fract(dot(p.xz, along) / 4.2) - 0.5));
        float pierFar = smoothstep(0.3, 0.7, fwidth(dot(p.xz, along) / 4.2));
        float wash = 1.0 - 0.4 * fract((p.y - at.w) / 26.0);
        float mast = smoothstep(375.0, 385.0, p.y);
        float bright = mix(mix(0.45, 1.0, mix(pier, 0.75, pierFar)) * wash * 0.95, 1.6, mast);
        return (c * bright + vec3(6.0) * sparkle) * up * on;
      }
      if (look.a > 0.5 && look.a < 1.5) {
        // Triangular windows in rings: chevrons pointing up each face.
        vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
        float a = dot(p.xz - at.xy, along);
        float v = fract((p.y - abs(a) * 0.9) / 7.0);
        float px = fwidth((p.y - abs(a) * 0.9) / 7.0);
        float stripe = mix(smoothstep(0.55, 0.62, v) * (1.0 - smoothstep(0.82, 0.9, v)), 0.3, smoothstep(0.25, 0.6, px));
        return c * (0.35 + 2.6 * stripe) * up;
      }
      // A wash from below: brighter toward the top, the mullions lighter than the glass between them.
      vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
      float m = dot(p.xz, along) / 3.0;
      float mullion = mix(smoothstep(0.3, 0.45, abs(fract(m) - 0.5)), 0.4, smoothstep(0.3, 0.7, fwidth(m)));
      float roof = smoothstep(0.35, 0.8, abs(nWorld.y));
      return c * up * mix(0.55, 1.15, smoothstep(at.w, at.w + 40.0, p.y)) * mix(mix(0.6, 1.25, mullion), 1.0, roof);
    }
    // Any other tall tower: about half wash their crown, mostly in white, some warm, a few in colour.
    // A wash up the top floors from below, and a brighter line along the parapet; walls only.
    if ((vFlags & 1) == 0 || abs(nWorld.y) > 0.35) return vec3(0.0);
    float band = clamp(vTop * 0.06, 9.0, 24.0);
    float up = smoothstep(vTop - band, vTop - 1.0, p.y);
    float k = hash21(vec2(seed * 211.0, 9.0));
    vec2 cs;
    float nearSquare = 1.0 - smoothstep(250.0, 500.0, nySeg(p.xz, SIGN_AT[0].xy, SIGN_AT[0].zw, cs));
    k = mix(k, 0.72 + 0.28 * k, nearSquare * 0.5);
    vec3 c = k < 0.45 ? vec3(0.95, 0.96, 1.0) : k < 0.68 ? vec3(1.0, 0.76, 0.45) : k < 0.8 ? vec3(0.35, 0.5, 1.0)
           : k < 0.9 ? vec3(0.75, 0.3, 1.0) : k < 0.95 ? vec3(0.2, 1.0, 0.45) : vec3(1.0, 0.15, 0.12);
    float line = smoothstep(vTop - 3.5, vTop - 2.0, p.y);
    cover = up * 0.5;
    return c * facing * (0.45 * up * up + 0.8 * line) * (1.0 - 0.6 * uLate);
  }

  // A screen on a wall: a field of one colour with a shape in another, changing every few seconds.
  vec3 adColour(float h) {
    h = fract(h) * 9.0;
    return h < 1.0 ? vec3(1.0, 0.05, 0.03) : h < 2.0 ? vec3(0.06, 0.22, 1.0) : h < 3.0 ? vec3(1.0, 0.08, 0.5)
         : h < 4.0 ? vec3(0.08, 0.8, 1.0) : h < 5.5 ? vec3(1.0, 0.97, 0.92) : h < 6.5 ? vec3(1.0, 0.62, 0.04)
         : h < 7.5 ? vec3(0.12, 1.0, 0.28) : h < 8.3 ? vec3(0.5, 0.1, 1.0) : vec3(0.02, 0.02, 0.05);
  }
  vec3 adFrame(vec2 id, vec2 uv, float slot, float detail) {
    float h1 = hash21(id * 1.7 + slot * 13.1);
    float h2 = hash21(id * 2.3 + slot * 7.7 + 3.0);
    vec3 field = adColour(h1);
    vec3 mark = adColour(h2);
    float shape = h2 < 0.5 ? step(abs(uv.y - 0.4), 0.16) : 1.0 - step(0.3, length((uv - vec2(0.3 + 0.4 * h1, 0.55)) * vec2(1.3, 1.0)));
    shape = mix(0.3, shape, detail);
    return mix(field, mark, shape) * (0.7 + 0.6 * fract(h1 * 17.0));
  }

  // Signs: the screens round Times Square and its smaller cousins, and the light they throw.
  vec3 nySigns(vec3 p, vec3 nWorld, float seed, out float cover) {
    cover = 0.0;
    vec3 glow = vec3(0.0);
    if (any(lessThan(p.xz, SIGN_BOX.xy)) || any(greaterThan(p.xz, SIGN_BOX.zw))) return glow;
    for (int i = 0; i < NSIGN; i++) {
      vec4 s = SIGN_AT[i];
      vec4 k = SIGN_K[i];
      vec2 c;
      float d = nySeg(p.xz, s.xy, s.zw, c);
      if (d > k.x * 3.0) continue;
      vec2 toward = (c - p.xz) / max(d, 1.0);
      // The light the screens throw on walls nearby, strongest low down and on walls that face them.
      float faces = 0.25 + 0.75 * smoothstep(-0.3, 0.6, dot(nWorld.xz, toward));
      float near = 1.0 - smoothstep(0.0, k.x * 3.0, d);
      glow += signSpill(float(i)) * k.y * 1.3 * faces * near * near * exp(-max(p.y, 0.0) / 110.0) * (1.0 - k.w)
        * (1.0 - smoothstep(0.3, 0.7, nWorld.y));
      if (d > k.x || abs(nWorld.y) > 0.35) continue;
      // Screens face the street, and wrap the corners of the blocks that end on it.
      float facing = k.w > 0.5 || d < 8.0 ? 1.0 : smoothstep(-0.45, 0.0, dot(nWorld.xz, toward));
      float tall = k.z * (k.w > 0.5 ? 1.0 : mix(0.25, 1.0, hash21(vec2(seed * 91.0, 4.0))));
      float inside = facing * (1.0 - smoothstep(k.x * 0.75, k.x, d)) * step(p.y, tall);
      if (inside <= 0.0) continue;
      vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
      // Screens of about 12 by 9 metres above a lit shop floor, a few walls left blank.
      vec2 q = vec2(dot(p.xz, along) / 12.0 + seed * 7.0, (p.y - 5.0) / 9.0);
      vec2 id = floor(q);
      vec2 uv = fract(q);
      float detail = 1.0 - smoothstep(0.08, 0.3, max(fwidth(q.x), fwidth(q.y)));
      float present = step(hash21(id + seed * 5.0), mix(0.8, 0.97, k.w)) * step(5.0, p.y);
      vec2 gap = smoothstep(vec2(0.0), vec2(0.05), uv) * smoothstep(vec2(0.0), vec2(0.05), 1.0 - uv);
      float period = 5.0 + 6.0 * hash21(id + seed);
      float t = uTime / period + hash21(id.yx + seed * 3.1);
      vec3 ad = mix(adFrame(id, uv, floor(t), detail), adFrame(id, uv, floor(t) + 1.0, detail), smoothstep(0.9, 1.0, fract(t)));
      ad *= mix(1.0, gap.x * gap.y, detail);
      vec3 shop = vec3(1.0, 0.93, 0.85) * 1.6 * (1.0 - step(5.0, p.y));
      glow += (ad * present * 3.6 + shop) * k.y * inside;
      cover = max(cover, inside * mix(present, 1.0, 1.0 - step(5.0, p.y)));
    }
    return glow;
  }

  // Shop fronts along the streets, on the ground floor: warm and white, with neon here and there.
  vec3 nyShops(vec3 p, vec3 nWorld, float seed) {
    if (abs(nWorld.y) > 0.35 || p.y > 6.0) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz, along) / 8.0;
    float id = floor(a);
    float r = hash21(vec2(id, seed * 47.0));
    float k = hash21(vec2(seed * 13.0, id * 1.3));
    vec3 c = k < 0.55 ? vec3(1.0, 0.8, 0.55) : k < 0.78 ? vec3(0.88, 0.94, 1.0) : k < 0.84 ? vec3(1.0, 0.12, 0.08)
           : k < 0.89 ? vec3(0.2, 0.4, 1.0) : k < 0.94 ? vec3(0.2, 1.0, 0.4) : vec3(1.0, 0.3, 0.7);
    float lit = step(r, mix(0.75, 0.35, uLate));
    float band = smoothstep(0.4, 1.2, p.y) * (1.0 - smoothstep(4.2, 5.5, p.y));
    // Far off a run of shops is one line of light, not a flicker.
    float far = smoothstep(0.3, 0.8, fwidth(a));
    return mix(c * lit, vec3(0.92, 0.76, 0.6) * 0.6, far) * band * 1.3;
  }

  // Lit names on the roofs through Midtown, thickest round Times Square: letters in red or white, now and
  // then blue or yellow, along the middle of one or two faces just under the roof.
  vec3 nyRoofSign(vec3 p, vec3 nWorld, float seed) {
    if (abs(nWorld.y) > 0.35 || p.y < vTop - 12.0) return vec3(0.0);
    float face = floor(atan(nWorld.z, nWorld.x) / 1.5708 + 0.5);
    if (hash21(vec2(seed * 37.0, face)) > 0.5) return vec3(0.0);
    float h = clamp(vTop * 0.05, 4.0, 9.0);
    float y0 = vTop - h - 2.5;
    if (p.y < y0 || p.y > y0 + h) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz, along);
    float span = fract(a / 52.0 + seed * 3.0);
    if (span < 0.2 || span > 0.8) return vec3(0.0);
    // Letters: a few strokes each, from a hash; far off, a lit band.
    float w = h * 0.7;
    float id = floor(a / w);
    vec2 uv = vec2(fract(a / w), (p.y - y0) / h);
    float bits = hash21(vec2(id, seed * 17.0));
    float stem = step(0.12, uv.x) * step(uv.x, 0.3);
    float bar = step(0.15, uv.x) * step(uv.x, 0.75) * (step(0.82, uv.y) * step(fract(bits * 7.0), 0.6) + step(abs(uv.y - 0.48), 0.09) * step(fract(bits * 13.0), 0.5) + step(uv.y, 0.16) * step(fract(bits * 3.0), 0.5));
    float right = step(0.58, uv.x) * step(uv.x, 0.75) * step(fract(bits * 5.0), 0.55);
    float glyph = clamp(stem + bar + right, 0.0, 1.0) * step(0.1, uv.y) * step(uv.y, 0.92) * step(0.12, bits);
    glyph = mix(glyph, 0.38, smoothstep(0.15, 0.45, fwidth(a / w)));
    float k = hash21(vec2(seed * 53.0, 8.0));
    vec3 col = k < 0.5 ? vec3(1.0, 0.07, 0.04) : k < 0.8 ? vec3(1.0, 0.97, 0.92) : k < 0.9 ? vec3(0.15, 0.35, 1.0) : vec3(1.0, 0.7, 0.08);
    return col * glyph * 2.6;
  }

  // The bridges' necklaces: lamps along both sides of each deck.
  vec3 nyBridge(vec3 p, vec3 nWorld) {
    if (abs(nWorld.y) > 0.35) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz, along) / 22.0;
    float dot_ = smoothstep(0.32, 0.12, abs(fract(a) - 0.5) - 0.18);
    float far = smoothstep(0.2, 0.6, fwidth(a));
    float row = smoothstep(7.4, 8.4, p.y);
    return vec3(1.0, 0.92, 0.8) * mix(dot_, 0.45, far) * row * 2.2;
  }

  // How bright a lit window is. London's and Paris's are 1.9; New York's are lower so their colour
  // survives the tone curve instead of clipping to white (measured against the photographs: see DECISIONS).
  const float WINDOW_GAIN = 1.1;

  vec3 nyNight(vec3 nWorld) {
    if (uNight < 0.004) return vec3(0.0);
    vec3 p = vModel - uOrigin;
    float seed = vBake.y;
    if (vBake.z < 0.25) return nyBridge(p, nWorld) * uNight;
    if (vBake.z < 0.75) return vec3(0.0);
    // The rarer lights only on the solids that can have them (vFlags and vLandmark, set at load). Those
    // solids are drawn on their own with this shader; the rest of the city with NY_PLAIN, which leaves the
    // code out altogether (a shader that only carries it pays for it in every pixel).
    float crownCover = 0.0;
    vec3 crown = vec3(0.0);
    float signCover = 0.0;
    vec3 signs = vec3(0.0);
    vec3 roof = vec3(0.0);
    #ifndef NY_PLAIN
    if (vLandmark > 0 || (vFlags & 1) != 0) crown = nyCrowns(p, nWorld, seed, crownCover);
    if ((vFlags & 4) != 0) signs = nySigns(p, nWorld, seed, signCover);
    if ((vFlags & 2) != 0) roof = nyRoofSign(p, nWorld, seed);
    #endif
    vec3 win = (abs(nWorld.y) > 0.35 || p.y < 5.0) ? vec3(0.0) : nyWindows(nWorld, p, seed);
    vec3 shops = nyShops(p, nWorld, seed) * (1.0 - signCover);
    float roofCover = step(0.001, roof.r + roof.g + roof.b);
    return (win * (1.0 - max(max(crownCover, signCover), roofCover)) * WINDOW_GAIN + crown + signs + shops + roof) * uNight;
  }
`

export const NY_PLINTH_FRAG = /* glsl */ `
  ${HEADER}
  varying vec3 vWorld;

  // The avenues, found in the ground map (scripts/models: where the occlusion opens in long lines across
  // Midtown) and named by checking intersections against their coordinates: the plinth's v across, where
  // each runs along it (u), and which way its traffic goes (1 north, -1 south, 0 both).
  const int NAVE = 13;
  const vec4 AVE[NAVE] = vec4[NAVE](
    vec4(-1885.0, 1000.0, 4150.0, 0.0),  // Eleventh Avenue
    vec4(-1609.0, 200.0, 4150.0, 1.0),   // Tenth
    vec4(-1337.0, 100.0, 4150.0, -1.0),  // Ninth
    vec4(-1066.0, 0.0, 4150.0, 1.0),     // Eighth
    vec4(-789.0, 0.0, 4150.0, -1.0),     // Seventh
    vec4(-515.0, -1000.0, 4150.0, 1.0),  // Sixth
    vec4(-207.0, -200.0, 4150.0, -1.0),  // Fifth
    vec4(-57.0, 1130.0, 4150.0, 1.0),    // Madison
    vec4(103.0, 600.0, 4150.0, 0.0),     // Park
    vec4(259.0, 1000.0, 4150.0, -1.0),   // Lexington
    vec4(414.0, 0.0, 4150.0, 1.0),       // Third
    vec4(630.0, -650.0, 4150.0, -1.0),   // Second
    vec4(862.0, -650.0, 4150.0, 1.0)     // First
  );

  // Cars on the avenues: tail lights where the traffic drives away from the lens, headlights where it
  // comes toward it, moving at city speed, thinning out in the small hours. Far off, a tinted line.
  vec3 nyTraffic(vec2 q) {
    vec3 light = vec3(0.0);
    if (q.y < -1896.0 || q.y > 873.0 || q.x < -1000.0) return light;
    float density = clamp(uLit * 1.6, 0.18, 0.95);
    // Which way along the avenues the lens looks (the plinth's u axis is 29 degrees east of north).
    vec2 look = normalize(vWorld.xz - cameraPosition.xz);
    float north = dot(look, vec2(0.4848, -0.8746));
    for (int i = 0; i < NAVE; i++) {
      vec4 a = AVE[i];
      float dv = q.y - a.x;
      if (abs(dv) > 10.0 || q.x < a.y || q.x > a.z) continue;
      float dir = a.w != 0.0 ? a.w : (dv > 0.0 ? 1.0 : -1.0);
      // Six lanes; the outer two are parked cars, dark. A car's lamps are a small point, its place in the
      // lane jittered so the traffic does not march in step.
      float lane = floor((dv + 10.0) / 3.4);
      float moving = step(0.5, lane) * step(lane, 4.5);
      float x = (q.x - dir * (8.0 + 3.0 * hash21(vec2(lane, 3.0))) * uTime) / 24.0 + hash21(vec2(lane, float(i)));
      float slot = floor(x);
      float at = fract(x) - 0.25 - 0.5 * hash21(vec2(slot, lane + 31.0));
      float car = smoothstep(0.07, 0.03, abs(at)) * step(hash21(vec2(slot, lane + float(i) * 7.0)), density);
      float laneMask = smoothstep(0.9, 0.4, abs(fract((dv + 10.0) / 3.4) - 0.5) * 3.4);
      float far = smoothstep(0.25, 0.7, max(fwidth(x), fwidth(dv / 3.4)));
      float lit = mix(car * laneMask, 0.035 * density, far) * moving;
      float tail = smoothstep(-0.25, 0.25, dir * north);
      vec3 c = mix(vec3(1.0, 0.95, 0.86) * 2.2, vec3(1.0, 0.07, 0.03) * 2.0, tail);
      // An avenue starts and ends in a fade, not a cut.
      float ends = smoothstep(a.y, a.y + 150.0, q.x) * (1.0 - smoothstep(a.z - 150.0, a.z, q.x));
      light += c * lit * ends * (1.0 - smoothstep(7.0, 9.5, abs(dv)));
    }
    return light;
  }

  // The 9/11 memorial's two pools, lit white round their rims (they are water in the ground map; these
  // are their outlines there, in the plinth's frame: u from, v from, u to, v to).
  const vec4 POOLS[2] = vec4[2](vec4(-2780.0, -399.0, -2727.0, -342.0), vec4(-2886.0, -334.0, -2829.0, -277.0));
  vec3 nyPools(vec2 q) {
    if (q.x < -2900.0 || q.x > -2710.0 || q.y < -415.0 || q.y > -260.0) return vec3(0.0);
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec4 r = POOLS[i];
      vec2 c = (r.xy + r.zw) * 0.5;
      vec2 h = (r.zw - r.xy) * 0.5;
      vec2 e = abs(q - c) - h;
      float sd = max(e.x, e.y); // negative inside
      float aa = max(fwidth(sd), 0.5);
      // The rim, and the falling water just inside it.
      glow += vec3(1.0, 0.97, 0.92) * (2.4 * (1.0 - smoothstep(1.2, 1.2 + aa, abs(sd + 1.0))) + 0.5 * smoothstep(-9.0, -1.0, sd) * step(sd, 0.0));
    }
    return glow;
  }

  // The ground under the signs: lit almost white, tinted by whatever the screens show.
  vec3 nyGround() {
    vec3 p = vWorld - uOrigin;
    vec3 glow = vec3(0.0);
    if (any(lessThan(p.xz, SIGN_BOX.xy)) || any(greaterThan(p.xz, SIGN_BOX.zw))) return glow;
    for (int i = 0; i < NSIGN; i++) {
      vec2 c;
      float d = nySeg(p.xz, SIGN_AT[i].xy, SIGN_AT[i].zw, c);
      vec4 k = SIGN_K[i];
      glow += signSpill(float(i)) * k.y * (0.7 * (1.0 - smoothstep(0.0, k.x * 0.8, d)) + 0.2 * (1.0 - smoothstep(0.0, k.x * 2.5, d)));
    }
    return glow;
  }
`

