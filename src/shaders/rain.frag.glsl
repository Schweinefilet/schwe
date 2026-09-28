// Runs once per pixel of each point. Draws a soft round dot.
uniform vec3 uColor;

varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(uColor, a * 0.7);
}
