// What London's and Paris's nights share (london.js, paris.js): windows lit lamp by lamp, floodlit façades,
// bridges with their lamps and traffic, lamps along the river walls, traffic on an avenue. New York's night
// (newYork.js) is its own and does not use these.
//
// The windows need from the city, defined before this: `vec3 officeLamp(float k)` (k: the building's lamp,
// 0..1 from its kind), `vec3 homeLamp(float w, float cool)` (w: a window's own random number; cool: 1 for
// an all-LED building), and the window grid: WIN_W and WIN_H (metres between windows across and up),
// OFFICE_LO and HOME_LO (where the glass starts inside its cell, as a share of the cell), RUN (the bays an
// office floor lights at once).

export const f2 = (v) => v.toFixed(2)

export const KIT_VERT = /* glsl */ `
  attribute vec2 top;
  attribute vec4 kind;
  varying float vTop;
  flat varying int vLandmark;
  flat varying int vFlags;
  flat varying vec4 vKind;
`

// In the vertex shader: the attributes, as solids.js and the city's classify wrote them (32 landmarks, then
// the city's bits).
export const KIT_BEGIN = 'vTop = top.x; vLandmark = int(top.y + 0.5) & 31; vFlags = int(top.y + 0.5) >> 5; vKind = kind;'

export const KIT_HEADER = /* glsl */ `
  uniform float uTime;
  uniform float uHour;
  uniform float uDay;
  uniform float uMonth;
  uniform vec3 uOrigin;
`

// Cars on a road (the buildings' bridges and the plinth's avenues). Needs uLit and uTime.
export const KIT_TRAFFIC = /* glsl */ `
  // Cars, as small points moving along a road: tail lights where the traffic drives away from the lens,
  // headlights where it comes toward it, fewer in the small hours; far off, a tinted line. along, across:
  // metres along the road and from its centre line; dir: the road's direction in the world (x, z); lanes:
  // how many each way; the traffic keeps to the right (Paris) or the left (London) of the centre line.
  vec3 kitTraffic(float along, float across, vec2 dir, float lanes, float keepRight, vec2 world) {
    float density = clamp(uLit * 1.6, 0.18, 0.95);
    float laneF = across / 3.4;
    if (abs(laneF) > lanes) return vec3(0.0);
    float lane = floor(laneF);
    // Which way this lane drives: +1 along dir, -1 against. Seen along dir, the right-hand lanes are the
    // ones with a positive across (london.js and paris.js measure across that way).
    float way = (lane >= 0.0 ? 1.0 : -1.0) * (keepRight > 0.5 ? 1.0 : -1.0);
    float x = (along - way * (8.0 + 3.0 * hash21(vec2(lane, 3.0))) * uTime) / 24.0 + hash21(vec2(lane, 9.0));
    float slot = floor(x);
    float at = fract(x) - 0.25 - 0.5 * hash21(vec2(slot, lane + 31.0));
    float car = smoothstep(0.07, 0.03, abs(at)) * step(hash21(vec2(slot, lane + 17.0)), density);
    float laneMask = smoothstep(0.9, 0.4, abs(fract(laneF) - 0.5) * 3.4);
    float far = smoothstep(0.25, 0.7, max(fwidth(x), fwidth(laneF)));
    float lit = mix(car * laneMask, 0.035 * density, far);
    vec2 look = normalize(world - cameraPosition.xz);
    float tail = smoothstep(-0.25, 0.25, way * dot(look, dir));
    return mix(vec3(1.0, 0.95, 0.86) * 2.2, vec3(1.0, 0.07, 0.03) * 2.0, tail) * lit;
  }
`

