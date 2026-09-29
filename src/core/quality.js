import { getGPUTier } from 'detect-gpu'
import { effectiveTier } from './gpuScore.js'

// Quality tiers from the project bible, chosen once at load by detect-gpu before the Canvas mounts.
// backdropView: which size of the start view (BACKDROP.view) to load: 'full' about 22 MB on the GPU with
// its mips, 'half' about 5.5 MB.
// Override for testing with ?tier=high|medium|low.
export const TIERS = {
  high: { rainCount: 6000, heroDrops: 10, decoders: 2, videoHeight: 1080, dpr: 2, effects: ['grain', 'bloom', 'vignette', 'lut'], splash: 'vat', backdropView: 'full' },
  medium: { rainCount: 3000, heroDrops: 8, decoders: 1, videoHeight: 1080, dpr: 1.5, effects: ['grain', 'lut', 'vignette'], splash: 'vat', backdropView: 'half' },
  // Low keeps the vignette: the effect pass has to run anyway (it converts to sRGB), and the vignette
  // merges into it for free.
  low: { rainCount: 1200, heroDrops: 4, decoders: 1, videoHeight: 720, dpr: 1, effects: ['lut', 'vignette'], splash: 'vat', backdropView: 'half' },
}
export const TIER_ORDER = ['high', 'medium', 'low']

const forced = new URLSearchParams(location.search).get('tier')

export const quality = { name: 'high', ...TIERS.high }
// detect-gpu's raw result (GPU name, score, isMobile), kept for benchmark reports.
export const detected = { result: null }

const listeners = new Set()
export function onTierChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setTier(name) {
  if (!TIERS[name] || name === quality.name) return
  Object.assign(quality, { name }, TIERS[name])
  listeners.forEach((fn) => fn(name))
}

export function stepDownTier() {
  const next = TIER_ORDER[TIER_ORDER.indexOf(quality.name) + 1]
  if (next) setTier(next)
  return next ?? null
}

if (forced) setTier(forced)

const DETECT_TIMEOUT_MS = 3000


// Resolves to { tier, webgl }. webgl is false when detect-gpu finds no usable WebGL (or it is
// blocklisted), which sends the visitor to the still page instead of a broken one.
// Benchmark data is self-hosted (copied to /benchmarks at build) so there is no runtime CDN call.
export async function detectTier() {
  let result = null
  try {
    result = await Promise.race([
      getGPUTier({ benchmarksURL: `${import.meta.env.BASE_URL}benchmarks` }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DETECT_TIMEOUT_MS)),
    ])
  } catch (err) {
    console.warn('[quality] GPU detection failed, using medium:', err.message)
  }
  detected.result = result
  const webgl = !result || (result.type !== 'WEBGL_UNSUPPORTED' && result.type !== 'BLOCKLISTED')

  if (!forced) {
    const score = result && effectiveTier(result)
    if (!result) setTier('medium')
    // Recent phones score tier 3 but still get the lighter version; desktops need tier 3 for high.
    else if (score >= 3 && !result.isMobile) setTier('high')
    else if (score >= 2) setTier('medium')
    else setTier('low')
  }
  if (import.meta.env.DEV) console.info('[quality]', quality.name, result)
  return { tier: quality.name, webgl }
}
