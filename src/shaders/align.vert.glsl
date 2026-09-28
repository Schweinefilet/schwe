// The alignment drops: frozen beads at fixed world positions, drawn exactly like frozen rain
// (same fragment shader, streak length 0) so they are indistinguishable from the field until the
// camera reaches the one viewpoint where they spell the word.

uniform vec2 uResolution;
uniform float uFogDensity;
uniform float uGlow;      // brightness pulse when the word locks in
uniform vec3 uEye;        // the viewpoint where the word reads

attribute vec3 aOffset;   // world position
attribute vec4 aParams;   // x: radius (world), y: brightness

varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vAlpha;

void main() {
  vec4 v = viewMatrix * vec4(aOffset, 1.0);
  float depth = -v.z;
  vAlpha = 0.0;
  vLocal = vec2(0.0);
  vLen = 0.0;
  vRadius = 1.0;
  if (depth < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 c = projectionMatrix * v;
  vec2 halfRes = 0.5 * uResolution;
  float focal = projectionMatrix[1][1] * halfRes.y;
  float rTrue = aParams.x * focal / depth;
  float r = max(rTrue, 1.0);

  vec2 local = position.xy * 2.0 * r;
  gl_Position = vec4((c.xy / c.w * halfRes + local) / halfRes, c.z / c.w, 1.0);

  vLocal = local;
  vRadius = r;
  // From far away the word's drops would bunch into a visible smudge on the horizon, so they emerge
  // only as the camera closes in on the viewpoint.
  float nearEye = 1.0 - smoothstep(12.0, 22.0, distance(cameraPosition, uEye));
  vAlpha = nearEye * exp(-depth * uFogDensity) * smoothstep(0.6, 3.0, depth) * (rTrue / r) * aParams.y * uGlow;
}
