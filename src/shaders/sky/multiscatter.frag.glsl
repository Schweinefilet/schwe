// Multiple scattering, all orders, as an isotropic source per height and sun zenith (Hillaire 2020,
// section 5.5). At each texel: light scattered twice, averaged over 64 directions, times the
// geometric series 1 / (1 - f) for every further bounce. Computed once per visit, for unit
// illuminance; the sky-view pass scales it by the real light. atmosphere.glsl is prepended.

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (MS_SIZE - 1.0);
  float muS = uv.x * 2.0 - 1.0;
  float r = PLANET_R + max(uv.y * (TOP_R - PLANET_R), 0.01);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  const float uniformPhase = 1.0 / (4.0 * PI);

  vec3 lum = vec3(0.0);
  vec3 fms = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      float theta = 2.0 * PI * (float(i) + 0.5) / 8.0;
      float cphi = 1.0 - 2.0 * (float(j) + 0.5) / 8.0;
      float sphi = sqrt(max(1.0 - cphi * cphi, 0.0));
      vec3 rd = vec3(sphi * cos(theta), cphi, sphi * sin(theta));

      float tGround = raySphere(ro, rd, PLANET_R);
      float tMax = tGround > 0.0 ? tGround : raySphere(ro, rd, TOP_R);
      const int N = 20;
      float dt = tMax / float(N);
      vec3 T = vec3(1.0);
      vec3 L = vec3(0.0);
      vec3 F = vec3(0.0);
      for (int k = 0; k < N; k++) {
        vec3 p = ro + rd * ((float(k) + 0.5) * dt);
        float h = length(p);
        Medium m = sampleMedium(h - PLANET_R);
        float mu = dot(p / h, sun);
        vec3 sunT = transmittanceToTop(h, mu) * planetShadow(h, mu);
        vec3 stepT = exp(-m.extinction * dt);
        vec3 S = m.scattering * uniformPhase * sunT;
        L += T * (S - S * stepT) / m.extinction;
        F += T * (m.scattering - m.scattering * stepT) / m.extinction;
        T *= stepT;
      }
      if (tGround > 0.0) {
        vec3 pg = ro + rd * tGround;
        float mu = dot(normalize(pg), sun);
        L += T * transmittanceToTop(PLANET_R, mu) * max(mu, 0.0) * EARTH_ALBEDO / PI;
      }
      lum += L;
      fms += F * uniformPhase * 4.0 * PI; // f_ms: the share of light scattered again, per bounce
    }
  }
  lum /= 64.0;
  fms /= 64.0;
  gl_FragColor = vec4(lum / (1.0 - fms), 1.0);
}
