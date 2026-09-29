import { getMoonIllumination, getMoonPosition, getPosition } from 'suncalc'
import { cityToJ2000, dirFromAltAz, lommelSeeligerPhase, moonPhaseLaw, sunLux } from './astro.js'

// Everything a city's sky is computed from, for one moment: sun and moon from SunCalc, stars from
// sidereal time, weather from the one Open-Meteo request. `sky` is SKY from config.js (passed in so
// this runs in tests). `weather` may be null: no data counts as clear, and nothing is made up.
// `override` (lab sliders): { cloud 0..1, rain mm/h, fog } replace the live values when set.

const MOON_RADIUS_KM = 1737.4
const SUN_RADIUS = 0.004654 // radians (mean angular radius 0.2666°)
const FOG_CODES = new Set([45, 48])

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const tint = (c) => c.map((v) => v / luminance(c))

export function skyInputs({ city, date, weather = null, override = {}, sky }) {
  const sunPos = getPosition(date, city.lat, city.lon)
  const moonPos = getMoonPosition(date, city.lat, city.lon)
  const illum = getMoonIllumination(date)
  const sunDir = dirFromAltAz(sunPos.altitude, sunPos.azimuth)
  const moonDir = dirFromAltAz(moonPos.altitude, moonPos.azimuth)

  const cloud = clamp01(override.cloud ?? weather?.cloudCover ?? 0)
  const rain = Math.max(0, override.rain ?? weather?.mmPerHour ?? 0)
  const fog = override.fog ?? FOG_CODES.has(weather?.code)

  // Phase angle ψ (sun-moon-earth) from the lit fraction SunCalc reports: fraction = (1 + cos ψ) / 2.
  const psi = (Math.acos(Math.max(-1, Math.min(1, 2 * illum.fraction - 1))) * 180) / Math.PI
  const moonLaw = moonPhaseLaw(psi)

  // Pre-exposure: keeps the sky-view texture and the light values inside half-float range. It follows
  // the sun and moon only, so a weather change never re-renders the texture; the final exposure is
  // metered in the shader from what the view actually faces, weather included (sky.glsl, skyMeter).
  const glowZenith = cityGlowZenith(city.id, sky.cityGlow)
  const metered = meteredLuminance({ sunAlt: sunPos.altitude, moonAlt: moonPos.altitude, moonLaw, cloud: 0, rain: 0, cityZenith: glowZenith }, sky)
  const exposure = exposureFor(metered, sky.exposure)

  // The view faces the sun, or the moon once the sun is well down and the moon is up.
  const useMoon = sunPos.altitude < sky.facing.moonBelow && moonPos.altitude > 0
  const yaw = useMoon ? moonPos.azimuth : sunPos.azimuth
  const pitch = sky.facing.pitch

  const moonRadius = Math.asin(MOON_RADIUS_KM / moonPos.distance)
  const moonColour = tint(sky.moonColour)
  const moonE = sky.moonLux * moonLaw * exposure
  const glow = sky.cityGlow
  const haze = Math.max(rain > 0 ? sky.rainHaze.coef * rain ** sky.rainHaze.exp : 0, fog ? sky.rainHaze.fogPerKm : 0)

  const q = (deg) => Math.round(deg / sky.refreshDegrees)
  return {
    city: city.id,
    date,
    sun: { alt: sunPos.altitude, az: sunPos.azimuth, dir: sunDir },
    moon: { alt: moonPos.altitude, az: moonPos.azimuth, dir: moonDir, distanceKm: moonPos.distance, fraction: illum.fraction, phaseAngle: psi, radius: moonRadius },
    cloud,
    rain,
    fog,
    metered,
    exposure,
    facing: { yaw, pitch, toward: useMoon ? 'moon' : 'sun' },
    cityBasis: cityBasis(yaw, pitch),
    equatorial: cityToJ2000(date, city.lat, city.lon),
    // Light, already multiplied by the exposure. Colours are linear RGB of unit luminance.
    sunE: sky.sunLux * exposure,
    sunDisk: (sky.sunLux * exposure) / (Math.PI * SUN_RADIUS ** 2),
    moonE: moonColour.map((c) => c * moonE),
    moonTint: moonColour,
    moonOn: moonPos.altitude > -3,
    // The shader shades the disk as a Lommel-Seeliger sphere; this scales it to Allen's measured
    // brightness at the current phase. Radiance of the full disk, before that correction:
    moonDisk: ((sky.moonLux * exposure) / (Math.PI * moonRadius ** 2)) * (moonLaw / Math.max(lommelSeeligerPhase(psi), 1e-3)),
    earthshine: sky.earthshine * (1 - illum.fraction),
    starScale: sunPos.altitude < -4 ? sky.stars.lux0 * exposure : 0,
    cityGlow: tint(glow.colour).map((c) => c * glowZenith * exposure),
    clouds: {
      cover: cloud,
      tau: sky.clouds.tauMin + (sky.clouds.tauMax - sky.clouds.tauMin) * cloud + sky.clouds.tauPerMm * rain,
      baseKm: rain > 0 ? sky.clouds.rainBaseKm : sky.clouds.baseKm,
      tileKm: sky.clouds.tileKm,
      offset: cityOffset(city.id),
    },
    haze,
    // The sky-view texture depends only on these; everything else is a uniform, free to change.
    lutKey: [q(sunPos.altitude), q(sunPos.azimuth), q(moonPos.altitude), q(moonPos.azimuth), Math.round(Math.log2(exposure) * 32), moonPos.altitude > -3].join(),
  }
}

