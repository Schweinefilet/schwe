// Shared water shading for the splash and the puddle, so the seam between them disappears.
// Needs env.glsl before it. Water reflects the far city out of focus (envSoft), as the backdrop shows
// it: a flat surface's image of it lies as far away as the city. `v`: view direction (camera → point),
// `n`: surface normal.

uniform float uReflGain;
uniform vec3 uDeep;        // color seen looking down into the water
uniform float uTransGain;  // thin sheets (the crown) let the light behind them through; the puddle doesn't

const vec3 WATER_KEY = normalize(vec3(-0.4, 0.8, 0.45)); // world space, high and to the left

// `rough` (radians): 0 is a mirror, as the puddle is; the splash's noisy baked surface uses more, so its
// reflections, the light through it and its highlights vary smoothly across its triangles.
vec3 shadeWaterRough(vec3 v, vec3 n, float rough) {
  float cosi = clamp(dot(-v, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
  vec3 r = reflect(v, n);
  vec3 refl = (rough > 0.0 ? envColor(r, rough) : envSoft(r)) * uReflGain;
  vec3 h = normalize(WATER_KEY - v);
  // A rougher surface spreads the same highlight wider and dimmer.
  float shine = 400.0 / (1.0 + rough * 60.0);
  float spec = pow(max(dot(n, h), 0.0), shine) * 2.0 * sqrt(shine / 400.0);
  // Light through the sheet: refract, but keep the ray near horizontal (behind the crown is the lit
  // square, not the ground right below it).
  vec3 t = refract(v, n, 0.75);
  t.y = max(t.y, -0.05);
  t = normalize(t);
  // Only steep surfaces are thin sheets; flat water stays dark so it matches the puddle exactly.
  float sheet = pow(1.0 - abs(n.y), 1.5);
  vec3 body = uDeep + (rough > 0.0 ? envColor(t, rough) : envSoft(t)) * uTransGain * sheet;
  return mix(body, refl, fresnel) + vec3(spec);
}

vec3 shadeWater(vec3 v, vec3 n) {
  return shadeWaterRough(v, n, 0.0);
}
