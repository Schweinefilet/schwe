// Earth's atmosphere after Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique" (Rayleigh, Mie and ozone; multiple scattering to all orders, approximated).
// Units are kilometres. The planet's centre is the origin and the viewer stands on +y, so the city
// frame (x east, y up, z south) is also this frame's orientation.
//
// Transmittance uses Bruneton's parameterization, so a Bruneton model could share this texture.

#ifndef PI
#define PI 3.14159265359
#endif

// RAYLEIGH_SCATTERING and OZONE_ABSORPTION (per km at sea level, at the wavelengths the red, green and
// blue channels stand for) are prepended by the model from SKY.atmosphere (src/sky/spectrum.js).
const float PLANET_R = 6360.0;
const float TOP_R = 6460.0;
const float RAYLEIGH_H = 8.0;
const float MIE_SCATTERING = 3.996e-3;
const float MIE_EXTINCTION = 4.440e-3;
const float MIE_H = 1.2;
const float MIE_G = 0.8;
const float EARTH_ALBEDO = 0.3; // light the ground returns to the air, for multiple scattering
const vec2 T_SIZE = vec2(256.0, 64.0);
const float MS_SIZE = 32.0;

uniform sampler2D uTransmittance;
uniform sampler2D uMultiScattering;

struct Medium {
  vec3 rayleigh;
  float mie;
  vec3 scattering;
  vec3 extinction;
};

Medium sampleMedium(float h) {
  float r = exp(-h / RAYLEIGH_H);
  float m = exp(-h / MIE_H);
  float o = max(0.0, 1.0 - abs(h - 25.0) / 15.0); // ozone: a 30 km thick layer peaking at 25 km
  Medium s;
  s.rayleigh = RAYLEIGH_SCATTERING * r;
  s.mie = MIE_SCATTERING * m;
  s.scattering = s.rayleigh + s.mie;
  s.extinction = s.rayleigh + MIE_EXTINCTION * m + OZONE_ABSORPTION * o;
  return s;
}

// Nearest non-negative distance along the unit ray (ro, rd) to the sphere of radius r at the
// origin, or -1. The constant term is factored, which keeps precision a few metres above the ground.
float raySphere(vec3 ro, vec3 rd, float r) {
  float l = length(ro);
  float b = dot(ro, rd);
  float c = (l - r) * (l + r);
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s;
  float t1 = -b + s;
  if (t0 >= 0.0) return t0;
  return t1 >= 0.0 ? t1 : -1.0;
}

float rayleighPhase(float c) {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette-Shanks: Henyey-Greenstein with the Rayleigh-like (1 + c²) term.
float miePhase(float c, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Transmittance texture coordinates for a ray starting at radius r with cos(zenith) mu, heading up
// through the top of the atmosphere without meeting the ground.
vec2 transmittanceUv(float r, float mu) {
  float H = sqrt((TOP_R - PLANET_R) * (TOP_R + PLANET_R));
  float rho = sqrt(max((r - PLANET_R) * (r + PLANET_R), 0.0));
  float disc = r * r * (mu * mu - 1.0) + TOP_R * TOP_R;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = TOP_R - r;
  float dMax = rho + H;
  vec2 uv = vec2((d - dMin) / (dMax - dMin), rho / H);
  return clamp(uv, 0.0, 1.0) * (1.0 - 1.0 / T_SIZE) + 0.5 / T_SIZE;
}

vec3 transmittanceToTop(float r, float mu) {
  return textureLod(uTransmittance, transmittanceUv(r, mu), 0.0).rgb;
}

// 1 where light along cos(zenith) mu reaches a point at radius r, 0 where the planet hides it,
// softened across the sun's own diameter so Earth's shadow has no stair steps.
float planetShadow(float r, float mu) {
  float muHorizon = -sqrt(max(1.0 - (PLANET_R / r) * (PLANET_R / r), 0.0));
  return smoothstep(-0.0047, 0.0047, mu - muHorizon);
}

vec3 multiScattering(float r, float mu) {
  vec2 uv = clamp(vec2(mu * 0.5 + 0.5, (r - PLANET_R) / (TOP_R - PLANET_R)), 0.0, 1.0);
  return textureLod(uMultiScattering, uv * (1.0 - 1.0 / MS_SIZE) + 0.5 / MS_SIZE, 0.0).rgb;
}

// Sky-view texture: u is azimuth (north 0, clockwise through east), v the zenith angle, with half the
// rows above the horizon and half below and both halves squeezed toward it, where the sky changes
// fastest. `r` is the viewer's radius.
float horizonBeta(float r) {
  return acos(sqrt(max((r - PLANET_R) * (r + PLANET_R), 0.0)) / r); // angle from nadir to the horizon
}

vec3 skyViewDirection(vec2 uv, float r) {
  float beta = horizonBeta(r);
  float zenithHorizon = PI - beta;
  float vza;
  if (uv.y < 0.5) {
    float c = 1.0 - 2.0 * uv.y;
    vza = zenithHorizon * (1.0 - c * c);
  } else {
    float c = 2.0 * uv.y - 1.0;
    vza = zenithHorizon + beta * c * c;
  }
  float az = uv.x * 2.0 * PI;
  return vec3(sin(vza) * sin(az), cos(vza), -sin(vza) * cos(az));
}

vec2 skyViewUv(vec3 d, float r, vec2 size) {
  float beta = horizonBeta(r);
  float zenithHorizon = PI - beta;
  float vza = acos(clamp(d.y, -1.0, 1.0));
  float v = vza < zenithHorizon
    ? 0.5 * (1.0 - sqrt(max(1.0 - vza / zenithHorizon, 0.0)))
    : 0.5 + 0.5 * sqrt(max((vza - zenithHorizon) / beta, 0.0));
  float u = atan(d.x, -d.z) / (2.0 * PI); // wraps: the texture repeats in u
  return vec2(u, v * (1.0 - 1.0 / size.y) + 0.5 / size.y);
}