// What a camera meters: sky luminance (cd/m²) from sun, moon and the city's own light. The sky's share
// of the light is about 15% under a high sun, all of it once the sun is down or behind cloud. Cloud
// cuts the light (Kasten-Czeplak); rain darkens it further.
export function meteredLuminance({ sunAlt, moonAlt, moonLaw, cloud, rain, cityZenith = null }, sky) {
  const cut = (1 - 0.75 * cloud ** 3.4) / (1 + 0.08 * rain)
  const clearShare = sunAlt <= 0 ? 1 : 0.15 + 0.85 * Math.exp(-sunAlt / 6)
  const diffuse = clearShare + (1 - clearShare) * cloud
  const sun = (sunLux(sunAlt) * cut * diffuse) / Math.PI
  const moon = (sky.moonLux * moonLaw * Math.max(Math.sin((moonAlt * Math.PI) / 180), 0) * cut * 0.15) / Math.PI
  const city = (cityZenith ?? sky.cityGlow.zenith) * (1 + 3 * cloud)
  return sun + moon + city
}

// The city's own light at the zenith of a clear night (cd/m²): its World Atlas value plus the natural
// sky where src/content/cityGlow.json has one, else the one shared constant.
export const NATURAL_SKY_MCD = 0.171168465 // 22.00 mag/arcsec²
export function cityGlowZenith(cityId, glow) {
  const artificial = glow.atlas?.values?.[cityId]
  return artificial == null ? glow.zenith : (artificial + NATURAL_SKY_MCD) / 1000
}

// A metered luminance L comes out at key × (L / ref)^range: brighter skies still read brighter, over a
// few stops instead of eighteen.
export const exposureFor = (L, { key, ref, range }) => (key * (L / ref) ** range) / L

// Columns: the city-frame directions the drop's axis, right and up map to. A rotation, so the lens
// still inverts the image exactly as the optics say.
export function cityBasis(yawDeg, pitchDeg) {
  const view = dirFromAltAz(pitchDeg, yawDeg)
  const up = dirFromAltAz(pitchDeg + 90, yawDeg)
  const right = [view[1] * up[2] - view[2] * up[1], view[2] * up[0] - view[0] * up[2], view[0] * up[1] - view[1] * up[0]]
  return { view, right, up }
}

// Each city gets its own stretch of the shared cloud noise, fixed for the visit.
function cityOffset(id) {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return [((h >>> 0) % 1000) / 1000, ((h >>> 10) % 1000) / 1000]
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
