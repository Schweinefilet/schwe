// How the backdrop (BACKDROP in config.js) is stored: an HDR photograph as 8-bit JPEGs, log-encoded,
// values relative to the panorama's median luminance (1). Two ranges:
//   soft (the backdrop itself): up to 256× the median, about 3.5% per code there. Its smooth gradients
//     are where coarse steps would band, and its lamps are already spread out into bokeh.
//   sharp (what drops see): up to 2^18×, about 6% per code. Most of the square's light is in its
//     lamps (76% lies above 256×), and a small bead averages everything it sees, so clipping them would
//     leave every bead with a quarter of its light.
// scripts/build-backdrop.mjs encodes; env.glsl decodes (uEnvCodecSharp, uEnvCodecSoft).

export const BACKDROP_CODEC = { knee: 1 / 16, max: { soft: 256, sharp: 2 ** 18 } }

// Stops from 0 to max, above the knee: the decoder's exponent scale.
export const backdropRange = (max) => Math.log2(1 + max / BACKDROP_CODEC.knee)

export const encodeBackdrop = (v, max) => Math.log2(1 + Math.min(Math.max(v, 0), max) / BACKDROP_CODEC.knee) / backdropRange(max)

export const decodeBackdrop = (e, max) => BACKDROP_CODEC.knee * (2 ** (e * backdropRange(max)) - 1)
