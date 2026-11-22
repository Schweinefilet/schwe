import { f2 } from '../nightKit.js'

// The photoreal Paris's own materials (materials.js draws them; docs/paris/rendering-research.md,
// sections 6, 7, 9 and 12). Haussmann's city: limestone walls of five or six storeys with tall windows,
// continuous wrought-iron balconies on the second and fifth floors, a mansard of zinc on top with dormers
// and chimney stacks; slate on the grander roofs; post-war towers in concrete and glass; the monuments in
// their own stone, lead and gold. All procedural, drawn on the model's massing (the model's roofs are mostly
// flat: OSM maps few mansards, so the mansard is the top storey of every wall of a building tall enough).
//
// Albedos (linear) are read off the reference photographs (docs/paris/reference.md, 03 and 07) and kept in
// the ranges of measured materials (Lagarde and de Rousiers, "Moving Frostbite to Physically Based
// Rendering 3.0", 2014, the albedo chart). Patterns finer than a pixel are box-filtered (pulse(), the
// analytic antialiasing of Apodaca and Gritz 1999) so they average instead of crawling.

const EIFFEL_AT = [-1867.6, 81.5] // the tower's axis, in the model's frame (paris.js, the studio's night)

// Needs, before it: REAL_COMMON and the buildings' FACADE (materials.js: Mat, glassOf, mixMat, pulse,
// vnoise) and the city's night (paris.js in src/city: vLandmark, KIT_FRAG).
export const PARIS_FACADE = /* glsl */ `
  uniform float uFrame;
  // Lutetian limestone cleaned, weathered, pale render, sooty stone, brick (the 15th's and the outskirts'
  // Third Republic blocks); and how much rain darkens each (limestone is very porous).
  const vec3 STONE[5] = vec3[5](
    vec3(0.5, 0.44, 0.35), vec3(0.43, 0.39, 0.33), vec3(0.56, 0.52, 0.45), vec3(0.35, 0.32, 0.28), vec3(0.34, 0.2, 0.13)
  );
  const float STONE_P[5] = float[5](0.95, 0.95, 0.7, 0.95, 0.85);
  const float STONE_CUM[5] = float[5](0.42, 0.7, 0.86, 0.96, 1.0);
  // Zinc's patina (zinc carbonate: a matte blue-grey dielectric, not bare metal), slate, wrought iron
  // painted black, the Eiffel Tower's bronze-brown, gold leaf, lead.
  const vec3 ZINC = vec3(0.19, 0.205, 0.23);
  const vec3 SLATE = vec3(0.055, 0.058, 0.068);
  const vec3 IRON = vec3(0.022, 0.023, 0.025);
  const vec3 EIFFEL_PAINT = vec3(0.12, 0.085, 0.06);
  const vec3 GOLD = vec3(1.0, 0.77, 0.34);
  const vec3 LEAD = vec3(0.11, 0.115, 0.125);
  const vec3 WINDOW = vec3(0.028, 0.03, 0.034);

  // The share of the Eiffel Tower's surface that is iron at this point (the rest shows what is behind):
  // its lattice panels, about 8 m low down and finer toward the top, as the studio's night draws them
  // (src/city/paris.js), with the gaps between its legs open below the first platform.
  float paEiffelCover(vec3 p, vec3 nWorld) {
    vec2 along = normalize(vec2(-nWorld.z, nWorld.x));
    float a = dot(p.xz - vec2(${EIFFEL_AT.map(f2).join(', ')}), along);
    float s = mix(8.0, 3.0, smoothstep(0.0, 280.0, p.y));
    vec2 g = vec2(a + p.y, a - p.y) / s;
    // Members a sixth of a panel wide, each way, box-filtered (their coverage over the pixel).
    vec2 fg = vec2(max(fwidth(g.x), 1e-4), max(fwidth(g.y), 1e-4));
    float bx = 1.0 - pulse(g.x + 0.083, fg.x, 0.833);
    float by = 1.0 - pulse(g.y + 0.083, fg.y, 0.833);
    float iron = 1.0 - (1.0 - bx) * (1.0 - by);
    // The solid parts: the platforms' edges and the legs' corner girders, and the top's dense frame.
    float base = mix(0.55, 1.0, smoothstep(180.0, 260.0, p.y));
    float platform = max(1.0 - smoothstep(1.0, 3.5, abs(p.y - 57.6)), 1.0 - smoothstep(1.0, 3.0, abs(p.y - 115.7)));
    return clamp(max(iron * base + 0.12, platform), 0.0, 1.0);
  }

  Mat paMonument(int lm, vec3 p, vec3 n, float seed) {
    if (lm == 2 && p.y > 50.0) {
      // The Invalides' dome: gold leaf on its ribs and garlands over lead.
      return mixMat(Mat(LEAD, 0.45, 0.6, 0.0), Mat(GOLD, 0.32, 1.0, 0.0), 0.55);
    }
    bool roof = n.y > 0.35;
    if (roof && (lm == 6 || lm == 12)) {
      // The Grand Palais's nave and the Louvre's pyramid: glass on an iron frame.
      return mixMat(glassOf(vec3(0.035, 0.045, 0.045), 0.07, 0.08), Mat(vec3(0.12, 0.13, 0.12), 0.5, 0.6, 0.0), 0.25);
    }
    // Lead and slate roofs, cleaned stone walls.
    if (roof) return Mat(mix(LEAD, SLATE, step(0.5, fract(seed * 7.3))), 0.5, 0.0, 0.1);
    vec3 stone = STONE[2] * mix(0.95, 1.05, vnoise(p.xz / 7.0 + p.y / 11.0));
    return Mat(stone, 0.8, 0.0, 0.7);
  }

  Mat parisFacade(vec3 p, vec3 n, float seed, float top, float office, int lm) {
    float r1 = fract(seed * 13.17 + 0.31);
    float r2 = fract(seed * 71.31 + 0.71);
    float r3 = fract(seed * 191.7 + 0.13);
    float r4 = fract(seed * 37.9 + 0.57);
    if (lm > 1) return paMonument(lm, p, n, seed);
    // Post-war towers (the Front de Seine, Beaugrenelle, Montparnasse, the 13th), small buildings and
    // sheds, and Haussmann's city between.
    bool tower = top > 42.0;
    bool small = top < 11.5;
    if (n.y > 0.5) {
      float flatRoof = smoothstep(0.92, 0.98, n.y);
      vec3 a;
      float rough;
      if (tower) {
        a = r3 < 0.5 ? vec3(0.19, 0.185, 0.18) : vec3(0.3, 0.295, 0.29);
        rough = 0.85;
      } else if (small) {
        // Terracotta tiles and slate on the outskirts' houses and the courtyards' sheds.
        a = r3 < 0.55 ? vec3(0.28, 0.12, 0.07) : r3 < 0.8 ? ZINC : SLATE * 1.4;
        rough = 0.75;
      } else {
        a = r3 < 0.74 ? ZINC * mix(0.85, 1.15, r4) : SLATE;
        rough = r3 < 0.74 ? 0.5 : 0.6;
        // Chimney stacks: rendered brick, a metre or two across, with orange pots, in rows along the party
        // walls; far off, their mean.
        float stack = smoothstep(0.8, 0.86, vnoise(p.xz / 2.2 + seed * 40.0));
        float fw = smoothstep(0.4, 1.2, fwidth(p.x) / 2.2);
        a = mix(a, vec3(0.42, 0.34, 0.28), mix(stack, 0.05, fw));
      }
      return Mat(a, rough, 0.0, 0.25 * flatRoof);
    }
    vec2 along = normalize(vec2(-n.z, n.x));
    float u = dot(p.xz, along);
    float fu = max(fwidth(u), 1e-3);
    float fy = max(fwidth(p.y), 1e-3);
    if (tower) {
      // Dark glass and anodised aluminium (Montparnasse, the towers of the Front de Seine), or a concrete
      // frame with ribbon windows.
      if (r1 < 0.45) {
        Mat vision = glassOf(vec3(0.03, 0.032, 0.035) * mix(0.85, 1.2, r3), 0.08, 0.06);
        Mat frame = Mat(vec3(0.16, 0.15, 0.14), 0.45, 0.9, 0.0);
        float v = pulse(p.y / 3.4 + 0.15, fy / 3.4, 0.62);
        float mul = 1.0 - pulse(u / 1.5, fu / 1.5, 0.9);
        return mixMat(mixMat(frame, vision, v), frame, mul * 0.7);
      }
      vec3 concrete = vec3(0.34, 0.33, 0.31) * mix(0.85, 1.1, r3) * mix(0.85, 1.0, smoothstep(0.0, 20.0, p.y));
      float band = pulse(p.y / 3.0 + 0.3, fy / 3.0, 0.55) * pulse(u / 1.8, fu / 1.8, 0.8);
      return mixMat(Mat(concrete, 0.85, 0.0, 0.6), Mat(WINDOW, 0.1, 0.0, 0.0), band);
    }
    // The wall: stone of this building, weathered. Rain runs down from every cornice and sill and leaves
    // dark streaks; soot gathers toward the street (as Unreal's City Sample weathers its facades).
    int si = 0;
    for (int j = 0; j < 4; j++) if (r2 > STONE_CUM[j]) si = j + 1;
    if (small) si = r2 < 0.55 ? 2 : r2 < 0.85 ? 1 : 4;
    vec3 stone = STONE[si] * mix(0.92, 1.08, r3) * vec3(1.0, mix(0.98, 1.02, r4), mix(0.96, 1.04, r1));
    float streak = vnoise(vec2(u / 1.4, p.y / 26.0) + seed * 17.0);
    stone *= mix(mix(0.84, 1.05, streak), 0.95, smoothstep(0.5, 1.5, fu / 1.4));
    stone *= mix(0.78, 1.0, smoothstep(0.0, 9.0, p.y));
    Mat wall = Mat(stone, 0.85, 0.0, STONE_P[si]);
    Mat glass = Mat(mix(WINDOW, vec3(0.2, 0.19, 0.17), step(0.82, hash21(floor(vec2(u / 3.0, p.y / 3.0)) + seed * 31.0)) * (1.0 - smoothstep(0.5, 1.5, fu / 3.0) * 0.82)), 0.08, 0.0, 0.0);
    if (small) {
      float w = pulse(u / 3.5 + 0.3, fu / 3.5, 0.32) * pulse(p.y / 2.8 - 0.3, fy / 2.8, 0.5) * step(0.8, p.y);
      return mixMat(wall, glass, w * (1.0 - smoothstep(top - 1.0, top - 0.5, p.y)));
    }
    // Haussmann's storeys: a tall ground floor of shops, storeys of 3 m, a mansard on top of anything of
    // five storeys or more, its cornice where the stone stops.
    const float GF = 4.4;
    float mans = top > 17.0 ? mix(4.2, 5.8, r4) : 0.0;
    float cornice = top - mans;
    float sy = (p.y - GF) / 3.0;
    float fsy = fy / 3.0;
    // Tall windows: 1.25 m of each 3 m bay, 2.2 m of each storey; dark glass, curtains in some.
    float wu = pulse(u / 3.0 + 0.3, fu / 3.0, 0.42);
    float wv = pulse(sy - 0.16, fsy, 0.73);
    float upper = step(GF, p.y) * (1.0 - smoothstep(cornice - 0.7, cornice - 0.3, p.y));
    Mat m = mixMat(wall, glass, wu * wv * upper);
    // A string course at every floor, a heavier cornice under the mansard.
    float course = pulse(sy + 0.04, fsy, 0.08) * upper;
    m.albedo *= 1.0 + 0.1 * course;
    // Continuous wrought-iron balconies on the second and fifth floors (the storeys 1 and 4 above the ground
    // floor's mezzanine here), with the slab's shadow under them: iron a third of the rail's area.
    float st = floor(sy);
    float balcony = (st == 1.0 || (st == 4.0 && cornice - p.y > 2.0)) ? 1.0 : 0.0;
    float rail = pulse(sy, fsy, 0.33) * balcony;
    float slab = (1.0 - pulse(sy + 0.1, fsy, 0.9)) * ((st == 1.0 || st == 2.0 || st == 4.0 || st == 5.0) ? 1.0 : 0.0);
    m = mixMat(m, Mat(IRON, 0.5, 0.0, 0.0), rail * 0.38 * upper);
    m.albedo *= 1.0 - 0.35 * slab * upper;
    // Shop fronts at street level: dark glass between stone piers.
    float shop = (1.0 - smoothstep(GF - 0.9, GF - 0.6, p.y)) * step(0.3, p.y);
    m = mixMat(m, Mat(WINDOW * 1.3, 0.1, 0.0, 0.0), shop * pulse(u / 6.0, fu / 6.0, 0.72));
    // The mansard: zinc, with a dormer over every bay; a light stone cornice where it starts.
    if (mans > 0.0) {
      float inM = smoothstep(cornice - 0.15, cornice + 0.15, p.y);
      float dormer = pulse(u / 3.0 + 0.36, fu / 3.0, 0.3) * pulse((p.y - cornice - 0.9) / 1.5, fy / 1.5, 1.0) * step(p.y, cornice + 2.4);
      Mat roofM = mixMat(Mat(r3 < 0.74 ? ZINC * mix(0.9, 1.1, r4) : SLATE, 0.5, 0.0, 0.0), Mat(WINDOW, 0.1, 0.0, 0.0), dormer * 0.8);
      float corn = pulse((p.y - cornice + 0.6) / 0.6, fy / 0.6, 1.0);
      m.albedo = mix(m.albedo, stone * 1.12, corn * 0.7);
      m = mixMat(m, roofM, inM);
    }
    return m;
  }
`

