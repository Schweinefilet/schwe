// A city's sky along one direction, assembled per pixel. The atmosphere comes from the city's
// sky-view texture: it is smooth, so a small texture holds up even full-screen. Everything that must
// stay sharp at any size is computed here: the sun and moon disks, catalogue stars, the cloud layer.
// Directions are in the city frame (x east, y up, z south). Every light uniform is already multiplied
// by the city's exposure. atmosphere.glsl is prepended.

uniform sampler2D uSkyView;
uniform vec2 uSkyViewSize;
uniform float uSkyViewHeight;
uniform mat3 uSkyCityBasis;   // drop frame (axis, right, up) components → city frame
uniform mat3 uSkyEquatorial;  // city frame → J2000 equatorial, the star catalogue's frame
uniform vec3 uSkySunDir;
uniform vec3 uSkyMoonDir;
uniform float uSkySunE;       // illuminance above the atmosphere
uniform float uSkySunDisk;    // radiance at the centre of the sun's disk, above the atmosphere
uniform vec3 uSkyMoonE;       // illuminance above the atmosphere, coloured, at the current phase
uniform float uSkyMoonOn;
uniform vec3 uSkyMoon;        // angular radius, full-disk radiance scaled to the phase, earthshine share
uniform vec3 uSkyMoonTint;
uniform sampler2D uSkyStars;  // cells: xy position in the cell, z V magnitude, w B-V
uniform float uSkyStarCells;
uniform float uSkyStarScale;  // illuminance of a magnitude-0 star; 0 while the sky is too bright
uniform float uSkySeeing;     // radians: the smallest blur a star gets
uniform sampler2D uSkyCloudNoise; // r: coverage rank, uniform on 0..1; g: density detail
uniform vec4 uSkyCloud;       // cover 0..1, optical depth, base height km, noise tile km
uniform vec2 uSkyCloudOffset;
uniform vec3 uSkyCityGlow;    // the city's own light: zenith luminance of its clear night sky
uniform vec3 uSkyCityShape;   // glow at the horizon, on cloud, and on the ground, relative to zenith
uniform float uSkyCityMottle; // how much the city-lit cloud base follows the deck's density (0: even)
// The city's skyline from its vantage, rendered in Blender (scripts/blender/), light premultiplied by
// coverage in every texture:
uniform sampler2D uSkylineLight;   // under an overcast sky of unit horizon radiance; a: coverage
uniform sampler2D uSkylineNight;   // the city's fixed lights (lamps, floodlights, landmarks); a: log distance
uniform sampler2D uSkylineWindows; // the evening's lit windows; a: the share of their light still on late
uniform float uSkylineOn;
uniform vec4 uSkylineRect;    // azimuth where it starts and its width, elevation of its bottom and its height (radians)
uniform vec2 uSkylineDist;    // log of the nearest encoded distance (m), and the log range
uniform vec3 uSkylineScale;   // what each texture's RGB was divided by to fit
uniform vec3 uSkylineLit;     // weights of the evening and late windows (local time), how dark it is (0 day, 1 night)
uniform vec3 uSkylineGain;    // on-screen gain of the fixed lights and of the windows (display-referred: added
                              // after the exposure), and haze per km
uniform float uSkyHaze;       // rain or fog extinction near the ground, per km
uniform float uSkyRain;       // rain now, mm/h (eased between readings)
uniform float uSkyTime;       // seconds, the city's own live clock (its falling rain), wrapping every 600
uniform float uSkyPreExposure; // the exposure every light uniform and the sky-view texture carry
uniform vec3 uSkyMeter;       // key, ref (cd/m²), range: a metered L comes out at key × (L / ref)^range

const float SUN_RADIUS = 0.004654;
const float CLOUD_NOISE_SIZE = 512.0;

vec3 skyAtmosphere(vec3 d) {
  return textureLod(uSkyView, skyViewUv(d, PLANET_R + uSkyViewHeight, uSkyViewSize), 0.0).rgb;
}

// A disk of angular radius R seen at angular distance s from its centre, anti-aliased over one pixel
// (foot). When the disk is smaller than a pixel it is drawn a pixel wide and dimmed to keep its light.
float diskCover(float s, float R, float foot, out float scale) {
  float Reff = max(R, foot);
  scale = Reff / R;
  return (1.0 - smoothstep(Reff - foot, Reff + foot, s)) / (scale * scale);
}

