// Shades one drop. Moving drops are faint streaks. As a streak collapses into a round bead it is shaded
// as what it is, a tiny water sphere: the backdrop behind it shows through upside down and sharp, the
// rim reflects it (Fresnel), and a key light leaves one specular point. envColor() is prepended from
// env.glsl. Output is premultiplied (blend: one, one − source alpha): a bead covers what is behind it,
// a streak only for the share of the shutter the drop spends on the pixel.

uniform float uLensGain;   // 1: the bead passes on the backdrop's radiance, less Fresnel losses
uniform float uReflGain;
uniform float uSpec;
uniform vec3 uStreakColor;

varying vec2 vLocal;
varying float vLen;
varying float vRadius;
varying float vAlpha;
varying float vBright;
varying vec3 vView;
varying float vSoft;  // share of the radius that is defocus blur (rain.vert.glsl): 0 sharp
varying float vRound; // 1 a bead, 0 a streak

const vec3 KEY = vec3(-0.35, 0.8, 0.5); // view space, upper left
const float IOR = 1.333;

vec3 toWorld(vec3 v) {
  return (vec4(v, 0.0) * viewMatrix).xyz; // transpose of the view rotation = its inverse
}

void main() {
  if (vAlpha <= 0.0) discard;

  // Distance to the capsule's core segment, in radii.
  vec2 q = vec2(vLocal.x, vLocal.y - clamp(vLocal.y, 0.0, vLen)) / vRadius;
  float d = length(q);
  if (d > 1.0) discard;

  // Streak: blur spreads the drop over a longer shape, so it covers each pixel for less of the shutter.
  float spread = 2.0 * vRadius / (vLen + 2.0 * vRadius);

  // Bead: a water sphere seen along vView. Local x points screen-right, y screen-up. A ray through the
  // disk b radii from the centre is bent twice and leaves 2(θi − θt) off its path, toward the far side
  // of the axis: the bead shows about 83° all round behind it, upside down. The hero drops trace the
  // same optics per pixel; here it is in closed form.
  vec3 axis = normalize(vView);
  vec3 right = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, axis);
  // Out of focus, the bead's image spreads evenly over its blur disc: shade it from nearer its centre.
  float b = min(d * (1.0 - vSoft), 0.999);
  vec3 outward = (q.x * right + q.y * up) / max(d, 1e-4);
  float ti = asin(b);
  float dev = 2.0 * (ti - asin(b / IOR));
  vec3 refrDir = cos(dev) * axis - sin(dev) * outward;
  vec3 n = b * outward - cos(ti) * axis; // the surface normal, facing the camera
  float fresnel = 0.02 + 0.98 * pow(1.0 - cos(ti), 5.0);
  // The angle one pixel takes in: the deviation's rate across the disk over the radius in pixels, and
  // for the reflection the normal's turn, doubled. Out of focus a pixel takes in much of the image.
  float footRefr = mix(2.0 * (1.0 / cos(ti) - 1.0 / sqrt(IOR * IOR - b * b)) / vRadius, 1.0, vSoft);
  float footRefl = mix(2.0 / (cos(ti) * vRadius), 1.0, vSoft);
  float spec = pow(max(dot(n, normalize(normalize(KEY) - axis)), 0.0), 90.0);
  // Fresnel losses going in and coming out (the same angle both times).
  vec3 bead = envColor(normalize(toWorld(refrDir)), footRefr) * uLensGain * (1.0 - fresnel) * (1.0 - fresnel)
            + envColor(normalize(toWorld(reflect(axis, n))), footRefl) * uReflGain * fresnel
            + vec3(spec * uSpec);

  // Coverage: a bead is opaque with an anti-aliased rim, out of focus an even disc with a soft rim; a
  // streak keeps its soft core.
  float round = vRound;
  float rim = mix(1.0, 0.3 * vRadius, vSoft); // px
  float a = mix((1.0 - d * d) * spread, clamp((1.0 - d) * vRadius / rim + 0.5, 0.0, 1.0), round) * vAlpha;
  vec3 col = mix(uStreakColor * vBright, bead, round);

  gl_FragColor = vec4(col * a, a);
}
