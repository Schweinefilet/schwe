// The puddle's live surface (src/scenes/waves/WaveSim.js): height in meters on a tile that repeats
// every uFieldTile world units. Read with a cubic B-spline over 4 × 4 cells, so the height and its
// slopes are smooth between cells (the reflections would otherwise break into facets up close).

uniform sampler2D uField;  // x: height (m)
uniform vec2 uFieldOrigin; // world xz of the tile's corner
uniform float uFieldTile;  // world units
uniform float uFieldSize;  // cells across the tile
uniform float uFieldWorld; // world units per meter
uniform float uFieldOn;    // 0 until the simulation runs: calm water

void surfaceSpline(float t, out vec4 w, out vec4 dw) {
  float s = 1.0 - t;
  float t2 = t * t;
  w = vec4(s * s * s, 3.0 * t2 * t - 6.0 * t2 + 4.0, -3.0 * t2 * t + 3.0 * t2 + 3.0 * t + 1.0, t2 * t) / 6.0;
  dw = vec4(-s * s, 3.0 * t2 - 4.0 * t, -3.0 * t2 + 2.0 * t + 1.0, t2) / 2.0;
}

// x: height (m); yz: slope dh/dx, dh/dz (meters per meter, the same in world units).
vec3 surfaceAt(vec2 xz) {
  if (uFieldOn < 0.5) return vec3(0.0);
  vec2 c = (xz - uFieldOrigin) / uFieldTile * uFieldSize - 0.5;
  vec2 i0 = floor(c) - 1.0;
  vec2 t = c - floor(c);
  vec4 wx, dwx, wz, dwz;
  surfaceSpline(t.x, wx, dwx);
  surfaceSpline(t.y, wz, dwz);
  int n = int(uFieldSize);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int y = int(i0.y) + j;
    y = ((y % n) + n) % n;
    vec4 row;
    for (int i = 0; i < 4; i++) {
      int x = int(i0.x) + i;
      x = ((x % n) + n) % n;
      row[i] = texelFetch(uField, ivec2(x, y), 0).x;
    }
    acc += vec3(dot(wx, row) * wz[j], dot(dwx, row) * wz[j], dot(wx, row) * dwz[j]);
  }
  float perCell = uFieldSize / (uFieldTile / uFieldWorld); // cells per meter
  return vec3(acc.x, acc.yz * perCell);
}
