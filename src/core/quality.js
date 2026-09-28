import { getGPUTier } from 'detect-gpu'

// Quality tiers from the project bible, chosen once at load by detect-gpu before the Canvas mounts.
// Override for testing with ?tier=high|medium|low.
export const TIERS = {
  high: { rainCount: 6000, heroDrops: 10, decoders: 2, videoHeight: 1080, dpr: 2, effects: ['grain', 'bloom', 'vignette', 'lut'], splash: 'vat' },
  medium: { rainCount: 3000, heroDrops: 8, decoders: 1, videoHeight: 1080, dpr: 1.5, effects: ['grain', 'lut'], splash: 'vat' },
  low: { rainCount: 1200, heroDrops: 4, decoders: 1, videoHeight: 720, dpr: 1, effects: ['lut'], splash: 'video' },
}
export const TIER_ORDER = ['high', 'medium', 'low']

const forced = new URLSearchParams(location.search).get('tier')

export const quality = { name: 'high', ...TIERS.high }

export function setTier(name) {
  if (!TIERS[name]) return
  Object.assign(quality, { name }, TIERS[name])
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
  const webgl = !result || (result.type !== 'WEBGL_UNSUPPORTED' && result.type !== 'BLOCKLISTED')

  if (!forced) {
    if (!result) setTier('medium')
    // Recent phones score tier 3 but still get the lighter version; desktops need tier 3 for high.
    else if (result.tier >= 3 && !result.isMobile) setTier('high')
    else if (result.tier >= 2) setTier('medium')
    else setTier('low')
  }
  if (import.meta.env.DEV) console.info('[quality]', quality.name, result)
  return { tier: quality.name, webgl }
}
