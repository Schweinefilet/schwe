// detect-gpu only knows GPUs in its benchmark data (last updated Feb 2025); anything newer comes back
// as type FALLBACK, tier 1. The live guard only ever steps down, so starting too low is permanent while
// starting too high costs a few seconds. Unknown GPUs therefore start higher: Apple Silicon as tier 3
// (every M chip in the data scores tier 3), anything else as tier 2.
export function effectiveTier(result) {
  if (result.type !== 'FALLBACK') return result.tier
  if (/\bapple m\d+/i.test(result.gpu ?? '')) return 3
  return 2
}