vec3 sunDisk(vec3 d, float foot) {
  float s = length(cross(d, uSkySunDir));
  if (dot(d, uSkySunDir) <= 0.0 || s > SUN_RADIUS + 2.0 * foot) return vec3(0.0);
  float scale;
  float cover = diskCover(s, SUN_RADIUS, foot, scale);
  float q = min(s / (SUN_RADIUS * scale), 1.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(1.0 - q * q)); // limb darkening
  return vec3(uSkySunDisk * limb * cover);
}

// The moon as a sphere lit by the real sun direction: phase and tilt come from the geometry.
// Lommel-Seeliger shading (a full moon is evenly bright to its edge, as the real one is), plus
// earthshine on the dark side.
vec3 moonDisk(vec3 d, float foot) {
  vec3 M = uSkyMoonDir;
  float R = uSkyMoon.x;
  float s = length(cross(d, M));
  if (dot(d, M) <= 0.0 || s > R + 2.0 * foot) return vec3(0.0);
  float scale;
  float cover = diskCover(s, R, foot, scale);
  vec3 e1 = normalize(cross(M, abs(M.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(e1, M);
  vec2 q = vec2(dot(d, e1), dot(d, e2)) / (sin(R) * scale);
  float qq = min(dot(q, q), 1.0);
  vec3 N = e1 * q.x + e2 * q.y - M * sqrt(1.0 - qq); // surface normal, facing us
  float mu0 = dot(N, uSkySunDir);
  float muV = max(dot(N, -M), 1e-3);
  float lit = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + muV) : 0.0;
  return uSkyMoonTint * uSkyMoon.y * (lit + uSkyMoon.z) * cover;
}

// Cube-face cells of the star catalogue (same layout as src/sky/starCells.js).
void cubeCell(vec3 e, out int face, out vec2 st) {
  vec3 a = abs(e);
  vec2 f;
  if (a.x >= a.y && a.x >= a.z) {
    face = e.x > 0.0 ? 0 : 1;
    f = vec2(e.x > 0.0 ? -e.z : e.z, e.y) / a.x;
  } else if (a.y >= a.z) {
    face = e.y > 0.0 ? 2 : 3;
    f = vec2(e.x, e.y > 0.0 ? -e.z : e.z) / a.y;
  } else {
    face = e.z > 0.0 ? 4 : 5;
    f = vec2(e.z > 0.0 ? e.x : -e.x, e.y) / a.z;
  }
  st = (f * 0.5 + 0.5) * uSkyStarCells;
}

vec3 cellDir(int face, vec2 st) {
  vec2 f = st / uSkyStarCells * 2.0 - 1.0;
  vec3 d;
  if (face == 0) d = vec3(1.0, f.y, -f.x);
  else if (face == 1) d = vec3(-1.0, f.y, f.x);
  else if (face == 2) d = vec3(f.x, 1.0, -f.y);
  else if (face == 3) d = vec3(f.x, -1.0, f.y);
  else if (face == 4) d = vec3(f.x, f.y, 1.0);
  else d = vec3(-f.x, f.y, -1.0);
  return normalize(d);
}

// B-V to a gentle tint: blue-white hot stars, sun-coloured, orange cool ones. Unit luminance.
vec3 starTint(float bv) {
  if (bv > 5.0) return vec3(1.0); // colour unknown
  vec3 hot = vec3(0.70, 0.80, 1.0);
  vec3 sun = vec3(1.0, 0.94, 0.86);
  vec3 cool = vec3(1.0, 0.72, 0.45);
  vec3 c = bv < 0.65 ? mix(hot, sun, smoothstep(-0.3, 0.65, bv)) : mix(sun, cool, smoothstep(0.65, 1.8, bv));
  return c / dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Real stars (Yale Bright Star Catalogue), each a small Gaussian at least a pixel wide, carrying its
// catalogue brightness. Whether a star shows at all is left to the numbers: sky brightness, exposure
// and how many pixels share its light.
vec3 skyStars(vec3 dCity, float foot) {
  vec3 e = uSkyEquatorial * dCity;
  int face;
  vec2 st;
  cubeCell(e, face, st);
  ivec2 base = ivec2(floor(st - 0.5));
  int n = int(uSkyStarCells);
  float sigma = max(foot * 0.6, uSkySeeing);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 c = base + ivec2(i, j);
      if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) continue;
      vec4 s = texelFetch(uSkyStars, ivec2(c.x + face * n, c.y), 0);
      if (s.z > 50.0) continue;
      vec3 sd = cellDir(face, vec2(c) + s.xy);
      vec3 x = cross(e, sd);
      sum += starTint(s.w) * exp2(-1.3287712 * s.z) * exp(-dot(x, x) / (2.0 * sigma * sigma));
    }
  }
  return sum * uSkyStarScale / (2.0 * PI * sigma * sigma);
}

