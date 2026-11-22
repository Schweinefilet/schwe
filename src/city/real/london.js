// The photoreal London's own materials (materials.js draws them; docs/london/rendering-research.md, sections
// 6 to 10 and 13). A city of brick: Victorian terraces of London stock brick (yellow-grey, darkened by soot)
// and red brick under grey Welsh slate, with white stucco in the west and Portland stone for the public
// buildings and the City's older offices; post-war estates in concrete; the City's towers and the Shard in
// glass; Westminster in honey-coloured limestone under cast-iron roofs, St Paul's dome in lead. All
// procedural on the model's massing.
//
// Albedos (linear) are read off the reference photographs (docs/london/reference.md, 01, 02, 08) and kept in
// the ranges of measured materials (Lagarde and de Rousiers, "Moving Frostbite to Physically Based Rendering
// 3.0", 2014, the albedo chart). Patterns finer than a pixel are box-filtered (pulse(), Apodaca and Gritz
// 1999). Portland stone weathers the other way from Paris's limestone: white where rain washes it, black
// where it is sheltered (Historic England, "Practical Building Conservation: Stone", 2012, on soiling), so
// its darkening goes on north faces and under each cornice, not in streaks.

// Needs, before it: REAL_COMMON and the buildings' FACADE (materials.js: Mat, glassOf, mixMat, pulse,
// vnoise) and the city's night (src/city/london.js: vLandmark, KIT_FRAG).
export const LONDON_FACADE = /* glsl */ `
  const vec3 STOCK = vec3(0.29, 0.24, 0.165);   // London stock brick, a century of soot on it
  const vec3 STOCK_CLEAN = vec3(0.4, 0.33, 0.22);
  const vec3 RED_BRICK = vec3(0.29, 0.11, 0.07);
  const vec3 STUCCO = vec3(0.6, 0.58, 0.53);    // painted stucco, Belgravia and Pimlico
  const vec3 PORTLAND = vec3(0.6, 0.58, 0.52);  // Portland stone, rain-washed
  const vec3 ANSTON = vec3(0.5, 0.42, 0.3);     // Westminster's magnesian limestone
  const vec3 RAGSTONE = vec3(0.38, 0.36, 0.31); // the Tower of London's Kentish rag
  const vec3 CONCRETE = vec3(0.33, 0.32, 0.3);
  const vec3 SLATE = vec3(0.065, 0.07, 0.082);  // Welsh slate
  const vec3 LEAD = vec3(0.12, 0.125, 0.13);
  const vec3 IRON_ROOF = vec3(0.1, 0.11, 0.12); // the Palace of Westminster's cast-iron tiles
  const vec3 SASH = vec3(0.03, 0.032, 0.036);
  const vec3 GILT = vec3(1.0, 0.77, 0.34);

  // The City's towers and the Shard: a curtain wall of vision glass, spandrels at each floor, mullions every
  // 1.5 m (as New York's), its tint by building; low-iron glass on the Shard's spire.
  Mat ldGlass(vec3 p, float u, float fu, float fy, float r2, float r3, float r4) {
    vec3 tint = r2 < 0.35 ? vec3(0.026, 0.04, 0.042) : r2 < 0.65 ? vec3(0.034, 0.037, 0.041) : r2 < 0.85 ? vec3(0.024, 0.032, 0.048) : vec3(0.045, 0.05, 0.055);
    tint *= mix(0.85, 1.15, r3);
    Mat vision = glassOf(tint, mix(0.06, 0.1, r4), 0.05);
    Mat spandrel = glassOf(tint * 1.6, 0.07, 0.2);
    Mat mullion = Mat(vec3(0.45, 0.46, 0.48), 0.45, 1.0, 0.0);
    float v = pulse(p.y / 3.8 + 0.15, fy / 3.8, 0.72);
    Mat m = mixMat(spandrel, vision, v);
    float mul = 1.0 - pulse(u / 1.5, fu / 1.5, 0.92);
    return mixMat(m, mullion, mul * 0.8);
  }

  // The landmarks, in the order of src/city/london.js's LANDMARKS.
  Mat ldMonument(int lm, vec3 p, vec3 n, float seed, float u, float fu, float fy) {
    bool roof = n.y > 0.35;
    if (lm == 9 || lm == 10 || lm == 11) return glassOf(vec3(0.04, 0.05, 0.055), 0.08, 0.05);
    if (lm == 1 || lm == 2) {
      // Westminster: honey limestone, cast-iron roofs, the Elizabeth Tower's spire gilded.
      if (roof) return mixMat(Mat(IRON_ROOF, 0.5, 0.3, 0.0), Mat(GILT, 0.3, 1.0, 0.0), lm == 1 && p.y > 80.0 ? 0.35 : 0.0);
      return Mat(ANSTON * mix(0.9, 1.08, vnoise(vec2(u, p.y) / 9.0)), 0.8, 0.0, 0.8);
    }
    if (lm == 4) {
      // St Paul's: Portland stone, its dome and the roofs lead.
      if (roof || p.y > 68.0 && n.y > -0.2) return Mat(LEAD, 0.45, 0.0, 0.1);
      return Mat(PORTLAND * mix(0.75, 1.0, smoothstep(-0.6, 0.2, n.z)), 0.8, 0.0, 0.7);
    }
    // (WebGL's GLSL allows no ternary on structures.)
    if (lm == 13) {
      if (roof) return Mat(SLATE, 0.6, 0.0, 0.1);
      return Mat(vec3(0.28, 0.15, 0.1), 0.85, 0.0, 0.85);
    }
    // The Abbey, Southwark Cathedral, the Monument, Tower Bridge, the Tower of London (its Kentish rag):
    // stone, lead roofs.
    if (roof) return Mat(LEAD, 0.5, 0.0, 0.1);
    if (lm == 6) return Mat(RAGSTONE, 0.85, 0.0, 0.8);
    return Mat(vec3(0.46, 0.43, 0.37) * mix(0.92, 1.06, vnoise(vec2(u, p.y) / 9.0)), 0.82, 0.0, 0.75);
  }

  Mat londonFacade(vec3 p, vec3 n, float seed, float top, float office, int lm) {
    float r1 = fract(seed * 13.17 + 0.31);
    float r2 = fract(seed * 71.31 + 0.71);
    float r3 = fract(seed * 191.7 + 0.13);
    float r4 = fract(seed * 37.9 + 0.57);
    vec2 along = normalize(vec2(-n.z, n.x) + vec2(1e-5));
    float u = dot(p.xz, along);
    float fu = max(fwidth(u), 1e-3);
    float fy = max(fwidth(p.y), 1e-3);
    if (lm > 0 && lm != 12) return ldMonument(lm, p, n, seed, u, fu, fy);
    // Glass: most of the City's towers, some of the South Bank's offices.
    float glassP = office * (top > 150.0 ? 0.9 : top > 80.0 ? 0.7 : top > 45.0 ? 0.4 : top > 25.0 ? 0.1 : 0.02);
    bool glass = r1 < glassP;
    bool terrace = office < 0.5 && top < 16.0;
    if (n.y > 0.5) {
      float flatRoof = smoothstep(0.92, 0.98, n.y);
      vec3 a;
      float rough;
      if (terrace) {
        // Slate on the terraces (pitched or, in the model, flat), felt and gravel on their back additions;
        // rows of chimney stacks on the party walls.
        a = r3 < 0.65 ? SLATE : r3 < 0.85 ? vec3(0.055, 0.055, 0.06) : vec3(0.2, 0.19, 0.18);
        rough = r3 < 0.65 ? 0.55 : 0.85;
        float stack = smoothstep(0.8, 0.86, vnoise(p.xz / 2.0 + seed * 40.0));
        float fw = smoothstep(0.4, 1.2, fwidth(p.x) / 2.0);
        a = mix(a, STOCK * 1.1, mix(stack, 0.05, fw));
      } else {
        // Felt, gravel ballast and plant; green roofs in the City.
        a = r3 < 0.35 ? vec3(0.06, 0.06, 0.065) : r3 < 0.75 ? vec3(0.21, 0.2, 0.19) : r3 < 0.88 ? vec3(0.32, 0.32, 0.31) : vec3(0.07, 0.1, 0.045);
        rough = 0.85;
        float clutter = vnoise(p.xz / 5.0 + seed * 50.0);
        a *= mix(mix(0.75, 1.12, clutter), 0.97, smoothstep(0.3, 0.8, fwidth(p.x / 5.0)));
      }
      a = mix(SLATE, a, flatRoof);
      return Mat(a, mix(0.55, rough, flatRoof), 0.0, 0.25 * flatRoof);
    }
    if (glass) return ldGlass(p, u, fu, fy, r2, r3, r4);
    // The wall's material: offices in Portland stone, concrete or brick; homes in stock brick, red brick or
    // stucco (more stucco in the west, toward Pimlico); post-war blocks in concrete.
    vec3 wall;
    float porous;
    bool stone = false;
    if (office > 0.5) {
      if (r2 < 0.55) { wall = PORTLAND; stone = true; porous = 0.6; }
      else if (r2 < 0.82) { wall = CONCRETE; porous = 0.5; }
      else { wall = r2 < 0.92 ? STOCK_CLEAN : RED_BRICK; porous = 0.85; }
    } else if (top > 28.0) {
      wall = r2 < 0.65 ? CONCRETE : r2 < 0.9 ? STOCK_CLEAN : RED_BRICK;
      porous = r2 < 0.65 ? 0.5 : 0.85;
    } else {
      float west = smoothstep(-1200.0, -2200.0, p.x);
      float stucco = mix(0.12, 0.4, west);
      wall = r2 < stucco ? STUCCO : r2 < stucco + 0.62 * (1.0 - stucco) ? STOCK : r2 < 0.88 ? STOCK_CLEAN : RED_BRICK;
      porous = r2 < stucco ? 0.4 : 0.9;
    }
    wall *= mix(0.9, 1.1, r3) * vec3(1.0, mix(0.98, 1.02, r4), mix(0.96, 1.04, r1));
    // Weathering: grime toward the street; Portland stone black where sheltered (north faces, and the band
    // under each cornice the rain does not reach), white where washed.
    wall *= mix(0.8, 1.0, smoothstep(0.0, 8.0, p.y));
    float storeyH = office > 0.5 ? 3.8 : 3.2;
    float sy = p.y / storeyH;
    float fsy = fy / storeyH;
    if (stone) {
      float north = smoothstep(0.2, 0.8, -n.z);
      float sheltered = 1.0 - pulse(sy + 0.12, fsy, 0.85);
      wall *= mix(1.0, 0.55, max(north * 0.7, sheltered * 0.6));
    } else {
      wall *= mix(0.88, 1.06, vnoise(vec2(u, p.y) / 16.0 + seed * 9.0));
    }
    Mat m = Mat(wall, stone ? 0.8 : 0.88, 0.0, porous);
    // Windows: sashes about 1 m wide on a 2.6 m pitch and 1.8 m tall on homes; office bays 1.8 m, 2.2 m tall.
    float pitch = office > 0.5 ? 1.8 : 2.6;
    float ww = office > 0.5 ? 0.62 : 0.4;
    float wh = office > 0.5 ? 0.58 : 0.56;
    float wu = pulse(u / pitch + 0.3, fu / pitch, ww);
    float wv = pulse(sy - 0.22, fsy, wh);
    float blind = step(0.8, hash21(floor(vec2(u / pitch, sy)) + seed * 31.0));
    Mat win = Mat(mix(SASH, vec3(0.22, 0.21, 0.19), blind * (1.0 - smoothstep(0.5, 1.5, fu / pitch) * 0.8)), 0.08, 0.0, 0.0);
    // No windows in the parapet's last metre; shop fronts on the high streets' ground floors.
    float upper = step(0.8, p.y) * (1.0 - smoothstep(top - 1.4, top - 0.8, p.y));
    m = mixMat(m, win, wu * wv * upper);
    float shop = (1.0 - smoothstep(3.6, 4.0, p.y)) * step(0.3, p.y) * step(0.6, fract(seed * 5.3)) * step(9.0, top);
    m = mixMat(m, Mat(SASH * 1.3, 0.1, 0.0, 0.0), shop * pulse(u / 5.5, fu / 5.5, 0.7));
    return m;
  }
`

