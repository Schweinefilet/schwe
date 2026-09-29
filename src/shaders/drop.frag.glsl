// Hero drop: a water sphere, ray traced per pixel. env.glsl (envColor) is prepended.
//
// For each pixel: intersect the view ray with the sphere, refract into the water, cross to the far
// side, refract out again, and look up where that exit ray lands in the city clip. No flip is coded
// anywhere: a ray entering the top of the drop leaves heading down, so the clip comes out inverted,
// exactly like a real drop acting as a ball lens. Rays that leave past the clip's frame see the
// environment instead, which gives the dark ring near the rim that real drops have.

uniform vec3 uCenter;
uniform float uRadius;
uniform float uIor;         // water: 1.333
uniform float uDispersion;  // IOR spread between red and blue, for faint color fringes at the rim
uniform sampler2D uPoster;  // the poster atlas
uniform vec4 uPosterRect;   // xy: offset, zw: scale of this drop's cell in the atlas
uniform sampler2D uVideo;   // live video, when this drop has a decoder
uniform float uLive;        // 0: poster, 1: video; crossfades when a decoder is assigned or released
uniform vec2 uClipTan;      // tan(half field of view) of the clip, horizontal and vertical
uniform float uExposure;
uniform float uReflGain;
uniform float uGlint;
uniform float uEnvGain;     // brightness of the environment seen through the drop (the rain beads' lens gain)
uniform vec2 uNear;         // camera distance: the city in full within x; beyond y an ordinary bead
uniform float uDive;        // 0: ball lens; 1: plain window showing the clip upright, filling the screen
uniform vec2 uCoverTan;     // clip framing that exactly covers the screen, used at uDive = 1
uniform float uTimeScale;   // the rain's: 1 falling, 0 frozen
uniform vec3 uBoxCenter;    // the rain field's box, whose faces it fades at
uniform vec3 uBoxSize;
uniform float uFogDensity;
uniform float uFocus;       // the lens: 1 focused on the rain, 0 on the backdrop (the first shot)

varying vec3 vWorld;

const vec3 KEY = vec3(-0.35, 0.8, 0.5); // view space; same key light as the rain beads

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec2 clipTan;   // framing in use: uClipTan blended toward uCoverTan by uDive
float edgeSoft;
float envFoot;  // angle one pixel takes in along the ray leaving the drop, and along the reflected ray;
float reflFoot; // measured in main() before any pixel is discarded
float nearMix;  // how much of the city shows: 0 far off, 1 close (uNear)

#ifdef SKY
// Sky content (lab): the city's sky replaces the clip. It covers every direction, so there is no frame
// edge. The drop's axis, right and up map to the city view by a rotation (uSkyCityBasis), so the lens
// inverts the sky exactly as it inverted footage. citySky() comes from sky.glsl, prepended.
float skyFoot; // angular size of one pixel along the ray leaving the drop, measured in main()

vec3 behind(vec3 dir, vec3 axis, vec3 right, vec3 up) {
  return citySky(normalize(uSkyCityBasis * vec3(dot(dir, axis), dot(dir, right), dot(dir, up))), skyFoot);
}
#else
// The clip stands in for the world behind the drop, framed on the line from the camera to the drop.
vec3 behind(vec3 dir, vec3 axis, vec3 right, vec3 up) {
  float z = dot(dir, axis);
  vec2 uv = 0.5 + 0.5 * vec2(dot(dir, right), dot(dir, up)) / max(z, 1e-4) / clipTan;
  vec2 e = smoothstep(vec2(0.0), vec2(edgeSoft), uv) * smoothstep(vec2(0.0), vec2(edgeSoft), 1.0 - uv);
  float inside = e.x * e.y * step(0.0, z);
  uv = clamp(uv, 0.0, 1.0);
  vec3 clip = texture2D(uPoster, uPosterRect.xy + uv * uPosterRect.zw).rgb;
  // three uploads video frames without sRGB decoding (it decodes in its own materials), so decode here.
  if (uLive > 0.0) clip = mix(clip, srgbToLinear(texture2D(uVideo, uv).rgb), uLive);
  return mix(envColor(dir, envFoot) * uEnvGain, clip * uExposure, inside);
}
#endif

// Far off, a city drop is an ordinary bead: it refracts the backdrop like the rain around it, and its
// city fades in only as the camera comes near. The branch is the same for every pixel of a drop, so a
// distant drop skips its city entirely.
vec3 seen(vec3 dir, vec3 axis, vec3 right, vec3 up) {
  vec3 bead = envColor(dir, envFoot) * uEnvGain;
  if (nearMix <= 0.0) return bead;
  return mix(bead, behind(dir, axis, right, up), nearMix);
}