// Light leaving the cloud deck's underside toward us, per unit illuminance from light L.
// Thin cloud scatters sunlight once, brightest near the light; thick cloud passes it through diffused
// (two-stream transmission), an even grey. A light below the cloud's own horizontal lights the base
// directly: the red undersides after sunset.
vec3 cloudLight(vec3 up, float h, vec3 d, vec3 L, float tau) {
  float mu = dot(up, L);
  vec3 lightT = transmittanceToTop(h, mu) * planetShadow(h, mu);
  float c = dot(d, L);
  float thin = mix(hgPhase(c, 0.6), hgPhase(c, -0.2), 0.3) + 0.25 * abs(mu) / PI;
  float thick = (max(mu, 0.0) / (1.0 + 0.1125 * tau) + 0.9 * max(-mu, 0.0)) / PI;
  return lightT * mix(thin, thick, smoothstep(2.0, 10.0, tau));
}

// Share of skylight that still gets through a cloud of optical depth tau.
float ambientThrough(float tau) {
  return mix(1.0, 1.0 / (1.0 + 0.1125 * tau), smoothstep(2.0, 10.0, tau));
}

// `lit`: how strongly the city lights this part of the base, relative to the deck's average.
vec3 cloudRadiance(vec3 p, vec3 d, float tau, vec3 zenith, float lit) {
  float h = length(p);
  vec3 up = p / h;
  vec3 C = uSkySunE * cloudLight(up, h, d, uSkySunDir, tau);
  if (uSkyMoonOn > 0.5) C += uSkyMoonE * cloudLight(up, h, d, uSkyMoonDir, tau);
  float reflectance = 1.0 - 1.0 / (1.0 + 0.1125 * tau); // how much of the city's light the base sends back
  return C + zenith * 0.6 * ambientThrough(tau) + uSkyCityGlow * uSkyCityShape.y * reflectance * lit;
}

// A full deck's underside straight overhead: the colour of the light under it, which is also the
// colour of rain haze and of distant cloud.
vec3 deckRadiance(vec3 zenith) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  return cloudRadiance(up * (PLANET_R + uSkyCloud.z), up, uSkyCloud.y, zenith, 1.0);
}

// Cloud where the ray meets the deck: radiance in rgb, opacity in a.
vec4 skyClouds(vec3 d, float foot, vec3 zenith, vec3 far) {
  vec3 ro = vec3(0.0, PLANET_R + uSkyViewHeight, 0.0);
  float t = raySphere(ro, d, PLANET_R + uSkyCloud.z);
  vec3 p = ro + d * t;
  float slant = 1.0 / max(dot(d, normalize(p)), 0.05); // a pixel's footprint stretches at grazing angles
  float lod = log2(max(foot * t * slant * CLOUD_NOISE_SIZE / uSkyCloud.w, 1.0));
  vec2 n = textureLod(uSkyCloudNoise, p.xz / uSkyCloud.w + uSkyCloudOffset, lod).rg;
  // The noise's first channel is uniform on 0..1, so thresholding it at 1 - cover covers that share of
  // the sky. Where mip levels have averaged it, the threshold widens so distant cover stays true.
  float w = mix(0.05, 0.5, clamp(lod / 7.0, 0.0, 1.0));
  float threshold = mix(1.0 + w, -w, uSkyCloud.x);
  float cover = smoothstep(threshold - w, threshold + w, n.r);
  float tau = cover * uSkyCloud.y * (0.55 + 0.9 * n.g);
  float alpha = 1.0 - exp(-tau);
  // Low down the deck is seen edge-on and its pattern stretches into flat slabs. Up to about 15° the
  // pattern gives way to its own average: opacity eases to the cover fraction, colour to the haze.
  // Under full cover that is the deck's own colour, so overcast still meets the horizon.
  float edge = smoothstep(0.0, 0.26, d.y);
  alpha = mix(uSkyCloud.x, alpha, edge);
  if (alpha < 1e-3) return vec4(0.0);
  // Lit from below by the city, the base shows the deck's own texture: denser parts brighter, thin
  // patches darker (SKY.cityGlow.mottle). Sunlight and moonlight keep their own shading.
  vec3 C = cloudRadiance(p, d, tau, zenith, 1.0 + uSkyCityMottle * (n.g - 0.5));
  C = mix(C, far, 1.0 - exp(-t / 25.0)); // far cloud fades into the light under the sky
  return vec4(mix(far, C, edge), alpha);
}

