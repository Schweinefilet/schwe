// Shades one drop. Moving drops are faint streaks. As a streak collapses into a round bead it is
// shaded as a tiny ball lens: the street glow from below shows up inverted in its top half, the rim
// reflects the environment (Fresnel), and a key light leaves one specular point.
// envColor() is prepended from env.glsl.

uniform float uLensGain;   // how much a bead concentrates the light behind it
uniform float uReflGain;
uniform float uSpec;
uniform vec3 uStreakColor;

varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vAlpha;

const vec3 KEY = vec3(-0.35, 0.8, 0.5); // view space, upper left

vec3 toWorld(vec3 v) {
  return (vec4(v, 0.0) * viewMatrix).xyz; // transpose of the view rotation = its inverse
}

void main() {
  if (vAlpha <= 0.0) discard;

  // Distance to the capsule's core segment, in radii.
  vec2 q = vec2(vLocal.x, vLocal.y - clamp(vLocal.y, 0.0, vLen)) / vRadius;
  float d = length(q);
  if (d > 1.0) discard;
  float mask = 1.0 - d * d; // brighter core, soft edge

  // Streak: blur spreads the same light over a longer shape, so longer streaks are fainter.
  float spread = 2.0 * vRadius / (vLen + 2.0 * vRadius);
  vec3 streak = uStreakColor * spread;

  // Bead: a sphere normal from the disk. Local x points screen-right, y screen-up.
  vec3 n = vec3(q.x, q.y, sqrt(max(1.0 - d * d, 0.0)));
  float fresnel = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
  vec3 refrDir = normalize(vec3(-n.x, -n.y, -1.0)); // a ball lens flips what is behind it
  vec3 reflDir = reflect(vec3(0.0, 0.0, -1.0), n);
  float spec = pow(max(dot(n, normalize(normalize(KEY) + vec3(0.0, 0.0, 1.0))), 0.0), 90.0);
  vec3 bead = envColor(normalize(toWorld(refrDir))) * uLensGain * (1.0 - fresnel) * smoothstep(1.0, 0.75, d)
            + envColor(normalize(toWorld(reflDir))) * uReflGain * fresnel
            + vec3(spec * uSpec);

  float round = 1.0 - smoothstep(0.0, 1.5, vLen / vRadius);
  vec3 col = mix(streak, bead, round);

  gl_FragColor = vec4(col, mask * vAlpha);
}