vec3 throughDrop(vec3 rd, vec3 p1, vec3 n1, float ior, vec3 axis, vec3 right, vec3 up) {
  vec3 t1 = refract(rd, n1, 1.0 / ior);                 // into the water
  vec3 p2 = p1 + t1 * (-2.0 * dot(t1, n1) * uRadius);   // chord across the sphere
  vec3 n2 = (p2 - uCenter) / uRadius;
  vec3 t2 = refract(t1, -n2, ior);                      // back out into air
  if (dot(t2, t2) < 1e-6) return vec3(0.0);             // total internal reflection: reads dark
  return seen(t2, axis, right, up);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 oc = ro - uCenter;
  float b = dot(oc, rd);
  float miss = sqrt(max(dot(oc, oc) - b * b, 0.0)); // closest distance from the ray to the center

  // Anti-aliased silhouette: coverage from how far inside the rim this pixel's ray passes.
  float alpha = clamp((uRadius - miss) / max(fwidth(miss), 1e-6), 0.0, 1.0);
  // Measured before any pixel is discarded, so its neighbours' derivatives stay defined.
  {
    float tIn = -b - sqrt(max(b * b - (dot(oc, oc) - uRadius * uRadius), 0.0));
    vec3 n = normalize(ro + rd * tIn - uCenter);
    vec3 t1 = refract(rd, n, 1.0 / mix(uIor, 1.0, uDive));
    vec3 n2 = normalize(ro + rd * tIn + t1 * (-2.0 * dot(t1, n) * uRadius) - uCenter);
    vec3 exitDir = refract(t1, -n2, mix(uIor, 1.0, uDive));
    envFoot = length(fwidth(exitDir));
    reflFoot = length(fwidth(reflect(rd, n)));
#ifdef SKY
    skyFoot = clamp(envFoot, 1e-5, 0.05);
#endif
  }
  if (alpha <= 0.0 || !gl_FrontFacing) discard;

  float t = -b - sqrt(max(b * b - (dot(oc, oc) - uRadius * uRadius), 0.0));
  vec3 p1 = ro + rd * t;
  vec3 n1 = normalize(p1 - uCenter);

  vec3 axis = normalize(uCenter - ro);
  vec3 right = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, axis);

  // Diving in: the index of refraction eases from water's to air's. On the way the focal point sweeps
  // past the camera, so the image swells and turns upright on its own; at 1.0 rays pass straight
  // through and the drop is a window framed exactly like a fullscreen clip.
  nearMix = 1.0 - smoothstep(uNear.x, uNear.y, length(ro - uCenter));
  float ior = mix(uIor, 1.0, uDive);
  float disp = uDispersion * (1.0 - uDive);
  clipTan = mix(uClipTan, uCoverTan, uDive);
  edgeSoft = mix(0.05, 0.002, uDive);

  float cosi = clamp(-dot(rd, n1), 0.0, 1.0);
  float fresnel = (0.02 + 0.98 * pow(1.0 - cosi, 5.0)) * (1.0 - uDive);

#ifdef DISPERSION
  vec3 trans = vec3(
    throughDrop(rd, p1, n1, ior - disp, axis, right, up).r,
    throughDrop(rd, p1, n1, ior, axis, right, up).g,
    throughDrop(rd, p1, n1, ior + disp, axis, right, up).b
  );
#else
  vec3 trans = throughDrop(rd, p1, n1, ior, axis, right, up);
#endif

  vec3 refl = envColor(reflect(rd, n1), reflFoot) * uReflGain;
  vec3 nView = (viewMatrix * vec4(n1, 0.0)).xyz;
  float spec = pow(max(dot(nView, normalize(normalize(KEY) + vec3(0.0, 0.0, 1.0))), 0.0), 2500.0);

  vec3 col = trans * (1.0 - fresnel) + refl * fresnel + vec3(spec * uGlint * (1.0 - uDive));

  // In falling rain a still bead would stand out, so a city drop shows only once the rain has all but
  // stopped (the last few cm of its fall), and, since it has no defocus blur, once the lens is (nearly)
  // focused on the rain. Far off it also fades like a rain bead: fog, and the faces of the rain field's
  // box, beyond which there is no rain.
  vec3 e = abs(uCenter - uBoxCenter) / (0.5 * uBoxSize);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(max(e.x, e.y), e.z));
  float asRain = mix(edge * exp(-length(ro - uCenter) * uFogDensity), 1.0, nearMix);
  float still = (1.0 - smoothstep(0.005, 0.1, uTimeScale)) * smoothstep(0.6, 1.0, uFocus);
  gl_FragColor = vec4(col, alpha * asRain * still);
}