// The ground's palette (materials.js reads these): paving, the Seine, the surroundings' walls and roofs.
export const PARIS_GROUND = /* glsl */ `
  // Asphalt (dark, the carriageways) to the paler paving of squares and the gravel of the Champ de Mars and
  // the Esplanade des Invalides; plane trees' and lawns' November olive.
  vec3 palPaving(float open, float grain) {
    return mix(vec3(0.07, 0.07, 0.074), vec3(0.24, 0.21, 0.16), smoothstep(0.45, 0.9, open)) * mix(0.85, 1.15, grain);
  }
  vec3 palGrass(vec2 xz) { return vec3(0.1, 0.11, 0.055) * mix(0.8, 1.2, vnoise(xz / 9.0)); }
  vec3 palCanopy(vec2 xz) { return vec3(0.09, 0.07, 0.04) * mix(0.6, 1.3, vnoise(xz / 3.5)); }
  vec3 palCtxStreet(float closeIn) { return vec3(0.08, 0.08, 0.085) * mix(1.0, 0.55, closeIn); }
  // The surroundings' roofs: zinc and slate in the city, red tiles on the low houses of the suburbs.
  vec3 palCtxRoof(float k2, float h) {
    if (h < 11.0 && k2 < 0.6) return vec3(0.28, 0.12, 0.07);
    return k2 < 0.6 ? vec3(0.19, 0.205, 0.23) : k2 < 0.85 ? vec3(0.06, 0.063, 0.072) : vec3(0.3, 0.29, 0.28);
  }
  // Their walls: limestone and render, some brick.
  vec3 palCtxWall(float k, float h) {
    return k < 0.45 ? vec3(0.5, 0.44, 0.35) : k < 0.72 ? vec3(0.43, 0.39, 0.33) : k < 0.9 ? vec3(0.56, 0.52, 0.45) : k < 0.95 ? vec3(0.34, 0.2, 0.13) : vec3(0.33, 0.32, 0.3);
  }
  // The Seine: olive and turbid, darker than the sky it reflects.
  const vec3 WATER_BODY = vec3(0.022, 0.026, 0.016);
  // A river's fetch is its width: whatever the wind, its waves stay short and its surface calm.
  float palFetchWind(float U) { return min(U, 4.0); }
  vec3 palStreetLamp(vec2 xz) { return paStreet(xz); }
  // The surroundings after dark. From 7.5 degrees up the relief shows walls and roofs and hides most of its
  // streets, and its towers' boxes were all that showed: a dark band where the Saint-Cloud photograph
  // (08) has a carpet of lights to the horizon. Their lamps and windows brighter.
  const float CTX_NIGHT = 2.5;

  // Granite setts ("pavés") on the quays, the squares and the open ground near the river: rough grey stone
  // whose joints (a fifth of the surface) hold the rain first (Lagarde, "Water drop 3b", 2013).
  void palLand(inout vec3 c, inout float r, vec2 xz, float open, float soft, float wet) {
    float setts = smoothstep(0.55, 0.8, open) * (1.0 - soft) * smoothstep(0.4, 0.5, vnoise(xz / 60.0));
    if (setts <= 0.0) return;
    vec2 q = xz / 0.14;
    vec2 fq = vec2(max(fwidth(q.x), 1e-3), max(fwidth(q.y), 1e-3));
    float joint = 1.0 - pulse(q.x, fq.x, 0.8) * pulse(q.y, fq.y, 0.8);
    vec3 granite = vec3(0.17, 0.165, 0.16) * mix(0.8, 1.15, vnoise(xz / 0.5));
    c = mix(c, granite * (1.0 - 0.5 * joint), setts);
    float rs = mix(mix(0.85, 0.3, smoothstep(0.4, 1.0, wet)), 0.05, joint * smoothstep(0.0, 0.4, wet));
    r = mix(r, rs, setts);
  }
`