// The buildings' share: windows, floodlit façades, bridges. Needs KIT_TRAFFIC.
export const KIT_FRAG = /* glsl */ `
  varying float vTop;
  flat varying int vLandmark; // 1 + its index in the city's LANDMARKS, or 0
  flat varying int vFlags; // the city's bits (london.js, paris.js)
  flat varying vec4 vKind; // windows: office (0 or 1); its lamp, or for homes all-LED; habit; brightness
                           // bridges: direction; road (1) or footbridge; centre line; lamps

  // One level of the window grid (see newYork.js): cells of 2^level windows a side, so a far wall glows in
  // blocks at the same average instead of shimmering.
  vec3 kitWindowLevel(vec2 q, float level, float seed, float share, float office, vec3 offLamp, float cool) {
    float s = exp2(level);
    vec2 cell = floor(q / s);
    vec2 uv = fract(q / s);
    float r = hash21(cell + seed * 97.0 + level * 13.0);
    float on;
    vec3 lamp;
    vec2 lo;
    float bright;
    if (office > 0.5) {
      // Offices light a floor at a time, a run of bays together.
      float run = hash21(vec2(cell.y, floor(cell.x * s / RUN)) + seed * 61.0 + level * 5.0);
      on = step(run, share) * step(fract(r * 31.0), 0.88);
      // One lamp throughout, but no two windows quite alike.
      lamp = offLamp * vec3(1.0, mix(0.92, 1.05, fract(r * 13.0)), mix(0.85, 1.12, fract(r * 29.0))) * mix(0.88, 1.08, fract(r * 7.0));
      lo = OFFICE_LO;
      bright = 0.8 + 0.2 * fract(r * 57.0);
    } else {
      on = step(r, share);
      float w = fract(r * 71.0 + 0.37);
      lamp = homeLamp(w, cool);
      lo = HOME_LO;
      bright = 0.45 + 0.55 * fract(r * 57.0);
    }
    vec2 hi = lo + vec2(0.08, 0.1);
    vec2 edge = smoothstep(lo, hi, uv) * smoothstep(lo, hi, 1.0 - uv);
    return lamp * on * edge.x * edge.y * bright;
  }

  // A wall's windows. share: the share of them lit.
  vec3 kitWindows(vec3 nWorld, float seed, float share) {
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    vec2 q = vec2(dot(vModel.xz, along) / WIN_W, vModel.y / WIN_H);
    float office = step(0.5, vKind.x);
    vec3 offLamp = officeLamp(vKind.y);
    float cool = step(0.5, vKind.y) * (1.0 - office);
    float px = max(fwidth(q.x), fwidth(q.y));
    float lod = max(0.0, log2(px * 3.2));
    float l0 = floor(lod);
    float f = fract(lod);
    vec3 glow = kitWindowLevel(q, l0, seed, share, office, offLamp, cool) * (1.0 - f);
    // The next level only where it shows.
    if (f > 0.03) glow += kitWindowLevel(q, l0 + 1.0, seed, share, office, offLamp, cool) * f;
    // Some buildings are simply brighter than others.
    return glow * mix(0.7, 1.15, vKind.w);
  }

  // A floodlit façade: lamps at its foot and on the buildings opposite, so the walls are lit evenly, a
  // little less toward the top, more on the faces turned to the lamps, less in the creases (the baked
  // occlusion); the stone's pilasters and window bays read as lighter and darker bands; roofs catch only
  // the spill. from: where the light starts.
  vec3 kitWash(vec3 p, vec3 nWorld, vec3 c, float from) {
    float up = smoothstep(from - 2.0, from + 3.0, p.y);
    float facing = 0.55 + 0.45 * abs(dot(nWorld.xz, vec2(0.6, 0.8)));
    float roof = smoothstep(0.35, 0.8, abs(nWorld.y));
    float grade = mix(1.1, 0.75, clamp((p.y - from) / max(vTop - from, 1.0), 0.0, 1.0));
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float m = dot(p.xz, along) / 4.0;
    float bays = mix(smoothstep(0.2, 0.42, abs(fract(m) - 0.5)), 0.5, smoothstep(0.3, 0.7, fwidth(m)));
    return c * up * facing * grade * mix(0.6, 1.2, mix(bays, 0.5, roof)) * mix(1.0, 0.4, roof) * mix(0.55, 1.0, vBake.x);
  }

  // Shop fronts and cafés on the ground floor, some lit, warm or white; far off, a faint warm line.
  vec3 kitShops(vec3 p, vec3 nWorld, float seed, float share, vec3 warm) {
    if (abs(nWorld.y) > 0.35 || p.y > 5.0) return vec3(0.0);
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz, along) / 7.0;
    float r = hash21(vec2(floor(a), seed * 47.0));
    vec3 c = fract(r * 13.0) < 0.7 ? warm : vec3(0.95, 0.94, 0.9);
    float lit = step(r, share * mix(1.0, 0.3, uLate));
    float band = smoothstep(0.4, 1.2, p.y) * (1.0 - smoothstep(3.4, 4.4, p.y)) * smoothstep(0.08, 0.3, abs(fract(a) - 0.5));
    float far = smoothstep(0.3, 0.8, fwidth(a));
    return mix(c * lit * 0.75, warm * share * 0.25, far) * band;
  }

  // A bridge: lamps along both sides of the deck and, on a road bridge, its traffic. Its kind holds the
  // deck's direction (0..1 for 0..pi from the x axis), whether it carries a road, where its centre line
  // falls (modulo 64 m across the deck) and its lamps' colour (lamp).
  vec3 kitBridge(vec3 p, vec3 nWorld, vec3 lamp, float keepRight) {
    float ang = vKind.x * 3.14159265;
    vec2 dir = vec2(cos(ang), sin(ang));
    if (abs(nWorld.y) < 0.35) {
      vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
      float a = dot(p.xz, along) / 22.0;
      float dot_ = smoothstep(0.32, 0.12, abs(fract(a) - 0.5) - 0.18);
      float far = smoothstep(0.2, 0.6, fwidth(a));
      float row = smoothstep(7.4, 8.4, p.y);
      return lamp * mix(dot_, 0.45, far) * row * 2.2;
    }
    if (nWorld.y < 0.65 || vKind.y < 0.5) return vec3(0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float across = mod(dot(p.xz, perp) - vKind.z * 64.0 + 32.0, 64.0) - 32.0;
    return kitTraffic(dot(p.xz, dir), across, dir, 2.0, keepRight, vModel.xz);
  }
`

