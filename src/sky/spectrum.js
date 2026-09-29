// The atmosphere's scattering and absorption at the three wavelengths the red, green and blue
// channels stand for. Per km at sea level. Pure numbers, shared by config.js and the tests.
//
// Rayleigh: β = K / λ⁴ with K = 1.24062e-6 m⁻¹ µm⁴ (Bruneton 2017).
// Ozone: absorption cross-section × number density at the layer's peak for 300 Dobson units
// (300 × 2.687e20 / 15000 m⁻³). Cross-sections: IUP Bremen ozone spectra at 233 K, averaged over
// 10 nm bins, as tabulated in Bruneton 2017's demo (BSD-3); only the values used are kept here.

const RAYLEIGH_K = 1.24062e-6
const OZONE_DENSITY = (300 * 2.687e20) / 15000

export const rayleighPerKm = (nm) => (RAYLEIGH_K / (nm / 1000) ** 4) * 1000

// Cross-sections (m²) by the bin they come from.
const O3 = {
  '440-450': 1.582e-26,
  '460-470': 3.669e-26,
  '550-560': 3.5e-25,
  '600-610': 5.019e-25,
  '610-620': 4.305e-25,
  '680-690': 1.209e-25,
}
const ozonePerKm = (sigma) => sigma * OZONE_DENSITY * 1000

// Hillaire 2020's set: 680, 550 and 440 nm, each read from the bin starting there. Its blue-hour
// zenith comes out violet: the red sample sits past ozone's Chappuis band, which absorbs across the
// red channel's real range.
export const HILLAIRE_RGB = {
  wavelengths: [680, 550, 440],
  rayleigh: [680, 550, 440].map(rayleighPerKm),
  ozone: [O3['680-690'], O3['550-560'], O3['440-450']].map(ozonePerKm),
}

// The dominant wavelengths of the sRGB primaries (611, 549, 464 nm, rounded), each read from the bins
// centred on it: the channels then see ozone roughly where they really see light.
export const SRGB_RGB = {
  wavelengths: [610, 550, 465],
  rayleigh: [610, 550, 465].map(rayleighPerKm),
  ozone: [(O3['600-610'] + O3['610-620']) / 2, O3['550-560'], O3['460-470']].map(ozonePerKm),
}
