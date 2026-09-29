// The alignment drops: frozen beads at fixed world positions, drawn exactly like frozen rain (same
// fragment shader, streak length 0, same fog, near fade and box-face fade), so they are part of the
// field from the first frame until the camera reaches the one viewpoint where they spell the word.

uniform vec2 uResolution;
uniform float uFogDensity;
uniform vec3 uBoxCenter;  // the rain field's box (shared with Rain): fade at its faces like rain
uniform vec3 uBoxSize;
uniform vec2 uVisible;    // fade out between these distances from the camera (see ALIGN.visibleWithin)
uniform float uTimeScale; // the rain's: a still bead among moving rain would stand out, so it hides

attribute vec3 aOffset;   // world position
attribute vec4 aParams;   // x: radius (world; 0 hides the drop), y: streak brightness (unused: never moves)

varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vAlpha;
varying float vBright;
varying vec3 vView;
varying float vSoft;  // always sharp: the word is only near the camera long after the focus pull
varying float vRound; // always a bead

void main() {
  vec4 v = viewMatrix * vec4(aOffset, 1.0);
  float depth = -v.z;
  vec3 e = abs(aOffset - uBoxCenter) / (0.5 * uBoxSize);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
  vAlpha = 0.0;
  vBright = aParams.y;
  vView = v.xyz;
  vLocal = vec2(0.0);
  vLen = 0.0;
  vRadius = 1.0;
  vSoft = 0.0;
  vRound = 1.0;
  if (depth < 0.05 || edge <= 0.0 || depth > uVisible.y) {
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
  float far = 1.0 - smoothstep(uVisible.x, uVisible.y, depth);
  vAlpha = edge * far * exp(-depth * uFogDensity) * smoothstep(0.6, 3.0, depth) * (rTrue / r) * (1.0 - smoothstep(0.005, 0.1, uTimeScale));
}
