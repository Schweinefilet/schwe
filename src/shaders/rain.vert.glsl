// One instance per drop. Each drop is drawn as a screen-space capsule from where it is now back to
// where it was one shutter-interval ago, i.e. its motion blur. The streak length is
// speed × shutter × uTimeScale, so as time freezes every streak shrinks into a round bead.

uniform float uSimTime;
uniform float uTimeScale;
uniform float uShutter;   // seconds of motion blur per frame (film look: about 1/50)
uniform vec2 uWind;       // horizontal drift per unit of fall
uniform vec3 uBoxCenter;  // the field repeats every uBoxSize, centered here (tracks the camera)
uniform vec3 uBoxSize;
uniform vec2 uResolution; // drawing buffer size in pixels
uniform float uFogDensity;
uniform float uFade;      // whole-field opacity (the timeline dims rain while the word holds)

attribute vec3 aOffset;   // start position inside one box
attribute vec4 aParams;   // x: fall speed, y: radius (world), z: brightness, w: unused

varying vec2 vLocal;      // pixel coords in the streak frame: x across (right), y along (0 = head)
varying float vLen;       // streak length in pixels
varying float vRadius;    // capsule radius in pixels
varying float vAlpha;

void main() {
  float speed = aParams.x;
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));

  // Fall, then wrap into the box around the camera. The field is periodic in world space, so moving
  // the box only changes which copy of a drop is shown; drops never jump while inside it.
  vec3 halfBox = 0.5 * uBoxSize;
  vec3 p = aOffset + dir * speed * uSimTime;
  p = mod(p - uBoxCenter + halfBox, uBoxSize) - halfBox + uBoxCenter;

  // Fade out near the box faces, where wrapping happens.
  vec3 e = abs(p - uBoxCenter) / halfBox;
  float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));

  float trail = speed * uShutter * uTimeScale;
  vec4 v0 = viewMatrix * vec4(p, 1.0);
  vec4 v1 = viewMatrix * vec4(p - dir * trail, 1.0);
  float depth = -v0.z;

  vAlpha = 0.0;
  vLocal = vec2(0.0);
  vLen = 0.0;
  vRadius = 1.0;
  if (depth < 0.05 || -v1.z < 0.05 || edge <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: culled
    return;
  }

  vec4 c0 = projectionMatrix * v0;
  vec4 c1 = projectionMatrix * v1;
  vec2 halfRes = 0.5 * uResolution;
  vec2 s0 = c0.xy / c0.w * halfRes;
  vec2 s1 = c1.xy / c1.w * halfRes;

  // Radius in pixels. Clamp to 1px so distant drops don't flicker, and dim them by the same factor
  // so they don't get brighter than they should.
  float focal = projectionMatrix[1][1] * halfRes.y;
  float rTrue = aParams.y * focal / depth;
  float r = max(rTrue, 1.0);
  float coverage = rTrue / r;

  vec2 axis = s1 - s0;
  float L = length(axis);
  // Fall back to screen-up as the streak vanishes, so frozen beads keep a stable orientation.
  vec2 along = normalize(axis + vec2(0.0, 1.0) * max(0.0, 1.0 - L));
  vec2 across = vec2(along.y, -along.x); // screen-right of `along`; keeps the quad's winding front-facing

  // The base geometry is a unit quad; stretch it over the capsule.
  float ly = mix(-r, L + r, position.y + 0.5);
  float lx = position.x * 2.0 * r;
  vec2 s = s0 + along * ly + across * lx;
  float z = mix(c0.z / c0.w, c1.z / c1.w, clamp(ly / max(L, 1e-3), 0.0, 1.0));
  gl_Position = vec4(s / halfRes, z, 1.0);

  vLocal = vec2(lx, ly);
  vLen = L;
  vRadius = r;

  float fog = exp(-depth * uFogDensity);
  float nearFade = smoothstep(0.6, 3.0, depth); // drops this close would be out of focus
  vAlpha = edge * fog * nearFade * coverage * aParams.z * uFade;
}
