// Quality tiers from the project bible. The tier is chosen once before the Canvas mounts.
// Phase 2 reads rainCount only; the other fields are consumed as their phases land.
// Override for testing with ?tier=high|medium|low.
export const TIERS = {
  high: { rainCount: 6000, heroDrops: 10, decoders: 2, videoHeight: 1080, dpr: 2, effects: ['grain', 'bloom', 'vignette', 'lut'], splash: 'vat' },
  medium: { rainCount: 3000, heroDrops: 8, decoders: 1, videoHeight: 1080, dpr: 1.5, effects: ['grain', 'lut'], splash: 'vat' },
  low: { rainCount: 1200, heroDrops: 4, decoders: 1, videoHeight: 720, dpr: 1, effects: ['lut'], splash: 'video' },
}

const forced = new URLSearchParams(location.search).get('tier')

export const quality = { name: 'high', ...TIERS.high }

export function setTier(name) {
  if (!TIERS[name]) return
  Object.assign(quality, { name }, TIERS[name])
}

if (forced) setTier(forced)
