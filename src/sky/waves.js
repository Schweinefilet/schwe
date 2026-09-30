// The waves on a city's water (sky.glsl `water`), from the live wind. A handful of wave trains the shader
// sums into the surface's slope, plus the variance of the ones too short to model: the shader resolves
// what a pixel can show and turns the rest into roughness (Bruneton, Neyret and Holzschuch 2010).
//
// How rough: Cox and Munk's (1954) mean-square slopes, for a clean sea with the wind U (m/s) at 12.5 m:
// 3.16e-3 U along the wind, 0.003 + 1.92e-3 U across it, times `slopeScale` (a sheltered river is far
// calmer than the open sea; chosen against photos of the Thames). How long: the fetch-limited peak of
// JONSWAP (Hasselmann et al. 1973), f_p = 3.5 (g / U) (g F / U²)^-0.33, over the water's width F, never
// longer than a fully developed sea's (Pierson-Moskowitz, f_p = 0.14 g / U). Shorter than the peak each
// octave holds an equal share of the slope (Phillips' saturation range, height spectrum ∝ k⁻⁴), longer
// it falls off as exp(-1.25 (k_p / k)²). Speeds from the dispersion of gravity-capillary waves,
// ω² = g k + (γ / ρ) k³, rounded so every wave repeats in the shader clock's loop (`loop` seconds).
//
// The trains' lengths and directions are fixed once (waveTrains: changing a wave vector would make the
// whole pattern jump); only their heights follow the eased wind and rain (waveEnergy).

const G = 9.81
const TENSION = 7.28e-5 // γ / ρ for water, m³/s²
const CAPILLARY = 0.017 // m: the shortest gravity wave, where the saturation range ends
const TAU = 2 * Math.PI
// Where each train runs, relative to the wind (degrees): spread both ways, most near the wind.
const SPREAD = [0, 38, -30, 70, -62, 15, -85, 50, -12, 28, -45, 80]

export function peakWavelength(windMs, fetchM) {
  const U = Math.max(windMs, 0.5)
  const jonswap = 3.5 * (G / U) * ((G * fetchM) / (U * U)) ** -0.33
  const developed = 0.14 * (G / U)
  const f = Math.max(jonswap, developed)
  return G / (TAU * f * f) // deep water: λ = g / (2π f²)
}

// Mean-square slope along and across the wind; rain's rings add to both alike.
export function slopeVariance(windMs, { slopeScale = 1, rainMmH = 0, rainSlope = 0 } = {}) {
  const U = Math.max(windMs, 0)
  const rain = rainSlope * Math.sqrt(Math.max(rainMmH, 0))
  return [slopeScale * 3.16e-3 * U + rain / 2, slopeScale * (0.003 + 1.92e-3 * U) + rain / 2]
}

export function omega(k) {
  return Math.sqrt(G * k + TENSION * k ** 3)
}

// The trains for a wind of `windMs` blowing toward `towardDeg` (clockwise from north): log-spaced from
// 1.6 peak wavelengths down five octaves (the rest, down to CAPILLARY, is the unmodelled tail). Wave
// vectors in the city frame (x east, z south; rad/m), angular frequencies (rad/s). Glitter: facets about
// a quarter of the peak wavelength across, changing once a peak period (rounded to divide the loop).
export function waveTrains({ windMs = 0, towardDeg = 0, fetchM = 300, count = 10, loop = 600 }) {
  const peak = peakWavelength(windMs, fetchM)
  const longest = 1.6 * peak
  const shortest = Math.max(longest / 32, CAPILLARY * 2)
  const step = (longest / shortest) ** (1 / Math.max(count - 1, 1))
  const wind = (towardDeg * Math.PI) / 180
  const trains = []
  for (let i = 0; i < count; i++) {
    const k = TAU / (longest / step ** i)
    const a = wind + (SPREAD[i % SPREAD.length] * Math.PI) / 180
    const w = Math.max(1, Math.round((omega(k) * loop) / TAU)) * (TAU / loop)
    trains.push({ k, vector: [k * Math.sin(a), -k * Math.cos(a)], omega: w })
  }
  const cycles = Math.max(1, Math.round((loop * omega(TAU / peak)) / TAU))
  return {
    trains,
    octaves: Math.log2(step), // of the spectrum each train stands for
    tailOctaves: Math.max(Math.log2(shortest / CAPILLARY), 0),
    dir: [Math.sin(wind), -Math.cos(wind)],
    peak,
    glitter: { cell: peak / 4, period: loop / cycles, cycles },
  }
}

// The trains' amplitudes (m) and the tail's slope variance along and across the wind, for this wind and
// rain. The slope variance of all of it together is Cox and Munk's (scaled).
export function waveEnergy(set, { windMs = 0, fetchM = 300, slopeScale = 1, rainMmH = 0, rainSlope = 0 }) {
  const [along, across] = slopeVariance(windMs, { slopeScale, rainMmH, rainSlope })
  const kPeak = TAU / peakWavelength(windMs, fetchM)
  const shares = set.trains.map((t) => set.octaves * Math.exp(-1.25 * (kPeak / t.k) ** 2))
  const sum = shares.reduce((s, x) => s + x, 0) + set.tailOctaves
  const total = along + across
  return {
    amplitudes: set.trains.map((t, i) => Math.sqrt((2 * total * shares[i]) / sum) / t.k), // (a k)² / 2 is its slope variance
    tail: [(along * set.tailOctaves) / sum, (across * set.tailOctaves) / sum],
    variance: total,
  }
}
