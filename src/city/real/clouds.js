// A layer of cloud over the photoreal New York, with the measured cloud cover. The sky's environment
// cube shows it (so water and glass reflect it) and the city's materials take its shadow, projected along
// the sun's direction (the way Microsoft Flight Simulator and Decima shade the ground under their
// volumetric clouds; Schneider and Vos, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn",
// Advances in Real-Time Rendering 2015). A full ray-marched volume would never be seen from this view:
// the horizon is out of frame.
//
// The cover fraction is the reading's; the pattern is procedural value noise (a stylisation, like the
// occupancy curve), drifting with the wind.

// The noise's covered fraction for a threshold is roughly a normal distribution's tail (mean 0.5, sd
// 0.13 for this sum of octaves): the threshold that covers `cover` of the sky.
function probit(p) {
  // Acklam's rational approximation of the normal quantile.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const q0 = Math.min(1 - 1e-6, Math.max(1e-6, p))
  if (q0 < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(q0))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (q0 > 1 - 0.02425) return -probit(1 - q0)
  const q = q0 - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}
export const cloudThreshold = (cover) => (cover <= 0.01 ? 2 : cover >= 0.99 ? -2 : 0.5 + 0.13 * probit(1 - cover))

// `km`: a point on the layer, kilometres. Returns 0..1 opacity of the layer there.
export const CLOUDS_GLSL = /* glsl */ `
  float cHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + 1.0), f.x), f.y);
  }
  // uCloudTh comes from cloudThreshold(cover) in clouds.js.
  float cloudCover(vec2 km, float th) {
    if (th > 1.5) return 0.0;
    if (th < -1.5) return 1.0;
    float n = 0.5 * cNoise(km / 3.0) + 0.25 * cNoise(km / 1.5 + 7.1) + 0.125 * cNoise(km / 0.75 + 3.7) + 0.0625 * cNoise(km / 0.375 + 1.3);
    n /= 0.9375;
    return smoothstep(th - 0.05, th + 0.05, n);
  }
`
