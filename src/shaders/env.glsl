// The one environment every material agrees on: the backdrop (BACKDROP in config.js), a 360° night
// photograph stored log-encoded (src/content/backdropCodec.js). The backdrop itself and flat water see
// it out of focus (envSoft), as a lens focused on the rain would; drops see it sharp (envColor), since
// a drop's image of the far city forms inside the drop, where the lens is focused. What a drop shows
// is therefore always what is behind it. `d` is a normalized world-space direction.

uniform sampler2D uEnvSharp;
uniform sampler2D uEnvSoft;
uniform vec2 uEnvCodecSharp; // x: stops of the log range, y: knee × exposure (decoded = y × (2^(x·e) − 1))
uniform vec2 uEnvCodecSoft;
uniform float uEnvYaw;  // radians
// Radians the square rises by as the eye comes down to its ground (the ending, on the puddle): the
// photograph was taken standing, and a camera at the level of its pavement sees it all higher, its
// street meeting the water's horizon. The same shift at every longitude is what lowering the eye does
// for things at one distance. 0 everywhere else.
uniform float uEnvLift;

const float ENV_PI = 3.14159265;

vec2 envUv(vec3 d) {
  float lon = atan(d.x, -d.z) + uEnvYaw;
  return vec2(fract(lon / (2.0 * ENV_PI) + 0.5), 0.5 + (asin(clamp(d.y, -1.0, 1.0)) - uEnvLift) / ENV_PI);
}

vec3 envDecode(vec3 e, vec2 codec) {
  return codec.y * (exp2(e * codec.x) - 1.0);
}

// `foot`: the angle (radians) one pixel takes in around d. It picks the mip level directly, because
// derivatives of the uv jump where the longitude wraps.
vec3 envColor(vec3 d, float foot) {
  float texelsPerRadian = float(textureSize(uEnvSharp, 0).x) / (2.0 * ENV_PI);
  return envDecode(textureLod(uEnvSharp, envUv(d), log2(max(foot * texelsPerRadian, 1.0))).rgb, uEnvCodecSharp);
}

vec3 envSoft(vec3 d) {
  return envDecode(textureLod(uEnvSoft, envUv(d), 0.0).rgb, uEnvCodecSoft);
}
