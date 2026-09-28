// Shared water shading for the splash and the puddle, so the seam between them disappears.
// Needs envColor() (env.glsl) before it. `v`: view direction (camera → point), `n`: surface normal.

uniform float uReflGain;
uniform vec3 uDeep;        // color seen looking down into the water
uniform float uTransGain;  // thin sheets (the crown) let the light behind them through; the puddle doesn't

const vec3 WATER_KEY = normalize(vec3(-0.4, 0.8, 0.45)); // world space, high and to the left

vec3 shadeWater(vec3 v, vec3 n) {
  float cosi = clamp(dot(-v, n), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
  vec3 refl = envColor(reflect(v, n)) * uReflGain;
  vec3 h = normalize(WATER_KEY - v);
  float spec = pow(max(dot(n, h), 0.0), 400.0) * 2.0;
  // Light through the sheet: refract, but keep the ray near horizontal (behind the crown is the
  // night and the lit horizon, not the street far below).
  vec3 t = refract(v, n, 0.75);
  t.y = max(t.y, -0.05);
  // Only steep surfaces are thin sheets; flat water stays dark so it matches the puddle exactly.
  float sheet = pow(1.0 - abs(n.y), 1.5);
  vec3 body = uDeep + envColor(normalize(t)) * uTransGain * sheet;
  return mix(body, refl, fresnel) + vec3(spec);
}