// The plinth's share: the streets' lamps, lamps along the river walls (where dry ground meets water within
// a few metres), and
// traffic on an avenue given as a straight stretch. Needs uGround and uHalf (plaster.js), vWorld, and
// KIT_TRAFFIC.
export const KIT_PLINTH = /* glsl */ `
  // How close the water is: 1 at the river wall, 0 more than about 8 m from it. Only where the water is
  // broad (it is still water 40 m on), so ponds and fountains keep their dark.
  float kitQuay(vec2 xz) {
    vec2 uv = (xz + uHalf) / (2.0 * uHalf);
    // Most ground is nowhere near the river: the ground map's water averaged over about 30 m says so in one
    // read (its mipmaps), before the eight below.
    if (texture2D(uGround, uv, 3.0).g < 0.01) return 0.0;
    vec2 d = 6.0 / (2.0 * uHalf);
    vec2 e = 40.0 / (2.0 * uHalf);
    float w = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 k = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
      w = max(w, texture2D(uGround, uv + k * d).g * texture2D(uGround, uv + k * e).g);
    }
    return smoothstep(0.3, 0.8, w);
  }

  // The lamps on a river wall: a lamp every 20 m or so, far off one thin line of light.
  vec3 kitQuayLamps(vec2 xz, vec3 lamp) {
    float near = kitQuay(xz);
    if (near <= 0.0) return vec3(0.0);
    vec2 cell = floor(xz / 20.0);
    vec2 f = fract(xz / 20.0) - 0.5;
    float bulb = smoothstep(0.25, 0.08, length(f));
    float far = smoothstep(0.15, 0.5, max(fwidth(xz.x), fwidth(xz.y)) / 20.0);
    return lamp * near * mix(0.1 + 2.0 * bulb * step(0.25, hash21(cell)), 0.3, far);
  }

  // The streets' lamps, about 24 m apart. Each 24 m square of ground may hold one, near its middle (so its
  // pool of light stays inside the square), if that spot is street (the ground map's openness there:
  // neither under a building nor out in a park or a big square) and stands along a kerb (buildings nearby:
  // the openness averaged over about 16 m round it, from the map's mipmaps, is low; the middle of a wide
  // avenue or a square is left dark). A lamp is a bright point in a pool of its light on the road, and a
  // faint glow spreads along the carriageway between them. Far off, the lamps average into lines of light
  // along the streets, gathered where the walls stand close, as the light is. open: the openness here.
  vec3 kitStreets(vec2 xz, float open, vec3 lamp) {
    float streetHere = smoothstep(0.25, 0.4, open) * (1.0 - smoothstep(0.9, 0.98, open));
    float far = smoothstep(0.07, 0.26, max(fwidth(xz.x), fwidth(xz.y)) / 24.0);
    float lamps = 0.0;
    if (far < 1.0) {
      vec2 cell = floor(xz / 24.0);
      vec2 at = (cell + 0.35 + 0.3 * vec2(hash21(cell), hash21(cell + 7.1))) * 24.0;
      vec2 uv = (at + uHalf) / (2.0 * uHalf);
      float there = texture2D(uGround, uv).r;
      float street = smoothstep(0.25, 0.4, there) * (1.0 - smoothstep(0.9, 0.98, there));
      if (street > 0.0) {
        float kerb = 1.0 - smoothstep(0.62, 0.78, texture2D(uGround, uv, 2.0).r);
        float dl = length(xz - at);
        lamps = (smoothstep(1.8, 0.3, dl) * 4.0 + smoothstep(7.0, 0.0, dl) * 0.24) * kerb * street;
      }
    }
    float glow = (1.0 - smoothstep(0.9, 0.995, open)) * smoothstep(0.2, 0.35, open) * 0.06 * (1.1 - open);
    return lamp * (mix(lamps, 0.13 * (1.0 - open) * streetHere, far) + glow);
  }

  // An avenue's traffic: a, b its ends (the plinth's frame), its centre line moved by offset metres to the
  // right (seen from a to b), lanes each way.
  vec3 kitAvenue(vec2 q, vec2 a, vec2 b, float offset, float lanes, float keepRight) {
    vec2 ab = b - a;
    float len = length(ab);
    vec2 dir = ab / len;
    vec2 right = vec2(-dir.y, dir.x);
    float t = dot(q - a, dir);
    float across = dot(q - a, right) - offset;
    if (t < 0.0 || t > len || abs(across) > lanes * 3.4 + 1.0) return vec3(0.0);
    float ends = smoothstep(0.0, 60.0, t) * (1.0 - smoothstep(len - 60.0, len, t));
    return kitTraffic(t, across, dir, lanes, keepRight, vWorld.xz) * ends;
  }
`
