// Transmittance from any height to the top of the atmosphere, for every direction that misses the
// ground (Bruneton's parameterization). Depends only on the atmosphere: computed once per visit.
// atmosphere.glsl is prepended.

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / (T_SIZE - 1.0); // texel centres span 0..1 exactly
  float H = sqrt((TOP_R - PLANET_R) * (TOP_R + PLANET_R));
  float rho = H * uv.y;
  float r = sqrt(rho * rho + PLANET_R * PLANET_R);
  float dMin = TOP_R - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin); // distance to the top along the ray
  float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);

  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  const int N = 40;
  float dt = d / float(N);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * ((float(i) + 0.5) * dt);
    depth += sampleMedium(length(p) - PLANET_R).extinction * dt;
  }
  gl_FragColor = vec4(exp(-depth), 1.0);
}