// New York's palette, its values exactly as the ground shader had them inline before Paris.
export const NEW_YORK_GROUND = /* glsl */ `
  vec3 palPaving(float open, float grain) {
    return mix(vec3(0.085, 0.085, 0.09), vec3(0.2, 0.195, 0.185), smoothstep(0.35, 0.85, open)) * mix(0.85, 1.15, grain);
  }
  vec3 palGrass(vec2 xz) { return vec3(0.11, 0.115, 0.06) * mix(0.8, 1.2, vnoise(xz / 9.0)); }
  vec3 palCanopy(vec2 xz) { return vec3(0.075, 0.065, 0.045) * mix(0.6, 1.3, vnoise(xz / 3.5)); }
  vec3 palCtxStreet(float closeIn) { return vec3(0.09, 0.09, 0.095) * mix(1.0, 0.55, closeIn); }
  vec3 palCtxRoof(float k2, float h) {
    return (k2 < 0.35 ? vec3(0.08, 0.08, 0.085) : k2 < 0.7 ? vec3(0.2, 0.19, 0.18) : k2 < 0.85 ? vec3(0.36, 0.36, 0.35) : vec3(0.2, 0.12, 0.09));
  }
  vec3 palCtxWall(float k, float h) {
    return k < 0.4 ? vec3(0.24, 0.11, 0.075) : k < 0.6 ? vec3(0.15, 0.09, 0.068) : k < 0.75 ? vec3(0.36, 0.29, 0.21) : k < 0.88 ? vec3(0.44, 0.41, 0.35) : vec3(0.28, 0.28, 0.27);
  }
  const vec3 WATER_BODY = vec3(0.018, 0.026, 0.026);
  float palFetchWind(float U) { return U; }
  vec3 palStreetLamp(vec2 xz) { return nyStreet(xz); }
  const float CTX_NIGHT = 1.0;
  void palLand(inout vec3 c, inout float r, vec2 xz, float open, float soft, float wet) {}
`
