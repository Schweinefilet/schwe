// The one environment every material agrees on: dark sky above, a warm wet-street glow far below.
// Background, rain beads and hero drops all call envColor(), so reflections and refractions match
// what the camera sees behind them. `d` is a normalized world-space direction.

float envHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Smooth 2D value noise.
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1, 0)), u.x), mix(envHash(i + vec2(0, 1)), envHash(i + vec2(1, 1)), u.x), u.y);
}

vec3 envColor(vec3 d) {
  float y = d.y;
  // Noise sampled on the horizontal unit circle, so there is no seam where the angle wraps.
  vec2 ring = normalize(d.xz + 1e-5);

  vec3 sky = vec3(0.003, 0.004, 0.007) * (1.0 - 0.6 * max(y, 0.0));

  // Pools of street light: brightness varies around the horizon, strongest just below it.
  float pools = 0.35 + 0.65 * envNoise(ring * 2.5 + 4.0) * envNoise(ring * 6.0 + vec2(1.3, 9.1));
  float band = exp(-abs(y + 0.18) * 5.0);
  float below = smoothstep(0.05, -0.5, y);

  vec3 sodium = vec3(1.0, 0.52, 0.22);
  vec3 cool = vec3(0.35, 0.55, 0.75);
  vec3 street = mix(sodium, cool, 0.35 * envNoise(ring * 4.0 + 20.0));

  // Low cloud lit from below by the city: a faint warm glow just above the horizon. Water at grazing
  // angles reflects it, which is what lets the dark puddle read as a surface.
  float skyglow = exp(-abs(y) * 9.0); // continuous across the horizon: no seam

  return sky + street * (0.035 * band + 0.015 * below + 0.008 * skyglow) * pools;
}
