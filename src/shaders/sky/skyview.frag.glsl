// One city's clear sky, every direction, into the sky-view texture: light from the sun and the moon
// scattered once (with Earth's shadow) plus the multiple-scattering source, and the ground below
// the horizon. Rendered only when the city's inputs change. Values are already multiplied by the
// city's exposure, so moonlit nights stay well inside half-float range. atmosphere.glsl is prepended.

uniform vec2 uSize;
uniform float uViewHeight;
uniform float uGroundAlbedo;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunE;   // exposed illuminance above the atmosphere
uniform vec3 uMoonE;   // exposed, coloured, at the moon's current phase
uniform float uMoonOn; // 0 while the moon is below the horizon

vec3 inscatter(Medium m, float h, vec3 up, vec3 L, float phR, float phM) {
  float mu = dot(up, L);
  vec3 lightT = transmittanceToTop(h, mu) * planetShadow(h, mu);
  return lightT * (m.rayleigh * phR + m.mie * phM) + multiScattering(h, mu) * m.scattering;
}

// Direct light on the ground. After sunset the ground goes dark; the city's own light takes over there.
vec3 groundLight(vec3 up, vec3 L) {
  float mu = dot(up, L);
  return transmittanceToTop(PLANET_R, mu) * planetShadow(PLANET_R, mu) * max(mu, 0.0);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uSize.x, (gl_FragCoord.y - 0.5) / (uSize.y - 1.0));
  float r = PLANET_R + uViewHeight;
  vec3 dir = skyViewDirection(uv, r);
  vec3 ro = vec3(0.0, r, 0.0);

  float tGround = raySphere(ro, dir, PLANET_R);
  float tMax = tGround > 0.0 ? tGround : raySphere(ro, dir, TOP_R);

  float cS = dot(dir, uSunDir);
  float cM = dot(dir, uMoonDir);
  float phRS = rayleighPhase(cS);
  float phMS = miePhase(cS, MIE_G);
  float phRM = rayleighPhase(cM);
  float phMM = miePhase(cM, MIE_G);

  // Samples bunch up near the viewer, where the air is densest (squared spacing, Hillaire's 0.3 offset).
  const int N = 32;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  for (int i = 0; i < N; i++) {
    float a = float(i) / float(N);
    float b = float(i + 1) / float(N);
    float t0 = tMax * a * a;
    float t1 = tMax * b * b;
    float dt = t1 - t0;
    vec3 p = ro + dir * (t0 + 0.3 * dt);
    float h = length(p);
    vec3 up = p / h;
    Medium m = sampleMedium(h - PLANET_R);
    vec3 S = uSunE * inscatter(m, h, up, uSunDir, phRS, phMS);
    if (uMoonOn > 0.5) S += uMoonE * inscatter(m, h, up, uMoonDir, phRM, phMM);
    vec3 stepT = exp(-m.extinction * dt);
    L += T * (S - S * stepT) / m.extinction;
    T *= stepT;
  }

  if (tGround > 0.0) {
    vec3 up = normalize(ro + dir * tGround);
    vec3 E = uSunE * groundLight(up, uSunDir);
    if (uMoonOn > 0.5) E += uMoonE * groundLight(up, uMoonDir);
    L += T * E * uGroundAlbedo / PI;
  }
  gl_FragColor = vec4(L, 1.0);
}