// The ground's palette (materials.js reads these): paving, parks, the Thames, the surroundings' walls and
// roofs, the surroundings' night.
export const LONDON_GROUND = /* glsl */ `
  // Asphalt to the paler York stone and concrete slabs of squares and pavements; London's lawns stay green
  // through November, its plane trees brown and half bare.
  vec3 palPaving(float open, float grain) {
    return mix(vec3(0.075, 0.075, 0.08), vec3(0.21, 0.2, 0.185), smoothstep(0.45, 0.9, open)) * mix(0.85, 1.15, grain);
  }
  vec3 palGrass(vec2 xz) { return vec3(0.07, 0.12, 0.045) * mix(0.8, 1.2, vnoise(xz / 9.0)); }
  vec3 palCanopy(vec2 xz) { return vec3(0.08, 0.07, 0.048) * mix(0.6, 1.3, vnoise(xz / 3.5)); }
  vec3 palCtxStreet(float closeIn) { return vec3(0.085, 0.085, 0.09) * mix(1.0, 0.55, closeIn); }
  // The surroundings' roofs: slate on the terraces, felt and gravel on the flats and sheds.
  vec3 palCtxRoof(float k2, float h) {
    if (h < 14.0) return k2 < 0.7 ? vec3(0.065, 0.07, 0.082) : k2 < 0.9 ? vec3(0.055, 0.055, 0.06) : vec3(0.2, 0.19, 0.18);
    return k2 < 0.4 ? vec3(0.06, 0.06, 0.065) : k2 < 0.85 ? vec3(0.2, 0.19, 0.18) : vec3(0.3, 0.29, 0.28);
  }
  // Their walls: stock brick, some red brick, stucco, concrete, a little Portland stone. (A first palette with
  // a quarter red brick and red tiles on the low roofs turned the whole surroundings orange beside the
  // photographs' grey-beige.)
  vec3 palCtxWall(float k, float h) {
    return k < 0.45 ? vec3(0.29, 0.24, 0.165) : k < 0.58 ? vec3(0.29, 0.11, 0.07) : k < 0.76 ? vec3(0.6, 0.58, 0.53) : k < 0.94 ? vec3(0.33, 0.32, 0.3) : vec3(0.6, 0.58, 0.52);
  }
  // The Thames: brown-grey, opaque with silt, lighter than the other cities' water.
  const vec3 WATER_BODY = vec3(0.05, 0.043, 0.03);
  // A tidal river 250 m wide: wider than the Seine, its chop kept up by the tide and the boats.
  float palFetchWind(float U) { return min(U, 7.0); }
  vec3 palStreetLamp(vec2 xz) { return ldStreet(xz); }
  // The surroundings after dark: brighter than New York's (as Paris's), the relief hiding its streets from
  // 8.5 degrees up.
  const float CTX_NIGHT = 2.0;
  void palLand(inout vec3 c, inout float r, vec2 xz, float open, float soft, float wet) {}
`

// Which material a fragment of the buildings is (materials.js, facadeApply): the London Eye white paint on
// steel (it is modelled open, rim and spokes, so it needs no coverage trick: the TAA resolves it), the
// river bridges granite and painted iron, the rest the facade above.
export const LONDON_SELECT = /* glsl */ `
  if (vLandmark == 12) fm = Mat(vec3(0.72, 0.73, 0.74), 0.4, 0.0, 0.0);
  else if (vBake.z < 0.25) fm = Mat(vec3(0.3, 0.31, 0.32), 0.6, 0.0, 0.3);
  else fm = londonFacade(pc, nWorld, vBake.y, vTop, step(0.5, vKind.x), vLandmark);`
