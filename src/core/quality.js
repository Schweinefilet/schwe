import { getGPUTier } from 'detect-gpu'
import { effectiveTier } from './gpuScore.js'

// Which version of the studio this device gets, decided once before the canvas mounts:
//   full  a 4096 shadow map, up to two device pixels per pixel, 9000 raindrops
//   lite  a 2048 shadow map, up to 1.5, 3500 raindrops: phones, tablets and weak GPUs
// and whether it can draw the model at all (no WebGL: the weather still reads, without the picture).
// detect-gpu's benchmark data is self-hosted (copied to /benchmarks before dev and build), so nothing is
// fetched from a CDN. Override with ?lite or ?lite=0.

const DETECT_TIMEOUT_MS = 2500
const forced = new URLSearchParams(location.search).get('lite')

export async function detectQuality() {
  let result = null
  try {
    result = await Promise.race([
      getGPUTier({ benchmarksURL: `${import.meta.env.BASE_URL}benchmarks` }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DETECT_TIMEOUT_MS)),
    ])
  } catch (err) {
    console.warn('[quality] GPU detection failed:', err.message)
  }
  const webgl = !result || (result.type !== 'WEBGL_UNSUPPORTED' && result.type !== 'BLOCKLISTED')
  const small = matchMedia('(pointer: coarse)').matches
  const lite = forced != null ? forced !== '0' : result ? result.isMobile || effectiveTier(result) <= 1 : small
  if (import.meta.env.DEV) console.info('[quality]', lite ? 'lite' : 'full', result)
  return { webgl, lite }
}