// The city's skyline in front of its sky (SKY.skyline, scripts/blender/). Returns its colour premultiplied
// by its coverage (a): daylight is the overcast render scaled by the live light at the horizon, which
// distant buildings fade into; `lights`: the city's own lights and windows after dark, display-referred
// (added after the exposure: a real window, a hundred times brighter than a city's night sky, would blow
// the skyline out). Every texture holds light premultiplied by coverage, decoded linear before
// filtering, so the drift's tiny drops read its averaged mip levels correctly.
vec4 skyline(vec3 d, float foot, vec3 horizon, out vec3 lights) {
  lights = vec3(0.0);
  float rel = mod(atan(d.x, -d.z) - uSkylineRect.x, 2.0 * PI);
  vec2 uv = vec2(rel / uSkylineRect.y, (asin(clamp(d.y, -1.0, 1.0)) - uSkylineRect.z) / uSkylineRect.w);
  if (uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  float sides = smoothstep(0.0, 0.04, uv.x) * smoothstep(0.0, 0.04, 1.0 - uv.x); // the panorama's own edges
  float texelsPerRadian = float(textureSize(uSkylineLight, 0).x) / uSkylineRect.y;
  float lod = log2(max(foot * texelsPerRadian, 1.0));
  vec4 L = textureLod(uSkylineLight, uv, lod);
  float cover = L.a * sides;
  if (cover <= 1e-3) return vec4(0.0);
  vec4 N = textureLod(uSkylineNight, uv, lod);
  vec4 W = textureLod(uSkylineWindows, uv, lod);
  float km = exp(uSkylineDist.x + (N.a / max(L.a, 1e-3)) * uSkylineDist.y) / 1000.0;
  // Aerial perspective: farther buildings fade into the light around them, faster in rain or fog.
  float clear = exp(-km * (uSkylineGain.z + uSkyHaze));
  vec3 lit = L.rgb * uSkylineScale.x * horizon * sides;
  vec3 c = horizon * cover * (1.0 - clear) + lit * clear;
  // After dark: the fixed lights, and the windows, the evening's giving way to the few still lit late.
  float dark = uSkylineLit.z;
  vec3 windows = W.rgb * uSkylineScale.z * (1.0 - uSkylineLit.y * (1.0 - W.a / max(L.a, 1e-3)));
  lights = (N.rgb * uSkylineScale.y * uSkylineGain.x + windows * uSkylineGain.y) * dark * clear * sides;
  return vec4(c, cover);
}

// Falling rain in front of the city (while it rains there), as a camera at 1/60 s sees it: streaks at
// four distances, 2 to 16 m, each as long as a drop falls (6.5 m/s) in the shutter time and as wide as
// the drop blurred out of focus, the nearest widest and faintest. Each streak refracts the light around
// it, a little brighter than that light (the drop gathers it), and the city's own light at night, when
// the streaks show brightest against the dark.
// How many fall follows the rate (drizzle a few, a downpour many); decoration shaped by the physics,
// not a simulation. `foot`: this pixel's angular size, so a streak thinner than a pixel spreads its
// light over it instead of flickering, and a tiny drop far off reads the rain as a faint veil.
float rainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 cityRain(vec3 d, float foot, vec3 light) {
  if (uSkyRain <= 0.0) return vec4(0.0);
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float share = clamp(0.22 * pow(uSkyRain, 0.5), 0.12, 0.9); // share of cells holding a streak: drizzle shows too
  const float FALL = 6.5;   // m/s
  const float SHUTTER = 1.0 / 60.0;
  float cover = 0.0;
  for (int i = 0; i < 4; i++) {
    float dist = 2.0 * exp2(float(i));               // 2, 4, 8, 16 m
    float len = FALL * SHUTTER / dist;               // radians the streak spans
    float width = max(0.006 / dist, 0.0004);         // out of focus near, a hair far off
    float cell = len * 1.6;                          // one streak per cell at most
    float speed = FALL / dist;                       // radians a second, downward
    vec2 g = vec2(az / cell * 0.35, (el + uSkyTime * speed) / cell);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = rainHash(id + float(i) * 37.1);
    if (h > share) continue;
    float x = 0.15 + 0.7 * rainHash(id + 11.3 + float(i));
    float y = 0.32 + 0.36 * rainHash(id + 23.9 + float(i)); // the whole streak inside its cell
    // Across: the streak's width (at least a pixel's, its light spread over that); along: its length,
    // fading in and out at the ends.
    float w = max(width, foot);
    float across = abs(f.x - x) * cell / 0.35;
    float a = 1.0 - smoothstep(0.5 * w, w, across);
    float along = (f.y - y) * 1.6;                    // in streak lengths
    a *= smoothstep(-0.5, -0.3, along) * (1.0 - smoothstep(0.3, 0.5, along));
    a *= width / w * mix(0.5, 0.85, float(i) / 3.0); // near streaks blur fainter
    cover = max(cover, a);
  }
  return vec4(light * 1.25 + uSkyCityGlow * 6.0, cover);
}

// Center-weighted metering of what the view faces, read from the sky itself (the same few texels
// for every pixel). Returns the factor that takes the pre-exposed sky to its final exposure.
float skyMeter(vec3 deck) {
  vec3 V = uSkyCityBasis[0];
  vec3 R = uSkyCityBasis[1];
  vec3 U = uSkyCityBasis[2];
  vec3 m = 2.0 * skyAtmosphere(V) + skyAtmosphere(normalize(V + 0.4 * R)) + skyAtmosphere(normalize(V - 0.4 * R))
         + skyAtmosphere(normalize(V + 0.3 * U)) + skyAtmosphere(normalize(V - 0.2 * U));
  m = mix(m / 6.0 + uSkyCityGlow * 2.0, deck, uSkyCloud.x);
  float L = max(dot(m, vec3(0.2126, 0.7152, 0.0722)), 1e-12) / uSkyPreExposure;
  return uSkyMeter.x * pow(L / uSkyMeter.y, uSkyMeter.z) / L / uSkyPreExposure;
}

// A camera's highlight shoulder: linear to 0.6, then rolling off toward 1, so the sky arrives in the
// same 0..1 range as footage and the site's one LUT grades both.
vec3 skyShoulder(vec3 x) {
  const float s = 0.6;
  return mix(x, s + (1.0 - s) * (1.0 - exp(-(x - s) / (1.0 - s))), step(s, x));
}

vec3 citySky(vec3 d, float foot) {
  float r0 = PLANET_R + uSkyViewHeight;
  vec3 ro = vec3(0.0, r0, 0.0);
  float tGround = raySphere(ro, d, PLANET_R);
  bool ground = tGround > 0.0;
  vec3 zenith = skyAtmosphere(vec3(0.0, 1.0, 0.0));
  vec3 col = skyAtmosphere(d);
  bool cloudy = uSkyCloud.x > 0.0;
  vec3 deck = cloudy || uSkyHaze > 0.0 ? deckRadiance(zenith) : vec3(0.0);
  float exposure = skyMeter(deck);

  if (ground) {
    // Under a deck the ground gets no direct light; the city's streets glow below the horizon.
    col *= mix(1.0, ambientThrough(uSkyCloud.y), uSkyCloud.x);
    col += uSkyCityGlow * uSkyCityShape.z * (0.4 + 0.6 * exp(d.y / 0.1));
  } else {
    col += uSkyCityGlow * (1.0 + (uSkyCityShape.x - 1.0) * exp(-d.y / 0.12)); // skyglow, warmest low down
    vec3 far = mix(col, deck, uSkyCloud.x);
    vec3 space = sunDisk(d, foot);
    if (uSkyMoonOn > 0.5) space += moonDisk(d, foot);
    if (uSkyStarScale > 0.0) space += skyStars(d, foot);
    col += space * transmittanceToTop(r0, d.y);
    if (cloudy) {
      vec4 c = skyClouds(d, foot, zenith, far);
      col = mix(col, c.rgb, c.a);
    }
  }

  if (uSkyHaze > 0.0) {
    // Rain (or fog) between us and the cloud base, or the ground: lit by the light under the deck.
    float path = ground ? tGround : (cloudy ? raySphere(ro, d, PLANET_R + uSkyCloud.z) : 10.0);
    col = mix(col, deck, 1.0 - exp(-uSkyHaze * min(path, 60.0)));
  }
  vec3 lights = vec3(0.0);
  // The light around the view's horizon, live: the sky there, or under a deck the light beneath it;
  // rain and fog grey it towards the deck's. It lit the skyline, and it lights the falling rain.
  vec3 hd = normalize(vec3(d.x, 0.04, d.z));
  vec3 horizon = skyAtmosphere(hd) + uSkyCityGlow * uSkyCityShape.x;
  horizon = mix(horizon, deck, max(uSkyCloud.x, 1.0 - exp(-uSkyHaze * 10.0)));
  if (uSkylineOn > 0.5) {
    vec4 s = skyline(d, foot, horizon, lights);
    col = col * (1.0 - s.a) + s.rgb;
  }
  vec4 rain = cityRain(d, foot, horizon);
  col = mix(col, rain.rgb, rain.a);
  return skyShoulder(col * exposure + lights * (1.0 - rain.a));
}
